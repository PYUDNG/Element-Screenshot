import { describe, expect, it } from 'vitest'
import { sanitizeXmlText } from '../src/core/xml'

describe('XML text sanitization', () => {
  it('replaces control characters that XML 1.0 forbids', () => {
    expect(sanitizeXmlText('a\u0000b\u0001c\u0008d\u000b\u000ce')).toBe('a�b�c�d��e')
  })

  it('keeps allowed whitespace, Unicode text and emoji surrogate pairs', () => {
    const value = 'line\tone\nline\rtwo 中文 😀'
    expect(sanitizeXmlText(value)).toBe(value)
  })

  it('replaces lone surrogates without breaking valid pairs', () => {
    expect(sanitizeXmlText('a\uD800b')).toBe('a�b')
    expect(sanitizeXmlText('a\uDC00b')).toBe('a�b')
    expect(sanitizeXmlText('😀\uD800')).toBe('😀�')
  })

  it('replaces the noncharacters U+FFFE and U+FFFF', () => {
    expect(sanitizeXmlText('a\uFFFDb\uFFFEc\uFFFF')).toBe('a\uFFFDb�c�')
  })

  it('returns the original string when no replacement is needed', () => {
    const value = 'already valid'
    expect(sanitizeXmlText(value)).toBe(value)
  })
})
