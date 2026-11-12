import { afterEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import {
  describeTarget,
  elementLabel,
  getElementStack,
  getTargetBox,
  resolveCandidate
} from '../src/core/target'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('element stack', () => {
  it('returns topmost elements and filters the script UI', () => {
    const ui = document.createElement('div')
    ui.setAttribute('data-element-screenshot-root', '')
    const target = document.createElement('div')
    const body = document.body
    document.body.append(target)

    const elementsFromPoint = vi.fn(() => [ui, target, body])
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: elementsFromPoint
    })

    const stack = getElementStack(10, 10)
    expect(stack).toEqual([target, body])
    expect(elementsFromPoint).toHaveBeenCalledWith(10, 10)
  })

  it('pierces open shadow roots', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadow = host.attachShadow({ mode: 'open' })
    const inner = document.createElement('span')
    shadow.appendChild(inner)

    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [host, document.body])
    })
    Object.defineProperty(shadow, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [inner])
    })

    const stack = getElementStack(5, 5)
    expect(stack[0]).toBe(inner)
    expect(stack).toContain(host)
  })
})

describe('target helpers', () => {
  it('resolves candidates with clamping', () => {
    const a = document.createElement('a')
    const b = document.createElement('p')
    expect(resolveCandidate([a, b], 0)).toBe(a)
    expect(resolveCandidate([a, b], 5)).toBe(b)
    expect(resolveCandidate([a, b], -2)).toBe(a)
    expect(resolveCandidate([], 0)).toBeNull()
  })

  it('labels elements with tag, id and classes', () => {
    const element = document.createElement('div')
    element.id = 'app'
    element.className = 'card wide extra'
    expect(elementLabel(element)).toBe('div#app.card.wide')
  })

  it('describes full scroll dimensions', () => {
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
      overflowY: 'auto'
    } as CSSStyleDeclaration)
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 })

    const info = describeTarget(element)
    expect(info.rect).toEqual({ left: 0, top: 0, width: 100, height: 100 })
    expect(info.box).toEqual({ left: 0, top: 0, width: 100, height: 300 })
    expect(info.scrollAxis).toBe('y')
    expect(info.scrollable).toBe(true)
    expect(info.label).toBe('div')
  })

  it('does not call a clipped box scrollable', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      overflowX: 'visible',
      overflowY: 'visible'
    } as CSSStyleDeclaration)
    // An icon button whose inline content is a pixel taller than its box: the
    // old `scrollHeight > clientHeight + 1` rule flagged this as scrollable.
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 31 })
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 30 })

    const info = describeTarget(element)
    expect(info.scrollAxis).toBeNull()
    expect(info.scrollable).toBe(false)
  })

  it('ignores overflow hidden, which gives the user no way to scroll', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      overflowX: 'hidden',
      overflowY: 'hidden'
    } as CSSStyleDeclaration)
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 900 })
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 })

    expect(describeTarget(element).scrollAxis).toBeNull()
  })

  it('reports the axis that actually scrolls', () => {
    const element = document.createElement('div')
    document.body.appendChild(element)
    const style = vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      overflowX: 'auto',
      overflowY: 'auto'
    } as CSSStyleDeclaration)
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: 2400 })
    Object.defineProperty(element, 'clientWidth', { configurable: true, value: 600 })
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 })

    expect(describeTarget(element).scrollAxis).toBe('x')

    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 900 })
    expect(describeTarget(element).scrollAxis).toBe('both')

    // A scrollport that is not actually overflowing stays quiet.
    Object.defineProperty(element, 'scrollWidth', { configurable: true, value: 600 })
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 300 })
    style.mockReturnValue({ overflowX: 'auto', overflowY: 'auto' } as CSSStyleDeclaration)
    expect(describeTarget(element).scrollAxis).toBeNull()
  })

  it('treats the viewport as the visible box of the root element', () => {
    const info = describeTarget(document.documentElement)
    expect(info.rect).toEqual({
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight
    })
  })

  it('uses the viewport width and the document height for the root element', () => {
    Object.defineProperty(document.documentElement, 'scrollWidth', {
      configurable: true,
      value: 1280
    })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 5000
    })
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1200
    })
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 800
    })

    // Horizontal overflow is not part of the page as it is laid out in the
    // viewport: a wider canvas reflows the copy and strands viewport-fixed
    // layers at the left edge, so only the height grows.
    expect(getTargetBox(document.documentElement)).toEqual({
      left: 0,
      top: 0,
      width: 1200,
      height: 5000
    })
  })

  /** An iframe whose document can be measured but has no layout of its own. */
  function frameWithContent(width: number, height: number): HTMLIFrameElement {
    const frame = document.createElement('iframe')
    frame.style.border = '0'
    const doc = document.implementation.createHTMLDocument('frame content')
    Object.defineProperty(doc.documentElement, 'scrollWidth', { configurable: true, value: width })
    Object.defineProperty(doc.documentElement, 'scrollHeight', {
      configurable: true,
      value: height
    })
    Object.defineProperty(frame, 'contentDocument', { configurable: true, value: doc })
    vi.spyOn(native, 'getComputedStyle').mockReturnValue({
      borderLeftWidth: '0px',
      borderRightWidth: '0px',
      borderTopWidth: '0px',
      borderBottomWidth: '0px'
    } as CSSStyleDeclaration)
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 200,
      right: 300,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({})
    } as DOMRect)
    document.body.append(frame)
    return frame
  }

  it('grows a frame box to the content of its own document', () => {
    // A frame scrolls one level down, so its own box never reports the size the
    // capture will have once the frame is expanded.
    const frame = frameWithContent(420, 900)
    expect(getTargetBox(frame)).toEqual({ left: 0, top: 0, width: 420, height: 900 })
  })

  it('keeps the box of a frame it cannot read', () => {
    const frame = frameWithContent(420, 900)
    Object.defineProperty(frame, 'contentDocument', { configurable: true, value: null })
    expect(getTargetBox(frame)).toEqual({ left: 0, top: 0, width: 300, height: 200 })
  })
})
