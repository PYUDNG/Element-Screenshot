import { afterEach, describe, expect, it, vi } from 'vitest'
import { installHotkey } from '../src/core/hotkey'

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
