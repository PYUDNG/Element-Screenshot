import {
  createI18n,
  createLocalStorageStorage,
  createSettings,
  type LocaleDefinition
} from '../src/auto'

const zhCN: LocaleDefinition = {
  code: 'zh-CN',
  label: '简体中文',
  messages: {
    demo: {
      tab: {
        capture: '截图',
        advanced: '高级'
      },
      group: {
        basics: '基础',
        output: '输出',
        rules: '站点规则',
        extra: '动态设置项'
      },
      field: {
        shortcut: '触发快捷键',
        shortcutDesc: '在任意页面按下的组合键。',
        borderColor: '边框颜色',
        borderWidth: '边框粗细',
        expandNested: '展开内部滚动区域',
        expandNestedDesc: '截图时递归展开元素内部可滚动区域。',
        scale: '导出倍率',
        background: '背景颜色',
        include: '仅在这些网站运行',
        exclude: '不在这些网站运行',
        includeDesc: '每行一条。支持 example.com、https://*.example.com/* 或 /正则/。',
        extra: '动态添加的设置项'
      }
    }
  }
}

const zhTW: LocaleDefinition = {
  code: 'zh-TW',
  label: '繁體中文',
  messages: {
    demo: {
      tab: {
        capture: '截圖',
        advanced: '進階'
      },
      group: {
        basics: '基本',
        output: '輸出',
        rules: '網站規則',
        extra: '動態設定項目'
      },
      field: {
        shortcut: '觸發快速鍵',
        shortcutDesc: '在任何頁面按下的組合鍵。',
        borderColor: '邊框顏色',
        borderWidth: '邊框粗細',
        expandNested: '展開內部捲動區域',
        expandNestedDesc: '截圖時遞迴展開元素內部可捲動區域。',
        scale: '匯出倍率',
        background: '背景顏色',
        include: '僅在這些網站執行',
        exclude: '不在這些網站執行',
        includeDesc: '每行一條。支援 example.com、https://*.example.com/* 或 /正規表達式/。',
        extra: '動態新增的設定項目'
      }
    }
  }
}

const en: LocaleDefinition = {
  code: 'en',
  label: 'English',
  messages: {
    demo: {
      tab: {
        capture: 'Capture',
        advanced: 'Advanced'
      },
      group: {
        basics: 'Basics',
        output: 'Output',
        rules: 'Site rules',
        extra: 'Dynamic fields'
      },
      field: {
        shortcut: 'Trigger shortcut',
        shortcutDesc: 'Key combination pressed on any page.',
        borderColor: 'Border color',
        borderWidth: 'Border width',
        expandNested: 'Expand nested scroll areas',
        expandNestedDesc: 'Recursively expand scrollable descendants while capturing.',
        scale: 'Export scale',
        background: 'Background color',
        include: 'Only run on these sites',
        exclude: 'Never run on these sites',
        includeDesc: 'One rule per line. Supports example.com, https://*.example.com/* or /regex/.',
        extra: 'Dynamically added field'
      }
    }
  }
}

const i18n = createI18n({
  defaultLocale: 'zh-CN',
  fallbackLocale: 'en',
  locales: [zhCN, zhTW, en]
})

const settings = createSettings({
  i18n,
  version: '0.1.0',
  links: [
    {
      id: 'github',
      label: 'GitHub',
      href: 'https://github.com/PYUDNG/Element-Screenshot',
      icon: 'github'
    },
    {
      id: 'greasyfork',
      label: 'Greasyfork',
      href: 'https://greasyfork.org/scripts/604334',
      icon: 'greasyfork'
    }
  ],
  storage: createLocalStorageStorage('userscript-settings-demo:'),
  storageKey: 'values',
  tabs: [
    {
      id: 'capture',
      title: 'demo.tab.capture',
      icon: 'camera',
      groups: [
        {
          id: 'basics',
          title: 'demo.group.basics',
          defaultOpen: true,
          fields: [
            {
              type: 'shortcut',
              key: 'shortcut',
              label: 'demo.field.shortcut',
              description: 'demo.field.shortcutDesc',
              default: 'Alt+Shift+S'
            },
            {
              type: 'color',
              key: 'borderColor',
              label: 'demo.field.borderColor',
              default: '#2563eb',
              swatches: ['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#18181b']
            },
            {
              type: 'range',
              key: 'borderWidth',
              label: 'demo.field.borderWidth',
              default: 2,
              min: 1,
              max: 8,
              step: 1,
              unit: 'px'
            },
            {
              type: 'switch',
              key: 'expandNested',
              label: 'demo.field.expandNested',
              description: 'demo.field.expandNestedDesc',
              default: true
            }
          ]
        },
        {
          id: 'output',
          title: 'demo.group.output',
          fields: [
            {
              type: 'select',
              key: 'scale',
              label: 'demo.field.scale',
              default: '2',
              options: [
                { value: '1', label: '1×' },
                { value: '2', label: '2×' },
                { value: '3', label: '3×' }
              ]
            },
            {
              type: 'color',
              key: 'background',
              label: 'demo.field.background',
              default: '#ffffff'
            }
          ]
        }
      ]
    },
    {
      id: 'advanced',
      title: 'demo.tab.advanced',
      icon: 'settings',
      groups: [
        {
          id: 'rules',
          title: 'demo.group.rules',
          fields: [
            {
              type: 'list',
              key: 'include',
              label: 'demo.field.include',
              description: 'demo.field.includeDesc',
              default: [],
              placeholder: 'example.com'
            },
            {
              type: 'list',
              key: 'exclude',
              label: 'demo.field.exclude',
              default: [],
              placeholder: '*.example.com'
            }
          ]
        },
        {
          id: 'extra',
          title: 'demo.group.extra',
          fields: []
        }
      ]
    }
  ]
})

let extraIndex = 0

document.querySelector<HTMLButtonElement>('#open')?.addEventListener('click', () => settings.open())

document.querySelector<HTMLButtonElement>('#add')?.addEventListener('click', () => {
  extraIndex += 1
  settings.registerField('advanced', 'extra', {
    type: 'text',
    key: `extra${extraIndex}`,
    label: 'demo.field.extra',
    default: `value ${extraIndex}`
  })
})

document.querySelector<HTMLButtonElement>('#remove')?.addEventListener('click', () => {
  if (extraIndex <= 0) return
  settings.removeField(`extra${extraIndex}`)
  extraIndex -= 1
})

declare global {
  interface Window {
    __settings: typeof settings
  }
}

window.__settings = settings
