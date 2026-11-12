import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FramePickItem } from '../src/core/frame-bridge'
import { native } from '../src/core/native'
import { elementTarget, frameTargets, liftFrameItems } from '../src/core/pick-target'

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

function mockRect(left: number, top: number, width: number, height: number): void {
  vi.spyOn(native, 'getBoundingClientRect').mockReturnValue(rectOf(left, top, width, height))
}

function item(overrides: Partial<FramePickItem> = {}): FramePickItem {
  return {
    id: 1,
    label: 'div.card',
    left: 20,
    top: 10,
    width: 400,
    height: 190,
    contentWidth: 400,
    contentHeight: 900,
    scrollAxis: 'y',
    fullPage: false,
    ...overrides
  }
}

/** A frame whose content box starts at (105, 55) inside the parent. */
function fakeFrame(): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.style.borderStyle = 'solid'
  frame.style.borderWidth = '5px'
  frame.style.padding = '0'
  Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 300 })
  Object.defineProperty(frame, 'clientHeight', { configurable: true, value: 200 })
  // The native snapshot captured `getBoundingClientRect` at module load, so the
  // frame's own box has to be stubbed at the snapshot.
  mockRect(100, 50, 310, 210)
  document.body.append(frame)
  return frame
}

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('pick targets', () => {
  it('describes a layer of this document', () => {
    const element = document.createElement('div')
    element.id = 'card'
    document.body.append(element)

    const target = elementTarget(element)

    expect(target.element).toBe(element)
    expect(target.frame).toBeNull()
    expect(target.frameElementId).toBeNull()
    expect(target.label).toBe('div#card')
    expect(target.fullPage).toBe(false)
  })

  it('marks the document root as a full page target', () => {
    const target = elementTarget(document.documentElement)
    expect(target.fullPage).toBe(true)
  })

  it('shifts frame layers into the parent viewport and clips the visible box', () => {
    const frame = fakeFrame()
    const targets = frameTargets(frame, [item()])

    expect(targets).toHaveLength(1)
    const target = targets[0]
    expect(target?.frame).toBe(frame)
    expect(target?.element).toBeNull()
    expect(target?.frameElementId).toBe(1)
    expect(target?.label).toBe('div.card')
    // The visible box is clipped to the frame viewport: 300 × 200 at (105, 55).
    expect(target?.rect).toEqual({ left: 125, top: 65, width: 280, height: 190 })
    // The capture box grows to the element's own content, so it is not clipped.
    expect(target?.box).toEqual({ left: 125, top: 65, width: 400, height: 900 })
    expect(target?.scrollAxis).toBe('y')
  })

  it('keeps the layer order and the reported ids', () => {
    const frame = fakeFrame()
    const targets = frameTargets(frame, [item({ id: 7 }), item({ id: 9, left: 0, top: 0 })])

    expect(targets.map((target) => target.frameElementId)).toEqual([7, 9])
  })

  it('drops the layers of a frame without a viewport', () => {
    const frame = fakeFrame()
    Object.defineProperty(frame, 'clientWidth', { configurable: true, value: 0 })
    expect(frameTargets(frame, [item()])).toEqual([])
  })

  it('never reports a negative visible box', () => {
    const frame = fakeFrame()
    const [target] = frameTargets(frame, [item({ left: 5000, top: 5000 })])
    expect(target?.rect).toEqual({ left: 405, top: 255, width: 0, height: 0 })
  })

  it('keeps the path a frame reported for a deeper layer', () => {
    const frame = fakeFrame()
    const [target] = frameTargets(frame, [item({ via: [4, 9] })])
    expect(target?.path).toEqual([4, 9])
  })

  it('gives a layer of the frame itself an empty path', () => {
    const frame = fakeFrame()
    const [target] = frameTargets(frame, [item()])
    expect(target?.path).toEqual([])
  })

  it('prepends the hop a nested answer came through', () => {
    const items = liftFrameItems({ left: 100, top: 50, width: 300, height: 200 }, [item()], 3)

    expect(items[0]).toMatchObject({ left: 120, top: 60, via: [3] })
  })

  it('keeps the hops a nested frame already reported', () => {
    const items = liftFrameItems({ left: 0, top: 0, width: 600, height: 400 }, [item({ via: [8] })], 3)

    expect(items[0]).toMatchObject({ via: [3, 8] })
  })
})
