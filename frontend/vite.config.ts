import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev only: where `npm run dev` proxies the API (EDK_BACKEND overrides, e.g. for a test server).
const BACKEND = process.env.EDK_BACKEND ?? 'http://127.0.0.1:8765'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The 3D map is a lazy chunk (three.js + react-three-fiber + drei, ~1.1 MB, ~290 kB gzipped),
    // loaded only when the map is shown; the main bundle stays far below this.
    chunkSizeWarningLimit: 1400,
  },
  server: {
    proxy: {
      '/api': BACKEND,
    },
  },
})
