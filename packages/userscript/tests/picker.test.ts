import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PickTarget } from '../src/core/pick-target'
import { ElementPicker } from '../src/core/picker'
import type { ElementPickerOptions } from '../src/core/picker'

const hoisted = vi.hoisted(() => ({
  /** Topmost first, like `getElementStack`. */
  stack: [] as Element[],
  scrolls: new Set<Element>()
}))

function layer(element: Element): PickTarget {
  return {
    element,
    frame: null,
    frameElementId: null,
    path: [],
    label: element.tagName.toLowerCase(),
    rect: { left: 0, top: 0, width: 10, height: 10 },
    box: { left: 0, top: 0, width: 10, height: 10 },
    scrollAxis: hoisted.scrolls.has(element) ? 'y' : null,
    fullPage: element === document.documentElement
  }
}

function createPicker(overrides: Partial<ElementPickerOptions> = {}): ElementPicker {
  return new ElementPicker({
    onHover: vi.fn(),
    onSelect: vi.fn(),
    onCancel: vi.fn(),
    // The picker wants outermost first; the fixtures are topmost first.
    resolve: () => hoisted.stack.map(layer).reverse(),
    resolveDocument: () => layer(document.documentElement),
    ...overrides
  })
}

interface Hover {
  element: Element | null
  index: number
  total: number
}

/** What the picker last reported, in a shape that reads well in assertions. */
function lastHover(onHover: ReturnType<typeof vi.fn>): Hover {
  const call = onHover.mock.calls.at(-1) ?? []
  const target = (call[0] ?? null) as PickTarget | null
  return { element: target?.element ?? null, index: Number(call[1]), total: Number(call[2]) }
}

afterEach(() => {
  hoisted.stack = []
  hoisted.scrolls = new Set()
  document.body.innerHTML = ''
})

describe('element picker', () => {
  it('emits hover state and cycles through layers', () => {
    const inner = document.createElement('div')
    const outer = document.createElement('section')
    hoisted.stack = [inner, outer]

    const onHover = vi.fn()
    const picker = createPicker({ onHover })

    picker.start()
    expect(lastHover(onHover)).toEqual({ element: inner, index: 1, total: 2 })
    picker.cycle(1)
    expect(lastHover(onHover)).toEqual({ element: inner, index: 1, total: 2 })
    picker.cycle(-1)
    expect(lastHover(onHover)).toEqual({ element: outer, index: 0, total: 2 })
    picker.stop()
  })

  it('selects the current element on click', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onSelect = vi.fn()
    const picker = createPicker({ onSelect })

    picker.start()
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ element: inner }))
    expect(picker.isActive).toBe(false)
  })

  it('selects the document on Ctrl+A and cancels on Escape', () => {
    const element = document.createElement('div')
    hoisted.stack = [element]
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    const picker = createPicker({ onSelect, onCancel })

    picker.start()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ element: document.documentElement })
    )
    expect(picker.isActive).toBe(false)

    const second = createPicker({ onSelect, onCancel })
    second.start()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalled()
    expect(second.isActive).toBe(false)
  })

  it('cycles with the wheel', () => {
    const inner = document.createElement('div')
    const outer = document.createElement('section')
    hoisted.stack = [inner, outer]
    const onHover = vi.fn()
    const picker = createPicker({ onHover })

    picker.start()
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
    expect(lastHover(onHover)).toEqual({ element: inner, index: 1, total: 2 })
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))
    expect(lastHover(onHover)).toEqual({ element: outer, index: 0, total: 2 })
    picker.stop()
  })

  it('jumps between scroll containers with Shift', () => {
    // getElementStack returns topmost first: icon < card < scroller < wrapper < body
    const icon = document.createElement('i')
    const card = document.createElement('div')
    const scroller = document.createElement('div')
    const wrapper = document.createElement('div')
    const body = document.body
    hoisted.stack = [icon, card, scroller, wrapper, body]
    hoisted.scrolls = new Set([scroller])

    const onHover = vi.fn()
    const picker = createPicker({ onHover })
    picker.start()
    expect(lastHover(onHover)).toEqual({ element: icon, index: 4, total: 5 })

    picker.cycleScroll(-1)
    expect(lastHover(onHover)).toEqual({ element: scroller, index: 2, total: 5 })

    // No further scroll container above it, so the layer stays put.
    picker.cycleScroll(-1)
    expect(lastHover(onHover)).toEqual({ element: scroller, index: 2, total: 5 })

    picker.cycleScroll(1)
    expect(lastHover(onHover)).toEqual({ element: scroller, index: 2, total: 5 })
    picker.stop()
  })

  it('jumps between scroll containers with Shift+wheel', () => {
    const icon = document.createElement('i')
    const scroller = document.createElement('div')
    const body = document.body
    hoisted.stack = [icon, scroller, body]
    hoisted.scrolls = new Set([scroller])

    const onHover = vi.fn()
    const picker = createPicker({ onHover })
    picker.start()
    expect(lastHover(onHover)).toEqual({ element: icon, index: 2, total: 3 })

    // Shift moves the deltas onto the horizontal axis on some platforms.
    window.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 120, shiftKey: true, cancelable: true })
    )
    expect(lastHover(onHover)).toEqual({ element: icon, index: 2, total: 3 })

    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, cancelable: true }))
    expect(lastHover(onHover)).toEqual({ element: scroller, index: 1, total: 3 })
    picker.stop()
  })

  it('waits for a slow layer and drops the answer a newer move replaced', async () => {
    const outer = document.createElement('section')
    const inner = document.createElement('div')
    hoisted.stack = [inner, outer]

    const pending: Array<(stack: PickTarget[]) => void> = []
    const onHover = vi.fn()
    const picker = createPicker({
      onHover,
      // A frame answers over the bridge, so the picker may get a promise.
      resolve: () => new Promise<PickTarget[]>((resolve) => pending.push(resolve))
    })

    picker.start()
    expect(onHover).not.toHaveBeenCalled()

    // A second move starts a new question before the first one is answered.
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 40, clientY: 40 })
    )
    await vi.waitFor(() => expect(pending).toHaveLength(2))

    pending[0]?.([layer(inner)])
    expect(onHover).not.toHaveBeenCalled()

    pending[1]?.([layer(outer), layer(inner)])
    await vi.waitFor(() => expect(onHover).toHaveBeenCalledTimes(1))
    expect(lastHover(onHover)).toEqual({ element: inner, index: 1, total: 2 })
    picker.stop()
  })

  it('turns a drag into a capture region instead of a click', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onSelect = vi.fn()
    const onRegionStart = vi.fn()
    const onRegionChange = vi.fn()
    const onRegionEnd = vi.fn()

    const picker = createPicker({ onSelect, onRegionStart, onRegionChange, onRegionEnd })

    picker.start()
    window.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 20, clientY: 30 })
    )
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 80, clientY: 90 })
    )

    expect(onRegionStart).toHaveBeenCalledTimes(1)
    expect(onRegionChange).toHaveBeenLastCalledWith({ left: 20, top: 30, width: 60, height: 60 })

    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 80, clientY: 90 })
    )

    expect(onRegionEnd).toHaveBeenCalledWith({ left: 20, top: 30, width: 60, height: 60 })
    expect(onSelect).not.toHaveBeenCalled()
    expect(picker.isActive).toBe(false)
  })

  it('clamps a drag to the viewport', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onRegionEnd = vi.fn()
    const picker = createPicker({ onRegionEnd })

    picker.start()
    window.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 900, clientY: 700 })
    )
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 9999, clientY: 9999 })
    )
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 9999, clientY: 9999 })
    )

    expect(onRegionEnd).toHaveBeenCalledWith({
      left: 900,
      top: 700,
      width: window.innerWidth - 900,
      height: window.innerHeight - 700
    })
  })

  it('keeps click selection when the press barely moves', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onSelect = vi.fn()
    const onRegionEnd = vi.fn()
    const picker = createPicker({ onSelect, onRegionEnd })

    picker.start()
    window.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    )
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 12, clientY: 11 })
    )
    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 12, clientY: 11 })
    )
    window.dispatchEvent(
      new MouseEvent('click', { bubbles: true, button: 0, clientX: 12, clientY: 11 })
    )

    expect(onRegionEnd).not.toHaveBeenCalled()
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ element: inner }))
  })

  it('cancels only the drag on the first Escape', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onCancel = vi.fn()
    const onRegionCancel = vi.fn()
    const onRegionEnd = vi.fn()
    const picker = createPicker({ onCancel, onRegionCancel, onRegionEnd })

    picker.start()
    window.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 })
    )
    window.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

    expect(onRegionCancel).toHaveBeenCalledTimes(1)
    expect(picker.isActive).toBe(true)

    window.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: 100, clientY: 100 })
    )
    expect(onRegionEnd).not.toHaveBeenCalled()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(picker.isActive).toBe(false)
  })
})
