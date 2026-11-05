import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  stack: [] as Element[]
}))

vi.mock('../src/core/target', () => ({
  getElementStack: () => hoisted.stack,
  resolveCandidate: (stack: Element[], index: number) =>
    stack[Math.min(Math.max(index, 0), stack.length - 1)] ?? null
}))

import { ElementPicker } from '../src/core/picker'

afterEach(() => {
  hoisted.stack = []
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
})
