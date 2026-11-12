import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PickTarget } from '../src/core/pick-target'
import { ElementPicker, installEarlyPickerListeners } from '../src/core/picker'

/**
 * The picker's listeners are installed at document-start, i.e. before any page
 * script can register its own, which is what lets it win the capture queue. These
 * cases exercise that ordering: the page listener is added *after* the install, the
 * way a page script would be.
 */

function target(): PickTarget {
  return {
    element: document.createElement('div'),
    frame: null,
    frameElementId: null,
    path: [],
    label: 'div',
    rect: { left: 0, top: 0, width: 10, height: 10 },
    box: { left: 0, top: 0, width: 10, height: 10 },
    scrollAxis: null,
    fullPage: false
  }
}

function createPicker(onSelect = vi.fn(), onCancel = vi.fn()): ElementPicker {
  return new ElementPicker({
    onHover: vi.fn(),
    onSelect,
    onCancel,
    resolve: () => [target()],
    resolveDocument: () => target()
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('picker capture ordering', () => {
  it('keeps the click away from page listeners only while picking', () => {
    installEarlyPickerListeners()
    const page = vi.fn()
    window.addEventListener('click', page, true)

    const onSelect = vi.fn()
    const picker = createPicker(onSelect)
    try {
      // Idle: the page's own click handling is untouched.
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(page).toHaveBeenCalledTimes(1)

      picker.start()
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(page).toHaveBeenCalledTimes(1)
      expect(onSelect).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('click', page, true)
      picker.stop()
    }
  })

  it('still selects when the page swallows clicks at window capture', () => {
    installEarlyPickerListeners()
    const swallow = (event: Event): void => event.stopImmediatePropagation()
    window.addEventListener('click', swallow, true)

    const onSelect = vi.fn()
    const picker = createPicker(onSelect)
    try {
      picker.start()
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onSelect).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('click', swallow, true)
      picker.stop()
    }
  })

  it('forwards each event once, no matter how many pickers were created', () => {
    installEarlyPickerListeners()
    const first = createPicker()
    const onSelect = vi.fn()
    const second = createPicker(onSelect)

    try {
      second.start()
      window.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(onSelect).toHaveBeenCalledTimes(1)
    } finally {
      second.stop()
      first.stop()
    }
  })
})
