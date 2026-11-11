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
  createDomain,
  createI18n,
  createSettings
} from '@element-screenshot/settings'
import cssText from './styles.css?inline'
import { appMessages } from './messages'
import { projectLinks } from './config/links'
import { createSettingsTabs } from './config/schema'
import { SETTINGS_DOMAIN_KEY, SETTINGS_STEPS } from './config/migrate'
import { native } from './core/native'
import { installHotkey } from './core/hotkey'
import { installHotkeyBridge } from './core/hotkey-bridge'
import { enableSiteForUrl, isSiteEnabled } from './core/site-policy'
import { createShotApp, UI_ROOT_ATTRIBUTE } from './ui/shot-app'
import type { ShotApp } from './ui/shot-app'

/** The capture UI lives in the top document; frames only run a helper. */
export function startApp(): void {
  const i18n = createI18n({
    defaultLocale: 'zh-CN',
    fallbackLocale: 'en',
    locales: appMessages
  })

  const GM_PREFIX = 'element-screenshot:'

  // Settings live in a versioned envelope (`{ version, value }`), so the schema
  // generation and the payload are one manager value: a write can never leave
  // data without its version, and a rename can never be applied twice.
  const settingsDomain = createDomain({
    key: SETTINGS_DOMAIN_KEY,
    steps: SETTINGS_STEPS,
    storage: {
      getValue: (key) => GM_getValue<unknown>(GM_PREFIX + key, null),
      setValue: (key, value) => GM_setValue(GM_PREFIX + key, value),
      deleteValue: (key) => GM_deleteValue(GM_PREFIX + key)
    },
    onWarn: (message, error) => console.warn(`[element-screenshot] ${message}`, error)
  })

  const settings = createSettings({
    i18n,
    storage: settingsDomain.storage,
    storageKey: SETTINGS_DOMAIN_KEY,
    styles: cssText,
    version: GM_info?.script?.version ?? '0.1.0',
    links: projectLinks,
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
      settings.set('trigger.fabDock', '')
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
    // A second copy of the script (two installs, or a local build injected next to
    // the manager's copy) would open a second UI and both would fight over the
    // same pointer events. The first one to mount wins.
    if (native.document.querySelector(`[${UI_ROOT_ATTRIBUTE}]`)) {
      console.info('[element-screenshot] another instance is already running; skipping')
      return
    }
    shot = createShotApp({ settings, i18n, styles: cssText })
    shot.mount()
    const shortcut = (): string => String(settings.get('capture.shortcut') ?? DEFAULT_SHORTCUT)
    installHotkey({
      getShortcut: shortcut,
      shouldIgnore: () => settings.isOpen.value || shot?.state.mode !== 'idle',
      onTrigger: () => shot?.startPicker()
    })
    // Frames run their own copy of the script; they cannot read these settings,
    // so hand them the shortcut and accept the presses they report back.
    const bridge = installHotkeyBridge({
      getShortcut: shortcut,
      shouldIgnore: () => settings.isOpen.value || shot?.state.mode !== 'idle',
      onTrigger: () => shot?.startPicker(),
      onKey: (stroke) => shot?.handleRelayedKey(stroke)
    })
    watch(shortcut, () => bridge.broadcast())
    // Let frames know while the picker owns the keyboard, so they can report Esc
    // and the layer keys without us having to steal the focus from them.
    watch(
      () => shot?.state.mode ?? 'idle',
      (mode) => bridge.setActive(mode === 'picking')
    )
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
    const policy = enableSiteForUrl(
      location.href,
      readList('site.include'),
      readList('site.exclude')
    )
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

  try {
    boot()
  } catch (error) {
    console.error('[element-screenshot] failed to start', error)
  }
}
