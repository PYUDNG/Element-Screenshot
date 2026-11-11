import { native } from './native'
import { describeKeyStroke, isTriggerStroke } from './hotkey'
import {
  getFrameToken,
  postHotkeyConfig,
  postHotkeyTrigger,
  readFrameMessage,
  subscribeToHotkey
} from './frame-bridge'

/**
 * The keyboard shortcut has to cross a frame boundary.
 *
 * A keydown fired while focus is inside an iframe is dispatched in that frame's
 * document and never reaches the top window, so the global shortcut installed by
 * `installHotkey()` is blind to it. Every frame therefore watches its own keys
 * and reports a press, and the top document verifies that press against its own
 * setting — the frame only knows the shortcut it was told about, which may be one
 * settings change old.
 *
 * Who learns what:
 * - the frame is told the shortcut (and nothing else) over the authenticated
 *   bridge, so a page cannot point the frame at a key of its choosing and use the
 *   reports as a keylogger;
 * - the parent is told *that* the shortcut was pressed plus the shortcut string it
 *   already knows, never the key that was typed.
 */

/** How often a frame asks for the shortcut before it stops trying. */
const SUBSCRIBE_DELAYS = [0, 250, 750, 2_000, 5_000, 10_000]

export interface HotkeyBridgeOptions {
  getShortcut: () => string
  onTrigger: () => void
  /** Suppress the press while the capture UI is open or busy. */
  shouldIgnore?: () => boolean
  /** Window that owns the shortcut; the top document by default. */
  win?: Window
}

export interface HotkeyBridge {
  /** Push the current shortcut to every frame that subscribed. */
  broadcast: () => void
  dispose: () => void
}

/**
 * Top-document end of the bridge: answer `subscribe`, verify `trigger`.
 *
 * Frames are remembered when they subscribe instead of being enumerated from the
 * DOM on every change, so a broadcast only ever reaches a frame that runs this
 * script. A frame that loads before the UI exists retries its `subscribe`.
 */
export function installHotkeyBridge(options: HotkeyBridgeOptions): HotkeyBridge {
  const win = options.win ?? window
  const subscribers = new Set<Window>()

  const broadcast = (): void => {
    const shortcut = options.getShortcut()
    for (const frameWin of subscribers) {
      if (!postHotkeyConfig(frameWin, shortcut)) subscribers.delete(frameWin)
    }
  }

  const handler = (event: Event): void => {
    const message = readFrameMessage((event as MessageEvent).data)
    if (!message) return
    const token = getFrameToken()
    if (!token) return

    if (message.type === 'subscribe') {
      if (message.token !== token) return
      const source = (event as MessageEvent).source
      if (!source) return
      subscribers.add(source as Window)
      postHotkeyConfig(source as Window, options.getShortcut())
      return
    }

    if (message.type === 'trigger') {
      if (message.token !== token) return
      // The frame matched its own copy of the shortcut; drop the press if the
      // setting changed after that copy was handed out.
      if (message.shortcut !== options.getShortcut()) return
      if (options.shouldIgnore?.()) return
      options.onTrigger()
    }
  }

  native.addEventListener(win, 'message', handler, true)
  broadcast()
  return {
    broadcast,
    dispose: () => native.removeEventListener(win, 'message', handler, true)
  }
}

export interface FrameHotkeyOptions {
  /** Frame window that listens for the keys; the current one by default. */
  win?: Window
  /** How long to wait before each subscription attempt. */
  attempts?: readonly number[]
}

/**
 * Frame end of the bridge: ask for the shortcut, watch for it, relay it upward.
 *
 * Nothing happens until the parent hands out a shortcut, so a frame whose page
 * never gets an answer (another install, the site is disabled, no UI yet) stays
 * inert. A frame nested inside another frame subscribes to its own parent and
 * relays presses upward, so the top document is the only place that starts a
 * capture.
 */
export function installFrameHotkey(options: FrameHotkeyOptions = {}): () => void {
  const win = options.win ?? window
  const delays = options.attempts ?? SUBSCRIBE_DELAYS
  const subscribers = new Set<Window>()
  let shortcut = ''
  let timer = 0

  const stopAsking = (): void => {
    if (timer) native.clearTimeout(timer)
    timer = 0
  }

  const pushConfig = (): void => {
    for (const childWin of subscribers) {
      if (!postHotkeyConfig(childWin, shortcut)) subscribers.delete(childWin)
    }
  }

  const ask = (index: number): void => {
    if (shortcut || index >= delays.length) return
    timer = native.setTimeout(() => {
      timer = 0
      if (shortcut) return
      subscribeToHotkey(win)
      ask(index + 1)
    }, delays[index])
  }

  const handleMessage = (event: Event): void => {
    const message = readFrameMessage((event as MessageEvent).data)
    if (!message) return
    const token = getFrameToken()
    if (!token) return
    const source = (event as MessageEvent).source as Window | null

    if (message.type === 'hotkey') {
      // Only the parent configures us, and only this install may do it.
      if (message.token !== token || (event as MessageEvent).source !== win.parent) return
      shortcut = message.shortcut
      if (shortcut) stopAsking()
      pushConfig()
      return
    }

    if (message.type === 'subscribe') {
      if (message.token !== token || !source) return
      subscribers.add(source)
      if (shortcut) postHotkeyConfig(source, shortcut)
      return
    }

    if (message.type === 'trigger') {
      // A press inside a nested frame stops here only long enough to pass it on.
      // `source === win` would be our own post coming back (only possible if this
      // relay were installed in the top document) — never relay that.
      if (message.token !== token || !source || source === win) return
      postHotkeyTrigger(win, message.shortcut)
    }
  }

  const handleKeyDown = (event: Event): void => {
    if (!shortcut) return
    const stroke = describeKeyStroke(event as KeyboardEvent)
    if (!isTriggerStroke(stroke, shortcut)) return
    event.preventDefault()
    event.stopPropagation()
    postHotkeyTrigger(win, shortcut)
  }

  native.addEventListener(win, 'message', handleMessage, true)
  native.addEventListener(win, 'keydown', handleKeyDown, true)
  ask(0)

  return () => {
    stopAsking()
    native.removeEventListener(win, 'message', handleMessage, true)
    native.removeEventListener(win, 'keydown', handleKeyDown, true)
  }
}
