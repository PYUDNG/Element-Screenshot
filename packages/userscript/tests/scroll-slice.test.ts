import { afterEach, describe, expect, it, vi } from 'vitest'
import { native } from '../src/core/native'
import {
  blobToDataUrl,
  collectFixedDescendants,
  collectScrollSlices,
  collectSliceSticky,
  hasDirectText,
  hideSliceContent,
  isScrollContainer,
  paddingBoxOf,
  pinSticky,
  restoreStyle,
  scrollportMetrics,
  sliceBackgroundStyle,
  sliceRootStyle,
  splitCssList
} from '../src/core/scroll-slice'

function rectOf(left: number, top: number, width: number, height: number): DOMRect {
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

function styleOf(values: Record<string, string>): CSSStyleDeclaration {
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

function setMetrics(
  element: Element,
  metrics: {
    clientWidth?: number
    clientHeight?: number
    scrollWidth?: number
    scrollHeight?: number
  }
): void {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(element, key, { configurable: true, value })
  }
}

const NOTHING = styleOf({})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('css layer lists', () => {
  it('splits layers without breaking functions or quoted commas', () => {
    expect(
      splitCssList('url("a,b.png"), linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6)), none')
    ).toEqual(['url("a,b.png")', 'linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))', 'none'])
    expect(splitCssList('')).toEqual([])
  })
})

describe('slice background', () => {
  const layer = { url: 'data:image/png;base64,AAA', width: 200, height: 100 }

  it('adds the picture as a first layer and keeps the original ones', () => {
    const computed = styleOf({
      backgroundImage: 'linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))',
      backgroundSize: 'cover',
      backgroundPosition: '50% 50%',
      backgroundRepeat: 'no-repeat',
      backgroundOrigin: 'padding-box',
      backgroundClip: 'border-box',
      backgroundAttachment: 'scroll',
      backgroundBlendMode: 'multiply'
    })

    const style = sliceBackgroundStyle(computed, layer)

    expect(style.backgroundImage).toBe(
      'url("data:image/png;base64,AAA"), linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))'
    )
    expect(style.backgroundSize).toBe('200px 100px, cover')
    expect(style.backgroundPosition).toBe('0% 0%, 50% 50%')
    expect(style.backgroundRepeat).toBe('no-repeat, no-repeat')
    expect(style.backgroundBlendMode).toBe('normal, multiply')
  })

  it('falls back to the picture alone when the layer lists do not line up', () => {
    const computed = styleOf({
      backgroundImage: 'url("a.png"), url("b.png")',
      backgroundSize: 'auto'
    })

    const style = sliceBackgroundStyle(computed, layer)

    expect(style.backgroundImage).toBe('url("data:image/png;base64,AAA")')
    expect(style.backgroundSize).toBe('200px 100px')
  })
})

describe('slice clone root', () => {
  it('shifts by the scroll offset plus the border width', () => {
    const style = sliceRootStyle({
      scrollTop: 120,
      scrollLeft: 5,
      clientWidth: 200,
      clientHeight: 100,
      borderTop: 1,
      borderRight: 1,
      borderBottom: 1,
      borderLeft: 2,
      paddingTop: 4,
      paddingRight: 6,
      paddingBottom: 8,
      paddingLeft: 10
    })

    expect(style).toMatchObject({
      boxSizing: 'border-box',
      width: '203px',
      height: '102px',
      top: '-121px',
      left: '-7px',
      borderWidth: '0',
      // border width is folded into the padding so the content box stays put
      padding: '5px 7px 9px 12px',
      position: 'relative',
      overflow: 'visible',
      background: 'transparent',
      transform: 'none'
    })
  })
})

describe('scrollport measurement', () => {
  it('reports metrics only for a scrolled container', () => {
    const panel = document.createElement('div')
    document.body.append(panel)
    setMetrics(panel, { clientWidth: 200, clientHeight: 100, scrollWidth: 200, scrollHeight: 900 })
    vi.spyOn(native, 'getComputedStyle').mockReturnValue(
      styleOf({
        borderTopWidth: '2px',
        borderRightWidth: '0px',
        borderBottomWidth: '2px',
        borderLeftWidth: '0px'
      })
    )

    expect(scrollportMetrics(panel)).toBeNull()

    panel.scrollTop = 30
    expect(scrollportMetrics(panel)).toEqual({
      scrollTop: 30,
      scrollLeft: 0,
      clientWidth: 200,
      clientHeight: 100,
      borderTop: 2,
      borderRight: 0,
      borderBottom: 2,
      borderLeft: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0
    })
  })

  it('measures the padding box of a bordered container', () => {
    const panel = document.createElement('div')
    document.body.append(panel)
    vi.spyOn(native, 'getBoundingClientRect').mockReturnValue(rectOf(100, 50, 400, 300))
    vi.spyOn(native, 'getComputedStyle').mockReturnValue(
      styleOf({
        borderTopWidth: '1px',
        borderRightWidth: '2px',
        borderBottomWidth: '3px',
        borderLeftWidth: '4px'
      })
    )

    expect(paddingBoxOf(panel)).toEqual({ left: 104, top: 51, width: 394, height: 296 })
  })

  it('detects overflow containers with overflowing content', () => {
    const panel = document.createElement('div')
    document.body.append(panel)
    setMetrics(panel, { clientWidth: 100, clientHeight: 50, scrollWidth: 100, scrollHeight: 200 })

    vi.spyOn(native, 'getComputedStyle').mockReturnValue(
      styleOf({ overflowX: 'visible', overflowY: 'auto' })
    )
    expect(isScrollContainer(panel)).toBe(true)

    vi.spyOn(native, 'getComputedStyle').mockReturnValue(
      styleOf({ overflowX: 'visible', overflowY: 'visible' })
    )
    expect(isScrollContainer(panel)).toBe(false)
  })
})

describe('slice target collection', () => {
  it('includes panels in the region and panels inside an included one', () => {
    const panelA = document.createElement('div')
    const nested = document.createElement('div')
    const panelB = document.createElement('div')
    const offscreen = document.createElement('div')
    const hidden = document.createElement('div')
    panelA.append(nested)
    offscreen.append(hidden)
    document.body.append(panelA, panelB, offscreen)

    const rects = new Map<Element, DOMRect>([
      [panelA, rectOf(10, 10, 200, 100)],
      [nested, rectOf(150, 30, 80, 40)],
      [panelB, rectOf(300, 10, 150, 80)],
      [offscreen, rectOf(900, 900, 100, 100)],
      [hidden, rectOf(920, 920, 40, 40)]
    ])
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation(
      (element) => rects.get(element) ?? rectOf(0, 0, 0, 0)
    )
    vi.spyOn(native, 'getComputedStyle').mockReturnValue(styleOf({ overflowY: 'auto' }))

    for (const element of [panelA, nested, panelB, offscreen, hidden]) {
      setMetrics(element, {
        clientWidth: 100,
        clientHeight: 50,
        scrollWidth: 100,
        scrollHeight: 400
      })
      element.scrollTop = 10
    }

    const slices = collectScrollSlices({ left: 0, top: 0, width: 100, height: 120 }, document)

    // Deepest first so a parent clone already contains its finished panels.
    expect(slices).toEqual([nested, panelA])
  })
})

describe('descendant classification', () => {
  it('finds viewport-anchored descendants', () => {
    const panel = document.createElement('div')
    const badge = document.createElement('div')
    panel.append(badge)
    document.body.append(panel)
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element) =>
      element === badge ? styleOf({ position: 'fixed' }) : styleOf({ position: 'static' })
    )

    expect(collectFixedDescendants(panel)).toEqual([badge])
  })

  it('collects sticky elements that stick to the panel itself', () => {
    const panel = document.createElement('div')
    const wrapper = document.createElement('div')
    const head = document.createElement('header')
    const clipped = document.createElement('header')
    panel.append(head, wrapper)
    wrapper.append(clipped)
    document.body.append(panel)

    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      element === panel ? rectOf(0, 0, 200, 100) : rectOf(0, 0, 200, 40)
    )
    vi.spyOn(native, 'getComputedStyle').mockImplementation((element) => {
      if (element === panel) return styleOf({ overflowY: 'auto' })
      if (element === wrapper) return styleOf({ overflowY: 'hidden' })
      if (element === head || element === clipped) return styleOf({ position: 'sticky' })
      return NOTHING
    })
    vi.spyOn(native, 'elementsFromPoint').mockReturnValue([head, clipped])

    expect(collectSliceSticky(panel)).toEqual([head])
  })
})

describe('content hiding', () => {
  it('hides the children the picture replaces and restores them', () => {
    const panel = document.createElement('div')
    const row = document.createElement('span')
    row.setAttribute('style', 'color: red')
    panel.append(row)
    document.body.append(panel)

    const restore = hideSliceContent(panel)

    expect(row.style.getPropertyValue('visibility')).toBe('hidden')
    expect(row.style.getPropertyPriority('visibility')).toBe('important')

    restore()
    expect(row.getAttribute('style')).toBe('color: red')
  })

  it('hides text that has no element wrapper without losing the frame colour', () => {
    const panel = document.createElement('div')
    panel.append(document.createTextNode('plain text'))
    document.body.append(panel)
    vi.spyOn(native, 'getComputedStyle').mockReturnValue(
      styleOf({
        'border-top-color': 'rgb(1, 2, 3)',
        'border-right-color': 'rgb(1, 2, 3)',
        'border-bottom-color': 'rgb(1, 2, 3)',
        'border-left-color': 'rgb(1, 2, 3)'
      })
    )

    expect(hasDirectText(panel)).toBe(true)
    const restore = hideSliceContent(panel)

    expect(panel.style.getPropertyValue('color')).toBe('transparent')
    expect(panel.style.getPropertyValue('border-top-color')).toBe('rgb(1, 2, 3)')

    restore()
    expect(panel.getAttribute('style')).toBeNull()
  })
})

describe('sticky pinning', () => {
  it('keeps a sticky element at its on-screen offset and restores it', () => {
    const head = document.createElement('header')
    document.body.append(head)
    vi.spyOn(native, 'getBoundingClientRect').mockImplementation((element) =>
      (element as HTMLElement).style.position === 'static'
        ? rectOf(0, 0, 200, 40)
        : rectOf(0, 40, 200, 40)
    )

    const snapshot = pinSticky(head)

    expect(head.style.getPropertyValue('position')).toBe('relative')
    expect(head.style.getPropertyValue('top')).toBe('40px')
    expect(head.style.getPropertyValue('left')).toBe('0px')

    restoreStyle(snapshot)
    expect(head.getAttribute('style')).toBeNull()
  })
})

describe('slice images', () => {
  it('turns a rendered slice into a data URL', async () => {
    await expect(blobToDataUrl(new Blob(['png'], { type: 'image/png' }))).resolves.toBe(
      'data:image/png;base64,cG5n'
    )
  })
})
