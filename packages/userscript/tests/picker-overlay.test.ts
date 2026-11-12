import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { createI18n } from '@element-screenshot/settings'
import type { I18n, SettingsController } from '@element-screenshot/settings'
import PickerOverlay from '../src/ui/PickerOverlay.vue'
import { appMessages } from '../src/messages'
import type { PickerHover, ShotAppApi, ShotState } from '../src/ui/api'

function createApi(state: Partial<ShotState> = {}, i18n?: I18n) {
  const reactiveState = reactive<ShotState>({
    mode: 'picking',
    hover: null,
    box: null,
    marquee: null,
    cursor: { x: 0, y: 0 },
    capturing: false,
    ready: false,
    error: null,
    captureSize: null,
    previewUrl: null,
    toasts: [],
    fab: { left: 0, top: 0, dock: null },
    viewport: { width: 1200, height: 800 },
    ...state
  })

  const api = {
    state: reactiveState,
    settings: {
      get: (key: string) => (key === 'capture.borderColor' ? '#2563eb' : undefined)
    } as unknown as SettingsController,
    i18n: i18n ?? ({ t: (key: string) => key } as unknown as I18n),
    startPicker: vi.fn(),
    cancel: vi.fn(),
    cycle: vi.fn(),
    cycleScroll: vi.fn(),
    copy: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    usePreviewFallback: vi.fn(),
    repositionFab: vi.fn(),
    setFabPosition: vi.fn(),
    toast: vi.fn(),
    isUiEvent: () => true
  }

  return api as unknown as ShotAppApi
}

function hover(overrides: Partial<PickerHover> = {}): PickerHover {
  return {
    label: 'div.feed',
    width: 768,
    height: 800,
    rect: { left: 0, top: 0, width: 768, height: 800 },
    contentWidth: 768,
    contentHeight: 1321,
    scrollAxis: 'y',
    scrollable: true,
    depth: 9,
    total: 10,
    fullPage: false,
    inFrame: false,
    frameLevel: 0,
    ...overrides
  }
}

function frame(wrapper: ReturnType<typeof mount>, kind: 'visible' | 'content') {
  return wrapper.find(`[data-frame="${kind}"]`)
}

describe('picker overlay frames', () => {
  it('draws the visible box solid and the scroll content dashed', () => {
    const app = createApi({
      hover: hover(),
      box: { left: 0, top: 0, width: 768, height: 1321 }
    })
    const wrapper = mount(PickerOverlay, { props: { app } })

    const visible = frame(wrapper, 'visible')
    const content = frame(wrapper, 'content')
    expect(visible.exists()).toBe(true)
    expect(content.exists()).toBe(true)

    const visibleStyle = (visible.element as HTMLElement).style
    const contentStyle = (content.element as HTMLElement).style
    expect(visibleStyle.height).toBe('800px')
    expect(visibleStyle.borderStyle).toBe('solid')
    expect(contentStyle.height).toBe('1321px')
    expect(contentStyle.borderStyle).toBe('dashed')

    expect(wrapper.text()).toContain('↓1321px')
    expect(wrapper.text()).toContain('768 × 800')
  })

  it('skips the dashed frame when the element does not scroll', () => {
    const app = createApi({
      hover: hover({
        rect: { left: 0, top: 0, width: 320, height: 240 },
        width: 320,
        height: 240,
        contentWidth: 320,
        contentHeight: 240,
        scrollAxis: null,
        scrollable: false
      }),
      box: { left: 0, top: 0, width: 320, height: 240 }
    })
    const wrapper = mount(PickerOverlay, { props: { app } })

    expect(frame(wrapper, 'visible').exists()).toBe(true)
    expect(frame(wrapper, 'content').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('app.hint.scrollable')
  })

  it('reports a horizontal scroll container with a width', () => {
    const app = createApi({
      hover: hover({
        rect: { left: 0, top: 0, width: 600, height: 300 },
        width: 600,
        height: 300,
        contentWidth: 2400,
        contentHeight: 300,
        scrollAxis: 'x'
      }),
      box: { left: 0, top: 0, width: 2400, height: 300 }
    })
    const wrapper = mount(PickerOverlay, { props: { app } })

    expect(wrapper.text()).toContain('→2400px')
    expect(frame(wrapper, 'content').exists()).toBe(true)
  })

  it('marks a layer that lives inside a frame', () => {
    const app = createApi({
      hover: hover({ label: 'div.card', inFrame: true, scrollAxis: null, scrollable: false }),
      box: { left: 0, top: 0, width: 768, height: 800 }
    })
    const wrapper = mount(PickerOverlay, { props: { app } })

    expect(wrapper.text()).toContain('app.hint.inFrame')
    expect(wrapper.text()).toContain('div.card')
  })

  it('does not mark a layer of this document', () => {
    const app = createApi({ hover: hover(), box: { left: 0, top: 0, width: 768, height: 1321 } })
    const wrapper = mount(PickerOverlay, { props: { app } })

    expect(wrapper.text()).not.toContain('app.hint.inFrame')
  })
})

describe('picker frame badge wording', () => {
  function localized(locale: string) {
    const i18n = createI18n({ locales: appMessages, defaultLocale: 'zh-CN' })
    i18n.setLocale(locale)
    return i18n
  }

  function badge(wrapper: ReturnType<typeof mount>) {
    return wrapper.findAll('span').find((span) => span.classes('bg-sky-50'))
  }

  function mountInFrame(locale: string, frameLevel = 1) {
    const app = createApi(
      {
        hover: hover({
          label: 'div.row',
          inFrame: true,
          frameLevel,
          scrollAxis: null,
          scrollable: false
        }),
        box: { left: 0, top: 0, width: 377, height: 36 }
      },
      localized(locale)
    )
    return mount(PickerOverlay, { props: { app } })
  }

  it('calls a layer inside an iframe 框架, not 帧内', () => {
    const wrapper = mountInFrame('zh-CN')

    expect(badge(wrapper)?.text()).toBe('框架')
    expect(wrapper.text()).not.toContain('帧内')
  })

  it('says iframe in English', () => {
    const wrapper = mountInFrame('en')

    expect(badge(wrapper)?.text()).toBe('iframe')
    expect(wrapper.text()).not.toContain('In frame')
  })

  it('counts nested frames after the same word', () => {
    const wrapper = mountInFrame('zh-CN', 2)

    expect(badge(wrapper)?.text()).toBe('框架×2')
  })
})
