import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import {
  FRAME_PROTOCOL,
  frameWindow,
  getFrameToken,
  postFrameCancel,
  postFrameMessage,
  probeFrameHelpers,
  readFrameMessage,
  readPickItems,
  requestFrameCapture,
  requestFrameImage,
  requestFramePick,
  requestFrameSize,
  setFrameToken
} from '../src/core/frame-bridge'
import type { FrameMessage } from '../src/core/frame-bridge'

interface FakeFrame {
  element: HTMLIFrameElement
  window: Window
  posts: FrameMessage[]
}

/** A frame whose content window answers `postMessage` through `reply`. */
function fakeFrame(reply?: (message: FrameMessage, frame: FakeFrame) => void): FakeFrame {
  const element = document.createElement('iframe')
  const frame: FakeFrame = { element, window: null as unknown as Window, posts: [] }
  const win = {
    postMessage: (message: FrameMessage): void => {
      frame.posts.push(message)
      if (!reply) return
      // Real postMessage delivery is a task, never a synchronous callback.
      native.setTimeout(() => reply(message, frame), 0)
    }
  } as unknown as Window
  frame.window = win
  Object.defineProperty(element, 'contentWindow', { configurable: true, value: win })
  document.body.append(element)
  return frame
}

function answer(message: FrameMessage, source: unknown, data: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { protocol: FRAME_PROTOCOL, nonce: message.nonce, ...(data as object) },
      source: source as never,
      origin: 'http://localhost:4176'
    })
  )
}

beforeEach(() => {
  setFrameToken('test-token-1234')
})

afterEach(() => {
  setFrameToken('')
  native.capture.aborted = false
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('frame messages', () => {
  it('rejects anything outside the protocol', () => {
    expect(readFrameMessage(null)).toBeNull()
    expect(readFrameMessage('hello')).toBeNull()
    expect(readFrameMessage({ type: 'hello', nonce: 'a' })).toBeNull()
    expect(readFrameMessage({ protocol: 'other', type: 'hello', nonce: 'a' })).toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'nope', nonce: 'a' })).toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'hello' })).toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'hello', nonce: '' })).toBeNull()
  })

  it('accepts a current protocol message', () => {
    const message = { protocol: FRAME_PROTOCOL, type: 'hello', token: 't', nonce: 'n' }
    expect(readFrameMessage(message)).toBe(message)
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'size', nonce: 'n', width: 1, height: 2 })).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'measure', nonce: 'n', token: 't' })).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'subscribe', nonce: 'n', token: 't' })).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'hover', nonce: 'n', token: 't', x: 1, y: 2 })).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'stack', nonce: 'n', items: [] })).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'capture', nonce: 'n', token: 't', elementId: 1 })).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'captured', nonce: 'n', blob: null, width: 0, height: 0 })).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'cancel', nonce: 'n', token: 't' })).not.toBeNull()
    expect(
      readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'hotkey', nonce: 'n', token: 't', shortcut: 'Alt+S' })
    ).not.toBeNull()
    expect(
      readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'trigger', nonce: 'n', token: 't', shortcut: 'Alt+S' })
    ).not.toBeNull()
    expect(readFrameMessage({ protocol: FRAME_PROTOCOL, type: 'ui', nonce: 'n', token: 't', active: true })).not.toBeNull()
    expect(
      readFrameMessage({
        protocol: FRAME_PROTOCOL,
        type: 'key',
        nonce: 'n',
        token: 't',
        key: 'Escape',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false
      })
    ).not.toBeNull()
  })

  it('reads a frame window and survives a frame without one', () => {
    const frame = fakeFrame()
    expect(frameWindow(frame.element)).toBe(frame.window)
    const bare = document.createElement('iframe')
    Object.defineProperty(bare, 'contentWindow', { configurable: true, value: null })
    expect(frameWindow(bare)).toBeNull()
  })

  it('reports a post that the target refuses', () => {
    const broken = {
      postMessage: () => {
        throw new Error('nope')
      }
    } as unknown as Window
    expect(postFrameMessage(broken, { protocol: FRAME_PROTOCOL, type: 'ready', nonce: 'n' })).toBe(
      false
    )
    expect(postFrameMessage(null, { protocol: FRAME_PROTOCOL, type: 'ready', nonce: 'n' })).toBe(
      false
    )
  })
})

describe('helper probe', () => {
  it('does nothing without a token', async () => {
    setFrameToken('')
    const frame = fakeFrame()
    expect(await probeFrameHelpers([frame.element])).toEqual(new Set())
    expect(frame.posts).toHaveLength(0)
  })

  it('collects the frames that answer the hello', async () => {
    const answering = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'ready' })
    })
    const silent = fakeFrame()

    const ready = await probeFrameHelpers([answering.element, silent.element], { timeout: 60 })

    expect(ready.has(answering.element)).toBe(true)
    expect(ready.has(silent.element)).toBe(false)
    expect(answering.posts[0]).toMatchObject({
      protocol: FRAME_PROTOCOL,
      type: 'hello',
      token: 'test-token-1234'
    })
    // A silent frame is probed, it just never answers.
    expect(silent.posts).toHaveLength(1)
  })

  it('ignores an answer that does not come from the probed window', async () => {
    const frame = fakeFrame((message) => {
      answer(message, { other: 'window' }, { type: 'ready' })
    })
    expect(await probeFrameHelpers([frame.element], { timeout: 60 })).toEqual(new Set())
  })

  it('ignores a ready for another nonce', async () => {
    const frame = fakeFrame((_message, frame) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { protocol: FRAME_PROTOCOL, type: 'ready', nonce: 'stale' },
          source: frame.window as never,
          origin: 'http://localhost:4176'
        })
      )
    })
    expect(await probeFrameHelpers([frame.element], { timeout: 60 })).toEqual(new Set())
  })

  it('skips frames that are already gone', async () => {
    const frame = document.createElement('iframe')
    Object.defineProperty(frame, 'contentWindow', { configurable: true, value: null })
    expect(await probeFrameHelpers([frame], { timeout: 20 })).toEqual(new Set())
  })
})

describe('frame render request', () => {
  it('returns the picture the helper sends back', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'result', blob })
    })

    const image = await requestFrameImage(frame.element, { ratio: 2, depth: 1, timeout: 500 })

    expect(image).toBe(blob)
    expect(frame.posts[0]).toMatchObject({
      type: 'render',
      token: 'test-token-1234',
      ratio: 2,
      depth: 1
    })
  })

  it('reports a helper side failure and returns no picture', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'result', blob: null, error: 'the frame broke' })
    })

    expect(await requestFrameImage(frame.element, { ratio: 1, depth: 1, timeout: 500 })).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[element-screenshot] frame helper failed:',
      'the frame broke'
    )
  })

  it('gives up when the helper never answers', async () => {
    const frame = fakeFrame()
    expect(await requestFrameImage(frame.element, { ratio: 1, depth: 1, timeout: 60 })).toBeNull()
  })

  it('gives up when the capture is cancelled', async () => {
    const frame = fakeFrame()
    const started = Date.now()
    const pending = requestFrameImage(frame.element, { ratio: 1, depth: 1, timeout: 5_000 })
    native.capture.aborted = true
    expect(await pending).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
    // Frames render in parallel now, so every one of them has to be told to stop.
    expect(frame.posts.map((post) => post.type)).toEqual(['render', 'cancel'])
  })

  it('refuses to talk without a token', async () => {
    setFrameToken('')
    const frame = fakeFrame()
    expect(await requestFrameImage(frame.element, { ratio: 1, depth: 1 })).toBeNull()
    expect(frame.posts).toHaveLength(0)
    expect(getFrameToken()).toBe('')
  })

  it('carries the surface of an expanded frame', async () => {
    const blob = new Blob(['png'], { type: 'image/png' })
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'result', blob })
    })

    await requestFrameImage(frame.element, {
      ratio: 1,
      depth: 1,
      expand: { width: 300, height: 900 },
      timeout: 500
    })

    expect(frame.posts[0]).toMatchObject({ type: 'render', expand: { width: 300, height: 900 } })
  })
})

describe('frame measurement request', () => {
  it('returns the size the helper reports', async () => {
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'size', width: 640, height: 900 })
    })

    expect(await requestFrameSize(frame.element, { timeout: 500 })).toEqual({
      width: 640,
      height: 900
    })
    expect(frame.posts[0]).toMatchObject({ type: 'measure', token: 'test-token-1234' })
  })

  it('ignores an answer that does not come from the asked frame', async () => {
    const frame = fakeFrame((message) => {
      answer(message, { other: 'window' }, { type: 'size', width: 10, height: 10 })
    })
    expect(await requestFrameSize(frame.element, { timeout: 60 })).toBeNull()
  })

  it('rejects a size it cannot use and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, {
        type: 'size',
        width: 0,
        height: 0,
        error: 'nothing to measure'
      })
    })

    expect(await requestFrameSize(frame.element, { timeout: 500 })).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[element-screenshot] frame helper failed:',
      'nothing to measure'
    )
  })

  it('gives up when the helper never answers', async () => {
    const frame = fakeFrame()
    expect(await requestFrameSize(frame.element, { timeout: 60 })).toBeNull()
  })

  it('refuses to measure without a token', async () => {
    setFrameToken('')
    const frame = fakeFrame()
    expect(await requestFrameSize(frame.element)).toBeNull()
    expect(frame.posts).toHaveLength(0)
  })
})

describe('frame layer probing', () => {
  const layer = {
    id: 3,
    label: 'div.card',
    left: 10,
    top: 20,
    width: 100,
    height: 50,
    contentWidth: 100,
    contentHeight: 400,
    scrollAxis: 'y',
    fullPage: false
  }

  it('asks for the layers under a point and returns them', async () => {
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'stack', items: [layer] })
    })

    const items = await requestFramePick(frame.element, { x: 12, y: 34, timeout: 500 })

    expect(frame.posts[0]).toMatchObject({ type: 'hover', token: 'test-token-1234', x: 12, y: 34 })
    expect(items).toEqual([layer])
  })

  it('answers an empty list when a frame reports no layer', async () => {
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'stack', items: [] })
    })

    expect(await requestFramePick(frame.element, { x: 1, y: 1, timeout: 500 })).toEqual([])
  })

  it('drops malformed layers', async () => {
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, {
        type: 'stack',
        items: [layer, { id: 0, label: 'no id' }, null, { ...layer, id: 4, width: 'wide' }]
      })
    })

    const items = await requestFramePick(frame.element, { x: 1, y: 1, timeout: 500 })
    expect(items).toEqual([layer])
  })

  it('returns null when the frame does not answer', async () => {
    const frame = fakeFrame()
    expect(await requestFramePick(frame.element, { x: 1, y: 1, timeout: 60 })).toBeNull()
  })

  it('ignores an answer from another window', async () => {
    const frame = fakeFrame((message) => {
      answer(message, { other: 'window' }, { type: 'stack', items: [layer] })
    })
    expect(await requestFramePick(frame.element, { x: 1, y: 1, timeout: 60 })).toBeNull()
  })

  it('refuses to ask without a token', async () => {
    setFrameToken('')
    const frame = fakeFrame()
    expect(await requestFramePick(frame.element, { x: 1, y: 1 })).toBeNull()
    expect(frame.posts).toHaveLength(0)
  })

  it('caps a layer list', () => {
    const many = Array.from({ length: 200 }, (_value, index) => ({ ...layer, id: index + 1 }))
    expect(readPickItems(many)).toHaveLength(64)
    expect(readPickItems('nope')).toEqual([])
  })
})

describe('frame element capture', () => {
  const blob = new Blob(['png'], { type: 'image/png' })

  it('names the element and returns the picture', async () => {
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, {
        type: 'captured',
        blob,
        width: 320,
        height: 480,
        limited: false
      })
    })

    const result = await requestFrameCapture(frame.element, {
      elementId: 7,
      ratio: 2,
      expandNested: true,
      background: { mode: 'page' },
      timeout: 500
    })

    expect(frame.posts[0]).toMatchObject({
      type: 'capture',
      token: 'test-token-1234',
      elementId: 7,
      ratio: 2,
      expandNested: true,
      background: { mode: 'page' }
    })
    expect(result).toEqual({ blob, width: 320, height: 480, limited: false })
  })

  it('reports a helper failure and returns nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = fakeFrame((message, frame) => {
      answer(message, frame.window, { type: 'captured', blob: null, width: 0, height: 0, limited: false, error: 'gone' })
    })

    expect(
      await requestFrameCapture(frame.element, {
        elementId: 1,
        ratio: 1,
        expandNested: false,
        background: { mode: 'transparent' },
        timeout: 500
      })
    ).toBeNull()
    expect(warn).toHaveBeenCalledWith('[element-screenshot] frame helper failed:', 'gone')
  })

  it('tells the frame to stop when the capture is cancelled', async () => {
    const frame = fakeFrame()
    const pending = requestFrameCapture(frame.element, {
      elementId: 1,
      ratio: 1,
      expandNested: false,
      background: { mode: 'page' },
      timeout: 5_000
    })
    native.capture.aborted = true

    expect(await pending).toBeNull()
    expect(frame.posts.map((post) => post.type)).toEqual(['capture', 'cancel'])
  })

  it('refuses to ask without a token', async () => {
    setFrameToken('')
    const frame = fakeFrame()
    expect(
      await requestFrameCapture(frame.element, {
        elementId: 1,
        ratio: 1,
        expandNested: false,
        background: { mode: 'page' }
      })
    ).toBeNull()
    expect(frame.posts).toHaveLength(0)
  })

  it('never cancels without a token', () => {
    setFrameToken('')
    expect(postFrameCancel({ postMessage: vi.fn() } as unknown as Window)).toBe(false)
  })
})
