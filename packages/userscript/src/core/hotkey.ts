import { isEditableTarget, matchesShortcut, parseShortcut } from '@element-shot/settings'
import { native } from './native'

export interface HotkeyOptions {
  getShortcut: () => string
  onTrigger: () => void
  shouldIgnore?: (event: KeyboardEvent) => boolean
}

/**
 * Registers a capture-phase global shortcut. The shortcut is re-read on every
 * keydown so settings changes apply immediately.
 */
export function installHotkey(options: HotkeyOptions): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.repeat || event.defaultPrevented) return
    if (options.shouldIgnore?.(event)) return

    const shortcut = parseShortcut(options.getShortcut())
    if (!shortcut || !matchesShortcut(event, shortcut)) return

    const editable = isEditableTarget(event.target)
    const hasCommandModifier = shortcut.ctrl || shortcut.alt || shortcut.meta
    if (editable && !hasCommandModifier) return

    event.preventDefault()
    event.stopPropagation()
    options.onTrigger()
  }

  native.addEventListener(window, 'keydown', handler, true)
  return () => native.removeEventListener(window, 'keydown', handler, true)
}
