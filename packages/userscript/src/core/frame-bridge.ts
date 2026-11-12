import { native } from './native'
import { frameContentBox } from './frame-size'
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
 * The picker travels over it too: `hover` asks which layers sit under a point of
 * the frame, and `capture` asks the frame to render one of them, because the
 * parent cannot read a cross-origin document and should not render a same-origin
 * one in the wrong realm either.
 *
 * The keyboard travels the other way: the frame asks for the shortcut once
 * (`subscribe`) and reports a press (`trigger`) that the parent then verifies
 * against its own setting, because a keydown inside a frame never reaches the top
 * document. While the capture UI is open the parent also tells frames so (`ui`),
 * and a frame reports the keys that UI uses (`key`) so the picker keeps working
 * without stealing the focus from the frame.
 */

/** Bump when the message shape or the frame renderer changes. */
export const FRAME_PROTOCOL = 'element-screenshot:frame/6'
/** How long a frame gets to answer the hello probe. */
export const FRAME_READY_TIMEOUT = 400
/** A hover answer is one hit test; a slow frame must not stall the crosshair. */
export const FRAME_PICK_TIMEOUT = 250
/** How many frames deep one hover answer may travel. */
export const MAX_FRAME_PIERCE = 3
/** How long one helper render may take before the parent stops waiting. */
export const FRAME_RESULT_TIMEOUT = 10_000
/** An element capture is a full render, so it gets the render budget. */
export const FRAME_CAPTURE_TIMEOUT = 10_000
/** Measuring is a read of two layout properties; it must not stall the capture. */
export const FRAME_SIZE_TIMEOUT = 3_000
/** A layer stack is a handful of ancestors; a broken frame must not flood the UI. */
export const MAX_PICK_ITEMS = 64
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

/**
 * Frame asks its parent which shortcut to watch for.
 *
 * Nothing that travels *up* carries the token. A message a frame sends up is
 * delivered into the parent window, and the parent's own page scripts can read
 * it — which is exactly the window the token has to stay hidden from. The
 * presses this channel carries cannot be authenticated for the same reason: the
 * frame's page shares a window with the frame's copy of the script, so anything
 * that copy could prove, the page can replay. Dropping the secret at least keeps
 * the token out of the hands of an embedding page.
 */
export interface FrameSubscribeMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'subscribe'
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
  nonce: string
  shortcut: string
}

/** Whether the capture UI is open in the top document. */
export interface FrameUiMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'ui'
  token: string
  nonce: string
  active: boolean
  /**
   * True while the picker has no transparent layer of its own: the pointer lands
   * in the frame, so the frame is the only side that can report it.
   */
  passthrough: boolean
}

/** A key the capture UI consumes, reported while it is open. */
export interface FrameKeyMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'key'
  nonce: string
  key: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * One layer under the point, in the frame's own client coordinates.
 *
 * `id` is what a later `capture` request names: the frame keeps the node, so the
 * parent never has to send a selector (or trust one) into a foreign document.
 */
export interface FramePickItem {
  id: number
  label: string
  left: number
  top: number
  width: number
  height: number
  contentWidth: number
  contentHeight: number
  scrollAxis: 'x' | 'y' | 'both' | null
  fullPage: boolean
  /**
   * Frames to walk through before `id` means something, newest hop first.
   *
   * A layer two frames down is named by the ids of the frames the answer had to
   * travel through, because each frame keeps its own `id` registry and the parent
   * never sends a selector into a document it cannot read.
   */
  via?: number[]
}

/** Parent asks which layers of the frame sit under one point. */
export interface FrameHoverMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'hover'
  token: string
  nonce: string
  x: number
  y: number
  /** How many frames below this one may still be pierced. */
  depth: number
}

/** The frame's answer: topmost layer first, like `getElementStack`. */
export interface FrameStackMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'stack'
  nonce: string
  items: FramePickItem[]
  error?: string
}

/** How the frame paints the backdrop of the element it is asked to capture. */
export interface FrameCaptureBackground {
  mode: 'page' | 'color' | 'transparent'
  color?: string
}

/** Parent asks the frame to render one layer it reported earlier. */
export interface FrameCaptureMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'capture'
  token: string
  nonce: string
  /** `FramePickItem.id` from a previous `stack` answer. */
  elementId: number
  /** Frames to walk through first; empty means the element lives here. */
  via?: number[]
  ratio: number
  expandNested: boolean
  background: FrameCaptureBackground
}

/** The frame's picture of that element, at the parent's ratio. */
export interface FrameCapturedMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'captured'
  nonce: string
  blob: Blob | null
  width: number
  height: number
  limited: boolean
  error?: string
}

/** Stop a render the parent no longer waits for. */
export interface FrameCancelMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'cancel'
  token: string
  nonce: string
}

/**
 * Where the pointer is inside a frame, in that frame's client coordinates.
 *
 * Only travels upward, and only while the top document has the picker open with
 * the transparent layer off: the pointer then enters the frame and the top window
 * stops seeing it. A click is the capture gesture, so the frame swallows it and
 * reports it instead of letting the page navigate.
 */
export interface FramePointerMessage {
  protocol: typeof FRAME_PROTOCOL
  type: 'pointer'
  nonce: string
  kind: 'move' | 'click'
  x: number
  y: number
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
  | FrameUiMessage
  | FrameKeyMessage
  | FrameHoverMessage
  | FrameStackMessage
  | FrameCaptureMessage
  | FrameCapturedMessage
  | FramePointerMessage
  | FrameCancelMessage

const MESSAGE_TYPES = new Set([
  'hello',
  'ready',
  'measure',
  'size',
  'render',
  'result',
  'subscribe',
  'hotkey',
  'trigger',
  'ui',
  'key',
  'hover',
  'stack',
  'capture',
  'captured',
  'pointer',
  'cancel'
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
  /** Called once when a cancelled capture ends the wait early. */
  onCancel?: () => void
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
          options.onCancel?.()
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
    // Frames render in parallel, so a cancelled capture has to stop them all
    // instead of leaving them working on pictures nobody will look at.
    onCancel: () => {
      postFrameCancel(win)
    },
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
  return postFrameMessage(win.parent, {
    protocol: FRAME_PROTOCOL,
    type: 'subscribe',
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
  return postFrameMessage(win.parent, {
    protocol: FRAME_PROTOCOL,
    type: 'trigger',
    nonce: createNonce(),
    shortcut
  })
}

/** Tell one frame whether the capture UI is open in the top document. */
export function postUiState(win: Window | null, active: boolean, passthrough = false): boolean {
  const token = frameToken
  if (!token || !win) return false
  return postFrameMessage(win, {
    protocol: FRAME_PROTOCOL,
    type: 'ui',
    token,
    nonce: createNonce(),
    active,
    passthrough
  })
}

/** Report a pointer position inside this frame to its parent. */
export function postFramePointer(win: Window, kind: 'move' | 'click', x: number, y: number): boolean {
  return postFrameMessage(win.parent, {
    protocol: FRAME_PROTOCOL,
    type: 'pointer',
    nonce: createNonce(),
    kind,
    x,
    y
  })
}

export interface FramePointerBridgeOptions {
  /** Where the pointer is, in the top document's client coordinates. */
  onMove: (point: { x: number; y: number }, frame: HTMLIFrameElement) => void
  /** The user clicked inside a frame: this is the capture gesture. */
  onClick: (point: { x: number; y: number }, frame: HTMLIFrameElement) => void
  win?: Window
}

/**
 * Receive pointer reports from the frames the document embeds.
 *
 * The point arrives in the frame's own client coordinates and is shifted here, so
 * the picker keeps working in one coordinate space. Only a direct child frame can
 * be the source — a nested frame's report is relayed by its own parent, which is
 * the child we see — and anything outside that frame's viewport is dropped.
 */
export function installFramePointerBridge(options: FramePointerBridgeOptions): () => void {
  const win = options.win ?? window

  const frameFor = (source: Window): HTMLIFrameElement | null => {
    const root = native.document.documentElement
    if (!root) return null
    for (const element of Array.from(native.querySelectorAll(root, 'iframe'))) {
      const frame = element as HTMLIFrameElement
      if (frameWindow(frame) === source) return frame
    }
    return null
  }

  const handler = (event: Event): void => {
    const message = readFrameMessage((event as MessageEvent).data)
    if (!message || message.type !== 'pointer') return
    const source = (event as MessageEvent).source as Window | null
    if (!source) return
    const frame = frameFor(source)
    if (!frame) return
    const view = frameContentBox(frame)
    if (!view) return
    const x = view.left + message.x
    const y = view.top + message.y
    if (
      x < view.left ||
      x > view.left + view.width ||
      y < view.top ||
      y > view.top + view.height
    ) {
      return
    }
    if (message.kind === 'click') options.onClick({ x, y }, frame)
    else options.onMove({ x, y }, frame)
  }

  native.addEventListener(win, 'message', handler, true)
  return () => native.removeEventListener(win, 'message', handler, true)
}

/** Report one press to the parent so the open capture UI can act on it. */
export function postRelayedKey(
  win: Window,
  key: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }
): boolean {
  return postFrameMessage(win.parent, {
    protocol: FRAME_PROTOCOL,
    type: 'key',
    nonce: createNonce(),
    key: key.key,
    ctrlKey: key.ctrlKey,
    altKey: key.altKey,
    shiftKey: key.shiftKey,
    metaKey: key.metaKey
  })
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
}

function readAxis(value: unknown): 'x' | 'y' | 'both' | null {
  return value === 'x' || value === 'y' || value === 'both' ? value : null
}

/** How many frame hops an answer still has to walk back through. */
const MAX_VIA = 8

/**
 * Read the frame chain a layer or a capture request travels through.
 *
 * Ids are opaque numbers chosen by the frame that reported them. A malformed
 * chain is rejected instead of guessed at: treating it as "no hops" would send
 * the capture to the wrong document and render whatever shares that id there.
 */
export function readVia(value: unknown): number[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > MAX_VIA) return null
  const via: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1) return null
    via.push(entry)
  }
  return via
}

/**
 * Validate a layer stack a frame reported.
 *
 * A frame describes its own document, so the parent never fully trusts those
 * numbers: anything malformed is dropped and the list is capped, otherwise one
 * broken (or hostile) frame could flood the picker with thousands of layers.
 */
export function readPickItems(value: unknown): FramePickItem[] {
  if (!Array.isArray(value)) return []
  const items: FramePickItem[] = []
  for (const entry of value.slice(0, MAX_PICK_ITEMS)) {
    if (!entry || typeof entry !== 'object') continue
    const raw = entry as Record<string, unknown>
    const via = readVia(raw.via)
    if (via === null) continue
    const item: FramePickItem = {
      id: finiteNumber(raw.id),
      label: typeof raw.label === 'string' ? raw.label.slice(0, 120) : '',
      left: finiteNumber(raw.left),
      top: finiteNumber(raw.top),
      width: finiteNumber(raw.width),
      height: finiteNumber(raw.height),
      contentWidth: finiteNumber(raw.contentWidth),
      contentHeight: finiteNumber(raw.contentHeight),
      scrollAxis: readAxis(raw.scrollAxis),
      fullPage: raw.fullPage === true,
      ...(via.length ? { via } : {})
    }
    if (!Number.isInteger(item.id) || item.id < 1) continue
    if (![item.left, item.top, item.width, item.height, item.contentWidth, item.contentHeight].every(Number.isFinite)) {
      continue
    }
    items.push(item)
  }
  return items
}

export interface FramePickRequest {
  /** Point in the frame's own client coordinates. */
  x: number
  y: number
  /** How many frames below this one may still be pierced. */
  depth?: number
  timeout?: number
}

/**
 * Ask one frame which layers sit under a point.
 *
 * Returns an empty list when the frame answered with nothing usable, and null
 * when it did not answer at all — the caller stops asking a frame that has no
 * helper instead of paying a timeout on every mouse move.
 */
export async function requestFramePick(
  frame: HTMLIFrameElement,
  request: FramePickRequest
): Promise<FramePickItem[] | null> {
  const token = frameToken
  const win = frameWindow(frame)
  if (!token || !win) return null

  const depth = Math.min(Math.max(Math.floor(request.depth ?? 1), 1), MAX_FRAME_PIERCE)
  const nonce = createNonce()
  let items: FramePickItem[] | null = null
  let failure = ''
  const sent = postFrameMessage(win, {
    protocol: FRAME_PROTOCOL,
    type: 'hover',
    token,
    nonce,
    x: request.x,
    y: request.y,
    depth
  })
  if (!sent) return null

  await waitForMessages({
    // Every hop below this one gets its own budget, so the deepest answer still
    // fits inside the wait.
    timeout: request.timeout ?? FRAME_PICK_TIMEOUT * depth,
    onMessage: (message, event) => {
      if (message.type !== 'stack') return false
      if (message.nonce !== nonce || event.source !== win) return false
      failure = message.error ?? ''
      items = readPickItems(message.items)
      return true
    }
  })

  if (failure) console.warn('[element-screenshot] frame helper failed:', failure)
  return items
}

export interface FrameCaptureRequest {
  elementId: number
  /** Frames to walk through first; empty means `elementId` lives in this frame. */
  via?: number[]
  ratio: number
  expandNested: boolean
  background: FrameCaptureBackground
  timeout?: number
}

export interface FrameCapturePayload {
  blob: Blob
  width: number
  height: number
  limited: boolean
}

/**
 * Ask one frame to capture a layer it reported before.
 *
 * The frame captures in its own realm, which is what makes the element's fonts,
 * its pixel ratio and, for a cross-origin frame, the document itself available.
 * Cancelling the capture cancels the frame's render too, instead of leaving it
 * working on a picture nobody will look at.
 */
export async function requestFrameCapture(
  frame: HTMLIFrameElement,
  request: FrameCaptureRequest
): Promise<FrameCapturePayload | null> {
  const token = frameToken
  const win = frameWindow(frame)
  if (!token || !win) return null

  const nonce = createNonce()
  let payload: FrameCapturePayload | null = null
  let failure = ''
  const sent = postFrameMessage(win, {
    protocol: FRAME_PROTOCOL,
    type: 'capture',
    token,
    nonce,
    elementId: request.elementId,
    ...(request.via && request.via.length ? { via: request.via.slice(0, MAX_VIA) } : {}),
    ratio: request.ratio,
    expandNested: request.expandNested,
    background: request.background
  })
  if (!sent) return null

  await waitForMessages({
    timeout: request.timeout ?? FRAME_CAPTURE_TIMEOUT,
    onCancel: () => {
      postFrameCancel(win)
    },
    onMessage: (message, event) => {
      if (message.type !== 'captured') return false
      if (message.nonce !== nonce || event.source !== win) return false
      failure = message.error ?? ''
      const width = Number(message.width)
      const height = Number(message.height)
      if (message.blob && Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1) {
        payload = {
          blob: message.blob,
          width,
          height,
          limited: message.limited === true
        }
      }
      return true
    }
  })

  if (failure) console.warn('[element-screenshot] frame helper failed:', failure)
  return payload
}

/** Tell one frame to stop rendering what it was asked for. */
export function postFrameCancel(win: Window | null): boolean {
  const token = frameToken
  if (!token || !win) return false
  return postFrameMessage(win, {
    protocol: FRAME_PROTOCOL,
    type: 'cancel',
    token,
    nonce: createNonce()
  })
}
