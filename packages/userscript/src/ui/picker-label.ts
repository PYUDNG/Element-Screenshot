export interface PickerLabelPosition {
  left: number
  top: number
  maxWidth: number
}

const MARGIN = 8
const GAP = 8
const HEIGHT = 32
const MAX_WIDTH = 360

/**
 * Keep the hover label inside the viewport even when the picked element starts
 * above (or outside) the visible area. The label normally sits above the box;
 * when there is no room there it flips below and is clamped to both edges.
 */
export function computePickerLabelPosition(
  boxLeft: number,
  boxTop: number,
  viewportWidth: number,
  viewportHeight: number
): PickerLabelPosition {
  const width = Math.max(1, viewportWidth)
  const height = Math.max(1, viewportHeight)
  const maxWidth = Math.min(MAX_WIDTH, Math.max(1, width - MARGIN * 2))
  const maxLeft = Math.max(MARGIN, width - maxWidth - MARGIN)
  const maxTop = Math.max(MARGIN, height - HEIGHT - MARGIN)

  const preferredTop = boxTop - HEIGHT - GAP >= MARGIN ? boxTop - HEIGHT - GAP : boxTop + GAP
  const top = Math.min(Math.max(preferredTop, MARGIN), maxTop)
  const left = Math.min(Math.max(boxLeft, MARGIN), maxLeft)

  return { left, top, maxWidth }
}
