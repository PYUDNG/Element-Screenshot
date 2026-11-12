import { native } from './native'
import { captureElement, renderFrameViewport, shouldCaptureNode } from './capture'
import type { CaptureBackground } from './capture'
import { frameContentBox, frameContentSize } from './frame-size'
import type { FrameSize } from './frame-size'
import { collectFramePickCandidates } from './frame-pick'
import type { FramePickCandidate } from './frame-pick'
import {
  FRAME_PICK_TIMEOUT,
  FRAME_PROTOCOL,
  MAX_FRAME_PIERCE,
  getFrameToken,
  postFrameMessage,
  readFrameMessage,
  readVia,
  requestFrameCapture,
  requestFramePick
} from './frame-bridge'
import type {
  FrameCapturePayload,
  FrameCaptureRequest,
  FrameCapturedMessage,
  FrameHelloMessage,
  FrameHoverMessage,
  FramePickItem,
  FrameResultMessage,
  FrameSizeMessage,
  FrameStackMessage
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
  timeout: number
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

/**
 * Answer capture requests for one frame.
 *
 * The helper renders its own document in its own realm, which is what makes the
 * frame's fonts and pixel ratio come out right, and it is the only way to reach
 * a cross-origin frame. Only the direct parent may ask, and only with this
 * install's token, so an embedding page cannot use the helper to screenshot a
 * frame it cannot read.
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

  const reply = (
    source: Window | null,
    message:
      | Omit<FrameResultMessage, 'protocol'>
      | Omit<FrameSizeMessage, 'protocol'>
      | Omit<FrameStackMessage, 'protocol'>
      | Omit<FrameCapturedMessage, 'protocol'>
  ): void => {
    if (source) postFrameMessage(source, { protocol: FRAME_PROTOCOL, ...message })
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
  const replyStack = async (source: Window, message: FrameHoverMessage): Promise<void> => {
    let items: FramePickItem[] = []
    let error: string | undefined
    try {
      const candidates = pick(doc, message.x, message.y)
      items = candidates.map((candidate) => ({
        ...candidate.item,
        id: register(candidate.element)
      }))

      const depth =
        Number.isFinite(message.depth) && message.depth > 0
          ? Math.min(Math.floor(message.depth), MAX_FRAME_PIERCE)
          : 1
      const innermost = candidates[0]?.element
      if (depth > 1 && innermost && innermost.tagName === 'IFRAME') {
        const frame = innermost as HTMLIFrameElement
        const view = frameContentBox(frame)
        if (view) {
          const hop = registerFrame(frame)
          const nested = await childPick(frame, {
            x: message.x - view.left,
            y: message.y - view.top,
            depth: depth - 1,
            timeout: FRAME_PICK_TIMEOUT * (depth - 1)
          })
          if (nested && nested.length > 0) {
            items = [...liftFrameItems(view, nested, hop), ...items]
          }
        }
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    reply(source, {
      type: 'stack',
      nonce: message.nonce,
      items,
      ...(error ? { error } : {})
    })
  }

  const handleMessage = (event: MessageEvent): void => {
    const message = readFrameMessage(event.data)
    if (!message) return
    // A frame nested two levels deep is asked by its own parent, so the parent
    // check covers the whole chain; `window.top` never talks to us directly.
    if (event.source !== win.parent) return
    const source = event.source as Window | null
    const token = getFrameToken()
    if (!source || !token) return

    if (message.type === 'hello') {
      if ((message as FrameHelloMessage).token !== token) return
      postFrameMessage(source, { protocol: FRAME_PROTOCOL, type: 'ready', nonce: message.nonce })
      return
    }
    if (message.type === 'hover') {
      if ((message as FrameHoverMessage).token !== token) return
      // Nothing is laid out yet while the document is still parsing.
      if (doc.readyState === 'loading') return
      void replyStack(source, message as FrameHoverMessage)
      return
    }
    if (message.type === 'cancel') {
      if ((message as { token?: string }).token !== token) return
      native.capture.aborted = true
      return
    }
    if (message.type !== 'render' && message.type !== 'measure' && message.type !== 'capture') return
    if ((message as { token?: string }).token !== token) return

    if (busy) {
      if (message.type === 'render') {
        reply(source, { type: 'result', nonce: message.nonce, blob: null, error: 'busy' })
      } else if (message.type === 'capture') {
        reply(source, {
          type: 'captured',
          nonce: message.nonce,
          blob: null,
          width: 0,
          height: 0,
          limited: false,
          error: 'busy'
        })
      } else {
        reply(source, {
          type: 'size',
          nonce: message.nonce,
          width: 0,
          height: 0,
          error: 'busy'
        })
      }
      return
    }

    busy = true
    void (async () => {
      try {
        await whenParsed(doc)
        if (message.type === 'measure') {
          const size = measure(doc)
          reply(source, {
            type: 'size',
            nonce: message.nonce,
            width: size?.width ?? 0,
            height: size?.height ?? 0
          })
          return
        }
        if (message.type === 'capture') {
          // A layer of a frame below this one: walk the same doors the hover
          // answer came through and hand the picture back up the chain.
          const via = readVia(message.via)
          if (via === null) throw new Error('The element path is invalid')
          if (via.length > 0) {
            const hop = via[0]
            const child = hop === undefined ? undefined : childFrames.get(hop)
            if (!child || !child.isConnected) throw new Error('The frame is gone')
            const nested = await childCapture(child, {
              elementId: message.elementId,
              via: via.slice(1),
              ratio: message.ratio,
              expandNested: message.expandNested !== false,
              background: readBackground(message.background)
            })
            if (!nested) throw new Error('The frame produced no picture')
            reply(source, {
              type: 'captured',
              nonce: message.nonce,
              blob: nested.blob,
              width: nested.width,
              height: nested.height,
              limited: nested.limited
            })
            return
          }
          const element = elements.get(message.elementId)
          if (!element || !element.isConnected) throw new Error('The picked element is gone')
          const result = await capture({
            element,
            ratio: message.ratio,
            expandNested: message.expandNested !== false,
            background: readBackground(message.background)
          })
          if (!result) throw new Error('The frame produced no picture')
          reply(source, {
            type: 'captured',
            nonce: message.nonce,
            blob: result.blob,
            width: result.width,
            height: result.height,
            limited: result.limited
          })
          return
        }
        const blob = await render({
          ratio: message.ratio,
          depth: message.depth,
          ...(message.expand ? { expand: message.expand } : {})
        })
        reply(source, { type: 'result', nonce: message.nonce, blob })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (message.type === 'measure') {
          reply(source, {
            type: 'size',
            nonce: message.nonce,
            width: 0,
            height: 0,
            error: detail
          })
        } else if (message.type === 'capture') {
          reply(source, {
            type: 'captured',
            nonce: message.nonce,
            blob: null,
            width: 0,
            height: 0,
            limited: false,
            error: detail
          })
        } else {
          reply(source, {
            type: 'result',
            nonce: message.nonce,
            blob: null,
            error: detail
          })
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
  native.addEventListener(window, 'message', listener)
}
