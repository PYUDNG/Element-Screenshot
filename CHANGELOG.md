# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.7] - 2026-11-06

### Fixed

- Element captures now match the picker’s selection box when the target has
  margins. The capture box is the border box, but the cloned root kept its own
  `margin`, shifting buttons such as asmr.one’s `button.q-btn` down-right and
  cropping their edge. The root margin is now cleared for every capture.
- Inline-level roots (`inline-flex`, `inline-block`, `inline-grid`, …) are
  rendered with their block-level equivalent, so they no longer sit inside a
  line box that offsets the crop.

## [0.2.6] - 2026-11-06

### Fixed

- Captures of inline elements such as `<b>` no longer look washed out when
  their contrast comes from a fixed page background. The backdrop now uses the
  actual paint stack at the element, including non-ancestor background layers
  and darkening masks, and samples the average color of readable background
  images (for example wenku8’s fixed background plus its 60% black mask).
- Inline elements are rendered as blocks on an extra font-size of height during
  capture. Their original 12px border box sits inside a line box whose strut
  pushed the glyphs below the crop, so the screenshot only contained the tops
  of the characters.

## [0.2.5] - 2026-11-06

### Fixed

- Cross-origin videos no longer abort a capture with
  `SecurityError: Tainted canvases may not be exported`. html-to-image drew the
  video frame onto a canvas and exported it with `toDataURL()`; when the video
  came from another origin without CORS, that export threw. The frame is used
  when exportable; otherwise the poster is used, and a missing poster becomes a
  transparent placeholder.
- Page canvases that were already tainted by cross-origin drawing now fall back
  to an empty clone instead of throwing during `toDataURL()`.

## [0.2.4] - 2026-11-06

### Fixed

- `<noscript>` blocks are excluded from captures. While page scripting is
  enabled they are invisible, but html-to-image rasterizes the clone inside an
  SVG image document where scripting is disabled, so Google’s no-script
  redirect hint was rendered as visible text above the page content.

## [0.2.3] - 2026-11-05

### Fixed

- Full-page captures no longer abort when a page contains an image without a
  `src` attribute, such as a lazy-loading placeholder. html-to-image tried to
  inline the empty URL, failed, assigned an empty `src`, and rejected the whole
  capture on the resulting `error` event. Google Search results pages contain
  several such images. Failed images now fall back to a transparent pixel and
  are skipped individually instead of aborting the screenshot.
- SVG captures now bind namespace prefixes that HTML allows but XML requires to
  be declared. Google Search adds `wiz:wakeup` attributes without an
  `xmlns:wiz` declaration, which produced “Attribute wiz:wakeup prefix is
  unbound”. Every prefix used by the cloned tree is now declared on the SVG
  root (well-known prefixes such as `xlink` keep their standard URI), so the
  XML parser accepts the wrapper.
- Attribute names that are not valid XML QNames (more than one colon, a leading
  colon) are stripped before serialization instead of producing a parser error.
- Image embedding now has bounded waits: 15 seconds for the resource fetch and
  8 seconds for the image decode. A stalled tracker image can no longer leave
  the picker stuck on “rendering” forever; that image is skipped instead.
  GM requests themselves also time out after 20 seconds.
- Captures started in a background or occluded tab no longer hang on
  “rendering”. `requestAnimationFrame` callbacks are paused in those tabs, so
  the two-frame layout wait now falls back to a 100 ms timer, and html-to-image
  resolves the finished SVG after decode instead of waiting for an animation
  frame.
- Protocol-relative stylesheet URLs such as `//fonts.gstatic.com/...` are
  resolved against the page before calling `GM_xmlhttpRequest`. The manager
  needs an absolute URL; passing the original value could leave the request
  waiting without a callback.

## [0.2.2] - 2026-11-05

### Fixed

- X/Twitter full-page captures no longer fail on HTML-only attribute names
  such as `$bgcolor`. `XMLSerializer` copied them into the SVG wrapper, where
  `$` is illegal in an XML attribute name, so Chromium rejected the image.
  Invalid XML attribute names are now stripped from the cloned SVG tree before
  serialization; valid names such as `data-testid` and `xlink:href` are kept.

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
