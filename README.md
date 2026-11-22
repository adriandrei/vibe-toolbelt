# Vibe Toolbelt

Privacy-first developer tools that run entirely in your browser: formatters, encoders, crypto, network helpers, media and design tools. Your data is processed on your device; nothing you type or drop into a tool is uploaded.

![Privacy first](https://img.shields.io/badge/Privacy-First-10b981?style=flat-square)
![Runs locally](https://img.shields.io/badge/Processing-In%20your%20browser-3b82f6?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-gray?style=flat-square)

## Highlights

- **Runs locally.** Every tool works in the browser. The app is a PWA: tools you've opened keep working offline. Fonts and the code editor are bundled; nothing loads from third-party CDNs.
- **Command palette** (`⌘K` / `Ctrl K`). Ranked search across every tool. Paste a JWT, JSON, a timestamp, a cURL command, a colour, an IP… and it offers to open the right tool with it.
- **Smart Paste.** Paste recognisable content anywhere outside a text field to jump straight to the matching tool, already decoded or formatted. It knows JWTs, JSON, HAR files, PEM certificates and keys, YAML, TOML, CSV, XML, HTML, GraphQL, SQL, hex dumps, cURL commands, URLs, timestamps, colours, IPs and more.
- **Smart Drop.** Drop a file anywhere to pick the tool that opens it: images, PDFs, videos, HAR files, certificates, JSON/YAML/TOML/XML, CSV, Markdown, code or any binary file. The installed app also shows up in "Open with" for those files and accepts files and text shared from other apps.
- **Shareable links.** Regex Tester, Cron Parser, Text Diff, Data Converter, JSON Schema, Contrast Checker, Time Zones and Recipes can copy a link that reopens the tool with your input. The input travels in the URL fragment, which browsers never send to a server; anyone you give the link to can read it.
- **Backup and restore.** Settings → Your data downloads everything the app stores (favourites, settings, saved recipes, API Tester collections…) as one file, restores it in another browser, or clears it all.
- **Pipeline.** Send a tool's output to another tool without touching the clipboard (e.g. a JWT payload to the JSON formatter). The header shows what's waiting in the pipeline.
- **Split view.** Pin any tool beside the current one on desktop.
- **On-device AI assistant (optional).** A WebLLM model (Phi-3.5 Mini or Qwen 2.5 1.5B) runs on your GPU via WebGPU and can explain the data in the current tool. Model files download once from Hugging Face when you choose to load one; prompts never leave your device.
- **Light, dark or system theme, plus accent colours.** Every page is readable in both themes and works on phones.

## Tools

| Area | Tools |
|---|---|
| **Core** | Universal Inspector (detect and decode anything), Recipes (chain 45 decode/encode/compress/hash/format steps, save and share them), API Tester (HTTP requests, auth, environments, history, cURL import/export, plus WebSocket and server-sent event clients), Screen Recorder, Video Studio (trim, crop, speed, fades, MP4/WebM/GIF/MP3 via ffmpeg.wasm), Image Converter (PNG/JPEG/WebP/AVIF/ICO/PDF, HEIC input, crop, resize, batch ZIP) |
| **Data & formats** | Code Formatters (JSON with JMESPath, SQL dialects, XML, plus HTML, CSS/SCSS/Less, JavaScript/TypeScript, YAML, GraphQL and Markdown with Prettier), Data Converter (JSON / YAML / TOML / XML), CSV ↔ JSON, JSON to Types (TypeScript, Go, JSON Schema), JSON Schema validator (drafts 4 to 2020-12), Markdown editor (GitHub-flavored), Hex Viewer (also reads `xxd` and `hexdump -C` output) |
| **Encoders** | Base64 (text and URL-safe), Image to Base64, URL encode/decode, HTML entities, Number base (arbitrary size) |
| **Security** | JWT decoder & verifier, JWT builder & signer (HMAC, RSA, RSA-PSS, ECDSA, EdDSA, key generation), Certificate & key inspector (X.509 certificates and chains, CSRs, PKCS #7, public keys, fingerprints and pins), Hash generator, HMAC, Bcrypt, AES (AES-256-GCM with PBKDF2, plus an OpenSSL-compatible legacy mode), RSA key generator, TOTP, Password generator (random passwords, EFF diceware passphrases, PINs), Password strength audit |
| **Generators** | UUID, Nano ID & ULID, Username, Fake data (JSON/CSV/SQL), Lorem ipsum, QR codes |
| **Text** | Text statistics, Case converter, List sorter & deduplicator, Regex tester, Text diff |
| **Web** | URL parser, User agent parser, cURL converter, HAR viewer & sanitizer (inspect network recordings, strip tokens and cookies before sharing), IP / CIDR calculator, Meta tag generator, HTTP status codes |
| **Dev utilities** | Unix timestamp converter, Time zone converter (DST-aware, with a meeting planner), Cron expression parser (with upcoming runs), Chmod calculator, Keycode viewer |
| **Images & files** | PDF tools (merge, rotate, extract pages), SVG optimizer, Favicon generator, EXIF viewer, Privacy scanner (PII in text, hidden metadata in files) |
| **Design** | Glassmorphism, Gradient, CSS triangle, Box shadow, Color converter, Contrast checker (WCAG AA/AAA with fix suggestions), Color blindness simulator, Code screenshot |

## What leaves your device

- **Nothing you put into a tool**, with these exceptions that you start yourself:
  - the API Tester sends requests, and opens WebSocket and event stream connections, to the URLs you enter;
  - the Markdown preview loads images referenced in your document;
  - loading the AI model downloads model files from huggingface.co and raw.githubusercontent.com (once; they're cached).
- The site itself is static files served by the host (Azure Static Web Apps), which keeps standard access logs.
- Local storage holds your preferences, favourites, pinned tool, saved recipes and API Tester history/collections/environments. See the in-app Privacy page for every key, and Settings → Your data to back it up or clear it.
- A shared link contains the input you shared (in the `#` part of the URL, which isn't sent to the host). Treat it like the data itself.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run lint
npm run build
npm run preview    # serves dist/ with the production security headers
npm run test:unit  # Vitest: unit tests for src/**/*.test.js, in seconds
npm test           # Playwright: smoke, accessibility (axe), contrast, layout and feature tests
npm run notices    # regenerate THIRD_PARTY_NOTICES.md after changing dependencies
```

- **npm version:** change dependencies with npm 11.19 or newer (it comes with Node 24.22+). Older npm writes a lockfile that CI's `npm ci` rejects, which blocks the deploy.

- **Stack:** React 19, Vite 8 (Rolldown), React Router 7, vite-plugin-pwa 2. Node 24 in CI.
- **Service worker:** hand-written in `src/sw.js` (`injectManifest`), because workbox's generated worker breaks the build when the project path contains a quote. It precaches the app shell and caches the ffmpeg core and large tool chunks on first use.
- **ffmpeg:** the single-threaded core is served at `/ffmpeg/` straight from `node_modules/@ffmpeg/core` (copied into `dist/` at build time), so it always matches the installed version.
- **Security headers:** the Content-Security-Policy and friends live in `public/staticwebapp.config.json`. `npm run preview` sends the same headers, so check new features there before deploying. Inline scripts aren't allowed: the pre-paint theme script is `public/theme-init.js`.
- **Link previews:** the build writes `dist/<route>/index.html` for every tool with its own title and description. Set `SITE_URL` (e.g. `SITE_URL=https://example.com npm run build`) to add canonical URLs and an absolute `og:image`.
- **Monaco** (0.57) is imported piecemeal in `src/utils/monaco.js`: the editor core and features, the JSON language service, and lightweight highlighters for the other languages. Importing `monaco-editor` itself would add the TypeScript, CSS and HTML language workers and an LSP client. The core is the `vendor-monaco` chunk, cached the first time an editor opens. Its bundled copy of DOMPurify is swapped for the version in `package.json` at build time (an alias in `vite.config.js`).
- **Files, links and data between tools:** Smart Drop, "Open with" and the share target choose tools in `src/utils/fileRouting.js`, and pages receive files with `useIncomingFiles`. Share links use `ShareButton` and `useSharedState`. See [`docs/ui-kit.md`](docs/ui-kit.md).
- **Tests:** unit tests sit next to the code they test (`src/utils/*.test.js`); browser tests are in `tests/`. `tests/a11y.spec.js` runs axe on every page in both themes.
- **Tool registry:** `src/config/tools.js` is the single list behind the sidebar, palette, Home and page headers. Add a tool there and in `src/routes.js`.
- **UI kit:** shared tokens, CSS classes, components and hooks are documented in [`docs/ui-kit.md`](docs/ui-kit.md). Use them rather than hardcoding colours or re-implementing copy buttons, drop zones or toggles.
- **Brand:** the app name lives in `src/config/brand.js`.
- **Audit:** [`docs/audit/`](docs/audit/README.md) has the October 2026 audit that drove the current design system and fixes.

## Contributing

1. Fork the repository and create a feature branch.
2. Follow [`docs/ui-kit.md`](docs/ui-kit.md); every page must work in light and dark mode, at phone width and in the split view.
3. Run `npm run lint` and `npm test` before opening a pull request.

New tools and libraries must work fully client-side and offline. Anything that sends data off the device needs to be explicit, user-initiated and documented on the Privacy page.

## License

MIT, see [`LICENSE`](LICENSE). Third-party packages and their licences are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Note that `@ffmpeg/core` is GPL-2.0-or-later, `heic-to` (libheif) is LGPL-3.0 and `ua-parser-js` 2.x is AGPL-3.0-or-later.
