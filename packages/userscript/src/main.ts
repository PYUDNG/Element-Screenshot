import { native } from './core/native'
import { watch } from 'vue'
import {
  GM_deleteValue,
  GM_getValue,
  GM_info,
  GM_registerMenuCommand,
  GM_setValue,
  GM_unregisterMenuCommand
} from '$'
import {
  DEFAULT_SHORTCUT,
  createGMStorage,
  createI18n,
  createSettings
} from '@element-screenshot/settings'
import type { SettingsController } from '@element-screenshot/settings'
import cssText from './styles.css?inline'
import { appMessages } from './messages'
import { createSettingsTabs } from './config/schema'
import { installHotkey } from './core/hotkey'
import { enableSiteForUrl, isSiteEnabled } from './core/site-policy'
import { createShotApp } from './ui/shot-app'
import type { ShotApp } from './ui/shot-app'

const i18n = createI18n({
  defaultLocale: 'zh-CN',
  fallbackLocale: 'en',
  locales: appMessages
})

const storage = createGMStorage(
  {
    getValue: (key, defaultValue) => GM_getValue<string | null>(key, defaultValue),
    setValue: (key, value) => GM_setValue(key, value),
    deleteValue: (key) => GM_deleteValue(key)
  },
  'element-screenshot:'
)

const settings: SettingsController = createSettings({
  i18n,
  storage,
  storageKey: 'settings',
  styles: cssText,
  version: GM_info?.script?.version ?? '0.1.0',
  tabs: createSettingsTabs()
})

let shot: ShotApp | null = null
let menuIds: Array<string | number> = []

const t = (key: string): string => i18n.t(key)

settings.registerField('trigger', 'fab', {
  type: 'action',
  key: 'trigger.resetFab',
  label: 'app.field.resetFab',
  description: 'app.field.resetFabDesc',
  icon: 'reset',
  action: () => {
    settings.set('trigger.fabX', 1)
    settings.set('trigger.fabY', 1)
    shot?.repositionFab()
  }
})

function readList(key: string): string[] {
  const value = settings.get(key)
  return Array.isArray(value) ? value : []
}

function mountUi(): void {
  if (shot) return
  shot = createShotApp({ settings, i18n, styles: cssText })
  shot.mount()
  installHotkey({
    getShortcut: () => String(settings.get('capture.shortcut') ?? DEFAULT_SHORTCUT),
    shouldIgnore: () => settings.isOpen.value || shot?.state.mode !== 'idle',
    onTrigger: () => shot?.startPicker()
  })
}

function registerMenus(): void {
  for (const id of menuIds) {
    try {
      GM_unregisterMenuCommand(id)
    } catch {
      // Some managers do not implement unregister; stale labels are harmless.
    }
  }
  menuIds = []

  const add = (label: string, onClick: () => void): void => {
    try {
      const id = GM_registerMenuCommand(label, onClick)
      if (typeof id === 'string' || typeof id === 'number') menuIds.push(id)
    } catch (error) {
      console.error('[element-screenshot] menu registration failed', error)
    }
  }

  if (shot) {
    add(t('app.menu.capture'), () => shot?.startPicker())
    add(t('app.menu.settings'), () => {
      shot?.cancel()
      settings.open()
    })
  } else {
    add(t('app.menu.settings'), () => settings.open())
    add(t('app.menu.enableHere'), enableHere)
  }
}

function enableHere(): void {
  const policy = enableSiteForUrl(location.href, readList('site.include'), readList('site.exclude'))
  settings.set('site.include', policy.include)
  settings.set('site.exclude', policy.exclude)
  mountUi()
  registerMenus()
  shot?.toast('app.toast.enabledHere', 'success')
}

function boot(): void {
  const enabled = isSiteEnabled(location.href, readList('site.include'), readList('site.exclude'))
  if (enabled) mountUi()
  registerMenus()
  watch(
    () => i18n.resolvedLocale.value,
    () => registerMenus()
  )
}

function start(): void {
  try {
    boot()
  } catch (error) {
    console.error('[element-screenshot] failed to start', error)
  }
}

if (document.readyState === 'loading') {
  native.addEventListener(document, 'DOMContentLoaded', start, { once: true })
} else {
  start()
}
