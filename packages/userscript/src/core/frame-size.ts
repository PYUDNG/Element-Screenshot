import { native } from './native'
import type { Point } from './region'
import type { TargetBox } from './target'

/** A CSS-pixel rectangle measured on a frame document. */
export interface FrameSize {
  width: number
  height: number
}

/**
 * Frames are measured without mutating them: the values below are what the frame
 * would show if its root scrolled content were expanded, which is exactly what the
 * expanded frame render produces. Keeping the measurement read-only is what lets
 * the picker size its box on hover and the parent size the copied frame box
 * before it knows the capture ratio.
 */

/** The frame's own document, or null when it is cross-origin. */
export function frameDocument(frame: HTMLIFrameElement): Document | null {
  try {
    // A cross-origin frame throws on some engines and answers null on others.
    return frame.contentDocument ?? null
  } catch (_error) {
    return null
  }
}

/** The frame's viewport in CSS pixels: the surface its viewport picture is drawn on. */
export function frameViewport(doc: Document | null): FrameSize | null {
  const win = doc?.defaultView
  if (!win) return null
  const width = Math.round(win.innerWidth)
  const height = Math.round(win.innerHeight)
  if (width < 1 || height < 1) return null
  return { width, height }
}

/**
 * The frame's viewport read from the element's own box.
 *
 * `clientWidth` / `clientHeight` are layout information about the element, so they
 * are readable for a cross-origin frame whose document is not. The copy carries
 * the same box as the live frame, so this is the fallback whenever the frame's
 * own document cannot be asked.
 */
export function frameElementViewport(frame: HTMLIFrameElement): FrameSize | null {
  const width = Math.round(frame.clientWidth)
  const height = Math.round(frame.clientHeight)
  if (width < 1 || height < 1) return null
  return { width, height }
}

/**
 * Where the frame's own viewport sits in its parent's coordinates.
 *
 * Points picked inside a frame are reported in the frame's client coordinates,
 * which start at this rectangle's top left (an iframe's viewport is its content
 * box, so the frame's border and padding are outside it). Reading the box from
 * the element is also the only way to place a cross-origin frame: its document
 * cannot be asked, but its box is ordinary layout information.
 */
export function frameContentBox(frame: HTMLIFrameElement): TargetBox | null {
  let style: CSSStyleDeclaration | null = null
  try {
    style = native.getComputedStyle(frame)
  } catch (_error) {
    // Geometry below still works for a frame without computed styles.
  }
  const rect = native.getBoundingClientRect(frame)
  const left = rect.left + parsePx(style?.borderLeftWidth ?? '') + parsePx(style?.paddingLeft ?? '')
  const top = rect.top + parsePx(style?.borderTopWidth ?? '') + parsePx(style?.paddingTop ?? '')
  const width = Math.round(
    frame.clientWidth - parsePx(style?.paddingLeft ?? '') - parsePx(style?.paddingRight ?? '')
  )
  const height = Math.round(
    frame.clientHeight - parsePx(style?.paddingTop ?? '') - parsePx(style?.paddingBottom ?? '')
  )
  if (width < 1 || height < 1) return null
  return { left, top, width, height }
}

/** The scroll offset the frame's viewport picture has to be shifted by. */
export function frameScroll(doc: Document): Point {
  const win = doc.defaultView
  return { x: Math.round(win?.scrollX ?? 0), y: Math.round(win?.scrollY ?? 0) }
}

/**
 * The size of everything the frame's document would show with its root expanded.
 *
 * A document's own `scrollWidth` / `scrollHeight` already cover whatever its root
 * can scroll through (and are never smaller than the viewport), so this needs no
 * snapshot and no style change. A frame whose document is still being parsed, or
 * one that is not laid out at all, reports null instead of a bogus size.
 */
export function frameContentSize(doc: Document | null): FrameSize | null {
  const root = doc?.documentElement
  if (!doc || !root) return null

  const body = doc.body
  const width = Math.max(root.scrollWidth, body?.scrollWidth ?? 0)
  const height = Math.max(root.scrollHeight, body?.scrollHeight ?? 0)
  if (width < 1 || height < 1) return null
  return { width: Math.ceil(width), height: Math.ceil(height) }
}

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Border box that gives an `<iframe>` exactly `content` of viewport.
 *
 * Setting the width/height of the copied frame is what grows it in the parent's
 * layout, and an iframe's viewport is its content box. The formula below holds for
 * both box-sizing models: it names the border box, so the content stays `content`.
 */
export function frameOuterSize(element: Element, content: FrameSize): FrameSize {
  let extraX = 0
  let extraY = 0
  try {
    const style = native.getComputedStyle(element)
    extraX =
      parsePx(style.borderLeftWidth) +
      parsePx(style.borderRightWidth) +
      parsePx(style.paddingLeft) +
      parsePx(style.paddingRight)
    extraY =
      parsePx(style.borderTopWidth) +
      parsePx(style.borderBottomWidth) +
      parsePx(style.paddingTop) +
      parsePx(style.paddingBottom)
  } catch (_error) {
    // Without computed styles the content box is the best available answer.
  }
  return {
    width: Math.ceil(content.width + extraX),
    height: Math.ceil(content.height + extraY)
  }
}
