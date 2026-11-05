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
    gmFetchPlugin(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Element Shot',
        namespace: 'https://github.com/element-shot/element-shot',
        version: pkg.version,
        description:
          'Capture any page element, including its full scrollable content. Screenshot picker with layered element selection, copy and save.',
        author: 'Element Shot contributors',
        match: ['*://*/*'],
        'run-at': 'document-idle',
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
        fileName: 'element-shot.user.js',
        metaFileName: true
      },
      server: {
        open: false
      }
    })
  ],
  resolve: {
    alias: {
      '@element-shot/settings': fileURLToPath(new URL('../settings/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'virtual:gm-fetch-adapter': fileURLToPath(new URL('./src/net/gm-adapter.ts', import.meta.url))
    }
  },
  optimizeDeps: {
    exclude: ['html-to-image']
  },
  build: {
    target: 'es2020'
  }
})
