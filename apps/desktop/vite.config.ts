import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  optimizeDeps: {
    force: true,
    include: [
      '@codemirror/commands',
      '@codemirror/search',
      '@codemirror/state',
      '@codemirror/view',
    ],
  },
  plugins: [
    tailwindcss(),
    svelte(),
  ],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const language = id.match(/node_modules\/@codemirror\/lang-([^/]+)/)?.[1]
          if (language) return `language-${language}`
          if (id.includes('node_modules/@codemirror/') || id.includes('node_modules/@lezer/')) return 'editor'
          if (id.includes('node_modules/@xterm/')) return 'terminal'
          if (id.includes('node_modules/svelte/')) return 'svelte'
        },
      },
    },
  },
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, 'src/lib'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})