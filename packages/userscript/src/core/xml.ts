const REPLACEMENT = '\uFFFD'

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
