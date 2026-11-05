import { toBlob } from 'html-to-image'
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

function isScrollContainer(win: Window, element: Element): boolean {
  const style = win.getComputedStyle(element)
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
  const win = doc.defaultView ?? window
  const targets: Element[] = [root]
  if (root === doc.documentElement && doc.body) targets.push(doc.body)

  let visited = 0
  for (const element of Array.from(root.querySelectorAll('*'))) {
    if (visited >= 6000) break
    visited += 1
    if (isScrollContainer(win, element)) targets.push(element)
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

function nextFrame(win: Window): Promise<void> {
  return new Promise((resolve) => {
    if (typeof win.requestAnimationFrame === 'function') {
      win.requestAnimationFrame(() => resolve())
    } else {
      win.setTimeout(resolve, 16)
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
  const doc = element.ownerDocument
  const win = doc.defaultView ?? window
  const box = getTargetBox(element)
  const requestedRatio = options.pixelRatio ?? Math.min(win.devicePixelRatio || 1, 2)
  const plan = computeCaptureScale(
    box.width,
    box.height,
    requestedRatio,
    options.maxDimension,
    options.maxArea
  )

  const restore = expandForCapture(element, box, options.expandNested !== false)

  try {
    await nextFrame(win)
    await nextFrame(win)

    const blob = await toBlob(element as HTMLElement, {
      width: plan.width,
      height: plan.height,
      pixelRatio: plan.ratio,
      backgroundColor: options.backgroundColor,
      skipAutoScale: true,
      cacheBust: false,
      type: 'image/png',
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
