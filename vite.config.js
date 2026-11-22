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

// File types the installed app registers for "Open with" (manifest
// file_handlers). Explicit MIME types, because operating systems match
// handlers by extension and type; utils/fileRouting.js picks the tool.
const FILE_HANDLER_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg', '.jfif'],
  'image/webp': ['.webp'],
  'image/avif': ['.avif'],
  'image/gif': ['.gif'],
  'image/heic': ['.heic', '.heif'],
  'image/tiff': ['.tif', '.tiff'],
  'image/svg+xml': ['.svg'],
  'application/pdf': ['.pdf'],
  'application/json': ['.json', '.har'],
  'application/yaml': ['.yaml', '.yml'],
  'application/toml': ['.toml'],
  'application/xml': ['.xml'],
  'text/csv': ['.csv', '.tsv'],
  'text/markdown': ['.md', '.markdown'],
  'application/x-x509-ca-cert': ['.pem', '.crt', '.cer', '.der'],
  'application/pkcs10': ['.csr'],
}

// What other apps may share with the installed app (manifest share_target).
const SHARE_TARGET_TYPES = [
  'image/*', 'video/*', 'audio/*', 'text/*', 'application/pdf', 'application/json', 'application/xml',
  'application/x-x509-ca-cert', 'application/pkcs10',
  '.har', '.pem', '.crt', '.cer', '.der', '.csr', '.yaml', '.yml', '.toml', '.md',
]

// Matches modules inside the given node_modules packages.
const vendor = (...packages) => new RegExp(`[\\\\/]node_modules[\\\\/](?:${packages.join('|')})[\\\\/]`)

// Prettier's standalone build and the language plugins the Formatters page
// loads on demand. Each gets its own named chunk (prettier-<name>-<hash>.js),
// so a plugin is downloaded only when its language is formatted, and the
// service worker leaves them out of the precache (globIgnores above).
const PRETTIER_MODULES = ['standalone', 'babel', 'estree', 'typescript', 'postcss', 'html', 'yaml', 'graphql', 'markdown']
const prettierGroups = PRETTIER_MODULES.map((name) => ({
  name: `prettier-${name}`,
  test: new RegExp(`[\\\\/]node_modules[\\\\/]prettier[\\\\/](?:plugins[\\\\/])?${name}\\.mjs$`),
}))

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
          '**/vendor-faker-*.js', '**/vendor-monaco-*', '**/editor.worker-*.js', '**/json.worker-*.js', '**/vendor-heic-*.js',
          '**/zxcvbn.worker-*.js', '**/pdf.worker-*.js', '**/vendor-pdf-lib-*.js', '**/vendor-jspdf-*.js',
          '**/prettier-*.js',
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
        // The installed app shows up in "Open with" for these files and opens
        // them with Smart Drop's tool chooser (src/components/SmartDrop.jsx).
        // An already open window is reused instead of starting a new one.
        file_handlers: [{ action: '/', accept: FILE_HANDLER_TYPES }],
        launch_handler: { client_mode: ['focus-existing', 'auto'] },
        // Files and text shared from other apps (Android, ChromeOS, Windows)
        // go through the service worker (src/sw.js) to the same chooser.
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
            files: [{ name: 'files', accept: SHARE_TARGET_TYPES }],
          },
        },
      },
    }),
    // (No pre-compression plugin: Azure Static Web Apps compresses responses itself.)
  ],
  resolve: {
    alias: [
      // Monaco ships its own copy of DOMPurify (3.4.15 in 0.57; 0.55 had 3.2.7,
      // with known advisories) and imports it as './dompurify/dompurify.js'. Use
      // the version from package.json instead, so it gets security updates with
      // the rest of the dependencies; the API is the same. (package.json's
      // "overrides" only changes a declared dependency, not a bundled file.)
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
    // Imported only inside Web Workers (which Vite's dependency scan doesn't
    // crawl) or only through dynamic imports of optional parts (Prettier's
    // plugins, the JSON Schema validator, the EFF word list). Listing them avoids
    // a mid-session re-optimise and page reload in dev.
    include: [
      'bcryptjs', 'zxcvbn', 'pdf-lib', 'jszip',
      ...PRETTIER_MODULES.map((name) => (name === 'standalone' ? 'prettier/standalone' : `prettier/plugins/${name}`)),
      '@cfworker/json-schema', '@wordlist/english-eff/long',
    ],
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
            // Monaco's core (~4 MB), shared by the pages with code editors. Its
            // per-language tokenizers stay out of it: they load lazily, per language.
            { name: 'vendor-monaco', test: /[\\/]node_modules[\\/]monaco-editor[\\/](?!esm[\\/]vs[\\/]languages[\\/]definitions[\\/])/ },
            { name: 'vendor-syntax', test: vendor('react-syntax-highlighter', 'refractor') },
            ...prettierGroups,
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
