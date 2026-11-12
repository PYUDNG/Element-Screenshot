import { native } from './native'

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
/**
 * The canvas a dark colour scheme paints: Chrome's `#121212`, which a page that
 * only sets `color-scheme: dark` shows behind its content.
 */
const DARK_CANVAS: Rgba = { r: 18, g: 18, b: 18, a: 1 }

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

/**
 * The colour the browser paints under the page. A page that opts into a dark
 * colour scheme gets a dark canvas without ever setting a background colour, so
 * starting from white would turn every transparent part of it into a white gap.
 */
function canvasColor(doc: Document): Rgba {
  let style: CSSStyleDeclaration
  try {
    style = native.getComputedStyle(doc.documentElement)
  } catch {
    return WHITE
  }
  const tokens = (style.colorScheme ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.includes('dark')) return WHITE
  // `light dark` leaves the choice to the user's preference.
  if (!tokens.includes('light')) return DARK_CANVAS
  try {
    return typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches
      ? DARK_CANVAS
      : WHITE
  } catch {
    return WHITE
  }
}

/**
 * The page canvas is not always represented by a hit-tested element. Pages with
 * a fixed application root often leave `body` with a zero-height box while its
 * background still paints the whole canvas, so `elementsFromPoint` omits it.
 * Start from the real root/body colors instead of assuming white.
 */
function pageBaseColor(doc: Document): Rgba {
  let painted = canvasColor(doc)
  for (const root of [doc.documentElement, doc.body]) {
    if (!root) continue
    try {
      const color = parseCssColor(native.getComputedStyle(root).backgroundColor)
      if (color && color.a > 0) painted = composite(color, painted)
    } catch {
      // Keep the colors that were readable.
    }
  }
  return painted
}

function cssColor(color: Rgba): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`
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
 * Layers painted behind the element at its center. `elementsFromPoint` also
 * returns fixed, negative-z-index layers such as a page background image and
 * its darkening mask, which are not ancestors and are invisible to a plain
 * parent walk.
 */
function backdropLayers(element: Element): Element[] | null {
  try {
    const rect = native.getBoundingClientRect(element)
    const doc = element.ownerDocument
    const width = window.innerWidth || doc.documentElement?.clientWidth || 1
    const height = window.innerHeight || doc.documentElement?.clientHeight || 1
    const x = clamp(rect.left + rect.width / 2, 0, Math.max(0, width - 1))
    const y = clamp(rect.top + rect.height / 2, 0, Math.max(0, height - 1))
    const stack = native.elementsFromPoint(doc, x, y)
    const index = stack.findIndex((node) => node === element || node.contains(element))
    if (index < 0) return null
    return stack.slice(index + 1)
  } catch {
    return null
  }
}

/** Average color of a background image, when its pixels are readable. */
function averageImageColor(image: HTMLImageElement): Rgba | null {
  if (!image.complete || !image.naturalWidth || !image.naturalHeight) return null
  try {
    const size = 8
    const canvas = native.document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = native.canvas.getContext(canvas)
    if (!context) return null
    native.canvas.drawImage(context, image, 0, 0, size, size)
    const data = native.canvas.getImageData(context, 0, 0, size, size).data
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (let index = 0; index < data.length; index += 4) {
      const alpha = (data[index + 3] ?? 0) / 255
      r += (data[index] ?? 0) * alpha
      g += (data[index + 1] ?? 0) * alpha
      b += (data[index + 2] ?? 0) * alpha
      a += alpha
    }
    if (a <= 0) return null
    return { r: r / a, g: g / a, b: b / a, a: a / (size * size) }
  } catch {
    // Cross-origin background images taint the sampling canvas.
    return null
  }
}

/**
 * The page canvas color alone, ignoring whatever happens to be painted on top
 * of it. Region captures render the whole page root, so they only need the
 * colour behind transparent areas.
 */
export function resolvePageBackground(doc: Document = document): string {
  return cssColor(pageBaseColor(doc))
}

/**
 * Resolve the opaque color visible behind an element. html-to-image paints this
 * behind the clone, so transparent regions match the page instead of a fixed
 * white canvas. The paint stack at the element's center is preferred because
 * fixed page backgrounds and masks are not ancestors; a parent walk remains as
 * a fallback for off-screen or unmeasurable elements.
 */
export function resolveBackdropColor(element: Element): string {
  const doc = element.ownerDocument
  const layers = backdropLayers(element)
  if (layers && layers.length > 0) {
    let painted = pageBaseColor(doc)
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index]
      if (!layer) continue
      // The root/body colors are already the base. `elementsFromPoint` may omit
      // body entirely when it has a zero-height box.
      if (layer === doc.documentElement || layer === doc.body) continue
      let style: CSSStyleDeclaration
      try {
        style = native.getComputedStyle(layer)
      } catch {
        continue
      }
      if (layer.tagName === 'IMG') {
        const imageColor = averageImageColor(layer as HTMLImageElement)
        if (imageColor) painted = composite(imageColor, painted)
      }
      const color = parseCssColor(style.backgroundColor)
      if (color && color.a > 0) painted = composite(color, painted)
    }
    return cssColor(painted)
  }

  /*
   * The document root has no ancestors to walk, and a body background is
   * propagated to the page canvas instead of being painted on the body's box.
   * A clone of `<html>` has no canvas to propagate to, so that colour is lost
   * and html-to-image falls back to a white fill — a dark page then comes out
   * white wherever the body background used to show. The canvas colour is the
   * answer here, not the parent chain, which is empty.
   */
  if (element === doc.documentElement || element === doc.body) {
    return cssColor(pageBaseColor(doc))
  }

  const chain: string[] = []
  let current = parentElementOf(element)
  let guard = 0

  while (current && guard < 256) {
    guard += 1
    try {
      chain.push(native.getComputedStyle(current).backgroundColor)
    } catch {
      break
    }
    if (current === doc.documentElement) break
    current = parentElementOf(current)
  }

  if (current !== doc.documentElement && doc.documentElement) {
    try {
      chain.push(native.getComputedStyle(doc.documentElement).backgroundColor)
    } catch {
      // Keep whatever layers were readable.
    }
  }

  let result = WHITE
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const layer = parseCssColor(chain[index] ?? '')
    if (layer && layer.a > 0) result = composite(layer, result)
  }

  return cssColor(result)
}
