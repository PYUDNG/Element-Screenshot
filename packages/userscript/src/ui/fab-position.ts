/**
 * Placement of the floating capture button.
 *
 * The button has two resting modes. Undocked it keeps a small margin to every
 * viewport edge. Docked it sits flush against one edge and is parked half
 * outside the viewport, so `Fab.vue` can slide it back in on hover — the
 * geometry lives here so it can be reasoned about (and tested) without a DOM.
 *
 * A docked button owns exactly one edge: the other axis stays free. Docking two
 * edges at once would leave a quarter of a button in a corner, which is neither
 * findable nor clickable.
 */

export type FabDock = 'left' | 'right' | 'top' | 'bottom'

export interface FabViewport {
  width: number
  height: number
}

export interface FabPlacement {
  left: number
  top: number
  dock: FabDock | null
}

export interface FabPeek {
  /** Offset that hides half of the button; `none` when fully visible. */
  transform: string
  opacity: number
}

/** Inset kept by free placements, so the button never touches an edge. */
export const FAB_MARGIN = 12

/**
 * How close to an edge a drop has to be before the button docks. Deliberately
 * small: docking hides half of the button, so it has to be a decision and not an
 * accident while dragging past an edge.
 */
export const DOCK_DISTANCE = 10

/** Opacity of a docked button while it is parked half outside the viewport. */
export const FAB_PEEK_OPACITY = 0.55

interface Range {
  min: number
  max: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Coordinate that puts the button flush against the far edge. */
export function edgeMax(extent: number, size: number): number {
  return Math.max(0, extent - size)
}

/** Resting range of a free placement: never flush, never outside the viewport. */
export function freeRange(extent: number, size: number): Range {
  return { min: FAB_MARGIN, max: Math.max(FAB_MARGIN, extent - size - FAB_MARGIN) }
}

/** Position used while dragging, which has to reach the edges to dock at all. */
export function clampToViewport(
  left: number,
  top: number,
  viewport: FabViewport,
  size: number
): { left: number; top: number } {
  return {
    left: clamp(Math.round(left), 0, edgeMax(viewport.width, size)),
    top: clamp(Math.round(top), 0, edgeMax(viewport.height, size))
  }
}

/** Free placement restored from the stored position ratios (0..1). */
export function placeFree(
  ratioX: number,
  ratioY: number,
  viewport: FabViewport,
  size: number
): { left: number; top: number } {
  const x = freeRange(viewport.width, size)
  const y = freeRange(viewport.height, size)
  const left = clamp(ratioX, 0, 1)
  const top = clamp(ratioY, 0, 1)
  return {
    left: clamp(Math.round(left * (viewport.width - size)), x.min, x.max),
    top: clamp(Math.round(top * (viewport.height - size)), y.min, y.max)
  }
}

/** Ratio to persist for one axis of a free placement. */
export function freeRatio(value: number, extent: number, size: number): number {
  if (!(extent > size)) return 0
  return clamp(value / (extent - size), 0, 1)
}

/** Closest edge to a position, with the distance to it in pixels. */
export function nearestDock(
  left: number,
  top: number,
  viewport: FabViewport,
  size: number
): { dock: FabDock; distance: number } {
  const options: Array<{ dock: FabDock; distance: number }> = [
    { dock: 'left', distance: left },
    { dock: 'right', distance: edgeMax(viewport.width, size) - left },
    { dock: 'top', distance: top },
    { dock: 'bottom', distance: edgeMax(viewport.height, size) - top }
  ]
  return options.reduce((best, item) => (item.distance < best.distance ? item : best))
}

/** Resting placement of a docked button: flush on one axis, free on the other. */
export function placeDocked(
  dock: FabDock,
  free: { left: number; top: number },
  viewport: FabViewport,
  size: number
): FabPlacement {
  switch (dock) {
    case 'left':
      return { left: 0, top: free.top, dock }
    case 'right':
      return { left: edgeMax(viewport.width, size), top: free.top, dock }
    case 'top':
      return { left: free.left, top: 0, dock }
    case 'bottom':
      return { left: free.left, top: edgeMax(viewport.height, size), dock }
  }
}

/** Placement restored on load from the stored ratios plus the stored dock edge. */
export function placeStored(
  ratioX: number,
  ratioY: number,
  viewport: FabViewport,
  size: number,
  dock: FabDock | null
): FabPlacement {
  const free = placeFree(ratioX, ratioY, viewport, size)
  return dock ? placeDocked(dock, free, viewport, size) : { ...free, dock: null }
}

/**
 * Placement for a button dropped at `left`/`top`: dock when the drop is within
 * `DOCK_DISTANCE` of an edge, otherwise keep it inside the free range.
 */
export function resolveDrop(
  left: number,
  top: number,
  viewport: FabViewport,
  size: number
): FabPlacement {
  const point = clampToViewport(left, top, viewport, size)
  const nearest = nearestDock(point.left, point.top, viewport, size)
  if (nearest.distance > DOCK_DISTANCE) {
    const x = freeRange(viewport.width, size)
    const y = freeRange(viewport.height, size)
    return {
      left: clamp(point.left, x.min, x.max),
      top: clamp(point.top, y.min, y.max),
      dock: null
    }
  }
  // The docked axis is flush, so the other one has to stay inside its margin.
  const x = freeRange(viewport.width, size)
  const y = freeRange(viewport.height, size)
  const free = {
    left: clamp(point.left, x.min, x.max),
    top: clamp(point.top, y.min, y.max)
  }
  return placeDocked(nearest.dock, free, viewport, size)
}

/** Visual state of a docked button: half outside the viewport until hovered. */
export function peekStyle(placement: FabPlacement, revealed: boolean): FabPeek {
  if (!placement.dock || revealed) return { transform: 'none', opacity: 1 }
  const shift = placement.dock === 'left' || placement.dock === 'right' ? 'translateX' : 'translateY'
  const sign = placement.dock === 'left' || placement.dock === 'top' ? '-' : ''
  return { transform: `${shift}(${sign}50%)`, opacity: FAB_PEEK_OPACITY }
}

/** Read a dock edge back from storage, ignoring anything unrecognised. */
export function readDock(value: unknown): FabDock | null {
  switch (value) {
    case 'left':
    case 'right':
    case 'top':
    case 'bottom':
      return value
    default:
      return null
  }
}
