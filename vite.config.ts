import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// V15.0 WS7 — porte configurabili via env (VITE_PORT, SERVER_PORT)
const VITE_PORT = Number(process.env.VITE_PORT || 3030)
const SERVER_PORT = Number(process.env.SERVER_PORT || 3031)
const API_TARGET = `http://127.0.0.1:${SERVER_PORT}`

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: VITE_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
      },
      '/events': {
        target: API_TARGET,
        changeOrigin: false,
        ws: false,
      },
      // V15.0 WS11 — PDF docs serviti dal backend
      // V15.7 WS37 — bypass per SPA navigation: solo path con estensione (.pdf/.png/.md/...)
      // vanno a Express; path "puliti" (/docs, /docs/folder/page) vengono lasciati gestire
      // a React Router (route splat docs/*). Fix bug "Cannot GET /docs/" da test e2e WS36.
      '/docs': {
        target: API_TARGET,
        changeOrigin: false,
        bypass: (req) => {
          const url = req.url || ''
          if (!/\.[a-z0-9]{2,5}(\?|$)/i.test(url)) {
            return req.url
          }
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  // V15.4 WS34: force re-optimization a ogni dev start (no cache reuse).
  // Previene NULL-byte corruption su Windows + cache stale del browser.
  // Costo: +2-5s al primo load. Beneficio: zero schermate bianche da cache corrotta.
  // Disabilitabile con VITE_FORCE_OPTIMIZE=false per debug locale.
  optimizeDeps: {
    force: process.env.VITE_FORCE_OPTIMIZE !== 'false',
  },
})
