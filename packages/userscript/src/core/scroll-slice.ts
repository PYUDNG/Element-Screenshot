import { native } from './native'
import { regionSamplePoints } from './scroll-replay'
import { getElementStack } from './target'
import type { TargetBox } from './target'

type StylableElement = Element & { style: CSSStyleDeclaration }
type ScrollableElement = Element & {
  scrollTop: number
  scrollLeft: number
  scrollHeight: number
  scrollWidth: number
  clientWidth: number
  clientHeight: number
}

/** `overflow` values that make an element a scroll container. */
const SCROLL_OVERFLOW = new Set(['auto', 'scroll', 'overlay'])
const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const

/** Guard rails: a screenshot never needs to rebuild an unbounded number of panels. */
const MAX_SCAN = 20_000
const MAX_SLICES = 32
const MAX_INSPECTED = 8_000

export interface ScrollportMetrics {
  scrollTop: number
  scrollLeft: number
  /** Scrollport (= client box) size in CSS pixels. */
  clientWidth: number
  clientHeight: number
  borderTop: number
  borderRight: number
  borderBottom: number
  borderLeft: number
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
}

export interface StyleSnapshot {
  element: Element
  style: string | null
}

/**
 * The parts of a document the slice collector needs. `native.document` is a
 * structural subset of `Document`, so this keeps both call styles type-safe.
 */
export interface SliceDocument {
  readonly documentElement: Element | null
  readonly scrollingElement?: Element | null
}

export interface SliceLayer {
  url: string
  width: number
  height: number
}

const BACKGROUND_PROPERTIES = [
  'backgroundImage',
  'backgroundSize',
  'backgroundPosition',
  'backgroundRepeat',
  'backgroundOrigin',
  'backgroundClip',
  'backgroundAttachment',
  'backgroundBlendMode'
] as const

type BackgroundProperty = (typeof BACKGROUND_PROPERTIES)[number]

const BACKGROUND_DEFAULTS: Record<BackgroundProperty, string> = {
  backgroundImage: 'none',
  backgroundSize: 'auto',
  backgroundPosition: '0% 0%',
  backgroundRepeat: 'repeat',
  backgroundOrigin: 'padding-box',
  backgroundClip: 'border-box',
  backgroundAttachment: 'scroll',
  backgroundBlendMode: 'normal'
}

/** First background layer: the rendered slice, painted over the real backdrop. */
const SLICE_LAYER: Record<BackgroundProperty, string> = {
  backgroundImage: '',
  backgroundSize: '',
  backgroundPosition: '0% 0%',
  backgroundRepeat: 'no-repeat',
  backgroundOrigin: 'padding-box',
  backgroundClip: 'border-box',
  backgroundAttachment: 'scroll',
  backgroundBlendMode: 'normal'
}

export function parsePx(value: string | null | undefined): number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function kebabCase(property: string): string {
  return property.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)
}

export function hasScrollOffset(element: Element): boolean {
  const box = element as Partial<ScrollableElement>
  try {
    return (Number(box.scrollTop) || 0) !== 0 || (Number(box.scrollLeft) || 0) !== 0
  } catch {
    return false
  }
}

export function isScrollContainer(element: Element): boolean {
  let style: CSSStyleDeclaration
  try {
    style = native.getComputedStyle(element)
  } catch {
    return false
  }
  const scrollY = SCROLL_OVERFLOW.has(style.overflowY)
  const scrollX = SCROLL_OVERFLOW.has(style.overflowX)
  if (!scrollY && !scrollX) return false

  const box = element as Partial<ScrollableElement>
  const scrollHeight = Number(box.scrollHeight) || 0
  const clientHeight = Number(box.clientHeight) || 0
  const scrollWidth = Number(box.scrollWidth) || 0
  const clientWidth = Number(box.clientWidth) || 0
  return (scrollY && scrollHeight > clientHeight + 1) || (scrollX && scrollWidth > clientWidth + 1)
}

/**
 * Geometry of the visible part of a scrolled container. Returns null when the
 * element is not scrolled, so callers can use it as the "worth slicing" test.
 */
export function scrollportMetrics(element: Element): ScrollportMetrics | null {
  const box = element as Partial<ScrollableElement>
  const scrollTop = Number(box.scrollTop) || 0
  const scrollLeft = Number(box.scrollLeft) || 0
  if (scrollTop === 0 && scrollLeft === 0) return null

  const clientWidth = Math.round(Number(box.clientWidth) || 0)
  const clientHeight = Math.round(Number(box.clientHeight) || 0)
  if (clientWidth < 1 || clientHeight < 1) return null

  let style: CSSStyleDeclaration
  try {
    style = native.getComputedStyle(element)
  } catch {
    return null
  }

  return {
    scrollTop,
    scrollLeft,
    clientWidth,
    clientHeight,
    borderTop: parsePx(style.borderTopWidth),
    borderRight: parsePx(style.borderRightWidth),
    borderBottom: parsePx(style.borderBottomWidth),
    borderLeft: parsePx(style.borderLeftWidth),
    paddingTop: parsePx(style.paddingTop),
    paddingRight: parsePx(style.paddingRight),
    paddingBottom: parsePx(style.paddingBottom),
    paddingLeft: parsePx(style.paddingLeft)
  }
}

function toBox(rect: DOMRect): TargetBox {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** Border box of an element in viewport coordinates. */
export function borderBoxOf(element: Element): TargetBox {
  try {
    return toBox(native.getBoundingClientRect(element))
  } catch {
    return { left: 0, top: 0, width: 0, height: 0 }
  }
}

/** Padding box of an element in viewport coordinates (the scrollport frame). */
export function paddingBoxOf(element: Element): TargetBox {
  const rect = borderBoxOf(element)
  let style: CSSStyleDeclaration | null = null
  try {
    style = native.getComputedStyle(element)
  } catch {
    // Fall back to the border box when the computed style is unavailable.
  }
  const left = parsePx(style?.borderLeftWidth)
  const top = parsePx(style?.borderTopWidth)
  return {
    left: rect.left + left,
    top: rect.top + top,
    width: Math.max(0, rect.width - left - parsePx(style?.borderRightWidth)),
    height: Math.max(0, rect.height - top - parsePx(style?.borderBottomWidth))
  }
}

export function overlaps(a: TargetBox, b: TargetBox): boolean {
  return (
    a.width > 0 &&
    a.height > 0 &&
    b.width > 0 &&
    b.height > 0 &&
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  )
}

/**
 * Scrolled containers that have to be rebuilt for this region, deepest first.
 *
 * A scrolled container is replaced when it overlaps the region, or when it sits
 * inside the scrollport of another replaced container: either way its stale
 * (scroll-0) content would otherwise end up in the picture. Panels outside both
 * are cropped away and cost nothing.
 */
export function collectScrollSlices(
  rect: TargetBox,
  doc: SliceDocument = native.document
): Element[] {
  const root = doc.documentElement
  if (!root || rect.width <= 0 || rect.height <= 0) return []

  const scrolling = (doc.scrollingElement as Element | null) ?? root
  const candidates: Element[] = []
  let scanned = 0
  for (const element of Array.from(native.querySelectorAll(root, '*'))) {
    if (scanned >= MAX_SCAN) break
    scanned += 1
    if (element === scrolling) continue
    if (!hasScrollOffset(element)) continue
    if (!isScrollContainer(element)) continue
    candidates.push(element)
  }

  const included = new Set<Element>()
  const paddingBoxes = new Map<Element, TargetBox>()
  const slices: Element[] = []

  for (const element of candidates) {
    if (slices.length >= MAX_SLICES) break
    const box = borderBoxOf(element)
    let visible = overlaps(box, rect)

    if (!visible) {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (!included.has(ancestor)) continue
        let padding = paddingBoxes.get(ancestor)
        if (!padding) {
          padding = paddingBoxOf(ancestor)
          paddingBoxes.set(ancestor, padding)
        }
        if (overlaps(box, padding)) {
          visible = true
          break
        }
      }
    }

    if (!visible) continue
    included.add(element)
    slices.push(element)
  }

  return slices.reverse()
}

/**
 * Clone-root style that turns the element into a picture of its scrollport.
 *
 * The clone never carries `scrollTop`, so the content is replayed by shifting
 * the root: the box grows so it keeps the real padding box, and the shift
 * includes the border widths because the border box starts at the surface
 * origin while the scrollport starts at the padding box.
 *
 * The border is dropped and its width folded into the padding instead of being
 * made transparent: a transparent border still takes part in the paint of the
 * bottom/right rounded corners (they land inside the surface because the box is
 * taller than the scrollport), while this keeps the content box exactly where
 * it was. The frame itself is painted by the page render.
 */
export function sliceRootStyle(metrics: ScrollportMetrics): Partial<CSSStyleDeclaration> {
  const width = metrics.clientWidth + metrics.borderLeft + metrics.borderRight
  const height = metrics.clientHeight + metrics.borderTop + metrics.borderBottom

  return {
    boxSizing: 'border-box',
    width: `${width}px`,
    height: `${height}px`,
    minWidth: '0',
    minHeight: '0',
    maxWidth: 'none',
    maxHeight: 'none',
    borderWidth: '0',
    borderRadius: '0',
    padding: `${metrics.paddingTop + metrics.borderTop}px ${metrics.paddingRight + metrics.borderRight}px ${metrics.paddingBottom + metrics.borderBottom}px ${metrics.paddingLeft + metrics.borderLeft}px`,
    margin: '0',
    inset: 'auto',
    position: 'relative',
    top: `${-(metrics.scrollTop + metrics.borderTop)}px`,
    left: `${-(metrics.scrollLeft + metrics.borderLeft)}px`,
    transform: 'none',
    overflow: 'visible',
    background: 'transparent',
    boxShadow: 'none',
    outline: 'none',
    opacity: '1',
    filter: 'none',
    clipPath: 'none',
    mixBlendMode: 'normal'
  }
}

/** Split a comma separated CSS value list without breaking functions or quotes. */
export function splitCssList(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote = ''
  let start = 0

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) {
      if (char === quote && value[index - 1] !== '\\') quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '(') depth += 1
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }

  parts.push(value.slice(start).trim())
  return parts.filter((part) => part.length > 0)
}

/**
 * Inline background that paints the slice over the container's own background.
 *
 * The slice is added as an extra first layer instead of replacing the
 * background, so a gradient or background image survives in the transparent
 * parts of the picture. All longhands are prepended together; when the layer
 * lists do not line up (a browser quirk) only the slice is used.
 */
export function sliceBackgroundStyle(
  computed: CSSStyleDeclaration,
  layer: SliceLayer
): Partial<CSSStyleDeclaration> {
  const head: Record<BackgroundProperty, string> = {
    ...SLICE_LAYER,
    backgroundImage: `url("${layer.url}")`,
    backgroundSize: `${layer.width}px ${layer.height}px`
  }

  const originals = BACKGROUND_PROPERTIES.map((property) => {
    let value = ''
    try {
      value = computed.getPropertyValue(kebabCase(property))
    } catch {
      // Use the default layer when the style cannot be read.
    }
    return splitCssList(value || BACKGROUND_DEFAULTS[property])
  })

  const count = originals[0]?.length ?? 1
  const consistent = originals.every((list) => list.length === count)
  const style: Record<string, string> = {}

  BACKGROUND_PROPERTIES.forEach((property, index) => {
    const list = consistent ? [head[property], ...(originals[index] ?? [])] : [head[property]]
    style[property] = list.join(', ')
  })

  return style as Partial<CSSStyleDeclaration>
}

export function snapshotStyle(element: Element): StyleSnapshot {
  return { element, style: native.getAttribute(element, 'style') }
}

export function restoreStyle(snapshot: StyleSnapshot): void {
  if (snapshot.style === null) native.removeAttribute(snapshot.element, 'style')
  else native.setAttribute(snapshot.element, 'style', snapshot.style)
}

export function setImportant(element: Element, property: string, value: string): void {
  ;(element as StylableElement).style.setProperty(property, value, 'important')
}

/**
 * Pin a sticky element where it is on screen. `relative` keeps its slot in the
 * flow; the measured delta is unaffected by the clone-root shift.
 */
export function pinSticky(element: Element): StyleSnapshot {
  const snapshot = snapshotStyle(element)
  try {
    const pinned = native.getBoundingClientRect(element)
    setImportant(element, 'position', 'static')
    const natural = native.getBoundingClientRect(element)
    setImportant(element, 'position', 'relative')
    setImportant(element, 'top', `${Math.round(pinned.top - natural.top)}px`)
    setImportant(element, 'left', `${Math.round(pinned.left - natural.left)}px`)
  } catch {
    // A failed pin leaves the element at its static position.
  }
  return snapshot
}

function nearestScrollport(element: Element): Element | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    let style: CSSStyleDeclaration
    try {
      style = native.getComputedStyle(node)
    } catch {
      return null
    }
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return node
  }
  return null
}

function isSticky(element: Element): boolean {
  try {
    const position = native.getComputedStyle(element).position
    return position === 'sticky' || position === '-webkit-sticky'
  } catch {
    return false
  }
}

/**
 * Sticky elements that stick to `target` and are visible right now. Sampling
 * the visible box is enough: a sticky element that is scrolled out of view
 * cannot show up in the slice anyway.
 */
export function collectSliceSticky(target: Element): Element[] {
  const rect = paddingBoxOf(target)
  const result: Element[] = []
  const seen = new Set<Element>()

  for (const point of regionSamplePoints(rect)) {
    let stack: Element[]
    try {
      stack = getElementStack(point.x, point.y, target.ownerDocument)
    } catch {
      continue
    }
    for (const element of stack) {
      if (seen.has(element) || !target.contains(element)) continue
      if (!isSticky(element)) continue
      if (nearestScrollport(element) !== target) continue
      seen.add(element)
      result.push(element)
    }
  }

  return result
}

/**
 * Viewport-anchored descendants of a scrolled container. They do not move with
 * its content, so they are hidden while the slice is rendered and left to the
 * final page render, which already puts them at the right coordinates.
 */
export function collectFixedDescendants(target: Element): Element[] {
  const result: Element[] = []
  let inspected = 0
  for (const element of Array.from(native.querySelectorAll(target, '*'))) {
    if (inspected >= MAX_INSPECTED) break
    inspected += 1
    let position: string
    try {
      position = native.getComputedStyle(element).position
    } catch {
      continue
    }
    if (position === 'fixed') result.push(element)
  }
  return result
}

export function hasDirectText(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3 && (node.textContent ?? '').trim()) return true
  }
  return false
}

/**
 * Hide what the injected slice now covers. Only the direct children need to be
 * touched (`visibility` inherits) and layout is untouched, so the container box
 * the slice was measured against does not move.
 *
 * The scrollbar goes too: the clone would paint it at scroll offset zero, which
 * is a lie on top of a picture that already shows the scrolled content.
 */
export function hideSliceContent(target: Element): () => void {
  const restores: StyleSnapshot[] = []

  restores.push(snapshotStyle(target))
  setImportant(target, 'scrollbar-width', 'none')

  for (const child of Array.from(target.children)) {
    restores.push(snapshotStyle(child))
    setImportant(child, 'visibility', 'hidden')
  }

  // Text that sits directly in the container belongs to no child element, so
  // hiding the children cannot hide it. Make it transparent instead and keep
  // the frame visible when its colour follows the text colour.
  if (hasDirectText(target)) {
    let computed: CSSStyleDeclaration | null = null
    try {
      computed = native.getComputedStyle(target)
    } catch {
      // Use the defaults below.
    }
    setImportant(target, 'color', 'transparent')
    setImportant(target, '-webkit-text-fill-color', 'transparent')
    setImportant(target, 'text-shadow', 'none')
    if (computed) {
      for (const side of BORDER_SIDES) {
        const value = computed.getPropertyValue(`border-${side}-color`)
        if (value) setImportant(target, `border-${side}-color`, value)
      }
    }
  }

  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) {
      const snapshot = restores[index]
      if (snapshot) restoreStyle(snapshot)
    }
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new native.FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the slice image'))
    reader.readAsDataURL(blob)
  })
}
