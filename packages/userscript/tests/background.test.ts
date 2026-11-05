import { afterEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import { parseCssColor, resolveBackdropColor } from '../src/core/background'

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
})
