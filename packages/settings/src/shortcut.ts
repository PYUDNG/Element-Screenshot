export interface Shortcut {
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  key: string
}

export interface ShortcutOptions {
  /** Display ⌘ / ⌥ / ⇧ / ⌃ instead of names. Defaults to platform detection. */
  mac?: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'Fn'])

const NAMED_KEYS = [
  'Escape',
  'Space',
  'Tab',
  'Enter',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Comma',
  'Period',
  'Slash',
  'Backslash',
  'Semicolon',
  'Quote',
  'Backquote',
  'BracketLeft',
  'BracketRight',
  'Minus',
  'Equal',
  'Plus'
] as const

const EXTRA_ALIASES: Record<string, string> = {
  ' ': 'Space',
  '+': 'Plus',
  '=': 'Equal',
  '-': 'Minus',
  _: 'Minus',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  esc: 'Escape',
  spacebar: 'Space',
  return: 'Enter',
  del: 'Delete',
  ins: 'Insert',
  pgup: 'PageUp',
  pgdn: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  comma: 'Comma',
  period: 'Period',
  slash: 'Slash',
  backslash: 'Backslash',
  semicolon: 'Semicolon',
  quote: 'Quote',
  backquote: 'Backquote',
  bracketleft: 'BracketLeft',
  bracketright: 'BracketRight',
  minus: 'Minus',
  equal: 'Equal',
  plus: 'Plus'
}

function keyAlias(token: string): string | null {
  const lower = token.toLowerCase()
  if (EXTRA_ALIASES[lower]) return EXTRA_ALIASES[lower]
  for (const named of NAMED_KEYS) {
    if (named.toLowerCase() === lower) return named
  }
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase()
  if (/^[a-z0-9]$/i.test(token)) return token.toUpperCase()
  return null
}

const DISPLAY_KEY: Record<string, string> = {
  Plus: '+',
  Minus: '-',
  Equal: '=',
  Escape: 'Esc',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backspace: 'Backspace',
  Space: 'Space'
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platform = nav.userAgentData?.platform ?? nav.platform ?? ''
  return /mac|iphone|ipad|ipod/i.test(platform) || /Mac OS X/i.test(nav.userAgent)
}

export function normalizeEventKey(event: Pick<KeyboardEvent, 'key'>): string | null {
  const raw = event.key
  if (
    !raw ||
    MODIFIER_KEYS.has(raw) ||
    raw === 'Dead' ||
    raw === 'Unidentified' ||
    raw === 'Process'
  ) {
    return null
  }
  return keyAlias(raw)
}

export function parseShortcut(input: string): Shortcut | null {
  if (!input || typeof input !== 'string') return null

  const tokens = input
    .split('+')
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null

  const shortcut: Shortcut = { ctrl: false, alt: false, shift: false, meta: false, key: '' }

  for (const token of tokens) {
    const lower = token.toLowerCase()
    switch (lower) {
      case 'ctrl':
      case 'control':
        shortcut.ctrl = true
        continue
      case 'alt':
      case 'option':
      case 'opt':
        shortcut.alt = true
        continue
      case 'shift':
        shortcut.shift = true
        continue
      case 'meta':
      case 'cmd':
      case 'command':
      case 'win':
      case 'super':
        shortcut.meta = true
        continue
      default:
        break
    }

    if (shortcut.key) return null
    const key = keyAlias(token)
    if (!key) return null
    shortcut.key = key
  }

  return shortcut.key ? shortcut : null
}

export function isShortcutValid(shortcut: Shortcut | null): shortcut is Shortcut {
  if (!shortcut || !shortcut.key) return false
  if (shortcut.ctrl || shortcut.alt || shortcut.meta) return true
  return /^F([1-9]|1\d|2[0-4])$/.test(shortcut.key)
}

export function shortcutFromEvent(event: KeyboardEvent): Shortcut | null {
  const key = normalizeEventKey(event)
  if (!key) return null
  return {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
    key
  }
}

export function shortcutsEqual(a: Shortcut, b: Shortcut): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.alt === b.alt &&
    a.shift === b.shift &&
    a.meta === b.meta &&
    a.key === b.key
  )
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  shortcut: Shortcut | string | null | undefined
): boolean {
  const parsed = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut
  if (!parsed) return false
  const key = normalizeEventKey(event)
  if (!key || key !== parsed.key) return false
  return (
    event.ctrlKey === parsed.ctrl &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift &&
    event.metaKey === parsed.meta
  )
}

/** Canonical, platform-independent representation used for storage. */
export function serializeShortcut(shortcut: Shortcut): string {
  const parts: string[] = []
  if (shortcut.ctrl) parts.push('Ctrl')
  if (shortcut.alt) parts.push('Alt')
  if (shortcut.shift) parts.push('Shift')
  if (shortcut.meta) parts.push('Meta')
  parts.push(shortcut.key)
  return parts.join('+')
}

export function formatShortcut(
  shortcut: Shortcut | string | null | undefined,
  options: ShortcutOptions = {}
): string {
  const parsed = typeof shortcut === 'string' ? parseShortcut(shortcut) : shortcut
  if (!parsed) return ''

  const mac = options.mac ?? isMacPlatform()
  const parts: string[] = []
  if (parsed.ctrl) parts.push(mac ? '⌃' : 'Ctrl')
  if (parsed.alt) parts.push(mac ? '⌥' : 'Alt')
  if (parsed.shift) parts.push(mac ? '⇧' : 'Shift')
  if (parsed.meta) parts.push(mac ? '⌘' : 'Win')

  const key = DISPLAY_KEY[parsed.key] ?? parsed.key
  parts.push(key)
  return parts.join('+')
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as HTMLElement
  if (typeof element.tagName !== 'string') return false
  if (element.isContentEditable) return true
  const tag = element.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export const DEFAULT_SHORTCUT = 'Alt+Shift+S'
