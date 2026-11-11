import { isEditableTarget, matchesShortcut, parseShortcut } from '@element-screenshot/settings'
import { native } from './native'

export interface HotkeyOptions {
  getShortcut: () => string
  onTrigger: () => void
  shouldIgnore?: (event: KeyboardEvent) => boolean
}

/**
 * A keydown stripped down to what the shortcut needs.
 *
 * The same shape is built from a real `KeyboardEvent` in the top document and
 * from the `trigger` message a frame reports, so both ends of the bridge apply
 * exactly one rule instead of two that can drift apart.
 */
export interface KeyStroke {
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
  repeat: boolean
  defaultPrevented: boolean
  /** The press landed in a text field, where a bare key belongs to the page. */
  editable: boolean
}

export function describeKeyStroke(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'repeat' | 'defaultPrevented'
  > & { target?: EventTarget | null },
  editable = isEditableTarget(event.target ?? null)
): KeyStroke {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    defaultPrevented: event.defaultPrevented,
    editable
  }
}

/**
 * Whether this press should start a capture.
 *
 * A shortcut without Ctrl/Alt/Meta (the settings only ever store those or a
 * function key) is ignored while the user is typing, so `F5` inside a search box
 * still reaches the page.
 */
export function isTriggerStroke(stroke: KeyStroke, shortcut: string): boolean {
  if (stroke.repeat || stroke.defaultPrevented) return false
  const parsed = parseShortcut(shortcut)
  if (!parsed || !matchesShortcut(stroke, parsed)) return false
  const hasCommandModifier = parsed.ctrl || parsed.alt || parsed.meta
  return !(stroke.editable && !hasCommandModifier)
}

/**
 * Registers a capture-phase global shortcut. The shortcut is re-read on every
 * keydown so settings changes apply immediately.
 */
export function installHotkey(options: HotkeyOptions): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.repeat || event.defaultPrevented) return
    if (options.shouldIgnore?.(event)) return
    if (!isTriggerStroke(describeKeyStroke(event), options.getShortcut())) return

    event.preventDefault()
    event.stopPropagation()
    options.onTrigger()
  }

  native.addEventListener(window, 'keydown', handler, true)
  return () => native.removeEventListener(window, 'keydown', handler, true)
}
