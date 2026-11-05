interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function channel(value: string): number {
  if (value.endsWith('%')) {
    return (Number.parseFloat(value) / 100) * 255
  }
  return Number.parseFloat(value)
}

function alpha(value: string | undefined): number {
  if (!value) return 1
  const parsed = value.endsWith('%') ? Number.parseFloat(value) / 100 : Number.parseFloat(value)
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 1
}

/** Parse the color forms that computed styles normally expose. */
export function parseCssColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase()
  if (!value || value === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }

  if (value.startsWith('#')) {
    const hex = value.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const parts = [...hex].map((char) => Number.parseInt(char + char, 16))
      if (parts.some((part) => !Number.isFinite(part))) return null
      return {
        r: parts[0] ?? 0,
        g: parts[1] ?? 0,
        b: parts[2] ?? 0,
        a: hex.length === 4 ? (parts[3] ?? 255) / 255 : 1
      }
    }
    if (hex.length === 6 || hex.length === 8) {
      const parts = [0, 2, 4, 6].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
      if (parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null
      return {
        r: parts[0] ?? 0,
        g: parts[1] ?? 0,
        b: parts[2] ?? 0,
        a: hex.length === 8 ? (parts[3] ?? 255) / 255 : 1
      }
    }
    return null
  }

  const rgb = /^rgba?\(\s*([^)]+)\)$/.exec(value)
  if (rgb) {
    const body = rgb[1] ?? ''
    const [channelsPart, alphaPart] = body.split('/')
    const channels = (channelsPart ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
    if (channels.length < 3) return null
    const r = channel(channels[0] ?? '0')
    const g = channel(channels[1] ?? '0')
    const b = channel(channels[2] ?? '0')
    if (![r, g, b].every(Number.isFinite)) return null
    return {
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
      a: alpha(alphaPart ?? channels[3])
    }
  }

  const srgb = /^color\(\s*srgb\s+([^)]+)\)$/.exec(value)
  if (srgb) {
    const body = srgb[1] ?? ''
    const [channelsPart, alphaPart] = body.split('/')
    const channels = (channelsPart ?? '').trim().split(/\s+/).filter(Boolean)
    if (channels.length < 3) return null
    const r = Number.parseFloat(channels[0] ?? '0') * 255
    const g = Number.parseFloat(channels[1] ?? '0') * 255
    const b = Number.parseFloat(channels[2] ?? '0') * 255
    if (![r, g, b].every(Number.isFinite)) return null
    return {
      r: clamp(r, 0, 255),
      g: clamp(g, 0, 255),
      b: clamp(b, 0, 255),
      a: alpha(alphaPart)
    }
  }

  return null
}

function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a)
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 }
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a,
    a
  }
}

function parentElementOf(element: Element): Element | null {
  if (element.parentElement) return element.parentElement
  const root = element.getRootNode()
  if (root && root.nodeType === 11 && 'host' in root) {
    return (root as ShadowRoot).host
  }
  return null
}

/**
 * Resolve the opaque color visible behind an element. html-to-image paints this
 * behind the clone, so transparent regions match the page instead of a fixed
 * white canvas. Only background colors are composited; ancestor background
 * images remain visible because the clone still paints the selected subtree.
 */
export function resolveBackdropColor(element: Element): string {
  const doc = element.ownerDocument
  const win = doc.defaultView ?? window
  const chain: string[] = []
  let current = parentElementOf(element)
  let guard = 0

  while (current && guard < 256) {
    guard += 1
    try {
      chain.push(win.getComputedStyle(current).backgroundColor)
    } catch {
      break
    }
    if (current === doc.documentElement) break
    current = parentElementOf(current)
  }

  if (current !== doc.documentElement && doc.documentElement) {
    try {
      chain.push(win.getComputedStyle(doc.documentElement).backgroundColor)
    } catch {
      // Keep whatever layers were readable.
    }
  }

  let result = WHITE
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const layer = parseCssColor(chain[index] ?? '')
    if (layer && layer.a > 0) result = composite(layer, result)
  }

  return `rgb(${Math.round(result.r)}, ${Math.round(result.g)}, ${Math.round(result.b)})`
}
