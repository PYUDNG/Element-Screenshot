import { native } from './native'

/**
 * `overflow` values that let the user scroll an element.
 *
 * `hidden` and `clip` are deliberately absent: they cut content off as a layout
 * decision, and there is no way for the user to reach what is cut. Treating
 * them as "more content" is what made the picker badge lie about 30×30 icons.
 */
export const SCROLL_OVERFLOW = new Set(['auto', 'scroll', 'overlay'])

export type ScrollAxis = 'y' | 'x' | 'both'

export interface ScrollContainerInfo {
  /** Null when the element does not scroll by itself. */
  axis: ScrollAxis | null
  /** Content size, which is what a capture of this element would produce. */
  contentWidth: number
  contentHeight: number
  /** Clipped size per axis; zero when nothing is cut off. */
  overflowX: number
  overflowY: number
}

const NO_SCROLL: ScrollContainerInfo = {
  axis: null,
  contentWidth: 0,
  contentHeight: 0,
  overflowX: 0,
  overflowY: 0
}

/** Guard against sub-pixel layout noise: a real scrollport overflows by more. */
const OVERFLOW_EPSILON = 1

function overflowRules(element: Element): { x: boolean; y: boolean } | null {
  try {
    const style = native.getComputedStyle(element)
    return { x: SCROLL_OVERFLOW.has(style.overflowX), y: SCROLL_OVERFLOW.has(style.overflowY) }
  } catch (_error) {
    return null
  }
}

/**
 * Decide whether an element is a scroll container the user can actually scroll,
 * and along which axis. This is the single predicate behind the picker badge,
 * the capture box and the region-slice collector, so they cannot disagree.
 */
export function scrollContainerInfo(element: Element): ScrollContainerInfo {
  const contentWidth = Number(element.scrollWidth) || 0
  const contentHeight = Number(element.scrollHeight) || 0
  const overflowX = contentWidth - (Number(element.clientWidth) || 0)
  const overflowY = contentHeight - (Number(element.clientHeight) || 0)

  const overflow = overflowRules(element)
  if (!overflow) return { ...NO_SCROLL, contentWidth, contentHeight }

  const scrollsX = overflow.x && overflowX > OVERFLOW_EPSILON
  const scrollsY = overflow.y && overflowY > OVERFLOW_EPSILON
  const axis: ScrollAxis | null =
    scrollsX && scrollsY ? 'both' : scrollsY ? 'y' : scrollsX ? 'x' : null

  return {
    axis,
    contentWidth,
    contentHeight,
    overflowX: Math.max(0, overflowX),
    overflowY: Math.max(0, overflowY)
  }
}
