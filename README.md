# Vibe Toolbelt

Privacy-first developer tools that run entirely in your browser: formatters, encoders, crypto, network helpers, media and design tools. Your data is processed on your device; nothing you type or drop into a tool is uploaded.

![Privacy first](https://img.shields.io/badge/Privacy-First-10b981?style=flat-square)
![Runs locally](https://img.shields.io/badge/Processing-In%20your%20browser-3b82f6?style=flat-square)
![License](https://img.shields.io/badge/License-MIT-gray?style=flat-square)

## Highlights

- **Runs locally.** Every tool works in the browser. The app is a PWA: tools you've opened keep working offline. Fonts and the code editor are bundled; nothing loads from third-party CDNs.
- **Command palette** (`⌘K` / `Ctrl K`). Ranked search across every tool. Paste a JWT, JSON, a timestamp, a cURL command, a colour, an IP… and it offers to open the right tool with it.
- **Smart Paste.** Paste recognisable content anywhere outside a text field to jump straight to the matching tool, already decoded or formatted.
- **Pipeline.** Send a tool's output to another tool without touching the clipboard (e.g. a JWT payload to the JSON formatter). The header shows what's waiting in the pipeline.
- **Split view.** Pin any tool beside the current one on desktop.
- **On-device AI assistant (optional).** A WebLLM model (Phi-3.5 Mini or Qwen 2.5 1.5B) runs on your GPU via WebGPU and can explain the data in the current tool. Model files download once from Hugging Face when you choose to load one; prompts never leave your device.
- **Light, dark or system theme, plus accent colours.** Every page is readable in both themes and works on phones.

## Tools

| Area | Tools |
|---|---|
| **Core** | Universal Inspector (detect and decode anything), API Tester (requests, auth, environments, history, cURL import/export), Screen Recorder, Video Studio (trim, crop, speed, fades, MP4/WebM/GIF/MP3 via ffmpeg.wasm), Image Converter (PNG/JPEG/WebP/AVIF/ICO/PDF, HEIC input, crop, resize, batch ZIP) |
| **Data & formats** | Code Formatters (JSON with JMESPath, SQL dialects, XML), Data Converter (JSON / YAML / TOML / XML), CSV ↔ JSON, JSON to Types (TypeScript, Go, JSON Schema), Markdown editor (GitHub-flavored), Hex Viewer |
| **Encoders** | Base64 (text and URL-safe), Image to Base64, URL encode/decode, HTML entities, Number base (arbitrary size) |
| **Security** | JWT decoder & verifier, Hash generator, HMAC, Bcrypt, AES (AES-256-GCM with PBKDF2, plus an OpenSSL-compatible legacy mode), RSA key generator, TOTP, Password strength audit |
| **Generators** | UUID, Nano ID & ULID, Username, Fake data (JSON/CSV/SQL), Lorem ipsum, QR codes |
| **Text** | Text statistics, Case converter, List sorter & deduplicator, Regex tester, Text diff |
| **Web** | URL parser, User agent parser, cURL converter, IP / CIDR calculator, Meta tag generator, HTTP status codes |
| **Dev utilities** | Unix timestamp converter, Cron expression parser (with upcoming runs), Chmod calculator, Keycode viewer |
| **Images & files** | PDF tools (merge, rotate, extract pages), SVG optimizer, Favicon generator, EXIF viewer, Privacy scanner (PII in text, hidden metadata in files) |
| **Design** | Glassmorphism, Gradient, CSS triangle, Box shadow, Color converter, Color blindness simulator, Code screenshot |

## What leaves your device

- **Nothing you put into a tool**, with these exceptions that you start yourself:
  - the API Tester sends requests to the URLs you enter;
  - the Markdown preview loads images referenced in your document;
  - loading the AI model downloads model files from huggingface.co and raw.githubusercontent.com (once; they're cached).
- The site itself is static files served by the host (Azure Static Web Apps), which keeps standard access logs.
- Local storage holds your preferences, favourites, pinned tool and API Tester history/collections/environments. See the in-app Privacy page for every key and how to clear it.

## Development

```bash
npm install
npm run dev        # http://localhost:5173
npm run lint
npm run build
npm test           # Playwright: smoke, contrast, layout and feature tests
```

- **Stack:** React 18, Vite 7, React Router 7, vite-plugin-pwa.
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

MIT
