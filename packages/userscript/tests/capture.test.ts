import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as CropModule from '../src/core/crop'

const { toBlobMock, cropBlobMock, fontEmbedMock } = vi.hoisted(() => ({
  toBlobMock: vi.fn(),
  cropBlobMock: vi.fn(),
  fontEmbedMock: vi.fn(async () => '/* page fonts */')
}))

vi.mock('html-to-image', () => ({
  toBlob: toBlobMock,
  getFontEmbedCSS: fontEmbedMock
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
  rootPlacementStyle,
  shouldCaptureNode
} from '../src/core/capture'
import { native } from '../src/core/native'
import { createSnapshot } from '../src/core/snapshot'
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

describe('capture cancellation', () => {
  it('stops a render that was cancelled while it was starting', async () => {
    const element = document.createElement('div')
    document.body.append(element)

    // The user hits cancel while the snapshot is still being built.
    vi.mocked(createSnapshot).mockImplementationOnce(async (options = {}) => {
      cancelCapture()
      return { doc: document, win: window, target: options.target ?? null, dispose: () => undefined }
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
