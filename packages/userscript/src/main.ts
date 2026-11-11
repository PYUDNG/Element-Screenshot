/*!
 * Element Screenshot
 * Bundled libraries:
 * - Vue 3.5.44 (MIT) — https://github.com/vuejs/core
 * - html-to-image 1.11.13 (MIT) — https://github.com/bubkoo/html-to-image
 * - Tailwind CSS 4.3.4 (MIT) — https://github.com/tailwindlabs/tailwindcss
 */
import { GM_getValue, GM_setValue } from '$'
import { native } from './core/native'
import { setFrameToken } from './core/frame-bridge'
import { installFrameHelper } from './core/frame-helper'
import { installFrameHotkey } from './core/hotkey-bridge'
import { startApp } from './app'

/** Storage key of the per-install secret that gates the frame helper. */
const FRAME_TOKEN_KEY = 'element-screenshot:frame-token'
/** Fallback when the manager does not answer a storage read with a string. */
const TOKEN_PATTERN = /^[A-Za-z0-9-]{8,80}$/

function createToken(): string {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return random
}

/**
 * Every frame of this script has to prove that it is talking to the same install,
 * so a page cannot use the helper to screenshot a frame it embeds. The page
 * cannot read userscript storage, which makes a stored token a usable secret.
 *
 * Two frames can generate one at the same moment; both read the value back after
 * writing, so they converge on whichever write landed last.
 */
function ensureFrameToken(): string {
  try {
    const stored = GM_getValue<unknown>(FRAME_TOKEN_KEY, null)
    if (typeof stored === 'string' && TOKEN_PATTERN.test(stored)) return stored
    GM_setValue(FRAME_TOKEN_KEY, createToken())
    const written = GM_getValue<unknown>(FRAME_TOKEN_KEY, null)
    return typeof written === 'string' ? written : ''
  } catch (error) {
    console.warn('[element-screenshot] frame token unavailable', error)
    return ''
  }
}

const token = ensureFrameToken()
setFrameToken(token)

if (window === window.top) {
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
} else if (token) {
  // A frame serves the parent only: no UI, no menu commands, no settings panel.
  installFrameHelper()
  // Keys pressed inside a frame never reach the top document, so the frame
  // reports the shortcut upward instead of starting a capture of its own.
  installFrameHotkey()
}
