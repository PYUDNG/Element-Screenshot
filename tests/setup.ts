import { vi } from 'vitest'

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
}

if (!('scrollTo' in Element.prototype)) {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    writable: true,
    value: vi.fn()
  })
}

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
    setTimeout(
      () => callback(performance.now()),
      16
    ) as unknown as number) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((handle: number) =>
    clearTimeout(handle)) as typeof cancelAnimationFrame
}
