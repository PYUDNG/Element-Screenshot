import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import { installFramePointer } from '../src/core/frame-pointer'
import { frameContentBox } from '../src/core/frame-size'
import { getFrameSessionId, openFrameMessage, setFrameKey } from '../src/core/frame-bridge'
import type { FrameMessageType, OpenedFrameMessage } from '../src/core/frame-bridge'
import { TEST_KEY, wire } from './frame-wire'

/** The session id the fake parent introduces itself with. */
const PARENT = 'parent-test'

/** An envelope the parent of this frame would send. */
function uiMessage(active: boolean, passthrough: boolean): MessageEvent {
  const envelope = wire(
    'ui',
    { active, passthrough },
    { sid: PARENT, to: getFrameSessionId() }
  )
  return new MessageEvent('message', { data: envelope, source: window as never })
}

function posted(post: { mock: { calls: unknown[][] } }, type: FrameMessageType): OpenedFrameMessage[] {
  return post.mock.calls
    .map((call) => openFrameMessage(call[0]))
    .filter((message): message is OpenedFrameMessage => message !== null)
    .filter((message) => message.type === type)
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

let off: (() => void) | null = null

beforeEach(() => {
  setFrameKey(TEST_KEY)
})

afterEach(() => {
  off?.()
  off = null
  setFrameKey('')
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('pointer reporting inside a frame', () => {
  it('stays quiet until the parent asks for it', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20 }))
    expect(post).not.toHaveBeenCalled()

    // Picking with the transparent layer still in place: the top follows the
    // pointer itself, so the frame must not duplicate it.
    window.dispatchEvent(uiMessage(true, false))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 20 }))
    expect(post).not.toHaveBeenCalled()
  })

  it('reports the pointer and swallows the click while picking', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()
    window.dispatchEvent(uiMessage(true, true))

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 34 }))
    const [move] = posted(post, 'pointer')
    expect(move?.data).toEqual({ kind: 'move', x: 12, y: 34 })
    expect(move?.header.to).toBe(PARENT)

    const click = new MouseEvent('click', { clientX: 12, clientY: 34, bubbles: true, cancelable: true })
    window.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(posted(post, 'pointer')[1]?.data).toEqual({ kind: 'click', x: 12, y: 34 })
  })

  it('lets the page have its pointer back when picking ends', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()
    window.dispatchEvent(uiMessage(true, true))
    window.dispatchEvent(uiMessage(false, true))

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    window.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('ignores a state that did not come from this install or this parent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()

    // A page can forge neither of these: the first has no key, the second is
    // sealed by another install.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { protocol: 'element-screenshot:frame/7', type: 'ui', box: new Uint8Array(80) },
        source: window as never
      })
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        data: wire('ui', { active: true, passthrough: true }, {
          sid: PARENT,
          to: getFrameSessionId()
        }),
        source: { other: 'window' } as never
      })
    )
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 2 }))

    expect(post).not.toHaveBeenCalled()
  })

  it('passes a nested frame report on in its own coordinates', () => {
    const frame = document.createElement('iframe')
    Object.defineProperty(frame, 'clientWidth', { value: 200 })
    Object.defineProperty(frame, 'clientHeight', { value: 100 })
    document.body.append(frame)
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue(rect(50, 30, 200, 100))

    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()
    window.dispatchEvent(uiMessage(true, true))

    window.dispatchEvent(
      new MessageEvent('message', {
        data: wire('pointer', { kind: 'move', x: 5, y: 7 }, {
          sid: 'child-frame',
          to: getFrameSessionId()
        }),
        source: frame.contentWindow as never
      })
    )

    const view = frameContentBox(frame)
    const [relayed] = posted(post, 'pointer')
    expect(relayed?.data).toEqual({
      kind: 'move',
      x: (view?.left ?? 0) + 5,
      y: (view?.top ?? 0) + 7
    })
    expect(relayed?.header.to).toBe(PARENT)
  })
})
