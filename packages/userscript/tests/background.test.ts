import { afterEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import { parseCssColor, resolveBackdropColor, resolvePageBackground } from '../src/core/background'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

function mockBackgrounds(colors: Map<Element, string>): void {
  vi.spyOn(native, 'getComputedStyle').mockImplementation(
    (element) =>
      ({ backgroundColor: colors.get(element) ?? 'rgba(0, 0, 0, 0)' }) as CSSStyleDeclaration
  )
}

describe('CSS color parsing', () => {
  it('parses rgb, rgba, hex and color(srgb)', () => {
    expect(parseCssColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseCssColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 })
    expect(parseCssColor('rgb(10 20 30 / 25%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 })
    expect(parseCssColor('#0a141e')).toEqual({ r: 10, g: 20, b: 30, a: 1 })
    expect(parseCssColor('#0a141e80')?.a).toBeCloseTo(0.5, 2)
    expect(parseCssColor('color(srgb 1 0 0 / 0.5)')).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0.5
    })
    expect(parseCssColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })
})

describe('page background resolution', () => {
  it('uses the nearest opaque ancestor color instead of a fixed white canvas', () => {
    const html = document.documentElement
    const body = document.body
    const panel = document.createElement('div')
    const card = document.createElement('div')
    body.appendChild(panel)
    panel.appendChild(card)

    mockBackgrounds(
      new Map([
        [html, 'rgb(9, 9, 11)'],
        [body, 'rgba(0, 0, 0, 0)'],
        [panel, 'rgb(24, 24, 27)'],
        [card, 'rgba(0, 0, 0, 0)']
      ])
    )

    expect(resolveBackdropColor(card)).toBe('rgb(24, 24, 27)')
  })

  it('composites semi-transparent ancestor layers over white', () => {
    const html = document.documentElement
    const body = document.body
    const panel = document.createElement('div')
    const card = document.createElement('button')
    body.appendChild(panel)
    panel.appendChild(card)

    mockBackgrounds(
      new Map([
        [html, 'rgb(255, 255, 255)'],
        [body, 'rgba(0, 0, 0, 0)'],
        [panel, 'rgba(0, 0, 0, 0.5)'],
        [card, 'rgba(0, 0, 0, 0)']
      ])
    )

    expect(resolveBackdropColor(card)).toBe('rgb(128, 128, 128)')
  })

  it('pierces an open shadow root to reach the page backdrop', () => {
    const html = document.documentElement
    const body = document.body
    const host = document.createElement('div')
    body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    shadow.appendChild(inner)

    mockBackgrounds(
      new Map([
        [html, 'rgb(3, 7, 18)'],
        [body, 'rgba(0, 0, 0, 0)'],
        [host, 'rgba(0, 0, 0, 0)']
      ])
    )

    expect(resolveBackdropColor(inner)).toBe('rgb(3, 7, 18)')
  })

  it('includes fixed background layers and masks that are not ancestors', () => {
    const html = document.documentElement
    const body = document.body
    const panel = document.createElement('div')
    const card = document.createElement('b')
    body.appendChild(panel)
    panel.appendChild(card)
    const mask = document.createElement('div')

    mockBackgrounds(
      new Map([
        [html, 'rgb(255, 255, 255)'],
        [body, 'rgba(0, 0, 0, 0)'],
        [panel, 'rgba(0, 0, 0, 0)'],
        [mask, 'rgba(0, 0, 0, 0.5)']
      ])
    )
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([card, panel, body, mask, html])

    expect(resolveBackdropColor(card)).toBe('rgb(128, 128, 128)')
  })

  it('keeps the body backdrop when elementsFromPoint omits its zero-height box', () => {
    const html = document.documentElement
    const body = document.body
    const panel = document.createElement('div')
    const card = document.createElement('div')
    body.appendChild(panel)
    panel.appendChild(card)

    mockBackgrounds(
      new Map([
        [html, 'rgba(0, 0, 0, 0)'],
        [body, 'rgb(21, 21, 23)'],
        [panel, 'rgba(0, 0, 0, 0)'],
        [card, 'rgba(0, 0, 0, 0)']
      ])
    )
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([card, panel, html])

    expect(resolveBackdropColor(card)).toBe('rgb(21, 21, 23)')
  })

  it('does not composite body or html twice when they are in the paint stack', () => {
    const html = document.documentElement
    const body = document.body
    const card = document.createElement('div')
    body.appendChild(card)

    mockBackgrounds(
      new Map([
        [html, 'rgb(255, 255, 255)'],
        [body, 'rgba(0, 0, 0, 0.5)'],
        [card, 'rgba(0, 0, 0, 0)']
      ])
    )
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([card, body, html])

    expect(resolveBackdropColor(card)).toBe('rgb(128, 128, 128)')
  })

  it('samples the average color of a readable background image', () => {
    const html = document.documentElement
    const body = document.body
    const card = document.createElement('b')
    const image = document.createElement('img')
    body.append(image, card)

    mockBackgrounds(
      new Map([
        [html, 'rgb(255, 255, 255)'],
        [body, 'rgba(0, 0, 0, 0)']
      ])
    )
    Object.defineProperty(image, 'complete', { value: true })
    Object.defineProperty(image, 'naturalWidth', { value: 32 })
    Object.defineProperty(image, 'naturalHeight', { value: 32 })
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([card, image, body, html])
    vi.spyOn(native.canvas, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
    vi.spyOn(native.canvas, 'drawImage').mockImplementation(() => {})
    const pixels = new Uint8ClampedArray(8 * 8 * 4)
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 32
      pixels[index + 1] = 32
      pixels[index + 2] = 32
      pixels[index + 3] = 255
    }
    vi.spyOn(native.canvas, 'getImageData').mockReturnValue({ data: pixels } as ImageData)

    expect(resolveBackdropColor(card)).toBe('rgb(32, 32, 32)')
  })

  it('reports the page canvas color for region captures', () => {
    mockBackgrounds(
      new Map([
        [document.documentElement, 'rgb(9, 9, 11)'],
        [document.body, 'rgba(0, 0, 0, 0)']
      ])
    )

    expect(resolvePageBackground()).toBe('rgb(9, 9, 11)')
  })

  it('uses the canvas color behind the document root', () => {
    const html = document.documentElement
    const body = document.body

    mockBackgrounds(
      new Map([
        [html, 'rgba(0, 0, 0, 0)'],
        [body, 'rgb(23, 25, 26)']
      ])
    )
    // Nothing is painted below the root, so there is no layer stack to read;
    // the body colour is the canvas, and a clone of <html> has no canvas to
    // propagate it to, which is why html-to-image used to fill white instead.
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([])

    expect(resolveBackdropColor(html)).toBe('rgb(23, 25, 26)')
    expect(resolveBackdropColor(body)).toBe('rgb(23, 25, 26)')
  })

  it('still walks ancestors when the paint stack has nothing below an element', () => {
    const html = document.documentElement
    const body = document.body
    const panel = document.createElement('div')
    const card = document.createElement('div')
    body.appendChild(panel)
    panel.appendChild(card)

    mockBackgrounds(
      new Map([
        [html, 'rgba(0, 0, 0, 0)'],
        [body, 'rgb(23, 25, 26)'],
        [panel, 'rgb(60, 60, 70)'],
        [card, 'rgba(0, 0, 0, 0)']
      ])
    )
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([card])

    expect(resolveBackdropColor(card)).toBe('rgb(60, 60, 70)')
  })
})
