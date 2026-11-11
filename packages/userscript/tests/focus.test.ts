import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFrameFocus, takeFocusFromFrame } from '../src/ui/focus'

function frameElement(): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  document.body.append(frame)
  return frame
}

/** Pretend `element` owns the focus without relying on the jsdom focus model. */
function pretendFocused(element: Element | null): void {
  Object.defineProperty(document, 'activeElement', {
    configurable: true,
    get: () => element
  })
}

afterEach(() => {
  delete (document as { activeElement?: unknown }).activeElement
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('focus taken by a frame', () => {
  it('recognises an iframe as the focused element', () => {
    pretendFocused(frameElement())
    expect(isFrameFocus()).toBe(true)

    pretendFocused(document.body)
    expect(isFrameFocus()).toBe(false)

    pretendFocused(null)
    expect(isFrameFocus()).toBe(false)
  })

  it('blurs a focused frame so the top document gets the keys again', () => {
    const frame = frameElement()
    pretendFocused(frame)
    const blur = vi.spyOn(frame, 'blur').mockImplementation(() => {
      pretendFocused(document.body)
    })

    expect(takeFocusFromFrame()).toBe(true)
    expect(blur).toHaveBeenCalledTimes(1)
    expect(isFrameFocus()).toBe(false)
  })

  it('leaves the page alone when the focus is already here', () => {
    pretendFocused(document.body)
    const frame = frameElement()
    const blur = vi.spyOn(frame, 'blur')

    expect(takeFocusFromFrame()).toBe(false)
    expect(blur).not.toHaveBeenCalled()
  })

  it('reports a blur that did not move the focus', () => {
    const frame = frameElement()
    pretendFocused(frame)
    vi.spyOn(frame, 'blur').mockImplementation(() => undefined)

    expect(takeFocusFromFrame()).toBe(false)
  })

  it('survives a frame that refuses to blur', () => {
    const frame = frameElement()
    pretendFocused(frame)
    vi.spyOn(frame, 'blur').mockImplementation(() => {
      throw new Error('nope')
    })

    expect(takeFocusFromFrame()).toBe(false)
  })
})
