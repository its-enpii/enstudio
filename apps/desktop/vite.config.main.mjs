import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  configFile: false,
  define: {
    // Mirror the production-side `process.env` access pattern so vite bakes
    // the dev server URL into the bundle at build time. The renderer uses
    // `process.env.VITE_DEV_SERVER_URL` to decide whether to load from
    // localhost:5173 (dev) or the bundled dist/index.html (prod).
    'process.env.VITE_DEV_SERVER_URL': JSON.stringify(process.env.VITE_DEV_SERVER_URL ?? ''),
    // IMPORTANT: do NOT define `process.env` itself — Vite would replace
    // every `process.env.X` access with `undefined.X`, breaking runtime
    // PATH/ComSpec reads that the worker needs to spawn cmd.exe.
  },
  build: {
    outDir: 'dist-electron',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'electron/main.ts'),
      external: ['electron', 'node-pty', /^node:/],
      output: {
        format: 'cjs',
        entryFileNames: 'main.cjs',
        inlineDynamicImports: true,
      },
    },
  },
})