# Element Shot

A browser userscript that captures **any page element including its full scrollable content**. Pick an element with the mouse, let the script expand clipped scroll areas, then render a PNG with [html-to-image](https://github.com/bubkoo/html-to-image). Cross-origin images, stylesheets and fonts are fetched through `GM_xmlhttpRequest` and inlined, bypassing page CORS.

[中文文档](README.md)

## Features

- **Element picker** — live hover preview; wheel or `+` / `-` walks the z-order stack; the frame covers the element's complete scroll range.
- **Full-content capture** — recursively expands nested scroll containers; `Ctrl+A` captures the whole page.
- **Result actions** — `Ctrl+C` copies, `Ctrl+S` or double-click saves (file picker first), `Esc` dismisses.
- **Floating button (FAB)** — click to capture, drag to move, snaps to edges; can be hidden in settings.
- **Settings panel** — tabs + accordions, search, shortcut recorder, color/number controls, site policy, three locales, light/dark theme.
- **Reusable settings library** — `@element-shot/settings` ships ESM, IIFE and type declarations for other userscripts.
- **Modern toolchain** — Vite + `vite-plugin-monkey` + Vue 3 + TypeScript + Tailwind CSS 4 + Vitest + ESLint + semver.

## Install

Build first (see [Development](#development)), then install this file in Tampermonkey / Violentmonkey:

```text
packages/userscript/dist/element-shot.user.js
```

Requested permissions:

| Permission                                            | Purpose                                  |
| ----------------------------------------------------- | ---------------------------------------- |
| `GM_xmlhttpRequest` + `@connect *`                    | Fetch cross-origin images, CSS and fonts |
| `GM_registerMenuCommand` / `GM_unregisterMenuCommand` | Menu commands                            |
| `GM_getValue` / `GM_setValue` / `GM_deleteValue`      | Persist settings and FAB position        |
| `GM_info`                                             | Read the script version                  |

`@match *://*/*`, `@run-at document-idle`, `@noframes`. Everything runs locally; no data is uploaded.

## Usage

### Trigger

- Click the camera FAB at the page edge;
- press the default shortcut `Alt+Shift+S`;
- or use the userscript menu → “Capture element”.

Shortcuts are configurable and apply immediately.

### Pick an element

| Action                 | Result                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- |
| Move the mouse         | Preview the element under the cursor; the frame covers its full scroll range |
| Wheel down / `+` / `↓` | Select a more deeply nested (inner) element                                  |
| Wheel up / `-` / `↑`   | Select an outer element                                                      |
| Click / `Enter`        | Confirm and start rendering                                                  |
| `Ctrl+A` / `Cmd+A`     | Capture the whole page                                                       |
| `Esc`                  | Cancel                                                                       |

After selection:

| Action             | Result                                         |
| ------------------ | ---------------------------------------------- |
| `Ctrl+C` / `Cmd+C` | Copy PNG to clipboard                          |
| `Ctrl+S` / `Cmd+S` | Save PNG (`showSaveFilePicker` when available) |
| Double-click       | Save PNG                                       |
| `Esc`              | Close the picker                               |

> Clipboard image writes need a secure context and permission. The file picker is Chromium-only; other browsers fall back to a normal download.

### Settings

- Open from the userscript menu → “Settings”.
- **Trigger shortcut**, **frame color/width**, **export scale**, **background/transparent**, **expand nested scroll areas**.
- **Floating button** — show/hide, size, reset position; dragged positions are remembered.
- **Site policy** — run only on / never run on specific sites.
- **Language** — Simplified Chinese, Traditional Chinese, English; **theme** — auto / light / dark.
- Every change is persisted through the userscript manager.

### Site rules

One rule per line; lines starting with `#` are comments:

| Rule                           | Matches                              |
| ------------------------------ | ------------------------------------ |
| `example.com`                  | The host and its subdomains          |
| `*.example.com`                | Subdomains only                      |
| `https://*.example.com/docs/*` | Full-URL glob                        |
| `/docs/*`                      | Path glob                            |
| `/^https:\/\/docs\./`          | Regular expression over the full URL |

- An empty include list means “all sites”.
- Exclusions win over inclusions.
- Excluded pages mount no FAB or picker, but the menu still offers “Enable on this site”, which removes matching exclusions and adds the hostname to the include list.

## Development

Requires Node.js >= 22.12 and pnpm 10.

```bash
pnpm install
pnpm dev:settings     # settings library demo (Vite)
pnpm playground       # userscript playground at http://127.0.0.1:4176/
pnpm build            # build settings library (ESM + IIFE) and userscript
pnpm lint             # ESLint
pnpm typecheck        # vue-tsc
pnpm test             # Vitest
pnpm test:coverage    # coverage
pnpm check            # lint + typecheck + coverage + build
```

Outputs:

- `packages/userscript/dist/element-shot.user.js` — userscript with `@grant` header
- `packages/userscript/dist/element-shot.meta.js` — metadata for update checks
- `packages/settings/dist/index.mjs`, `auto.mjs`, `*.d.ts` — ESM + types
- `packages/settings/dist/iife/userscript-settings.iife.js` — IIFE with Vue and CSS bundled

The playground uses `playground/gm-stub.js` to emulate GM APIs and exposes the last canvas dimensions for verification.

## Architecture

```text
.
├─ packages/
│  ├─ settings/                 # reusable settings panel library
│  │  ├─ src/i18n.ts            # tiny reactive i18n with locale registration
│  │  ├─ src/settings.ts        # declarative schema, dynamic updates, persistence
│  │  ├─ src/components/        # Vue 3 + Tailwind 4, no component library
│  │  ├─ src/auto.ts            # entry that injects styles automatically
│  │  └─ src/iife.ts            # IIFE entry
│  └─ userscript/
│     ├─ src/plugin/            # rewrite html-to-image fetch/XHR to GM adapters
│     ├─ src/net/               # GM_xmlhttpRequest → fetch / XHR adapters
│     ├─ src/core/capture.ts    # scroll expansion, canvas limits, rendering
│     ├─ src/core/picker.ts     # layered picking, wheel/keyboard, event guards
│     ├─ src/ui/                # FAB, frame, toasts (Vue)
│     └─ src/main.ts            # menus, shortcut, site policy, settings
├─ playground/                  # local acceptance page and GM stubs
└─ tests/                       # cross-package tests (e.g. no-emoji policy)
```

### Cross-origin fetch/XHR injection

`gmFetchPlugin()` parses the `html-to-image` modules during the Vite transform and rewrites global `fetch(...)` and `XMLHttpRequest` references to a virtual adapter module. The adapter uses `GM_xmlhttpRequest`, so:

- cross-origin images and background images are read as Blobs and inlined as data URLs;
- `@font-face` rules and cross-origin stylesheets can be fetched too;
- the canvas is not tainted by cross-origin resources.

`optimizeDeps.exclude` keeps the plugin effective in dev mode as well.

### Scroll capture

1. Read `getBoundingClientRect` plus `scrollWidth/scrollHeight` to compute the full box (including borders).
2. Snapshot styles, temporarily expand the target and its `overflow: auto/scroll` descendants, and reset scroll offsets.
3. Compute an export ratio that fits browser canvas limits and call `toBlob`.
4. Restore every style and scroll offset in `finally`.

The frame, the rendered size and the final PNG dimensions therefore stay consistent (the latter is multiplied by the export scale).

### Settings library

```ts
import { createSettings } from '@element-shot/settings/auto'

const settings = createSettings({
  version: '1.0.0',
  tabs: [
    {
      id: 'capture',
      title: 'Capture',
      icon: 'camera',
      groups: [
        {
          id: 'basic',
          title: 'Basics',
          defaultOpen: true,
          fields: [
            { type: 'shortcut', key: 'shortcut', label: 'Shortcut', default: 'Alt+Shift+S' },
            { type: 'color', key: 'borderColor', label: 'Border color', default: '#2563eb' }
          ]
        }
      ]
    }
  ]
})

settings.open()
```

See [`packages/settings/README.md`](packages/settings/README.md) for field types, dynamic registration, i18n, storage adapters and the IIFE entry.

## Limitations

- **Closed Shadow DOM** cannot be picked; open shadow roots can be picked, but html-to-image may omit their rendered content.
- Cross-origin `iframe` internals cannot be selected; `<video>` and WebGL/Canvas pixels depend on the current frame and may be blank.
- Very large pages are downscaled automatically to the browser canvas limit (a toast is shown).
- `position: sticky/fixed` elements are rendered by the library against the viewport; full-page results can differ from stitched screenshots.
- Whether cross-origin fonts can be embedded depends on the userscript manager and the target's CORS/response; failed fonts fall back.
- Capture is local, but the manager does fetch the original asset URLs to inline them.
- The file picker is Chromium-only; other browsers download instead. Clipboard image writes need permission.
- Designed for keyboard and mouse; touch only guarantees the FAB and settings panel are tappable.

## Version

Current version: `0.1.0`. See [CHANGELOG.md](CHANGELOG.md). Versions follow semver and tags look like `v0.1.0`.

## License

[MIT](LICENSE)
