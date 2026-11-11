import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchCaptureUiKey, isPickerKey, isRelayedKey } from '../src/core/relay-key'
import type { RelayedKey } from '../src/core/relay-key'

function stroke(key: string, init: Partial<RelayedKey> = {}): RelayedKey {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...init
  }
}

let off: (() => void) | null = null

afterEach(() => {
  off?.()
  off = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('what a frame reports', () => {
  it('reports the picker keys', () => {
    for (const key of ['Escape', 'Enter', 'Tab', 'ArrowDown', 'PageUp', '+', '=', '-', '_']) {
      expect(isRelayedKey(key, false)).toBe(true)
    }
    expect(isRelayedKey('a', true)).toBe(true)
  })

  it('never reports typed text or unrelated shortcuts', () => {
    for (const key of ['a', 'x', '1', '0', ' ', 'c', 's']) {
      expect(isRelayedKey(key, false)).toBe(false)
    }
    // Only select-all carries a command modifier; copy / save belong to the
    // preview, which has the keyboard back by then.
    expect(isRelayedKey('c', true)).toBe(false)
    expect(isRelayedKey('s', true)).toBe(false)
    expect(isRelayedKey('v', true)).toBe(false)
  })
})

describe('what the picker replays', () => {
  it('accepts its own keys, with or without shift', () => {
    for (const key of ['Escape', 'Enter', 'ArrowDown', 'PageDown', '+', '-']) {
      expect(isPickerKey(stroke(key))).toBe(true)
    }
    expect(isPickerKey(stroke('ArrowDown', { shiftKey: true }))).toBe(true)
    expect(isPickerKey(stroke('a', { ctrlKey: true }))).toBe(true)
    expect(isPickerKey(stroke('a', { metaKey: true }))).toBe(true)
  })

  it('rejects keys it does not use', () => {
    expect(isPickerKey(stroke('0'))).toBe(false)
    expect(isPickerKey(stroke('x'))).toBe(false)
    expect(isPickerKey(stroke('c', { ctrlKey: true }))).toBe(false)
    expect(isPickerKey(stroke('ArrowDown', { altKey: true }))).toBe(false)
  })
})

describe('replaying a reported press', () => {
  it('reaches the window listener like a real press', () => {
    const seen: string[] = []
    const handler = (event: Event): void => {
      const keyboard = event as KeyboardEvent
      seen.push(`${keyboard.key}:${String(keyboard.shiftKey)}`)
      if (keyboard.key === 'Escape') {
        keyboard.preventDefault()
        keyboard.stopPropagation()
      }
    }
    off = () => window.removeEventListener('keydown', handler, true)
    window.addEventListener('keydown', handler, true)

    expect(dispatchCaptureUiKey(stroke('Escape'))).toBe(true)
    expect(dispatchCaptureUiKey(stroke('ArrowDown'))).toBe(false)
    expect(dispatchCaptureUiKey(stroke('ArrowDown', { shiftKey: true }))).toBe(false)
    expect(seen).toEqual(['Escape:false', 'ArrowDown:false', 'ArrowDown:true'])
  })

  it('carries the modifiers and targets the page body', () => {
    let target: EventTarget | null = null
    let ctrl = false
    const handler = (event: Event): void => {
      target = event.target
      ctrl = (event as KeyboardEvent).ctrlKey
      event.preventDefault()
    }
    off = () => window.removeEventListener('keydown', handler, true)
    window.addEventListener('keydown', handler, true)

    expect(dispatchCaptureUiKey(stroke('a', { ctrlKey: true }))).toBe(true)
    expect(ctrl).toBe(true)
    expect(target).toBe(document.body)
  })

  it('does nothing without a body to dispatch on', () => {
    const empty = document.implementation.createHTMLDocument('empty')
    empty.documentElement.remove()
    expect(dispatchCaptureUiKey(stroke('Escape'), empty)).toBe(false)
  })
})
