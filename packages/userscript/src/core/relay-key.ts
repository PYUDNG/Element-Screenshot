import { native } from './native'

/**
 * Keys pressed inside an iframe are dispatched in that frame's document, so while
 * the focus sits there the picker in the top document never sees Esc or its layer
 * keys.
 *
 * Rather than pulling the keyboard out of the frame — which blurs whatever the
 * page had focused — the frame reports the presses the picker could use, and the
 * top document replays each one as a `keydown` its own listeners handle. Only the
 * picker's keys are reported and plain letters or digits never cross the bridge
 * (Ctrl/Cmd+A is the only letter combination), so a page cannot use the relay to
 * read what was typed into the frame.
 *
 * The rest of the flow does not need this: starting a capture already blurs the
 * focused element, so the preview's shortcuts reach the top window directly.
 */

export interface RelayedKey {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** Keys the picker consumes while it is picking. */
const PICKER_KEYS = new Set([
  'Escape',
  'Enter',
  'Tab',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  '+',
  '=',
  '-',
  '_'
])

/**
 * Whether a frame should report this press (and swallow it locally).
 *
 * This is the frame's half of the decision: it only knows what the picker can
 * use, not whether the picker is open.
 */
export function isRelayedKey(key: string, command: boolean): boolean {
  if (PICKER_KEYS.has(key)) return true
  return command && key.toLowerCase() === 'a'
}

/** Whether the open picker consumes this press on its own. */
export function isPickerKey(stroke: RelayedKey): boolean {
  if (stroke.altKey) return false
  const command = stroke.ctrlKey || stroke.metaKey
  if (command) return stroke.key.toLowerCase() === 'a'
  return PICKER_KEYS.has(stroke.key)
}

/**
 * Replay a reported press as a `keydown` on the page body.
 *
 * The target is the body (not our shadow host) so the picker treats it as a
 * page-level press — a key event whose target is a marked UI node is deliberately
 * ignored there. Our window listeners run in the capture phase and stop
 * propagation for every key this function is allowed to send, so the page never
 * sees the replayed event.
 */
export function dispatchCaptureUiKey(stroke: RelayedKey, doc: Document = document): boolean {
  const target = doc.body ?? doc.documentElement
  if (!target) return false
  const event = new native.KeyboardEvent('keydown', {
    key: stroke.key,
    ctrlKey: stroke.ctrlKey,
    altKey: stroke.altKey,
    shiftKey: stroke.shiftKey,
    metaKey: stroke.metaKey,
    bubbles: true,
    cancelable: true,
    composed: true
  })
  target.dispatchEvent(event)
  return event.defaultPrevented
}
