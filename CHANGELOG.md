# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.1] - 2026-11-05

### Fixed

- Full-page captures no longer fail on pages whose inline scripts contain
  control characters that XML 1.0 forbids. html-to-image cloned the scripts into
  the SVG wrapper, and a single `U+0001` made Chromium reject the entire image.
  Scripts are now excluded from the clone, and the serialized SVG is sanitized
  against the XML 1.0 character set as a fallback.
- Capture failures now report the underlying cause instead of a bare “rendering
  failed” toast. The picker status tooltip also exposes the technical detail.

## [0.2.0] - 2026-11-05

### Added

- Page interaction isolation for the picker. A transparent capture surface takes
  pointer events while picking, so page hover, click and mousemove effects do
  not leak into the screenshot. The new “Isolate page interaction” switch
  defaults to on and can be turned off to capture hover states.
- A startup native API snapshot captured at `document-start`. The script now
  routes computed styles, cloning, element lookup, geometry, SVG serialization,
  Canvas methods, event listeners, object URLs and download clicks through the
  original references, and injects the same snapshot into html-to-image through
  the build plugin. `playground/hooked.html` verifies a capture while common
  DOM, Canvas and serialization prototypes are replaced.
- Pointer cursors for all interactive settings, picker and floating-button
  controls.
- The picker label is clamped to the viewport and flips below the target when an
  element starts above the visible area.

### Fixed

- The cloned root no longer gets the page-backdrop color painted over its own
  background. Opaque cards keep their real background while transparent areas
  still use the sampled page color.
- The picker stays mounted while rendering, keeping page interaction isolated
  until the capture finishes instead of briefly restoring hover state.
- The SVG `<use>` resolver uses native lookups and safely skips text nodes,
  avoiding an `Illegal invocation` error during cloning.

## [0.1.2] - 2026-11-05

### Fixed

- Xiaohongshu pages with SVG sprite icons no longer fail the whole capture.
  html-to-image treated `/sprite.svg#icon` as a CSS selector and threw
  `SyntaxError`; the SVG `<use>` resolver now extracts the fragment id, reuses
  in-document symbols, and fetches external sprites through the GM adapter.
  Icons that resolve are rewritten to local fragment references before render.

## [0.1.1] - 2026-11-05

### Fixed

- The picker toolbar no longer overflows to the right. It is centered with
  inset positioning instead of a `translate` utility, and the Tailwind
  custom-property defaults are restored in the base layer so `translate`,
  `border` and `shadow` utilities work even when Tailwind's narrow `@supports`
  guard is false (observed in Chromium 156).
- Captures now match the visible page background by default. The script
  composites the selected element's ancestor background colors instead of
  forcing white; a "match page background" switch exposes the previous custom
  color and transparent-background modes.
- After a successful copy or save the picker closes automatically and restores
  page interaction. Cancelling the save dialog keeps the selection open.
- Removed html-to-image console noise on pages with cross-origin stylesheets.
  The font-embedding routine now skips unreadable sheets instead of inserting
  fetched CSS into the live document and logging `SecurityError` /
  `SyntaxError`.
- Settings can close while a capture result is open; its shadow root is treated
  as UI by the event guards, and opening settings cancels an active picker.

## [0.1.0] - 2026-11-05

### Added

- Userscript entry with `vite-plugin-monkey`, `@match *://*/*`, menu commands,
  GM storage and a configurable global shortcut.
- Element picker with live hover frames covering the full scroll range,
  wheel/`+`/`-` layer cycling, click/Enter confirmation, `Ctrl+A` full page and
  `Esc` cancellation.
- Full-content scroll capture via html-to-image, including recursive expansion
  of nested scroll containers, canvas-limit downscaling, transparent/opaque
  backgrounds and style restoration.
- `Ctrl+C` clipboard copy, `Ctrl+S`/double-click save with the File System
  Access API and a download fallback.
- Draggable floating action button with edge snapping, persisted position and a
  visibility setting.
- Shadow-DOM settings panel with tabs, accordions, search, shortcut recorder,
  color/range/select/list controls, three locales, light/dark/system themes and
  a built-in reset action.
- Include/exclude site policies with host, glob, path-glob and regex rules plus
  an “enable on this site” recovery flow.
- Reusable `@element-shot/settings` library with declarative schema, dynamic
  field registration, custom field rendering, GM/localStorage/memory adapters
  and ESM + IIFE outputs.
- `gmFetchPlugin` that rewrites html-to-image `fetch` and `XMLHttpRequest` calls
  to a `GM_xmlhttpRequest` adapter for cross-origin images, CSS and fonts.
- Bilingual documentation, playground pages with GM stubs, unit/component tests,
  coverage thresholds, ESLint, `vue-tsc` and Prettier.

### Notes

- Verified in Chromium through the local playground: a 300 px scroll container
  produced a 754 × 1868 PNG containing all 24 rows; full-page capture produced
  a 2046 × 3358 PNG.
- Known limitations are listed in `README.md` and `README.en.md` (closed shadow
  roots, iframe internals, video/WebGL content, browser canvas limits).
