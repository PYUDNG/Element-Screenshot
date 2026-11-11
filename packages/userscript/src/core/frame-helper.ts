import { native } from './native'
import { renderFrameViewport } from './capture'
import { frameContentSize } from './frame-size'
import type { FrameSize } from './frame-size'
import { FRAME_PROTOCOL, getFrameToken, postFrameMessage, readFrameMessage } from './frame-bridge'
import type {
  FrameHelloMessage,
  FrameMeasureMessage,
  FrameRenderMessage,
  FrameResultMessage,
  FrameSizeMessage
} from './frame-bridge'

/** A frame whose parser never finishes must not hang the parent's capture. */
const PARSE_TIMEOUT = 5_000

export interface FrameRenderRequest {
  ratio: number
  depth: number
  expand?: FrameSize
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
  let busy = false

  const reply = (source: Window | null, message: FrameResultMessage | FrameSizeMessage): void => {
    if (source) postFrameMessage(source, message)
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
    if (message.type !== 'render' && message.type !== 'measure') return
    if ((message as FrameRenderMessage | FrameMeasureMessage).token !== token) return

    if (busy) {
      if (message.type === 'render') {
        reply(source, {
          protocol: FRAME_PROTOCOL,
          type: 'result',
          nonce: message.nonce,
          blob: null,
          error: 'busy'
        })
      } else {
        reply(source, {
          protocol: FRAME_PROTOCOL,
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
            protocol: FRAME_PROTOCOL,
            type: 'size',
            nonce: message.nonce,
            width: size?.width ?? 0,
            height: size?.height ?? 0
          })
          return
        }
        const blob = await render({
          ratio: message.ratio,
          depth: message.depth,
          ...(message.expand ? { expand: message.expand } : {})
        })
        reply(source, { protocol: FRAME_PROTOCOL, type: 'result', nonce: message.nonce, blob })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        if (message.type === 'measure') {
          reply(source, {
            protocol: FRAME_PROTOCOL,
            type: 'size',
            nonce: message.nonce,
            width: 0,
            height: 0,
            error: detail
          })
        } else {
          reply(source, {
            protocol: FRAME_PROTOCOL,
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
