import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig(({ mode }) => {
  const iife = mode === 'iife'

  return {
    define: {
      'process.env.NODE_ENV': JSON.stringify('production')
    },
    plugins: [
      vue(),
      tailwindcss(),
      ...(iife
        ? []
        : [
            dts({
              tsconfigPath: './tsconfig.build.json',
              include: ['src/**/*.ts', 'src/**/*.vue'],
              exclude: ['src/**/*.test.ts'],
              outDirs: 'dist'
            })
          ])
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    },
    build: {
      target: 'es2022',
      outDir: iife ? 'dist/iife' : 'dist',
      emptyOutDir: !iife,
      cssCodeSplit: false,
      lib: iife
        ? {
            entry: 'src/iife.ts',
            name: 'UserscriptSettings',
            formats: ['iife'],
            fileName: () => 'userscript-settings.iife.js'
          }
        : {
            entry: {
              index: 'src/index.ts',
              auto: 'src/auto.ts'
            },
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.mjs`
          },
      rollupOptions: iife
        ? {}
        : {
            external: ['vue']
          }
    }
  }
})
