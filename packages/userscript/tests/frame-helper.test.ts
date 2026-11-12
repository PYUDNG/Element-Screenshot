import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import { createFrameHelper } from '../src/core/frame-helper'
import { frameContentBox } from '../src/core/frame-size'
import { getFrameSessionId, openFrameMessage, setFrameKey } from '../src/core/frame-bridge'
import type { FrameMessageType, OpenedFrameMessage } from '../src/core/frame-bridge'
import { OTHER_KEY, TEST_KEY, wire, wireWith } from './frame-wire'

const BLOB = new Blob(['png'], { type: 'image/png' })
/** The id the fake parent introduces itself with. */
const PARENT = 'parent-test'

function messageEvent(data: unknown, source: unknown = window): MessageEvent {
  return new MessageEvent('message', {
    data,
    source: source as never,
    origin: 'http://localhost:4176'
  })
}

/** A request the way a parent of this install would seal it. */
function request(
  type: FrameMessageType,
  data: Record<string, unknown> = {},
  nonce = 'n1'
): MessageEvent {
  return messageEvent(wire(type, data, { sid: PARENT, to: getFrameSessionId(), nonce }))
}

/** What the helper posted, opened so a test can read it. */
function replies(post: { mock: { calls: unknown[][] } }): OpenedFrameMessage[] {
  return post.mock.calls
    .map((call) => openFrameMessage(call[0]))
    .filter((message): message is OpenedFrameMessage => message !== null)
}

function binaryText(message: OpenedFrameMessage | undefined): string {
  return message?.binary ? new TextDecoder().decode(message.binary) : ''
}

/** Wait for the helper's async reply to be posted. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    for (let tick = 0; tick < 20; tick += 1) {
      await Promise.resolve()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
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

describe('frame helper', () => {
  it('answers the hello probe with the same nonce', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ render: async () => BLOB })

    helper.handleMessage(request('hello', {}, 'probe-1'))
    await settle()

    const [ready] = replies(post)
    expect(ready?.type).toBe('ready')
    expect(ready?.header).toMatchObject({ nonce: 'probe-1', to: PARENT })
    expect(ready?.header.sid).toBe(getFrameSessionId())
  })

  it('stays quiet for a wrong key, a wrong protocol or another sender', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(
      messageEvent(wireWith(OTHER_KEY, 'hello', {}, { sid: PARENT, to: getFrameSessionId() }))
    )
    helper.handleMessage(
      messageEvent({ protocol: 'other', type: 'hello', token: 'test-token', nonce: 'n3' })
    )
    helper.handleMessage(
      messageEvent(
        wire('hello', {}, { sid: PARENT, to: getFrameSessionId(), nonce: 'n4' }),
        { other: 'window' }
      )
    )
    helper.handleMessage(
      messageEvent(wireWith(OTHER_KEY, 'render', { ratio: 1, depth: 1 }, { sid: PARENT, to: getFrameSessionId() }))
    )
    await settle()

    expect(post).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('renders when asked and sends the picture back', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(request('render', { ratio: 3, depth: 1 }, 'r1'))
    await settle()

    expect(render).toHaveBeenCalledWith({ ratio: 3, depth: 1, maxDepth: 2 })
    const [result] = replies(post)
    expect(result?.type).toBe('result')
    expect(result?.header.nonce).toBe('r1')
    expect(result?.header.to).toBe(PARENT)
    expect(binaryText(result)).toBe('png')
    expect(result?.data).toEqual({ mime: 'image/png' })
  })

  it('reports a renderer failure instead of going silent', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({
      render: async () => {
        throw new Error('boom')
      }
    })

    helper.handleMessage(request('render', {}, 'r2'))
    await settle()

    const [result] = replies(post)
    expect(result?.type).toBe('result')
    expect(result?.header.nonce).toBe('r2')
    expect(result?.data).toEqual({ error: 'boom' })
    expect(result?.binary).toBeNull()
  })

  it('refuses a second render while the first one runs', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const pending: { release?: () => void } = {}
    const helper = createFrameHelper({
      render: () =>
        new Promise<Blob | null>((resolve) => {
          pending.release = () => resolve(BLOB)
        })
    })

    helper.handleMessage(request('render', {}, 'first'))
    helper.handleMessage(request('render', {}, 'second'))
    await settle()

    expect(replies(post)).toContainEqual(
      expect.objectContaining({ type: 'result', header: expect.objectContaining({ nonce: 'second' }), data: { error: 'busy' } })
    )
    pending.release?.()
    await settle()
    expect(replies(post)).toContainEqual(
      expect.objectContaining({ type: 'result', header: expect.objectContaining({ nonce: 'first' }) })
    )
  })

  it('waits for the document to be parsed before rendering', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const listeners = new Map<string, () => void>()
    const doc = {
      readyState: 'loading',
      addEventListener: (type: string, listener: () => void) => {
        listeners.set(type, listener)
      }
    } as unknown as Document
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ doc, render })

    helper.handleMessage(request('render', {}, 'late'))
    await settle()
    expect(render).not.toHaveBeenCalled()

    listeners.get('DOMContentLoaded')?.()
    await settle()
    expect(render).toHaveBeenCalled()
    expect(replies(post)).toContainEqual(
      expect.objectContaining({ type: 'result', header: expect.objectContaining({ nonce: 'late' }) })
    )
  })

  it('serves nothing when no key is available', async () => {
    setFrameKey('')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(request('hello'))
    helper.handleMessage(request('render'))
    helper.handleMessage(request('measure'))
    await settle()

    expect(post).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('reports how large its document is', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const measure = vi.fn(() => ({ width: 640, height: 900 }))
    const helper = createFrameHelper({ measure })

    helper.handleMessage(request('measure', {}, 'm1'))
    await settle()

    expect(measure).toHaveBeenCalled()
    const [size] = replies(post)
    expect(size?.type).toBe('size')
    expect(size?.header).toMatchObject({ nonce: 'm1', to: PARENT })
    expect(size?.data).toMatchObject({ width: 640, height: 900 })
  })

  it('answers a failed measurement with a zero size', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ measure: () => null })

    helper.handleMessage(request('measure', {}, 'm2'))
    await settle()

    expect(replies(post)[0]?.data).toMatchObject({ width: 0, height: 0 })
  })

  it('renders the expanded surface the parent asks for', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(
      request('render', { ratio: 2, depth: 1, expand: { width: 300, height: 900 } }, 'x1')
    )
    await settle()

    expect(render).toHaveBeenCalledWith({
      ratio: 2,
      depth: 1,
      maxDepth: 2,
      expand: { width: 300, height: 900 }
    })
    expect(replies(post)[0]?.type).toBe('result')
  })
})

function pickItem(label = 'div.card') {
  return {
    id: 0,
    label,
    left: 1,
    top: 2,
    width: 30,
    height: 40,
    contentWidth: 30,
    contentHeight: 400,
    scrollAxis: 'y' as const,
    fullPage: false
  }
}

describe('frame pick answers', () => {
  it('answers a hover with ids the capture can name', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const element = document.createElement('div')
    const pick = vi.fn(() => [{ element, item: pickItem() }])
    const helper = createFrameHelper({ pick })

    helper.handleMessage(request('hover', { x: 12, y: 34 }, 'h1'))
    await settle()

    expect(pick).toHaveBeenCalledWith(document, 12, 34)
    const [stack] = replies(post)
    expect(stack?.type).toBe('stack')
    expect(stack?.header).toMatchObject({ nonce: 'h1', to: PARENT })
    expect(stack?.data).toEqual({ items: [{ ...pickItem(), id: 1 }] })

    // The same node keeps its id, a new one gets the next number.
    const other = document.createElement('div')
    pick.mockReturnValue([
      { element, item: pickItem() },
      { element: other, item: pickItem('span.tick') }
    ])
    helper.handleMessage(request('hover', {}, 'h3'))
    await settle()

    const items = replies(post)[1]?.data.items as Array<Record<string, unknown>>
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ id: 1 })
    expect(items[1]).toMatchObject({ id: 2, label: 'span.tick' })
  })

  it('answers a hover while a render is running', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const pending: { release?: (blob: Blob | null) => void } = {}
    const helper = createFrameHelper({
      render: () =>
        new Promise<Blob | null>((resolve) => {
          pending.release = resolve
        }),
      pick: () => [{ element: document.body, item: pickItem('body') }]
    })

    helper.handleMessage(request('render', {}, 'busy-render'))
    helper.handleMessage(request('hover', { x: 1, y: 1 }, 'busy-hover'))
    await settle()

    expect(replies(post)).toContainEqual(
      expect.objectContaining({ type: 'stack', header: expect.objectContaining({ nonce: 'busy-hover' }) })
    )
    pending.release?.(null)
    await settle()
  })

  it('keeps quiet while the document is still parsing', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const doc = { readyState: 'loading', addEventListener: vi.fn() } as unknown as Document
    const helper = createFrameHelper({ doc, pick: () => [] })

    helper.handleMessage(request('hover'))
    await settle()

    expect(post).not.toHaveBeenCalled()
  })

  it('reports what the pick failed on instead of going silent', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({
      pick: () => {
        throw new Error('hit test broke')
      }
    })

    helper.handleMessage(request('hover', { x: 1, y: 1 }, 'h4'))
    await settle()

    const [stack] = replies(post)
    expect(stack?.type).toBe('stack')
    expect(stack?.header.nonce).toBe('h4')
    expect(stack?.data).toEqual({ items: [], error: 'hit test broke' })
  })

  it('ignores a hover sealed with another key', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ pick: () => [] })

    helper.handleMessage(
      messageEvent(
        wireWith(OTHER_KEY, 'hover', { x: 1, y: 1 }, { sid: PARENT, to: getFrameSessionId() })
      )
    )
    await settle()

    expect(post).not.toHaveBeenCalled()
  })
})

describe('frame element capture', () => {
  it('captures the element the id names, in the frame realm', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const element = document.createElement('div')
    document.body.append(element)
    const blob = new Blob(['png'], { type: 'image/png' })
    const capture = vi.fn(async () => ({ blob, width: 60, height: 80, limited: true }))
    const helper = createFrameHelper({
      pick: () => [{ element, item: pickItem() }],
      capture
    })

    helper.handleMessage(request('hover', { x: 1, y: 1 }, 'pick-1'))
    await settle()
    helper.handleMessage(
      request(
        'capture',
        {
          elementId: 1,
          ratio: 2,
          expandNested: true,
          background: { mode: 'color', color: '#fafafa' },
          maxDepth: 4
        },
        'c1'
      )
    )
    await settle()

    expect(capture).toHaveBeenCalledWith({
      element,
      ratio: 2,
      expandNested: true,
      background: { mode: 'color', color: '#fafafa' },
      maxDepth: 4
    })
    const captured = replies(post).find((message) => message.type === 'captured')
    expect(captured?.header).toMatchObject({ nonce: 'c1', to: PARENT })
    expect(captured?.data).toMatchObject({ width: 60, height: 80, limited: true })
    expect(binaryText(captured)).toBe('png')
  })

  it('clamps a frame depth it cannot honour', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const element = document.createElement('div')
    document.body.append(element)
    const capture = vi.fn(async () => ({ blob: BLOB, width: 1, height: 1, limited: false }))
    const helper = createFrameHelper({
      pick: () => [{ element, item: pickItem() }],
      capture
    })

    helper.handleMessage(request('hover', { x: 1, y: 1 }, 'pick-3'))
    await settle()
    // A parent asking for a hundred levels must not make this frame render an
    // unbounded chain; the cap is the same one the picker uses.
    helper.handleMessage(
      request(
        'capture',
        { elementId: 1, ratio: 1, expandNested: false, background: { mode: 'page' }, maxDepth: 99 },
        'c4'
      )
    )
    await settle()

    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ maxDepth: 6 }))
  })

  it('refuses an id it never reported', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ capture: vi.fn() })

    helper.handleMessage(request('capture', { elementId: 99, ratio: 1, background: { mode: 'page' } }, 'c2'))
    await settle()

    const [captured] = replies(post)
    expect(captured?.type).toBe('captured')
    expect(captured?.data).toMatchObject({
      width: 0,
      height: 0,
      error: 'The picked element is gone'
    })
    expect(captured?.binary).toBeNull()
  })

  it('reports a capture failure', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const element = document.createElement('div')
    document.body.append(element)
    const helper = createFrameHelper({
      pick: () => [{ element, item: pickItem() }],
      capture: async () => {
        throw new Error('render broke')
      }
    })

    helper.handleMessage(request('hover', { x: 1, y: 1 }, 'pick-2'))
    await settle()
    helper.handleMessage(request('capture', { elementId: 1, ratio: 1 }, 'c3'))
    await settle()

    expect(replies(post).find((message) => message.type === 'captured')?.data).toMatchObject({
      error: 'render broke'
    })
  })

  it('stops rendering when the parent cancels', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ render: async () => new Blob(['png']) })

    helper.handleMessage(request('cancel', {}, 'x'))

    expect(native.capture.aborted).toBe(true)
  })

  it('refuses a capture without a usable key', async () => {
    setFrameKey('')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ capture: vi.fn() })

    helper.handleMessage(request('capture'))
    await settle()

    expect(post).not.toHaveBeenCalled()
  })
})

describe('piercing a nested frame', () => {
  function nestedFrame(): HTMLIFrameElement {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    Object.defineProperty(frame, 'clientWidth', { value: 300 })
    Object.defineProperty(frame, 'clientHeight', { value: 200 })
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 50,
      width: 300,
      height: 200,
      right: 400,
      bottom: 250,
      x: 100,
      y: 50,
      toJSON: () => ({})
    } as DOMRect)
    return frame
  }

  function postedStack(post: { mock: { calls: unknown[][] } }): { items: unknown[] } | undefined {
    return replies(post).find((message) => message.type === 'stack')?.data as
      | { items: unknown[] }
      | undefined
  }

  function hoverInto(helper: ReturnType<typeof createFrameHelper>, nonce = 'h9', depth = 2): void {
    helper.handleMessage(request('hover', { x: 120, y: 70, depth }, nonce))
  }

  it('asks the frame under the pointer and names the door it used', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const frame = nestedFrame()
    const childPick = vi.fn(async () => [{ ...pickItem('div.inner'), left: 10, top: 20 }])
    const helper = createFrameHelper({
      pick: () => [
        { element: frame, item: pickItem('iframe') },
        { element: document.body, item: pickItem('body') }
      ],
      childPick
    })

    hoverInto(helper)
    await settle()

    const view = frameContentBox(frame)
    expect(view).not.toBeNull()
    // The point is handed over in the child's own coordinates, with one level of
    // budget spent; the deadline is the one the parent set, not a fresh timeout.
    expect(childPick).toHaveBeenCalledWith(frame, {
      x: 120 - (view?.left ?? 0),
      y: 70 - (view?.top ?? 0),
      depth: 1,
      deadline: expect.any(Number)
    })
    const stack = postedStack(post)
    expect(stack?.items).toHaveLength(3)
    // Deeper layers are on top, so they come first; the hop is recorded so a
    // capture can walk the same path.
    expect(stack?.items[0]).toMatchObject({
      label: 'div.inner',
      left: (view?.left ?? 0) + 10,
      top: (view?.top ?? 0) + 20,
      via: [1]
    })
    expect(stack?.items[1]).toMatchObject({ label: 'iframe' })
    expect(stack?.items[2]).toMatchObject({ label: 'body' })
  })

  it('keeps the frame depth from the request', async () => {
    const childPick = vi.fn(async () => [{ ...pickItem('div.inner') }])
    const frame = nestedFrame()
    const helper = createFrameHelper({
      pick: () => [{ element: frame, item: pickItem('iframe') }],
      childPick
    })

    hoverInto(helper, 'h1', 1)
    await settle()

    expect(childPick).not.toHaveBeenCalled()
  })

  it('captures a deep layer through the hop a hover reported', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const frame = nestedFrame()
    const childCapture = vi.fn(async () => ({
      blob: BLOB,
      width: 12,
      height: 34,
      limited: false
    }))
    const helper = createFrameHelper({
      pick: () => [{ element: frame, item: pickItem('iframe') }],
      childPick: async () => [{ ...pickItem('div.inner') }],
      childCapture
    })

    hoverInto(helper)
    await settle()

    helper.handleMessage(
      request(
        'capture',
        {
          elementId: 7,
          via: [1],
          ratio: 2,
          expandNested: true,
          background: { mode: 'page' },
          maxDepth: 5
        },
        'c9'
      )
    )
    await settle()

    expect(childCapture).toHaveBeenCalledWith(frame, {
      elementId: 7,
      via: [],
      ratio: 2,
      expandNested: true,
      background: { mode: 'page' },
      maxDepth: 5
    })
    const captured = replies(post).find((message) => message.type === 'captured')
    expect(captured?.header).toMatchObject({ nonce: 'c9', to: PARENT })
    expect(captured?.data).toMatchObject({ width: 12, height: 34, limited: false })
    expect(binaryText(captured)).toBe('png')
  })

  it('refuses a capture with a malformed hop path', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const capture = vi.fn()
    const helper = createFrameHelper({ capture })

    helper.handleMessage(
      request(
        'capture',
        {
          elementId: 7,
          via: [0],
          ratio: 1,
          expandNested: false,
          background: { mode: 'page' }
        },
        'c7'
      )
    )
    await settle()

    expect(capture).not.toHaveBeenCalled()
    expect(replies(post).find((message) => message.type === 'captured')?.data).toMatchObject({
      error: 'The element path is invalid'
    })
  })

  it('forwards the deadline it was given and skips a child when it has expired', async () => {
    const frame = nestedFrame()
    const childPick = vi.fn(async () => [{ ...pickItem('div.inner') }])
    const helper = createFrameHelper({
      pick: () => [{ element: frame, item: pickItem('iframe') }],
      childPick
    })
    const deadline = Date.now() + 5000

    helper.handleMessage(request('hover', { x: 120, y: 70, depth: 3, deadline }, 'h20'))
    await settle()

    expect(childPick).toHaveBeenCalledWith(frame, expect.objectContaining({ depth: 2, deadline }))

    childPick.mockClear()
    helper.handleMessage(
      request('hover', { x: 120, y: 70, depth: 3, deadline: Date.now() - 1 }, 'h21')
    )
    await settle()

    expect(childPick).not.toHaveBeenCalled()
  })
})
