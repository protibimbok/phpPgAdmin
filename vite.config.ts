import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import laramod from 'laramod-vite-plugin'
import postcssRTLCSS from 'postcss-rtlcss'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    // Wraps laravel-vite-plugin: the modules `php artisan laramod:vite` reports get their
    // entries built, an `@<module>` alias and a page reload when their routes change.
    laramod({
      input: ['src/main.tsx'],
      refresh: true,
      buildDirectory: 'dist', // public/dist, served from /dist/
    }),
    react(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  css: {
    postcss: {
      plugins: [
        // Right-to-left support the way phpMyAdmin gets it, flipping the stylesheet with rtlcss,
        // except that the flipped rules are emitted next to the originals under a [dir="rtl"]
        // prefix. The direction then follows the dir attribute on <html>, which the PHP shell
        // sets and the client updates when the locale changes, with no second stylesheet.
        // Prefixed rules gain specificity, so a flipped reset such as Bootstrap's `ol { padding-
        // left }` would outrank an unprefixed `padding` on a class; safeBothPrefix gives those
        // declarations a `[dir]` prefix of their own so the cascade stays as written.
        postcssRTLCSS({ safeBothPrefix: true }),
      ],
    },
    preprocessorOptions: {
      scss: {
        // Bootstrap 5 is written with @import; keep Sass's deprecation notices about it quiet.
        quietDeps: true,
        silenceDeprecations: ['import'],
      },
    },
  },
})
