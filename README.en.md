# Element Shot

A browser userscript that captures **any page element including its full scrollable content**. Pick an element with the mouse, let the script expand clipped scroll areas, then render a PNG with [html-to-image](https://github.com/bubkoo/html-to-image). Cross-origin images and fonts in readable stylesheets are fetched through `GM_xmlhttpRequest` and inlined, bypassing page CORS.

[中文文档](README.md)

## Features

- **Element picker** — live hover preview; wheel or `+` / `-` walks the z-order stack; the frame covers the element's complete scroll range.
- **Page interaction isolation** — a transparent capture surface takes pointer events while picking, so hover, click and mousemove effects do not leak into the image. Turn it off when you need to capture a hover state.
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

| Permission                                            | Purpose                             |
| ----------------------------------------------------- | ----------------------------------- |
| `GM_xmlhttpRequest` + `@connect *`                    | Fetch cross-origin images and fonts |
| `GM_registerMenuCommand` / `GM_unregisterMenuCommand` | Menu commands                       |
| `GM_getValue` / `GM_setValue` / `GM_deleteValue`      | Persist settings and FAB position   |
| `GM_info`                                             | Read the script version             |

`@match *://*/*`, `@run-at document-start`, `@noframes`. Everything runs locally; no data is uploaded. The script snapshots native browser APIs at startup, then waits for the DOM before mounting its UI.

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

> “Isolate page interaction” is on by default. A transparent capture surface above the page receives pointer movement, hover and clicks, so the target's hover styles do not appear in the screenshot. Turn it off in Settings → Capture → Picker interaction when you want a hover-state capture.

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
- **Trigger shortcut**, **isolate page interaction**, **frame color/width**, **export scale**, **match page background / custom background / transparent**, **expand nested scroll areas**.
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
│     ├─ src/core/native.ts     # document-start native API snapshot
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
- `@font-face` rules in readable stylesheets are embedded;
- external SVG sprites are fetched by `<use href="...">` fragment and rewritten to local symbol references before rendering;
- the canvas is not tainted by cross-origin resources.

`cssRules` of a cross-origin `<link rel="stylesheet">` is protected by the same-origin policy. The script skips those sheets instead of inserting fetched text into a live page stylesheet. That keeps `SecurityError` / `SyntaxError` messages out of the console and avoids changing the page, at the cost of falling back to system fonts for fonts declared only in such sheets.

`optimizeDeps.exclude` keeps the plugin effective in dev mode as well.

### Page hook / monkey-patch hardening

Pages can replace `fetch`, `XMLHttpRequest`, DOM prototypes or Canvas APIs. At startup (`document-start`) the script snapshots a set of native APIs and the capture path prefers those references:

- **Network** — the script never calls the page's `fetch` / `XMLHttpRequest`. A build-time transform rewrites html-to-image's network references to a `GM_xmlhttpRequest` adapter, so a page-level `window.fetch` hook cannot intercept resource reads.
- **Native API snapshot** — original references are captured for `getComputedStyle`, `cloneNode`, `createElement`, `querySelector(All)`, `getBoundingClientRect`, `elementsFromPoint`, `XMLSerializer`, `Image`, `Blob`, `FileReader`, `CanvasRenderingContext2D`, `canvas.toBlob/toDataURL`, event listeners, object URLs and download clicks. html-to-image cloning, style reads, SVG parsing and canvas serialization go through these references, so prototype methods replaced after startup do not intercept them.
- **Styles and UI** — FAB, picker, toasts and settings live in Shadow DOM with constructable stylesheets. Page CSS cannot leak into the UI, and the UI is filtered out of captures.
- **Events** — the picker and result guards listen in the capture phase and call `stopImmediatePropagation()`, so page handlers cannot steal selection clicks, wheel input or shortcuts. The transparent surface also blocks page hover and mousemove.
- **Storage** — settings and FAB position use `GM_getValue` / `GM_setValue`, not page `localStorage`.

This is **not full clean-realm isolation and cannot guarantee undetectability**. The page and the script still share the same DOM/CSSOM: a page can install hooks before the script starts, observe or mutate the target DOM, inject CSS, block resources, or detect the script UI with a MutationObserver. The hardening covers common monkey-patching and the key APIs on the capture path; if a page replaced a native method before the script loaded, the snapshot can only capture the replaced version. `playground/hooked.html` is the regression fixture: it hooks these APIs after startup and still expects a successful capture.

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
- Cross-origin fonts can only be embedded from readable stylesheets; unreadable cross-origin sheets are skipped and their fonts fall back.
- The native snapshot only covers hooks installed after script startup. Hooks installed before `document-start`, direct DOM/CSS mutations and UI detection cannot be fully prevented.
- The default interaction isolation suppresses hover effects; pages that reveal content on hover need the switch turned off before capture.
- If a site blocks an SVG sprite fetch or serves malformed SVG, those icons are omitted without failing the whole capture.
- Capture is local, but the manager does fetch the original asset URLs to inline them.
- The file picker is Chromium-only; other browsers download instead. Clipboard image writes need permission.
- Designed for keyboard and mouse; touch only guarantees the FAB and settings panel are tappable.

## Version

Current version: `0.2.4`. See [CHANGELOG.md](CHANGELOG.md). Versions follow semver and tags look like `v0.2.4`.

## License

[MIT](LICENSE)
