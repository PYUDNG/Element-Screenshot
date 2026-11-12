import { native } from './native'
import { frameWindow } from './frame-bridge'
import { frameContentBox } from './frame-size'
import { getFrameToken, postFramePointer, readFrameMessage } from './frame-bridge'

/**
 * Report the pointer from inside a frame.
 *
 * The picker normally owns a transparent layer, so every pointer event lands in
 * the top document and the picker can follow the pointer itself. With mouse
 * passthrough on that layer is gone: the pointer enters the frame, the page sees
 * its own hover (which is the point of the switch), and the top window stops
 * receiving moves entirely. The frame therefore reports where the pointer is, and
 * swallows the click, which is the capture gesture rather than a page action.
 *
 * Moves are reported without `preventDefault`: the page must still see its own
 * hover, that is what the user turned the switch on for. A nested frame reports
 * here too; its positions are shifted into this frame's coordinates and passed on
 * so the top document only ever sees one stream.
 */
export interface FramePointerOptions {
  /** Window to listen on; the current frame by default. */
  win?: Window
  /** Document to look for child frames in; the current one by default. */
  doc?: Document
}

/** Events that only ever need swallowing while picking. */
const SWALLOWED = ['pointerdown', 'mousedown', 'click', 'dblclick'] as const

export function installFramePointer(options: FramePointerOptions = {}): () => void {
  const win = options.win ?? window
  const doc = options.doc ?? window.document
  let active = false
  let passthrough = false

  const reporting = (): boolean => active && passthrough

  const childFrameFor = (source: Window): HTMLIFrameElement | null => {
    for (const element of Array.from(native.querySelectorAll(doc, 'iframe'))) {
      const frame = element as HTMLIFrameElement
      if (frameWindow(frame) === source) return frame
    }
    return null
  }

  const onMove = (event: Event): void => {
    if (!reporting()) return
    const pointer = event as MouseEvent
    postFramePointer(win, 'move', pointer.clientX, pointer.clientY)
  }

  const onSwallow = (event: Event): void => {
    if (!reporting()) return
    // A click inside the frame is how the user picks; the page must not navigate
    // or focus anything while that happens.
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  const onClick = (event: Event): void => {
    if (!reporting()) return
    onSwallow(event)
    const pointer = event as MouseEvent
    postFramePointer(win, 'click', pointer.clientX, pointer.clientY)
  }

  const handleMessage = (event: Event): void => {
    const message = readFrameMessage((event as MessageEvent).data)
    if (!message) return
    const source = (event as MessageEvent).source as Window | null

    if (message.type === 'ui') {
      const token = getFrameToken()
      if (!token || message.token !== token || source !== win.parent) return
      active = message.active
      passthrough = message.passthrough === true
      return
    }

    if (message.type === 'pointer') {
      if (!reporting() || !source) return
      const child = childFrameFor(source)
      if (!child) return
      const view = frameContentBox(child)
      if (!view) return
      postFramePointer(win, message.kind, view.left + message.x, view.top + message.y)
    }
  }

  native.addEventListener(win, 'message', handleMessage, true)
  native.addEventListener(win, 'mousemove', onMove, true)
  for (const type of SWALLOWED) {
    native.addEventListener(win, type, type === 'click' ? onClick : onSwallow, true)
  }

  return () => {
    native.removeEventListener(win, 'message', handleMessage, true)
    native.removeEventListener(win, 'mousemove', onMove, true)
    for (const type of SWALLOWED) {
      native.removeEventListener(win, type, type === 'click' ? onClick : onSwallow, true)
    }
  }
}
