import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import { createFrameHelper } from '../src/core/frame-helper'
import { frameContentBox } from '../src/core/frame-size'
import { FRAME_PROTOCOL, setFrameToken } from '../src/core/frame-bridge'

const BLOB = new Blob(['png'], { type: 'image/png' })

function messageEvent(data: unknown, source: unknown = window): MessageEvent {
  return new MessageEvent('message', {
    data,
    source: source as never,
    origin: 'http://localhost:4176'
  })
}

function hello(token = 'test-token', nonce = 'n1'): MessageEvent {
  return messageEvent({ protocol: FRAME_PROTOCOL, type: 'hello', token, nonce })
}

function renderRequest(token = 'test-token', nonce = 'n2', ratio = 2, depth = 1): MessageEvent {
  return messageEvent({ protocol: FRAME_PROTOCOL, type: 'render', token, nonce, ratio, depth })
}

function measureRequest(token = 'test-token', nonce = 'n3'): MessageEvent {
  return messageEvent({ protocol: FRAME_PROTOCOL, type: 'measure', token, nonce })
}

/** Wait for the helper's async reply to be posted. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await Promise.resolve()
  }
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  setFrameToken('test-token')
})

afterEach(() => {
  setFrameToken('')
  native.capture.aborted = false
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('frame helper', () => {
  it('answers the hello probe with the same nonce', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ render: async () => BLOB })

    helper.handleMessage(hello('test-token', 'probe-1'))

    expect(post).toHaveBeenCalledWith(
      { protocol: FRAME_PROTOCOL, type: 'ready', nonce: 'probe-1' },
      '*'
    )
  })

  it('stays quiet for a wrong token, a wrong protocol or another sender', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(hello('wrong-token'))
    helper.handleMessage(messageEvent({ protocol: 'other', type: 'hello', token: 'test-token', nonce: 'n3' }))
    helper.handleMessage(messageEvent({ protocol: FRAME_PROTOCOL, type: 'hello', token: 'test-token', nonce: 'n4' }, { other: 'window' }))
    helper.handleMessage(renderRequest('wrong-token'))
    expect(post).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('renders when asked and sends the picture back', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(renderRequest('test-token', 'r1', 3, 1))
    await settle()

    expect(render).toHaveBeenCalledWith({ ratio: 3, depth: 1 })
    expect(post).toHaveBeenCalledWith(
      { protocol: FRAME_PROTOCOL, type: 'result', nonce: 'r1', blob: BLOB },
      '*'
    )
  })

  it('reports a renderer failure instead of going silent', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({
      render: async () => {
        throw new Error('boom')
      }
    })

    helper.handleMessage(renderRequest('test-token', 'r2'))
    await settle()

    expect(post).toHaveBeenCalledWith(
      { protocol: FRAME_PROTOCOL, type: 'result', nonce: 'r2', blob: null, error: 'boom' },
      '*'
    )
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

    helper.handleMessage(renderRequest('test-token', 'first'))
    helper.handleMessage(renderRequest('test-token', 'second'))
    await settle()

    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', nonce: 'second', error: 'busy' }), '*')
    pending.release?.()
    await settle()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'result', nonce: 'first', blob: BLOB }), '*')
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

    helper.handleMessage(renderRequest('test-token', 'late'))
    await settle()
    expect(render).not.toHaveBeenCalled()

    listeners.get('DOMContentLoaded')?.()
    await settle()
    expect(render).toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ nonce: 'late', blob: BLOB }), '*')
  })

  it('serves nothing when no token is available', async () => {
    setFrameToken('')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(hello())
    helper.handleMessage(renderRequest())
    helper.handleMessage(measureRequest())
    await settle()

    expect(post).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
  })

  it('reports how large its document is', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const measure = vi.fn(() => ({ width: 640, height: 900 }))
    const helper = createFrameHelper({ measure })

    helper.handleMessage(measureRequest('test-token', 'm1'))
    await settle()

    expect(measure).toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(
      { protocol: FRAME_PROTOCOL, type: 'size', nonce: 'm1', width: 640, height: 900 },
      '*'
    )
  })

  it('answers a failed measurement with a zero size', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ measure: () => null })

    helper.handleMessage(measureRequest('test-token', 'm2'))
    await settle()

    expect(post).toHaveBeenCalledWith(
      { protocol: FRAME_PROTOCOL, type: 'size', nonce: 'm2', width: 0, height: 0 },
      '*'
    )
  })

  it('renders the expanded surface the parent asks for', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const render = vi.fn(async () => BLOB)
    const helper = createFrameHelper({ render })

    helper.handleMessage(
      messageEvent({
        protocol: FRAME_PROTOCOL,
        type: 'render',
        token: 'test-token',
        nonce: 'x1',
        ratio: 2,
        depth: 1,
        expand: { width: 300, height: 900 }
      })
    )
    await settle()

    expect(render).toHaveBeenCalledWith({ ratio: 2, depth: 1, expand: { width: 300, height: 900 } })
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'result', nonce: 'x1', blob: BLOB }),
      '*'
    )
  })
})

function hoverRequest(token = 'test-token', nonce = 'h1', x = 10, y = 20): MessageEvent {
  return messageEvent({ protocol: FRAME_PROTOCOL, type: 'hover', token, nonce, x, y })
}

function captureRequest(elementId = 1, nonce = 'c1'): MessageEvent {
  return messageEvent({
    protocol: FRAME_PROTOCOL,
    type: 'capture',
    token: 'test-token',
    nonce,
    elementId,
    ratio: 2,
    expandNested: true,
    background: { mode: 'color', color: '#fafafa' }
  })
}

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

    helper.handleMessage(hoverRequest('test-token', 'h1', 12, 34))
    await settle()

    expect(pick).toHaveBeenCalledWith(document, 12, 34)
    expect(post).toHaveBeenCalledWith(
      {
        protocol: FRAME_PROTOCOL,
        type: 'stack',
        nonce: 'h1',
        items: [{ ...pickItem(), id: 1 }]
      },
      '*'
    )

    // The same node keeps its id, a new one gets the next number.
    const other = document.createElement('div')
    pick.mockReturnValue([
      { element, item: pickItem() },
      { element: other, item: pickItem('span.tick') }
    ])
    helper.handleMessage(hoverRequest('test-token', 'h3'))
    await settle()

    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ id: 1 }),
          expect.objectContaining({ id: 2, label: 'span.tick' })
        ]
      }),
      '*'
    )
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

    helper.handleMessage(renderRequest('test-token', 'busy-render'))
    helper.handleMessage(hoverRequest('test-token', 'busy-hover'))
    await settle()

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'stack', nonce: 'busy-hover' }),
      '*'
    )
    pending.release?.(null)
    await settle()
  })

  it('keeps quiet while the document is still parsing', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const doc = { readyState: 'loading', addEventListener: vi.fn() } as unknown as Document
    const helper = createFrameHelper({ doc, pick: () => [] })

    helper.handleMessage(hoverRequest())
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

    helper.handleMessage(hoverRequest('test-token', 'h4'))
    await settle()

    expect(post).toHaveBeenCalledWith(
      { protocol: FRAME_PROTOCOL, type: 'stack', nonce: 'h4', items: [], error: 'hit test broke' },
      '*'
    )
  })

  it('ignores a hover with a wrong token', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ pick: () => [] })

    helper.handleMessage(hoverRequest('wrong-token'))
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

    helper.handleMessage(hoverRequest('test-token', 'pick-1'))
    await settle()
    helper.handleMessage(captureRequest(1, 'c1'))
    await settle()

    expect(capture).toHaveBeenCalledWith({
      element,
      ratio: 2,
      expandNested: true,
      background: { mode: 'color', color: '#fafafa' }
    })
    expect(post).toHaveBeenCalledWith(
      {
        protocol: FRAME_PROTOCOL,
        type: 'captured',
        nonce: 'c1',
        blob,
        width: 60,
        height: 80,
        limited: true
      },
      '*'
    )
  })

  it('refuses an id it never reported', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ capture: vi.fn() })

    helper.handleMessage(captureRequest(99, 'c2'))
    await settle()

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'captured',
        nonce: 'c2',
        blob: null,
        error: 'The picked element is gone'
      }),
      '*'
    )
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

    helper.handleMessage(hoverRequest('test-token', 'pick-2'))
    await settle()
    helper.handleMessage(captureRequest(1, 'c3'))
    await settle()

    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'captured', nonce: 'c3', blob: null, error: 'render broke' }),
      '*'
    )
  })

  it('stops rendering when the parent cancels', async () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ render: async () => new Blob(['png']) })

    helper.handleMessage(
      messageEvent({ protocol: FRAME_PROTOCOL, type: 'cancel', token: 'test-token', nonce: 'x' })
    )

    expect(native.capture.aborted).toBe(true)
  })

  it('refuses a capture without a usable token', async () => {
    setFrameToken('')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const helper = createFrameHelper({ capture: vi.fn() })

    helper.handleMessage(captureRequest())
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

  function postedStack(post: { mock: { calls: unknown[][] } }): { items: unknown[] } {
    const found = post.mock.calls
      .map((call) => call[0] as { type?: string })
      .find((entry) => entry && entry.type === 'stack')
    return found as unknown as { items: unknown[] }
  }

  function hoverInto(helper: ReturnType<typeof createFrameHelper>): void {
    helper.handleMessage(
      messageEvent({
        protocol: FRAME_PROTOCOL,
        type: 'hover',
        token: 'test-token',
        nonce: 'h9',
        x: 120,
        y: 70,
        depth: 2
      })
    )
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
    expect(stack.items).toHaveLength(3)
    // Deeper layers are on top, so they come first; the hop is recorded so a
    // capture can walk the same path.
    expect(stack.items[0]).toMatchObject({
      label: 'div.inner',
      left: (view?.left ?? 0) + 10,
      top: (view?.top ?? 0) + 20,
      via: [1]
    })
    expect(stack.items[1]).toMatchObject({ label: 'iframe' })
    expect(stack.items[2]).toMatchObject({ label: 'body' })
  })

  it('keeps the frame depth from the request', async () => {
    const childPick = vi.fn(async () => [{ ...pickItem('div.inner') }])
    const frame = nestedFrame()
    const helper = createFrameHelper({
      pick: () => [{ element: frame, item: pickItem('iframe') }],
      childPick
    })

    helper.handleMessage(
      messageEvent({
        protocol: FRAME_PROTOCOL,
        type: 'hover',
        token: 'test-token',
        nonce: 'h1',
        x: 120,
        y: 70,
        depth: 1
      })
    )
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
      messageEvent({
        protocol: FRAME_PROTOCOL,
        type: 'capture',
        token: 'test-token',
        nonce: 'c9',
        elementId: 7,
        via: [1],
        ratio: 2,
        expandNested: true,
        background: { mode: 'page' }
      })
    )
    await settle()

    expect(childCapture).toHaveBeenCalledWith(frame, {
      elementId: 7,
      via: [],
      ratio: 2,
      expandNested: true,
      background: { mode: 'page' }
    })
    expect(post).toHaveBeenCalledWith(
      {
        protocol: FRAME_PROTOCOL,
        type: 'captured',
        nonce: 'c9',
        blob: BLOB,
        width: 12,
        height: 34,
        limited: false
      },
      '*'
    )
  })

  it('refuses a capture with a malformed hop path', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    const capture = vi.fn()
    const helper = createFrameHelper({ capture })

    helper.handleMessage(
      messageEvent({
        protocol: FRAME_PROTOCOL,
        type: 'capture',
        token: 'test-token',
        nonce: 'c7',
        elementId: 7,
        via: [0],
        ratio: 1,
        expandNested: false,
        background: { mode: 'page' }
      })
    )
    await settle()

    expect(capture).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'captured', nonce: 'c7', error: 'The element path is invalid' }),
      '*'
    )
  })

  it('forwards the deadline it was given and skips a child when it has expired', async () => {
    const frame = nestedFrame()
    const childPick = vi.fn(async () => [{ ...pickItem('div.inner') }])
    const helper = createFrameHelper({
      pick: () => [{ element: frame, item: pickItem('iframe') }],
      childPick
    })
    const deadline = Date.now() + 5000

    helper.handleMessage(
      messageEvent({
        protocol: FRAME_PROTOCOL,
        type: 'hover',
        token: 'test-token',
        nonce: 'h20',
        x: 120,
        y: 70,
        depth: 3,
        deadline
      })
    )
    await settle()

    expect(childPick).toHaveBeenCalledWith(frame, expect.objectContaining({ depth: 2, deadline }))

    childPick.mockClear()
    helper.handleMessage(
      messageEvent({
        protocol: FRAME_PROTOCOL,
        type: 'hover',
        token: 'test-token',
        nonce: 'h21',
        x: 120,
        y: 70,
        depth: 3,
        deadline: Date.now() - 1
      })
    )
    await settle()

    expect(childPick).not.toHaveBeenCalled()
  })
})
