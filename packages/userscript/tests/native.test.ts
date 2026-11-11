import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeSnapshot } from '../src/core/native'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('native API snapshot', () => {
  it('keeps using the original computed-style implementation', () => {
    const native = createNativeSnapshot(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      throw new Error('hooked')
    })

    const element = document.createElement('div')
    document.body.appendChild(element)
    expect(native.getComputedStyle(element)).toBeTruthy()
  })

  it('keeps cloning and querying after prototype hooks', () => {
    const native = createNativeSnapshot(window)
    const parent = document.createElement('div')
    parent.innerHTML = '<span class="child">text</span>'

    vi.spyOn(Node.prototype, 'cloneNode').mockImplementation(() => {
      throw new Error('hooked cloneNode')
    })
    vi.spyOn(Element.prototype, 'querySelector').mockImplementation(() => {
      throw new Error('hooked querySelector')
    })

    const clone = native.cloneNode(parent, true)
    expect(clone.querySelectorAll('.child')).toHaveLength(1)
    expect(native.querySelector(parent, '.child')?.textContent).toBe('text')
  })

  it('keeps document creation on the captured methods', () => {
    const native = createNativeSnapshot(window)
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      throw new Error('hooked createElement')
    })

    const element = native.document.createElement('div')
    expect(element.tagName).toBe('DIV')
  })

  it('moves the font source to another document and back', () => {
    const native = createNativeSnapshot(window)
    const frame = document.implementation.createHTMLDocument('frame')
    const base = frame.createElement('base')
    base.href = 'https://example.com/frame/'
    frame.head.append(base)

    // A frame rendered from this realm has to be read from its own stylesheets.
    expect(native.fontSource.document).toBe(document)
    native.setFontSource(frame)
    expect(native.fontSource.document).toBe(frame)
    expect(native.fontSource.styleSheets).toBe(frame.styleSheets)
    expect(native.fontSource.styleSheets).not.toBe(document.styleSheets)
    expect(native.fontSource.baseURL).toBe('https://example.com/frame/')

    native.setFontSource(document)
    expect(native.fontSource.document).toBe(document)
    expect(native.fontSource.baseURL).toBe(document.baseURI)
  })

  it('has no font base URL for a document that cannot resolve one', () => {
    const native = createNativeSnapshot(window)
    native.setFontSource(document.implementation.createHTMLDocument('blank'))
    expect(native.fontSource.baseURL).toBeNull()
  })

  it('keeps reading stylesheets through the captured getter', () => {
    const native = createNativeSnapshot(window)
    vi.spyOn(Document.prototype, 'styleSheets', 'get').mockImplementation(() => {
      throw new Error('hooked styleSheets')
    })

    expect(native.fontSource.styleSheets).toBe(native.document.styleSheets)
  })

  it('strips HTML-only attribute names before SVG serialization', () => {
    const native = createNativeSnapshot(window)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const button = document.createElement('button')
    button.setAttribute('$bgcolor', '#1da1f2')
    button.setAttribute('data-testid', 'tweet')
    svg.appendChild(button)

    expect(native.sanitizeSvgAttributes(svg)).toBe(1)
    expect(button.hasAttribute('$bgcolor')).toBe(false)
    expect(button.getAttribute('data-testid')).toBe('tweet')
  })

  it('removes attributes that are not valid QNames', () => {
    const native = createNativeSnapshot(window)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const div = document.createElement('div')
    div.setAttribute('wiz:wakeup:extra', 'true')
    div.setAttribute(':wakeup', 'true')
    div.setAttribute('wiz:wakeup', 'true')
    svg.appendChild(div)

    expect(native.sanitizeSvgAttributes(svg)).toBe(2)
    expect(div.hasAttribute('wiz:wakeup:extra')).toBe(false)
    expect(div.hasAttribute(':wakeup')).toBe(false)
    expect(div.getAttribute('wiz:wakeup')).toBe('true')
  })

  it('binds undeclared namespace prefixes on the SVG root', () => {
    const native = createNativeSnapshot(window)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const div = document.createElement('div')
    div.setAttribute('wiz:wakeup', 'true')
    div.setAttribute('xlink:href', '#icon')
    svg.appendChild(div)

    expect(native.sanitizeSvgNamespaces(svg)).toBe(2)
    expect(svg.getAttribute('xmlns:wiz')).toBe('urn:element-screenshot:unbound:wiz')
    expect(svg.getAttribute('xmlns:xlink')).toBe('http://www.w3.org/1999/xlink')
    expect(native.sanitizeSvgNamespaces(svg)).toBe(0)
  })

  it('keeps a prefix that the root already declares', () => {
    const native = createNativeSnapshot(window)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('xmlns:wiz', 'https://example.com/wiz')
    const div = document.createElement('div')
    div.setAttribute('wiz:wakeup', 'true')
    svg.appendChild(div)

    expect(native.sanitizeSvgNamespaces(svg)).toBe(0)
    expect(svg.getAttribute('xmlns:wiz')).toBe('https://example.com/wiz')
  })
})

describe('cooperative yielding', () => {
  it('exposes a clock that keeps counting', async () => {
    const native = createNativeSnapshot(window)
    const first = native.now()
    expect(typeof first).toBe('number')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(native.now()).toBeGreaterThanOrEqual(first)
  })

  it('prefers scheduler.yield', async () => {
    const yieldMock = vi.fn(() => Promise.resolve())
    vi.stubGlobal('scheduler', { yield: yieldMock })
    await createNativeSnapshot(window).yieldToMain()
    expect(yieldMock).toHaveBeenCalledTimes(1)
  })

  it('continues after a scheduler.yield rejection', async () => {
    const yieldMock = vi.fn(() => Promise.reject(new Error('nope')))
    vi.stubGlobal('scheduler', { yield: yieldMock })
    await expect(createNativeSnapshot(window).yieldToMain()).resolves.toBeUndefined()
    expect(yieldMock).toHaveBeenCalled()
  })

  it('falls back to a message channel task when scheduler.yield throws', async () => {
    vi.stubGlobal('scheduler', {
      yield: () => {
        throw new Error('not allowed')
      }
    })
    await expect(createNativeSnapshot(window).yieldToMain()).resolves.toBeUndefined()
  })

  it('uses a message channel task without scheduler.yield', async () => {
    vi.stubGlobal('scheduler', undefined)
    await expect(createNativeSnapshot(window).yieldToMain()).resolves.toBeUndefined()
  })

  it('falls back to a timer without MessageChannel or scheduler', async () => {
    vi.stubGlobal('scheduler', undefined)
    vi.stubGlobal('MessageChannel', undefined)
    await expect(createNativeSnapshot(window).yieldToMain()).resolves.toBeUndefined()
  })

  it('resolves when the message channel cannot be created', async () => {
    vi.stubGlobal('scheduler', undefined)
    vi.stubGlobal(
      'MessageChannel',
      class {
        constructor() {
          throw new Error('blocked by policy')
        }
      }
    )
    await expect(createNativeSnapshot(window).yieldToMain()).resolves.toBeUndefined()
  })
})
