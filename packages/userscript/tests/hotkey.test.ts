import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeKeyStroke, installHotkey, isTriggerStroke } from '../src/core/hotkey'

let dispose: (() => void) | null = null

afterEach(() => {
  dispose?.()
  dispose = null
  document.body.innerHTML = ''
})

describe('global hotkey', () => {
  it('triggers on the configured combination', () => {
    const onTrigger = vi.fn()
    dispose = installHotkey({ getShortcut: () => 'Alt+Shift+S', onTrigger })

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true, bubbles: true })
    )
    expect(onTrigger).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, bubbles: true }))
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated events and the ignored state', () => {
    const onTrigger = vi.fn()
    dispose = installHotkey({
      getShortcut: () => 'Alt+Shift+S',
      shouldIgnore: () => true,
      onTrigger
    })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, shiftKey: true }))
    expect(onTrigger).not.toHaveBeenCalled()
  })

  it('avoids bare function keys while typing', () => {
    const onTrigger = vi.fn()
    dispose = installHotkey({ getShortcut: () => 'F5', onTrigger })

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }))
    expect(onTrigger).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F5', bubbles: true }))
    expect(onTrigger).toHaveBeenCalledTimes(1)
  })

  it('stops listening after disposal', () => {
    const onTrigger = vi.fn()
    const off = installHotkey({ getShortcut: () => 'Alt+S', onTrigger })
    off()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true }))
    expect(onTrigger).not.toHaveBeenCalled()
  })
})

describe('shortcut matching', () => {
  function stroke(init: KeyboardEventInit, editable = false): ReturnType<typeof describeKeyStroke> {
    return describeKeyStroke(new KeyboardEvent('keydown', init), editable)
  }

  it('matches the exact modifier set only', () => {
    expect(isTriggerStroke(stroke({ key: 's', altKey: true, shiftKey: true }), 'Alt+Shift+S')).toBe(true)
    expect(isTriggerStroke(stroke({ key: 's', altKey: true }), 'Alt+Shift+S')).toBe(false)
    expect(isTriggerStroke(stroke({ key: 's', altKey: true, shiftKey: true, ctrlKey: true }), 'Alt+Shift+S')).toBe(false)
  })

  it('drops repeats and presses the page already handled', () => {
    expect(
      isTriggerStroke(stroke({ key: 's', altKey: true, shiftKey: true, repeat: true }), 'Alt+Shift+S')
    ).toBe(false)
    const handled = new KeyboardEvent('keydown', {
      key: 's',
      altKey: true,
      shiftKey: true,
      cancelable: true
    })
    handled.preventDefault()
    expect(isTriggerStroke(describeKeyStroke(handled, false), 'Alt+Shift+S')).toBe(false)
  })

  it('leaves a bare key to a text field but not to the page body', () => {
    expect(isTriggerStroke(stroke({ key: 'F5' }, true), 'F5')).toBe(false)
    expect(isTriggerStroke(stroke({ key: 'F5' }, false), 'F5')).toBe(true)
    expect(isTriggerStroke(stroke({ key: 's', ctrlKey: true }, true), 'Ctrl+S')).toBe(true)
  })

  it('reads the editable state from the event target', () => {
    const input = document.createElement('input')
    document.body.append(input)
    const event = new KeyboardEvent('keydown', { key: 'F5', bubbles: true })
    input.dispatchEvent(event)
    expect(describeKeyStroke(event).editable).toBe(true)
  })
})
