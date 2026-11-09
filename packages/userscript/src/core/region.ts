import type { TargetBox } from './target'

/** Pointer travel that turns a click into a rectangle drag. */
export const REGION_DRAG_THRESHOLD = 4

/** Smallest region worth capturing instead of picking the element under it. */
export const REGION_MIN_SIZE = 8

export interface Point {
  x: number
  y: number
}

export interface ViewportSize {
  width: number
  height: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function clampPoint(point: Point, viewport: ViewportSize): Point {
  return {
    x: clamp(point.x, 0, Math.max(0, viewport.width)),
    y: clamp(point.y, 0, Math.max(0, viewport.height))
  }
}

export function dragDistance(start: Point, end: Point): number {
  return Math.hypot(end.x - start.x, end.y - start.y)
}

export function exceedsDragThreshold(
  start: Point,
  end: Point,
  threshold = REGION_DRAG_THRESHOLD
): boolean {
  return dragDistance(start, end) >= threshold
}

/**
 * Normalize a drag into a rectangle clamped to the viewport. Dragging up or to
 * the left is as valid as dragging down or to the right.
 */
export function regionFromPoints(start: Point, end: Point, viewport: ViewportSize): TargetBox {
  const from = clampPoint(start, viewport)
  const to = clampPoint(end, viewport)
  return {
    left: Math.min(from.x, to.x),
    top: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y)
  }
}

export function isCaptureRegion(rect: TargetBox, minSize = REGION_MIN_SIZE): boolean {
  return rect.width >= minSize && rect.height >= minSize
}

/**
 * Sample the centre and the four inset corners of a rectangle. Used to find the
 * elements a region touches and the sticky elements that stick to a panel.
 */
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

/** Keep a region inside the viewport so the crop never leaves the rendered surface. */
export function clampRegion(rect: TargetBox, viewport: ViewportSize): TargetBox {
  const width = Math.max(1, Math.round(viewport.width))
  const height = Math.max(1, Math.round(viewport.height))
  const left = clamp(rect.left, 0, width - 1)
  const top = clamp(rect.top, 0, height - 1)
  const right = clamp(rect.left + rect.width, left + 1, width)
  const bottom = clamp(rect.top + rect.height, top + 1, height)
  return { left, top, width: right - left, height: bottom - top }
}
