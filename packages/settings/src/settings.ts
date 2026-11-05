import { computed, createApp, reactive, ref, watch } from 'vue'
import type { App, ComputedRef } from 'vue'
import SettingsRoot from './components/SettingsRoot.vue'
import { createI18n } from './i18n'
import type { I18n } from './i18n'
import { registerSettingsMessages } from './messages'
import { applyShadowStyles, getDefaultSettingsStyles } from './styles'
import { createMemoryStorage } from './storage'
import type { SettingsStorage } from './storage'
import type {
  ResolvedTheme,
  SettingValue,
  SettingsField,
  SettingsFieldPatch,
  SettingsGroup,
  SettingsTab,
  SettingsValues,
  ThemeSetting
} from './types'

export interface SettingsControllerOptions {
  tabs?: SettingsTab[]
  i18n?: I18n
  storage?: SettingsStorage
  storageKey?: string
  /** CSS injected into the settings shadow root when opening. */
  styles?: string
  /** Adds the built-in General tab (language, theme, reset). Default: true. */
  builtins?: boolean
  version?: string
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: unknown) => void
  onStorageError?: (error: unknown) => void
}

export interface SettingsController {
  readonly tabs: SettingsTab[]
  readonly values: SettingsValues
  readonly i18n: I18n
  readonly theme: ComputedRef<ThemeSetting>
  readonly resolvedTheme: ComputedRef<ResolvedTheme>
  readonly isOpen: ComputedRef<boolean>
  readonly version?: string
  get<T extends SettingValue = SettingValue>(key: string): T
  set(key: string, value: SettingValue): void
  reset(key?: string): void
  resetAll(): void
  open(): void
  close(): void
  dispose(): void
  registerTab(tab: SettingsTab, index?: number): void
  unregisterTab(tabId: string): void
  registerGroup(tabId: string, group: SettingsGroup, index?: number): void
  unregisterGroup(tabId: string, groupId: string): void
  registerField(tabId: string, groupId: string, field: SettingsField, index?: number): void
  updateField(key: string, patch: SettingsFieldPatch): void
  removeField(key: string): void
  getField(key: string): SettingsField | undefined
  hasTab(tabId: string): boolean
}

function cloneValue(value: SettingValue): SettingValue {
  return Array.isArray(value) ? [...value] : value
}

function isCompatible(current: SettingValue | undefined, next: unknown): next is SettingValue {
  if (Array.isArray(current)) {
    return Array.isArray(next) && next.every((item) => typeof item === 'string')
  }
  if (typeof current === 'number') return typeof next === 'number' && Number.isFinite(next)
  if (typeof current === 'boolean') return typeof next === 'boolean'
  if (typeof current === 'string') return typeof next === 'string'
  return false
}

function cloneField(field: SettingsField): SettingsField {
  if (field.type === 'action') return { ...field }
  return { ...field, default: cloneValue(field.default ?? '') } as SettingsField
}

function cloneGroup(group: SettingsGroup): SettingsGroup {
  return { ...group, fields: group.fields.map(cloneField) }
}

function cloneTab(tab: SettingsTab): SettingsTab {
  return { ...tab, groups: tab.groups.map(cloneGroup) }
}

export function createSettings(options: SettingsControllerOptions = {}): SettingsController {
  const i18n =
    options.i18n ??
    createI18n({
      defaultLocale: 'zh-CN',
      fallbackLocale: 'en'
    })
  registerSettingsMessages(i18n)

  const storage = options.storage ?? createMemoryStorage()
  const storageKey = options.storageKey ?? 'userscript-settings'
  const tabs = reactive<SettingsTab[]>([])
  const values = reactive<SettingsValues>({})
  const defaults = new Map<string, SettingValue>()
  const isOpen = ref(false)
  const systemDark = ref(false)

  let app: App | null = null
  let host: HTMLElement | null = null
  let previousFocus: Element | null = null
  let stopLocaleWatch: (() => void) | null = null
  let stopPersistWatch: (() => void) | null = null

  function fieldDefault(field: SettingsField): SettingValue | undefined {
    if (field.type === 'action') return undefined
    return field.default ?? ''
  }

  function registerFieldDefault(field: SettingsField): void {
    const value = fieldDefault(field)
    if (value === undefined) return
    defaults.set(field.key, cloneValue(value))
    if (!(field.key in values)) {
      values[field.key] = cloneValue(value)
    }
  }

  function registerGroupDefaults(group: SettingsGroup): void {
    for (const field of group.fields) registerFieldDefault(field)
  }

  function findTab(tabId: string): SettingsTab | undefined {
    return tabs.find((tab) => tab.id === tabId)
  }

  function findGroup(tabId: string, groupId: string): SettingsGroup | undefined {
    return findTab(tabId)?.groups.find((group) => group.id === groupId)
  }

  function findField(key: string): SettingsField | undefined {
    for (const tab of tabs) {
      for (const group of tab.groups) {
        const field = group.fields.find((item) => item.key === key)
        if (field) return field
      }
    }
    return undefined
  }

  function hasFieldKey(key: string): boolean {
    return findField(key) !== undefined
  }

  function addTab(tab: SettingsTab, index?: number): void {
    if (findTab(tab.id)) {
      throw new Error(`[settings] duplicate tab id: ${tab.id}`)
    }
    const copy = cloneTab(tab)
    if (typeof index === 'number') {
      tabs.splice(index, 0, copy)
    } else {
      tabs.push(copy)
    }
    for (const group of copy.groups) registerGroupDefaults(group)
  }

  function addGroup(tabId: string, group: SettingsGroup, index?: number): void {
    const tab = findTab(tabId)
    if (!tab) throw new Error(`[settings] unknown tab: ${tabId}`)
    if (tab.groups.some((item) => item.id === group.id)) {
      throw new Error(`[settings] duplicate group id: ${group.id}`)
    }
    const copy = cloneGroup(group)
    if (typeof index === 'number') {
      tab.groups.splice(index, 0, copy)
    } else {
      tab.groups.push(copy)
    }
    registerGroupDefaults(copy)
  }

  function addField(tabId: string, groupId: string, field: SettingsField, index?: number): void {
    const group = findGroup(tabId, groupId)
    if (!group) throw new Error(`[settings] unknown group: ${tabId}/${groupId}`)
    if (hasFieldKey(field.key)) {
      throw new Error(`[settings] duplicate field key: ${field.key}`)
    }
    const copy = cloneField(field)
    if (typeof index === 'number') {
      group.fields.splice(index, 0, copy)
    } else {
      group.fields.push(copy)
    }
    registerFieldDefault(copy)
  }

  function removeField(key: string): void {
    for (const tab of tabs) {
      for (const group of tab.groups) {
        const index = group.fields.findIndex((field) => field.key === key)
        if (index >= 0) {
          group.fields.splice(index, 1)
          delete values[key]
          defaults.delete(key)
          return
        }
      }
    }
  }

  function reset(key?: string): void {
    if (key === undefined) {
      resetAll()
      return
    }
    const value = defaults.get(key)
    if (value !== undefined) values[key] = cloneValue(value)
  }

  function resetAll(): void {
    for (const [key, value] of defaults) {
      values[key] = cloneValue(value)
    }
  }

  function hydrate(): void {
    let raw: string | null
    try {
      raw = storage.getItem(storageKey)
    } catch (error) {
      options.onStorageError?.(error)
      return
    }
    if (!raw) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return

    const record = parsed as Record<string, unknown>
    for (const [key, current] of Object.entries(values)) {
      const next = record[key]
      if (isCompatible(current, next)) {
        values[key] = cloneValue(next)
      }
    }
  }

  function currentTheme(): ThemeSetting {
    const value = values['theme']
    return value === 'light' || value === 'dark' ? value : 'auto'
  }

  const theme = computed(currentTheme)
  const resolvedTheme = computed<ResolvedTheme>(() => {
    if (theme.value === 'light') return 'light'
    if (theme.value === 'dark') return 'dark'
    return systemDark.value ? 'dark' : 'light'
  })
  const isOpenComputed = computed(() => isOpen.value)

  // Register consumer tabs first so built-ins can avoid duplicate keys.
  for (const tab of options.tabs ?? []) {
    addTab(tab)
  }

  if (options.builtins !== false) {
    const builtinFields: SettingsField[] = []

    if (!hasFieldKey('locale')) {
      builtinFields.push({
        type: 'select',
        key: 'locale',
        label: 'settings.builtin.language',
        description: 'settings.builtin.languageDescription',
        default: 'auto',
        options: () => [
          { value: 'auto', label: i18n.t('settings.builtin.localeAuto') },
          ...i18n.availableLocales.value.map((locale) => ({
            value: locale.code,
            label: locale.label
          }))
        ]
      })
    }

    if (!hasFieldKey('theme')) {
      builtinFields.push({
        type: 'select',
        key: 'theme',
        label: 'settings.builtin.theme',
        description: 'settings.builtin.themeDescription',
        default: 'auto',
        options: () => [
          { value: 'auto', label: i18n.t('settings.builtin.themeAuto') },
          { value: 'light', label: i18n.t('settings.builtin.themeLight') },
          { value: 'dark', label: i18n.t('settings.builtin.themeDark') }
        ]
      })
    }

    const resetField: SettingsField = {
      type: 'action',
      key: 'reset',
      label: 'settings.builtin.resetAction',
      description: 'settings.builtin.resetDescription',
      icon: 'reset',
      confirm: true,
      confirmLabel: 'settings.confirm',
      action: resetAll
    }

    const generalTab = findTab('general')
    if (generalTab) {
      if (builtinFields.length > 0) {
        addGroup('general', {
          id: 'builtin-appearance',
          title: 'settings.builtin.appearance',
          defaultOpen: true,
          fields: builtinFields
        })
      }
      if (!hasFieldKey('reset')) {
        addGroup('general', {
          id: 'builtin-reset',
          title: 'settings.builtin.reset',
          fields: [resetField]
        })
      }
    } else {
      addTab(
        {
          id: 'general',
          title: 'settings.builtin.tab',
          icon: 'settings',
          groups: [
            ...(builtinFields.length > 0
              ? [
                  {
                    id: 'builtin-appearance',
                    title: 'settings.builtin.appearance',
                    defaultOpen: true,
                    fields: builtinFields
                  }
                ]
              : []),
            {
              id: 'builtin-reset',
              title: 'settings.builtin.reset',
              fields: [resetField]
            }
          ]
        },
        0
      )
    }
  }

  hydrate()

  stopLocaleWatch = watch(
    () => values['locale'],
    (value) => {
      if (typeof value === 'string') i18n.setLocale(value)
    },
    { immediate: true, flush: 'sync' }
  )

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemDark.value = mediaQuery.matches
    const onChange = (event: MediaQueryListEvent): void => {
      systemDark.value = event.matches
    }
    mediaQuery.addEventListener?.('change', onChange)
  }

  stopPersistWatch = watch(
    values,
    () => {
      try {
        storage.setItem(storageKey, JSON.stringify(values))
      } catch (error) {
        options.onStorageError?.(error)
      }
    },
    { deep: true, flush: 'sync' }
  )

  function open(): void {
    if (isOpen.value || typeof document === 'undefined') return

    previousFocus = document.activeElement
    host = document.createElement('div')
    host.setAttribute('data-element-shot-settings', '')
    host.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;pointer-events:none;color-scheme:normal;'
    const shadow = host.attachShadow({ mode: 'open' })
    applyShadowStyles(shadow, options.styles ?? getDefaultSettingsStyles())

    const mountPoint = document.createElement('div')
    shadow.appendChild(mountPoint)
    document.documentElement.appendChild(host)

    app = createApp(SettingsRoot, { controller })
    app.config.errorHandler = (error) => {
      options.onError?.(error)
      console.error('[element-shot/settings]', error)
    }
    app.mount(mountPoint)
    isOpen.value = true
    options.onOpen?.()
  }

  function close(): void {
    if (!isOpen.value) return
    if (app) {
      app.unmount()
      app = null
    }
    host?.remove()
    host = null
    isOpen.value = false
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus()
    }
    previousFocus = null
    options.onClose?.()
  }

  function dispose(): void {
    close()
    stopLocaleWatch?.()
    stopLocaleWatch = null
    stopPersistWatch?.()
    stopPersistWatch = null
  }

  const controller: SettingsController = {
    tabs,
    values,
    i18n,
    theme,
    resolvedTheme,
    isOpen: isOpenComputed,
    version: options.version,
    get<T extends SettingValue = SettingValue>(key: string): T {
      return values[key] as T
    },
    set(key, value) {
      values[key] = cloneValue(value)
    },
    reset,
    resetAll,
    open,
    close,
    dispose,
    registerTab(tab, index) {
      addTab(tab, index)
    },
    unregisterTab(tabId) {
      const index = tabs.findIndex((tab) => tab.id === tabId)
      if (index < 0) return
      const tab = tabs[index]
      if (!tab) return
      for (const group of tab.groups) {
        for (const field of group.fields) {
          delete values[field.key]
          defaults.delete(field.key)
        }
      }
      tabs.splice(index, 1)
    },
    registerGroup(tabId, group, index) {
      addGroup(tabId, group, index)
    },
    unregisterGroup(tabId, groupId) {
      const tab = findTab(tabId)
      if (!tab) return
      const index = tab.groups.findIndex((group) => group.id === groupId)
      if (index < 0) return
      const [group] = tab.groups.splice(index, 1)
      for (const field of group?.fields ?? []) {
        delete values[field.key]
        defaults.delete(field.key)
      }
    },
    registerField(tabId, groupId, field, index) {
      addField(tabId, groupId, field, index)
    },
    updateField(key, patch) {
      const field = findField(key)
      if (!field) return
      Object.assign(field, patch)
      if (patch.default !== undefined && field.type !== 'action') {
        defaults.set(key, cloneValue(patch.default))
      }
    },
    removeField,
    getField: findField,
    hasTab(tabId) {
      return findTab(tabId) !== undefined
    }
  }

  return controller
}
