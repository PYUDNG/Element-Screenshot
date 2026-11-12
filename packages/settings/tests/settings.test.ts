import { describe, expect, it, vi } from 'vitest'
import { createSettings } from '../src/settings'
import { createMemoryStorage } from '../src/storage'
import type { SettingsTab } from '../src/types'

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
          { type: 'text', key: 'name', label: 'Name', default: 'Ada' },
          { type: 'list', key: 'items', label: 'Items', default: ['a'] }
        ]
      }
    ]
  }
]

describe('settings controller', () => {
  it('registers the schema, defaults and built-in general tab', () => {
    const settings = createSettings({ tabs })
    expect(settings.tabs[0]?.id).toBe('general')
    expect(settings.tabs.map((tab) => tab.id)).toEqual(['general', 'main'])
    expect(settings.get('flag')).toBe(false)
    expect(settings.get('name')).toBe('Ada')
    expect(settings.get('items')).toEqual(['a'])
    expect(settings.get('locale')).toBe('auto')
    expect(settings.get('theme')).toBe('auto')
    expect(settings.hasTab('main')).toBe(true)
    settings.dispose()
  })

  it('can omit built-ins', () => {
    const settings = createSettings({ tabs, builtins: false })
    expect(settings.tabs).toHaveLength(1)
    expect(settings.get('locale')).toBeUndefined()
    settings.dispose()
  })

  it('titles the built-in group for what it holds', () => {
    // By default the group carries the language select and the theme.
    const plain = createSettings({ tabs })
    expect(plain.tabs[0]?.groups[0]?.title).toBe('settings.builtin.appearance')
    plain.dispose()

    // A schema that declares its own `theme` field gets a language-only group.
    const own: SettingsTab[] = [
      {
        id: 'appearance',
        title: 'Appearance',
        groups: [
          {
            id: 'theme',
            title: 'Theme',
            fields: [{ type: 'select', key: 'theme', label: 'Theme', default: 'auto', options: [] }]
          }
        ]
      }
    ]
    const moved = createSettings({ tabs: own })
    expect(moved.tabs.find((tab) => tab.id === 'general')?.groups[0]?.title).toBe(
      'settings.builtin.languageGroup'
    )
    // The library must not add a second theme field next to the app's own.
    expect(moved.getField('theme')?.type).toBe('select')
    moved.dispose()
  })

  it('hydrates and persists values', () => {
    const storage = createMemoryStorage({
      'my-values': JSON.stringify({
        flag: true,
        name: 'Grace',
        items: ['x', 'y'],
        malformed: 'ignored'
      })
    })
    const settings = createSettings({ tabs, storage, storageKey: 'my-values' })
    expect(settings.get('flag')).toBe(true)
    expect(settings.get('name')).toBe('Grace')
    expect(settings.get('items')).toEqual(['x', 'y'])

    settings.set('flag', false)
    expect(JSON.parse(storage.getItem('my-values') ?? '{}')).toMatchObject({ flag: false })
    settings.dispose()
  })

  it('ignores stored values of an incompatible type', () => {
    const storage = createMemoryStorage({
      values: JSON.stringify({ flag: 'yes', name: 42, items: 'nope' })
    })
    const settings = createSettings({ tabs, storage, storageKey: 'values' })
    expect(settings.get('flag')).toBe(false)
    expect(settings.get('name')).toBe('Ada')
    expect(settings.get('items')).toEqual(['a'])
    settings.dispose()
  })

  it('supports dynamic tabs, groups and fields', () => {
    const settings = createSettings({ tabs })
    settings.registerTab({
      id: 'extra',
      title: 'Extra',
      groups: [{ id: 'extra-group', title: 'Extra group', fields: [] }]
    })
    settings.registerField('extra', 'extra-group', {
      type: 'number',
      key: 'count',
      label: 'Count',
      default: 3
    })
    expect(settings.get('count')).toBe(3)
    expect(settings.getField('count')?.type).toBe('number')

    settings.updateField('count', { label: 'Count 2', default: 5 })
    expect(settings.getField('count')?.label).toBe('Count 2')
    expect(settings.get('count')).toBe(3)
    settings.reset('count')
    expect(settings.get('count')).toBe(5)

    settings.registerGroup('extra', {
      id: 'second',
      title: 'Second',
      fields: [{ type: 'switch', key: 'enabled', label: 'Enabled', default: true }]
    })
    expect(settings.get('enabled')).toBe(true)

    settings.unregisterGroup('extra', 'second')
    expect(settings.get('enabled')).toBeUndefined()
    settings.removeField('count')
    expect(settings.getField('count')).toBeUndefined()

    settings.unregisterTab('extra')
    expect(settings.hasTab('extra')).toBe(false)
    settings.dispose()
  })

  it('rejects duplicate ids and unknown parents', () => {
    const settings = createSettings({ tabs })
    expect(() => settings.registerTab(tabs[0]!)).toThrow()
    expect(() => settings.registerGroup('missing', { id: 'x', title: 'X', fields: [] })).toThrow()
    expect(() =>
      settings.registerField('main', 'missing', {
        type: 'text',
        key: 'x',
        label: 'X',
        default: ''
      })
    ).toThrow()
    expect(() =>
      settings.registerField('main', 'group', {
        type: 'text',
        key: 'flag',
        label: 'Duplicate',
        default: ''
      })
    ).toThrow()
    settings.dispose()
  })

  it('resets defaults without sharing arrays', () => {
    const settings = createSettings({ tabs })
    settings.get<string[]>('items').push('mutated')
    expect(settings.get('items')).toEqual(['a', 'mutated'])
    settings.resetAll()
    expect(settings.get('items')).toEqual(['a'])
    settings.dispose()
  })

  it('reacts to locale and theme settings', () => {
    const settings = createSettings({ tabs })
    settings.set('locale', 'zh-TW')
    expect(settings.i18n.resolvedLocale.value).toBe('zh-TW')

    settings.set('theme', 'dark')
    expect(settings.theme.value).toBe('dark')
    expect(settings.resolvedTheme.value).toBe('dark')
    settings.set('theme', 'light')
    expect(settings.resolvedTheme.value).toBe('light')
    settings.set('theme', 'auto')
    expect(settings.resolvedTheme.value).toBe('light')
    settings.dispose()
  })

  it('opens and closes a shadow-root panel', async () => {
    const settings = createSettings({ tabs })
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    settings.open()
    expect(settings.isOpen.value).toBe(true)
    const host = document.querySelector('[data-element-screenshot-settings]')
    expect(host).not.toBeNull()
    expect(host?.shadowRoot).not.toBeNull()

    settings.close()
    expect(settings.isOpen.value).toBe(false)
    expect(document.querySelector('[data-element-screenshot-settings]')).toBeNull()
    expect(focusSpy).toHaveBeenCalled()
    settings.dispose()
  })

  it('survives storage failures', () => {
    const onStorageError = vi.fn()
    const settings = createSettings({
      tabs,
      storage: {
        getItem: () => {
          throw new Error('read')
        },
        setItem: () => {
          throw new Error('write')
        },
        removeItem: () => {}
      },
      onStorageError
    })
    settings.set('flag', true)
    expect(onStorageError).toHaveBeenCalled()
    settings.dispose()
  })
})
