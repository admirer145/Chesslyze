import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Set base path for GitHub Pages - change to '/Chesslyze/' if deploying to github.io/username/Chesslyze
  // Use '/' for custom domain
  base: process.env.GITHUB_PAGES ? '/Chesslyze/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.png', 'vite.svg'],
      manifest: {
        name: 'Chesslyze',
        short_name: 'Chesslyze',
        description: 'Advanced chess analytics and personalized learning platform to improve your game',
        theme_color: '#6366f1',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          {
            src: '/icon.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon.png',
            sizes: '1024x1024',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // Cache strategy for runtime
        runtimeCaching: [
          {
            // Cache static assets (JS, CSS, images)
            urlPattern: /^https?:\/\/.*\.(js|css|png|jpg|jpeg|svg|gif|webp|woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 30 * 24 * 60 * 60 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Cache Stockfish WASM files on-demand (too large for precache)
            urlPattern: /^https?:\/\/.*\.(wasm|nnue)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'stockfish-engine',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 60 * 24 * 60 * 60 // 60 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            // Network-first for API calls and chess.com data
            urlPattern: /^https?:\/\/.*(api|chess\.com).*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 5 * 60 // 5 minutes
              },
              networkTimeoutSeconds: 10
            }
          }
        ],
        // Don't precache large files
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        globIgnores: ['**/node_modules/**', '**/stockfish*.{wasm,js}', '**/nn-*.nnue']
      },
      devOptions: {
        enabled: false // Disable in dev mode to avoid conflicts
      }
    })
  ],
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
})
