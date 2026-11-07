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
      borderBottomWidth: '0px'
    } as CSSStyleDeclaration)
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 })

    const info = describeTarget(element)
    expect(info.box).toEqual({ left: 0, top: 0, width: 100, height: 300 })
    expect(info.scrollable).toBe(true)
    expect(info.label).toBe('div')
  })

  it('uses the document scroll size for the root element', () => {
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

    expect(getTargetBox(document.documentElement)).toEqual({
      left: 0,
      top: 0,
      width: 1280,
      height: 5000
    })
  })
})
