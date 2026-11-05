import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { toBlobMock } = vi.hoisted(() => ({
  toBlobMock: vi.fn()
}))

vi.mock('html-to-image', () => ({
  toBlob: toBlobMock
}))

import {
  captureElement,
  collectScrollTargets,
  computeCaptureScale,
  describeCaptureError,
  handleImageError,
  shouldCaptureNode
} from '../src/core/capture'
import { native } from '../src/core/native'
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

beforeEach(() => {
  toBlobMock.mockReset()
  toBlobMock.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('capture filtering', () => {
  it('keeps rendered elements and skips scripts and noscript blocks', () => {
    const div = document.createElement('div')
    const script = document.createElement('script')
    const noscript = document.createElement('noscript')
    const svgScript = document.createElementNS('http://www.w3.org/2000/svg', 'script')

    expect(shouldCaptureNode(div)).toBe(true)
    expect(shouldCaptureNode(script)).toBe(false)
    expect(shouldCaptureNode(noscript)).toBe(false)
    expect(shouldCaptureNode(svgScript as unknown as HTMLElement)).toBe(false)
  })
})

describe('capture error messages', () => {
  it('reports an inline SVG image error with its data URL size', () => {
    const image = document.createElement('img')
    image.src = 'data:image/svg+xml;charset=utf-8,%3Csvg%3E'
    const event = new Event('error')
    image.dispatchEvent(event)

    const message = describeCaptureError(event)
    expect(message).toContain('Inline SVG image failed to load')
    expect(message).toContain('data URL')
  })

  it('falls back to the error message or event type', () => {
    expect(describeCaptureError(new Error('boom'))).toBe('boom')
    expect(describeCaptureError(new Event('error'))).toBe('Browser event error: error')
    expect(describeCaptureError('plain failure')).toBe('plain failure')
  })
})

describe('image failure tolerance', () => {
  it('absorbs a failed image instead of rejecting the capture', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const image = document.createElement('img')
    image.src = 'https://example.com/broken.png'
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: image })

    expect(() => handleImageError(event)).not.toThrow()
    expect(warn).toHaveBeenCalledWith('[element-shot] image skipped:', image.src)
  })

  it('describes an image with no source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const image = document.createElement('img')
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: image })

    handleImageError(event)
    expect(warn).toHaveBeenCalledWith('[element-shot] image skipped:', '(no source)')
  })

  it('accepts a string error from an image handler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handleImageError('broken resource')
    expect(warn).toHaveBeenCalledWith('[element-shot] image skipped:', 'broken resource')
  })
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
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
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
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
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

    vi.spyOn(native, 'getComputedStyle').mockImplementation((element) => {
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
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
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
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
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
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
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
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
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
    expect(options.imagePlaceholder).toMatch(/^data:image\/png;base64,/)
    expect(options.onImageErrorHandler).toBe(handleImageError)
  })

  it('does not wait forever when requestAnimationFrame is paused', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 120,
      height: 80,
      right: 120,
      bottom: 80,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      overflowX: 'visible',
      overflowY: 'visible'
    } as CSSStyleDeclaration)
    vi.spyOn(native, 'requestAnimationFrame').mockReturnValue(1)
    vi.spyOn(native, 'setTimeout').mockImplementation((handler) => {
      if (typeof handler === 'function') handler()
      return 1
    })
    vi.spyOn(native, 'clearTimeout').mockImplementation(() => {})

    await captureElement(element, { expandNested: false, pixelRatio: 1 })
    expect(toBlobMock).toHaveBeenCalled()
  })
})
