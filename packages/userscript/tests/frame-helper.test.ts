import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFrameHelper } from '../src/core/frame-helper'
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
