import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import laramod from 'laramod-vite-plugin'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    // Wraps laravel-vite-plugin: the modules `php artisan laramod:vite` reports get their
    // entries built, an `@<module>` alias and a page reload when their routes change.
    laramod({
      input: ['react-app/src/main.tsx'],
      refresh: true,
      buildDirectory: 'dist', // public/dist, served from /dist/
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./react-app/src', import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Bootstrap 5 is written with @import; keep Sass's deprecation notices about it quiet.
        quietDeps: true,
        silenceDeprecations: ['import'],
      },
    },
  },
})
