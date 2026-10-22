import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  root: 'react-app',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./react-app/src', import.meta.url)),
    },
  },
  build: {
    outDir: '../public/dist',
    emptyOutDir: true,
  },
})
