import type { FramePickItem } from './frame-bridge'
import { expandedFrameSize, frameContentBox, frameOuterSize } from './frame-size'
import type { FrameSize } from './frame-size'
import type { ScrollAxis } from './scroll-axis'
import { describeTarget } from './target'
import type { TargetBox } from './target'

/**
 * One layer of the picker's stack, described the same way whether it lives in the
 * top document or inside a frame.
 *
 * The picker shows a label and a box and needs a scroll axis, but those numbers
 * are meaningless to it: inside a frame they come from the frame's own document
 * and are shifted into the top viewport here. Keeping the two cases in one type is
 * what lets wheel/arrow layer switching walk across a frame boundary.
 */
export interface PickTarget {
  /** The element, when it lives in the top document. */
  element: Element | null
  /** Frame that owns the element, or null for the top document. */
  frame: HTMLIFrameElement | null
  /**
   * Id the frame's helper assigned to the element. The capture travels back
   * through the bridge with this id, so the frame resolves the exact node it
   * reported even if the page changed in between.
   */
  frameElementId: number | null
  /**
   * Frames the capture has to walk through before that id means something: the
   * frame's own child ids, newest hop first. Empty for a layer of the frame
   * itself; two entries for a layer of a frame two levels down.
   */
  path: readonly number[]
  /**
   * How many frames deep this layer sits: 0 in the top document, 1 for a frame
   * the page embeds, 2 for a frame inside that frame.
   */
  frameLevel: number
  label: string
  /** The element's border box on screen, in top viewport coordinates. */
  rect: TargetBox
  /** The capture box: `rect` grown to the element's own scrollable content. */
  box: TargetBox
  scrollAxis: ScrollAxis | null
  fullPage: boolean
}

function clampSize(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 100) / 100) : 0
}

/** Keep a box inside the frame's viewport: what the user can actually see. */
function clipToFrame(rect: TargetBox, frame: TargetBox): TargetBox {
  const left = Math.min(Math.max(rect.left, frame.left), frame.left + frame.width)
  const top = Math.min(Math.max(rect.top, frame.top), frame.top + frame.height)
  const right = Math.min(Math.max(rect.left + rect.width, frame.left), frame.left + frame.width)
  const bottom = Math.min(Math.max(rect.top + rect.height, frame.top), frame.top + frame.height)
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  }
}

/**
 * Move layers a frame reported into its parent's client coordinates.
 *
 * The visible box is clipped to the frame's viewport because the rest is not on
 * screen, while the capture box is left unclipped: like a scroll container, an
 * element inside a frame can be taller than the window it is seen through, and
 * that growth is exactly what the dashed frame tells the user.
 *
 * `hop` names the frame the answer came from, and is prepended to every layer's
 * `via` so a capture knows which doors to walk through. The top document passes
 * no hop: it asks its frame directly, so no door has been crossed yet.
 */
export function liftFrameItems(
  view: TargetBox,
  items: readonly FramePickItem[],
  hop?: number
): FramePickItem[] {
  return items.map((item) => {
    const rect = clipToFrame(
      {
        left: view.left + item.left,
        top: view.top + item.top,
        width: clampSize(item.width),
        height: clampSize(item.height)
      },
      view
    )
    const via = hop === undefined ? (item.via ?? []) : [hop, ...(item.via ?? [])]
    return {
      ...item,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      contentWidth: clampSize(item.contentWidth),
      contentHeight: clampSize(item.contentHeight),
      ...(via.length ? { via } : {})
    }
  })
}

/**
 * A layer of this document, possibly with the size of the frame it is.
 *
 * A same-origin frame is measured while the layer is built (`getTargetBox()` can
 * read its document), so it needs nothing extra. A cross-origin frame can only
 * report its size over the bridge, which answers after the box was drawn — the
 * caller applies it with `expandFrameTarget()` when it arrives.
 */
export function elementTarget(element: Element): PickTarget {
  const info = describeTarget(element)
  return {
    element,
    frame: null,
    frameElementId: null,
    path: [],
    frameLevel: 0,
    label: info.label,
    rect: info.rect,
    box: info.box,
    scrollAxis: info.scrollAxis,
    fullPage: element === element.ownerDocument?.documentElement
  }
}

/**
 * Grow a frame layer's capture box to the size its helper reported.
 *
 * Picking a frame means "the whole frame", so the dashed box the picker draws has
 * to be the canvas the capture will produce. The number comes from the frame's own
 * document (see `expandedFrameSize`), and the border box is derived with the same
 * `frameOuterSize()` the capture uses to grow the copied frame — two places, one
 * formula.
 *
 * The button badge follows too: a frame whose document is taller than its viewport
 * is a scroll container from the user's point of view, so `Shift`+wheel can jump
 * onto it like onto any other one.
 */
export function expandFrameTarget(
  target: PickTarget,
  frame: HTMLIFrameElement,
  measured: FrameSize
): PickTarget {
  const content = expandedFrameSize(frame, measured)
  if (!content) return target
  const outer = frameOuterSize(frame, content)
  const width = Math.max(target.box.width, outer.width)
  const height = Math.max(target.box.height, outer.height)
  if (width <= target.box.width && height <= target.box.height) return target

  const growsWidth = width > target.rect.width
  const growsHeight = height > target.rect.height
  const scrollAxis: ScrollAxis | null =
    growsWidth && growsHeight ? 'both' : growsHeight ? 'y' : growsWidth ? 'x' : target.scrollAxis

  return {
    ...target,
    box: { left: target.box.left, top: target.box.top, width, height },
    scrollAxis
  }
}

/**
 * Shift the layers a frame reported into the top viewport.
 *
 * The visible box is clipped to the frame's viewport because the rest is not on
 * screen, while the capture box is left unclipped: like a scroll container, an
 * element inside a frame can be taller than the window it is seen through, and
 * that growth is exactly what the dashed frame tells the user.
 */
export function frameTargets(
  frame: HTMLIFrameElement,
  items: readonly FramePickItem[]
): PickTarget[] {
  const view = frameContentBox(frame)
  if (!view) return []

  return liftFrameItems(view, items).map((item) => ({
    element: null,
    frame,
    frameElementId: item.id,
    path: item.via ?? [],
    frameLevel: 1 + (item.via?.length ?? 0),
    label: item.label,
    rect: { left: item.left, top: item.top, width: item.width, height: item.height },
    box: {
      left: item.left,
      top: item.top,
      width: item.contentWidth,
      height: item.contentHeight
    },
    scrollAxis: item.scrollAxis,
    fullPage: item.fullPage
  }))
}
