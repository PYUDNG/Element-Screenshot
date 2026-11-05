import { describe, expect, it } from 'vitest'
import { isValidXmlName, isValidXmlQName, sanitizeXmlText } from '../src/core/xml'

describe('XML name validation', () => {
  it('accepts XML attribute names', () => {
    for (const name of [
      'class',
      'data-testid',
      'xlink:href',
      'xml:lang',
      'aria-label',
      '数据-id'
    ]) {
      expect(isValidXmlName(name), name).toBe(true)
    }
  })

  it('rejects HTML-only names', () => {
    for (const name of ['$bgcolor', '@click', '1foo', 'foo bar', 'foo?bar', '']) {
      expect(isValidXmlName(name), name).toBe(false)
    }
  })
})

describe('XML QName validation', () => {
  it('accepts one well-formed prefix', () => {
    for (const name of ['class', 'wiz:wakeup', 'xlink:href', 'xml:lang', '数据:id']) {
      expect(isValidXmlQName(name), name).toBe(true)
    }
  })

  it('rejects names an XML parser cannot use as an attribute QName', () => {
    for (const name of [
      '$bgcolor',
      'wiz:wakeup:extra',
      ':wakeup',
      'wiz:',
      'wi z:wakeup',
      '1wiz:wakeup',
      ''
    ]) {
      expect(isValidXmlQName(name), name).toBe(false)
    }
  })
})

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
