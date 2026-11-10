import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import type { I18n, SettingsController } from '@element-screenshot/settings'
import ResultViewer from '../src/ui/ResultViewer.vue'
import type { ShotAppApi, ShotState } from '../src/ui/api'

function createApi(overrides: Partial<ShotState> = {}, values: Record<string, unknown> = {}) {
  const state = reactive<ShotState>({
    mode: 'selected',
    hover: null,
    box: null,
    marquee: null,
    cursor: { x: 0, y: 0 },
    capturing: false,
    ready: true,
    error: null,
    captureSize: { width: 598, height: 602 },
    previewUrl: 'blob:capture',
    toasts: [],
    fab: { left: 0, top: 0, dock: null },
    viewport: { width: 1200, height: 800 },
    ...overrides
  })

  const api = {
    state,
    settings: { get: (key: string) => values[key] } as unknown as SettingsController,
    i18n: { t: (key: string) => key } as unknown as I18n,
    startPicker: vi.fn(),
    cancel: vi.fn(),
    cycle: vi.fn(),
    copy: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    usePreviewFallback: vi.fn(),
    repositionFab: vi.fn(),
    setFabPosition: vi.fn(),
    toast: vi.fn(),
    isUiEvent: () => true
  }

  return { state, api: api as unknown as ShotAppApi }
}

function pointer(image: Element, type: string, x: number, y: number): void {
  image.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y })
  )
}

function wheel(image: Element, deltaY: number): void {
  image.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY }))
}

function width(wrapper: ReturnType<typeof mount>): number {
  const style = (wrapper.get('img').element as HTMLElement).style
  return Number.parseFloat(style.width)
}

describe('result viewer', () => {
  it('centres the capture and offers the actions', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })

    const image = wrapper.get('img')
    expect(image.attributes('src')).toBe('blob:capture')
    expect(image.attributes('alt')).toBe('app.hint.preview')
    expect(wrapper.text()).toContain('598 × 602')

    const buttons = wrapper.findAll('button').filter((button) => button.text())
    expect(buttons.map((button) => button.text())).toEqual([
      'app.action.copy',
      'app.action.save',
      'app.action.close'
    ])

    await buttons[0]?.trigger('click')
    expect(api.copy).toHaveBeenCalled()
    await buttons[1]?.trigger('click')
    expect(api.save).toHaveBeenCalled()
    await buttons[2]?.trigger('click')
    expect(api.cancel).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('falls back to a data URL when the blob URL is blocked', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })

    await wrapper.get('img').trigger('error')
    expect(api.usePreviewFallback).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('does not close when the backdrop is clicked', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })

    await wrapper.get('[role="dialog"]').trigger('click')
    await wrapper.get('.flex-1').trigger('click')
    expect(api.cancel).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('closes from the corner button', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })

    const close = wrapper.get('button[aria-label="app.action.close"]')
    expect(close.attributes('title')).toBe('app.action.close')
    await close.trigger('click')
    expect(api.cancel).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('toggles between fit and a large zoom on click', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })
    const image = wrapper.get('img').element

    expect(width(wrapper)).toBe(598)
    expect((image as HTMLElement).style.cursor).toBe('zoom-in')

    pointer(image, 'pointerdown', 40, 40)
    pointer(image, 'pointerup', 40, 40)
    await nextTick()

    expect(width(wrapper)).toBe(1794)
    expect((image as HTMLElement).style.cursor).toBe('zoom-out')
    expect(wrapper.text()).toContain('300%')

    pointer(image, 'pointerdown', 40, 40)
    pointer(image, 'pointerup', 40, 40)
    await nextTick()

    expect(width(wrapper)).toBe(598)
    expect(wrapper.text()).not.toContain('300%')

    wrapper.unmount()
  })

  it('steps the zoom with the wheel and never goes below fit', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })
    const image = wrapper.get('img').element

    wheel(image, -100)
    await nextTick()
    const zoomedIn = width(wrapper)
    expect(zoomedIn).toBeGreaterThan(598)
    expect(zoomedIn).toBeLessThan(1794)

    wheel(image, 100)
    await nextTick()
    expect(width(wrapper)).toBeCloseTo(598, 3)

    wheel(image, 100)
    await nextTick()
    expect(width(wrapper)).toBe(598)

    wrapper.unmount()
  })

  it('pans by dragging while zoomed without toggling again', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })
    const image = wrapper.get('img').element

    pointer(image, 'pointerdown', 40, 40)
    pointer(image, 'pointerup', 40, 40)
    await nextTick()

    pointer(image, 'pointerdown', 100, 100)
    pointer(image, 'pointermove', 160, 140)
    pointer(image, 'pointerup', 160, 140)
    await nextTick()

    const style = (image as HTMLElement).style
    expect(style.transform).toBe('translate3d(60px, 40px, 0)')
    expect(width(wrapper)).toBe(1794)

    wrapper.unmount()
  })

  it('reports a failed render instead of an image', () => {
    const { api } = createApi({ ready: false, previewUrl: null, error: 'capture cancelled' })
    const wrapper = mount(ResultViewer, { props: { app: api } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('app.hint.failed')
    expect(wrapper.text()).toContain('capture cancelled')

    wrapper.unmount()
  })

  it('disables the actions until the image is ready', () => {
    const { api } = createApi({ ready: false, previewUrl: null })
    const wrapper = mount(ResultViewer, { props: { app: api } })

    expect(wrapper.text()).toContain('app.hint.previewUnavailable')
    const disabled = wrapper.findAll('button').filter((b) => b.attributes('disabled') !== undefined)
    expect(disabled).toHaveLength(2)

    wrapper.unmount()
  })

  it('puts a checkerboard behind transparent captures', () => {
    const { api } = createApi({}, { 'capture.transparent': true })
    const wrapper = mount(ResultViewer, { props: { app: api } })

    expect(wrapper.get('img').attributes('style')).toContain('repeating-conic-gradient')

    wrapper.unmount()
  })
})
