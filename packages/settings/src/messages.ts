import type { I18n, LocaleDefinition } from './i18n'

const zhCN: LocaleDefinition = {
  code: 'zh-CN',
  label: '简体中文',
  messages: {
    settings: {
      title: '设置',
      searchPlaceholder: '搜索设置…',
      searchClear: '清除搜索',
      noResults: '没有匹配的设置项',
      close: '关闭',
      tablist: '设置分类',
      version: '版本 {version}',
      footerHint: 'Esc 关闭 · Ctrl+F 搜索',
      reset: '重置',
      confirm: '再次点击确认',
      builtin: {
        tab: '通用',
        appearance: '外观',
        language: '界面语言',
        languageDescription: '选择设置面板的显示语言，自动模式跟随浏览器。',
        theme: '主题',
        themeDescription: '仅影响脚本界面，不会修改当前网页。',
        themeAuto: '自动',
        themeLight: '浅色',
        themeDark: '深色',
        localeAuto: '自动（跟随浏览器）',
        reset: '重置',
        resetDescription: '把所有设置项恢复为默认值。',
        resetAction: '恢复默认设置'
      },
      shortcut: {
        empty: '未设置',
        recording: '请按下组合键…',
        hint: '需包含 Ctrl / Alt / Meta，或使用 F1–F12',
        invalid: '无法使用该组合键',
        clear: '清除快捷键'
      },
      list: {
        empty: '暂无条目',
        add: '添加',
        remove: '删除条目'
      },
      field: {
        invalid: '格式无效'
      }
    }
  }
}

const zhTW: LocaleDefinition = {
  code: 'zh-TW',
  label: '繁體中文',
  messages: {
    settings: {
      title: '設定',
      searchPlaceholder: '搜尋設定…',
      searchClear: '清除搜尋',
      noResults: '沒有符合的設定項目',
      close: '關閉',
      tablist: '設定分類',
      version: '版本 {version}',
      footerHint: 'Esc 關閉 · Ctrl+F 搜尋',
      reset: '重設',
      confirm: '再次點擊確認',
      builtin: {
        tab: '一般',
        appearance: '外觀',
        language: '介面語言',
        languageDescription: '選擇設定面板的顯示語言，自動模式跟隨瀏覽器。',
        theme: '主題',
        themeDescription: '僅影響腳本介面，不會修改目前網頁。',
        themeAuto: '自動',
        themeLight: '淺色',
        themeDark: '深色',
        localeAuto: '自動（跟隨瀏覽器）',
        reset: '重設',
        resetDescription: '將所有設定項目還原為預設值。',
        resetAction: '還原預設設定'
      },
      shortcut: {
        empty: '未設定',
        recording: '請按下組合鍵…',
        hint: '需包含 Ctrl / Alt / Meta，或使用 F1–F12',
        invalid: '無法使用此組合鍵',
        clear: '清除快速鍵'
      },
      list: {
        empty: '尚無項目',
        add: '新增',
        remove: '刪除項目'
      },
      field: {
        invalid: '格式無效'
      }
    }
  }
}

const en: LocaleDefinition = {
  code: 'en',
  label: 'English',
  messages: {
    settings: {
      title: 'Settings',
      searchPlaceholder: 'Search settings…',
      searchClear: 'Clear search',
      noResults: 'No matching settings',
      close: 'Close',
      tablist: 'Settings sections',
      version: 'Version {version}',
      footerHint: 'Esc to close · Ctrl+F to search',
      reset: 'Reset',
      confirm: 'Click again to confirm',
      builtin: {
        tab: 'General',
        appearance: 'Appearance',
        language: 'Language',
        languageDescription: 'Language of the settings panel. Auto follows your browser.',
        theme: 'Theme',
        themeDescription: 'Affects the script UI only, never the page itself.',
        themeAuto: 'Auto',
        themeLight: 'Light',
        themeDark: 'Dark',
        localeAuto: 'Auto (follow browser)',
        reset: 'Reset',
        resetDescription: 'Restore every setting to its default value.',
        resetAction: 'Restore defaults'
      },
      shortcut: {
        empty: 'Not set',
        recording: 'Press a key combination…',
        hint: 'Include Ctrl / Alt / Meta, or use F1–F12',
        invalid: 'That combination cannot be used',
        clear: 'Clear shortcut'
      },
      list: {
        empty: 'No entries yet',
        add: 'Add',
        remove: 'Remove entry'
      },
      field: {
        invalid: 'Invalid format'
      }
    }
  }
}

export const settingsMessages: LocaleDefinition[] = [zhCN, zhTW, en]

/** Merge the built-in settings translations into a shared i18n instance. */
export function registerSettingsMessages(i18n: I18n): void {
  for (const locale of settingsMessages) {
    i18n.registerLocale(locale)
  }
}
