import { getFontEmbedCSS, toBlob } from 'html-to-image'
import { captureBackdropScene, hasComplexBackground } from './backdrop-scene'
import { resolveBackdropColor } from './background'
import { blobToDrawable, canvasToBlob } from './canvas'
import { native } from './native'
import { clampRegion } from './region'
import type { Point, ViewportSize } from './region'
import { planCrop, cropBlob } from './crop'
import { createSnapshot } from './snapshot'
import type { FrameRecord } from './snapshot'
import {
  FRAME_RESULT_TIMEOUT,
  probeFrameHelpers,
  requestFrameImage,
  requestFrameSize
} from './frame-bridge'
import { frameLevels } from './frame-levels'
import {
  frameContentSize,
  frameElementViewport,
  frameOuterSize,
  frameScroll,
  frameViewport
} from './frame-size'
import type { FrameSize } from './frame-size'
import {
  blobToDataUrl,
  collectFixedDescendants,
  collectScrollSlices,
  collectSliceSticky,
  hideSliceContent,
  isScrollContainer,
  isSticky,
  kebabCase,
  pinSticky,
  restoreStyle,
  scrollportMetrics,
  setImportant,
  sliceBackgroundStyle,
  sliceRootStyle,
  snapshotStyle
} from './scroll-slice'
import type { ScrollportMetrics, SliceDocument } from './scroll-slice'
import { getTargetBox } from './target'
import type { TargetBox } from './target'

/** How the backdrop behind a captured element is painted. */
export interface CaptureBackground {
  /** Follow the page backdrop, use one color, or leave the pixels transparent. */
  mode: 'page' | 'color' | 'transparent'
  /** Color used when `mode` is `color`. */
  color?: string
}

export interface CaptureOptions {
  expandNested?: boolean
  /**
   * How many levels of iframes inside the captured root are painted.
   *
   * The setting is shared with the picker, so a layer the picker can reach is
   * also rendered; see `core/frame-levels.ts`. Every level is one more full
   * render, which is why the default stays low.
   */
  maxDepth?: number
  /** Element capture backdrop. Region capture uses `backgroundColor` instead. */
  background?: CaptureBackground
  backgroundColor?: string
  /**
   * Element box measured on the live element, i.e. the frame the picker drew.
   * The snapshot is a copy, so its layout can differ by a pixel or two (font
   * metrics, scrollbars); the capture has to use the frame the user approved
   * instead of re-measuring the copy.
   */
  box?: TargetBox
  pixelRatio?: number
  maxDimension?: number
  maxArea?: number
  filter?: (node: HTMLElement) => boolean
  /**
   * Font CSS already inlined for this capture. html-to-image resolves the
   * webfonts of the document on every call, which dominates a capture that
   * renders several slices of the same page.
   */
  fontEmbedCSS?: string
}

export interface CaptureResult {
  blob: Blob
  /** Rendered pixel size. */
  width: number
  height: number
  /** Effective pixel ratio after canvas-limit downscaling. */
  scale: number
  limited: boolean
  sourceWidth: number
  sourceHeight: number
}

export interface CaptureScalePlan {
  width: number
  height: number
  ratio: number
  limited: boolean
}

export interface RegionCaptureOptions extends CaptureOptions {
  /** Precomputed slice targets, mainly useful for tests. */
  slices?: Element[]
}

const DEFAULT_MAX_DIMENSION = 16_384
const DEFAULT_MAX_AREA = 268_435_456
const ERROR_SOURCE_LIMIT = 512
/**
 * Extra time one more frame level gets on top of the render budget.
 *
 * A frame renders in the helper's realm, and its own frames render inside that
 * call, so the parent's wait has to cover the whole chain below it. Level 1 of a
 * six-level capture therefore waits `FRAME_RESULT_TIMEOUT` plus five of these:
 * a deep chain that takes a few seconds per level must not be mistaken for a
 * silent frame, which would throw away the whole subtree as an empty box.
 */
const FRAME_LEVEL_TIMEOUT = 5_000
/** Guard rail for the sticky scan inside a frame. */
const MAX_STICKY_SCAN = 6_000
/** Shared by the clone loop in the build patch and by `assertNotCancelled()`. */
const CANCEL_MESSAGE = 'Capture cancelled'
const NON_RENDERING_TAGS = new Set(['SCRIPT', 'NOSCRIPT'])
const SVG_PAINT_ATTRIBUTES = [
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'color',
  'solid-color',
  'fill-opacity',
  'stroke-opacity',
  'opacity'
] as const

/**
 * html-to-image inlines every `<img>` whose `src` is not a data URL. Pages with
 * lazy-loaded or tracking images often have `<img>` elements without a `src`
 * (Google Search has several), so it calls `fetch('')`, fails, assigns an empty
 * `src`, and rejects the entire capture on the resulting `error` event.
 *
 * A transparent placeholder gives those images a valid data URL; the error
 * handler below keeps a single broken image from aborting the whole capture.
 */
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

function formatBytes(length: number): string {
  if (length < 1024) return `${length} B`
  if (length < 1024 * 1024) return `${Math.round(length / 1024)} KB`
  return `${(length / (1024 * 1024)).toFixed(1)} MB`
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * Scripts and noscript blocks never render while page scripting is enabled.
 * Keeping them out of the clone also avoids embedding arbitrary inline
 * JavaScript into the SVG wrapper, which may contain control characters that
 * are illegal in XML. A cloned `<noscript>` is worse: the SVG image document
 * used for rasterization has scripting disabled, so the browser renders its
 * fallback markup and redirect hint as visible text at the top of the capture.
 */
export function shouldCaptureNode(node: HTMLElement): boolean {
  return !NON_RENDERING_TAGS.has(node.tagName?.toUpperCase())
}

/**
 * Resolve instead of rejecting when an individual image cannot be decoded, so
 * the rest of the page is still captured. The image keeps its layout box and
 * simply stays blank.
 */
export function handleImageError(event: Event | string): void {
  if (typeof event === 'string') {
    console.warn('[element-screenshot] image skipped:', truncate(event, ERROR_SOURCE_LIMIT))
    return
  }
  const target = event.target as HTMLImageElement | null
  const source = target?.currentSrc || target?.src || ''
  console.warn(
    '[element-screenshot] image skipped:',
    source ? truncate(source, ERROR_SOURCE_LIMIT) : '(no source)'
  )
}

/**
 * Ask the running capture to stop. The clone loop checks the flag between
 * chunks and throws, which unwinds the render and disposes the snapshot; there is
 * nothing to restore on the live page.
 */
export function cancelCapture(): void {
  native.capture.aborted = true
}

function assertNotCancelled(): void {
  if (native.capture.aborted) throw new Error(CANCEL_MESSAGE)
}

/** Turn html-to-image's bare image events into an actionable message. */
export function describeCaptureError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name

  if (error instanceof Event) {
    const target = error.target as HTMLImageElement | null
    if (target?.tagName?.toUpperCase() === 'IMG') {
      const source = target.currentSrc || target.src || ''
      if (source.startsWith('data:image/svg+xml')) {
        return `Inline SVG image failed to load (${formatBytes(source.length)} data URL)`
      }
      if (source) return `Image failed to load: ${truncate(source, ERROR_SOURCE_LIMIT)}`
    }
    return `Browser event error: ${error.type || 'unknown'}`
  }

  return String(error)
}

/** Fit a capture inside the browser's canvas limits without exceeding them. */
export function computeCaptureScale(
  width: number,
  height: number,
  requestedRatio: number,
  maxDimension = DEFAULT_MAX_DIMENSION,
  maxArea = DEFAULT_MAX_AREA
): CaptureScalePlan {
  const safeWidth = Math.max(1, Math.ceil(width))
  const safeHeight = Math.max(1, Math.ceil(height))
  const requested = Math.max(0.001, requestedRatio)

  const byDimension = Math.min(maxDimension / safeWidth, maxDimension / safeHeight)
  const byArea = Math.sqrt(maxArea / (safeWidth * safeHeight))
  const ratio = Math.max(0.001, Math.min(requested, byDimension, byArea))
  const rounded = Math.floor(ratio * 1000) / 1000

  return {
    width: safeWidth,
    height: safeHeight,
    ratio: rounded,
    limited: rounded < requested - 0.0005
  }
}

/**
 * SVG presentation attributes are cloned as attributes, not as computed
 * styles. A value such as `fill="var(--brand)"` therefore loses its definition
 * when the clone is detached from the themed ancestor, and the paint falls back
 * to black. Resolve those attributes to their computed paint values while the
 * clone is built, then restore the page exactly afterwards.
 */
export function inlineSvgPaintVariables(root: Element): () => void {
  const snapshots: Array<{ element: Element; name: string; value: string }> = []
  const svgRoots: Element[] = []
  if (root.tagName?.toUpperCase() === 'SVG') svgRoots.push(root)
  for (const svg of Array.from(native.querySelectorAll(root, 'svg'))) svgRoots.push(svg)

  for (const svg of svgRoots) {
    for (const element of [svg, ...Array.from(native.querySelectorAll(svg, '*'))]) {
      for (const name of SVG_PAINT_ATTRIBUTES) {
        const value = native.getAttribute(element, name)
        if (!value || !value.includes('var(')) continue
        let computed: string
        try {
          computed = native.getComputedStyle(element).getPropertyValue(name).trim()
        } catch {
          continue
        }
        if (!computed || computed.includes('var(') || computed === value) continue
        snapshots.push({ element, name, value })
        native.setAttribute(element, name, computed)
      }
    }
  }

  return () => {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index]
      if (!snapshot) continue
      native.setAttribute(snapshot.element, snapshot.name, snapshot.value)
    }
  }
}

interface StyleSnapshot {
  element: Element
  style: string | null
  scrollTop: number
  scrollLeft: number
}

/** Scrollable descendants that clip content, collected before any mutation. */
export function collectScrollTargets(root: Element): Element[] {
  const doc = root.ownerDocument
  const targets: Element[] = [root]
  if (root === doc.documentElement && doc.body) targets.push(doc.body)

  let visited = 0
  for (const element of Array.from(native.querySelectorAll(root, '*'))) {
    if (visited >= 6000) break
    visited += 1
    if (isScrollContainer(element)) targets.push(element)
  }

  return Array.from(new Set(targets))
}

const MATRIX_TOLERANCE = 0.001

function near(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= MATRIX_TOLERANCE
}

export interface TranslationOffset {
  x: number
  y: number
}

function parseNumbers(value: string): number[] | null {
  const numbers = value.split(',').map((item) => Number(item.trim()))
  return numbers.every((item) => Number.isFinite(item)) ? numbers : null
}

/**
 * A computed `transform` that only moves the element has an identity linear
 * part. Scaling, rotation and skew are layout-visible and must be kept, so they
 * are reported as unsupported and left untouched.
 */
export function pureTranslation(transform: string | undefined | null): TranslationOffset | null {
  const value = (transform ?? '').trim()
  if (!value || value === 'none') return null

  const flat = /^matrix\(\s*([^)]*)\)$/.exec(value)
  if (flat) {
    const numbers = parseNumbers(flat[1] ?? '')
    if (!numbers || numbers.length !== 6) return null
    const [a, b, c, d, e, f] = numbers as [number, number, number, number, number, number]
    if (!near(a, 1) || !near(d, 1) || !near(b, 0) || !near(c, 0)) return null
    return { x: e, y: f }
  }

  const spatial = /^matrix3d\(\s*([^)]*)\)$/.exec(value)
  if (spatial) {
    const numbers = parseNumbers(spatial[1] ?? '')
    if (!numbers || numbers.length !== 16) return null
    const at = (index: number): number => numbers[index] ?? Number.NaN
    const identity =
      near(at(0), 1) &&
      near(at(1), 0) &&
      near(at(2), 0) &&
      near(at(3), 0) &&
      near(at(4), 0) &&
      near(at(5), 1) &&
      near(at(6), 0) &&
      near(at(7), 0) &&
      near(at(8), 0) &&
      near(at(9), 0) &&
      near(at(10), 1) &&
      near(at(11), 0)
    return identity ? { x: at(12), y: at(13) } : null
  }

  return null
}

/**
 * html-to-image renders the clone as the only child of an SVG `foreignObject`
 * whose origin is the crop origin, but it copies the element's computed
 * placement onto that clone. Anything that moved the element on the page —
 * a transform translation, or a fixed/absolute inset — therefore moves the
 * whole clone inside the crop, and the overflowing part is cut off.
 *
 * XiaoHongShu lays its note modal out at the top-left corner and slides it into
 * place with `transform: translate(...)`, so the clone was shifted by the same
 * offset and lost the entire comment column.
 *
 * Only placement is reset: dimensions, scale and internal transforms stay as
 * they are, because they define what the crop is supposed to contain.
 */
export function rootPlacementStyle(
  computed: CSSStyleDeclaration | null | undefined
): Partial<CSSStyleDeclaration> {
  const style: Partial<CSSStyleDeclaration> = { margin: '0' }
  if (!computed) return style

  const position = computed.position
  if (position && position !== 'static') {
    // `relative` keeps a containing block for absolutely positioned
    // descendants while putting the element itself back at the crop origin.
    style.position = 'relative'
    style.inset = 'auto'
  }

  const offset = pureTranslation(computed.transform)
  if (offset && (offset.x !== 0 || offset.y !== 0)) {
    style.transform = 'none'
  }

  return style
}

function expandElement(element: Element, box: TargetBox, doc: Document): void {
  const isRoot = element === doc.documentElement
  const isBody = element === doc.body

  setImportant(element, 'overflow', 'visible')
  setImportant(element, 'overflow-x', 'visible')
  setImportant(element, 'overflow-y', 'visible')
  setImportant(element, 'max-height', 'none')
  setImportant(element, 'max-width', 'none')
  setImportant(element, 'scrollbar-width', 'none')

  if (isRoot || isBody) {
    setImportant(element, 'height', 'auto')
    if (isRoot) {
      setImportant(element, 'width', `${Math.max(1, Math.ceil(box.width))}px`)
    }
  } else {
    setImportant(element, 'height', `${Math.max(1, Math.ceil(box.height))}px`)
    if (element.scrollWidth > element.clientWidth + 1) {
      setImportant(element, 'width', `${Math.max(1, Math.ceil(box.width))}px`)
    }
  }

  if (element === doc.documentElement) {
    setImportant(element, 'min-height', '0')
  }

  try {
    element.scrollTop = 0
    element.scrollLeft = 0
  } catch {
    // Some SVG elements do not support scroll offsets.
  }
}

/**
 * The copy can lay out taller (or wider) than the live page measured: expanding
 * the root reveals its own overflow, and nested expansion grows the root through
 * a descendant. Grow the box with the layout. Anything but the document itself
 * also gets an explicit size, otherwise its background and border would stop
 * where the old box ended and the extra content would spill out of them.
 */
function fitBoxToLayout(element: Element, box: TargetBox): TargetBox {
  const measured = getTargetBox(element)
  const width = Math.max(box.width, measured.width)
  const height = Math.max(box.height, measured.height)
  if (width === box.width && height === box.height) return box

  if (element !== element.ownerDocument.documentElement) {
    if (height > box.height) {
      setImportant(element, 'height', `${Math.max(1, Math.ceil(height))}px`)
    }
    if (width > box.width) {
      setImportant(element, 'width', `${Math.max(1, Math.ceil(width))}px`)
    }
  }

  return { ...box, width, height }
}

function expandForCapture(root: Element, box: TargetBox, expandNested: boolean): () => void {
  const doc = root.ownerDocument
  const snapshots: StyleSnapshot[] = []
  const saved = new Set<Element>()
  const targets = expandNested ? collectScrollTargets(root) : [root]

  if (root === doc.documentElement && doc.body && !targets.includes(doc.body)) {
    targets.push(doc.body)
  }

  for (const element of targets) {
    if (saved.has(element)) continue
    saved.add(element)
    snapshots.push({
      element,
      style: element.getAttribute('style'),
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft
    })
    expandElement(
      element,
      element === root ? box : { ...box, width: element.scrollWidth, height: element.scrollHeight },
      doc
    )
  }

  return () => {
    for (let index = snapshots.length - 1; index >= 0; index -= 1) {
      const snapshot = snapshots[index]
      if (!snapshot) continue
      const { element } = snapshot
      if (snapshot.style === null) {
        element.removeAttribute('style')
      } else {
        element.setAttribute('style', snapshot.style)
      }
      try {
        element.scrollTop = snapshot.scrollTop
        element.scrollLeft = snapshot.scrollLeft
      } catch {
        // Ignore unsupported scroll containers.
      }
    }
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer = 0
    const finish = (): void => {
      if (settled) return
      settled = true
      native.clearTimeout(timer)
      resolve()
    }
    // Background and occluded tabs do not run requestAnimationFrame callbacks.
    // Fall back to a timer so a capture started in such a tab cannot hang here.
    timer = native.setTimeout(finish, 100)
    if (typeof native.requestAnimationFrame === 'function') {
      native.requestAnimationFrame(finish)
    }
  })
}

async function compositeScene(
  scene: Blob,
  content: Blob,
  width: number,
  height: number
): Promise<Blob> {
  const canvas = native.document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = native.canvas.getContext(canvas)
  if (!context) throw new Error('Canvas 2D context is unavailable')

  const [background, foreground] = await Promise.all([
    blobToDrawable(scene),
    blobToDrawable(content)
  ])
  try {
    native.canvas.drawImage(context, background.source, 0, 0, width, height)
    native.canvas.drawImage(context, foreground.source, 0, 0, width, height)
  } finally {
    background.close()
    foreground.close()
  }

  return canvasToBlob(canvas)
}

/**
 * Resolve the webfont CSS for a render of `root`.
 *
 * The fonts are read from `native.fontSource`, which is the document this realm
 * renders with its own stylesheets unless a frame render points it elsewhere.
 */
async function resolveFontEmbedCSS(root: HTMLElement): Promise<string | undefined> {
  try {
    return await getFontEmbedCSS(root, { cacheBust: false })
  } catch (error) {
    console.warn('[element-screenshot] font embedding failed:', describeCaptureError(error))
    return undefined
  }
}

/**
 * Resolve the page webfont CSS once so every render of one capture reuses it.
 * html-to-image would otherwise walk all stylesheets and re-inline the same
 * fonts for each slice.
 */
async function sharedFontEmbedCSS(
  root: HTMLElement,
  options: CaptureOptions
): Promise<string | undefined> {
  if (options.fontEmbedCSS) return options.fontEmbedCSS
  return resolveFontEmbedCSS(root)
}
/**
 * Decide how the backdrop behind an element is painted.
 *
 * A solid page color can be handed to the canvas fill. A gradient or image
 * backdrop cannot, so it is rendered as its own layer (inside the snapshot) and
 * composited behind the element afterwards.
 */
async function resolveBackground(
  element: Element,
  box: TargetBox,
  plan: CaptureScalePlan,
  options: CaptureOptions
): Promise<{ color?: string; scene?: Blob }> {
  const background = options.background
  if (!background || background.mode === 'transparent') return {}
  if (background.mode === 'color') return { color: background.color ?? '#ffffff' }

  const baseColor = resolveBackdropColor(element)
  if (!hasComplexBackground(element)) return { color: baseColor }
  const scene = await captureBackdropScene(element, box, plan.ratio, baseColor)
  return scene ? { scene } : { color: baseColor }
}

/**
 * A frame is rendered the same way the region capture renders the page: the
 * clone never carries the scroll offset, so the root is shifted by it.
 */
function frameRootStyle(scroll: Point): Partial<CSSStyleDeclaration> {
  return {
    margin: '0',
    position: 'relative',
    inset: 'auto',
    top: `${-scroll.y}px`,
    left: `${-scroll.x}px`,
    transform: 'none'
  }
}

/**
 * Pin the sticky descendants of a frame.
 *
 * A clone has no scrollport, so `position: sticky` is laid out at its static
 * position — for a header pinned to the top of a scrolled frame that position is
 * above the shifted viewport, and the header disappears from the picture. Pinning
 * has to happen while the copy still sits at the frame's scroll offset, which is
 * what the offsets below are measured against.
 */
function pinFrameSticky(root: Element): void {
  let inspected = 0
  for (const element of Array.from(native.querySelectorAll(root, '*'))) {
    if (inspected >= MAX_STICKY_SCAN) break
    inspected += 1
    if (!isSticky(element)) continue
    pinSticky(element)
  }
}

/** Frames html-to-image will paint: the ones inside the clone root. */
function framesInside(root: Element, frames: readonly FrameRecord[]): FrameRecord[] {
  return frames.filter((frame) => frame.copy === root || root.contains(frame.copy))
}

/** Frames whose box intersects the dragged rectangle, in viewport coordinates. */
function framesInRegion(frames: readonly FrameRecord[], region: TargetBox): FrameRecord[] {
  return frames.filter((frame) => {
    let rect: DOMRect
    try {
      rect = native.getBoundingClientRect(frame.copy)
    } catch {
      return false
    }
    return (
      rect.right > region.left &&
      rect.left < region.left + region.width &&
      rect.bottom > region.top &&
      rect.top < region.top + region.height
    )
  })
}

/** The copied frame's box, or null when it is collapsed and paints nothing. */
function frameBoxSize(copy: HTMLIFrameElement): FrameSize | null {
  let rect: DOMRect
  try {
    rect = native.getBoundingClientRect(copy)
  } catch {
    return null
  }
  const width = Math.round(rect.width)
  const height = Math.round(rect.height)
  if (width < 1 || height < 1) return null
  return { width, height }
}

/**
 * Render a frame's current viewport, or its whole document when `expand` is set.
 *
 * The document is copied into an off-screen iframe of the same size, so the copy
 * lays out exactly like the frame; the surface is the frame's viewport and the
 * root is shifted by the frame's scroll, because a clone carries neither. The
 * frames nested inside are painted first: their pictures land in this one.
 *
 * An expanded frame is the "select the frame itself" case: its document is the
 * root, so the surface is the size the parent reserved for it and the content is
 * rendered from the top with the root expanded — the same thing that happens to a
 * scrollable element, one level down.
 *
 * This runs in whichever realm can read the document: the frame's own copy of the
 * script (the accurate path, and the only one for a cross-origin frame) or, as a
 * fallback, the parent.
 */
export async function renderFrameViewport(
  doc: Document | null,
  ratio: number,
  options: CaptureOptions,
  depth: number,
  expand?: FrameSize
): Promise<Blob | null> {
  assertNotCancelled()
  // A cross-origin frame has no readable document and needs a helper instance.
  if (!doc || depth > frameLevels(options.maxDepth)) return null
  const viewport = frameViewport(doc)
  if (!viewport) return null

  const scroll = expand ? { x: 0, y: 0 } : frameScroll(doc)
  const surface = expand
    ? {
        left: 0,
        top: 0,
        width: Math.max(1, Math.ceil(expand.width)),
        height: Math.max(1, Math.ceil(expand.height))
      }
    : { left: 0, top: 0, width: viewport.width, height: viewport.height }

  const snapshot = await createSnapshot({
    doc,
    skip: options.filter ? (node) => !options.filter?.(node as HTMLElement) : undefined
  })
  // Fonts come from the frame's own document for the whole render, including the
  // frames nested inside it (each of those switches again and restores this one),
  // and the previous source is put back even when the render fails.
  const previousFontSource = native.fontSource.document
  native.setFontSource(doc)
  try {
    const root = snapshot.doc.documentElement
    if (!root) return null

    // Order matters: the pin is measured against the copy's replayed scroll, and
    // expanding the root resets that scroll. An expanded frame shows its content
    // from the top, so its sticky descendants belong at their static position.
    if (!expand) pinFrameSticky(root)
    expandForCapture(root, surface, false)
    await paintFrames(root, snapshot.frames, ratio, options, depth + 1)
    await nextFrame()

    // The frame's own webfonts, not the ones the parent page happens to have:
    // reusing the parent's CSS names fonts this document does not use and misses
    // the ones it does, so its text would be rendered in a fallback face.
    const fontEmbedCSS = await resolveFontEmbedCSS(root as HTMLElement)
    return await toBlob(root as HTMLElement, {
      width: surface.width,
      height: surface.height,
      pixelRatio: ratio,
      skipAutoScale: true,
      cacheBust: false,
      type: 'image/png',
      imagePlaceholder: TRANSPARENT_PIXEL,
      onImageErrorHandler: handleImageError,
      style: frameRootStyle(scroll),
      filter: options.filter,
      fontEmbedCSS
    })
  } finally {
    native.setFontSource(previousFontSource)
    snapshot.dispose()
  }
}

/**
 * Put a frame's picture into the frame's own box in the copy.
 *
 * The picture becomes the first background layer, so the page render keeps
 * painting the frame's border, its rounded corners and everything that overlaps
 * it; the alternative — compositing on the result canvas — would paste the frame
 * over any header or tooltip that happens to cover it.
 */
function paintFrameBackground(copy: HTMLIFrameElement, url: string): void {
  let computed: CSSStyleDeclaration | null = null
  try {
    computed = native.getComputedStyle(copy)
  } catch {
    // Paint the picture over the defaults below.
  }
  const layer = sliceBackgroundStyle(computed, {
    url,
    origin: 'content-box',
    size: '100% 100%'
  })
  for (const [property, value] of Object.entries(layer)) {
    if (typeof value === 'string') setImportant(copy, kebabCase(property), value)
  }
}

/**
 * What an expanded frame needs: the surface to render on, and the helper probe
 * that has already been done, so painting the frame does not probe twice.
 */
interface FrameExpansion {
  size: FrameSize
  helpers: Set<HTMLIFrameElement> | null
}

/**
 * Resize the copied frame so its viewport is exactly `content` big.
 *
 * Only the copy is touched: the live frame keeps its box, and the surrounding
 * layout in the copy reflows around the grown frame the way the page would if the
 * frame were that tall.
 */
function growFrameCopy(copy: HTMLIFrameElement, content: FrameSize): void {
  const outer = frameOuterSize(copy, content)
  setImportant(copy, 'width', `${outer.width}px`)
  setImportant(copy, 'height', `${outer.height}px`)
}

/**
 * Decide whether picking a frame means "the whole frame" and make room for it.
 *
 * Selecting a scrollable element expands its own scroll content; a frame is the
 * same thing one level down, so a frame whose document scrolls is rendered from
 * the top at full content size instead of at its current viewport. A frame that
 * fits entirely is left alone: its viewport picture is already the whole frame.
 *
 * The parent has to know that size before it measures the capture, and a
 * cross-origin frame cannot be measured locally, so this asks the frame's helper.
 */
async function planFrameExpansion(frame: FrameRecord): Promise<FrameExpansion | null> {
  assertNotCancelled()
  // A collapsed frame paints nothing; there is no frame content to expand.
  if (!frameBoxSize(frame.copy)) return null
  const viewport = frameViewport(frame.doc) ?? frameElementViewport(frame.live)
  if (!viewport) return null

  let measured = frameContentSize(frame.doc)
  let helpers: Set<HTMLIFrameElement> | null = null
  if (!measured) {
    // A cross-origin frame: only its helper can report how tall it is.
    helpers = await probeFrameHelpers([frame.live])
    if (helpers.has(frame.live)) measured = await requestFrameSize(frame.live)
  }
  if (!measured) return null
  // The frame is never captured narrower or shorter than what it shows today.
  const size = {
    width: Math.max(viewport.width, measured.width),
    height: Math.max(viewport.height, measured.height)
  }
  if (size.width <= viewport.width && size.height <= viewport.height) return null

  growFrameCopy(frame.copy, size)
  return { size, helpers }
}

/**
 * Render every frame inside `root` and paint it into its own box before the page
 * render.
 *
 * The frame's own copy of the script is asked first: it renders in the frame's
 * realm, so the frame's fonts and pixel ratio come out right, and it is the only
 * way to reach a cross-origin frame. A frame without a helper (not injected —
 * `about:blank`, `srcdoc`, a sandbox without `allow-scripts` — or still starting
 * up) is rendered by the parent when its document is readable. A frame that
 * cannot be rendered keeps its empty box: a missing picture is not a reason to
 * lose the whole capture.
 *
 * Helper renders run concurrently because each one happens in its own frame;
 * local fallbacks run one at a time because they share this realm.
 *
 * `expansion` only applies to the root itself, i.e. when the picked element is the
 * frame: that frame is rendered expanded on the surface reserved for it, while the
 * frames inside it keep their current viewport.
 */
async function paintFrames(
  root: Element,
  frames: readonly FrameRecord[],
  ratio: number,
  options: CaptureOptions,
  depth: number,
  expansion: FrameExpansion | null = null
): Promise<void> {
  const levels = frameLevels(options.maxDepth)
  if (depth > levels) return
  const targets = framesInside(root, frames).filter((frame) => frameBoxSize(frame.copy))
  if (targets.length === 0) return

  const helpers =
    expansion?.helpers ?? (await probeFrameHelpers(targets.map((frame) => frame.live)))
  const planned = targets.map((frame) => ({
    frame,
    expand: frame.copy === root ? expansion?.size : undefined
  }))

  /*
   * A helper renders inside its own frame, so those requests do not depend on
   * each other or on this realm: ask every frame at once instead of paying each
   * frame's render time one after the other. (Sibling frames of one site usually
   * share a renderer process, so the gain is largest across origins; the total
   * work is the same either way.)
   */
  const remote = new Map<HTMLIFrameElement, Blob>()
  /*
   * The wait covers the frames nested inside this one too, because the helper
   * renders them within its own render: a frame two levels down needs two more
   * renders before this answer arrives. Levels left below this frame add that
   * budget, so a legitimate deep render is not cut off as a silent frame.
   */
  const timeout = FRAME_RESULT_TIMEOUT + Math.max(0, levels - depth) * FRAME_LEVEL_TIMEOUT
  await Promise.all(
    planned
      .filter((entry) => helpers.has(entry.frame.live))
      .map(async (entry) => {
        try {
          const image = await requestFrameImage(entry.frame.live, {
            ratio,
            depth,
            maxDepth: levels,
            ...(entry.expand ? { expand: entry.expand } : {}),
            timeout
          })
          if (image) remote.set(entry.frame.live, image)
        } catch (error) {
          if (native.capture.aborted) throw error
          console.warn('[element-screenshot] frame render failed:', describeCaptureError(error))
        }
      })
  )

  /*
   * Whatever is left is rendered here when its document is readable. Those
   * renders share this realm — the main thread, the canvas and the font-source
   * switch — so they stay strictly one at a time.
   */
  for (const entry of planned) {
    assertNotCancelled()
    try {
      const image =
        remote.get(entry.frame.live) ??
        (await renderFrameViewport(entry.frame.doc, ratio, options, depth, entry.expand))
      if (!image) continue
      paintFrameBackground(entry.frame.copy, await blobToDataUrl(image))
    } catch (error) {
      if (native.capture.aborted) throw error
      console.warn('[element-screenshot] frame render failed:', describeCaptureError(error))
    }
  }
}

/**
 * Render an element (including its full scrollable content) to a PNG blob.
 * The element is first copied into an off-screen snapshot, and every mutation
 * this pipeline needs (expanded scroll containers, inlined SVG paint variables)
 * is applied to that copy. The live page is only read, so the user keeps working
 * while the render runs and nothing has to be restored afterwards.
 */
export async function captureElement(
  element: Element,
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  native.capture.aborted = false
  const snapshot = await createSnapshot({
    target: element,
    skip: options.filter ? (node) => !options.filter?.(node as HTMLElement) : undefined
  })
  try {
    const target = snapshot.target
    // The element may have been removed from the page between the click and the
    // snapshot; html-to-image would render an empty picture.
    if (!target) throw new Error('The selected element is no longer on the page')
    return await renderElement(target, options, snapshot.frames)
  } finally {
    snapshot.dispose()
  }
}

async function renderElement(
  element: Element,
  options: CaptureOptions,
  frames: readonly FrameRecord[] = []
): Promise<CaptureResult> {
  assertNotCancelled()
  const measured = getTargetBox(element)
  // Prefer the box the picker showed. A copy can lay out a hair differently
  // (late webfont, different scrollbar), and the output has to match the frame
  // the user approved rather than the copy's own measurement.
  const box = options.box ? { ...options.box } : measured
  if (
    options.box &&
    (options.box.width !== measured.width || options.box.height !== measured.height)
  ) {
    console.info('[element-screenshot] snapshot box differs from the page', {
      page: { width: options.box.width, height: options.box.height },
      snapshot: { width: measured.width, height: measured.height }
    })
  }
  let computed: CSSStyleDeclaration | null = null
  try {
    computed = native.getComputedStyle(element)
  } catch {
    // Keep the measured box when computed styles are unavailable.
  }
  // The capture box is the element's border box, so the cloned root must not
  // keep the placement and margins that moved it inside the page.
  const rootStyle = rootPlacementStyle(computed)
  try {
    const style = computed ?? native.getComputedStyle(element)
    const display = style.display
    if (display === 'inline' && element.tagName === 'IFRAME') {
      // A frame is a replaced element: it already renders exactly at its border
      // box, so the line-box correction below would only add a stray font-size of
      // blank space to the capture.
      rootStyle.display = 'block'
    } else if (display === 'inline') {
      const fontSize = Number.parseFloat(style.fontSize) || 16
      // An inline root is laid out in a line box with a strut, which pushes the
      // glyphs below the element's 12px border box. Render it as a block and
      // leave one extra font-size of height so descenders are not clipped.
      box.height += Math.ceil(fontSize)
      rootStyle.display = 'block'
      rootStyle.lineHeight = `${Math.ceil(fontSize * 1.5)}px`
    } else if (display.startsWith('inline-')) {
      // inline-flex / inline-block / inline-grid still participate in a line
      // box when used as the clone root. Use their block-level equivalent.
      const blockDisplay = display.slice('inline-'.length)
      rootStyle.display = blockDisplay === 'block' ? 'block' : blockDisplay
    }
  } catch {
    // Keep the measured box when computed styles are unavailable.
  }
  const restore = expandForCapture(element, box, options.expandNested !== false)
  const restoreSvg = inlineSvgPaintVariables(element)

  try {
    await nextFrame()
    await nextFrame()

    // Picking the frame itself means "the whole frame": its document is the root,
    // so the copied box grows to the frame's content size and the frame is
    // rendered expanded from the top instead of at its current scroll offset. The
    // copy reflows around the grown frame, so the box below is measured afterwards.
    const rootFrame = frames.find((frame) => frame.copy === element) ?? null
    const expansion = rootFrame ? await planFrameExpansion(rootFrame) : null

    // Expanding the copy can lay out more than the live page showed: the root's
    // own overflow becomes visible, and with nested expansion a descendant grows
    // its ancestor. Measure again so the canvas covers the layout instead of
    // cropping the extra content away.
    const finalBox = fitBoxToLayout(element, box)
    const plan = computeCaptureScale(
      finalBox.width,
      finalBox.height,
      options.pixelRatio ?? Math.min(native.devicePixelRatio || 1, 2),
      options.maxDimension,
      options.maxArea
    )

    // Frames are painted into their own box before the page render, and every
    // render reuses the webfont CSS that html-to-image would otherwise resolve
    // from scratch.
    const nested = framesInside(element, frames)
    const shared = nested.length
      ? { ...options, fontEmbedCSS: await sharedFontEmbedCSS(element as HTMLElement, options) }
      : options
    await paintFrames(element, nested, plan.ratio, shared, 1, expansion)

    const backdrop = await resolveBackground(element, finalBox, plan, options)

    const imageBlob = await toBlob(element as HTMLElement, {
      width: plan.width,
      height: plan.height,
      pixelRatio: plan.ratio,
      backgroundColor: backdrop.scene ? undefined : backdrop.color,
      skipAutoScale: true,
      cacheBust: false,
      type: 'image/png',
      imagePlaceholder: TRANSPARENT_PIXEL,
      onImageErrorHandler: handleImageError,
      style: rootStyle,
      filter: options.filter,
      fontEmbedCSS: shared.fontEmbedCSS
    })
    if (!imageBlob) throw new Error('html-to-image returned an empty blob')

    const width = Math.max(1, Math.round(plan.width * plan.ratio))
    const height = Math.max(1, Math.round(plan.height * plan.ratio))
    const blob = backdrop.scene
      ? await compositeScene(backdrop.scene, imageBlob, width, height)
      : imageBlob

    return {
      blob,
      width,
      height,
      scale: plan.ratio,
      limited: plan.limited,
      sourceWidth: plan.width,
      sourceHeight: plan.height
    }
  } finally {
    restoreSvg()
    restore()
  }
}

interface RegionPlan {
  doc: SliceDocument
  root: HTMLElement
  viewport: ViewportSize
  region: TargetBox
  plan: CaptureScalePlan
}

function planRegion(rect: TargetBox, options: RegionCaptureOptions, doc: Document): RegionPlan {
  const root = doc.documentElement
  if (!root) throw new Error('The page has no document element')

  const win = root.ownerDocument.defaultView ?? window
  const viewport = {
    width: Math.max(1, Math.round(win.innerWidth)),
    height: Math.max(1, Math.round(win.innerHeight))
  }
  const requestedRatio = options.pixelRatio ?? Math.min(native.devicePixelRatio || 1, 2)

  return {
    doc,
    root,
    viewport,
    region: clampRegion(rect, viewport),
    plan: computeCaptureScale(
      viewport.width,
      viewport.height,
      requestedRatio,
      options.maxDimension,
      options.maxArea
    )
  }
}

function pageScroll(root: HTMLElement): Point {
  const win = root.ownerDocument.defaultView ?? window
  return { x: Math.round(win.scrollX ?? 0), y: Math.round(win.scrollY ?? 0) }
}

interface ViewportRender {
  region: TargetBox
  plan: CaptureScalePlan
  options: CaptureOptions
  /** Window scroll: the clone does not carry it. */
  shift: Point
  doc: Document
}

/**
 * Render the viewport on a viewport-sized surface and crop one rectangle.
 *
 * Rendering the viewport rather than the whole document keeps `fixed` elements
 * anchored to the crop coordinate system and avoids downscaling a huge page just
 * to keep a small region sharp. A clone never carries `scrollTop`, so the root
 * is shifted by the window scroll; everything inside a scrolled panel has
 * already been painted back by `replaceScrollContainer()`.
 */
async function renderViewport({
  region,
  plan,
  options,
  shift,
  doc
}: ViewportRender): Promise<CaptureResult> {
  const root = doc.documentElement
  if (!root) throw new Error('The page has no document element')

  let computed: CSSStyleDeclaration | null = null
  try {
    computed = native.getComputedStyle(root)
  } catch {
    // Render with the defaults below when computed styles are unavailable.
  }
  const rootStyle = rootPlacementStyle(computed)
  // `relative` (not a transform) keeps the shifted root from becoming the
  // containing block of `fixed` descendants, so overlays stay at their
  // viewport coordinates.
  rootStyle.position = 'relative'
  rootStyle.inset = 'auto'
  rootStyle.transform = 'none'
  rootStyle.top = `${-shift.y}px`
  rootStyle.left = `${-shift.x}px`

  const surface = { left: 0, top: 0, width: plan.width, height: plan.height }
  const restore = expandForCapture(root, surface, false)
  const restoreSvg = inlineSvgPaintVariables(root)

  try {
    await nextFrame()
    await nextFrame()

    const rendered = await toBlob(root as HTMLElement, {
      width: plan.width,
      height: plan.height,
      pixelRatio: plan.ratio,
      backgroundColor: options.backgroundColor,
      skipAutoScale: true,
      cacheBust: false,
      type: 'image/png',
      imagePlaceholder: TRANSPARENT_PIXEL,
      onImageErrorHandler: handleImageError,
      style: rootStyle,
      filter: options.filter,
      fontEmbedCSS: options.fontEmbedCSS
    })
    if (!rendered) throw new Error('html-to-image returned an empty blob')

    const crop = planCrop(region, plan.ratio, plan.width, plan.height)
    const blob = await cropBlob(rendered, crop)

    return {
      blob,
      width: crop.width,
      height: crop.height,
      scale: plan.ratio,
      limited: plan.limited,
      sourceWidth: region.width,
      sourceHeight: region.height
    }
  } finally {
    restoreSvg()
    restore()
  }
}

interface SliceReplacement {
  restore: () => void
  /** Show viewport-anchored descendants again for the final page render. */
  revealFixed: () => void
}

async function renderSlice(
  target: Element,
  metrics: ScrollportMetrics,
  ratio: number,
  options: CaptureOptions
): Promise<Blob | null> {
  return toBlob(target as HTMLElement, {
    // The surface is the scrollport: a `fixed` descendant of the page would be
    // placed relative to it, which is exactly what the viewport render wants.
    width: metrics.clientWidth,
    height: metrics.clientHeight,
    pixelRatio: ratio,
    skipAutoScale: true,
    cacheBust: false,
    type: 'image/png',
    imagePlaceholder: TRANSPARENT_PIXEL,
    onImageErrorHandler: handleImageError,
    style: sliceRootStyle(metrics),
    filter: options.filter,
    fontEmbedCSS: options.fontEmbedCSS
  })
}

/**
 * Render the visible slice of one scrolled panel and paint it back over the
 * panel as its first background layer.
 *
 * Rendering the panel itself as the clone root is what makes this exact: the
 * clone has no `scrollTop`, but shifting the root by the scroll offset moves the
 * content into the crop while the surface defines the scrollport. No descendant
 * is repositioned, so containing blocks, stacking order and clipping stay put.
 * The picture becomes a background layer, which means the browser keeps doing
 * the clipping, the rounded corners and the transparency for us.
 */
async function replaceScrollContainer(
  target: Element,
  ratio: number,
  options: CaptureOptions
): Promise<SliceReplacement | null> {
  const metrics = scrollportMetrics(target)
  if (!metrics) return null
  let computed: CSSStyleDeclaration
  try {
    computed = native.getComputedStyle(target)
  } catch {
    return null
  }

  const targetSnapshot = snapshotStyle(target)
  const restores: Array<() => void> = []
  const fixed: Element[] = []

  try {
    for (const element of collectFixedDescendants(target)) {
      const snapshot = snapshotStyle(element)
      fixed.push(element)
      setImportant(element, 'visibility', 'hidden')
      restores.push(() => restoreStyle(snapshot))
    }

    for (const element of collectSliceSticky(target)) {
      restores.push(() => restoreStyle(pinSticky(element)))
    }

    await nextFrame()
    const slice = await renderSlice(target, metrics, ratio, options)
    if (!slice) throw new Error('html-to-image returned an empty blob')

    const url = await blobToDataUrl(slice)
    const layer = sliceBackgroundStyle(computed, {
      url,
      width: metrics.clientWidth,
      height: metrics.clientHeight
    })

    restores.push(hideSliceContent(target))
    for (const [property, value] of Object.entries(layer)) {
      if (typeof value === 'string') setImportant(target, kebabCase(property), value)
    }
  } catch (error) {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
    restoreStyle(targetSnapshot)
    throw error
  }

  return {
    restore: () => {
      for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
      restoreStyle(targetSnapshot)
    },
    revealFixed: () => {
      for (const element of fixed) setImportant(element, 'visibility', 'visible')
    }
  }
}

/**
 * Render the current viewport and crop one rectangle out of it.
 *
 * Each scrolled panel is rebuilt on its own as a "current scroll view" and
 * painted back over the panel, so any number of independent or nested panes land
 * at their real scroll offsets. The viewport is then rendered once with only the
 * window scroll applied to the clone root, and the result is cropped to the
 * dragged rectangle.
 *
 * All of that happens on an off-screen snapshot of the page: the live document is
 * only read, so the user can keep working while the capture renders.
 */
export async function captureRegion(
  rect: TargetBox,
  options: RegionCaptureOptions = {}
): Promise<CaptureResult> {
  native.capture.aborted = false
  const snapshot = await createSnapshot({
    skip: options.filter ? (node) => !options.filter?.(node as HTMLElement) : undefined
  })
  try {
    return await renderRegion(rect, options, snapshot.doc, snapshot.frames)
  } finally {
    snapshot.dispose()
  }
}

async function renderRegion(
  rect: TargetBox,
  options: RegionCaptureOptions,
  doc: Document,
  frames: readonly FrameRecord[] = []
): Promise<CaptureResult> {
  assertNotCancelled()
  const { root, region, plan } = planRegion(rect, options, doc)
  const targets = options.slices ?? collectScrollSlices(region, doc)
  const replacements: SliceReplacement[] = []
  // A frame is a picture of its viewport, not something to expand: a region
  // capture is what-you-see-is-what-you-get.
  const regionFrames = framesInRegion(frames, region)
  const shared =
    targets.length || regionFrames.length
      ? { ...options, fontEmbedCSS: await sharedFontEmbedCSS(root, options) }
      : options

  try {
    // Frames are painted before any panel is replaced. Turning a scrolled panel
    // into a picture renders it with its children still in place, and only then
    // hides them, so a frame whose picture is painted afterwards would sit on an
    // invisible box and the slice would show an empty rectangle.
    await paintFrames(root, regionFrames, plan.ratio, shared, 1)
    assertNotCancelled()
    for (const target of targets) {
      assertNotCancelled()
      const replacement = await replaceScrollContainer(target, plan.ratio, shared)
      if (replacement) replacements.push(replacement)
    }
    assertNotCancelled()
    for (const replacement of replacements) replacement.revealFixed()
    return await renderViewport({ region, plan, options: shared, shift: pageScroll(root), doc })
  } finally {
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      replacements[index]?.restore()
    }
  }
}
