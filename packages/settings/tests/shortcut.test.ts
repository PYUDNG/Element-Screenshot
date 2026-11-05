import { describe, expect, it } from 'vitest'
import {
  formatShortcut,
  isShortcutValid,
  matchesShortcut,
  normalizeEventKey,
  parseShortcut,
  serializeShortcut,
  shortcutFromEvent,
  shortcutsEqual
} from '../src/shortcut'

function event(overrides: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 's',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...overrides
  } as KeyboardEvent
}

describe('shortcut parsing', () => {
  it('parses modifiers and keys case-insensitively', () => {
    expect(parseShortcut('Alt+Shift+S')).toEqual({
      ctrl: false,
      alt: true,
      shift: true,
      meta: false,
      key: 'S'
    })
    expect(parseShortcut('ctrl+alt+plus')).toEqual({
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
      key: 'Plus'
    })
    expect(parseShortcut('Cmd+K')?.meta).toBe(true)
    expect(parseShortcut('F12')?.key).toBe('F12')
  })

  it('rejects incomplete or ambiguous shortcuts', () => {
    expect(parseShortcut('')).toBeNull()
    expect(parseShortcut('Ctrl+Shift')).toBeNull()
    expect(parseShortcut('Ctrl+A+B')).toBeNull()
    expect(parseShortcut('Ctrl+')).toBeNull()
    expect(parseShortcut('NotAKey')).toBeNull()
  })

  it('validates modifier requirements', () => {
    expect(isShortcutValid(parseShortcut('Alt+Shift+S'))).toBe(true)
    expect(isShortcutValid(parseShortcut('F5'))).toBe(true)
    expect(isShortcutValid(parseShortcut('Shift+S'))).toBe(false)
    expect(isShortcutValid(parseShortcut('Escape'))).toBe(false)
    expect(isShortcutValid(null)).toBe(false)
  })

  it('serializes and formats for each platform', () => {
    const shortcut = parseShortcut('Ctrl+Alt+Shift+Meta+S')
    expect(shortcut).not.toBeNull()
    expect(serializeShortcut(shortcut!)).toBe('Ctrl+Alt+Shift+Meta+S')
    expect(formatShortcut(shortcut, { mac: false })).toBe('Ctrl+Alt+Shift+Win+S')
    expect(formatShortcut(shortcut, { mac: true })).toBe('⌃+⌥+⇧+⌘+S')
    expect(formatShortcut('Alt+Shift+Plus', { mac: false })).toBe('Alt+Shift++')
    expect(formatShortcut('')).toBe('')
  })
})

describe('shortcut matching', () => {
  it('normalizes keyboard event keys', () => {
    expect(normalizeEventKey({ key: ' ' })).toBe('Space')
    expect(normalizeEventKey({ key: '+' })).toBe('Plus')
    expect(normalizeEventKey({ key: 'a' })).toBe('A')
    expect(normalizeEventKey({ key: 'Escape' })).toBe('Escape')
    expect(normalizeEventKey({ key: 'Control' })).toBeNull()
    expect(normalizeEventKey({ key: 'Dead' })).toBeNull()
  })

  it('matches modifiers exactly', () => {
    const shortcut = 'Ctrl+Shift+S'
    expect(matchesShortcut(event({ key: 'S', ctrlKey: true, shiftKey: true }), shortcut)).toBe(true)
    expect(matchesShortcut(event({ key: 'S', ctrlKey: true }), shortcut)).toBe(false)
    expect(
      matchesShortcut(event({ key: 'S', ctrlKey: true, shiftKey: true, altKey: true }), shortcut)
    ).toBe(false)
    expect(matchesShortcut(event({ key: 'X', ctrlKey: true, shiftKey: true }), shortcut)).toBe(
      false
    )
    expect(matchesShortcut(event({}), null)).toBe(false)
  })

  it('creates shortcuts from events', () => {
    const created = shortcutFromEvent(event({ key: 's', altKey: true, metaKey: true }))
    expect(created).toEqual({ ctrl: false, alt: true, shift: false, meta: true, key: 'S' })
    expect(shortcutFromEvent(event({ key: 'Shift' }))).toBeNull()
  })

  it('compares shortcuts', () => {
    const a = parseShortcut('Ctrl+S')!
    const b = parseShortcut('Ctrl+S')!
    expect(shortcutsEqual(a, b)).toBe(true)
    expect(shortcutsEqual(a, parseShortcut('Alt+S')!)).toBe(false)
  })
})
