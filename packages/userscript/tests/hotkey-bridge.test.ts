import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFrameHotkey, installHotkeyBridge } from '../src/core/hotkey-bridge'
import type { HotkeyBridge } from '../src/core/hotkey-bridge'
import { FRAME_PROTOCOL, setFrameToken } from '../src/core/frame-bridge'
import type { FrameMessage } from '../src/core/frame-bridge'

const TOKEN = 'test-token-1234'

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Poll instead of sleeping a fixed time: the whole suite competes for the loop. */
async function until(check: () => boolean, timeout = 3_000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting for a condition')
    await wait(5)
  }
}

interface FakeWindow {
  postMessage: ReturnType<typeof vi.fn>
}

function fakeWindow(): FakeWindow {
  return { postMessage: vi.fn() }
}

function message(data: unknown, source: unknown): MessageEvent {
  return new MessageEvent('message', {
    data: { protocol: FRAME_PROTOCOL, ...(data as object) },
    source: source as never,
    origin: 'http://localhost:4176'
  })
}

function dispatch(data: unknown, source: unknown): void {
  window.dispatchEvent(message(data, source))
}

/** Messages the frame posted to its parent, by type. */
function posted(post: { mock: { calls: unknown[][] } }, type: string): FrameMessage[] {
  return post.mock.calls
    .map((call) => call[0] as FrameMessage)
    .filter((entry) => entry && entry.type === type)
}

let off: (() => void) | null = null
let bridge: HotkeyBridge | null = null

beforeEach(() => {
  setFrameToken(TOKEN)
})

afterEach(() => {
  off?.()
  off = null
  bridge?.dispose()
  bridge = null
  setFrameToken('')
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('hotkey bridge in the top document', () => {
  it('hands the shortcut to a frame that subscribes', () => {
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({
      getShortcut: () => 'Alt+Shift+S',
      onTrigger: () => undefined
    })

    dispatch({ type: 'subscribe', token: TOKEN, nonce: 's1' }, frameWin)

    expect(frameWin.postMessage).toHaveBeenCalledWith(
      {
        protocol: FRAME_PROTOCOL,
        type: 'hotkey',
        token: TOKEN,
        nonce: expect.any(String),
        shortcut: 'Alt+Shift+S'
      },
      '*'
    )
  })

  it('answers a wrong install only silence', () => {
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({
      getShortcut: () => 'Alt+Shift+S',
      onTrigger: () => undefined
    })

    dispatch({ type: 'subscribe', token: 'other-install', nonce: 's2' }, frameWin)
    bridge.broadcast()

    expect(frameWin.postMessage).not.toHaveBeenCalled()
  })

  it('pushes a changed shortcut to the frames that subscribed', () => {
    let shortcut = 'Alt+Shift+S'
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({ getShortcut: () => shortcut, onTrigger: () => undefined })

    dispatch({ type: 'subscribe', token: TOKEN, nonce: 's3' }, frameWin)
    frameWin.postMessage.mockClear()

    shortcut = 'Ctrl+Shift+K'
    bridge.broadcast()

    expect(frameWin.postMessage).toHaveBeenCalledTimes(1)
    expect(frameWin.postMessage.mock.calls[0]?.[0]).toMatchObject({ shortcut: 'Ctrl+Shift+K' })
  })

  it('starts a capture on a verified press', () => {
    const onTrigger = vi.fn()
    bridge = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger })

    dispatch({ type: 'trigger', token: TOKEN, nonce: 't1', shortcut: 'Alt+Shift+S' }, fakeWindow())

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('drops a press matched against an outdated shortcut', () => {
    const onTrigger = vi.fn()
    let shortcut = 'Alt+Shift+S'
    bridge = installHotkeyBridge({ getShortcut: () => shortcut, onTrigger })

    shortcut = 'Ctrl+Shift+K'
    dispatch({ type: 'trigger', token: TOKEN, nonce: 't2', shortcut: 'Alt+Shift+S' }, fakeWindow())
    expect(onTrigger).not.toHaveBeenCalled()

    dispatch({ type: 'trigger', token: TOKEN, nonce: 't3', shortcut: 'Ctrl+Shift+K' }, fakeWindow())
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('stays quiet for a wrong token or while the UI is busy', () => {
    const onTrigger = vi.fn()
    bridge = installHotkeyBridge({
      getShortcut: () => 'Alt+Shift+S',
      onTrigger,
      shouldIgnore: () => true
    })

    dispatch({ type: 'trigger', token: 'other-install', nonce: 't4', shortcut: 'Alt+Shift+S' }, fakeWindow())
    dispatch({ type: 'trigger', token: TOKEN, nonce: 't5', shortcut: 'Alt+Shift+S' }, fakeWindow())

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('stops listening after disposal', () => {
    const onTrigger = vi.fn()
    const installed = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger })
    installed.dispose()

    dispatch({ type: 'trigger', token: TOKEN, nonce: 't6', shortcut: 'Alt+Shift+S' }, fakeWindow())

    expect(onTrigger).not.toHaveBeenCalled()
  })
})

describe('hotkey relay in a frame', () => {
  function configure(shortcut: string): void {
    dispatch({ type: 'hotkey', token: TOKEN, nonce: 'c1', shortcut }, window)
  }

  it('asks for the shortcut once and stops when the answer arrives', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0, 200] })

    await until(() => posted(post, 'subscribe').length >= 1)
    const asked = posted(post, 'subscribe')
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ token: TOKEN })

    configure('Alt+Shift+S')
    await wait(300)

    expect(posted(post, 'subscribe')).toHaveLength(1)
  })

  it('keeps asking while the parent has not answered yet', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0, 20] })

    await until(() => posted(post, 'subscribe').length >= 2)

    expect(posted(post, 'subscribe').length).toBeGreaterThan(1)
  })

  it('does nothing without a token', () => {
    setFrameToken('')
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })

    configure('Alt+Shift+S')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true }))

    expect(post).not.toHaveBeenCalled()
  })

  it('reports a press of the configured shortcut', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true, bubbles: true })
    )

    expect(posted(post, 'trigger')).toEqual([
      expect.objectContaining({ token: TOKEN, shortcut: 'Alt+Shift+S' })
    ])
  })

  it('ignores other keys and keys typed into a text field', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('F5')

    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }))
    expect(posted(post, 'trigger')).toHaveLength(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5' }))
    expect(posted(post, 'trigger')).toHaveLength(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6' }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true }))
    expect(posted(post, 'trigger')).toHaveLength(1)
  })

  it('ignores a shortcut handed out by a wrong install or a grandparent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })

    dispatch({ type: 'hotkey', token: 'other-install', nonce: 'c2', shortcut: 'Alt+Shift+S' }, window)
    dispatch({ type: 'hotkey', token: TOKEN, nonce: 'c3', shortcut: 'Alt+Shift+S' }, {})
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true }))

    expect(posted(post, 'trigger')).toHaveLength(0)
  })

  it('answers a nested frame with its own copy of the shortcut', () => {
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')

    const child = fakeWindow()
    dispatch({ type: 'subscribe', token: TOKEN, nonce: 'n1' }, child)

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'hotkey', shortcut: 'Alt+Shift+S' }),
      '*'
    )
  })

  it('passes a nested frame press up to its own parent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    post.mockClear()

    dispatch({ type: 'trigger', token: TOKEN, nonce: 'n2', shortcut: 'Alt+Shift+S' }, fakeWindow())

    expect(posted(post, 'trigger')).toEqual([
      expect.objectContaining({ shortcut: 'Alt+Shift+S' })
    ])
  })
})
