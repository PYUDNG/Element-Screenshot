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

  it('hands a reported key to the UI', () => {
    const onKey = vi.fn()
    bridge = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger: () => undefined, onKey })

    dispatch({ type: 'key', token: TOKEN, nonce: 'k1', key: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, fakeWindow())
    dispatch({ type: 'key', token: 'other-install', nonce: 'k2', key: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, fakeWindow())

    expect(onKey).toHaveBeenCalledTimes(1)
    expect(onKey).toHaveBeenCalledWith({
      key: 'Escape',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false
    })
  })

  it('announces the open capture UI to the frames that subscribed', () => {
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger: () => undefined })
    dispatch({ type: 'subscribe', token: TOKEN, nonce: 's4' }, frameWin)
    frameWin.postMessage.mockClear()

    bridge.setActive(true)
    expect(frameWin.postMessage).toHaveBeenCalledTimes(1)
    expect(frameWin.postMessage.mock.calls[0]?.[0]).toMatchObject({ type: 'ui', active: true })

    // Repeating the same state does not spam the frame.
    bridge.setActive(true)
    expect(frameWin.postMessage).toHaveBeenCalledTimes(1)

    bridge.setActive(false)
    expect(frameWin.postMessage.mock.calls[1]?.[0]).toMatchObject({ type: 'ui', active: false })
  })

  it('tells a late subscriber that the UI is already open', () => {
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger: () => undefined })
    bridge.setActive(true)

    dispatch({ type: 'subscribe', token: TOKEN, nonce: 's5' }, frameWin)

    expect(frameWin.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ui', active: true }),
      '*'
    )
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

  it('reports the picker keys while the capture UI is open and swallows them', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    post.mockClear()

    dispatch({ type: 'ui', token: TOKEN, nonce: 'u1', active: true }, window)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    window.dispatchEvent(escape)

    expect(posted(post, 'key')).toEqual([
      expect.objectContaining({
        token: TOKEN,
        key: 'Escape',
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        metaKey: false
      })
    ])
    expect(escape.defaultPrevented).toBe(true)

    const command = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, cancelable: true })
    window.dispatchEvent(command)
    expect(posted(post, 'key')).toHaveLength(2)
    expect(command.defaultPrevented).toBe(true)
  })

  it('keeps typed text and unrelated keys out of the relay', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    dispatch({ type: 'ui', token: TOKEN, nonce: 'u2', active: true }, window)
    post.mockClear()

    const letter = new KeyboardEvent('keydown', { key: 'a', cancelable: true })
    window.dispatchEvent(letter)
    const paste = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, cancelable: true })
    window.dispatchEvent(paste)
    const space = new KeyboardEvent('keydown', { key: ' ', cancelable: true })
    window.dispatchEvent(space)

    expect(posted(post, 'key')).toHaveLength(0)
    expect(letter.defaultPrevented).toBe(false)
    expect(paste.defaultPrevented).toBe(false)
    // Space is swallowed so it cannot scroll the page under the picker.
    expect(space.defaultPrevented).toBe(true)
  })

  it('stops relaying once the capture UI is closed', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    dispatch({ type: 'ui', token: TOKEN, nonce: 'u3', active: true }, window)
    dispatch({ type: 'ui', token: TOKEN, nonce: 'u4', active: false }, window)
    post.mockClear()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    expect(posted(post, 'key')).toHaveLength(0)
  })

  it('ignores a UI state from a wrong install or a grandparent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')

    dispatch({ type: 'ui', token: 'other-install', nonce: 'u5', active: true }, window)
    dispatch({ type: 'ui', token: TOKEN, nonce: 'u6', active: true }, {})
    post.mockClear()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    expect(posted(post, 'key')).toHaveLength(0)
  })

  it('passes a nested frame key up to its own parent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    post.mockClear()

    dispatch(
      { type: 'key', token: TOKEN, nonce: 'n3', key: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
      fakeWindow()
    )

    expect(posted(post, 'key')).toEqual([expect.objectContaining({ key: 'Escape' })])
  })

  it('tells a nested frame that the UI is already open', () => {
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    dispatch({ type: 'ui', token: TOKEN, nonce: 'u7', active: true }, window)

    const child = fakeWindow()
    dispatch({ type: 'subscribe', token: TOKEN, nonce: 'n4' }, child)

    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ui', active: true }),
      '*'
    )
  })
})
