import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import prettier from 'prettier'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import monkey from 'vite-plugin-monkey'
import { gmFetchPlugin } from './src/plugin/gm-fetch-plugin.ts'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

/**
 * Tailwind's Vite plugin emits one long CSS string even when cssMinify is
 * disabled. Greasyfork rejects minified-looking bundles, so turn that string
 * into a readable array-of-lines before the userscript is written.
 */
function formatInlineCss(): Plugin {
  return {
    name: 'element-screenshot:format-inline-css',
    enforce: 'post',
    async renderChunk(code) {
      const marker = 'var styles_default = "'
      const start = code.indexOf(marker)
      if (start < 0) return null

      let index = start + marker.length
      let escaped = false
      let end = -1
      for (; index < code.length; index += 1) {
        const char = code[index]
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '"') {
          end = index
          break
        }
      }
      if (end < 0) throw new Error('Could not parse the inlined Tailwind CSS string')

      const css = JSON.parse(code.slice(start + marker.length - 1, end + 1)) as string
      const formatted = (await prettier.format(css, { parser: 'css' })).replace(/\n$/, '')
      const lines = formatted.split('\n').map((line) => `  ${JSON.stringify(line)}`)
      const replacement = `var styles_default = [\n${lines.join(',\n')}\n].join("\\n");`
      const statementEnd = code.indexOf(';', end)
      if (statementEnd < 0) throw new Error('Could not find the end of the CSS assignment')
      return {
        code: `${code.slice(0, start)}${replacement}${code.slice(statementEnd + 1)}`,
        map: null
      }
    }
  }
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
    }),
    formatInlineCss()
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
    target: 'es2020',
    minify: false,
    cssMinify: false,
    rollupOptions: {
      output: {
        banner:
          '/*! Bundled libraries: Vue 3.5.44 (MIT), html-to-image 1.11.13 (MIT), Tailwind CSS 4.3.4 (MIT) */'
      }
    }
  }
})
