import { native } from './native'
import type { FrameSize } from './frame-size'

/**
 * Bridge to the copy of this script that runs inside an iframe.
 *
 * html-to-image resolves the computed style of the document it renders, and the
 * webfont embedder reads that document's stylesheets. Rendering a frame inside
 * the frame is therefore both the accurate path (its fonts, its device pixel
 * ratio, its `color-scheme`) and the only path for a cross-origin frame, whose
 * document the parent cannot read at all.
 *
 * The parent still keeps a fallback: a frame the manager does not inject into
 * (`about:blank`, `srcdoc`, a sandbox without `allow-scripts`) or one that is
 * still starting up never answers, and a same-origin frame is then rendered by
 * the parent the way it was before this bridge existed.
 *
 * Two requests travel over the bridge: `measure` (how tall the document is once
 * its root is expanded, used to size the frame's box) and `render` (the picture).
 * The keyboard shortcut travels the other way: the frame asks for the shortcut
 * once (`subscribe`) and reports a press (`trigger`) that the parent then
 * verifies against its own setting, because a keydown inside a frame never
 * reaches the top document.
 */

/** Bump when the message shape or the frame renderer changes. */
export const FRAME_PROTOCOL = 'element-screenshot:frame/3'
/** How long a frame gets to answer the hello probe. */
export const FRAME_READY_TIMEOUT = 400
/** How long one helper render may take before the parent stops waiting. */
export const FRAME_RESULT_TIMEOUT = 10_000
/** Measuring is a read of two layout properties; it must not stall the capture. */
export const FRAME_SIZE_TIMEOUT = 3_000
/** How often a pending request checks whether the capture was cancelled. */
const CANCEL_POLL_INTERVAL = 100

export interface FrameHelloMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'hello'
  token: string
  nonce: string
}

export interface FrameReadyMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'ready'
  nonce: string
}

export interface FrameMeasureMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'measure'
  token: string
  nonce: string
}

export interface FrameSizeMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'size'
  nonce: string
  /** Zero when the helper could not measure its document. */
  width: number
  height: number
  error?: string
}

export interface FrameRenderMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'render'
  token: string
  nonce: string
  /** Capture ratio of the parent, so the frame picture matches its pixels. */
  ratio: number
  /** Nesting depth of the frame being rendered. */
  depth: number
  /**
   * Render the whole document on this surface instead of the current viewport.
   * The parent sends the size it already reserved for the frame's box.
   */
  expand?: FrameSize
}

export interface FrameResultMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'result'
  nonce: string
  blob: Blob | null
  error?: string
}

/** Frame asks its parent which shortcut to watch for. */
export interface FrameSubscribeMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'subscribe'
  token: string
  nonce: string
}

/** Parent hands its current shortcut to a frame. */
export interface FrameHotkeyMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'hotkey'
  token: string
  nonce: string
  shortcut: string
}

/**
 * A frame saw its shortcut pressed. The shortcut string is repeated so the
 * parent can drop a press that was matched against an outdated configuration.
 */
export interface FrameTriggerMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'trigger'
  token: string
  nonce: string
  shortcut: string
}

export type FrameMessage =
  | FrameHelloMessage
  | FrameReadyMessage
  | FrameMeasureMessage
  | FrameSizeMessage
  | FrameRenderMessage
  | FrameResultMessage
  | FrameSubscribeMessage
  | FrameHotkeyMessage
  | FrameTriggerMessage

const MESSAGE_TYPES = new Set([
  'hello',
  'ready',
  'measure',
  'size',
  'render',
  'result',
  'subscribe',
  'hotkey',
  'trigger'
])

/**
 * Per-install secret shared by every frame of this script.
 *
 * The helper renders its own page, so without a gate any site could embed a page
 * in an iframe and ask our helper for a picture of it — a same-origin bypass for
 * whatever the frame shows. The page itself cannot read the userscript storage,
 * so a token from there proves that the request comes from this script.
 */
let frameToken = ''

export function setFrameToken(token: string): void {
  frameToken = token
}

export function getFrameToken(): string {
  return frameToken
}

let nonceCounter = 0

function createNonce(): string {
  nonceCounter += 1
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${random}-${nonceCounter}`
}

/** The helper window of a frame, or null when the frame has no browsing context. */
export function frameWindow(frame: HTMLIFrameElement): Window | null {
  try {
    return frame.contentWindow ?? null
  } catch (_error) {
    return null
  }
}

/** Reject anything that is not a current protocol message. */
export function readFrameMessage(value: unknown): FrameMessage | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.protocol !== FRAME_PROTOCOL) return null
  if (typeof data.type !== 'string' || !MESSAGE_TYPES.has(data.type)) return null
  if (typeof data.nonce !== 'string' || data.nonce.length === 0) return null
  return value as FrameMessage
}

export function postFrameMessage(target: Window | null, message: FrameMessage): boolean {
  if (!target) return false
  try {
    target.postMessage(message, '*')
    return true
  } catch (_error) {
    return false
  }
}

interface FrameWaitOptions {
  timeout: number
  /** Handle one validated message; return true when the wait is over. */
  onMessage: (message: FrameMessage, event: MessageEvent) => boolean
}

/**
 * Wait for bridge messages, ending early on the first `true`, on the timeout or
 * on a cancelled capture. The listener stays on the capture phase so a page that
 * stops propagation cannot hide an answer.
 */
function waitForMessages(options: FrameWaitOptions): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let poll = 0
    const finish = (): void => {
      if (settled) return
      settled = true
      native.removeEventListener(window, 'message', listener, true)
      native.clearTimeout(timer)
      native.clearTimeout(poll)
      resolve()
    }
    const listener = (event: Event): void => {
      const message = readFrameMessage((event as MessageEvent).data)
      if (!message) return
      if (options.onMessage(message, event as MessageEvent)) finish()
    }
    const tick = (): void => {
      poll = native.setTimeout(() => {
        if (settled) return
        if (native.capture.aborted) {
          finish()
          return
        }
        tick()
      }, CANCEL_POLL_INTERVAL)
    }

    native.addEventListener(window, 'message', listener, true)
    const timer = native.setTimeout(finish, options.timeout)
    tick()
  })
}

export interface FrameProbeOptions {
  timeout?: number
}

/**
 * Find the frames that run a helper.
 *
 * Every frame is asked at once and the answers are collected in one window, so a
 * page full of frames without a helper costs one timeout instead of one each.
 */
export async function probeFrameHelpers(
  frames: readonly HTMLIFrameElement[],
  options: FrameProbeOptions = {}
): Promise<Set<HTMLIFrameElement>> {
  const ready = new Set<HTMLIFrameElement>()
  const token = frameToken
  if (!token) return ready

  const pending = new Map<string, { frame: HTMLIFrameElement; win: Window }>()
  for (const frame of frames) {
    const win = frameWindow(frame)
    if (!win) continue
    const nonce = createNonce()
    pending.set(nonce, { frame, win })
    postFrameMessage(win, { protocol: FRAME_PROTOCOL, type: 'hello', token, nonce })
  }
  if (pending.size === 0) return ready

  await waitForMessages({
    timeout: options.timeout ?? FRAME_READY_TIMEOUT,
    onMessage: (message, event) => {
      if (message.type !== 'ready') return false
      const entry = pending.get(message.nonce)
      if (!entry || event.source !== entry.win) return false
      pending.delete(message.nonce)
      ready.add(entry.frame)
      return pending.size === 0
    }
  })

  return ready
}

export interface FrameRenderRequest {
  ratio: number
  depth: number
  /** Render the whole document instead of its current viewport. */
  expand?: FrameSize
  timeout?: number
}

/** Ask one helper for a picture of its viewport; null when it does not answer. */
export async function requestFrameImage(
  frame: HTMLIFrameElement,
  request: FrameRenderRequest
): Promise<Blob | null> {
  const token = frameToken
  const win = frameWindow(frame)
  if (!token || !win) return null

  const nonce = createNonce()
  let image: Blob | null = null
  let failure = ''
  const sent = postFrameMessage(win, {
    protocol: FRAME_PROTOCOL,
    type: 'render',
    token,
    nonce,
    ratio: request.ratio,
    depth: request.depth,
    ...(request.expand ? { expand: request.expand } : {})
  })
  if (!sent) return null

  await waitForMessages({
    timeout: request.timeout ?? FRAME_RESULT_TIMEOUT,
    onMessage: (message, event) => {
      if (message.type !== 'result') return false
      if (message.nonce !== nonce || event.source !== win) return false
      image = message.blob ?? null
      failure = message.error ?? ''
      return true
    }
  })

  if (failure) console.warn('[element-screenshot] frame helper failed:', failure)
  return image
}

export interface FrameSizeRequest {
  timeout?: number
}

/**
 * Ask one helper how large its document is when its root is expanded.
 *
 * A cross-origin frame's document cannot be read from the parent, and the parent
 * needs that number before it can reserve the frame's box in its own layout. The
 * helper answers from its own `scrollWidth` / `scrollHeight`, without rendering.
 */
export async function requestFrameSize(
  frame: HTMLIFrameElement,
  request: FrameSizeRequest = {}
): Promise<FrameSize | null> {
  const token = frameToken
  const win = frameWindow(frame)
  if (!token || !win) return null

  const nonce = createNonce()
  let size: FrameSize | null = null
  let failure = ''
  const sent = postFrameMessage(win, { protocol: FRAME_PROTOCOL, type: 'measure', token, nonce })
  if (!sent) return null

  await waitForMessages({
    timeout: request.timeout ?? FRAME_SIZE_TIMEOUT,
    onMessage: (message, event) => {
      if (message.type !== 'size') return false
      if (message.nonce !== nonce || event.source !== win) return false
      failure = message.error ?? ''
      const width = Number(message.width)
      const height = Number(message.height)
      if (Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1) {
        size = { width, height }
      }
      return true
    }
  })

  if (failure) console.warn('[element-screenshot] frame helper failed:', failure)
  return size
}

/**
 * Ask the parent for the current shortcut.
 *
 * A keydown fired inside a frame stays in that frame, so the frame has to know
 * which combination to watch for. It cannot read the settings (they live in the
 * top realm), and the frame may load before the parent's UI exists, so the
 * caller retries a few times.
 */
export function subscribeToHotkey(win: Window = window): boolean {
  const token = frameToken
  if (!token) return false
  return postFrameMessage(win.parent, {
    protocol: FRAME_PROTOCOL,
    type: 'subscribe',
    token,
    nonce: createNonce()
  })
}

/** Hand the current shortcut to one frame. */
export function postHotkeyConfig(win: Window | null, shortcut: string): boolean {
  const token = frameToken
  if (!token || !win) return false
  return postFrameMessage(win, {
    protocol: FRAME_PROTOCOL,
    type: 'hotkey',
    token,
    nonce: createNonce(),
    shortcut
  })
}

/** Tell the parent that the shortcut was pressed inside this frame. */
export function postHotkeyTrigger(win: Window, shortcut: string): boolean {
  const token = frameToken
  if (!token) return false
  return postFrameMessage(win.parent, {
    protocol: FRAME_PROTOCOL,
    type: 'trigger',
    token,
    nonce: createNonce(),
    shortcut
  })
}
