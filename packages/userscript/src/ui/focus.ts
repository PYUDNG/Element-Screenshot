/**
 * Focus decides which document receives `keydown`.
 *
 * A click inside an iframe leaves the focus in that frame's document, so every
 * key press is dispatched there: the picker's own `Esc`, `+`/`-` and layer keys
 * never reached the top window and the user had to click the page first.
 * Blurring the frame hands the keyboard back to this document (the page body),
 * which is what a click on the page does anyway.
 */
export function isFrameFocus(doc: Document = document): boolean {
  if (typeof HTMLIFrameElement === 'undefined') return false
  return doc.activeElement instanceof HTMLIFrameElement
}

/** Blur a focused frame so the top document receives the keys again. */
export function takeFocusFromFrame(doc: Document = document): boolean {
  const active = doc.activeElement
  if (!isFrameFocus(doc) || !active) return false
  try {
    ;(active as HTMLIFrameElement).blur()
  } catch {
    return false
  }
  return doc.activeElement !== active
}
