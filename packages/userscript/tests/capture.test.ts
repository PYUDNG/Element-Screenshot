import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CropModule from '../src/core/crop'

const { toBlobMock, cropBlobMock, fontEmbedMock, probeMock, frameImageMock, frameSizeMock } =
  vi.hoisted(() => ({
    toBlobMock: vi.fn(),
    cropBlobMock: vi.fn(),
    fontEmbedMock: vi.fn(async () => '/* page fonts */'),
    probeMock: vi.fn(async (_frames: readonly HTMLIFrameElement[]) => new Set<HTMLIFrameElement>()),
    frameImageMock: vi.fn(
      async (
        _frame: HTMLIFrameElement,
        _request: { ratio: number; depth: number; maxDepth?: number; timeout?: number }
      ) => null as Blob | null
    ),
    frameSizeMock: vi.fn(async (_frame: HTMLIFrameElement) => null as { width: number; height: number } | null)
  }))

vi.mock('html-to-image', () => ({
  toBlob: toBlobMock,
  getFontEmbedCSS: fontEmbedMock
}))

vi.mock('../src/core/frame-bridge', () => ({
  FRAME_RESULT_TIMEOUT: 10_000,
  probeFrameHelpers: probeMock,
  requestFrameImage: frameImageMock,
  requestFrameSize: frameSizeMock
}))

vi.mock('../src/core/crop', async (importOriginal) => {
  const actual = await importOriginal<typeof CropModule>()
  return { ...actual, cropBlob: cropBlobMock }
})

/**
 * The pipeline itself is what these tests cover, so the snapshot is stubbed with
 * the live document; `snapshot.test.ts` covers the real copy.
 */
vi.mock('../src/core/snapshot', () => ({
  createSnapshot: vi.fn(async (options: { target?: Element | null } = {}) => ({
    doc: document,
    win: window,
    target: options.target ?? null,
    frames: [],
    dispose: () => undefined
  }))
}))

import {
  cancelCapture,
  captureElement,
  captureRegion,
  collectScrollTargets,
  computeCaptureScale,
  describeCaptureError,
  handleImageError,
  inlineSvgPaintVariables,
  pureTranslation,
  renderFrameViewport,
  rootPlacementStyle,
  shouldCaptureNode
} from '../src/core/capture'
import { native } from '../src/core/native'
import { createSnapshot } from '../src/core/snapshot'
import type { FrameRecord } from '../src/core/snapshot'
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
  cropBlobMock.mockReset()
  cropBlobMock.mockResolvedValue(new Blob(['crop'], { type: 'image/png' }))
  probeMock.mockReset()
  probeMock.mockResolvedValue(new Set<HTMLIFrameElement>())
  fontEmbedMock.mockReset()
  fontEmbedMock.mockResolvedValue('/* page fonts */')
  frameImageMock.mockReset()
  frameImageMock.mockResolvedValue(null)
  frameSizeMock.mockReset()
  frameSizeMock.mockResolvedValue(null)
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

describe('SVG paint variables', () => {
  it('inlines var() paint attributes and restores the live page', () => {
    const wrapper = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('fill', 'var(--brand)')
    svg.appendChild(path)
    wrapper.appendChild(svg)
    document.body.appendChild(wrapper)

    const style = {
      getPropertyValue: (name: string) => (name === 'fill' ? 'rgb(86, 134, 254)' : '')
    } as CSSStyleDeclaration
    vi.spyOn(native, 'getComputedStyle').mockReturnValue(style)

    const restore = inlineSvgPaintVariables(wrapper)
    expect(path.getAttribute('fill')).toBe('rgb(86, 134, 254)')
    restore()
    expect(path.getAttribute('fill')).toBe('var(--brand)')
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
    expect(warn).toHaveBeenCalledWith('[element-screenshot] image skipped:', image.src)
  })

  it('describes an image with no source', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const image = document.createElement('img')
    const event = new Event('error')
    Object.defineProperty(event, 'target', { value: image })

    handleImageError(event)
    expect(warn).toHaveBeenCalledWith('[element-screenshot] image skipped:', '(no source)')
  })

  it('accepts a string error from an image handler', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    handleImageError('broken resource')
    expect(warn).toHaveBeenCalledWith('[element-screenshot] image skipped:', 'broken resource')
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

describe('root placement', () => {
  it('reads a translation out of a 2d matrix', () => {
    expect(pureTranslation('matrix(1, 0, 0, 1, 276, 32)')).toEqual({ x: 276, y: 32 })
    expect(pureTranslation('none')).toBeNull()
    expect(pureTranslation('')).toBeNull()
    expect(pureTranslation(undefined)).toBeNull()
    expect(pureTranslation('not-a-matrix')).toBeNull()
    expect(pureTranslation('matrix(1, 0, 0)')).toBeNull()
  })

  it('reads a translation out of a 3d matrix', () => {
    expect(pureTranslation('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 34, 0, 1)')).toEqual({
      x: 12,
      y: 34
    })
  })

  it('refuses matrices that also scale, rotate or move in z', () => {
    expect(pureTranslation('matrix(2, 0, 0, 2, 10, 10)')).toBeNull()
    expect(pureTranslation('matrix(0.707107, 0.707107, -0.707107, 0.707107, 4, 4)')).toBeNull()
    expect(pureTranslation('matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1)')).toBeNull()
  })

  it('does not rewrite a transform that has no offset', () => {
    const style = rootPlacementStyle({
      position: 'static',
      transform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)'
    } as CSSStyleDeclaration)

    expect(style.transform).toBeUndefined()
  })

  it('moves a fixed, translated clone root back to the crop origin', () => {
    const style = rootPlacementStyle({
      position: 'fixed',
      transform: 'matrix(1, 0, 0, 1, 276, 32)'
    } as CSSStyleDeclaration)

    expect(style).toEqual({
      margin: '0',
      position: 'relative',
      inset: 'auto',
      transform: 'none'
    })
  })

  it('leaves a static element without placement overrides', () => {
    expect(
      rootPlacementStyle({ position: 'static', transform: 'none' } as CSSStyleDeclaration)
    ).toEqual({ margin: '0' })
    expect(rootPlacementStyle(null)).toEqual({ margin: '0' })
  })

  it('keeps a scaling transform so the crop still matches the visible box', () => {
    const style = rootPlacementStyle({
      position: 'absolute',
      transform: 'matrix(0.5, 0, 0, 0.5, 0, 0)'
    } as CSSStyleDeclaration)

    expect(style.transform).toBeUndefined()
    expect(style.position).toBe('relative')
  })

  it('passes the placement overrides to html-to-image', async () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 276,
      top: 32,
      width: 880,
      height: 630,
      right: 1156,
      bottom: 662,
      x: 276,
      y: 32,
      toJSON: () => ({})
    } as DOMRect)
    setMetrics(element, {
      scrollWidth: 880,
      scrollHeight: 630,
      clientWidth: 880,
      clientHeight: 630
    })
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      display: 'flex',
      position: 'static',
      transform: 'matrix(1, 0, 0, 1, 276, 32)',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      overflowX: 'visible',
      overflowY: 'visible'
    } as CSSStyleDeclaration)

    await captureElement(element, { expandNested: false, pixelRatio: 1 })

    const options = toBlobMock.mock.calls[0]?.[1]
    expect(options.style).toMatchObject({ margin: '0', transform: 'none' })
    expect(options.style.position).toBeUndefined()
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
      background: { mode: 'color', color: '#ffffff' },
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

  it('grows the canvas when expanding a descendant makes the copy taller', async () => {
    const root = document.createElement('div')
    const panel = document.createElement('div')
    root.appendChild(panel)
    document.body.appendChild(root)

    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 400,
      right: 300,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(native, 'getComputedStyle').mockImplementation(
      (element) =>
        ({
          borderLeftWidth: '0px',
          borderRightWidth: '0px',
          borderTopWidth: '0px',
          borderBottomWidth: '0px',
          overflowX: element === panel ? 'auto' : 'visible',
          overflowY: element === panel ? 'auto' : 'visible'
        }) as CSSStyleDeclaration
    )
    setMetrics(root, { scrollWidth: 300, scrollHeight: 400, clientWidth: 300, clientHeight: 400 })
    setMetrics(panel, {
      scrollWidth: 300,
      scrollHeight: 900,
      clientWidth: 300,
      clientHeight: 400
    })
    // A real browser grows the root when the panel below it is expanded; the
    // mock cannot lay out, so mirror that by reading the expanded overflow.
    Object.defineProperty(root, 'scrollHeight', {
      configurable: true,
      get: () => (root.style.overflow === 'visible' ? 900 : 400)
    })

    let captured: { width?: number; height?: number } = {}
    toBlobMock.mockImplementation((_node, options) => {
      captured = { width: options.width, height: options.height }
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })

    const result = await captureElement(root, {
      expandNested: true,
      background: { mode: 'color', color: '#ffffff' },
      pixelRatio: 1,
      box: { left: 0, top: 0, width: 300, height: 400 }
    })

    expect(captured).toEqual({ width: 300, height: 900 })
    expect(result).toMatchObject({ width: 300, height: 900, sourceWidth: 300, sourceHeight: 900 })
  })

  it('keeps the canvas at the measured box when nested expansion is off', async () => {
    const root = document.createElement('div')
    const panel = document.createElement('div')
    root.appendChild(panel)
    document.body.appendChild(root)

    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 400,
      right: 300,
      bottom: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(native, 'getComputedStyle').mockImplementation(
      (element) =>
        ({
          borderLeftWidth: '0px',
          borderRightWidth: '0px',
          borderTopWidth: '0px',
          borderBottomWidth: '0px',
          overflowX: element === panel ? 'auto' : 'visible',
          overflowY: element === panel ? 'auto' : 'visible'
        }) as CSSStyleDeclaration
    )
    setMetrics(root, { scrollWidth: 300, scrollHeight: 400, clientWidth: 300, clientHeight: 400 })
    setMetrics(panel, {
      scrollWidth: 300,
      scrollHeight: 900,
      clientWidth: 300,
      clientHeight: 400
    })

    let captured: { width?: number; height?: number } = {}
    let panelOverflow = ''
    toBlobMock.mockImplementation((_node, options) => {
      captured = { width: options.width, height: options.height }
      panelOverflow = panel.style.overflow
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })

    const result = await captureElement(root, {
      expandNested: false,
      background: { mode: 'color', color: '#ffffff' },
      pixelRatio: 1,
      box: { left: 0, top: 0, width: 300, height: 400 }
    })

    // The panel is a descendant, so only the root is expanded: the capture is
    // exactly the box the user saw, with the panel clipped inside it.
    expect(captured).toEqual({ width: 300, height: 400 })
    expect(panelOverflow).not.toBe('visible')
    expect(result).toMatchObject({ width: 300, height: 400 })
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

  it('expands an inline element so the line box does not clip glyphs', async () => {
    const element = document.createElement('b')
    document.body.appendChild(element)
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 12,
      right: 200,
      bottom: 12,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      display: 'inline',
      fontSize: '12px',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      overflowX: 'visible',
      overflowY: 'visible'
    } as CSSStyleDeclaration)

    await captureElement(element, { expandNested: false, pixelRatio: 1 })

    const options = toBlobMock.mock.calls[0]?.[1]
    expect(options.height).toBe(24)
    expect(options.style).toMatchObject({ margin: '0', display: 'block', lineHeight: '18px' })
  })

  it('removes margins and uses the block-level display for inline-flex roots', async () => {
    const element = document.createElement('button')
    document.body.appendChild(element)
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 52,
      height: 32,
      right: 152,
      bottom: 132,
      x: 100,
      y: 100,
      toJSON: () => ({})
    } as DOMRect)
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      display: 'inline-flex',
      marginTop: '8px',
      marginRight: '4px',
      marginBottom: '0px',
      marginLeft: '4px',
      fontSize: '14px',
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px',
      overflowX: 'visible',
      overflowY: 'visible'
    } as CSSStyleDeclaration)

    await captureElement(element, { expandNested: false, pixelRatio: 1 })

    const options = toBlobMock.mock.calls[0]?.[1]
    expect(options.width).toBe(52)
    expect(options.height).toBe(32)
    expect(options.style).toMatchObject({ margin: '0', display: 'flex' })
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

describe('capture box', () => {
  it('uses the box measured on the page instead of re-measuring the copy', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const result = await captureElement(element, {
      box: { left: 40, top: 24, width: 300, height: 200 },
      pixelRatio: 1
    })

    expect(result.width).toBe(300)
    expect(result.height).toBe(200)
    expect(result.sourceWidth).toBe(300)
    expect(toBlobMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ width: 300, height: 200 })
    )
  })

  it('logs when the copy measures a different box', async () => {
    const element = document.createElement('div')
    document.body.append(element)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    await captureElement(element, {
      box: { left: 0, top: 0, width: 300, height: 200 },
      pixelRatio: 1
    })

    expect(info).toHaveBeenCalledWith(
      '[element-screenshot] snapshot box differs from the page',
      expect.objectContaining({ page: { width: 300, height: 200 } })
    )
  })
})

describe('iframe compositing', () => {
  /** The mock's default implementation, restored after every case here. */
  const defaultSnapshot = vi.mocked(createSnapshot).getMockImplementation()

  function rectOf(width: number, height: number): DOMRect {
    return {
      left: 0,
      top: 0,
      width,
      height,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect
  }

  function addFrame(record: { live: HTMLIFrameElement; copy: HTMLIFrameElement }): void {
    document.body.append(record.live)
  }

  function frameRecord(copy: HTMLIFrameElement, doc: Document | null): FrameRecord {
    const live = document.createElement('iframe')
    return { live, copy, doc }
  }

  /** Answer the page snapshot with `frames`; a frame snapshot gets a private document. */
  function mockSnapshots(frames: FrameRecord[]): void {
    vi.mocked(createSnapshot).mockImplementation(async (options = {}) => {
      if (options.doc) {
        return {
          doc: document.implementation.createHTMLDocument('frame copy'),
          win: window,
          target: null,
          frames: [],
          dispose: () => undefined
        }
      }
      return {
        doc: document,
        win: window,
        target: options.target ?? null,
        frames,
        dispose: () => undefined
      }
    })
  }

  function observeCalls(failFirst = false): Array<{ target: Element; options: Record<string, unknown> }> {
    const calls: Array<{ target: Element; options: Record<string, unknown> }> = []
    let failing = failFirst
    toBlobMock.mockImplementation((target: Element, options: Record<string, unknown>) => {
      calls.push({ target, options })
      if (failing) {
        failing = false
        return Promise.reject(new Error('frame blew up'))
      }
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })
    return calls
  }

  afterEach(() => {
    if (defaultSnapshot) {
      vi.mocked(createSnapshot).mockImplementation(defaultSnapshot as never)
    }
  })

  it('renders the frame viewport and paints it into the copied box', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    const record = frameRecord(copy, document)
    addFrame(record)
    mockSnapshots([record])
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(120)
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? rectOf(300, 200) : rectOf(0, 0)
    )
    const calls = observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 400, height: 300 },
      pixelRatio: 2,
      background: { mode: 'transparent' }
    })

    expect(calls).toHaveLength(2)
    const [frameCall, pageCall] = calls
    // The frame is rendered on its own viewport-sized surface, shifted by the
    // frame's scroll offset (a clone never carries it).
    expect(frameCall?.options).toMatchObject({
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: 2,
      type: 'image/png'
    })
    expect(frameCall?.options.style).toMatchObject({
      position: 'relative',
      inset: 'auto',
      top: '-120px',
      left: '0px',
      margin: '0',
      transform: 'none'
    })
    // The page render carries the frame picture as the frame's first background
    // layer, sized to the content box so border, padding and radius stay right.
    expect(copy.style.getPropertyValue('background-image')).toContain('url("data:image/png')
    expect(copy.style.getPropertyValue('background-size').startsWith('100% 100%')).toBe(true)
    expect(copy.style.getPropertyValue('background-origin').startsWith('content-box')).toBe(true)
    expect(pageCall?.options.fontEmbedCSS).toBe('/* page fonts */')
    expect(frameCall?.options.fontEmbedCSS).toBe('/* page fonts */')
    // The page and the frame each resolve their own webfonts.
    expect(fontEmbedMock).toHaveBeenCalledTimes(2)
  })

  it('reads the fonts of the frame document, not of the page', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    // A frame with its own browsing context, so it has a document of its own to
    // resolve fonts from (the fixture above renders the page document itself).
    const live = document.createElement('iframe')
    document.body.append(live)
    const frameDoc = live.contentDocument
    expect(frameDoc).not.toBeNull()
    const record: FrameRecord = { live, copy, doc: frameDoc }
    mockSnapshots([record])
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? rectOf(300, 200) : rectOf(0, 0)
    )
    const sources: Document[] = []
    fontEmbedMock.mockImplementation(async () => {
      sources.push(native.fontSource.document)
      return '/* fonts */'
    })
    observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 400, height: 300 },
      pixelRatio: 2,
      background: { mode: 'transparent' }
    })

    // Page first, then the frame — each from its own document.
    expect(sources).toEqual([document, frameDoc])
    // The switch is undone, so the next capture starts from this realm again.
    expect(native.fontSource.document).toBe(document)
  })

  it('asks every frame helper at once instead of one after another', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const records = [0, 1].map(() => {
      const copy = document.createElement('iframe')
      root.append(copy)
      // Cross-origin: both pictures can only come from the helpers.
      return frameRecord(copy, null)
    })
    mockSnapshots(records)
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element.tagName === 'IFRAME' ? rectOf(120, 90) : rectOf(0, 0)
    )
    probeMock.mockResolvedValue(new Set(records.map((record) => record.live)))
    const started: HTMLIFrameElement[] = []
    const answer: Array<(blob: Blob) => void> = []
    frameImageMock.mockImplementation((frame: HTMLIFrameElement) => {
      started.push(frame)
      return new Promise<Blob>((resolve) => answer.push(resolve))
    })
    observeCalls()

    const pending = captureElement(root, {
      box: { left: 0, top: 0, width: 400, height: 300 },
      pixelRatio: 2
    })
    // Both requests are in flight before either frame answers.
    await vi.waitFor(() => expect(started).toHaveLength(2))
    expect(started).toEqual([records[0]?.live, records[1]?.live])
    for (const resolve of answer) resolve(new Blob(['helper'], { type: 'image/png' }))
    await pending

    for (const record of records) {
      expect(record.copy.style.getPropertyValue('background-image')).toContain('url("data:image/png')
    }
  })

  it('paints the picture the frame helper sends back', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    // Cross-origin: only a helper can produce these pixels.
    const record = frameRecord(copy, null)
    mockSnapshots([record])
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? rectOf(200, 100) : rectOf(0, 0)
    )
    probeMock.mockResolvedValue(new Set([record.live]))
    frameImageMock.mockResolvedValue(new Blob(['helper'], { type: 'image/png' }))
    const calls = observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 300, height: 200 },
      pixelRatio: 2
    })

    expect(probeMock).toHaveBeenCalledWith([record.live])
    expect(frameImageMock).toHaveBeenCalledWith(
      record.live,
      expect.objectContaining({ ratio: 2, depth: 1, maxDepth: 2 })
    )
    expect(copy.style.getPropertyValue('background-image')).toContain('url("data:image/png')
    // The frame picture came from the helper, so the page render is the only
    // local html-to-image call.
    expect(calls).toHaveLength(1)
  })

  it('renders locally when a probed helper stays silent', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    const record = frameRecord(copy, document)
    mockSnapshots([record])
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? rectOf(200, 100) : rectOf(0, 0)
    )
    probeMock.mockResolvedValue(new Set([record.live]))
    frameImageMock.mockResolvedValue(null)
    const calls = observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 300, height: 200 },
      pixelRatio: 1
    })

    expect(frameImageMock).toHaveBeenCalled()
    // Frame viewport render plus the page render.
    expect(calls).toHaveLength(2)
    expect(copy.style.getPropertyValue('background-image')).toContain('url("data:image/png')
  })

  it('probes only the frames inside the captured element', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const inside = document.createElement('iframe')
    const outside = document.createElement('iframe')
    root.append(inside)
    document.body.append(outside)
    const insideRecord = frameRecord(inside, document)
    const outsideRecord = frameRecord(outside, document)
    mockSnapshots([insideRecord, outsideRecord])
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === inside ? rectOf(200, 100) : rectOf(0, 0)
    )
    observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 300, height: 200 },
      pixelRatio: 1
    })

    expect(probeMock).toHaveBeenCalledWith([insideRecord.live])
  })

  it('leaves a frame outside the captured element alone', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    document.body.append(copy)
    mockSnapshots([frameRecord(copy, document)])
    const calls = observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 100, height: 100 },
      pixelRatio: 1
    })

    expect(calls).toHaveLength(1)
    expect(copy.style.getPropertyValue('background-image')).toBe('')
  })

  it('keeps a cross-origin frame as an empty box', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    mockSnapshots([frameRecord(copy, null)])
    const calls = observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 100, height: 100 },
      pixelRatio: 1
    })

    // No readable document and no helper instance yet: nothing to paint.
    expect(calls).toHaveLength(1)
    expect(copy.style.getPropertyValue('background-image')).toBe('')
  })

  it('skips a collapsed frame', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    mockSnapshots([frameRecord(copy, document)])
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue(rectOf(0, 0))
    const calls = observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 100, height: 100 },
      pixelRatio: 1
    })

    expect(calls).toHaveLength(1)
  })

  it('keeps the capture when one frame fails to render', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const broken = document.createElement('iframe')
    const healthy = document.createElement('iframe')
    root.append(broken, healthy)
    mockSnapshots([frameRecord(broken, document), frameRecord(healthy, document)])
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === broken || element === healthy ? rectOf(200, 100) : rectOf(0, 0)
    )
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const calls = observeCalls(true)

    const result = await captureElement(root, {
      box: { left: 0, top: 0, width: 300, height: 200 },
      pixelRatio: 1
    })

    expect(result.blob).toBeInstanceOf(Blob)
    expect(console.warn).toHaveBeenCalledWith(
      '[element-screenshot] frame render failed:',
      'frame blew up'
    )
    // The broken frame keeps its empty box, the healthy one still gets painted.
    expect(broken.style.getPropertyValue('background-image')).toBe('')
    expect(healthy.style.getPropertyValue('background-image')).toContain('url("data:image/png')
    expect(calls).toHaveLength(3)
  })

  /** A copy whose rect follows the size its inline style asks for, like a layout. */
  function followStyle(
    copy: HTMLIFrameElement,
    fallback: { width: number; height: number }
  ): DOMRect {
    const read = (property: string, value: number): number => {
      const parsed = Number.parseFloat(copy.style.getPropertyValue(property))
      return Number.isFinite(parsed) && parsed > 0 ? parsed : value
    }
    return rectOf(read('width', fallback.width), read('height', fallback.height))
  }

  it('expands a picked frame to its whole document', async () => {
    const copy = document.createElement('iframe')
    copy.style.border = '0'
    document.body.append(copy)
    const record = frameRecord(copy, document)
    mockSnapshots([record])
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(300)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(200)
    vi.spyOn(document.documentElement, 'scrollWidth', 'get').mockReturnValue(300)
    // The frame document scrolls far past its own viewport.
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(1_200)
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? followStyle(copy, { width: 300, height: 200 }) : rectOf(0, 0)
    )
    const calls = observeCalls()

    const result = await captureElement(copy, {
      pixelRatio: 2,
      background: { mode: 'transparent' }
    })

    // The copied box grew to the frame's content, so the page render and the
    // canvas cover the whole frame instead of the 200px viewport.
    const [frameCall, pageCall] = calls
    expect(frameCall?.options).toMatchObject({ width: 300, height: 1_200, pixelRatio: 2 })
    // An expanded frame is rendered from the top: no scroll shift, no pinning.
    expect(frameCall?.options.style).toMatchObject({ top: '0px', left: '0px' })
    expect(pageCall?.options).toMatchObject({ width: 300, height: 1_200, pixelRatio: 2 })
    expect(result).toMatchObject({ width: 600, height: 2_400, sourceHeight: 1_200 })
  })

  it('asks the helper how tall a cross-origin frame is before growing it', async () => {
    const copy = document.createElement('iframe')
    copy.style.border = '0'
    document.body.append(copy)
    const record = frameRecord(copy, null)
    mockSnapshots([record])
    setMetrics(record.live, { clientWidth: 200, clientHeight: 150 })
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? followStyle(copy, { width: 200, height: 150 }) : rectOf(0, 0)
    )
    probeMock.mockResolvedValue(new Set([record.live]))
    frameSizeMock.mockResolvedValue({ width: 640, height: 900 })
    frameImageMock.mockResolvedValue(new Blob(['helper'], { type: 'image/png' }))
    const calls = observeCalls()

    const result = await captureElement(copy, { pixelRatio: 2 })

    expect(frameSizeMock).toHaveBeenCalledWith(record.live)
    expect(probeMock).toHaveBeenCalledTimes(1)
    // The helper renders the expanded document on the surface the parent reserved.
    expect(frameImageMock).toHaveBeenCalledWith(
      record.live,
      expect.objectContaining({
        ratio: 2,
        depth: 1,
        maxDepth: 2,
        expand: { width: 640, height: 900 }
      })
    )
    // Only the page render is local.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.options).toMatchObject({ width: 640, height: 900 })
    expect(result).toMatchObject({ width: 1_280, height: 1_800 })
  })

  it('leaves a frame that fits its own viewport alone', async () => {
    const copy = document.createElement('iframe')
    copy.style.border = '0'
    document.body.append(copy)
    const record = frameRecord(copy, document)
    mockSnapshots([record])
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(300)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(200)
    vi.spyOn(document.documentElement, 'scrollWidth', 'get').mockReturnValue(300)
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(200)
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? followStyle(copy, { width: 300, height: 200 }) : rectOf(0, 0)
    )
    const calls = observeCalls()

    const result = await captureElement(copy, { pixelRatio: 1 })

    // Nothing to reveal: the viewport picture already is the whole frame, so the
    // box keeps its size and the frame renders at its current scroll.
    expect(calls).toHaveLength(2)
    expect(calls[0]?.options).toMatchObject({ width: 300, height: 200 })
    expect(calls[1]?.options).toMatchObject({ width: 300, height: 200 })
    expect(result).toMatchObject({ width: 300, height: 200 })
  })

  it('does not expand a frame nested inside the picked element', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    const record = frameRecord(copy, document)
    mockSnapshots([record])
    vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(9_000)
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? rectOf(200, 100) : rectOf(0, 0)
    )
    const calls = observeCalls()

    await captureElement(root, {
      box: { left: 0, top: 0, width: 300, height: 200 },
      pixelRatio: 1
    })

    // An ancestor capture keeps the frame's current viewport: growing a nested
    // frame would reflow the page the user is looking at.
    expect(calls[0]?.options).toMatchObject({
      width: window.innerWidth,
      height: window.innerHeight
    })
  })

  it('passes the configured frame depth to the helper with a deep budget', async () => {
    const root = document.createElement('section')
    document.body.append(root)
    const copy = document.createElement('iframe')
    root.append(copy)
    const record = frameRecord(copy, null)
    mockSnapshots([record])
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? rectOf(200, 100) : rectOf(0, 0)
    )
    probeMock.mockResolvedValue(new Set([record.live]))
    frameImageMock.mockResolvedValue(new Blob(['helper'], { type: 'image/png' }))

    await captureElement(root, {
      box: { left: 0, top: 0, width: 300, height: 200 },
      pixelRatio: 1,
      maxDepth: 4
    })

    // The helper renders the whole chain below the frame, so its wait grows by
    // one render budget per remaining level: 10s base + three more levels.
    expect(frameImageMock).toHaveBeenCalledWith(
      record.live,
      expect.objectContaining({ ratio: 1, depth: 1, maxDepth: 4, timeout: 25_000 })
    )
  })

  it('stops rendering frames below the configured depth', async () => {
    native.capture.aborted = false
    mockSnapshots([])
    const calls = observeCalls()

    // `depth` is the level of the frame this render would produce, counted from
    // the capture root: level 3 needs a limit of at least 3.
    await expect(renderFrameViewport(document, 1, { maxDepth: 2 }, 3)).resolves.toBeNull()
    expect(calls).toHaveLength(0)
    await expect(renderFrameViewport(document, 1, { maxDepth: 3 }, 3)).resolves.toBeInstanceOf(Blob)
    expect(calls).toHaveLength(1)
  })
})

describe('capture cancellation', () => {
  it('stops a render that was cancelled while it was starting', async () => {
    const element = document.createElement('div')
    document.body.append(element)

    // The user hits cancel while the snapshot is still being built.
    vi.mocked(createSnapshot).mockImplementationOnce(async (options = {}) => {
      cancelCapture()
      return {
        doc: document,
        win: window,
        target: options.target ?? null,
        frames: [],
        dispose: () => undefined
      }
    })

    await expect(captureElement(element, { pixelRatio: 1 })).rejects.toThrow(/cancelled/)
    expect(toBlobMock).not.toHaveBeenCalled()
  })

  it('clears the flag when the next capture starts', async () => {
    const element = document.createElement('div')
    document.body.append(element)

    cancelCapture()
    // `captureElement` resets the flag, so a second capture renders normally.
    const result = await captureElement(element, { pixelRatio: 1 })
    expect(result.blob).toBeInstanceOf(Blob)
    expect(toBlobMock).toHaveBeenCalled()
  })
})

describe('region capture', () => {
  it('renders the viewport, then crops the dragged rectangle', async () => {
    const rect = { left: 100, top: 60, width: 200, height: 120 }
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(40)
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(300)

    const result = await captureRegion(rect, {
      pixelRatio: 2,
      backgroundColor: '#ffffff'
    })

    const options = toBlobMock.mock.calls[0]?.[1]
    expect(options).toMatchObject({
      width: window.innerWidth,
      height: window.innerHeight,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      skipAutoScale: true,
      type: 'image/png'
    })
    expect(options.style).toMatchObject({
      position: 'relative',
      inset: 'auto',
      top: '-300px',
      left: '-40px',
      margin: '0',
      transform: 'none'
    })
    expect(cropBlobMock).toHaveBeenCalledWith(expect.anything(), {
      sx: 200,
      sy: 120,
      sw: 400,
      sh: 240,
      width: 400,
      height: 240
    })
    expect(result).toMatchObject({
      width: 400,
      height: 240,
      scale: 2,
      sourceWidth: 200,
      sourceHeight: 120,
      limited: false
    })
    expect(document.documentElement.getAttribute('style')).toBeNull()
  })

  it('clamps a rectangle to the viewport', async () => {
    const result = await captureRegion(
      { left: window.innerWidth - 24, top: window.innerHeight - 68, width: 200, height: 200 },
      { pixelRatio: 1 }
    )

    expect(cropBlobMock).toHaveBeenCalledWith(expect.anything(), {
      sx: window.innerWidth - 24,
      sy: window.innerHeight - 68,
      sw: 24,
      sh: 68,
      width: 24,
      height: 68
    })
    expect(result).toMatchObject({ width: 24, height: 68, sourceWidth: 24, sourceHeight: 68 })
  })

  it('rejects an empty render', async () => {
    toBlobMock.mockResolvedValue(null)
    await expect(
      captureRegion({ left: 0, top: 0, width: 100, height: 100 }, { pixelRatio: 1 })
    ).rejects.toThrow('html-to-image returned an empty blob')
    expect(cropBlobMock).not.toHaveBeenCalled()
  })
})

describe('region capture with frames', () => {
  const defaultSnapshot = vi.mocked(createSnapshot).getMockImplementation()

  function box(left: number, top: number, width: number, height: number): DOMRect {
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({})
    } as DOMRect
  }

  function withFrame(copyBox: DOMRect, doc: Document | null): HTMLIFrameElement {
    const copy = document.createElement('iframe')
    document.body.append(copy)
    const live = document.createElement('iframe')
    document.body.append(live)
    vi.mocked(createSnapshot).mockImplementation(async (options = {}) => {
      // A snapshot of the frame document must not report the frame again, or the
      // frame would render itself recursively.
      if (options.doc) {
        return {
          doc: document.implementation.createHTMLDocument('frame copy'),
          win: window,
          target: null,
          frames: [],
          dispose: () => undefined
        }
      }
      return {
        doc: document,
        win: window,
        target: options.target ?? null,
        frames: [{ live, copy, doc }],
        dispose: () => undefined
      }
    })
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? copyBox : box(0, 0, 0, 0)
    )
    return copy
  }

  function observe(): Array<Record<string, unknown>> {
    const calls: Array<Record<string, unknown>> = []
    toBlobMock.mockImplementation((_target: Element, options: Record<string, unknown>) => {
      calls.push(options)
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })
    return calls
  }

  afterEach(() => {
    if (defaultSnapshot) {
      vi.mocked(createSnapshot).mockImplementation(defaultSnapshot as never)
    }
  })

  it('paints a frame that intersects the rectangle', async () => {
    const copy = withFrame(box(120, 60, 200, 120), document)
    const calls = observe()

    const result = await captureRegion(
      { left: 100, top: 40, width: 260, height: 200 },
      { pixelRatio: 2, backgroundColor: '#ffffff' }
    )

    // Frame viewport render, then the page render.
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ width: window.innerWidth, height: window.innerHeight })
    expect(calls[1]).toMatchObject({ width: window.innerWidth, height: window.innerHeight })
    expect(copy.style.getPropertyValue('background-image')).toContain('url("data:image/png')
    // The frame resolves its own webfonts before the page resolves the shared one.
    expect(fontEmbedMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({ width: 520, height: 400 })
  })

  it('leaves a frame outside the rectangle alone', async () => {
    const copy = withFrame(box(600, 500, 200, 120), document)
    const calls = observe()

    await captureRegion({ left: 0, top: 0, width: 200, height: 150 }, { pixelRatio: 1 })

    expect(calls).toHaveLength(1)
    expect(copy.style.getPropertyValue('background-image')).toBe('')
    expect(probeMock).not.toHaveBeenCalled()
  })

  it('asks the helper when the frame is cross-origin', async () => {
    const copy = withFrame(box(10, 10, 200, 120), null)
    const calls = observe()
    probeMock.mockResolvedValue(new Set<HTMLIFrameElement>([document.querySelectorAll('iframe')[1] as HTMLIFrameElement]))
    frameImageMock.mockResolvedValue(new Blob(['helper'], { type: 'image/png' }))

    await captureRegion({ left: 0, top: 0, width: 400, height: 300 }, { pixelRatio: 1 })

    expect(frameImageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ratio: 1, depth: 1, maxDepth: 2 })
    )
    expect(calls).toHaveLength(1)
    expect(copy.style.getPropertyValue('background-image')).toContain('url("data:image/png')
  })

  it('paints a frame inside a replaced scroll container before that container is rendered', async () => {
    const panel = document.createElement('div')
    document.body.append(panel)
    setMetrics(panel, { clientWidth: 200, clientHeight: 100, scrollWidth: 200, scrollHeight: 900 })
    panel.scrollTop = 40
    const real = native.getComputedStyle
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element === panel ? scrollPanel('none') : real(element, pseudo)
    )

    const copy = document.createElement('iframe')
    panel.append(copy)
    const live = document.createElement('iframe')
    document.body.append(live)
    vi.mocked(createSnapshot).mockImplementation(async (options = {}) => {
      // A snapshot of the frame document must not report the frame again.
      if (options.doc) {
        return {
          doc: document.implementation.createHTMLDocument('frame copy'),
          win: window,
          target: null,
          frames: [],
          dispose: () => undefined
        }
      }
      return {
        doc: document,
        win: window,
        target: options.target ?? null,
        frames: [{ live, copy, doc: document }],
        dispose: () => undefined
      }
    })
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === copy ? box(20, 20, 120, 60) : box(0, 0, 0, 0)
    )

    const order: Array<{ level: string; frame: string; childVisibility: string }> = []
    toBlobMock.mockImplementation((target: Element) => {
      order.push({
        level: target === panel ? 'slice' : target === document.documentElement ? 'page' : 'frame',
        frame: copy.style.getPropertyValue('background-image'),
        childVisibility: copy.style.getPropertyValue('visibility')
      })
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })

    await captureRegion(
      { left: 0, top: 0, width: 300, height: 200 },
      { pixelRatio: 1, slices: [panel] }
    )

    // The frame has to be painted before the panel is turned into a picture:
    // the panel's slice is rendered with its children already hidden, so a frame
    // that is painted afterwards would sit on an invisible box and the picture
    // would show an empty rectangle instead.
    expect(order.map((call) => call.level)).toEqual(['frame', 'slice', 'page'])
    expect(order[1]?.frame).toContain('url("data:image/png')
    // The copy's own child is still hidden at page-render time; only the slice
    // carries the frame picture now.
    expect(order[2]?.childVisibility).toBe('hidden')
  })
})

interface ObservedCall {
  target: Element
  width?: number
  height?: number
  style?: Record<string, string>
  fontEmbedCSS?: string
  panelStyle: string | null
  childVisibility: string
}

function fakeStyle(values: Record<string, string>): CSSStyleDeclaration {
  const store = new Map<string, string>()
  for (const [key, value] of Object.entries(values)) {
    store.set(
      key.includes('-') ? key : key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`),
      value
    )
  }
  return {
    ...values,
    getPropertyValue: (name: string) => store.get(name) ?? ''
  } as unknown as CSSStyleDeclaration
}

function scrollPanel(style: string): CSSStyleDeclaration {
  return fakeStyle({
    overflowX: 'auto',
    overflowY: 'auto',
    position: 'static',
    visibility: 'visible',
    borderTopWidth: '1px',
    borderRightWidth: '1px',
    borderBottomWidth: '1px',
    borderLeftWidth: '1px',
    'border-top-color': 'rgb(17, 24, 39)',
    'border-right-color': 'rgb(17, 24, 39)',
    'border-bottom-color': 'rgb(17, 24, 39)',
    'border-left-color': 'rgb(17, 24, 39)',
    backgroundImage: style,
    backgroundSize: 'auto',
    backgroundPosition: '0% 0%',
    backgroundRepeat: 'repeat',
    backgroundOrigin: 'padding-box',
    backgroundClip: 'border-box',
    backgroundAttachment: 'scroll',
    backgroundBlendMode: 'normal'
  })
}

describe('region capture with scroll slices', () => {
  function makePanel(scrollTop: number, clientWidth = 200, clientHeight = 100): HTMLDivElement {
    const panel = document.createElement('div')
    const row = document.createElement('span')
    row.textContent = 'row'
    panel.append(row)
    document.body.append(panel)
    setMetrics(panel, {
      clientWidth,
      clientHeight,
      scrollWidth: clientWidth,
      scrollHeight: clientHeight + 800
    })
    panel.scrollTop = scrollTop
    return panel
  }

  it('renders each scrolled panel and paints it back over the panel', async () => {
    const panel = makePanel(120)
    const child = panel.firstElementChild as HTMLElement
    const real = native.getComputedStyle
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element === panel ? scrollPanel('none') : real(element, pseudo)
    )

    const observed: ObservedCall[] = []
    toBlobMock.mockImplementation((target: Element, options: Record<string, string>) => {
      observed.push({
        target,
        width: options.width as unknown as number,
        height: options.height as unknown as number,
        style: options.style as unknown as Record<string, string>,
        fontEmbedCSS: options.fontEmbedCSS as unknown as string | undefined,
        panelStyle: panel.getAttribute('style'),
        childVisibility: child.style.visibility
      })
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })

    const result = await captureRegion(
      { left: 0, top: 0, width: 400, height: 400 },
      { pixelRatio: 1, slices: [panel] }
    )

    expect(observed).toHaveLength(2)
    // The slice renders the panel itself on a scrollport-sized surface.
    expect(observed[0]?.target).toBe(panel)
    expect(observed[0]?.width).toBe(200)
    expect(observed[0]?.height).toBe(100)
    expect(observed[0]?.style).toMatchObject({
      boxSizing: 'border-box',
      width: '202px',
      height: '102px',
      top: '-121px',
      left: '-1px',
      overflow: 'visible',
      background: 'transparent'
    })
    expect(observed[0]?.panelStyle).toBeNull()
    expect(observed[0]?.childVisibility).toBe('')

    // The viewport render sees the picture as the panel background.
    expect(observed[1]?.target).toBe(document.documentElement)
    expect(observed[1]?.panelStyle).toContain('background-image: url("data:image/png;base64,')
    expect(observed[1]?.panelStyle).toContain('background-size: 200px 100px')
    expect(observed[1]?.childVisibility).toBe('hidden')
    // The fonts are resolved once and reused by every render of the capture.
    expect(fontEmbedMock).toHaveBeenCalledTimes(1)
    expect(observed[0]?.fontEmbedCSS).toBe('/* page fonts */')
    expect(observed[1]?.fontEmbedCSS).toBe('/* page fonts */')

    // Everything is restored afterwards.
    expect(panel.getAttribute('style')).toBeNull()
    expect(child.style.visibility).toBe('')
    expect(panel.scrollTop).toBe(120)
    expect(result).toMatchObject({
      width: 400,
      height: 400,
      scale: 1,
      sourceWidth: 400,
      sourceHeight: 400
    })
  })

  it('gives every independent panel its own scroll offset', async () => {
    const first = makePanel(120)
    const second = makePanel(40)
    const real = native.getComputedStyle
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (element === first || element === second) return scrollPanel('none')
      return real(element, pseudo)
    })

    const tops: string[] = []
    toBlobMock.mockImplementation((target: Element, options: Record<string, unknown>) => {
      const style = options.style as Record<string, string> | undefined
      if (target !== document.documentElement && style?.top) tops.push(style.top)
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })

    await captureRegion(
      { left: 0, top: 0, width: 400, height: 400 },
      { pixelRatio: 1, slices: [first, second] }
    )

    expect(tops).toEqual(['-121px', '-41px'])
  })

  it('keeps a fixed descendant out of the slice and shows it in the page render', async () => {
    const panel = makePanel(60)
    const badge = document.createElement('div')
    panel.append(badge)
    const real = native.getComputedStyle
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (element === panel) return scrollPanel('none')
      if (element === badge) return fakeStyle({ position: 'fixed', visibility: 'visible' })
      return real(element, pseudo)
    })

    const badgeStates: string[] = []
    toBlobMock.mockImplementation(() => {
      badgeStates.push(badge.style.visibility)
      return Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    })

    await captureRegion(
      { left: 0, top: 0, width: 400, height: 400 },
      { pixelRatio: 1, slices: [panel] }
    )

    expect(badgeStates).toEqual(['hidden', 'visible'])
    expect(badge.getAttribute('style')).toBeNull()
  })

  it('restores the panel and rejects when a slice render fails', async () => {
    const panel = makePanel(120)
    const child = panel.firstElementChild as HTMLElement
    const real = native.getComputedStyle
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element, pseudo) =>
      element === panel ? scrollPanel('none') : real(element, pseudo)
    )
    toBlobMock.mockRejectedValueOnce(new Error('slice failed'))

    await expect(
      captureRegion({ left: 0, top: 0, width: 200, height: 100 }, { pixelRatio: 1, slices: [panel] })
    ).rejects.toThrow('slice failed')

    expect(toBlobMock).toHaveBeenCalledTimes(1)
    expect(panel.getAttribute('style')).toBeNull()
    expect(child.style.visibility).toBe('')
    expect(panel.scrollTop).toBe(120)
  })
})

