import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, the frontend runs on its own Vite port while the backend
    // listens on 3000; in production the backend serves the built frontend
    // directly from the same origin, so no proxy is needed there.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
