import { native } from './native'
import { frameLevels } from './frame-levels'
import { frameContentBox } from './frame-size'
import type { FrameSize } from './frame-size'
import {
  ReplayGuard,
  decodePayload,
  deriveFrameKey,
  encodePayload,
  open,
  randomId,
  seal
} from './frame-crypto'

/**
 * Sealed bridge to the copy of this script that runs inside an iframe.
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
 * Everything on the wire is sealed (see `core/frame-crypto.ts`): the key comes
 * from the userscript storage, which no page can read, and never travels. A
 * message that opens therefore proves it came from this install, and a page can
 * neither read one nor forge one. The envelope only says *which kind* of message
 * it is, so it can be routed; the body — coordinates, element ids, DOM layers,
 * PNG bytes — is inside the box.
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
export const FRAME_PROTOCOL = 'element-screenshot:frame/7'
/** How long a frame gets to answer the hello probe. */
export const FRAME_READY_TIMEOUT = 400
/** A hover answer is one hit test; a slow frame must not stall the crosshair. */
export const FRAME_PICK_TIMEOUT = 250
/** A chain this short is not worth another round trip. */
export const FRAME_PICK_MIN_BUDGET = 40
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

/** Every message the bridge knows, in the order they were added. */
const MESSAGE_TYPES = [
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
] as const

export type FrameMessageType = (typeof MESSAGE_TYPES)[number]

const MESSAGE_TYPE_SET = new Set<string>(MESSAGE_TYPES)

/**
 * Which way each message travels.
 *
 * A message only ever has one direction, and the direction is part of the
 * associated data, so a box sealed for one type cannot be re-labelled as another
 * and replayed at a different stage of the conversation.
 */
const DIRECTIONS: Record<FrameMessageType, 'down' | 'up'> = {
  hello: 'down',
  ready: 'up',
  measure: 'down',
  size: 'up',
  render: 'down',
  result: 'up',
  subscribe: 'up',
  hotkey: 'down',
  trigger: 'up',
  ui: 'down',
  key: 'up',
  hover: 'down',
  stack: 'up',
  capture: 'down',
  captured: 'up',
  pointer: 'up',
  cancel: 'down'
}

/**
 * The only messages that may arrive before the receiver's session id is known.
 *
 * `hello` is the parent's first contact with a frame, `subscribe` is a frame's
 * first contact with its parent. Everything else has to name the receiver, which
 * is what keeps one frame's ciphertext from being replayed into another.
 */
const HANDSHAKES = new Set<FrameMessageType>(['hello', 'subscribe'])

/** What every sealed message carries besides its business fields. */
export interface FrameHeader {
  /** The sender's session id. */
  sid: string
  /** The receiver's session id; empty only in a handshake. */
  to: string
  /** The sender's own counter, monotonic for the life of its session. */
  seq: number
  /** Echoed by a reply so the request it answers can be matched. */
  nonce: string
}

/** The routing layer: everything a page can see. */
export interface FrameEnvelope {
  protocol: typeof FRAME_PROTOCOL
  type: FrameMessageType
  /** `nonce ‖ ciphertext ‖ tag`, as produced by `seal()`. */
  box: Uint8Array
}

/** One message, opened and authenticated. */
export interface OpenedFrameMessage {
  type: FrameMessageType
  header: FrameHeader
  /** Business fields, without the header. */
  data: Record<string, unknown>
  /** Picture bytes that travelled with the message, if any. */
  binary: Uint8Array | null
}

/** Capture ratio and nesting depth the parent asks a frame to render with. */
export interface FrameRenderData {
  ratio: number
  /** Nesting level of the frame being asked; 1 for a frame in the root page. */
  depth: number
  /**
   * How many levels of frames the whole render may paint.
   *
   * Optional on the wire: a build that predates it falls back to two levels, so
   * an old frame answers a new parent (and the other way round) as it always did.
   */
  maxDepth?: number
  /**
   * Render the whole document on this surface instead of the current viewport.
   * The parent sends the size it already reserved for the frame's box.
   */
  expand?: FrameSize
}

/** The frame's answer to `measure`; zero when it could not measure. */
export interface FrameSizeData {
  width: number
  height: number
  error?: string
}

/** The frame's answer to `render`; the picture bytes are the binary tail. */
export interface FrameResultData {
  /** MIME type of the binary tail; PNG unless a frame says otherwise. */
  mime?: string
  error?: string
}

/** The parent's current shortcut. */
export interface FrameHotkeyData {
  shortcut: string
}

/**
 * A frame saw its shortcut pressed. The shortcut string is repeated so the
 * parent can drop a press that was matched against an outdated configuration.
 */
export interface FrameTriggerData {
  shortcut: string
}

/** Whether the capture UI is open in the top document. */
export interface FrameUiData {
  active: boolean
  /**
   * True while the picker has no transparent layer of its own: the pointer lands
   * in the frame, so the frame is the only side that can report it.
   */
  passthrough: boolean
}

/** A key the capture UI consumes, reported while it is open. */
export interface FrameKeyData {
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
export interface FrameHoverData {
  x: number
  y: number
  /** How many frames below this one may still be pierced. */
  depth: number
  /**
   * When the whole answer is due, as an absolute `Date.now()`.
   *
   * Every frame runs on the same clock, so one deadline shared down the chain
   * keeps a deep pick as fast as a shallow one: a hop only gets the budget that
   * is left, instead of another full timeout of its own.
   */
  deadline: number
}

/** The frame's answer: topmost layer first, like `getElementStack`. */
export interface FrameStackData {
  items: unknown
  error?: string
}

/** How the frame paints the backdrop of the element it is asked to capture. */
export interface FrameCaptureBackground {
  mode: 'page' | 'color' | 'transparent'
  color?: string
}

/** Parent asks the frame to render one layer it reported earlier. */
export interface FrameCaptureData {
  /** `FramePickItem.id` from a previous `stack` answer. */
  elementId: number
  /** Frames to walk through first; empty means the element lives here. */
  via?: number[]
  ratio: number
  expandNested: boolean
  background: FrameCaptureBackground
  /** Frame levels the captured element's own frames may paint; see `FrameRenderData`. */
  maxDepth?: number
}

/** The frame's picture of that element, at the parent's ratio. */
export interface FrameCapturedData {
  width: number
  height: number
  limited: boolean
  /** MIME type of the binary tail; PNG unless a frame says otherwise. */
  mime?: string
  error?: string
}

/**
 * Where the pointer is inside a frame, in that frame's client coordinates.
 *
 * Only travels upward, and only while the top document has the picker open with
 * the transparent layer off: the pointer then enters the frame and the top window
 * stops seeing it. A click is the capture gesture, so the frame swallows it and
 * reports it instead of letting the page navigate.
 */
export interface FramePointerData {
  kind: 'move' | 'click'
  x: number
  y: number
}

/**
 * The associated data one sealed message is bound to.
 *
 * The protocol and the type keep a box from being replayed at another stage, and
 * the direction keeps a message from being turned around: a `hover` box can never
 * open as a `stack` reply.
 */
export function frameAad(type: FrameMessageType): string {
  return `${FRAME_PROTOCOL}|${type}|${DIRECTIONS[type]}`
}

/**
 * This realm's half of the bridge.
 *
 * The top document and every frame each run their own copy of this module, so
 * one module-level session is exactly one endpoint: its own id, its own sequence
 * numbers and its own view of who it is talking to.
 */
let frameKey: Uint8Array | null = null
let sessionId = ''
let sequence = 0
let peers = new WeakMap<Window, string>()
let replay = new ReplayGuard()

/**
 * Install the sealed bridge for this realm.
 *
 * The stored secret is 32 random bytes in hex. It is turned into an AEAD key
 * here, and only the derived key is kept in memory; the stored value is never
 * sent anywhere. An empty or malformed secret leaves the bridge silent, which is
 * the safe direction to fail in.
 */
export function setFrameKey(secret: string): boolean {
  frameKey = secret ? deriveFrameKey(secret) : null
  sessionId = frameKey ? randomId(8) : ''
  sequence = 0
  peers = new WeakMap()
  replay = new ReplayGuard()
  return frameKey !== null
}

/** Whether this realm can talk over the bridge at all. */
export function hasFrameKey(): boolean {
  return frameKey !== null
}

/** This realm's session id; tests address messages with it. */
export function getFrameSessionId(): string {
  return sessionId
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

/**
 * Read the routing layer only.
 *
 * Deliberately no decryption here: this runs for every message a page could send,
 * and it must stay a cheap shape check. Callers that care about the content go
 * through `openFrameMessage` / `decodeFrameEvent`.
 */
export function readFrameEnvelope(value: unknown): FrameEnvelope | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (data.protocol !== FRAME_PROTOCOL) return null
  if (typeof data.type !== 'string' || !MESSAGE_TYPE_SET.has(data.type)) return null
  const box = data.box
  if (!(box instanceof Uint8Array)) return null
  // A nonce and a tag are 40 bytes; anything shorter cannot even be an empty box.
  if (box.length <= 40) return null
  return value as FrameEnvelope
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 ? value : null
}

/** Reject a header that could not have been written by this module. */
function readHeader(value: unknown): FrameHeader | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const sid = readId(raw.sid)
  const to = typeof raw.to === 'string' && raw.to.length <= 64 ? raw.to : null
  const nonce = typeof raw.nonce === 'string' && raw.nonce.length <= 128 ? raw.nonce : null
  const seq = raw.seq
  if (sid === null || to === null || nonce === null) return null
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 1) return null
  return { sid, to, seq, nonce }
}

/**
 * Seal one message for this endpoint.
 *
 * The sequence number is minted here, which is why every sender has to go through
 * this function (or through `postFrameTo`): a message without a fresh number
 * would be dropped as a replay.
 */
export function sealFrameMessage(
  type: FrameMessageType,
  data: Record<string, unknown> = {},
  options: { to?: string; nonce?: string; binary?: Uint8Array | null } = {}
): FrameEnvelope | null {
  if (!frameKey || !sessionId) return null
  sequence += 1
  const header: FrameHeader = {
    sid: sessionId,
    to: options.to ?? '',
    seq: sequence,
    nonce: options.nonce ?? createNonce()
  }
  // The header goes last so a business field can never overwrite it.
  const plain = encodePayload({ ...data, ...header }, options.binary ?? null)
  return { protocol: FRAME_PROTOCOL, type, box: seal(frameKey, frameAad(type), plain) }
}

/**
 * Open and authenticate one message, or return null.
 *
 * Every failure — a page's forgery, another install's key, a box that was
 * tampered with or re-labelled — is the same null, so probing teaches nothing.
 * This does not check whether the message belongs to this session; that is
 * `decodeFrameEvent`'s job, and keeping them apart lets a test read the wire
 * without consuming a sequence number.
 */
export function openFrameMessage(value: unknown): OpenedFrameMessage | null {
  const envelope = readFrameEnvelope(value)
  if (!envelope || !frameKey) return null
  const plain = open(frameKey, frameAad(envelope.type), envelope.box)
  if (!plain) return null
  const decoded = decodePayload(plain)
  if (!decoded) return null
  const header = readHeader(decoded.meta)
  if (!header) return null
  const data = { ...(decoded.meta as Record<string, unknown>) }
  delete data.sid
  delete data.to
  delete data.seq
  delete data.nonce
  return { type: envelope.type, header, data, binary: decoded.binary }
}

/**
 * Decoded messages of the events already seen, so the several listeners that
 * share one window do not each decrypt and replay-check the same delivery.
 *
 * The first listener to see an event decides whether the message is accepted (and
 * consumes its sequence number); the rest read the same answer. Without this a
 * frame's `ui` would be consumed by the keyboard bridge before the pointer bridge
 * ever saw it.
 */
const openedEvents = new WeakMap<Event, OpenedFrameMessage | null>()

/**
 * Authenticate one `message` event and claim it for this endpoint.
 *
 * A message is ours when it names this session, or when it is a handshake from a
 * peer that does not know our id yet. The sender's id and sequence number are
 * then checked against the replay guard, and the sender is remembered so replies
 * can be addressed to it.
 */
export function decodeFrameEvent(event: MessageEvent): OpenedFrameMessage | null {
  const cached = openedEvents.get(event)
  if (cached !== undefined) return cached

  const opened = openFrameMessage(event.data)
  const source = event.source as Window | null
  let accepted: OpenedFrameMessage | null = null
  if (opened && source) {
    const addressed =
      opened.header.to === sessionId ||
      (opened.header.to === '' && HANDSHAKES.has(opened.type))
    if (addressed && replay.accept(opened.header.sid, opened.type, opened.header.seq)) {
      peers.set(source, opened.header.sid)
      accepted = opened
    }
  }
  openedEvents.set(event, accepted)
  return accepted
}

/** Post an already sealed envelope. */
export function postFrameMessage(target: Window | null, envelope: FrameEnvelope): boolean {
  if (!target) return false
  try {
    target.postMessage(envelope, '*')
    return true
  } catch (_error) {
    return false
  }
}

export interface FrameSendOptions {
  /** Request nonce to echo; a fresh one is minted otherwise. */
  nonce?: string
  /** Bytes that travel next to the JSON header. */
  binary?: Uint8Array | null
  /** A peer that does not know our id yet: `hello` and `subscribe` only. */
  handshake?: boolean
}

/**
 * Seal one message and post it to a peer.
 *
 * Refuses when the peer's session id is unknown: a sealed message has to name its
 * receiver, otherwise one frame's ciphertext could be replayed into another. The
 * exceptions are the two handshakes, which are how the ids are learned.
 */
export function postFrameTo(
  target: Window | null,
  type: FrameMessageType,
  data: Record<string, unknown> = {},
  options: FrameSendOptions = {}
): boolean {
  if (!target || !frameKey) return false
  const known = peers.get(target)
  if (known === undefined && !options.handshake) return false
  const envelope = sealFrameMessage(type, data, {
    to: known ?? '',
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    ...(options.binary === undefined ? {} : { binary: options.binary })
  })
  if (!envelope) return false
  return postFrameMessage(target, envelope)
}

/** Read a blob's bytes without assuming either API exists in this realm. */
function blobBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('The picture could not be read'))
    reader.readAsArrayBuffer(blob)
  })
}

/**
 * Seal a reply, carrying a picture in the binary tail.
 *
 * Frame pictures go over as raw bytes: base64 would add a third to a multi-
 * megabyte PNG and copy it again, and the box takes bytes just as well.
 */
export async function postFrameReply(
  target: Window | null,
  type: FrameMessageType,
  data: Record<string, unknown>,
  options: { nonce: string; blob?: Blob | null }
): Promise<boolean> {
  const binary = options.blob ? await blobBytes(options.blob) : null
  return postFrameTo(target, type, data, { nonce: options.nonce, binary })
}

/** Rebuild a picture from the binary tail of a reply. */
function pictureFrom(message: OpenedFrameMessage): Blob | null {
  if (!message.binary) return null
  const mime = message.data.mime
  // Copy into a fresh buffer: the tail is a view into the decrypted payload, and
  // a Blob part has to own a plain ArrayBuffer.
  const bytes = new Uint8Array(message.binary.length)
  bytes.set(message.binary)
  return new Blob([bytes], {
    type: typeof mime === 'string' && mime.length > 0 ? mime : 'image/png'
  })
}

interface FrameWaitOptions {
  timeout: number
  /** Handle one authenticated message; return true when the wait is over. */
  onMessage: (message: OpenedFrameMessage, event: MessageEvent) => boolean
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
      const message = decodeFrameEvent(event as MessageEvent)
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

/** Stop addressing a window: a navigation makes its old session id useless. */
function forgetPeer(win: Window): void {
  peers.delete(win)
}

/**
 * Make sure a peer's session id is known, asking with `hello` if it is not.
 *
 * The handshake is one round trip inside the same browser process, so it is
 * cheap for a frame that runs the helper. A frame without one stays silent and
 * costs the (short) timeout once, after which the caller stops asking for a
 * while.
 */
async function ensurePeer(win: Window, timeout: number): Promise<boolean> {
  if (peers.has(win)) return true
  const nonce = createNonce()
  if (!postFrameTo(win, 'hello', {}, { nonce, handshake: true })) return false
  let found = false
  await waitForMessages({
    timeout,
    onMessage: (message, event) => {
      if (event.source !== win || message.type !== 'ready') return false
      if (message.header.nonce !== nonce) return false
      found = true
      return true
    }
  })
  return found
}

export interface FrameProbeOptions {
  timeout?: number
}

/**
 * Find the frames that run a helper.
 *
 * Every frame is asked at once and the answers are collected in one window, so a
 * page full of frames without a helper costs one timeout instead of one each.
 * A `ready` also teaches the parent that frame's session id, which is what every
 * later request to it is addressed with.
 */
export async function probeFrameHelpers(
  frames: readonly HTMLIFrameElement[],
  options: FrameProbeOptions = {}
): Promise<Set<HTMLIFrameElement>> {
  const ready = new Set<HTMLIFrameElement>()
  if (!frameKey) return ready

  const pending = new Map<string, { frame: HTMLIFrameElement; win: Window }>()
  for (const frame of frames) {
    const win = frameWindow(frame)
    if (!win) continue
    const nonce = createNonce()
    if (!postFrameTo(win, 'hello', {}, { nonce, handshake: true })) continue
    pending.set(nonce, { frame, win })
  }
  if (pending.size === 0) return ready

  await waitForMessages({
    timeout: options.timeout ?? FRAME_READY_TIMEOUT,
    onMessage: (message, event) => {
      if (message.type !== 'ready') return false
      const entry = pending.get(message.header.nonce)
      if (!entry || event.source !== entry.win) return false
      pending.delete(message.header.nonce)
      ready.add(entry.frame)
      return pending.size === 0
    }
  })

  return ready
}

export interface FrameRenderRequest {
  ratio: number
  depth: number
  /**
   * Levels of nested frames the render may paint, including this one.
   *
   * The frame itself is level 1 inside the parent's own render, and its frames
   * are level 2, so the number travels unchanged down the chain.
   */
  maxDepth?: number
  /** Render the whole document instead of its current viewport. */
  expand?: FrameSize
  timeout?: number
}

/** Ask one helper for a picture of its viewport; null when it does not answer. */
export async function requestFrameImage(
  frame: HTMLIFrameElement,
  request: FrameRenderRequest
): Promise<Blob | null> {
  const win = frameWindow(frame)
  if (!frameKey || !win) return null

  const timeout = request.timeout ?? FRAME_RESULT_TIMEOUT
  if (!(await ensurePeer(win, Math.min(FRAME_READY_TIMEOUT, timeout)))) return null

  const nonce = createNonce()
  let image: Blob | null = null
  let failure = ''
  let answered = false
  const sent = postFrameTo(
    win,
    'render',
    {
      ratio: request.ratio,
      depth: request.depth,
      maxDepth: frameLevels(request.maxDepth),
      ...(request.expand ? { expand: request.expand } : {})
    },
    { nonce }
  )
  if (!sent) return null

  await waitForMessages({
    timeout,
    // Frames render in parallel, so a cancelled capture has to stop them all
    // instead of leaving them working on pictures nobody will look at.
    onCancel: () => {
      postFrameCancel(win)
    },
    onMessage: (message, event) => {
      if (message.type !== 'result') return false
      if (message.header.nonce !== nonce || event.source !== win) return false
      answered = true
      failure = typeof message.data.error === 'string' ? message.data.error : ''
      image = pictureFrom(message)
      return true
    }
  })

  // A frame that went silent has probably navigated; the next request will ask
  // for its new session id instead of talking to the old one.
  if (!answered) forgetPeer(win)
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
  const win = frameWindow(frame)
  if (!frameKey || !win) return null

  const timeout = request.timeout ?? FRAME_SIZE_TIMEOUT
  if (!(await ensurePeer(win, Math.min(FRAME_READY_TIMEOUT, timeout)))) return null

  const nonce = createNonce()
  let size: FrameSize | null = null
  let failure = ''
  let answered = false
  if (!postFrameTo(win, 'measure', {}, { nonce })) return null

  await waitForMessages({
    timeout,
    onMessage: (message, event) => {
      if (message.type !== 'size') return false
      if (message.header.nonce !== nonce || event.source !== win) return false
      answered = true
      failure = typeof message.data.error === 'string' ? message.data.error : ''
      const width = Number(message.data.width)
      const height = Number(message.data.height)
      if (Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1) {
        size = { width, height }
      }
      return true
    }
  })

  if (!answered) forgetPeer(win)
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
  return postFrameTo(win.parent, 'subscribe', {}, { handshake: true })
}

/** Hand the current shortcut to one frame. */
export function postHotkeyConfig(win: Window | null, shortcut: string): boolean {
  return postFrameTo(win, 'hotkey', { shortcut })
}

/** Tell the parent that the shortcut was pressed inside this frame. */
export function postHotkeyTrigger(win: Window, shortcut: string): boolean {
  return postFrameTo(win.parent, 'trigger', { shortcut })
}

/** Tell one frame whether the capture UI is open in the top document. */
export function postUiState(win: Window | null, active: boolean, passthrough = false): boolean {
  return postFrameTo(win, 'ui', { active, passthrough })
}

/** Report a pointer position inside this frame to its parent. */
export function postFramePointer(win: Window, kind: 'move' | 'click', x: number, y: number): boolean {
  return postFrameTo(win.parent, 'pointer', { kind, x, y })
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
    const message = decodeFrameEvent(event as MessageEvent)
    if (!message || message.type !== 'pointer') return
    const source = (event as MessageEvent).source as Window | null
    if (!source) return
    const frame = frameFor(source)
    if (!frame) return
    const view = frameContentBox(frame)
    if (!view) return
    const x = view.left + Number(message.data.x)
    const y = view.top + Number(message.data.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (
      x < view.left ||
      x > view.left + view.width ||
      y < view.top ||
      y > view.top + view.height
    ) {
      return
    }
    if (message.data.kind === 'click') options.onClick({ x, y }, frame)
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
  return postFrameTo(win.parent, 'key', {
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
  /** Absolute `Date.now()` the whole chain has to answer by. */
  deadline?: number
  /** Override for tests; otherwise the deadline decides. */
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
  const win = frameWindow(frame)
  if (!frameKey || !win) return null

  const depth = frameLevels(request.depth, 1)
  const deadline = request.deadline ?? Date.now() + FRAME_PICK_TIMEOUT
  // A frame the picker has never talked to (the first hover) has to introduce
  // itself first; after that the id is cached until a navigation invalidates it.
  const budget = Math.max(FRAME_PICK_MIN_BUDGET, deadline - Date.now())
  if (!(await ensurePeer(win, Math.min(FRAME_READY_TIMEOUT, budget)))) return null

  const nonce = createNonce()
  let items: FramePickItem[] | null = null
  let failure = ''
  let answered = false
  const sent = postFrameTo(win, 'hover', { x: request.x, y: request.y, depth, deadline }, { nonce })
  if (!sent) return null

  await waitForMessages({
    // One budget for the whole chain, not one per hop: the answer arrives either
    // in time or not, however many frames it had to walk through.
    timeout: request.timeout ?? Math.max(0, deadline - Date.now()),
    onMessage: (message, event) => {
      if (message.type !== 'stack') return false
      if (message.header.nonce !== nonce || event.source !== win) return false
      answered = true
      failure = typeof message.data.error === 'string' ? message.data.error : ''
      items = readPickItems(message.data.items)
      return true
    }
  })

  if (!answered) forgetPeer(win)
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
  /** Frame levels inside the captured element that may be painted. */
  maxDepth?: number
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
  const win = frameWindow(frame)
  if (!frameKey || !win) return null

  const timeout = request.timeout ?? FRAME_CAPTURE_TIMEOUT
  if (!(await ensurePeer(win, Math.min(FRAME_READY_TIMEOUT, timeout)))) return null

  const nonce = createNonce()
  let payload: FrameCapturePayload | null = null
  let failure = ''
  let answered = false
  const sent = postFrameTo(
    win,
    'capture',
    {
      elementId: request.elementId,
      ...(request.via && request.via.length ? { via: request.via.slice(0, MAX_VIA) } : {}),
      ratio: request.ratio,
      expandNested: request.expandNested,
      background: request.background,
      maxDepth: frameLevels(request.maxDepth)
    },
    { nonce }
  )
  if (!sent) return null

  await waitForMessages({
    timeout,
    onCancel: () => {
      postFrameCancel(win)
    },
    onMessage: (message, event) => {
      if (message.type !== 'captured') return false
      if (message.header.nonce !== nonce || event.source !== win) return false
      answered = true
      failure = typeof message.data.error === 'string' ? message.data.error : ''
      const width = Number(message.data.width)
      const height = Number(message.data.height)
      const blob = pictureFrom(message)
      if (blob && Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1) {
        payload = {
          blob,
          width,
          height,
          limited: message.data.limited === true
        }
      }
      return true
    }
  })

  if (!answered) forgetPeer(win)
  if (failure) console.warn('[element-screenshot] frame helper failed:', failure)
  return payload
}

/** Tell one frame to stop rendering what it was asked for. */
export function postFrameCancel(win: Window | null): boolean {
  return postFrameTo(win, 'cancel', {})
}
