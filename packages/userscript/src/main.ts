/*!
 * Element Screenshot
 * Bundled libraries:
 * - Vue 3.5.44 (MIT) — https://github.com/vuejs/core
 * - html-to-image 1.11.13 (MIT) — https://github.com/bubkoo/html-to-image
 * - Tailwind CSS 4.3.4 (MIT) — https://github.com/tailwindlabs/tailwindcss
 * - @noble/ciphers 2.4.0 (MIT) — https://github.com/paulmillr/noble-ciphers
 * - @noble/hashes 2.4.0 (MIT) — https://github.com/paulmillr/noble-hashes
 */
import { GM_deleteValue, GM_getValue, GM_setValue } from '$'
import { native } from './core/native'
import { setFrameKey } from './core/frame-bridge'
import { createFrameKey, isFrameKey } from './core/frame-crypto'
import { installFrameHelper } from './core/frame-helper'
import { installFramePointer } from './core/frame-pointer'
import { installFrameHotkey } from './core/hotkey-bridge'
import { installEarlyPickerListeners } from './core/picker'
import { startApp } from './app'

/** Storage key of the per-install secret every frame of this script seals with. */
const FRAME_KEY_KEY = 'element-screenshot:frame-key'
/** The pre-sealing builds shared a token; nothing reads it anymore. */
const LEGACY_TOKEN_KEY = 'element-screenshot:frame-token'

/**
 * Every frame of this script has to share one secret with the parent, or the
 * bridge could be driven by any page that embeds a frame. The page cannot read
 * userscript storage, so a key stored there is a secret it never sees — and
 * because messages are sealed rather than signed, the key itself never travels.
 *
 * Two frames can generate one at the same moment; both read the value back after
 * writing, so they converge on whichever write landed last.
 */
function ensureFrameKey(): string {
  try {
    const stored = GM_getValue<unknown>(FRAME_KEY_KEY, null)
    if (isFrameKey(stored)) return stored
    GM_setValue(FRAME_KEY_KEY, createFrameKey())
    const written = GM_getValue<unknown>(FRAME_KEY_KEY, null)
    return isFrameKey(written) ? written : ''
  } catch (error) {
    console.warn('[element-screenshot] frame key unavailable', error)
    return ''
  }
}

function dropLegacyToken(): void {
  try {
    GM_deleteValue(LEGACY_TOKEN_KEY)
  } catch {
    // A manager without the API keeps a stale value that nothing reads.
  }
}

const frameKey = ensureFrameKey()
setFrameKey(frameKey)
dropLegacyToken()

if (window === window.top) {
  // Before DOMContentLoaded, i.e. before any page script can register its own
  // listeners: the picker has to be first in the window capture queue, otherwise
  // a page that stops propagation can make picking silently do nothing.
  installEarlyPickerListeners()
  const begin = (): void => {
    try {
      startApp()
    } catch (error) {
      console.error('[element-screenshot] failed to start', error)
    }
  }
  if (document.readyState === 'loading') {
    native.addEventListener(document, 'DOMContentLoaded', begin, { once: true })
  } else {
    begin()
  }
} else if (frameKey) {
  // A frame serves the parent only: no UI, no menu commands, no settings panel.
  installFrameHelper()
  // Keys pressed inside a frame never reach the top document, so the frame
  // reports the shortcut upward instead of starting a capture of its own.
  installFrameHotkey()
  // With mouse passthrough on the pointer never reaches the top document either.
  installFramePointer()
}
