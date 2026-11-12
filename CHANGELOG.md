# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Full-page captures (`Ctrl+A`) use the width the page is laid out at, not the
  document's horizontal overflow. A page whose content sticks out sideways (a
  wide table, a review with an unbreakable string) produced a picture several
  times wider than the viewport — and, because the copy reflows when the root is
  widened, even wider than the page — with the content squeezed into the left
  quarter and viewport-fixed layers (`position: fixed; inset: 0`) stranded at
  the left edge instead of sitting behind the content. The capture keeps the
  viewport width and grows only in height; pick the overflowing element or drag
  a region when the horizontal part matters.
- Pages that only declare `color-scheme: dark` get the dark canvas they show in
  the browser (`#121212`) instead of a white fill, so their full-page capture is
  no longer white below the content.
- Full-page captures keep the page background colour. A `body` background is
  propagated to the browser's canvas instead of being painted on the body's own
  box, and a cloned `<html>` has no canvas to propagate it to, so a dark page
  came out white below the body box — usually just past the first viewport,
  which left white gaps around the content, a white footer with pale text, and
  white columns under a virtualised timeline. The canvas colour is now resolved
  from the root and body backgrounds and painted behind the clone.

### Added

- The “Frame depth” setting now drives rendering as well as picking. One number
  (1–6, still default 2) is used by both ends: the picker may pierce that many
  frame levels, and a capture paints that many levels of frames inside its root,
  so a layer picked in a third-level frame is no longer an empty box. The value
  travels with `render` and `capture` requests as an optional `maxDepth` — a build
  that predates it keeps the old two-level behaviour in either direction — and is
  clamped on both sides, because the number crosses realms. The parent's wait for
  a frame grows by five seconds per remaining level, since the frames nested below
  it are rendered inside that one answer; without that, a legitimate deep render
  would be mistaken for a silent frame and thrown away as an empty box.
- The picker reaches inside iframes. Hovering a frame asks it over the bridge which
  layers sit under the pointer, and those layers are appended to the page's own
  stack with their boxes shifted into the page viewport (the visible box clipped to
  the frame) and marked `帧内`. Wheel, arrow and `Shift` layer switching therefore
  keep walking out of the frame, and picking one captures that element alone: the
  frame renders it in its own realm, which is the only realm that can read a
  cross-origin document and the one that has the right fonts. The result is an
  ordinary picture of the element at its own size. A frame that cannot answer (no
  helper, still starting up, busy) is skipped for two seconds instead of making
  every mouse move wait, and the picker falls back to the frame itself.
- The picker can pierce more than one frame, up to “Frame depth” in the settings
  (1–6, default 2). A hover that lands on a frame is answered by that frame, which
  — if it finds one of *its* frames under the pointer — asks that frame in turn and
  merges the answer into its own coordinates. Layers below name the frames the
  answer travelled through, so picking one walks the same doors back down to the
  frame that owns the element and renders it there. Every extra level costs one
  more round trip inside that frame's own realm, which is why this is a setting
  instead of an unconditional recursion. The whole chain shares one deadline of
  250 ms, so a deep pick is never slower than a shallow one: each hop only gets
  what is left, and a hop with less than 40 ms left stops instead of adding
  another round trip. Layers show their level as `帧内×2`, `帧内×3`.
- Picking works with mouse passthrough on. With the transparent layer gone the
  pointer enters the frame and the top window stops seeing it, so a frame reports
  its pointer positions (and swallows the click, which is the capture gesture) while
  the picker is open; the top document replays each report into its own pointer
  handlers, which keeps one crosshair, one layer stack and one capture path. A
  nested frame's report is relayed by its parent the same way.
- The trigger shortcut works while the pointer focus is inside an iframe. A keydown
  fired in a frame never reaches the top document, so every frame now asks its
  parent for the shortcut over the bridge (`subscribe`), watches its own keys and
  reports a press (`trigger`) that the parent verifies against its current setting
  — a press matched against a shortcut that changed in the meantime is dropped.
  The frame is told the shortcut and nothing else, and the parent is told only that
  the shortcut was pressed, so neither side turns into a keylogger for the other.
  Frames nested inside a frame relay the press upward. Frames that never run the
  script (`about:blank`, `srcdoc`, a sandbox without scripts) still cannot report
  a key, and a shortcut pressed while the capture UI is open is still ignored.
- The shortcut setting moved to the **Trigger** tab (its own “Shortcut” group next
  to the floating button). It used to sit in a “Trigger” group inside the
  **Capture** tab, next to an identically named tab.
- Region captures include iframes: frames that intersect the dragged rectangle
  are rendered and painted into their own box before the panels are rebuilt and
  before the viewport render, so the rectangle no longer contains empty frame
  boxes. Painting them first also covers a frame that sits inside a scrolled panel:
  a rebuilt panel is turned into a picture with its children still in place and
  only then hides them, so a frame painted afterwards would end up on an invisible
  box and the picture would show an empty rectangle. A region capture stays
  what-you-see-is-what-you-get — the frames keep their current viewport and are
  never expanded — and cross-origin frames go through their helper as usual.
- Picking an iframe captures the whole frame, not the slice that happened to be
  visible: the frame document is treated as the root, so the copied frame box
  grows to its content size (the parent's layout reflows around it in the copy
  only) and the frame is rendered from the top at that size. A cross-origin
  frame's content size is reported by its helper (`measure` / `size` messages)
  because the parent cannot read that document. Picking an element that *contains*
  a frame keeps the frame's current viewport. The picker's capture box for an
  iframe now covers the frame's content too, so the dashed box already shows the
  size the capture will have.
- Cross-origin iframes are captured too. Every frame now runs a small copy of the
  script that renders its own document when the top page asks over
  `postMessage` (protocol version, per-request nonce, and every message sealed with
  a per-install key the page itself cannot read, so an embedding site can neither
  read the traffic nor use the helper to screenshot a frame it is not allowed to
  read). Same-origin frames use the same
  helper path, so a frame's own fonts and pixel ratio always apply; the parent
  still renders a frame locally when no helper answers (`about:blank`, `srcdoc`,
  sandboxed frames without scripts, or a frame that is still starting). `@noframes`
  is gone, and frames never mount the UI, menu commands or the settings panel.
- Same-origin iframes are captured: the frame's current viewport is rendered from
  a snapshot of the frame's own document (so its styles, scroll position and
  scrollbar layout are the frame's) and painted into the frame's box as a
  background layer. The page render still draws the frame's border, rounded
  corners and anything stacked on top of it, so the picture composites in the
  right order. Sticky elements inside the frame are pinned first — a clone has no
  scrollport, so a sticky header would otherwise be rasterized above the shifted
  viewport and disappear. Nested frames are painted recursively, as deep as the
  frame-depth setting allows, a frame that fails to render keeps its empty box,
  and the parent falls back to rendering a readable frame itself.
- The picker shows which layer scrolls: the solid frame is the element as seen on
  screen, a dashed frame appears when the capture will be larger, and a badge
  reads `可滚动 ↓Npx` / `→Npx` / `↕` for the active layer. `Shift`+wheel and
  `Shift`+`↑`/`↓` jump straight to the next scroll container.
- `capture.expandNested` (off by default): only the selected element's own
  scrollable content is expanded unless the setting is on.

### Changed

- Settings are stored as a versioned envelope, `{ version, value }`, in the one
  manager value the script already used. The schema generation therefore travels
  with the payload: a write can never leave data behind without its version, a
  migration can never run twice, and a value written by a newer script is left
  untouched instead of being interpreted with the old rules. The envelope holds
  only a number and a string, so every manager round-trips it identically. An
  existing bare value is read as generation 0 and upgraded on the next start.
  Downgrading to 0.7.x resets the settings once, because that version cannot read
  the new shape — the alternative was a version key that could never be written
  atomically with the data.
- The pointer setting is now the positive **Mouse passthrough** switch (default off)
  instead of “Isolate page interaction” (default on). The behaviour is unchanged —
  off keeps the transparent layer that keeps hover effects out of the capture — but
  a switch whose name matches the default no longer reads as a double negative. A
  stored value from the old switch is migrated as generation 1, so nobody's choice
  flips: `isolation: false` becomes `passthrough: true` and the legacy key is
  dropped.
- Frame renders are requested in parallel. Every frame renders in its own realm, so
  the parent no longer waits for one frame before asking the next: a page with
  several frames pays the slowest one instead of the sum. Frames that share a
  renderer process still share its thread, so the gain is largest across origins.
  Cancelling a capture now also tells every frame that was asked to stop, instead
  of leaving those renders running for a picture nobody will look at.
- The capture canvas is measured after expansion (`fitBoxToLayout()`), so growing
  a descendant can no longer crop the extra content away.
- `createSnapshot()` accepts a `doc` option and copies that document instead of
  the top page, which is what lets a frame be rendered on its own.

### Security

- Everything the frame bridge sends is sealed instead of carrying a shared install
  token. Each realm keeps one 32-byte key in the userscript storage and seals the
  whole body with XChaCha20-Poly1305 (`core/frame-crypto.ts`), so the wire only
  ever carries `{protocol, type, box}` — a message type, a nonce, ciphertext and a
  tag. A page can see that frames talk and how much they send, but not a
  coordinate, an element id, a DOM layer, a shortcut or a PNG, and it cannot forge
  a request without the key, which never leaves storage. The token model is gone:
  a frame's own page used to be able to read the token out of any downward message
  and reuse it later against a frame it embedded, which was a real chain. Sealing
  closes the upward direction too — presses and pointer reports travel encrypted —
  and a replayed message is now dropped by its sequence number instead of merely
  being useless. The protocol is `/7`; `/6` builds do not interoperate, so refresh
  every tab after upgrading (an old frame simply reads as “no helper”, which falls
  back safely).

### Fixed

- The picker installs its window listeners at document-start instead of when
  picking begins. `stopImmediatePropagation()` only stops listeners that run after
  it, so a page listening on `window` (capture) used to see the clicks the picker
  was meant to consume — and a page that swallowed them made picking silently do
  nothing. With the listeners in place first, the page neither sees the pick-time
  clicks nor can keep the picker from receiving them. `wheel` still joins only
  while picking: a permanent non-passive wheel listener would make every page's
  scrolling wait for JavaScript.
- An iframe that the parent has to render itself (no helper: `about:blank`,
  `srcdoc`, a sandbox without scripts, or one that is still starting up) now uses
  the frame's own webfonts. The embedder always read the stylesheets of the
  rendering realm, so a locally rendered frame got the top page's `@font-face`
  rules and its text fell back to a system face. The render now points the
  embedder at the frame's document (`native.fontSource`) and resolves relative
  `src` URLs against that document's base URL.
- Elements whose own webfont differs from the capture root's no longer lose it.
  html-to-image collects the font families its `@font-face` scan has to keep by
  walking element children with `instanceof HTMLElement`, and every capture
  renders a copy that lives in another realm, where that test is false for every
  node: the walk stopped at the root, so only the root's family was ever embedded
  and any descendant with its own font was rendered in a fallback face.
- `Esc` and the picker's other keys work when the picker was started from inside an
  iframe. A click inside a frame leaves the keyboard focus in that document, so
  every key press — including `Esc` — was dispatched there and the top window,
  where the picker listens, never saw it; the picker could only be left by clicking
  the page first. The focus is left alone: while the picker is open, a frame now
  reports the keys the picker consumes (`Esc`, `Enter`, arrows, `PageUp`/`PageDown`,
  `+`/`-`, `Tab`, `Ctrl+A`) over the same token-gated bridge, swallows them locally
  and the top document replays each one into its own listeners. Only those keys
  travel — no plain letters or digits — and the page never sees the replayed event.
- A cloned custom element no longer duplicates the shadow tree its constructor
  builds; the collected tree replaces it.

### Security

- A frame no longer hands the install token to the page that embeds it. Frames
  report presses and pointer positions upward (`subscribe`, `trigger`, `key`), and
  a message sent to the parent window is readable by the parent's own scripts —
  which is exactly the window the token has to stay hidden from. Every page that
  embedded a frame therefore learned the token from the first `subscribe` and could
  then ask the frame for a picture of itself: a cross-origin screenshot that the
  token was there to prevent. Upward messages now carry no token at all; downward
  requests still do, so a helper keeps refusing strangers. Losing the token also
  means those upward presses cannot be authenticated any more — a frame can open
  the picker or press a key the picker already handles, which is a nuisance, not a
  leak. The full model, including what still leaks and why it cannot be fixed in a
  userscript, is written down in `docs/frame-bridge-security.md`.

## [0.7.1] - 2026-11-10

### Fixed

- Rules that a component adds to a `<style>` inside its own shadow root at
  runtime (through `CSSStyleSheet.insertRule()`, or removes with `deleteRule()`)
  are now replayed in the snapshot. Only the CSSOM holds them, so the cloned
  `<style>` text was stale: the copy laid the component out with the rules it had
  at parse time, and a capture of that component lost its padding and background.
  Nested shadow roots are covered too. Measured on the new playground fixture: the
  same capture had 0 pixels of the runtime-injected background before and 385,960
  after.
- An emptied light-DOM stylesheet now clears its cloned text as well, instead of
  leaving the rules that `deleteRule()` had removed.

## [0.7.0] - 2026-11-10

### Added

- The settings footer now carries the project links: the version sits next to
  GitHub and Greasyfork icons that open the project page and the Greasyfork
  listing in a new tab. The settings library takes them as an option
  (`links: [{ id, label, href, icon }]`), so the panel stays reusable.
- Finished captures open in a centred result viewer instead of over the element
  selection frame. The image is fitted to the viewport on a dimmed backdrop, the
  bar underneath keeps the size, copy / save / close buttons and the keyboard
  hints, and a transparent capture gets a checkerboard behind it. A failed render
  shows the reason in the same viewer.
- The result preview zooms. Clicking the image toggles between the fitted view and
  3× (the cursor is `zoom-in` / `zoom-out`, so the click target is obvious), the
  wheel steps the zoom continuously while keeping the point under the pointer in
  place, `+` / `-` take coarser keyboard steps and `0` goes back to fit. The fit
  size is a hard floor. A zoomed capture can be dragged to pan, clamped so it never
  leaves its viewport, and the bar shows the current image scale as a percentage.
  The bar keeps the action buttons on the far right and the keyboard / pointer
  hints to their left.

### Changed

- The selection frame is now drawn only while picking. Since the page can be
  scrolled and edited while a capture renders, the frame measured at pick time is
  usually stale by the time the image is ready — the result is shown on its own
  instead. The result stays modal: clicks, wheels and shortcuts on the page are
  blocked until it is closed, exactly like the old result bar.
- The preview is closed from a large (×) button in the top-right corner, the Close
  button in the bar, or `Esc`. Clicking the backdrop no longer closes it: a render
  can take a while, and a stray click should not throw the result away.
- Double-click-to-save is gone. The result is now a full-screen modal, so the page
  never sees the double click; `Ctrl+S` and the Save button cover the same case.

### Fixed

- The result preview falls back to a data URL when the page's `img-src` policy
  rejects `blob:` URLs, which would otherwise leave the viewer blank on strict
  sites. The fallback only runs after the blob URL actually fails to load.

## [0.6.0] - 2026-11-10

### Changed

- Captures render from an isolated copy of the page instead of mutating the live
  one. `core/snapshot.ts` clones the document into an off-screen same-origin
  iframe — stripping scripts, rebuilding open shadow roots, freezing
  `<canvas>`/`<video>` pixels into images, replaying scroll offsets and form
  state — and the existing pipeline then expands scroll containers, rebuilds
  scrolled panes and renders against that copy. The page is only read, so it
  stays usable, visually intact and interactive for the whole render, and there
  is nothing to restore afterwards.
- While a capture renders the UI is a single "rendering" chip with a cancel
  button instead of the full picker overlay; the page underneath keeps taking
  clicks, typing and scrolling. The result panel appears when the image is ready.
- Cancelling is now real: the clone loop checks a cancel flag between chunks and
  unwinds the render, which is only safe because the live page was never touched.

### Fixed

- Interacting with the page during a capture can no longer corrupt the result:
  the render works on a frozen copy, so late clicks, hovers and DOM updates do
  not leak into the image.
- A second capture no longer has to wait for a previous render to restore page
  styles.
- The capture now renders the frame the picker showed. The snapshot is a copy, so
  re-measuring it could differ from the page by a pixel or two (a webfont that
  landed late, a different scrollbar); the box measured on the live element wins,
  and a mismatch is logged.
- The snapshot replays the page's **CSSOM** into the copy instead of copying the
  `<style>` markup. A page that adds rules with `CSSStyleSheet.insertRule()` keeps
  them out of the markup entirely — x.com adds ~1000 atoms that way (paddings,
  margins, flex directions) — so the copy laid the page out with the wrong box
  metrics even though it looked styled. On x.com the copied article now measures
  exactly like the page (598×602, `padding: 0 16px`, avatar at `(16, 12)`), and
  the properties that decide layout are compared with the page and reported when
  they still disagree.
- The snapshot forces a layout before waiting for `document.fonts.ready`, and
  keeps re-checking until the font set reports `loaded`. A fresh iframe has not
  requested its `@font-face` files yet, so `fonts.ready` could resolve
  immediately and freeze the render on fallback metrics — which shifts text by a
  line and changes the element's measured height.
- The snapshot iframe is attached to `<html>` instead of `<body>`, so pages that
  watch the body for overlays do not re-render when a capture starts.

## [0.5.0] - 2026-11-09

### Added

- The floating capture button docks to a viewport edge. Dropped within 10px of an
  edge it sits flush, parks half of itself outside the viewport at reduced
  opacity, and slides fully back in — opaque again — while the pointer is on it.
  The docked edge is stored next to the position, so a reload keeps it parked.
  Hover is derived from the pointer position (not `pointerenter`/`pointerleave`),
  because a pointer capture suppresses enter/leave and used to leave the button
  parked under the cursor after a drag.

### Changed

- The button only snaps when the drop is really at an edge: the old 48px snap
  distance is gone (`DOCK_DISTANCE` = 10px). A drop further inside stays exactly
  where it was released instead of jumping to the margin.
- Rendering yields to the event loop while it clones the page. html-to-image
  clones the subtree and inlines every node's computed style in one
  uninterrupted microtask chain, which froze the tab for as long as the clone
  took; the clone now hands the event loop back after ~8 ms of DOM work
  (`scheduler.yield`, then a `MessageChannel` task, then a timer). On the region
  playground this cut the longest blocking task from ~640 ms to ~220 ms and the
  total blocking time by ~60%, with identical pixels and no change in total
  duration.

## [0.4.0] - 2026-11-09

### Added

- Drag a rectangle on the page to capture exactly that region. The region is
  rendered from the live viewport, so scrolled containers, sticky headers and
  fixed overlays appear where they are on screen, and the result is cropped to
  the dragged box at the configured export scale.

### Changed

- Region capture now rebuilds each scrolled container separately instead of
  replaying a single scroll chain on the page root. Every container that
  intersects the region is rendered once as its own "current scroll view", then
  painted back as that container's first background layer before the viewport is
  rendered and cropped. Several independent panes, nested panes and panes with
  borders, rounded corners or gradient backgrounds therefore all keep their own
  scroll offset, and no descendant element is repositioned while the clone is
  built.
- The webfont CSS is resolved once per capture and shared by every render, which
  keeps a multi-pane region from re-inlining the same fonts over and over.
- The old single-chain replay (`core/scroll-replay.ts`, `mode: 'chain'`) is gone;
  region capture has one rendering path now.

### Fixed

- Region captures no longer show a stale scrollbar at scroll offset zero on
  every scrolled container.
- Region captures no longer leak a container's border arc into the rebuilt
  picture when the container is scrolled.
- A second copy of the script (two installs, or a local build injected next to
  the manager's copy) no longer opens a second UI that fights the first one over
  the same pointer events; the first instance to mount wins.

## [0.3.3] - 2026-11-08

### Fixed

- Elements that are moved into place by the page are no longer captured with
  their content shifted and clipped. The clone root now drops a translation-only
  `transform` and a `fixed`/`absolute`/`sticky` inset, so it starts at the crop
  origin instead of inheriting the element's on-page position. XiaoHongShu's note
  detail modal, which is positioned with `transform: translate(...)`, lost its
  whole comment column before this fix.

## [0.3.2] - 2026-11-08

### Changed

- Release assets are now named `script.user.js` and `script.meta.js` so
  Greasyfork's GitHub webhook can sync the latest release automatically.

## [0.3.1] - 2026-11-08

### Fixed

- The Greasyfork upload is no longer rejected as a minified script. Production
  builds now keep readable JavaScript and format Tailwind's inlined CSS into
  multiple lines instead of one long minified string.

## [0.3.0] - 2026-11-08

### Changed

- Renamed the project from **Element Shot** to **Element Screenshot** across the
  userscript name, package names, build output, data attributes, log prefixes
  and documentation.
- Added localized userscript metadata for Simplified Chinese and Traditional
  Chinese names/descriptions using `vite-plugin-monkey` locale objects. The
  default name is English, and the namespace, homepage and support URLs now
  point at the GitHub repository.
- Added GitHub Actions CI for pushes and pull requests, plus a tag-driven
  release workflow whose release notes are extracted from this changelog.

## [0.2.10] - 2026-11-07

### Fixed

- SVG logos and icons whose `fill`, `stroke` or related paint attributes use
  CSS custom properties (for example DeepSeek’s
  `fill="var(--dsw-alias-brand-primary)"`) no longer disappear or turn black in
  captures. These attributes are resolved to their computed paint values while
  the clone is built, then restored on the live page.

## [0.2.9] - 2026-11-06

### Added

- Gradients and background images on the page root or `body` are now rendered
  into an offscreen background layer at the target crop’s position and size,
  then composited behind the element. The previous single canvas color could not
  represent a background whose color changes across the capture. The layer keeps
  the original background box, size, position, repeat and attachment semantics.

### Changed

- The capture pipeline runs a second html-to-image pass only when a complex
  page background is present; solid backgrounds still use the fast single-color
  path.
- If the backdrop scene cannot be rendered, the capture falls back to the solid
  backdrop color.

## [0.2.8] - 2026-11-06

### Fixed

- Dark pages whose background lives on `body` no longer produce a white
  capture. `document.elementsFromPoint()` can omit a zero-height `body` even
  though its background paints the canvas, and `resolveBackdropColor()` used to
  start from a fixed white base when that happened. The root and body colors are
  now composited as the page base, so DeepSeek’s `#151517` backdrop is preserved
  and its sticky-header cover blends into the capture.
- The root/body backgrounds are skipped in the paint-stack loop when the hit
  test already returns them, avoiding double compositing.

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
- Reusable `@element-screenshot/settings` library with declarative schema, dynamic
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
