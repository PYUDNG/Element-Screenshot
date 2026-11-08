import { afterEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import {
  applyScrollReplay,
  collectScrollReplay,
  EMPTY_SCROLL_REPLAY,
  regionSamplePoints
} from '../src/core/scroll-replay'

function rectOf(top: number, left = 0, width = 1000, height = 50): DOMRect {
  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  } as DOMRect
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('region sampling', () => {
  it('samples the centre and the four inset corners', () => {
    const points = regionSamplePoints({ left: 100, top: 50, width: 200, height: 100 })
    expect(points).toHaveLength(5)
    expect(points[0]).toEqual({ x: 200, y: 100 })
    expect(points[1]).toEqual({ x: 108, y: 58 })
    expect(points[4]).toEqual({ x: 292, y: 142 })
  })
})

describe('scroll replay collection', () => {
  it('sums the scroll offsets of the clipped ancestors around the region', () => {
    const target = document.createElement('div')
    const inner = document.createElement('div')
    const outer = document.createElement('div')
    outer.append(inner)
    inner.append(target)
    document.body.append(outer)
    inner.scrollTop = 120
    inner.scrollLeft = 5
    outer.scrollTop = 40

    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([target])

    const replay = collectScrollReplay({ left: 10, top: 10, width: 100, height: 100 })

    expect(replay.ancestors.map((item) => item.element)).toEqual([inner, outer])
    expect(replay.offset).toEqual({ x: 5, y: 160 })
    expect(replay.sticky).toEqual([])
  })

  it('reports no replay for an unscrolled page', () => {
    const target = document.createElement('div')
    document.body.append(target)
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([target])

    const replay = collectScrollReplay({ left: 0, top: 0, width: 200, height: 200 })
    expect(replay.ancestors).toEqual([])
    expect(replay.offset).toEqual({ x: 0, y: 0 })
  })

  it('prefers the chain with the most scroll to replay', () => {
    const quiet = document.createElement('div')
    const busy = document.createElement('div')
    const target = document.createElement('div')
    busy.append(target)
    document.body.append(quiet, busy)
    busy.scrollTop = 500

    vi.spyOn(native, 'elementsFromPoint').mockImplementation((_root, _x, _y) => [quiet, target])

    const replay = collectScrollReplay({ left: 0, top: 0, width: 100, height: 100 })
    expect(replay.ancestors.map((item) => item.element)).toEqual([busy])
    expect(replay.offset.y).toBe(500)
  })

  it('collects sticky elements that overlap the region only', () => {
    const sticky = document.createElement('header')
    const outside = document.createElement('aside')
    document.body.append(sticky, outside)

    vi.spyOn(native, 'elementsFromPoint').mockImplementation((_root, _x, _y) => [sticky, outside])
    vi.spyOn(native, 'getComputedStyle').mockImplementation(
      (element) =>
        ({
          position: element === sticky || element === outside ? 'sticky' : 'static'
        }) as CSSStyleDeclaration
    )
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === sticky ? rectOf(10) : rectOf(500)
    )

    const replay = collectScrollReplay({ left: 0, top: 0, width: 400, height: 200 })
    expect(replay.sticky).toEqual([sticky])
  })
})

describe('scroll replay application', () => {
  it('stops the ancestors from clipping and restores both style and scroll', () => {
    const outer = document.createElement('div')
    outer.setAttribute('style', 'overflow:auto')
    document.body.append(outer)
    outer.scrollTop = 80

    const restore = applyScrollReplay({
      ancestors: [{ element: outer, scrollTop: 80, scrollLeft: 0 }],
      sticky: [],
      offset: { x: 0, y: 80 }
    })

    expect(outer.style.getPropertyValue('overflow')).toBe('visible')
    expect(outer.style.getPropertyPriority('overflow')).toBe('important')
    outer.scrollTop = 0
    restore()
    expect(outer.getAttribute('style')).toBe('overflow:auto')
    expect(outer.scrollTop).toBe(80)
  })

  it('pins a sticky element at its on-screen offset and restores it', () => {
    const sticky = document.createElement('header')
    document.body.append(sticky)
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      (element as HTMLElement).style.position === 'static'
        ? rectOf(100, 20, 300, 40)
        : rectOf(140, 20, 300, 40)
    )

    const restore = applyScrollReplay({
      ancestors: [],
      sticky: [sticky],
      offset: { x: 0, y: 0 }
    })

    expect(sticky.style.position).toBe('relative')
    expect(sticky.style.getPropertyValue('top')).toBe('40px')
    expect(sticky.style.getPropertyValue('left')).toBe('0px')
    restore()
    expect(sticky.getAttribute('style')).toBeNull()
  })

  it('grows a scrolled ancestor so its background still covers the slice', () => {
    const outer = document.createElement('div')
    outer.setAttribute('style', 'overflow:auto')
    document.body.append(outer)
    Object.defineProperty(outer, 'scrollHeight', { configurable: true, value: 640 })
    outer.scrollTop = 120
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue(rectOf(100, 0, 400, 300))

    const restore = applyScrollReplay({
      ancestors: [{ element: outer, scrollTop: 120, scrollLeft: 0 }],
      sticky: [],
      offset: { x: 0, y: 120 }
    })

    expect(outer.style.getPropertyValue('height')).toBe('640px')
    expect(outer.style.getPropertyPriority('height')).toBe('important')
    restore()
    expect(outer.getAttribute('style')).toBe('overflow:auto')
  })

  it('keeps the crop aligned when growing the box would move it', () => {
    const centered = document.createElement('div')
    centered.setAttribute('style', 'overflow:auto')
    document.body.append(centered)
    Object.defineProperty(centered, 'scrollHeight', { configurable: true, value: 640 })
    centered.scrollTop = 120
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation(() =>
      centered.style.getPropertyValue('height') ? rectOf(40, 0, 400, 300) : rectOf(100, 0, 400, 300)
    )

    const restore = applyScrollReplay({
      ancestors: [{ element: centered, scrollTop: 120, scrollLeft: 0 }],
      sticky: [],
      offset: { x: 0, y: 120 }
    })

    expect(centered.style.getPropertyValue('height')).toBe('')
    restore()
    expect(centered.getAttribute('style')).toBe('overflow:auto')
  })

  it('is a no-op without collected state', () => {
    const restore = applyScrollReplay(EMPTY_SCROLL_REPLAY)
    expect(() => restore()).not.toThrow()
  })
})
