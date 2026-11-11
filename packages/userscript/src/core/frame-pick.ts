import type { FramePickItem } from './frame-bridge'
import { elementTarget } from './pick-target'
import { getElementStack } from './target'

/** One reported layer plus the node it describes, for the frame's own registry. */
export interface FramePickCandidate {
  element: Element
  /** Wire shape, with `id` still unset. */
  item: FramePickItem
}

/**
 * Describe the layers under a point of this document.
 *
 * Runs inside the frame, where the coordinates are the frame's own client
 * coordinates. The parent shifts them into its viewport; everything else (label,
 * boxes, scroll axis) is read here so a cross-origin frame needs to send numbers
 * only. The topmost layer comes first, matching `getElementStack`.
 */
export function collectFramePickCandidates(
  doc: Document,
  x: number,
  y: number
): FramePickCandidate[] {
  const candidates: FramePickCandidate[] = []
  for (const element of getElementStack(x, y, doc)) {
    const target = elementTarget(element)
    candidates.push({
      element,
      item: {
        id: 0,
        label: target.label,
        left: target.rect.left,
        top: target.rect.top,
        width: target.rect.width,
        height: target.rect.height,
        contentWidth: target.box.width,
        contentHeight: target.box.height,
        scrollAxis: target.scrollAxis,
        fullPage: target.fullPage
      }
    })
  }
  return candidates
}
