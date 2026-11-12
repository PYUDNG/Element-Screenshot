# @element-screenshot/versioned-storage

Versioned storage for userscripts: one manager value holding a schema generation **and** its payload, so a rename or a shape change can never run twice and can never leave data without its version.

No dependencies, no DOM, no framework. Import it alone or next to `@element-screenshot/settings`; the two packages know nothing about each other (the storage view is structurally compatible with `SettingsStorage`).

## Install

This repository is a pnpm workspace. Build the package first:

```bash
pnpm --filter @element-screenshot/versioned-storage build
```

Artifacts:

```text
dist/index.mjs   # ESM
dist/index.d.ts  # types
```

## Quick start

```ts
import { createDomain } from '@element-screenshot/versioned-storage'

const domain = createDomain({
  key: 'settings', // GM key without the script's own prefix
  storage: {
    getValue: (key) => GM_getValue(key, null),
    setValue: (key, value) => GM_setValue(key, value),
    deleteValue: (key) => GM_deleteValue(key)
  },
  steps: [
    {
      // Generation 1: `darkMode: true` became `theme: 'dark'`.
      id: 1,
      run(value) {
        const values = JSON.parse(value) as Record<string, unknown>
        if (typeof values.darkMode === 'boolean') {
          values.theme = values.darkMode ? 'dark' : 'light'
          delete values.darkMode
        }
        return JSON.stringify(values)
      }
    }
  ]
})

domain.version // 1 — newest generation this script knows
domain.value // payload after migration, or null when storage was empty

// Hand the view to whatever stores strings (a settings panel, your own code):
domain.storage.getItem('settings')
domain.storage.setItem('settings', JSON.stringify({ theme: 'dark' }))
domain.storage.removeItem('settings')
```

## Envelope

One manager value holds:

```json
{ "version": 1, "value": "{\"theme\":\"dark\"}" }
```

- `version` — non-negative integer, the schema generation.
- `value` — opaque string; usually `JSON.stringify(values)`, but the envelope never parses it. Your steps decide the payload format.

Why not a separate version key: two writes can be interrupted between them, leaving data with no version. Here version and payload are one write, so they cannot drift.

Why not `version` inside the payload: unknown keys are dropped by every settings store that hydrates a schema, so the number would silently disappear.

## What is accepted

| Stored value                              | Result                                            |
| ----------------------------------------- | ------------------------------------------------- |
| `null` / `undefined`                      | empty: generation 0, nothing written              |
| `string`                                  | legacy: generation 0, steps run, envelope written |
| `{ version: integer ≥ 0, value: string }` | used as-is; steps above `version` run             |
| anything else                             | reported via `onWarn`, **left untouched**         |

Generation only moves forward. A value from a newer script (downgrade) keeps its generation and payload, so re-upgrading does not re-run steps. A step that throws aborts the whole migration and leaves storage alone — a stale generation retries next start, a half-rewritten payload does not.

An empty domain writes nothing, so installing the script does not create a storage entry.

## API

```ts
interface DomainOptions {
  key: string
  steps?: readonly DomainStep[]
  storage: DomainValueStorage
  onWarn?: (message: string, error?: unknown) => void
}

interface DomainStep {
  id: number // positive, unique, steps run in ascending order
  run(value: string): string // receives generation N-1, returns generation N
}

interface DomainValueStorage {
  getValue(key: string): unknown
  setValue(key: string, value: unknown): void
  deleteValue?(key: string): void // falls back to setValue(key, null)
}

interface Domain {
  readonly key: string
  readonly version: number
  readonly value: string | null
  readonly storage: DomainStorage
}

interface DomainStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
```

Rules for steps:

- A step only ever sees the **previous** generation's payload; never write a step that assumes its own id.
- Steps must tolerate an empty payload and payloads missing fields.
- Adding a step means a new id greater than every existing one. Never reuse an id.
- Retired setting names stay reserved: a generation-0 payload is rewritten by the old steps, so a new setting under an old name would inherit its meaning.

## With `@element-screenshot/settings`

```ts
import { createSettings } from '@element-screenshot/settings'
import { createDomain } from '@element-screenshot/versioned-storage'

const domain = createDomain({ key: 'settings', steps, storage: gm })

const settings = createSettings({
  storage: domain.storage, // DomainStorage is assignable to SettingsStorage
  storageKey: 'settings',
  tabs: []
})
```

The panel consumes the payload, not the envelope, so nothing in the panel has to know that migrations exist.

## Development

```bash
pnpm --filter @element-screenshot/versioned-storage build
pnpm --filter @element-screenshot/versioned-storage typecheck
pnpm test packages/versioned-storage
```
