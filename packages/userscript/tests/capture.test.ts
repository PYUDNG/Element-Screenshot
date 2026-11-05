import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toBlobMock } = vi.hoisted(() => ({
  toBlobMock: vi.fn()
}))

vi.mock('html-to-image', () => ({
  toBlob: toBlobMock
}))

import { captureElement, collectScrollTargets, computeCaptureScale } from '../src/core/capture'
import { getTargetBox } from '../src/core/target'

function setMetrics(
  element: Element,
  metrics: {
    scrollWidth?: number
    scrollHeight?: number
    clientWidth?: number
    clientHeight?: number
  }
): void {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(element, key, { configurable: true, value })
  }
}

const originalGetComputedStyle = window.getComputedStyle

beforeEach(() => {
  toBlobMock.mockReset()
  toBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})

afterEach(() => {
  window.getComputedStyle = originalGetComputedStyle
  document.body.innerHTML = ''
})

describe('capture scale planning', () => {
  it('keeps the requested ratio for normal pages', () => {
    expect(computeCaptureScale(1000, 2000, 2)).toMatchObject({
      width: 1000,
      height: 2000,
      ratio: 2,
      limited: false
    })
  })

  it('downscales to the canvas dimension limit', () => {
    const plan = computeCaptureScale(10_000, 20_000, 2)
    expect(plan.ratio).toBeLessThan(1)
    expect(plan.limited).toBe(true)
    expect(plan.width * plan.ratio).toBeLessThanOrEqual(16_384)
    expect(plan.height * plan.ratio).toBeLessThanOrEqual(16_384)
  })

  it('downscales to the canvas area limit', () => {
    const plan = computeCaptureScale(16_000, 16_000, 1, 16_384, 64_000_000)
    expect(plan.ratio).toBeLessThan(1)
    expect(plan.width * plan.ratio * plan.height * plan.ratio).toBeLessThanOrEqual(64_000_000)
  })
})

describe('target box measurement', () => {
  it('uses the larger of layout rect and scroll size, including borders', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 12,
      top: 34,
      width: 200,
      height: 300,
      right: 212,
      bottom: 334,
      x: 12,
      y: 34,
      toJSON: () => ({})
    } as DOMRect)
    setMetrics(element, {
      scrollWidth: 400,
      scrollHeight: 800,
      clientWidth: 198,
      clientHeight: 298
    })
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      borderLeftWidth: '1px',
      borderRightWidth: '1px',
      borderTopWidth: '1px',
      borderBottomWidth: '1px'
    } as CSSStyleDeclaration)

    expect(getTargetBox(element)).toEqual({
      left: 12,
      top: 34,
      width: 402,
      height: 802
    })
  })
})

describe('scroll expansion planning', () => {
  it('collects scrollable descendants before mutating', () => {
    const root = document.createElement('div')
    const scrollable = document.createElement('div')
    const plain = document.createElement('div')
    root.append(scrollable, plain)
    document.body.appendChild(root)

    setMetrics(scrollable, {
      scrollWidth: 100,
      scrollHeight: 500,
      clientWidth: 100,
      clientHeight: 200
    })
    setMetrics(plain, {
      scrollWidth: 100,
      scrollHeight: 100,
      clientWidth: 100,
      clientHeight: 100
    })

    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element === scrollable) {
        return { overflowX: 'auto', overflowY: 'auto' } as CSSStyleDeclaration
      }
      return { overflowX: 'visible', overflowY: 'visible' } as CSSStyleDeclaration
    })

    const targets = collectScrollTargets(root)
    expect(targets).toContain(root)
    expect(targets).toContain(scrollable)
    expect(targets).not.toContain(plain)
  })

  it('expands the element while rendering and restores its styles afterwards', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 10,
      top: 20,
      width: 300,
      height: 400,
      right: 310,
      bottom: 420,
      x: 10,
      y: 20,
      toJSON: () => ({})
    } as DOMRect)
    setMetrics(element, {
      scrollWidth: 320,
      scrollHeight: 900,
      clientWidth: 300,
      clientHeight: 400
    })
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      overflowX: 'auto',
      overflowY: 'auto'
    } as CSSStyleDeclaration)

    let heightDuringRender = ''
    toBlobMock.mockImplementation((_node, options) => {
      heightDuringRender = element.style.height
      expect(options).toMatchObject({
        width: 320,
        height: 900,
        pixelRatio: 1,
        backgroundColor: '#ffffff',
        skipAutoScale: true,
        type: 'image/png'
      })
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })

    const result = await captureElement(element, {
      expandNested: true,
      backgroundColor: '#ffffff',
      pixelRatio: 1
    })

    expect(heightDuringRender).toBe('900px')
    expect(element.getAttribute('style')).toBeNull()
    expect(result).toMatchObject({
      width: 320,
      height: 900,
      scale: 1,
      limited: false,
      sourceWidth: 320,
      sourceHeight: 900
    })
    expect(result.blob.type).toBe('image/png')
  })

  it('passes a transparent background and filter through', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      overflowX: 'visible',
      overflowY: 'visible'
    } as CSSStyleDeclaration)
    const filter = vi.fn(() => true)

    await captureElement(element, { expandNested: false, pixelRatio: 2, filter })

    const options = toBlobMock.mock.calls[0]?.[1]
    expect(options.backgroundColor).toBeUndefined()
    expect(options.pixelRatio).toBe(2)
    expect(options.filter).toBe(filter)
  })
})
