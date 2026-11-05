import { afterEach, describe, expect, it, vi } from 'vitest'
import { createNativeSnapshot } from '../src/core/native'

afterEach(() => {
  vi.restoreAllMocks()
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
})
