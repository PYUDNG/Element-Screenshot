import { getFontEmbedCSS, toBlob } from 'html-to-image'
import { blobToDrawable, canvasToBlob } from './canvas'
import { native } from './native'
import { clampRegion } from './region'
import type { Point, ViewportSize } from './region'
import { planCrop, cropBlob } from './crop'
import {
  blobToDataUrl,
  collectFixedDescendants,
  collectScrollSlices,
  collectSliceSticky,
  hideSliceContent,
  isScrollContainer,
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

export interface CaptureOptions {
  expandNested?: boolean
  backgroundColor?: string
  backgroundScene?: Blob
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
 * Resolve the page webfont CSS once so every render of one capture reuses it.
 * html-to-image would otherwise walk all stylesheets and re-inline the same
 * fonts for each slice.
 */
async function sharedFontEmbedCSS(
  root: HTMLElement,
  options: CaptureOptions
): Promise<string | undefined> {
  if (options.fontEmbedCSS) return options.fontEmbedCSS
  try {
    return await getFontEmbedCSS(root, { cacheBust: false })
  } catch (error) {
    console.warn('[element-screenshot] font embedding failed:', describeCaptureError(error))
    return undefined
  }
}
/**
 * Render an element (including its full scrollable content) to a PNG blob.
 * Page styles are restored synchronously afterwards, even on failure.
 */
export async function captureElement(
  element: Element,
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  const box = getTargetBox(element)
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
    if (display === 'inline') {
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
  const requestedRatio = options.pixelRatio ?? Math.min(native.devicePixelRatio || 1, 2)
  const plan = computeCaptureScale(
    box.width,
    box.height,
    requestedRatio,
    options.maxDimension,
    options.maxArea
  )

  const restore = expandForCapture(element, box, options.expandNested !== false)
  const restoreSvg = inlineSvgPaintVariables(element)

  try {
    await nextFrame()
    await nextFrame()

    const imageBlob = await toBlob(element as HTMLElement, {
      width: plan.width,
      height: plan.height,
      pixelRatio: plan.ratio,
      backgroundColor: options.backgroundScene ? undefined : options.backgroundColor,
      skipAutoScale: true,
      cacheBust: false,
      type: 'image/png',
      imagePlaceholder: TRANSPARENT_PIXEL,
      onImageErrorHandler: handleImageError,
      style: rootStyle,
      filter: options.filter
    })
    if (!imageBlob) throw new Error('html-to-image returned an empty blob')

    const width = Math.max(1, Math.round(plan.width * plan.ratio))
    const height = Math.max(1, Math.round(plan.height * plan.ratio))
    const blob = options.backgroundScene
      ? await compositeScene(options.backgroundScene, imageBlob, width, height)
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

function planRegion(rect: TargetBox, options: RegionCaptureOptions): RegionPlan {
  const doc = native.document
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
  shift
}: ViewportRender): Promise<CaptureResult> {
  const doc = native.document
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
 */
export async function captureRegion(
  rect: TargetBox,
  options: RegionCaptureOptions = {}
): Promise<CaptureResult> {
  const { doc, root, region, plan } = planRegion(rect, options)
  const targets = options.slices ?? collectScrollSlices(region, doc)
  const replacements: SliceReplacement[] = []
  const shared = targets.length
    ? { ...options, fontEmbedCSS: await sharedFontEmbedCSS(root, options) }
    : options

  try {
    for (const target of targets) {
      const replacement = await replaceScrollContainer(target, plan.ratio, shared)
      if (replacement) replacements.push(replacement)
    }
    for (const replacement of replacements) replacement.revealFixed()
    return await renderViewport({ region, plan, options: shared, shift: pageScroll(root) })
  } finally {
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
      replacements[index]?.restore()
    }
  }
}
