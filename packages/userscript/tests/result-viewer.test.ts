import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
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

describe('result viewer', () => {
  it('centres the capture and offers the actions', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })

    const image = wrapper.get('img')
    expect(image.attributes('src')).toBe('blob:capture')
    expect(image.attributes('alt')).toBe('app.hint.preview')
    expect(wrapper.text()).toContain('598 × 602')

    const buttons = wrapper.findAll('button')
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

  it('closes when the backdrop is clicked', async () => {
    const { api } = createApi()
    const wrapper = mount(ResultViewer, { props: { app: api } })

    await wrapper.get('[role="dialog"]').trigger('click')
    expect(api.cancel).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('reports a failed render instead of an image', () => {
    const { api } = createApi({ ready: false, previewUrl: null, error: 'capture cancelled' })
    const wrapper = mount(ResultViewer, { props: { app: api } })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('app.hint.failed')
    expect(wrapper.text()).toContain('capture cancelled')
    expect(wrapper.get('button[type="button"]').attributes('disabled')).toBeUndefined()

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
