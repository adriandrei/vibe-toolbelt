import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import viteCompression from 'vite-plugin-compression'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png'],
      workbox: {
        // The ffmpeg core (32 MB) and the LLM worker are fetched on demand and
        // cached at runtime instead of being precached on every install.
        // Large, tool-specific chunks (Faker, Monaco, the HEIC decoder, PDF
        // libraries, zxcvbn) are cached the first time their tool is opened
        // (runtime cache below) instead of on install.
        globIgnores: [
          '**/ffmpeg/**', '**/llm.worker*', '**/*.br',
          '**/vendor-faker-*.js', '**/Formatters-*.js', '**/heic2any-*.js',
          '**/zxcvbn.worker-*.js', '**/pdf.worker-*.js', '**/vendor-pdf-lib-*.js', '**/vendor-jspdf-*.js',
        ],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/ffmpeg\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/ffmpeg/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ffmpeg-core',
              expiration: { maxEntries: 4 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request, url }) => url.origin === self.location.origin && (request.destination === 'script' || request.destination === 'worker' || request.destination === 'style' || request.destination === 'font'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'app-assets',
              expiration: { maxEntries: 200 },
            },
          },
        ],
      },
      manifest: {
        name: 'Vibe Toolbelt',
        short_name: 'Toolbelt',
        description: 'Privacy-first developer tools that run entirely in your browser',
        theme_color: '#110f18',
        background_color: '#110f18',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
    // Brotli compression for production builds
    viteCompression({
      algorithm: 'brotliCompress',
      ext: '.br',
      threshold: 10240, // Only compress files > 10KB
      deleteOriginFile: false
    })
  ],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        // Strip debug logging but keep console.error/warn for real failures
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
        drop_debugger: true,
      }
    },
    rollupOptions: {
      output: {
        // Manual chunks for better code splitting
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-icons': ['lucide-react'],
          'vendor-faker': ['@faker-js/faker'],
          'vendor-sql': ['sql-formatter'],
          'vendor-syntax': ['react-syntax-highlighter'],
          'vendor-pdf-lib': ['pdf-lib'],
          'vendor-jspdf': ['jspdf'],
          'vendor-crypto': ['crypto-js', 'jose'],
        }
      }
    },
    chunkSizeWarningLimit: 1500
  }
})
