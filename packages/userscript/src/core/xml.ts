const REPLACEMENT = '\uFFFD'

function isNameStartCodePoint(code: number): boolean {
  return (
    code === 0x3a ||
    code === 0x5f ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    (code >= 0xc0 && code <= 0xd6) ||
    (code >= 0xd8 && code <= 0xf6) ||
    (code >= 0xf8 && code <= 0x2ff) ||
    (code >= 0x370 && code <= 0x37d) ||
    (code >= 0x37f && code <= 0x1fff) ||
    (code >= 0x200c && code <= 0x200d) ||
    (code >= 0x2070 && code <= 0x218f) ||
    (code >= 0x2c00 && code <= 0x2fef) ||
    (code >= 0x3001 && code <= 0xd7ff) ||
    (code >= 0xf900 && code <= 0xfdcf) ||
    (code >= 0xfdf0 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0xeffff)
  )
}

function isNameCodePoint(code: number): boolean {
  return (
    isNameStartCodePoint(code) ||
    code === 0x2d ||
    code === 0x2e ||
    (code >= 0x30 && code <= 0x39) ||
    code === 0xb7 ||
    (code >= 0x300 && code <= 0x36f) ||
    (code >= 0x203f && code <= 0x2040)
  )
}

/** XML 1.0 Name production, used to reject HTML-only attribute names. */
export function isValidXmlName(name: string): boolean {
  if (!name) return false

  let first = true
  for (const character of name) {
    const code = character.codePointAt(0)
    if (code === undefined) return false
    if (first) {
      if (!isNameStartCodePoint(code)) return false
      first = false
      continue
    }
    if (!isNameCodePoint(code)) return false
  }

  return !first
}

function isInvalidBmpCodePoint(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return false
  if (code < 0x20) return true
  if (code >= 0xd800 && code <= 0xdfff) return true
  return code === 0xfffe || code === 0xffff
}

/**
 * HTML permits control characters that XML 1.0 forbids. `XMLSerializer` copies
 * them verbatim into the SVG wrapper, which makes Chromium reject the whole
 * image. Replace only invalid code points and preserve valid surrogate pairs.
 */
export function sanitizeXmlText(value: string): string {
  let result = ''
  let start = 0

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    let invalid: boolean

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1
        continue
      }
      invalid = true
    } else {
      invalid = isInvalidBmpCodePoint(code)
    }

    if (!invalid) continue

    result += value.slice(start, index) + REPLACEMENT
    start = index + 1
  }

  return start === 0 ? value : result + value.slice(start)
}
