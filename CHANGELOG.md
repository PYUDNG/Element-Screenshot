# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

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
