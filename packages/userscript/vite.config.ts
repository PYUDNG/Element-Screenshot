import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import monkey from 'vite-plugin-monkey'
import { gmFetchPlugin } from './src/plugin/gm-fetch-plugin.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    gmFetchPlugin({
      nativeAdapter: 'virtual:element-screenshot-native-adapter'
    }),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: {
          '': 'Element Screenshot',
          'zh-CN': '网页元素截图',
          'zh-TW': '網頁元素截圖'
        },
        namespace: 'https://github.com/PYUDNG/Element-Screenshot',
        version: pkg.version,
        description: {
          '': 'Capture any page element, including its full scrollable content. Full-page and element screenshots with layered picking, copy and save.',
          'zh-CN':
            '完整截取网页中的任意元素，包括被滚动隐藏的内容；支持层级选择、长截图、复制与保存。',
          'zh-TW':
            '完整截取網頁中的任意元素，包括被捲動隱藏的內容；支援層級選擇、長截圖、複製與儲存。'
        },
        author: 'Element Screenshot contributors',
        homepageURL: 'https://github.com/PYUDNG/Element-Screenshot',
        supportURL: 'https://github.com/PYUDNG/Element-Screenshot/issues',
        match: ['*://*/*'],
        'run-at': 'document-start',
        noframes: true,
        grant: [
          'GM_xmlhttpRequest',
          'GM_registerMenuCommand',
          'GM_unregisterMenuCommand',
          'GM_getValue',
          'GM_setValue',
          'GM_deleteValue',
          'GM_info'
        ],
        connect: ['*']
      },
      build: {
        fileName: 'element-screenshot.user.js',
        metaFileName: true
      },
      server: {
        open: false
      }
    })
  ],
  resolve: {
    alias: {
      '@element-screenshot/settings': fileURLToPath(
        new URL('../settings/src/index.ts', import.meta.url)
      ),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'virtual:gm-fetch-adapter': fileURLToPath(
        new URL('./src/net/gm-adapter.ts', import.meta.url)
      ),
      'virtual:element-screenshot-native-adapter': fileURLToPath(
        new URL('./src/core/native.ts', import.meta.url)
      )
    }
  },
  optimizeDeps: {
    exclude: ['html-to-image']
  },
  build: {
    target: 'es2020'
  }
})
