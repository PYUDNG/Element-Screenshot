import type { LocaleDefinition } from '@element-screenshot/settings'

const zhCN: LocaleDefinition = {
  code: 'zh-CN',
  label: '简体中文',
  messages: {
    app: {
      menu: {
        capture: '截图元素',
        settings: '设置',
        enableHere: '在此站点启用'
      },
      tab: {
        capture: '截图',
        trigger: '触发',
        sites: '站点'
      },
      group: {
        trigger: '触发方式',
        picker: '选择交互',
        frame: '选框外观',
        output: '输出',
        fab: '悬浮按钮',
        rules: '加载策略'
      },
      field: {
        shortcut: '触发快捷键',
        shortcutDesc: '在任意页面按下该组合键即可进入元素选择模式。',
        pointerIsolation: '隔离页面交互',
        pointerIsolationDesc:
          '选择元素时用透明层拦截鼠标事件，避免页面 hover 或点击效果进入截图。关闭后可截取 hover 状态。',
        borderColor: '边框颜色',
        borderColorDesc: '预选元素时边框的颜色。',
        borderWidth: '边框粗细',
        borderWidthDesc: '预选元素时边框的像素宽度。',
        scale: '导出倍率',
        scaleDesc: '自动模式按设备像素比渲染，超出画布上限时会自动缩小。',
        scaleAuto: '自动',
        backgroundAuto: '跟随页面背景',
        backgroundAutoDesc: '自动读取元素背后的页面背景色，避免导出图片与页面实际颜色不一致。',
        background: '背景颜色',
        backgroundDesc: '关闭“跟随页面背景”后使用的填充色。',
        transparent: '透明背景',
        transparentDesc: '导出透明 PNG，并忽略背景颜色设置。',
        expandNested: '展开内部滚动区域',
        expandNestedDesc: '截图时递归展开元素内部可滚动的子区域，获取完整内容。',
        fabShow: '显示悬浮按钮',
        fabShowDesc: '在页面边缘显示可拖动的截图按钮。',
        fabSize: '悬浮按钮尺寸',
        fabSizeDesc: '按钮的直径，单位为像素。',
        fabPosition: '悬浮按钮位置',
        resetFab: '重置悬浮按钮位置',
        resetFabDesc: '把按钮移回右下角。',
        include: '仅在这些网站运行',
        includeDesc:
          '留空表示所有网站。每行一条规则，支持 example.com、*.example.com、https://example.com/* 或 /正则/。',
        exclude: '不在这些网站运行',
        excludeDesc: '匹配的网站不会加载脚本界面，规则格式同上。',
        placeholderHost: 'example.com',
        placeholderUrl: 'https://*.example.com/*'
      },
      hint: {
        pickTitle: '选择元素',
        pick: '滚轮或 + / − 切换层级 · 拖动框选区域 · Ctrl+A 整页 · Esc 退出',
        region: '松开鼠标截取所选区域',
        selected: 'Ctrl+C 复制 · Ctrl+S 或双击保存 · Esc 关闭',
        rendering: '正在渲染…',
        renderingNote: '可以继续使用页面，完成后会弹出结果',
        ready: '已就绪',
        failed: '渲染失败',
        fullPage: '整页',
        scrollable: '含滚动内容',
        shallower: '选择外层元素',
        deeper: '选择内层元素',
        esc: 'Esc 关闭'
      },
      action: {
        copy: '复制',
        save: '保存',
        close: '关闭',
        cancel: '取消'
      },
      toast: {
        copied: '截图已复制到剪贴板',
        copyFailed: '复制失败，请改用保存',
        saved: '截图已保存',
        saveFailed: '保存失败',
        captureFailed: '截图渲染失败',
        captureFailedDetail: '截图渲染失败：{reason}',
        notReady: '截图尚未完成',
        downscaled: '页面过大，已自动降低导出倍率',
        enabledHere: '已为当前站点启用'
      },
      site: {
        invalidRule: '规则格式无效'
      },
      fab: {
        label: '截图元素'
      }
    }
  }
}

const zhTW: LocaleDefinition = {
  code: 'zh-TW',
  label: '繁體中文',
  messages: {
    app: {
      menu: {
        capture: '截圖元素',
        settings: '設定',
        enableHere: '在此站點啟用'
      },
      tab: {
        capture: '截圖',
        trigger: '觸發',
        sites: '站點'
      },
      group: {
        trigger: '觸發方式',
        picker: '選擇互動',
        frame: '選框外觀',
        output: '輸出',
        fab: '懸浮按鈕',
        rules: '載入策略'
      },
      field: {
        shortcut: '觸發快速鍵',
        shortcutDesc: '在任何頁面按下此組合鍵即可進入元素選擇模式。',
        pointerIsolation: '隔離頁面互動',
        pointerIsolationDesc:
          '選擇元素時用透明層攔截滑鼠事件，避免頁面 hover 或點擊效果進入截圖。關閉後可截取 hover 狀態。',
        borderColor: '邊框顏色',
        borderColorDesc: '預選元素時邊框的顏色。',
        borderWidth: '邊框粗細',
        borderWidthDesc: '預選元素時邊框的像素寬度。',
        scale: '匯出倍率',
        scaleDesc: '自動模式依裝置像素比渲染，超出畫布上限時會自動縮小。',
        scaleAuto: '自動',
        backgroundAuto: '跟隨頁面背景',
        backgroundAutoDesc: '自動讀取元素背後的頁面背景色，避免匯出圖片與頁面實際顏色不一致。',
        background: '背景顏色',
        backgroundDesc: '關閉「跟隨頁面背景」後使用的填色。',
        transparent: '透明背景',
        transparentDesc: '匯出透明 PNG，並忽略背景顏色設定。',
        expandNested: '展開內部捲動區域',
        expandNestedDesc: '截圖時遞迴展開元素內部可捲動的子區域，取得完整內容。',
        fabShow: '顯示懸浮按鈕',
        fabShowDesc: '在頁面邊緣顯示可拖曳的截圖按鈕。',
        fabSize: '懸浮按鈕尺寸',
        fabSizeDesc: '按鈕的直徑，單位為像素。',
        fabPosition: '懸浮按鈕位置',
        resetFab: '重設懸浮按鈕位置',
        resetFabDesc: '將按鈕移回右下角。',
        include: '僅在這些網站執行',
        includeDesc:
          '留空表示所有網站。每行一條規則，支援 example.com、*.example.com、https://example.com/* 或 /正規表達式/。',
        exclude: '不在這些網站執行',
        excludeDesc: '符合的網站不會載入腳本介面，規則格式同上。',
        placeholderHost: 'example.com',
        placeholderUrl: 'https://*.example.com/*'
      },
      hint: {
        pickTitle: '選擇元素',
        pick: '滾輪或 + / − 切換層級 · 拖曳框選區域 · Ctrl+A 整頁 · Esc 離開',
        region: '放開滑鼠截取所選區域',
        selected: 'Ctrl+C 複製 · Ctrl+S 或雙擊儲存 · Esc 關閉',
        rendering: '正在轉譯…',
        renderingNote: '可以繼續使用頁面，完成後會彈出結果',
        ready: '已就緒',
        failed: '轉譯失敗',
        fullPage: '整頁',
        scrollable: '含捲動內容',
        shallower: '選擇外層元素',
        deeper: '選擇內層元素',
        esc: 'Esc 關閉'
      },
      action: {
        copy: '複製',
        save: '儲存',
        close: '關閉',
        cancel: '取消'
      },
      toast: {
        copied: '截圖已複製到剪貼簿',
        copyFailed: '複製失敗，請改用儲存',
        saved: '截圖已儲存',
        saveFailed: '儲存失敗',
        captureFailed: '截圖轉譯失敗',
        captureFailedDetail: '截圖轉譯失敗：{reason}',
        notReady: '截圖尚未完成',
        downscaled: '頁面過大，已自動降低匯出倍率',
        enabledHere: '已為目前站點啟用'
      },
      site: {
        invalidRule: '規則格式無效'
      },
      fab: {
        label: '截圖元素'
      }
    }
  }
}

const en: LocaleDefinition = {
  code: 'en',
  label: 'English',
  messages: {
    app: {
      menu: {
        capture: 'Capture element',
        settings: 'Settings',
        enableHere: 'Enable on this site'
      },
      tab: {
        capture: 'Capture',
        trigger: 'Trigger',
        sites: 'Sites'
      },
      group: {
        trigger: 'Trigger',
        picker: 'Picker interaction',
        frame: 'Selection frame',
        output: 'Output',
        fab: 'Floating button',
        rules: 'Loading policy'
      },
      field: {
        shortcut: 'Trigger shortcut',
        shortcutDesc: 'Press this combination on any page to start picking an element.',
        pointerIsolation: 'Isolate page interaction',
        pointerIsolationDesc:
          'Intercept pointer events with a transparent layer while picking, so hover and click effects do not leak into the capture. Turn off to capture hover states.',
        borderColor: 'Border color',
        borderColorDesc: 'Color of the frame shown while picking.',
        borderWidth: 'Border width',
        borderWidthDesc: 'Frame width in pixels.',
        scale: 'Export scale',
        scaleDesc:
          'Auto uses the device pixel ratio and downscales automatically when the canvas limit is reached.',
        scaleAuto: 'Auto',
        backgroundAuto: 'Match page background',
        backgroundAutoDesc:
          'Sample the page color behind the element so exports match what you see.',
        background: 'Background color',
        backgroundDesc: 'Fill color used when “Match page background” is off.',
        transparent: 'Transparent background',
        transparentDesc: 'Export a transparent PNG and ignore the background color.',
        expandNested: 'Expand nested scroll areas',
        expandNestedDesc:
          'Recursively expand scrollable descendants so the capture contains their full content.',
        fabShow: 'Show floating button',
        fabShowDesc: 'Show a draggable capture button at the edge of the page.',
        fabSize: 'Floating button size',
        fabSizeDesc: 'Button diameter in pixels.',
        fabPosition: 'Floating button position',
        resetFab: 'Reset floating button position',
        resetFabDesc: 'Move the button back to the bottom-right corner.',
        include: 'Only run on these sites',
        includeDesc:
          'Leave empty to run everywhere. One rule per line: example.com, *.example.com, https://example.com/* or /regex/.',
        exclude: 'Never run on these sites',
        excludeDesc: 'Matching sites do not load the UI. Same rule formats as above.',
        placeholderHost: 'example.com',
        placeholderUrl: 'https://*.example.com/*'
      },
      hint: {
        pickTitle: 'Pick an element',
        pick: 'Wheel or + / − to change layer · Drag to select a region · Ctrl+A full page · Esc to exit',
        region: 'Release to capture the selected region',
        selected: 'Ctrl+C to copy · Ctrl+S or double-click to save · Esc to close',
        rendering: 'Rendering…',
        renderingNote: 'Keep using the page — the result opens when it is done',
        ready: 'Ready',
        failed: 'Render failed',
        fullPage: 'Full page',
        scrollable: 'Scrollable',
        shallower: 'Select outer element',
        deeper: 'Select inner element',
        esc: 'Esc to close'
      },
      action: {
        copy: 'Copy',
        save: 'Save',
        close: 'Close',
        cancel: 'Cancel'
      },
      toast: {
        copied: 'Screenshot copied to clipboard',
        copyFailed: 'Copy failed — use Save instead',
        saved: 'Screenshot saved',
        saveFailed: 'Save failed',
        captureFailed: 'Screenshot rendering failed',
        captureFailedDetail: 'Screenshot rendering failed: {reason}',
        notReady: 'Screenshot is not ready yet',
        downscaled: 'Page is very large; export scale was reduced',
        enabledHere: 'Enabled for this site'
      },
      site: {
        invalidRule: 'Invalid rule'
      },
      fab: {
        label: 'Capture element'
      }
    }
  }
}

export const appMessages: LocaleDefinition[] = [zhCN, zhTW, en]
