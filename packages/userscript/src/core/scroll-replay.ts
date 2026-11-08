import { native } from './native'
import { getElementStack } from './target'
import type { TargetBox } from './target'
import type { Point } from './region'

export interface ScrollAncestor {
  element: Element
  scrollLeft: number
  scrollTop: number
}

/**
 * Everything html-to-image cannot reproduce on its own, collected right before
 * the capture renders.
 *
 * - `ancestors`: clipped, scrolled containers around the region. Their scroll
 *   offset is part of the clone-root shift, their clipping is removed while the
 *   clone is built.
 * - `sticky`: elements whose on-screen position depends on the scroll offset.
 * - `offset`: summed scroll offset of the chosen ancestor chain.
 */
export interface ScrollReplay {
  ancestors: ScrollAncestor[]
  sticky: Element[]
  offset: Point
}

export const EMPTY_SCROLL_REPLAY: ScrollReplay = {
  ancestors: [],
  sticky: [],
  offset: { x: 0, y: 0 }
}

type StylableElement = Element & { style: CSSStyleDeclaration }
type SizedElement = Element & { scrollTop: number; scrollLeft: number }

const MAX_ANCESTORS = 64

function setImportant(element: Element, property: string, value: string): void {
  ;(element as StylableElement).style.setProperty(property, value, 'important')
}

function restoreStyle(element: Element, snapshot: string | null): void {
  if (snapshot === null) native.removeAttribute(element, 'style')
  else native.setAttribute(element, 'style', snapshot)
}

function parentOf(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  if (root && root.nodeType === 11 && 'host' in root) return (root as ShadowRoot).host
  return null
}

/** Sample the centre and four inset corners of the region. */
export function regionSamplePoints(rect: TargetBox): Point[] {
  const insetX = Math.min(8, rect.width / 3)
  const insetY = Math.min(8, rect.height / 3)
  return [
    { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    { x: rect.left + insetX, y: rect.top + insetY },
    { x: rect.left + rect.width - insetX, y: rect.top + insetY },
    { x: rect.left + insetX, y: rect.top + rect.height - insetY },
    { x: rect.left + rect.width - insetX, y: rect.top + rect.height - insetY }
  ]
}

function scrollChain(element: Element, root: Element): ScrollAncestor[] {
  const chain: ScrollAncestor[] = []
  let current: Element | null = element
  let guard = 0

  while (current && current !== root && guard < MAX_ANCESTORS) {
    guard += 1
    const scrollTop = (current as SizedElement).scrollTop
    const scrollLeft = (current as SizedElement).scrollLeft
    if (scrollTop !== 0 || scrollLeft !== 0) {
      chain.push({ element: current, scrollTop, scrollLeft })
    }
    current = parentOf(current)
  }

  return chain
}

function isSticky(element: Element): boolean {
  try {
    const position = native.getComputedStyle(element).position
    return position === 'sticky' || position === '-webkit-sticky'
  } catch {
    return false
  }
}

function intersects(element: Element, rect: TargetBox): boolean {
  try {
    const box = native.getBoundingClientRect(element)
    return (
      box.width > 0 &&
      box.height > 0 &&
      box.bottom > rect.top &&
      box.top < rect.top + rect.height &&
      box.right > rect.left &&
      box.left < rect.left + rect.width
    )
  } catch {
    return false
  }
}

function scoreChain(chain: readonly ScrollAncestor[]): number {
  return chain.reduce(
    (total, item) => total + Math.abs(item.scrollTop) + Math.abs(item.scrollLeft),
    0
  )
}

/**
 * Pick the scroll chain with the most scroll to replay. Chains of nested
 * elements are prefixes of each other, so the deepest element under the region
 * normally wins; across panes the pane that was scrolled the furthest wins.
 */
export function collectScrollReplay(rect: TargetBox, doc: Document = document): ScrollReplay {
  const root = doc.documentElement
  if (!root || rect.width <= 0 || rect.height <= 0) return EMPTY_SCROLL_REPLAY

  let ancestors: ScrollAncestor[] = []
  let bestScore = 0
  const sticky = new Set<Element>()

  for (const point of regionSamplePoints(rect)) {
    let stack: Element[]
    try {
      stack = getElementStack(point.x, point.y, doc)
    } catch {
      continue
    }

    for (const element of stack) {
      if (isSticky(element)) sticky.add(element)
      const chain = scrollChain(element, root)
      const score = scoreChain(chain)
      if (score > bestScore) {
        ancestors = chain
        bestScore = score
      }
    }
  }

  const offset = ancestors.reduce<Point>(
    (sum, item) => ({ x: sum.x + item.scrollLeft, y: sum.y + item.scrollTop }),
    { x: 0, y: 0 }
  )

  return {
    ancestors,
    sticky: Array.from(sticky).filter((element) => intersects(element, rect)),
    offset
  }
}

/**
 * Replay the collected scroll state onto the live page, which is what the
 * clone copies. Both mutations are snapshotted and restored synchronously by
 * the returned function.
 *
 * Sticky elements are pinned with `position: relative` instead of `fixed` so
 * they keep their slot in the flow; removing them from the flow would move all
 * of the following content and invalidate the crop.
 */
export function applyScrollReplay(replay: ScrollReplay): () => void {
  const restores: Array<() => void> = []

  for (const element of replay.sticky) {
    const snapshot = native.getAttribute(element, 'style')
    try {
      const pinned = native.getBoundingClientRect(element)
      setImportant(element, 'position', 'static')
      const natural = native.getBoundingClientRect(element)
      setImportant(element, 'position', 'relative')
      setImportant(element, 'top', `${Math.round(pinned.top - natural.top)}px`)
      setImportant(element, 'left', `${Math.round(pinned.left - natural.left)}px`)
    } catch {
      // A failed pin leaves the element at its static position, which is the
      // same result as not pinning it at all.
    }
    restores.push(() => restoreStyle(element, snapshot))
  }

  for (const item of replay.ancestors) {
    const { element } = item
    const snapshot = native.getAttribute(element, 'style')
    const scrollTop = (element as SizedElement).scrollTop
    const scrollLeft = (element as SizedElement).scrollLeft

    // With the clipping removed the clone lays the content out from the start
    // of the container; the clone-root shift moves the wanted slice back into
    // the viewport. Scrollbars disappear with `overflow: visible`.
    setImportant(element, 'overflow', 'visible')
    setImportant(element, 'overflow-x', 'visible')
    setImportant(element, 'overflow-y', 'visible')
    setImportant(element, 'scrollbar-width', 'none')

    // A scroller paints its background over its own box only. The clone root is
    // shifted up by the scroll offset, so that box no longer covers the slice
    // the crop shows and the page colour would show through. Growing the box to
    // the scroll size keeps the background behind the whole slice; the content
    // itself does not move.
    if (scrollTop !== 0) {
      const style = (element as StylableElement).style
      const inlineHeight = style.getPropertyValue('height')
      const inlinePriority = style.getPropertyPriority('height')
      const before = native.getBoundingClientRect(element)
      setImportant(
        element,
        'height',
        `${Math.max(1, Math.ceil((element as SizedElement).scrollHeight))}px`
      )
      const after = native.getBoundingClientRect(element)
      const moved =
        Math.abs(after.top - before.top) > 0.5 || Math.abs(after.left - before.left) > 0.5
      if (moved) {
        // A centred flex/grid item moved when it grew. Keep the crop aligned and
        // fall back to the unclipped rendering instead of shifting the content.
        if (inlineHeight) style.setProperty('height', inlineHeight, inlinePriority)
        else style.removeProperty('height')
      }
    }

    restores.push(() => {
      restoreStyle(element, snapshot)
      try {
        ;(element as SizedElement).scrollTop = scrollTop
        ;(element as SizedElement).scrollLeft = scrollLeft
      } catch {
        // Ignore elements that stopped being scroll containers.
      }
    })
  }

  return () => {
    for (let index = restores.length - 1; index >= 0; index -= 1) restores[index]?.()
  }
}
