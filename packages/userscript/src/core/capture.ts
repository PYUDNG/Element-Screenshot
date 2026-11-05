import { toBlob } from 'html-to-image'
import { native } from './native'
import { getTargetBox } from './target'
import type { TargetBox } from './target'

export interface CaptureOptions {
  expandNested?: boolean
  backgroundColor?: string
  pixelRatio?: number
  maxDimension?: number
  maxArea?: number
  filter?: (node: HTMLElement) => boolean
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

const DEFAULT_MAX_DIMENSION = 16_384
const DEFAULT_MAX_AREA = 268_435_456
const ERROR_SOURCE_LIMIT = 512
const NON_RENDERING_TAGS = new Set(['SCRIPT', 'NOSCRIPT'])

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
    console.warn('[element-shot] image skipped:', truncate(event, ERROR_SOURCE_LIMIT))
    return
  }
  const target = event.target as HTMLImageElement | null
  const source = target?.currentSrc || target?.src || ''
  console.warn(
    '[element-shot] image skipped:',
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

interface StyleSnapshot {
  element: Element
  style: string | null
  scrollTop: number
  scrollLeft: number
}

function isScrollContainer(element: Element): boolean {
  const style = native.getComputedStyle(element)
  const overflowY = style.overflowY
  const overflowX = style.overflowX
  const scrollY = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay'
  const scrollX = overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay'
  if (!scrollY && !scrollX) return false
  return (
    (scrollY && element.scrollHeight > element.clientHeight + 1) ||
    (scrollX && element.scrollWidth > element.clientWidth + 1)
  )
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

type StylableElement = Element & { style: CSSStyleDeclaration }

function setImportant(element: Element, property: string, value: string): void {
  ;(element as StylableElement).style.setProperty(property, value, 'important')
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

/**
 * Render an element (including its full scrollable content) to a PNG blob.
 * Page styles are restored synchronously afterwards, even on failure.
 */
export async function captureElement(
  element: Element,
  options: CaptureOptions = {}
): Promise<CaptureResult> {
  const box = getTargetBox(element)
  let inlineStyle: Partial<CSSStyleDeclaration> | undefined
  try {
    const style = native.getComputedStyle(element)
    if (style.display === 'inline') {
      const fontSize = Number.parseFloat(style.fontSize) || 16
      // An inline root is laid out in a line box with a strut, which pushes the
      // glyphs below the element's 12px border box. Render it as a block and
      // leave one extra font-size of height so descenders are not clipped.
      box.height += Math.ceil(fontSize)
      inlineStyle = {
        display: 'block',
        lineHeight: `${Math.ceil(fontSize * 1.5)}px`
      } as Partial<CSSStyleDeclaration>
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

  try {
    await nextFrame()
    await nextFrame()

    const blob = await toBlob(element as HTMLElement, {
      width: plan.width,
      height: plan.height,
      pixelRatio: plan.ratio,
      backgroundColor: options.backgroundColor,
      skipAutoScale: true,
      cacheBust: false,
      type: 'image/png',
      imagePlaceholder: TRANSPARENT_PIXEL,
      onImageErrorHandler: handleImageError,
      style: inlineStyle,
      filter: options.filter
    })
    if (!blob) throw new Error('html-to-image returned an empty blob')

    return {
      blob,
      width: Math.max(1, Math.round(plan.width * plan.ratio)),
      height: Math.max(1, Math.round(plan.height * plan.ratio)),
      scale: plan.ratio,
      limited: plan.limited,
      sourceWidth: plan.width,
      sourceHeight: plan.height
    }
  } finally {
    restore()
  }
}
