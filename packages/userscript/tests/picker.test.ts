import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  stack: [] as Element[],
  scrolls: new Set<Element>()
}))

vi.mock('../src/core/target', () => ({
  getElementStack: () => hoisted.stack,
  resolveCandidate: (stack: Element[], index: number) =>
    stack[Math.min(Math.max(index, 0), stack.length - 1)] ?? null
}))

vi.mock('../src/core/scroll-axis', () => ({
  SCROLL_OVERFLOW: new Set(['auto', 'scroll', 'overlay']),
  scrollContainerInfo: (element: Element) => ({
    axis: hoisted.scrolls.has(element) ? 'y' : null,
    contentWidth: 0,
    contentHeight: 0,
    overflowX: 0,
    overflowY: 0
  })
}))

import { ElementPicker } from '../src/core/picker'

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
    const picker = new ElementPicker({
      onHover,
      onSelect: vi.fn(),
      onCancel: vi.fn()
    })

    picker.start()
    expect(onHover).toHaveBeenLastCalledWith(inner, 1, 2)
    picker.cycle(1)
    expect(onHover).toHaveBeenLastCalledWith(inner, 1, 2)
    picker.cycle(-1)
    expect(onHover).toHaveBeenLastCalledWith(outer, 0, 2)
    picker.stop()
  })

  it('selects the current element on click', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onSelect = vi.fn()
    const picker = new ElementPicker({
      onHover: vi.fn(),
      onSelect,
      onCancel: vi.fn()
    })

    picker.start()
    window.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }))
    expect(onSelect).toHaveBeenCalledWith(inner)
    expect(picker.isActive).toBe(false)
  })

  it('selects the document on Ctrl+A and cancels on Escape', () => {
    const element = document.createElement('div')
    hoisted.stack = [element]
    const onSelect = vi.fn()
    const onCancel = vi.fn()
    const picker = new ElementPicker({
      onHover: vi.fn(),
      onSelect,
      onCancel
    })

    picker.start()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }))
    expect(onSelect).toHaveBeenCalledWith(document.documentElement)
    expect(picker.isActive).toBe(false)

    const second = new ElementPicker({ onHover: vi.fn(), onSelect, onCancel })
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
    const picker = new ElementPicker({ onHover, onSelect: vi.fn(), onCancel: vi.fn() })

    picker.start()
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))
    expect(onHover).toHaveBeenLastCalledWith(inner, 1, 2)
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }))
    expect(onHover).toHaveBeenLastCalledWith(outer, 0, 2)
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
    const picker = new ElementPicker({ onHover, onSelect: vi.fn(), onCancel: vi.fn() })
    picker.start()
    expect(onHover).toHaveBeenLastCalledWith(icon, 4, 5)

    picker.cycleScroll(-1)
    expect(onHover).toHaveBeenLastCalledWith(scroller, 2, 5)

    // No further scroll container above it, so the layer stays put.
    picker.cycleScroll(-1)
    expect(onHover).toHaveBeenLastCalledWith(scroller, 2, 5)

    picker.cycleScroll(1)
    expect(onHover).toHaveBeenLastCalledWith(scroller, 2, 5)
    picker.stop()
  })

  it('jumps between scroll containers with Shift+wheel', () => {
    const icon = document.createElement('i')
    const scroller = document.createElement('div')
    const body = document.body
    hoisted.stack = [icon, scroller, body]
    hoisted.scrolls = new Set([scroller])

    const onHover = vi.fn()
    const picker = new ElementPicker({ onHover, onSelect: vi.fn(), onCancel: vi.fn() })
    picker.start()
    expect(onHover).toHaveBeenLastCalledWith(icon, 2, 3)

    // Shift moves the deltas onto the horizontal axis on some platforms.
    window.dispatchEvent(
      new WheelEvent('wheel', { deltaX: 120, shiftKey: true, cancelable: true })
    )
    expect(onHover).toHaveBeenLastCalledWith(icon, 2, 3)

    window.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, shiftKey: true, cancelable: true }))
    expect(onHover).toHaveBeenLastCalledWith(scroller, 1, 3)
    picker.stop()
  })

  it('turns a drag into a capture region instead of a click', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onSelect = vi.fn()
    const onRegionStart = vi.fn()
    const onRegionChange = vi.fn()
    const onRegionEnd = vi.fn()

    const picker = new ElementPicker({
      onHover: vi.fn(),
      onSelect,
      onCancel: vi.fn(),
      onRegionStart,
      onRegionChange,
      onRegionEnd
    })

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
    const picker = new ElementPicker({
      onHover: vi.fn(),
      onSelect: vi.fn(),
      onCancel: vi.fn(),
      onRegionEnd
    })

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
    const picker = new ElementPicker({
      onHover: vi.fn(),
      onSelect,
      onCancel: vi.fn(),
      onRegionEnd
    })

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
    expect(onSelect).toHaveBeenCalledWith(inner)
  })

  it('cancels only the drag on the first Escape', () => {
    const inner = document.createElement('div')
    hoisted.stack = [inner]
    const onCancel = vi.fn()
    const onRegionCancel = vi.fn()
    const onRegionEnd = vi.fn()
    const picker = new ElementPicker({
      onHover: vi.fn(),
      onSelect: vi.fn(),
      onCancel,
      onRegionCancel,
      onRegionEnd
    })

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
