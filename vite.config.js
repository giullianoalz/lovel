import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' registers the SW immediately and updates it silently in the
      // background — no manual "click to update" prompts needed for an internal tool.
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      // Use the manifest we already have in /public
      manifest: false,

      // Workbox config — what gets pre-cached and how network requests are handled
      workbox: {
        // Pre-cache all build output (JS chunks, CSS, index.html)
        globPatterns: ['**/*.{js,css,html,svg,png,webp,ico,woff,woff2}'],

        // Runtime caching strategies for API and assets
        runtimeCaching: [
          {
            // Backend API — Network First: always try live data, fall back to cache
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 10,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 }, // 1 day
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Google Fonts / CDN assets — Cache First (they don't change)
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },

      devOptions: {
        // Enable SW in dev mode so you can test offline behavior locally
        enabled: false,
      },
    }),
  ],
  server: {
    host: true, // listen on 0.0.0.0 so phones on the same Wi-Fi can connect
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: !!process.env.PORT, // when a specific port is assigned (e.g. sandboxed preview), fail instead of silently picking another one
  },
})

