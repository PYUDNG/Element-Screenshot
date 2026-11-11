import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import {
  FRAME_PROTOCOL,
  frameWindow,
  getFrameToken,
  postFrameMessage,
  probeFrameHelpers,
  readFrameMessage,
  requestFrameImage,
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
  })

  it('refuses to talk without a token', async () => {
    setFrameToken('')
    const frame = fakeFrame()
    expect(await requestFrameImage(frame.element, { ratio: 1, depth: 1 })).toBeNull()
    expect(frame.posts).toHaveLength(0)
    expect(getFrameToken()).toBe('')
  })
})
