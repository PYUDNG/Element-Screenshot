import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import {
  FRAME_PROTOCOL,
  decodeFrameEvent,
  frameWindow,
  getFrameSessionId,
  installFramePointerBridge,
  openFrameMessage,
  postFrameCancel,
  postFrameMessage,
  probeFrameHelpers,
  readFrameEnvelope,
  readPickItems,
  readVia,
  requestFrameCapture,
  requestFrameImage,
  requestFramePick,
  requestFrameSize,
  sealFrameMessage,
  setFrameKey
} from '../src/core/frame-bridge'
import type { FrameMessageType, OpenedFrameMessage } from '../src/core/frame-bridge'
import { frameContentBox } from '../src/core/frame-size'
import { OTHER_KEY, TEST_KEY, blobText, deliver, pngBytes, wire, wireWith } from './frame-wire'

interface FakeFrame {
  element: HTMLIFrameElement
  window: Window
  posts: unknown[]
  /** Session id this frame answers with. */
  sid: string
}

let frameCounter = 0

/** The answer each request type expects. */
const REPLIES: Partial<Record<FrameMessageType, FrameMessageType>> = {
  hello: 'ready',
  measure: 'size',
  render: 'result',
  hover: 'stack',
  capture: 'captured'
}

/** Read the envelopes a fake frame received, opened and authenticated. */
function received(frame: FakeFrame, type?: FrameMessageType): OpenedFrameMessage[] {
  return frame.posts
    .map((post) => openFrameMessage(post))
    .filter((message): message is OpenedFrameMessage => message !== null)
    .filter((message) => type === undefined || message.type === type)
}

/** Post one reply, sealed to whoever asked and echoing the request nonce. */
function answer(
  frame: FakeFrame,
  request: OpenedFrameMessage,
  data: Record<string, unknown> = {},
  binary?: Uint8Array
): void {
  const type = REPLIES[request.type]
  if (!type) return
  deliver(
    wire(type, data, {
      sid: frame.sid,
      to: request.header.sid,
      // The parent's own sequence numbers are unique per request, so reusing one
      // keeps this fake peer's replies unique without extra bookkeeping.
      seq: request.header.seq,
      nonce: request.header.nonce,
      ...(binary ? { binary } : {})
    }),
    frame.window
  )
}

/** A frame whose content window answers `postMessage` through `reply`. */
function fakeFrame(reply?: (message: OpenedFrameMessage, frame: FakeFrame) => void): FakeFrame {
  frameCounter += 1
  const element = document.createElement('iframe')
  const frame: FakeFrame = {
    element,
    window: null as unknown as Window,
    posts: [],
    sid: `frame-${frameCounter}`
  }
  const win = {
    postMessage: (message: unknown): void => {
      frame.posts.push(message)
      if (!reply) return
      const request = openFrameMessage(message)
      if (!request) return
      // Real postMessage delivery is a task, never a synchronous callback.
      native.setTimeout(() => reply(request, frame), 0)
    }
  } as unknown as Window
  frame.window = win
  Object.defineProperty(element, 'contentWindow', { configurable: true, value: win })
  document.body.append(element)
  return frame
}

/** A frame that answers the handshake and hands everything else to `reply`. */
function frameThat(reply: (request: OpenedFrameMessage, frame: FakeFrame) => void): FakeFrame {
  return fakeFrame((request, frame) => {
    if (request.type === 'hello') {
      answer(frame, request)
      return
    }
    reply(request, frame)
  })
}

beforeEach(() => {
  setFrameKey(TEST_KEY)
})

afterEach(() => {
  setFrameKey('')
  native.capture.aborted = false
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('sealed envelopes', () => {
  it('is the only thing a page can see', () => {
    const envelope = sealFrameMessage('hover', { x: 12, y: 34, depth: 2, deadline: 99 })
    expect(envelope).not.toBeNull()
    expect(Object.keys(envelope ?? {})).toEqual(['protocol', 'type', 'box'])
    expect(envelope?.protocol).toBe(FRAME_PROTOCOL)
    expect(envelope?.type).toBe('hover')
    expect(envelope?.box).toBeInstanceOf(Uint8Array)
    // The coordinates only exist inside the box.
    expect(openFrameMessage(envelope)?.data).toEqual({ x: 12, y: 34, depth: 2, deadline: 99 })
  })

  it('keeps the header out of the business fields', () => {
    const opened = openFrameMessage(
      sealFrameMessage('render', { ratio: 2, depth: 1 }, { to: 'peer', nonce: 'n1' })
    )
    expect(opened?.header).toMatchObject({ to: 'peer', nonce: 'n1', seq: expect.any(Number) })
    expect(opened?.header.sid).toBe(getFrameSessionId())
    expect(opened?.data).toEqual({ ratio: 2, depth: 1 })
  })

  it('carries a picture as bytes', () => {
    const opened = openFrameMessage(sealFrameMessage('result', { mime: 'image/png' }, { binary: pngBytes('frame') }))
    expect(opened?.binary && new TextDecoder().decode(opened.binary)).toBe('frame')
  })

  it('refuses anything outside the protocol', () => {
    expect(readFrameEnvelope(null)).toBeNull()
    expect(readFrameEnvelope('hello')).toBeNull()
    expect(readFrameEnvelope({ type: 'hello', box: new Uint8Array(64) })).toBeNull()
    expect(readFrameEnvelope({ protocol: 'element-screenshot:frame/6', type: 'hello', box: new Uint8Array(64) })).toBeNull()
    expect(readFrameEnvelope({ protocol: FRAME_PROTOCOL, type: 'nope', box: new Uint8Array(64) })).toBeNull()
    expect(readFrameEnvelope({ protocol: FRAME_PROTOCOL, type: 'hello' })).toBeNull()
    expect(readFrameEnvelope({ protocol: FRAME_PROTOCOL, type: 'hello', box: [1, 2, 3] })).toBeNull()
    expect(readFrameEnvelope({ protocol: FRAME_PROTOCOL, type: 'hello', box: new Uint8Array(20) })).toBeNull()
    expect(readFrameEnvelope(sealFrameMessage('hello'))).not.toBeNull()
  })

  it('refuses a box sealed for another type', () => {
    const hover = sealFrameMessage('hover', { x: 1, y: 2, depth: 1, deadline: 9 })
    expect(hover).not.toBeNull()
    // Re-labelling is the cheapest forgery a page can attempt: the plaintext type
    // is the only part it can change.
    expect(openFrameMessage({ ...hover, type: 'capture' })).toBeNull()
    expect(openFrameMessage({ ...hover, type: 'stack' })).toBeNull()
  })

  it('refuses a box from another install', () => {
    const foreign = wireWith(OTHER_KEY, 'ready', {}, { sid: 'frame-x', to: getFrameSessionId() })
    expect(openFrameMessage(foreign)).toBeNull()
  })

  it('refuses a tampered box', () => {
    const envelope = sealFrameMessage('ready', {})
    expect(envelope).not.toBeNull()
    if (!envelope) return
    const tampered = { ...envelope, box: new Uint8Array(envelope.box) }
    const last = tampered.box.length - 1
    tampered.box[last] = (tampered.box[last] ?? 0) ^ 0xff
    expect(openFrameMessage(tampered)).toBeNull()
    expect(openFrameMessage({ ...envelope, box: new Uint8Array(60) })).toBeNull()
  })

  it('refuses a message addressed to another session', () => {
    const event = deliver(
      wire('ready', {}, { sid: 'frame-a', to: 'someone-else', nonce: 'n1' })
    )
    expect(decodeFrameEvent(event)).toBeNull()
  })

  it('accepts a handshake without an addressee and refuses its replay', () => {
    const envelope = wire('hello', {}, { sid: 'frame-a', to: '', seq: 1 })
    expect(decodeFrameEvent(deliver(envelope))?.type).toBe('hello')
    // A page can copy the bytes; it cannot move the sequence number forward.
    expect(decodeFrameEvent(deliver(envelope))).toBeNull()
  })

  it('refuses a replayed message for this session', () => {
    const envelope = wire('ready', {}, { sid: 'frame-a', to: getFrameSessionId(), seq: 7 })
    expect(decodeFrameEvent(deliver(envelope))?.type).toBe('ready')
    expect(decodeFrameEvent(deliver(envelope))).toBeNull()
    // The next number from the same sender is fine.
    expect(
      decodeFrameEvent(deliver(wire('ready', {}, { sid: 'frame-a', to: getFrameSessionId(), seq: 8 })))
    ).not.toBeNull()
  })

  it('refuses a page that guesses at a box', () => {
    // A page has no key, so anything it posts is noise, however well shaped.
    expect(openFrameMessage({ protocol: FRAME_PROTOCOL, type: 'render', box: new Uint8Array(80) })).toBeNull()
    expect(openFrameMessage({ protocol: FRAME_PROTOCOL, type: 'render', box: new Uint8Array(80).fill(7) })).toBeNull()
  })
})

describe('frame messages', () => {
  it('reads a hop path strictly', () => {
    expect(readVia(undefined)).toEqual([])
    expect(readVia([])).toEqual([])
    expect(readVia([1, 2])).toEqual([1, 2])
    // Anything that is not a positive integer would name a different frame, so the
    // whole path is rejected instead of being repaired.
    expect(readVia([0])).toBeNull()
    expect(readVia([-1])).toBeNull()
    expect(readVia([1.5])).toBeNull()
    expect(readVia(['1'])).toBeNull()
    expect(readVia([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull()
  })

  it('drops a layer whose hop path is malformed', () => {
    const base = {
      id: 1,
      label: 'div',
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      contentWidth: 10,
      contentHeight: 10,
      scrollAxis: null,
      fullPage: false
    }
    expect(readPickItems([{ ...base, via: [3] }])[0]?.via).toEqual([3])
    expect(readPickItems([{ ...base, via: [] }])[0]?.via).toBeUndefined()
    expect(readPickItems([{ ...base, via: [0] }])).toEqual([])
  })

  it('shifts a frame pointer into the top viewport', () => {
    const frame = document.createElement('iframe')
    Object.defineProperty(frame, 'clientWidth', { value: 300 })
    Object.defineProperty(frame, 'clientHeight', { value: 200 })
    document.body.append(frame)
    const box = {
      left: 100,
      top: 50,
      width: 300,
      height: 200,
      right: 400,
      bottom: 250,
      x: 100,
      y: 50,
      toJSON: () => ({})
    } as DOMRect
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue(box)
    const view = frameContentBox(frame)
    const moves: Array<{ x: number; y: number }> = []
    const off = installFramePointerBridge({
      onMove: (point) => moves.push(point),
      onClick: () => undefined
    })
    const point = (type: 'move' | 'click', x: number, y: number, seq: number): unknown =>
      wire('pointer', { kind: type, x, y }, { sid: 'frame-p', to: getFrameSessionId(), seq })

    deliver(point('move', 10, 20, 1), frame.contentWindow)
    expect(moves).toEqual([{ x: (view?.left ?? 0) + 10, y: (view?.top ?? 0) + 20 }])

    // A point outside the frame's own viewport is not a place in the page.
    deliver(point('move', 9999, 20, 2), frame.contentWindow)
    expect(moves).toHaveLength(1)

    // An unrelated window cannot drive the picker, even with a valid box.
    deliver(point('move', 10, 20, 3), { other: 'window' })
    expect(moves).toHaveLength(1)

    // A page can post a well-shaped envelope at any time; it never opens.
    deliver({ protocol: FRAME_PROTOCOL, type: 'pointer', box: new Uint8Array(80).fill(3) }, frame.contentWindow)
    expect(moves).toHaveLength(1)
    off()
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
    const envelope = { protocol: FRAME_PROTOCOL, type: 'ready', box: new Uint8Array(64) } as const
    expect(postFrameMessage(broken, envelope)).toBe(false)
    expect(postFrameMessage(null, envelope)).toBe(false)
  })
})

describe('helper probe', () => {
  it('does nothing without a key', async () => {
    setFrameKey('')
    const frame = fakeFrame()
    expect(await probeFrameHelpers([frame.element])).toEqual(new Set())
    expect(frame.posts).toHaveLength(0)
  })

  it('collects the frames that answer the hello', async () => {
    const asking = frameThat((request, frame) => answer(frame, request))
    const silent = fakeFrame()

    const ready = await probeFrameHelpers([asking.element, silent.element], { timeout: 60 })

    expect(ready.has(asking.element)).toBe(true)
    expect(ready.has(silent.element)).toBe(false)
    const hello = received(asking, 'hello')[0]
    expect(hello?.header.to).toBe('')
    expect(silent.posts).toHaveLength(1)
  })

  it('ignores an answer that does not come from the probed window', async () => {
    const frame = fakeFrame((request) => {
      deliver(
        wire('ready', {}, { sid: 'frame-a', to: request.header.sid, nonce: request.header.nonce }),
        { other: 'window' }
      )
    })
    expect(await probeFrameHelpers([frame.element], { timeout: 60 })).toEqual(new Set())
  })

  it('ignores a ready for another nonce', async () => {
    const frame = fakeFrame((request) => {
      deliver(
        wire('ready', {}, { sid: 'frame-a', to: request.header.sid, nonce: 'stale' }),
        frame.window
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
    const frame = frameThat((request, frame) =>
      answer(frame, request, { mime: 'image/png' }, pngBytes('picture'))
    )

    const image = await requestFrameImage(frame.element, {
      ratio: 2,
      depth: 1,
      maxDepth: 5,
      timeout: 500
    })

    expect(image).not.toBeNull()
    expect(await blobText(image as Blob)).toBe('picture')
    expect(image?.type).toBe('image/png')
    const render = received(frame, 'render')[0]
    // The frame paints the whole chain below it, so the level count goes with
    // every request instead of being a constant of each realm.
    expect(render?.data).toMatchObject({ ratio: 2, depth: 1, maxDepth: 5 })
    // The frame was addressed by the session id it introduced itself with.
    expect(render?.header.to).toBe(frame.sid)
  })

  it('reports a helper side failure and returns no picture', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = frameThat((request, frame) =>
      answer(frame, request, { error: 'the frame broke' })
    )

    expect(await requestFrameImage(frame.element, { ratio: 1, depth: 1, timeout: 500 })).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[element-screenshot] frame helper failed:',
      'the frame broke'
    )
  })

  it('gives up when the helper never answers', async () => {
    const frame = frameThat(() => undefined)
    expect(await requestFrameImage(frame.element, { ratio: 1, depth: 1, timeout: 60 })).toBeNull()
    expect(received(frame, 'render')).toHaveLength(1)
  })

  it('gives up when the capture is cancelled', async () => {
    const frame = frameThat(() => undefined)
    const started = Date.now()
    const pending = requestFrameImage(frame.element, { ratio: 1, depth: 1, timeout: 5_000 })
    native.capture.aborted = true
    expect(await pending).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
    // Frames render in parallel now, so every one of them has to be told to stop.
    expect(received(frame, 'render')).toHaveLength(1)
    expect(received(frame, 'cancel')[0]?.header.to).toBe(frame.sid)
  })

  it('refuses to talk without a key', async () => {
    setFrameKey('')
    const frame = fakeFrame()
    expect(await requestFrameImage(frame.element, { ratio: 1, depth: 1 })).toBeNull()
    expect(frame.posts).toHaveLength(0)
  })

  it('carries the surface of an expanded frame', async () => {
    const frame = frameThat((request, frame) => answer(frame, request, {}, pngBytes()))

    await requestFrameImage(frame.element, {
      ratio: 1,
      depth: 1,
      expand: { width: 300, height: 900 },
      timeout: 500
    })

    expect(received(frame, 'render')[0]?.data).toMatchObject({
      expand: { width: 300, height: 900 },
      maxDepth: 2
    })
  })
})

describe('frame measurement request', () => {
  it('returns the size the helper reports', async () => {
    const frame = frameThat((request, frame) => answer(frame, request, { width: 640, height: 900 }))

    expect(await requestFrameSize(frame.element, { timeout: 500 })).toEqual({
      width: 640,
      height: 900
    })
    expect(received(frame, 'measure')[0]?.header.to).toBe(frame.sid)
  })

  it('ignores an answer that does not come from the asked frame', async () => {
    const frame = frameThat((request, answering) => {
      deliver(
        wire(
          'size',
          { width: 10, height: 10 },
          { sid: answering.sid, to: request.header.sid, nonce: request.header.nonce }
        ),
        { other: 'window' }
      )
    })
    expect(await requestFrameSize(frame.element, { timeout: 60 })).toBeNull()
  })

  it('rejects a size it cannot use and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = frameThat((request, frame) =>
      answer(frame, request, { width: 0, height: 0, error: 'nothing to measure' })
    )

    expect(await requestFrameSize(frame.element, { timeout: 500 })).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      '[element-screenshot] frame helper failed:',
      'nothing to measure'
    )
  })

  it('gives up when the helper never answers', async () => {
    const frame = frameThat(() => undefined)
    expect(await requestFrameSize(frame.element, { timeout: 60 })).toBeNull()
  })

  it('refuses to measure without a key', async () => {
    setFrameKey('')
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
    const frame = frameThat((request, frame) => answer(frame, request, { items: [layer] }))

    const items = await requestFramePick(frame.element, { x: 12, y: 34, timeout: 500 })

    const hover = received(frame, 'hover')[0]
    expect(hover?.data).toMatchObject({ x: 12, y: 34 })
    expect(hover?.header.to).toBe(frame.sid)
    expect(items).toEqual([layer])
  })

  it('answers an empty list when a frame reports no layer', async () => {
    const frame = frameThat((request, frame) => answer(frame, request, { items: [] }))

    expect(await requestFramePick(frame.element, { x: 1, y: 1, timeout: 500 })).toEqual([])
  })

  it('drops malformed layers', async () => {
    const frame = frameThat((request, frame) =>
      answer(frame, request, {
        items: [layer, { id: 0, label: 'no id' }, null, { ...layer, id: 4, width: 'wide' }]
      })
    )

    const items = await requestFramePick(frame.element, { x: 1, y: 1, timeout: 500 })
    expect(items).toEqual([layer])
  })

  it('returns null when the frame does not answer', async () => {
    const frame = frameThat(() => undefined)
    expect(await requestFramePick(frame.element, { x: 1, y: 1, timeout: 60 })).toBeNull()
  })

  it('ignores an answer from another window', async () => {
    const frame = frameThat((request, answering) => {
      deliver(
        wire(
          'stack',
          { items: [layer] },
          { sid: answering.sid, to: request.header.sid, nonce: request.header.nonce }
        ),
        { other: 'window' }
      )
    })
    expect(await requestFramePick(frame.element, { x: 1, y: 1, timeout: 60 })).toBeNull()
  })

  it('refuses to ask without a key', async () => {
    setFrameKey('')
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
  it('names the element and returns the picture', async () => {
    const frame = frameThat((request, frame) =>
      answer(
        frame,
        request,
        { width: 320, height: 480, limited: false, mime: 'image/png' },
        pngBytes('element')
      )
    )

    const result = await requestFrameCapture(frame.element, {
      elementId: 7,
      ratio: 2,
      expandNested: true,
      background: { mode: 'page' },
      maxDepth: 3,
      timeout: 500
    })

    expect(received(frame, 'capture')[0]?.data).toMatchObject({
      elementId: 7,
      ratio: 2,
      expandNested: true,
      background: { mode: 'page' },
      maxDepth: 3
    })
    expect(result?.width).toBe(320)
    expect(result?.height).toBe(480)
    expect(result?.limited).toBe(false)
    expect(await blobText(result?.blob as Blob)).toBe('element')
  })

  it('reports a helper failure and returns nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const frame = frameThat((request, frame) =>
      answer(frame, request, { width: 0, height: 0, limited: false, error: 'gone' })
    )

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
    const frame = frameThat(() => undefined)
    const pending = requestFrameCapture(frame.element, {
      elementId: 1,
      ratio: 1,
      expandNested: false,
      background: { mode: 'page' },
      timeout: 5_000
    })
    native.capture.aborted = true

    expect(await pending).toBeNull()
    expect(received(frame, 'capture')).toHaveLength(1)
    expect(received(frame, 'cancel')).toHaveLength(1)
  })

  it('refuses to ask without a key', async () => {
    setFrameKey('')
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

  it('never cancels without a key', () => {
    setFrameKey('')
    expect(postFrameCancel({ postMessage: vi.fn() } as unknown as Window)).toBe(false)
  })
})
