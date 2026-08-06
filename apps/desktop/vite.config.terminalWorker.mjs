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
      input: path.resolve(__dirname, 'electron/terminal/terminalWorker.ts'),
      external: ['electron', 'node-pty', /^node:/],
      output: {
        format: 'cjs',
        entryFileNames: 'terminalWorker.cjs',
        inlineDynamicImports: true,
      },
    },
  },
})