import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@element-screenshot/settings': fileURLToPath(
        new URL('./packages/settings/src/index.ts', import.meta.url)
      ),
      '@': fileURLToPath(new URL('./packages/userscript/src', import.meta.url))
    }
  },
  test: {
    environment: 'jsdom',
    include: ['packages/*/tests/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcovonly'],
      include: ['packages/*/src/**/*.ts'],
      exclude: [
        'packages/*/src/**/*.d.ts',
        'packages/*/src/**/env.d.ts',
        'packages/settings/src/index.ts',
        'packages/settings/src/auto.ts',
        'packages/settings/src/iife.ts',
        'packages/settings/src/types.ts',
        'packages/settings/src/icons.ts',
        'packages/settings/src/messages.ts',
        'packages/userscript/src/main.ts',
        'packages/userscript/src/messages.ts',
        'packages/userscript/src/config/**',
        'packages/userscript/src/net/gm-adapter.ts',
        'packages/userscript/src/ui/api.ts',
        'packages/userscript/src/ui/shot-app.ts'
      ],
      thresholds: {
        lines: 75,
        functions: 80,
        branches: 65,
        statements: 75
      }
    }
  }
})
