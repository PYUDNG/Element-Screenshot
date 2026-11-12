import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installFrameHotkey, installHotkeyBridge } from '../src/core/hotkey-bridge'
import type { HotkeyBridge } from '../src/core/hotkey-bridge'
import { getFrameSessionId, openFrameMessage, setFrameKey } from '../src/core/frame-bridge'
import type { FrameMessageType, OpenedFrameMessage } from '../src/core/frame-bridge'
import { OTHER_KEY, TEST_KEY, wire, wireWith } from './frame-wire'

/** The session id every fake parent introduces itself with. */
const PARENT = 'parent-test'

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

/** Dispatch one sealed message into this window. */
function dispatch(envelope: unknown, source: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: envelope,
      source: source as never,
      origin: 'http://localhost:4176'
    })
  )
}

/** A message a frame of this install sends to this window. */
function fromFrame(
  type: FrameMessageType,
  data: Record<string, unknown>,
  source: unknown,
  options: { sid?: string; to?: string; seq?: number } = {}
): void {
  dispatch(
    wire(type, data, {
      sid: options.sid ?? 'frame-a',
      // `subscribe` is a handshake, so it goes out without an addressee.
      to: options.to ?? getFrameSessionId(),
      ...(options.seq === undefined ? {} : { seq: options.seq })
    }),
    source
  )
}

/** A message the parent of a frame sends: what a frame listens for. */
function toFrame(type: FrameMessageType, data: Record<string, unknown>): void {
  dispatch(
    wire(type, data, { sid: PARENT, to: getFrameSessionId() }),
    window
  )
}

/** Either a fake window or a spy on `postMessage`. */
type PostRecorder = FakeWindow | { mock: { calls: unknown[][] } }

function callsOf(recorder: PostRecorder): unknown[][] {
  if ('postMessage' in recorder) return recorder.postMessage.mock.calls
  return recorder.mock.calls
}

/** Envelopes a fake window received, opened and filtered by type. */
function posted(recorder: PostRecorder, type: FrameMessageType): OpenedFrameMessage[] {
  return callsOf(recorder)
    .map((call) => openFrameMessage(call[0]))
    .filter((message): message is OpenedFrameMessage => message !== null)
    .filter((message) => message.type === type)
}

function raw(recorder: PostRecorder, type: FrameMessageType): Record<string, unknown> | undefined {
  return callsOf(recorder)
    .map((call) => call[0] as Record<string, unknown>)
    .find((entry) => entry && entry.type === type)
}

let off: (() => void) | null = null
let bridge: HotkeyBridge | null = null

beforeEach(() => {
  setFrameKey(TEST_KEY)
})

afterEach(() => {
  off?.()
  off = null
  bridge?.dispose()
  bridge = null
  setFrameKey('')
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

    fromFrame('subscribe', {}, frameWin, { to: '' })

    const [hotkey] = posted(frameWin, 'hotkey')
    expect(hotkey?.header.to).toBe('frame-a')
    expect(hotkey?.data).toEqual({ shortcut: 'Alt+Shift+S' })
  })

  it('keeps the shortcut off the wire', () => {
    // The parent's page can read everything posted into its window. Sealing is
    // what keeps the shortcut (and, more importantly, the replies) unreadable.
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({
      getShortcut: () => 'Alt+Shift+S',
      onTrigger: () => undefined
    })

    fromFrame('subscribe', {}, frameWin, { to: '' })

    const envelope = raw(frameWin, 'hotkey')
    expect(envelope && Object.keys(envelope)).toEqual(['protocol', 'type', 'box'])
    expect(JSON.stringify(envelope)).not.toContain('Alt+Shift+S')
    expect(posted(frameWin, 'hotkey')[0]?.data.shortcut).toBe('Alt+Shift+S')
  })

  it('pushes a changed shortcut to the frames that subscribed', () => {
    let shortcut = 'Alt+Shift+S'
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({ getShortcut: () => shortcut, onTrigger: () => undefined })

    fromFrame('subscribe', {}, frameWin, { to: '' })
    frameWin.postMessage.mockClear()

    shortcut = 'Ctrl+Shift+K'
    bridge.broadcast()

    expect(posted(frameWin, 'hotkey')).toHaveLength(1)
    expect(posted(frameWin, 'hotkey')[0]?.data).toEqual({ shortcut: 'Ctrl+Shift+K' })
  })

  it('starts a capture on a verified press', () => {
    const onTrigger = vi.fn()
    bridge = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger })

    fromFrame('trigger', { shortcut: 'Alt+Shift+S' }, fakeWindow())

    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('drops a press matched against an outdated shortcut', () => {
    const onTrigger = vi.fn()
    let shortcut = 'Alt+Shift+S'
    bridge = installHotkeyBridge({ getShortcut: () => shortcut, onTrigger })

    shortcut = 'Ctrl+Shift+K'
    fromFrame('trigger', { shortcut: 'Alt+Shift+S' }, fakeWindow())
    expect(onTrigger).not.toHaveBeenCalled()

    fromFrame('trigger', { shortcut: 'Ctrl+Shift+K' }, fakeWindow())
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('stays quiet while the UI is busy', () => {
    const onTrigger = vi.fn()
    bridge = installHotkeyBridge({
      getShortcut: () => 'Alt+Shift+S',
      onTrigger,
      shouldIgnore: () => true
    })

    fromFrame('trigger', { shortcut: 'Alt+Shift+S' }, fakeWindow())

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('stops listening after disposal', () => {
    const onTrigger = vi.fn()
    const installed = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger })
    installed.dispose()

    fromFrame('trigger', { shortcut: 'Alt+Shift+S' }, fakeWindow())

    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('hands a reported key to the UI', () => {
    const onKey = vi.fn()
    bridge = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger: () => undefined, onKey })

    fromFrame('key', { key: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, fakeWindow())
    fromFrame('key', { key: 'ArrowDown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, fakeWindow())

    expect(onKey).toHaveBeenCalledTimes(2)
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
    fromFrame('subscribe', {}, frameWin, { to: '' })
    frameWin.postMessage.mockClear()

    bridge.setActive(true)
    expect(posted(frameWin, 'ui')).toHaveLength(1)
    expect(posted(frameWin, 'ui')[0]?.data).toMatchObject({ active: true })

    // Repeating the same state does not spam the frame.
    bridge.setActive(true)
    expect(posted(frameWin, 'ui')).toHaveLength(1)

    bridge.setActive(false)
    expect(posted(frameWin, 'ui')[1]?.data).toMatchObject({ active: false })
  })

  it('tells a late subscriber that the UI is already open', () => {
    const frameWin = fakeWindow()
    bridge = installHotkeyBridge({ getShortcut: () => 'Alt+Shift+S', onTrigger: () => undefined })
    bridge.setActive(true)

    fromFrame('subscribe', {}, frameWin, { to: '' })

    expect(posted(frameWin, 'ui')[0]?.data).toMatchObject({ active: true })
  })
})

describe('hotkey relay in a frame', () => {
  function configure(shortcut: string): void {
    toFrame('hotkey', { shortcut })
  }

  it('asks for the shortcut once and stops when the answer arrives', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0, 200] })

    await until(() => posted(post, 'subscribe').length >= 1)
    const asked = posted(post, 'subscribe')
    expect(asked).toHaveLength(1)
    // The parent does not know our session id yet, so the ask goes out bare.
    expect(asked[0]?.header.to).toBe('')

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

  it('does nothing without a key', () => {
    setFrameKey('')
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

    const [trigger] = posted(post, 'trigger')
    expect(trigger?.data).toEqual({ shortcut: 'Alt+Shift+S' })
    expect(trigger?.header.to).toBe(PARENT)
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

    dispatch(
      wireWith(OTHER_KEY, 'hotkey', { shortcut: 'Alt+Shift+S' }, { sid: PARENT, to: getFrameSessionId() }),
      window
    )
    dispatch(
      wire('hotkey', { shortcut: 'Alt+Shift+S' }, { sid: PARENT, to: getFrameSessionId() }),
      {}
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true }))

    expect(posted(post, 'trigger')).toHaveLength(0)
  })

  it('answers a nested frame with its own copy of the shortcut', () => {
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')

    const child = fakeWindow()
    fromFrame('subscribe', {}, child, { to: '' })

    const [hotkey] = posted(child, 'hotkey')
    expect(hotkey?.data).toEqual({ shortcut: 'Alt+Shift+S' })
    expect(hotkey?.header.to).toBe('frame-a')
  })

  it('passes a nested frame press up to its own parent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    post.mockClear()

    fromFrame('trigger', { shortcut: 'Alt+Shift+S' }, fakeWindow())

    const [trigger] = posted(post, 'trigger')
    expect(trigger?.data).toEqual({ shortcut: 'Alt+Shift+S' })
    expect(trigger?.header.to).toBe(PARENT)
  })

  it('reports the picker keys while the capture UI is open and swallows them', async () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    post.mockClear()

    toFrame('ui', { active: true, passthrough: false })
    await wait(0)
    const escape = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    window.dispatchEvent(escape)

    const keys = posted(post, 'key')
    expect(keys).toHaveLength(1)
    expect(keys[0]?.data).toEqual({
      key: 'Escape',
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      metaKey: false
    })
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
    toFrame('ui', { active: true, passthrough: false })
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
    toFrame('ui', { active: true, passthrough: false })
    toFrame('ui', { active: false, passthrough: false })
    post.mockClear()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    expect(posted(post, 'key')).toHaveLength(0)
  })

  it('ignores a UI state from a wrong install or a grandparent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')

    dispatch(
      wireWith(OTHER_KEY, 'ui', { active: true, passthrough: false }, { sid: PARENT, to: getFrameSessionId() }),
      window
    )
    dispatch(wire('ui', { active: true, passthrough: false }, { sid: PARENT, to: getFrameSessionId() }), {})
    post.mockClear()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))

    expect(posted(post, 'key')).toHaveLength(0)
  })

  it('passes a nested frame key up to its own parent', () => {
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined)
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    post.mockClear()

    fromFrame(
      'key',
      { key: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false },
      fakeWindow()
    )

    const [key] = posted(post, 'key')
    expect(key?.data).toMatchObject({ key: 'Escape' })
    expect(key?.header.to).toBe(PARENT)
  })

  it('tells a nested frame that the UI is already open', () => {
    off = installFrameHotkey({ attempts: [0] })
    configure('Alt+Shift+S')
    toFrame('ui', { active: true, passthrough: false })

    const child = fakeWindow()
    fromFrame('subscribe', {}, child, { to: '' })

    expect(posted(child, 'ui')[0]?.data).toMatchObject({ active: true })
  })
})
