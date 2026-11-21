import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { BRAND, pageTitle } from './src/config/brand.js'
import { ALL_TOOLS } from './src/config/tools.js'

// `vite preview` sends the same security headers as production (Azure Static Web
// Apps' globalHeaders), so Content-Security-Policy problems show up before a deploy.
const SWA_CONFIG = JSON.parse(fs.readFileSync(new URL('./public/staticwebapp.config.json', import.meta.url), 'utf8'))

// Routes that aren't in the tool registry (src/config/tools.js).
const EXTRA_PAGES = [
  { path: '/privacy', title: 'Privacy Policy', description: `What ${BRAND.name} keeps on your device, and what it sends over the network.` },
  { path: '/terms', title: 'Terms of Use', description: `The ground rules for using ${BRAND.name}. Plain language, no surprises.` },
]

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Writes dist/<route>/index.html for every page: the same app shell, but with that
// tool's <title>, description and link-preview tags, so search engines and chat apps
// that don't run JavaScript see what the page is. Azure Static Web Apps serves /jwt
// straight from jwt/index.html (with trailingSlash unset). Set SITE_URL at build time
// (e.g. https://example.com) to also emit canonical/og:url and an absolute og:image.
function perRouteHtml() {
  let outDir
  return {
    name: 'per-route-html',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    writeBundle() {
      const shell = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8')
      const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '')
      for (const page of [...ALL_TOOLS, ...EXTRA_PAGES]) {
        const title = page.path === '/' ? pageTitle() : pageTitle(page.title)
        const description = page.path === '/' ? BRAND.description : page.description
        let html = shell
          .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
          .replace(/(<meta name="description" content=")[^"]*/, `$1${escapeHtml(description)}`)
          .replace(/(<meta property="og:title" content=")[^"]*/, `$1${escapeHtml(title)}`)
          .replace(/(<meta property="og:description" content=")[^"]*/, `$1${escapeHtml(description)}`)
        if (siteUrl) {
          const url = `${siteUrl}${page.path}`
          html = html.replace(
            /<meta property="og:image" content="\/og-image\.png" ?\/?>/,
            `<meta property="og:image" content="${siteUrl}/og-image.png" />\n  <meta property="og:url" content="${url}" />\n  <link rel="canonical" href="${url}" />`
          )
        }
        const file = page.path === '/' ? path.join(outDir, 'index.html') : path.join(outDir, page.path.slice(1), 'index.html')
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, html)
      }
    },
  }
}

// FFmpeg's single-threaded WASM core (~32 MB) is served at /ffmpeg/ straight from
// node_modules, so it always matches the installed @ffmpeg/core version.
const FFMPEG_CORE_DIR = fileURLToPath(new URL('./node_modules/@ffmpeg/core/dist/esm/', import.meta.url))
// Pages request /ffmpeg/*?v=<version>, so the service worker's cache of the core
// is replaced automatically when @ffmpeg/core is upgraded.
const FFMPEG_CORE_VERSION = JSON.parse(
  fs.readFileSync(new URL('./node_modules/@ffmpeg/core/package.json', import.meta.url), 'utf8')
).version
const FFMPEG_CORE_FILES = {
  'ffmpeg-core.js': 'text/javascript',
  'ffmpeg-core.wasm': 'application/wasm',
}

function ffmpegCore() {
  let outDir
  return {
    name: 'ffmpeg-core',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    configureServer(server) {
      server.middlewares.use('/ffmpeg', (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\//, '')
        const type = FFMPEG_CORE_FILES[name]
        if (!type) return next()
        res.setHeader('Content-Type', type)
        fs.createReadStream(path.join(FFMPEG_CORE_DIR, name)).pipe(res)
      })
    },
    // Copied after bundling (like public/ files) rather than emitted as bundle assets.
    writeBundle() {
      fs.mkdirSync(path.join(outDir, 'ffmpeg'), { recursive: true })
      for (const name of Object.keys(FFMPEG_CORE_FILES)) {
        fs.copyFileSync(path.join(FFMPEG_CORE_DIR, name), path.join(outDir, 'ffmpeg', name))
      }
    },
  }
}

// Matches modules inside the given node_modules packages.
const vendor = (...packages) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${packages.join('|')})[\\\\/]`)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    ffmpegCore(),
    perRouteHtml(),
    VitePWA({
      // A hand-written service worker (src/sw.js) instead of a generated one:
      // workbox's generateSW writes absolute import paths into single-quoted
      // strings, which breaks the build when the project path contains a quote.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'favicon-32x32.png', 'apple-touch-icon.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html}'],
        // The ffmpeg core (32 MB) and the LLM worker are fetched on demand and
        // cached at runtime instead of being precached on every install.
        // Large, tool-specific chunks (Faker, Monaco, the HEIC decoder, PDF
        // libraries, zxcvbn) are cached the first time their tool is opened
        // (runtime cache in src/sw.js) instead of on install. The per-route HTML
        // copies are only for crawlers: offline navigations use the root index.html.
        globIgnores: [
          '**/ffmpeg/**', '**/llm.worker*', '*/index.html',
          '**/vendor-faker-*.js', '**/Formatters-*.js', '**/vendor-heic-*.js',
          '**/zxcvbn.worker-*.js', '**/pdf.worker-*.js', '**/vendor-pdf-lib-*.js', '**/vendor-jspdf-*.js',
        ],
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      },
      manifest: {
        name: BRAND.name,
        short_name: BRAND.shortName,
        description: BRAND.description,
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
    // (No pre-compression plugin: Azure Static Web Apps compresses responses itself.)
  ],
  resolve: {
    alias: [
      // Monaco 0.55 ships its own copy of DOMPurify (3.2.7, with known advisories)
      // and imports it as './dompurify/dompurify.js'. Use the patched version from
      // package.json instead; the API is the same. (package.json's "overrides"
      // only changes Monaco's declared dependency, not the file it bundles.)
      {
        find: /^\.\/dompurify\/dompurify\.js$/,
        replacement: fileURLToPath(new URL('./node_modules/dompurify/dist/purify.es.mjs', import.meta.url)),
      },
    ],
  },
  define: {
    __FFMPEG_CORE_VERSION__: JSON.stringify(FFMPEG_CORE_VERSION),
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    // Imported only inside Web Workers, which Vite's dependency scan doesn't crawl;
    // listing them avoids a mid-session re-optimise and page reload in dev.
    include: ['bcryptjs', 'zxcvbn', 'pdf-lib', 'jszip'],
  },
  // No cross-origin isolation headers: the single-threaded ffmpeg core doesn't need
  // SharedArrayBuffer, and production doesn't send them. The dev server also skips the
  // CSP, because Vite's dev client relies on inline scripts.
  preview: {
    headers: SWA_CONFIG.globalHeaders,
  },
  worker: {
    format: 'es',
  },
  build: {
    rolldownOptions: {
      // Strip debug logging but keep console.error/warn for real failures.
      treeshake: {
        manualPureFunctions: ['console.log', 'console.info', 'console.debug'],
      },
      output: {
        minify: {
          compress: { dropDebugger: true },
        },
        // Stable vendor chunks: the React chunk survives app-only deploys in users'
        // caches, and the large tool-specific libraries get predictable names that
        // the service worker leaves out of the precache (globIgnores above).
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: vendor('react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler') },
            { name: 'vendor-icons', test: vendor('lucide-react') },
            { name: 'vendor-faker', test: vendor('@faker-js[\\\\/]faker') },
            { name: 'vendor-sql', test: vendor('sql-formatter') },
            { name: 'vendor-syntax', test: vendor('react-syntax-highlighter') },
            { name: 'vendor-pdf-lib', test: vendor('pdf-lib', '@pdf-lib') },
            { name: 'vendor-jspdf', test: vendor('jspdf') },
            { name: 'vendor-heic', test: vendor('heic-to') },
            { name: 'vendor-crypto', test: vendor('jose', '@noble[\\\\/]hashes') },
          ],
        },
      },
    },
    chunkSizeWarningLimit: 1500,
  },
})
