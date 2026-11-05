import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import SettingsRoot from '../src/components/SettingsRoot.vue'
import FieldControl from '../src/components/FieldControl.vue'
import ListInput from '../src/components/ListInput.vue'
import ShortcutInput from '../src/components/ShortcutInput.vue'
import { createI18n } from '../src/i18n'
import { createSettings } from '../src/settings'
import { createMemoryStorage } from '../src/storage'
import { applyShadowStyles } from '../src/styles'
import type { SettingsTab } from '../src/types'

const i18n = createI18n({
  defaultLocale: 'en',
  fallbackLocale: 'en',
  locales: [
    {
      code: 'en',
      label: 'English',
      messages: {
        settings: {
          title: 'Settings',
          searchPlaceholder: 'Search settings…',
          noResults: 'No matching settings',
          close: 'Close',
          tablist: 'Settings sections',
          footerHint: 'Esc to close',
          shortcut: {
            empty: 'Not set',
            recording: 'Press a combination…',
            invalid: 'Invalid shortcut',
            hint: 'Include Ctrl / Alt / Meta',
            clear: 'Clear'
          },
          list: { empty: 'No entries', add: 'Add', remove: 'Remove' }
        }
      }
    }
  ]
})

const tabs: SettingsTab[] = [
  {
    id: 'main',
    title: 'Main',
    icon: 'camera',
    groups: [
      {
        id: 'group',
        title: 'Group',
        defaultOpen: true,
        fields: [
          { type: 'switch', key: 'flag', label: 'Flag', default: false },
          { type: 'text', key: 'name', label: 'Name', default: 'Ada' }
        ]
      },
      {
        id: 'collapsed',
        title: 'Collapsed',
        fields: [{ type: 'switch', key: 'other', label: 'Other', default: true }]
      }
    ]
  },
  {
    id: 'second',
    title: 'Second tab',
    groups: [
      {
        id: 'second-group',
        title: 'Second group',
        fields: [{ type: 'text', key: 'second', label: 'Second field', default: '' }]
      }
    ]
  }
]

afterEach(() => {
  document.body.innerHTML = ''
})

describe('settings components', () => {
  it('renders tabs, groups and updates a switch', async () => {
    const controller = createSettings({ tabs, i18n, builtins: false })
    const wrapper = mount(SettingsRoot, { props: { controller }, attachTo: document.body })

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('Main')
    expect(wrapper.text()).toContain('Flag')

    const toggle = wrapper.get('[role="switch"]')
    expect(toggle.attributes('aria-checked')).toBe('false')
    await toggle.trigger('click')
    expect(controller.get('flag')).toBe(true)

    const textInput = wrapper.get('input[type="text"]')
    await textInput.setValue('Grace')
    expect(controller.get('name')).toBe('Grace')
    controller.dispose()
  })

  it('switches tabs and collapses groups', async () => {
    const controller = createSettings({ tabs, i18n, builtins: false })
    const wrapper = mount(SettingsRoot, { props: { controller }, attachTo: document.body })

    const groupToggle = wrapper.findAll('button').find((button) => button.text().includes('Group'))
    expect(groupToggle?.attributes('aria-expanded')).toBe('true')
    await groupToggle?.trigger('click')
    expect(groupToggle?.attributes('aria-expanded')).toBe('false')

    const secondTab = wrapper.findAll('[role="tab"]')[1]
    await secondTab?.trigger('click')
    expect(wrapper.text()).toContain('Second field')
    controller.dispose()
  })

  it('filters fields with the search box', async () => {
    const controller = createSettings({ tabs, i18n, builtins: false })
    const wrapper = mount(SettingsRoot, { props: { controller }, attachTo: document.body })

    await wrapper.get('input[type="search"]').setValue('Name')
    expect(wrapper.text()).toContain('Name')
    expect(wrapper.text()).not.toContain('Other')
    await wrapper.get('input[type="search"]').setValue('zzz')
    expect(wrapper.text()).toContain('No matching settings')
    controller.dispose()
  })

  it('closes on Escape', async () => {
    const controller = createSettings({ tabs, i18n, builtins: false })
    const closeSpy = vi.spyOn(controller, 'close')
    const wrapper = mount(SettingsRoot, { props: { controller }, attachTo: document.body })
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(closeSpy).toHaveBeenCalled()
    controller.dispose()
  })

  it('captures a shortcut from the keyboard', async () => {
    const wrapper = mount(ShortcutInput, {
      props: { modelValue: '', i18n },
      attachTo: document.body
    })

    await wrapper.get('button').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true }))
    await nextTick()
    expect(wrapper.emitted('update')?.[0]).toEqual(['Ctrl+Shift+S'])

    await wrapper.get('button').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }))
    await nextTick()
    expect(wrapper.emitted('update')).toHaveLength(1)
    expect(wrapper.text()).toContain(i18n.t('settings.shortcut.invalid'))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.unmount()
  })

  it('edits list entries', async () => {
    const wrapper = mount(ListInput, {
      props: { modelValue: ['a'], i18n },
      attachTo: document.body
    })

    const buttons = wrapper.findAll('button')
    await buttons[buttons.length - 1]?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([['a', '']])

    await wrapper.get('input').setValue('changed')
    expect(wrapper.emitted('update')?.[1]).toEqual([['changed']])

    await wrapper.findAll('button')[0]?.trigger('click')
    expect(wrapper.emitted('update')?.[2]).toEqual([[]])
    await wrapper.unmount()
  })

  it('renders field controls by type', async () => {
    const controller = createSettings({
      i18n,
      builtins: false,
      tabs: [
        {
          id: 'types',
          title: 'Types',
          groups: [
            {
              id: 'types',
              title: 'Types',
              fields: [
                {
                  type: 'select',
                  key: 'select',
                  label: 'Select',
                  default: 'a',
                  options: [
                    { value: 'a', label: 'A' },
                    { value: 'b', label: 'B' }
                  ]
                },
                {
                  type: 'range',
                  key: 'range',
                  label: 'Range',
                  default: 2,
                  min: 1,
                  max: 5
                },
                {
                  type: 'color',
                  key: 'color',
                  label: 'Color',
                  default: '#2563eb'
                },
                { type: 'shortcut', key: 'shortcut', label: 'Shortcut', default: 'Alt+S' },
                { type: 'list', key: 'list', label: 'List', default: ['x'] },
                { type: 'action', key: 'action', label: 'Action', action: () => {} }
              ]
            }
          ]
        }
      ]
    })

    const field = controller.tabs[0]?.groups[0]?.fields[0]
    const wrapper = mount(FieldControl, {
      props: {
        field: field!,
        value: controller.values['select'],
        values: controller.values,
        i18n
      }
    })
    expect(wrapper.find('select').exists()).toBe(true)
    await wrapper.get('select').setValue('b')
    expect(wrapper.emitted('update')?.[0]).toEqual(['b'])

    const range = controller.tabs[0]?.groups[0]?.fields[1]
    const rangeWrapper = mount(FieldControl, {
      props: { field: range!, value: 2, values: controller.values, i18n }
    })
    await rangeWrapper.get('input[type="range"]').setValue('4')
    expect(rangeWrapper.emitted('update')?.[0]).toEqual([4])

    const list = controller.tabs[0]?.groups[0]?.fields[4]
    const listWrapper = mount(FieldControl, {
      props: { field: list!, value: ['x'], values: controller.values, i18n }
    })
    expect(listWrapper.find('input[type="text"]').exists()).toBe(true)

    const action = controller.tabs[0]?.groups[0]?.fields[5]
    const actionWrapper = mount(FieldControl, {
      props: { field: action!, value: undefined, values: controller.values, i18n }
    })
    expect(actionWrapper.text()).toContain('Action')
    controller.dispose()
  })

  it('injects styles into a shadow root', () => {
    const host = document.createElement('div')
    const shadow = host.attachShadow({ mode: 'open' })
    applyShadowStyles(shadow, '.probe{color:red}')
    const injected =
      (shadow.adoptedStyleSheets?.length ?? 0) > 0 || shadow.querySelector('style') !== null
    expect(injected).toBe(true)
    applyShadowStyles(shadow, '')
  })

  it('keeps the initial schema when a controller is created from memory storage', () => {
    const controller = createSettings({
      i18n,
      builtins: false,
      storage: createMemoryStorage(),
      tabs
    })
    expect(controller.tabs[0]?.groups[0]?.fields).toHaveLength(2)
    controller.dispose()
  })
})
