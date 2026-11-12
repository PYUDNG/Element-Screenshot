import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
  plugins: [
    dts({
      tsconfigPath: './tsconfig.build.json',
      include: ['src/**/*.ts'],
      outDirs: 'dist'
    })
  ],
  build: {
    target: 'es2022',
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'index.mjs'
    }
  }
})
