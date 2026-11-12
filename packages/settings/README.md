# @element-screenshot/settings

A drop-in, declarative settings panel for userscripts. Vue 3 + TypeScript + Tailwind CSS 4, no component library, rendered inside a Shadow DOM so it cannot leak styles into the host page.

- ESM + type declarations + standalone IIFE (Vue and CSS bundled)
- Declarative schema with tabs (top level) and accordions (second level)
- Dynamic `register*` / `updateField` / `removeField` APIs
- Built-in language, theme and reset controls
- Custom storage adapters (GM, localStorage, memory)
- Extensible i18n and SVG icon set (no emoji icons)

## Install

This repository is a pnpm workspace. Build the package first:

```bash
pnpm --filter @element-screenshot/settings build
```

Artifacts:

```text
dist/index.mjs                       # ESM core (Vue external, no CSS)
dist/auto.mjs                        # ESM + auto-injected CSS
dist/iife/userscript-settings.iife.js# IIFE, global UserscriptSettings
dist/*.d.ts                          # types
```

In a bundled userscript, import the source package or the built ESM:

```ts
import { createSettings } from '@element-screenshot/settings/auto'
```

`auto` loads the compiled Tailwind CSS string and injects it into the panel's shadow root. Use the root entry when you want to provide your own stylesheet (for example, a single Tailwind build shared with your userscript UI):

```ts
import { createSettings } from '@element-screenshot/settings'
import css from './my-styles.css?inline'

const settings = createSettings({ styles: css, tabs: [] })
```

## IIFE

```html
<script src="userscript-settings.iife.js"></script>
<script>
  const { createSettings } = UserscriptSettings

  const settings = createSettings({
    version: '1.0.0',
    tabs: [
      {
        id: 'main',
        title: 'Main',
        groups: [
          {
            id: 'basic',
            title: 'Basics',
            defaultOpen: true,
            fields: [{ type: 'switch', key: 'enabled', label: 'Enabled', default: true }]
          }
        ]
      }
    ]
  })

  document.querySelector('#open').addEventListener('click', () => settings.open())
</script>
```

The IIFE has no external dependency; Vue is included.

## Quick start

```ts
import { createI18n, createGMStorage, createSettings } from '@element-screenshot/settings/auto'

const i18n = createI18n({
  defaultLocale: 'en',
  fallbackLocale: 'en'
})

const settings = createSettings({
  version: '1.2.3',
  i18n,
  storage: createGMStorage(
    {
      getValue: (key, fallback) => GM_getValue(key, fallback),
      setValue: (key, value) => GM_setValue(key, value),
      deleteValue: (key) => GM_deleteValue(key)
    },
    'my-script:'
  ),
  storageKey: 'settings',
  tabs: [
    {
      id: 'capture',
      title: 'settings.tab.capture',
      icon: 'camera',
      groups: [
        {
          id: 'shortcut',
          title: 'settings.group.shortcut',
          defaultOpen: true,
          fields: [
            {
              type: 'shortcut',
              key: 'capture.shortcut',
              label: 'settings.field.shortcut',
              default: 'Alt+Shift+S'
            },
            {
              type: 'color',
              key: 'capture.borderColor',
              label: 'settings.field.borderColor',
              default: '#2563eb',
              swatches: ['#2563eb', '#16a34a', '#dc2626']
            },
            {
              type: 'range',
              key: 'capture.borderWidth',
              label: 'settings.field.borderWidth',
              default: 2,
              min: 1,
              max: 8,
              step: 1,
              unit: 'px'
            }
          ]
        }
      ]
    }
  ]
})

settings.open()
```

`title`, `label` and `description` accept an i18n key. If the key is missing, the string itself is displayed, so literal labels work too.

## Schema

```ts
interface SettingsTab {
  id: string
  title: string
  description?: string
  icon?: IconName
  groups: SettingsGroup[]
}

interface SettingsGroup {
  id: string
  title: string
  description?: string
  defaultOpen?: boolean
  fields: SettingsField[]
}
```

### Field types

| `type`     | Value              | Extra options                                          |
| ---------- | ------------------ | ------------------------------------------------------ |
| `switch`   | `boolean`          | —                                                      |
| `select`   | `string \| number` | `options: SelectOption[] \| (() => SelectOption[])`    |
| `text`     | `string`           | `placeholder`, `maxLength`                             |
| `textarea` | `string`           | `placeholder`, `rows`                                  |
| `number`   | `number`           | `min`, `max`, `step`, `unit`                           |
| `range`    | `number`           | `min`, `max`, `step`, `unit`                           |
| `color`    | `string`           | `swatches`                                             |
| `shortcut` | `string`           | `allowClear` (default true)                            |
| `list`     | `string[]`         | `placeholder`, `addLabel`, `maxItems`, `validate`      |
| `action`   | —                  | `action`, `icon`, `variant`, `confirm`, `confirmLabel` |
| `custom`   | any `SettingValue` | `render(context)`                                      |

Every value field has `default`; action fields do not. Shared base options:

```ts
{
  key: string
  label: string
  description?: string
  visible?: (values) => boolean
  disabled?: boolean | ((values) => boolean)
  fullWidth?: boolean
}
```

`list` validation returns a message key (translated by the panel) or `null`:

```ts
{
  type: 'list',
  key: 'site.exclude',
  label: 'Excluded sites',
  default: [],
  validate: (value) => isValid(value) ? null : 'errors.invalidRule'
}
```

`custom` receives Vue's `h`-compatible render context:

```ts
{
  type: 'custom',
  key: 'preview',
  label: 'Preview',
  default: '',
  render: ({ value, setValue }) => h('button', { onClick: () => setValue('x') }, String(value))
}
```

## Controller

```ts
const settings = createSettings(options)

settings.open()
settings.close()
settings.get('capture.shortcut')
settings.set('capture.shortcut', 'Ctrl+Shift+K')
settings.reset('capture.borderWidth')
settings.resetAll()
settings.dispose()

settings.registerTab(tab)
settings.unregisterTab(tabId)
settings.registerGroup(tabId, group)
settings.unregisterGroup(tabId, groupId)
settings.registerField(tabId, groupId, field, index?)
settings.updateField('key', { label: 'New label', options: [...] })
settings.removeField('key')
settings.getField('key')
settings.hasTab('tab-id')
```

Reactive state you can read from Vue components:

```ts
settings.tabs // reactive schema
settings.values // reactive values
settings.theme // 'auto' | 'light' | 'dark'
settings.resolvedTheme
settings.isOpen
settings.i18n
```

`createSettings` inserts a built-in **General** tab unless `builtins: false`:

- `locale` — auto + every registered locale;
- `theme` — auto / light / dark (class-based, scoped to the panel);
- reset action with two-step confirmation.

If your schema already contains a tab named `general`, the built-ins are merged into it.

A schema that declares its own `theme` field (anywhere) keeps the library from adding a second one, so an app can move the switch into another tab; the built-in group then holds the language select alone and is titled `settings.builtin.languageGroup` instead of `settings.builtin.appearance`.

## Panel variables

`variables` is the seam for values that change at runtime. It returns CSS custom properties for the panel root, and it is re-evaluated whenever `values` change, so the open panel repaints without being reopened:

```ts
const settings = createSettings({
  // ...
  variables: (values) => ({ '--es-primary': String(values['ui.primary'] ?? '#2563eb') })
})
```

The panel does not interpret the names; it only puts them on `.es-root`, the element its stylesheet is built around. The library's own stylesheet uses them for the `primary` palette (see below).

## Storage

```ts
import {
  createGMStorage,
  createLocalStorageStorage,
  createMemoryStorage
} from '@element-screenshot/settings'

createGMStorage({ getValue, setValue, deleteValue }, 'my-script:')
createLocalStorageStorage('my-script:')
createMemoryStorage({ 'my-key': '{"value":1}' })
```

Implement `SettingsStorage` yourself if needed:

```ts
interface SettingsStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}
```

Values are stored as one JSON object under `storageKey`. Hydration only accepts keys that exist in the schema and values whose type matches the default.

## i18n

```ts
const i18n = createI18n({
  defaultLocale: 'en',
  fallbackLocale: 'en',
  locales: [{ code: 'en', label: 'English', messages: { my: { hello: 'Hello {name}' } } }]
})

i18n.registerLocale({
  code: 'ja',
  label: '日本語',
  messages: { my: { hello: 'こんにちは {name}' } }
})

i18n.setLocale('ja')
i18n.t('my.hello', { name: 'Ada' })
```

- Nested message keys (`a.b.c`) are supported.
- New locales automatically appear in the built-in language selector.
- `registerLocale` deep-merges into an existing locale, so partial translations are fine.
- The library registers its own `settings.*` messages when `createSettings` runs; your keys can coexist.
- `auto` resolves against `navigator.languages` and falls back to `defaultLocale` / `fallbackLocale`.

## Icons

SVG-only icon components are exported individually:

```ts
import { CameraIcon, SettingsIcon, iconMap, type IconName } from '@element-screenshot/settings'
```

Use `icon: 'camera'` in a tab and `icon: 'reset'` on an action field. Add your own SVG component to the panel via a custom field if needed. Emoji are intentionally not used anywhere.

## Theming and Shadow DOM

- The panel is rendered in an open Shadow DOM inside a fixed host (`z-index: 2147483647`).
- CSS is injected through a constructable stylesheet, falling back to `<style>`.
- The embedded Tailwind build uses `@custom-variant dark (&:where(.dark, .dark *))`; the panel root gets a `dark` class based on the resolved theme.
- The panel never modifies the host page's theme or global styles.

### Accent colour

Components use the semantic `primary` palette (`bg-primary-600`, `text-primary-700`, …) — never a hue — and `primary.css` defines it twice:

- a static `@theme` fallback (what the palette always was);
- inside `@supports (color: color-mix(...))`, six `--color-primary-*` values mixed from `--es-primary`, with fixed lightness pins so contrast does not depend on the chosen colour.

So `variables` (above) is all it takes to recolour the panel. Adding a shade means adding it to both blocks.

If you provide your own `styles`, make sure the Tailwind build scans this package's source (`@source` in Tailwind 4) or use the `auto` entry — and include `primary.css`, or the `primary-*` classes will not exist.

## Development

```bash
pnpm --filter @element-screenshot/settings dev      # demo at the printed URL
pnpm --filter @element-screenshot/settings build    # ESM + d.ts + IIFE
pnpm --filter @element-screenshot/settings typecheck
```

The demo lives in `index.html` and `demo/main.ts`. It also demonstrates dynamic field registration.

## Scope

The library owns the settings UI, schema, persistence and i18n. It does **not** implement your script's logic, keyboard shortcut handling, or site policy; wire those from your controller's values.
