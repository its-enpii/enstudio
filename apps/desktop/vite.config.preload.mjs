import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  configFile: false,
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'electron/preload.ts'),
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'preload.cjs',
        inlineDynamicImports: true,
      },
    },
  },
})
