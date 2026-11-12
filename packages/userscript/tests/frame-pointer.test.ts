import { afterEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import { installFramePointer } from '../src/core/frame-pointer'
import { frameContentBox } from '../src/core/frame-size'
import { FRAME_PROTOCOL, setFrameToken } from '../src/core/frame-bridge'
import type { FrameMessage } from '../src/core/frame-bridge'

function uiMessage(
  active: boolean,
  passthrough: boolean,
  token = 'test-token',
  source: unknown = window
): MessageEvent {
  return new MessageEvent('message', {
    data: { protocol: FRAME_PROTOCOL, type: 'ui', token, nonce: 'u1', active, passthrough },
    source: source as never
  })
}

function posted(post: { mock: { calls: unknown[][] } }, type: string): FrameMessage[] {
  return post.mock.calls
    .map((call) => call[0] as FrameMessage)
    .filter((entry) => entry && entry.type === type)
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

afterEach(() => {
  off?.()
  off = null
  setFrameToken('')
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('pointer reporting inside a frame', () => {
  it('stays quiet until the parent asks for it', () => {
    setFrameToken('test-token')
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
    setFrameToken('test-token')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()
    window.dispatchEvent(uiMessage(true, true))

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 12, clientY: 34 }))
    expect(posted(post, 'pointer')).toEqual([
      expect.objectContaining({ kind: 'move', x: 12, y: 34 })
    ])

    const click = new MouseEvent('click', { clientX: 12, clientY: 34, bubbles: true, cancelable: true })
    window.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(true)
    expect(posted(post, 'pointer')[1]).toMatchObject({ kind: 'click', x: 12, y: 34 })
  })

  it('lets the page have its pointer back when picking ends', () => {
    setFrameToken('test-token')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()
    window.dispatchEvent(uiMessage(true, true))
    window.dispatchEvent(uiMessage(false, true))

    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    window.dispatchEvent(click)

    expect(click.defaultPrevented).toBe(false)
    expect(post).not.toHaveBeenCalled()
  })

  it('ignores a state that did not come from this parent', () => {
    setFrameToken('test-token')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFramePointer()

    window.dispatchEvent(uiMessage(true, true, 'other-install'))
    window.dispatchEvent(uiMessage(true, true, 'test-token', { other: 'window' }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 2 }))

    expect(post).not.toHaveBeenCalled()
  })

  it('passes a nested frame report on in its own coordinates', () => {
    setFrameToken('test-token')
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
        data: { protocol: FRAME_PROTOCOL, type: 'pointer', nonce: 'p1', kind: 'move', x: 5, y: 7 },
        source: frame.contentWindow as never
      })
    )

    const view = frameContentBox(frame)
    const [relayed] = posted(post, 'pointer')
    expect(relayed).toMatchObject({
      kind: 'move',
      x: (view?.left ?? 0) + 5,
      y: (view?.top ?? 0) + 7
    })
  })
})
