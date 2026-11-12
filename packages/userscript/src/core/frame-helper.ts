import { native } from './native'
import { captureElement, renderFrameViewport, shouldCaptureNode } from './capture'
import type { CaptureBackground } from './capture'
import { frameContentBox, frameContentSize } from './frame-size'
import type { FrameSize } from './frame-size'
import { collectFramePickCandidates } from './frame-pick'
import type { FramePickCandidate } from './frame-pick'
import {
  FRAME_PICK_MIN_BUDGET,
  FRAME_PICK_TIMEOUT,
  MAX_FRAME_PIERCE,
  decodeFrameEvent,
  postFrameReply,
  readVia,
  requestFrameCapture,
  requestFramePick
} from './frame-bridge'
import type {
  FrameCapturePayload,
  FrameCaptureRequest,
  FrameHoverData,
  FrameMessageType,
  FramePickItem
} from './frame-bridge'
import { liftFrameItems } from './pick-target'
import { getTargetBox } from './target'

/** A frame whose parser never finishes must not hang the parent's capture. */
const PARSE_TIMEOUT = 5_000
/**
 * Picked nodes are remembered so a capture can name one without a selector.
 * Hovering walks the whole ancestor chain, so the map is pruned instead of kept
 * for the lifetime of the page.
 */
const MAX_ELEMENTS = 2_000
/**
 * How many child frames one document may report through.
 *
 * A hover chain only needs the frames it walked through, so a small table is
 * enough; the oldest entries are dropped instead of growing for the page lifetime.
 */
const MAX_CHILD_FRAMES = 64

export interface FrameRenderRequest {
  ratio: number
  depth: number
  expand?: FrameSize
}

export interface FrameElementCaptureRequest {
  element: Element
  ratio: number
  expandNested: boolean
  background: CaptureBackground
}

export interface FrameElementCaptureResult {
  blob: Blob
  width: number
  height: number
  limited: boolean
}

export interface FrameHelperOptions {
  /** Window this helper serves; defaults to the current one. */
  win?: Window
  /** Document to render; defaults to the current one. */
  doc?: Document
  /** Renderer override, used by tests. */
  render?: (request: FrameRenderRequest) => Promise<Blob | null>
  /** Measurement override, used by tests. */
  measure?: (doc: Document) => FrameSize | null
  /** Layer lookup override, used by tests. */
  pick?: (doc: Document, x: number, y: number) => FramePickCandidate[]
  /** Element capture override, used by tests. */
  capture?: (request: FrameElementCaptureRequest) => Promise<FrameElementCaptureResult | null>
  /** Ask a nested frame for its layers; defaults to the bridge. */
  childPick?: (frame: HTMLIFrameElement, request: FrameChildPickRequest) => Promise<FramePickItem[] | null>
  /** Ask a nested frame to capture one of its layers; defaults to the bridge. */
  childCapture?: (
    frame: HTMLIFrameElement,
    request: FrameCaptureRequest
  ) => Promise<FrameCapturePayload | null>
}

/** A hover forwarded one frame down, with the point in that frame's coordinates. */
export interface FrameChildPickRequest {
  x: number
  y: number
  depth: number
  /** Absolute `Date.now()` the whole chain has to answer by. */
  deadline: number
}

export interface FrameHelper {
  handleMessage: (event: MessageEvent) => void
}

/** Resolve once the document has a DOM to render. */
function whenParsed(doc: Document): Promise<void> {
  if (doc.readyState !== 'loading') return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve()
    }
    doc.addEventListener('DOMContentLoaded', finish, { once: true })
    native.setTimeout(finish, PARSE_TIMEOUT)
  })
}

/** Never trust the parent's object shape for the backdrop either. */
function readBackground(value: unknown): CaptureBackground {
  const raw = (value ?? {}) as Record<string, unknown>
  if (raw.mode === 'transparent') return { mode: 'transparent' }
  if (raw.mode === 'color') {
    return { mode: 'color', color: typeof raw.color === 'string' ? raw.color : '#ffffff' }
  }
  return { mode: 'page' }
}

/** The surface of an expanded frame, or null when the ask is not usable. */
function readExpand(value: unknown): FrameSize | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const width = Number(raw.width)
  const height = Number(raw.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null
  return { width, height }
}

/**
 * Answer capture requests for one frame.
 *
 * The helper renders its own document in its own realm, which is what makes the
 * frame's fonts and pixel ratio come out right, and it is the only way to reach
 * a cross-origin frame. Only the direct parent may ask, and every request has to
 * open with this install's key, so an embedding page can neither forge one nor
 * use the helper to screenshot a frame it cannot read.
 */
export function createFrameHelper(options: FrameHelperOptions = {}): FrameHelper {
  const win = options.win ?? window
  const doc = options.doc ?? document
  const render =
    options.render ??
    ((request: FrameRenderRequest) =>
      renderFrameViewport(doc, request.ratio, {}, request.depth, request.expand))
  const measure = options.measure ?? frameContentSize
  const pick = options.pick ?? collectFramePickCandidates
  const capture =
    options.capture ??
    (async (request: FrameElementCaptureRequest): Promise<FrameElementCaptureResult> => {
      const result = await captureElement(request.element, {
        box: getTargetBox(request.element),
        expandNested: request.expandNested,
        background: request.background,
        pixelRatio: request.ratio,
        filter: shouldCaptureNode
      })
      return {
        blob: result.blob,
        width: result.width,
        height: result.height,
        limited: result.limited
      }
    })

  const childPick =
    options.childPick ??
    ((frame: HTMLIFrameElement, request: FrameChildPickRequest) => requestFramePick(frame, request))
  const childCapture =
    options.childCapture ??
    ((frame: HTMLIFrameElement, request: FrameCaptureRequest) =>
      requestFrameCapture(frame, request))

  const elements = new Map<number, Element>()
  const elementIds = new WeakMap<Element, number>()
  let nextElementId = 1
  /**
   * Child frames that a deeper layer travelled through.
   *
   * A layer two frames down is named by the ids of the frames the answer passed
   * through, so a capture can walk the same doors; the ids belong to this frame
   * and mean nothing anywhere else.
   */
  const childFrames = new Map<number, HTMLIFrameElement>()
  const childFrameIds = new WeakMap<HTMLIFrameElement, number>()
  let nextChildFrameId = 1
  let busy = false

  /**
   * Remember a picked node and hand the parent an id for it. A node keeps its id
   * across hovers and ids are never reused, so a capture that names one resolves
   * the exact node the picker showed even after the pointer moved on and the
   * stack was rebuilt.
   */
  const register = (element: Element): number => {
    const existing = elementIds.get(element)
    if (existing !== undefined) return existing

    const id = nextElementId
    nextElementId += 1
    elementIds.set(element, id)
    elements.set(id, element)
    if (elements.size > MAX_ELEMENTS) {
      for (const key of elements.keys()) {
        elements.delete(key)
        if (elements.size <= MAX_ELEMENTS / 2) break
      }
    }
    return id
  }

  /** Remember the frame a deeper answer travelled through, and name it. */
  const registerFrame = (frame: HTMLIFrameElement): number => {
    const existing = childFrameIds.get(frame)
    if (existing !== undefined) return existing

    const id = nextChildFrameId
    nextChildFrameId += 1
    childFrameIds.set(frame, id)
    childFrames.set(id, frame)
    if (childFrames.size > MAX_CHILD_FRAMES) {
      for (const key of childFrames.keys()) {
        childFrames.delete(key)
        if (childFrames.size <= MAX_CHILD_FRAMES / 2) break
      }
    }
    return id
  }

  /**
   * Seal one answer and post it back to the parent.
   *
   * Replies are asynchronous because a picture has to be read into bytes before
   * it can be sealed; the failure of that read is reported here instead of
   * becoming an unhandled rejection on the frame's page.
   */
  const reply = (
    source: Window | null,
    type: FrameMessageType,
    data: Record<string, unknown>,
    nonce: string,
    blob?: Blob | null
  ): Promise<boolean> => {
    if (!source) return Promise.resolve(false)
    return postFrameReply(source, type, data, { nonce, blob }).catch((error: unknown) => {
      console.warn('[element-screenshot] frame reply failed:', error)
      return false
    })
  }

  /**
   * Answer a hover from this document.
   *
   * A hit test is cheap and read-only, so it is answered even while a render runs
   * and it never joins the `busy` queue: the crosshair has to keep up.
   *
   * The innermost layer may be one of our own frames, in which case that frame is
   * asked for its layers and its answer is shifted into this document, tagged
   * with the frame it came through. The list stays topmost first, so the deeper
   * layers go *before* the frame that contains them.
   */
  const replyStack = async (
    source: Window,
    request: FrameHoverData,
    nonce: string
  ): Promise<void> => {
    let items: FramePickItem[] = []
    let error: string | undefined
    try {
      const candidates = pick(doc, request.x, request.y)
      items = candidates.map((candidate) => ({
        ...candidate.item,
        id: register(candidate.element)
      }))

      const depth =
        Number.isFinite(request.depth) && request.depth > 0
          ? Math.min(Math.floor(request.depth), MAX_FRAME_PIERCE)
          : 1
      const deadline = Number.isFinite(request.deadline)
        ? request.deadline
        : Date.now() + FRAME_PICK_TIMEOUT
      const remaining = deadline - Date.now()
      const innermost = candidates[0]?.element
      if (depth > 1 && remaining > FRAME_PICK_MIN_BUDGET && innermost && innermost.tagName === 'IFRAME') {
        const frame = innermost as HTMLIFrameElement
        const view = frameContentBox(frame)
        if (view) {
          const hop = registerFrame(frame)
          // The child gets whatever is left of the one budget, not a fresh
          // timeout: a deep chain must not outlast a shallow one.
          const nested = await childPick(frame, {
            x: request.x - view.left,
            y: request.y - view.top,
            depth: depth - 1,
            deadline
          })
          if (nested && nested.length > 0) {
            items = [...liftFrameItems(view, nested, hop), ...items]
          }
        }
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    void reply(source, 'stack', { items, ...(error ? { error } : {}) }, nonce)
  }

  const handleMessage = (event: MessageEvent): void => {
    const message = decodeFrameEvent(event)
    if (!message) return
    // A frame nested two levels deep is asked by its own parent, so the parent
    // check covers the whole chain; `window.top` never talks to us directly.
    if (event.source !== win.parent) return
    const source = event.source as Window | null
    if (!source) return
    const nonce = message.header.nonce
    const data = message.data

    if (message.type === 'hello') {
      void reply(source, 'ready', {}, nonce)
      return
    }
    if (message.type === 'hover') {
      // Nothing is laid out yet while the document is still parsing.
      if (doc.readyState === 'loading') return
      void replyStack(source, data as unknown as FrameHoverData, nonce)
      return
    }
    if (message.type === 'cancel') {
      native.capture.aborted = true
      return
    }
    if (message.type !== 'render' && message.type !== 'measure' && message.type !== 'capture') return

    if (busy) {
      if (message.type === 'render') {
        void reply(source, 'result', { error: 'busy' }, nonce)
      } else if (message.type === 'capture') {
        void reply(source, 'captured', { width: 0, height: 0, limited: false, error: 'busy' }, nonce)
      } else {
        void reply(source, 'size', { width: 0, height: 0, error: 'busy' }, nonce)
      }
      return
    }

    busy = true
    void (async () => {
      try {
        await whenParsed(doc)
        if (message.type === 'measure') {
          const size = measure(doc)
          void reply(source, 'size', { width: size?.width ?? 0, height: size?.height ?? 0 }, nonce)
          return
        }
        const ratio = Number(data.ratio)
        if (message.type === 'capture') {
          // A layer of a frame below this one: walk the same doors the hover
          // answer came through and hand the picture back up the chain.
          const via = readVia(data.via)
          if (via === null) throw new Error('The element path is invalid')
          const elementId = Number(data.elementId)
          if (!Number.isInteger(elementId) || elementId < 1) {
            throw new Error('The element is invalid')
          }
          if (via.length > 0) {
            const hop = via[0]
            const child = hop === undefined ? undefined : childFrames.get(hop)
            if (!child || !child.isConnected) throw new Error('The frame is gone')
            const nested = await childCapture(child, {
              elementId,
              via: via.slice(1),
              ratio,
              expandNested: data.expandNested !== false,
              background: readBackground(data.background)
            })
            if (!nested) throw new Error('The frame produced no picture')
            void reply(
              source,
              'captured',
              {
                width: nested.width,
                height: nested.height,
                limited: nested.limited,
                mime: nested.blob.type || 'image/png'
              },
              nonce,
              nested.blob
            )
            return
          }
          const element = elements.get(elementId)
          if (!element || !element.isConnected) throw new Error('The picked element is gone')
          const result = await capture({
            element,
            ratio,
            expandNested: data.expandNested !== false,
            background: readBackground(data.background)
          })
          if (!result) throw new Error('The frame produced no picture')
          void reply(
            source,
            'captured',
            {
              width: result.width,
              height: result.height,
              limited: result.limited,
              mime: result.blob.type || 'image/png'
            },
            nonce,
            result.blob
          )
          return
        }
        const expand = readExpand(data.expand)
        const blob = await render({
          ratio,
          depth: Number(data.depth),
          ...(expand ? { expand } : {})
        })
        void reply(source, 'result', blob ? { mime: blob.type || 'image/png' } : {}, nonce, blob)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (message.type === 'measure') {
          void reply(source, 'size', { width: 0, height: 0, error: detail }, nonce)
        } else if (message.type === 'capture') {
          void reply(
            source,
            'captured',
            { width: 0, height: 0, limited: false, error: detail },
            nonce
          )
        } else {
          void reply(source, 'result', { error: detail }, nonce)
        }
      } finally {
        busy = false
      }
    })()
  }

  return { handleMessage }
}

/** Start serving the parent from inside a frame. */
export function installFrameHelper(): void {
  const helper = createFrameHelper()
  const listener = (event: Event): void => helper.handleMessage(event as MessageEvent)
  // Capture phase, like the rest of the bridge: a page listener that stops
  // propagation must not be able to hide a request from the helper.
  native.addEventListener(window, 'message', listener, true)
}
