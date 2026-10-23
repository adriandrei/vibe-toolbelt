# Vibe Toolbelt / Private Toolkit — project audit

*Audited 2026-10-16 at commit `a3c843b`. Line numbers in these files refer to that commit.*

## Status after the fixes (2026-10-23)

Every finding in this audit has been addressed in the working tree. **Nothing is committed yet.** The line numbers in the group files point at the old code and no longer match.

**Verification**

| Check | Before | After |
|---|---|---|
| `npx eslint .` | 259 problems | 0 |
| Playwright suite | 181 passing, with a page crashing unnoticed | 405 passing |
| PWA precache | 8.4 MB | 4.4 MB (130 files) |

The suite now checks every route for these:
- it loads without the error screen and with its registered title;
- text contrast is at least 3:1 in light and dark;
- there is no horizontal overflow at 375px.

It also covers:
- accent-button contrast for 10 hues in both themes;
- crash isolation in the main and pinned panes;
- theme persistence with no flash;
- the palette, smart paste, pipeline, pin and favourites flows.

Every route was also screenshotted in both themes at 1366px and 375px and reviewed by eye.

**How the open decisions were settled.** These are defaults chosen so the work could go ahead, and each is easy to reverse.

1. **Name:** "Vibe Toolbelt", set once in `src/config/brand.js`.
2. **Light theme:** designed properly:
   - surface and status tokens for each theme;
   - on-accent colours computed per hue, with the accent nudged when no text colour reaches 4.5:1;
   - code themes adjusted to at least 4.6:1.
3. **Privacy and offline:** fonts are self-hosted, Monaco is bundled and the Unsplash image is gone. The Privacy page lists every request the app can make, so the claims are now accurate.
4. **Overlapping tools:** not merged. Related pages share code instead:
   - one metadata reader for EXIF and the Privacy Scanner;
   - one cURL parser for API Tester and the cURL Converter.

   The sidebar was re-filed into Core, Data & Formats, Encoders, Security, Generators, Text, Web, Dev Utilities, Images & Files, and Design.
5. **Privacy Scanner:** a real text scanner, alongside the file metadata view. It finds keys, tokens, passwords, card numbers (Luhn-checked), IBANs, emails, phone numbers, IP addresses and high-entropy strings, and can redact them.
6. **AES:** AES-256-GCM with PBKDF2-SHA256 (600,000 iterations) is the default. A labelled OpenSSL/CryptoJS mode still decrypts old ciphertexts.

Two routes changed as well:
- API Tester moved to `/api-tester`, and `/api` redirects there.
- AI Settings became **Settings** (appearance and AI) at `/ai-settings`, and `/settings` redirects there.

**Known limitations.** Each one is explained on the page it affects.

- **Video Studio:** WebM output is VP8/Vorbis, because the bundled ffmpeg build crashes when encoding VP9/Opus.
- **Markdown Editor:** raw HTML isn't rendered, because that needs a sanitizer dependency.
- **XML conversions:** not everything round-trips. One-item arrays and the root wrapper can change, and `null` becomes empty.
- **Signing and encryption:**
  - JWE tokens aren't decrypted.
  - ES256K signatures can't be verified with WebCrypto.
  - HMAC needs a non-empty key.
- **PDF Tools:** no page thumbnails, because no PDF renderer is installed.
- **Privacy Scanner:** doesn't find names or postal addresses.
- **Text Diff:** "Ignore line endings" only changes results for pipeline input, because browsers already normalise line endings typed or pasted into a text box.
- **Not covered by headless tests:**
  - WebGPU model download and chat.
  - Screen recording while the tab is hidden. Firefox and Safari fall back to a canvas recorder and show a warning.

**Still yours to decide**

- `ua-parser-js` 2.x, used by the User Agent Parser, is AGPL-3.0. You can keep it, pin 1.x (MIT) or switch library.
- The CI test job still has `continue-on-error: true`. The suite is green, so it could now block deploys.
- Possible new smart-paste detectors: TOML, CSV, hex dumps and plain numbers.

## Summary

The app is a React 18 + Vite 7 single-page app with **61 routes** (58 tools, Home, Privacy and Terms) and a 404 page. It has 62 page files (14.9k lines) and about 18.6k lines in total. It deploys to Azure Static Web Apps.

The breadth is impressive, but most of it has never been exercised past the happy path:

- **Build:** passes (12 s).
- **Tests:** all **181 Playwright tests pass**, yet `/text-stats` crashes on load. The suite doesn't catch crashes, theming problems or broken output (see [B6](#24-build-pwa-tooling-tests)).
- **Lint:** 259 problems, of which about 113 are real ones in `src`.

**Page health:** 9 pages are broken, 16 have major issues, 26 have moderate issues and 11 have only minor ones (feature map below).

Most of the problems come from a handful of shared causes:

1. **No shared building blocks.** Each page re-implements copy buttons (about 38 times), file drop zones, toggles, sliders, colour fields, code blocks, error banners and page headers, each with its own bugs.
2. **Light mode was never designed.** About 40 pages hardcode dark-only colours. White-on-primary text breaks under half the accent presets. The global CSS breaks every slider, checkbox, radio and colour picker, and renders unstyled buttons with black text.
3. **Cross-page plumbing is miswired.**
   - One crash shows the error screen on every page you visit afterwards.
   - A crash in the pinned pane takes down the whole app.
   - The ⌘K palette injects your search text into tools.
   - The smart-paste detector sends timestamps and hashes to the Base64 decoder.
   - A pinned tool steals input meant for the main pane.
4. **Heavy work runs on the main thread with no limits or validation.** Regex matching, RSA key generation, bcrypt, zxcvbn, diffs and big inputs freeze or crash pages.
5. **Claims don't match behaviour.**
   - "100% client-side" and "offline", while Monaco, fonts and images load from CDNs.
   - A PII scanner that doesn't scan for PII.
   - A "Secure AES-256" that uses MD5 key derivation.
   - 20-character "ULIDs".

## Files in this audit

| File | Covers |
|---|---|
| **README.md** (this file) | Overview, feature map, worst issues, cross-cutting findings, fix plan |
| [01-media.md](01-media.md) | Screen Recorder, Video Studio, Image Converter, EXIF Viewer |
| [02-web-api.md](02-web-api.md) | API Tester, cURL, URL parser, User Agent, CIDR, Meta Tags, HTTP Status, URL Encode |
| [03-text.md](03-text.md) | Inspector, Regex Tester, Diff, Text Stats, List Sorter, Case Converter, Lorem |
| [04-converters.md](04-converters.md) | Formatters, Universal Converter, JSON to Type, CSV↔JSON, Markdown, Base64, HTML Entity, Number Base, Hex Viewer |
| [05-security.md](05-security.md) | JWT, Hash, HMAC, RSA, Bcrypt, AES, OTP, Password, Nano ID/ULID, UUID, Username, Chmod, Privacy Scanner |
| [06-design-files.md](06-design-files.md) | Glassmorphism, Gradient, Triangle, Box Shadow, Color Blindness, Color Converter, Code Snippets, QR Code, Favicon, SVG Compressor, Base64 Image, PDF Tools |
| [07-home-ai-misc.md](07-home-ai-misc.md) | Home, AI Settings, 404, Privacy, Terms, Faker, Cron, Unix Timestamp, Keycode, plus app-shell infrastructure |

Each group file has, per page: what it actually does, how it uses the cross-page features, bugs (with `file:line`, severity, a concrete failure scenario and confidence), UX issues, theming issues and a fix sketch. Each file ends with group-level patterns.

## 1. Architecture at a glance

- **Providers** (`App.jsx`): Theme → Toast → Helmet → Pipeline → AI → Router. `AILoadingModal` sits outside the router.
- **Routing:** `routes.js` has lazy page imports and `ROUTE_MAP`. `createBrowserRouter` renders each route as `<ErrorBoundary><Page/></ErrorBoundary>` inside `Layout`. The router has no `errorElement`.
- **Layout:** the Sidebar (tool list `TOOL_CATEGORIES`, search, favorites, pin buttons, theme toggle), `CommandPalette` (⌘K), `SmartPaste` (global paste listener), `AIAssistant` (slide-in chat), a header with AI and privacy badges, and `<main>`. On desktop, `<main>` can render a second, **pinned** tool in a right-hand pane.
- **Cross-page features:**
  - smart input (`useSmartInput`, which reads router state)
  - the pipeline (one in-memory value, `PipelineSend`/`PipelineRead`)
  - AI context (`useRegisterAIContext`)
  - toasts (`useToast`, unused)
  - favorites (`useFavorites`, localStorage)
  - theme and hue (`ThemeProvider`, localStorage `pt-theme`/`pt-hue`)
- **AI:** WebLLM runs in a worker (`workers/llm.worker.js`) with Phi-3.5 mini or Qwen2.5 1.5B. It needs WebGPU and downloads the model from Hugging Face on first load.
- **Styling:** almost entirely inline style objects using the CSS custom properties in `styles/variables.css`, plus `global.css` and `responsive.css`.
- **Build and deploy:**
  - Vite with `vite-plugin-pwa` (precaches 94 files, 8.4 MB) and Brotli.
  - ffmpeg core self-hosted in `public/ffmpeg`.
  - GitHub Actions deploys to Azure Static Web Apps. The test job is `continue-on-error: true`, so failing tests never block a deploy.

## 2. Feature map

**Health levels:**
- **Broken:** a critical bug in the main flow.
- **Major:** high-severity bugs.
- **Moderate:** medium-severity bugs.
- **Minor:** only low-severity bugs.

**Integration codes:**
- **SI:** consumes smart input.
- **P:** pipeline send or read.
- **AI:** registers AI context.
- **LS:** saves to localStorage.

| Category (sidebar) | Route | Tool | What it does | Integrations | Health | Details |
|---|---|---|---|---|---|---|
| Core | `/` | Home | Hero, feature cards, grid of every tool, footer | — | Moderate | [07](07-home-ai-misc.md) |
| Core | `/recorder` | Screen Recorder | Screen/tab capture, mic and webcam bubble, system audio; WebM and GIF export; hand-off to Video Studio | P (video) | **Broken** | [01](01-media.md) |
| Core | `/video` | Video Studio | ffmpeg.wasm trim, crop, speed, fades, scale, audio replace; MP4/WebM/GIF/MP3 export | P (video) | **Broken** | [01](01-media.md) |
| Core | `/inspect` | Inspector | Paste anything: format detection, stats, entropy, hashes, previews, "Open in tool" | produces SI | Moderate | [03](03-text.md) |
| Core | `/api` | API Tester | REST client: params, auth, headers, body, `{{env}}` variables, history, collections, cURL import/export | LS | Major | [02](02-web-api.md) |
| Core | `/image` | Image Converter | Batch convert (PNG/JPEG/WebP/AVIF/BMP/ICO/PDF), resize, rotate/flip, crop, HEIC, ZIP | — | **Broken** | [01](01-media.md) |
| AI | `/ai-settings` | AI Settings | WebGPU check, model choice and load, **accent hue picker**, clear model cache | LS | Moderate | [07](07-home-ai-misc.md) |
| Converters | `/base64` | Base64 | UTF-8 text encode/decode | SI, P, AI | Major | [04](04-converters.md) |
| Converters | `/csv-json` | CSV <> JSON | Two-way conversion with delimiter choice | — | Moderate | [04](04-converters.md) |
| Converters | `/hex` | Hex Viewer | Paged hex/ASCII dump of a local file | — | Major | [04](04-converters.md) |
| Converters | `/formatters` | Formatters | JSON (with JMESPath), SQL (12 dialects) and XML prettify/minify in Monaco; diff view | SI, P, AI | Major | [04](04-converters.md) |
| Converters | `/converter` | JSON <> YAML | Actually a JSON/YAML/TOML/XML converter | — | Moderate | [04](04-converters.md) |
| Converters | `/type-converter` | JSON to Type | TypeScript interfaces, Go structs, JSON Schema | AI | Major | [04](04-converters.md) |
| Converters | `/markdown` | Markdown | Editor with live preview; AI "improve" rewrite | AI (direct) | Moderate | [04](04-converters.md) |
| Converters | `/cron` | Cron Parser | Cron expression to plain English (cronstrue) | SI | Moderate | [07](07-home-ai-misc.md) |
| Converters | `/unix` | Unix Timestamp | Live clock; timestamp ↔ ISO, local, UTC and relative time | SI | Major | [07](07-home-ai-misc.md) |
| Converters | `/qrcode` | QR Code | Text to QR code with colours, error-correction level, PNG download | — | Major | [06](06-design-files.md) |
| Converters | `/pdf` | PDF Tools | Merge, rotate, extract a page range | — | Moderate | [06](06-design-files.md) |
| Converters | `/image-base64` | Base64 Image | Image to data URI, `<img>` and CSS snippets | — | Moderate | [06](06-design-files.md) |
| Converters | `/favicon` | Favicon Generator | Image to favicon.ico, PNG sizes, manifest and tags, as a ZIP | — | Major | [06](06-design-files.md) |
| Converters | `/keycode` | Keycode | key / code / keyCode of each key press | — | Major | [07](07-home-ai-misc.md) |
| Converters | `/svg` | SVG Compressor | Regex-based whitespace and comment stripping | — | **Broken** | [06](06-design-files.md) |
| Converters | `/urlencode` | URL Encode | encodeURI / decodeURI / …Component modes | P | Minor | [02](02-web-api.md) |
| Converters | `/html-entity` | HTML Entity | Encode/decode with a reference grid | — | Minor | [04](04-converters.md) |
| Converters | `/number-base` | Number Base | Live binary/octal/decimal/hex conversion | — | Moderate | [04](04-converters.md) |
| Security | `/bcrypt` | Bcrypt Hash | Hash with a cost slider; verify | — | Moderate | [05](05-security.md) |
| Security | `/aes` | AES Encrypt | Passphrase AES in CryptoJS/OpenSSL "Salted__" format | — | Moderate | [05](05-security.md) |
| Security | `/otp` | OTP / TOTP | TOTP codes with countdown and an `otpauth://` QR code | — | Minor | [05](05-security.md) |
| Security | `/jwt` | JWT Decoder | Decode and verify HS, RS, PS and ES tokens (jose) | SI, P, AI | Moderate | [05](05-security.md) |
| Security | `/diff` | Secure Diff | Line diff, unified or side-by-side; copy patch | AI | Major | [03](03-text.md) |
| Security | `/uuid` | UUID Gen | Bulk UUID v4 | — | Minor | [05](05-security.md) |
| Security | `/username` | Username | Readable or random usernames | — | Minor | [05](05-security.md) |
| Security | `/hash` | Hash Gen | MD5, SHA-1, SHA-256, SHA-512 | SI, P, AI | Minor | [05](05-security.md) |
| Security | `/hmac` | HMAC Gen | HMAC with MD5, SHA-1, SHA-256, SHA-512 | — | Minor | [05](05-security.md) |
| Security | `/rsa` | RSA Key Gen | JSEncrypt key pairs as PEM | — | Major | [05](05-security.md) |
| Security | `/password` | Password Audit | zxcvbn strength estimate | — | Moderate | [05](05-security.md) |
| Security | `/nanoid` | Nano ID / ULID | Nano ID, ULID, "CUID2-like", custom alphabet | — | Major | [05](05-security.md) |
| Security | `/chmod` | Chmod Calc | Octal ↔ symbolic, with setuid/setgid/sticky | — | Minor | [05](05-security.md) |
| Web | `/url` | URL Parser | URL components and query parameters | SI | Moderate | [02](02-web-api.md) |
| Web | `/ua` | User Agent | ua-parser-js breakdown | SI | Moderate | [02](02-web-api.md) |
| Web | `/curl` | Curl to Fetch | cURL command to a `fetch()` snippet | — | **Broken** | [02](02-web-api.md) |
| Web | `/cidr` | IP / CIDR | Range, size and netmask for IPv4 and IPv6 | SI | Major | [02](02-web-api.md) |
| Web | `/meta` | Meta Tags | SEO, Open Graph and Twitter tag generator | — | Major | [02](02-web-api.md) |
| Web | `/http-status` | HTTP Status | Searchable status-code reference | — | Major | [02](02-web-api.md) |
| Text | `/text-stats` | Text Stats | Word, character and line counts, reading time | P, AI | **Broken** | [03](03-text.md) |
| Text | `/list` | List Sorter | Sort, dedupe and trim lines | — | Minor | [03](03-text.md) |
| Text | `/case` | Case Converter | 12 case styles | P | Moderate | [03](03-text.md) |
| Text | `/regex` | Regex Tester | Match/replace with highlighting, cheat sheet, AI pattern generation | AI | **Broken** | [03](03-text.md) |
| Text | `/lorem` | Lorem Ipsum | Paragraphs, sentences or words | — | Minor | [03](03-text.md) |
| Privacy | `/privacy-scanner` | Privacy Scanner | File metadata check (image EXIF, PDF info) | — | **Broken** | [05](05-security.md) |
| Privacy | `/exif` | EXIF Viewer | EXIF/GPS table; metadata-stripped copy | — | **Broken** | [01](01-media.md) |
| Faker | `/faker` | Data Gen | Nested schema to JSON, CSV or SQL mock data | — | Moderate | [07](07-home-ai-misc.md) |
| Design | `/css` | Glassmorphism | Frosted-glass CSS generator | — | Moderate | [06](06-design-files.md) |
| Design | `/gradient` | Gradient | Two-stop linear gradient | — | Moderate | [06](06-design-files.md) |
| Design | `/triangle` | Triangle | CSS border triangles | — | Moderate | [06](06-design-files.md) |
| Design | `/color-blindness` | Color Blindness | Simulates colour-vision deficiencies on an image | — | Major | [06](06-design-files.md) |
| Design | `/box-shadow` | Box Shadow | Layered box-shadow generator | — | Moderate | [06](06-design-files.md) |
| Design | `/snippets` | Code Snippets | Code-screenshot (PNG) designer, not a snippet manager | — | Moderate | [06](06-design-files.md) |
| Design | `/color` | Color Converter | HEX/RGB/HSL with sliders | — | Moderate | [06](06-design-files.md) |
| *(footer)* | `/privacy`, `/terms` | Privacy, Terms | Static policy pages | — | Moderate | [07](07-home-ai-misc.md) |
| — | `*` | 404 | Not-found page | — | Minor | [07](07-home-ai-misc.md) |

## 3. The worst issues

### Critical (breaks the app or the tool's main flow)

| # | Where | Problem | Status |
|---|---|---|---|
| C1 | app shell | **One crash breaks every page.** Route `ErrorBoundary`s have no `key`, so React reuses the boundary across navigations and the error screen follows you to every page until you click Try Again or reload. | Reproduced in dev and in the prod build |
| C2 | app shell | **A crash in the pinned pane takes down the whole app,** including the sidebar. The pane has no ErrorBoundary and the router has no `errorElement`, so React Router's default error screen replaces everything. Pages that can trigger it: Text Stats (always), EXIF Viewer (almost any photo), QR Code (long text), Unix Timestamp (17+ digits), JWT (crafted header), API Tester (bare-number JSON), Hash (lone surrogate). | Confirmed by reading |
| C3 | `/text-stats` | Crashes on every render: the AI-context hook reads `stats` before it is declared (`TextStats.jsx:24`). Introduced in `ef3671a`. | Reproduced |
| C4 | AI | A failed model load leaves the **full-screen loading overlay up forever**, with no close button, until you reload (`AILoadingModal.jsx:8-15`). | Confirmed by reading |
| C5 | `/regex` | **Infinite loop that hangs the tab:** `u` flag + a pattern that can match empty (`\b`, `\d*`, `^`) + an emoji in the text. Catastrophic patterns also freeze the page on every keystroke. | Reproduced in V8 |
| C6 | `/keycode` | `preventDefault()` on every keydown: you can't type in the palette, sidebar search or AI chat, and Tab can't move focus. **When pinned, typing breaks across the whole app.** | Reproduced |
| C7 | `/exif` | Crashes on almost every camera or phone photo: it calls `.substring()` on numeric tag values (`ExifViewer.jsx:245`). | Reproduced with ExifReader |
| C8 | `/recorder` | The video freezes whenever you switch away from the tab, because the canvas `requestAnimationFrame` loop is paused while audio keeps recording. | Confirmed by reading + platform behaviour |
| C9 | `/video` | The default MP4 export (no edits) of any recording or VP8 WebM writes a **0-byte file** and still says "Export complete!". `-c copy` into MP4 fails and the exit code is never checked. | Reproduced with the real ffmpeg core |
| C10 | `/image` | It revokes its own object URLs every time the image list changes, so after a rotate, flip, crop or second batch, conversions fail and most download links are dead. | Confirmed by reading |
| C11 | `/curl` | The generated JavaScript is invalid for any hyphenated header (`Content-Type`) and for every JSON body. | Reproduced |
| C12 | `/svg` | The "compressor" deletes newlines instead of collapsing them, so attributes, path data and `points` merge (`<rect\nx=` becomes `<rectx=`). Most real SVGs come out corrupted. | Reproduced |
| C13 | `/privacy-scanner` | **Every PDF gets a false all-clear.** It reads PDF fields through properties pdf-lib doesn't have, and on load pdf-lib overwrites the Producer field. Every error also shows "No obvious privacy risks". Despite the README, no PII text scanning exists. | Reproduced with pdf-lib |

### High

| Area | Problems |
|---|---|
| **Cross-page** | ⌘K palette injects the search text (even `''`) into the 9 smart-input pages. Smart paste sends `1700000000`, hashes and plain words to the Base64 decoder, and Base64 never switches to decode, so pastes get double-encoded. A pinned tool consumes smart input meant for the main pane. |
| **Theming** | White text on `--primary` is 1.4–2.0:1 under the Emerald, Amber and Cyber Blue presets. The global input rule turns sliders into 50px padded boxes, makes colour swatches vanish and stretches checkboxes and radios. Unstyled buttons render black text on dark panels (HTTP Status rows, Box Shadow "Add Layer", Hex Viewer and PDF Tools navigation, API Tester modals). |
| **Layout** | `main { overflow: hidden }` combined with fixed-height pages hides content that can't be scrolled to. On phones, Formatters' output is invisible, along with parts of Converter, Markdown, Base64, EXIF and Inspector. |
| `/api` | A bare-number JSON response crashes the page. Loading from history wipes headers, auth and body. Saved collections are mutated in place. Chrome's "Copy as cURL" body is dropped on import. Generated cURL breaks on `$` and can run backticks when pasted. |
| `/cidr` | Errors are never shown. Valid IPv6 is rejected if uppercase, zero-padded or uncompressed. |
| `/meta` | The `author` and `og:url` inputs don't exist, so those tags are always empty. Quotes aren't escaped. |
| `/diff` | Side-by-side view collapses indentation (Formatters' diff too). The +/− counter counts newlines, not lines. |
| `/formatters` | Output clipped on phones and small laptops. Clicking a mode tab wipes the input. Errors leave stale output that can be copied or sent. Monaco loads from a CDN, so the page doesn't work offline. |
| `/type-converter` | A top-level array (the usual API response) produces invalid TypeScript and Go. Unsafe keys aren't quoted. Go `[]boolean` doesn't compile. |
| `/hex` | Every row wraps its 8th and 16th bytes. Prev/Next are invisible in dark mode. Not keyboard operable. |
| `/unix` | Any number of 17+ digits crashes the page, so every nanosecond timestamp does. |
| `/recorder` | The hidden capture video isn't muted (echo). Failed starts show a black box with no message. Re-renders leak object URLs. |
| `/video` | Toggling crop resets the trim. Fades are mistimed with speed or trim. Recordings report `Infinity` duration. The ffmpeg worker and blob URLs leak on every visit. |
| `/image` | Results aren't tied to the settings that produced them. Edits keep stale blobs in the ZIP. Crops are saved at screen resolution. HEIC is always decoded at JPEG quality 0.5. |
| `/exif` | GPS sign ignored, so southern and western locations link to the wrong place. Mobile layout broken by an invalid CSS property. |
| `/color-blindness` | Filters do nothing in Firefox and give different results in Chrome and Safari (`display:none` SVG filter defs). |
| `/qrcode` | Long text throws "Data too long" and crashes the page. Download grabs the first `<canvas>` in the document. |
| `/favicon` | Hangs forever on an image the browser can't decode. Non-square images get stretched. |
| `/rsa` | Generation freezes the tab (4096-bit ≈ 13 s). About 37% of keys are one bit short, and `/jwt` rejects them. |
| `/nanoid` | "ULID" is 20 characters with 50 random bits; a valid ULID is 26 characters with 80. Nano ID has modulo bias. |

## 4. Cross-cutting findings

### 4.1 Theming

**How it works today:** `ThemeProvider` sets `data-theme` and `--hue` on `<html>`. `variables.css` defines dark tokens on `:root` and overrides them under `[data-theme="light"]`. Pages read those tokens from inline styles. Dark mode is the designed theme; light mode only swaps token values.

| # | Issue | Where | Effect |
|---|---|---|---|
| T1 | The theme is applied in a `useEffect` (after first paint), with a 0.3 s colour transition on `body`. Neither `prefers-color-scheme` nor `color-scheme` is used. | `ThemeProvider.jsx:24`, `global.css:21`, `index.html` | Every load in light mode starts dark and then fades. Custom hues flash indigo first. Native controls and scrollbars ignore the theme. |
| T2 | Header background hardcoded as `rgba(9, 9, 11, 0.4)`. The pinned-pane header uses `rgba(0,0,0,0.2)`. | `Layout.jsx:89,149` | Grey band across every page in light mode. Header badges drop to 1.2–1.4:1 contrast (measured). |
| T3 | **Unstyled buttons render black text.** `global.css` resets `button` background and border but not `color`. | `global.css:29` | Black text on dark panels at about 1.2:1 (HTTP Status rows, Box Shadow, Hex Viewer, PDF Tools arrows, API Tester modals). |
| T4 | The global `input, textarea, select { width:100%; padding:16px; background; border }` rule also hits checkbox, radio, range, color and file inputs. | `global.css:67-79` | Measured: sliders become 50px-tall padded boxes, colour swatches shrink to 0–8px, radios are 361px wide (AI Settings), checkboxes stretch, and selects take full rows. Only Glass sets `accent-color`, so other sliders are browser blue. |
| T5 | Six tokens are used but never defined: `--bg-input` (15× in VideoTools), `--text-secondary`, `--text-code`, `--radius-full`, `--primary-shadow`, `--primary-light`. | grep | Those declarations are silently dropped. |
| T6 | `--primary-rgb` and `--accent-rgb` are fixed triplets: violet and **pink**, while `--accent` is purple. `--accent` and the second body-gradient blob are fixed at hue 280. Violet `rgba(139,92,246,…)` and indigo `rgba(99,102,241,…)` are also hardcoded in a dozen places. | `variables.css`, CommandPalette, Home, NotFound, AI components, Keycode, Unix, ImageConverter, Base64Image, CaseConverter | Accent presets only partly apply. Gradients run green to purple under Emerald. |
| T7 | White text on `var(--primary)` is hardcoded on primary buttons, active toggles, the palette's selected item and chat bubbles. | `color: '#fff'`/`'white'` appears 55 times, mostly on primary backgrounds | Dark-mode contrast: Emerald 1.40:1, Amber 1.82, Cyber Blue 2.04, Crimson 3.18, Amethyst 3.56, Indigo 4.84. Needs an `--on-primary` token per hue. |
| T8 | Dark-only fills: `rgba(0,0,0,0.15–0.4)` for inputs and output wells, `rgba(255,255,255,0.02–0.1)` for cards, chips and hovers, plus `#1e1e1e`, `#0d0d0d`, `#0d1117`, `#333`, `#09090b`. | ~40 pages | Light mode looks muddy grey, and some text becomes unreadable: Type Converter output 1.21:1, Hex Viewer 1.06:1, AES result 1.28:1, Bcrypt 1.73:1, Regex group chips 1.41:1, Recorder stage 1.11:1. |
| T9 | Status colours tuned for dark backgrounds (`#10b981`, `#22c55e`, `#818cf8`, `#f59e0b`, `#eab308`, `#fca5a5`), with no light variants. | PrivacyBadge, toasts, HTTP Status, Chmod, NanoId, Password, JWT, Bcrypt, Privacy Scanner, … | 1.7–2.9:1 on white. Needs `--success / --warning / --danger / --info` with light values. |
| T10 | In dark mode, active and selected states use `--primary` text on `--primary-glow`. | Sidebar active item (every page), segmented toggles | 2.3:1. Needs a lighter `--primary-text` for dark mode. |
| T11 | Editors and code blocks ignore the theme: Monaco is hardcoded `vs-dark`, Prism always uses `vscDarkPlus`, plus `#1e1e1e` and `#0d0d0d` wells. | Formatters, ApiTester, Curl, Snippets | Black slabs in light mode. |
| T12 | **CSS load order.** `App.jsx` imports `responsive.css`, and `main.jsx` imports `App` *before* `variables.css`. | `main.jsx`, `App.jsx:4` | The fluid `--space-*` `clamp()` values and the ≥1921px spacing never apply. `--space-md` is always 16px. |
| T13 | Brand and theme colours disagree: `meta theme-color` is `#0f172a`, `public/manifest.json` is `#09090b`, the VitePWA manifest is `#ffffff`. | `index.html`, `public/`, `vite.config.js` | Browser chrome doesn't follow the theme. |

### 4.2 Cross-page features

| # | Feature | Finding |
|---|---|---|
| X1 | **Error isolation** | See C1 and C2. Also, the `*` route has no boundary. `drop_console` strips the ErrorBoundary's `console.error` in production, so crashes leave no trace. |
| X2 | **⌘K palette: wrong injection** | Every selection navigates with `state: { input: query }`. On JWT, Base64, Hash, Formatters, Cron, Unix, URL, UA and CIDR, the search text becomes the input ("jwt", "unix", "cron"). An empty query injects `''` and wipes default samples. Verified live. |
| X3 | **⌘K palette: behaviour** | Focus is set after a 100ms timer, so the first keystrokes after ⌘K are lost. Arrow keys don't scroll the selection into view. With zero results the index becomes NaN. Matching is substring-only with no ranking, so "hash" opens Bcrypt. The kbd hint always says Ctrl. |
| X4 | **Smart-input hook** | `useSmartInput` accepts `''` and isn't scoped to its own route, so a **pinned tool consumes input meant for the main pane** (verified with Cron and Formatters; the same code path affects every smart-input page). It takes no mode or "process now" callback: Base64 encodes instead of decoding, and Formatters shows injected JSON without formatting it. SmartPaste injects untrimmed text (breaking JWT signature checks and Unix parsing). Its replace-navigation drops `?search` and `#hash`. |
| X5 | **Detection** | `utils/analyzers.js` has several problems:<br>• The Base64 rule runs before the timestamp rule, so `password123`, `getUserById`, phone numbers, MD5/SHA hashes and 10-digit timestamps go to Base64.<br>• There are no rules for UUID, cURL (it goes to /ua because of the `Mozilla/` user-agent string inside), SQL, YAML, XML, IP/CIDR, colours, `<svg` or `data:` URIs.<br>• `/hash` and `/cidr` consume smart input, but nothing routes there.<br>• The Inspector has a separate detector that disagrees with it, and three of its "Open in tool" targets drop the input. |
| X6 | **Smart paste UI** | A centred modal that steals focus. The 8s auto-hide timer is never cleared, so an older timer closes a newer suggestion. |
| X7 | **Pipeline** | One untyped in-memory value, lost on reload. No feedback on send and no indicator of what's in it. Only JWT, Base64, Hash, Formatters, URL Encode, Case Converter and Text Stats take part. The video hand-off shares the same slot, so a text "Read Pipeline" could receive a `{file}` object. A pinned Video Studio grabs and clears a recording meant for the main pane. |
| X8 | **Pin / split view** | The pinned page's title wins, and is restored stale on unpin. Both pages fight over the single AI context (unpinning wipes the main page's). Global listeners and duplicate element ids collide (QR download, PDF/Hex/EXIF/Video file inputs). Pins aren't persisted. The pin button shows on phones, where split view never renders. On touch devices the pin and star buttons are invisible (inline `opacity:0` beats the `(hover: none)` rule). Viewport media queries keep two columns inside the half-width pane. Shrinking below 1025px or unpinning silently destroys an active recording or export. |
| X9 | **AI: failure states** | See C4. A worker `ERROR` during chat leaves the status stuck on "Thinking…". Switching model mid-generation shows "ready" while the old model still answers. The worker doesn't queue loads or unload the previous engine (about 5 GB VRAM peak). `changeModel` sets `idle` even when WebGPU is unsupported. The saved model id isn't validated. Clear-cache uses the wrong IndexedDB names and wipes every model without asking. |
| X10 | **AI: panel and coverage** | No cancel for the 2.2 GB download. The assistant panel is a fixed 380px (wider than a phone), has no Escape, shows plain text instead of Markdown, and gives no "sent" feedback. Only 8 pages register AI context. |
| X11 | **Toasts and feedback** | `useToast` exists but **no page uses it**. About 38 hand-written copy buttons: none await or catch `clipboard.writeText` (so "Copied" shows even on failure), and about 14 give no feedback at all. 7 pages use blocking `alert()`/`confirm()`. Snippets and Favicon only log errors to the console, which production strips. |
| X12 | **Favorites** | Per-instance state with no sync, so it can't be reused (e.g. on Home) without drifting. |
| X13 | **Names** | "Private Toolkit" in the header, sidebar, `index.html`, `SEO.jsx`, `manifest.json`, the Home hero and `package.json`. "Vibe Toolbelt" in every page title, the README, Privacy/Terms, the AI system prompt and the VitePWA manifest. About 15 tools also have different names in the sidebar, tab title and heading (e.g. Cron: "CRON Parsing" / "CRON Parser" / "Cron Parser"). |
| X14 | **Page chrome** | No shared page header. Titles may be centred gradient `h2`s, unstyled `h1`s (from undefined classes) or missing. Max widths vary (800/900/1200/1400/none). 55 of 61 pages have no `<h1>`. |
| X15 | **Dead CSS classes** | Classes copied from a stylesheet that doesn't exist: `.tool-*`, `.section-title`, `.action-btn`, `.btn-primary`, `.drop-zone`, `.hover-bg`, `.responsive-stack`, and Tailwind names in Home. `.spin` and `@keyframes spin`/`pulse` only exist inside other components' inline `<style>` tags, so spinners only spin while ApiTester is mounted, and page styles override each other globally. |

### 4.3 Layout and responsive (checked by script at 375px)

| # | Issue |
|---|---|
| L1 | **Every route scrolls sideways by 5px**: the header brand plus the "AI Unavailable" and "100% Client-Side" badges don't fit. |
| L2 | **Content clipped, not scrollable:** `main { overflow: hidden }` (`Layout.jsx:136`) combined with `height: calc(100vh - 100px)` pages (Formatters, Converter, Markdown, Base64) and fixed-width grids (Inspector `minmax(350px)`, OTP, JWT, Home at 320px). Content that overflows can't be reached. |
| L3 | Page-specific overflow: Glass (466px panel), Case Converter (582px), Snippets (528px), Triangle (600px triangle at max size), EXIF (invalid CSS), API Tester (top bar never wraps; modals are fixed 400–700px), Chmod, CSV↔JSON, Text Stats and List Sorter (fixed two-column grids), Regex (fixed 280px cheat sheet). |
| L4 | Tablet widths (640–1024px) have no close button in the sidebar. Toolbars wrap awkwardly in the half-width pinned pane. |

### 4.4 Privacy, offline and accuracy of claims

The app advertises "100% Client-Side", "No data is sent to any server", "No external API calls" and offline use. Third-party requests that contradict this:

- **Google Fonts** on every page.
- **Monaco** from jsDelivr (Formatters); it also doesn't work offline.
- An **Unsplash** photo (Glass).
- **WebLLM** model files from Hugging Face and GitHub.
- Remote images in Markdown previews.
- API Tester requests, which are expected but not acknowledged anywhere.

The ffmpeg core and Monaco aren't cached for offline use. The Privacy page also leaves out API-tester history, collections and environments (which may contain tokens), the AI model cache and theme settings from its list of what's stored locally.

### 4.5 Performance (main thread)

These all block the UI:

| Tool | Cost |
|---|---|
| Regex Tester | every keystroke; catastrophic patterns take seconds |
| RSA key generation | 4096-bit ≈ 13 s |
| zxcvbn (Password) | 1000 characters ≈ 19 s |
| bcrypt | cost 16 ≈ 3.2 s; verify runs on every keystroke |
| Diff | 4 diffs per keystroke; Formatters' diff takes 15 s on 16k lines |
| Hash | 575 ms per keystroke on 5 MB |
| Faker | deep nesting produced 58 MB of JSON |
| Lorem | no cap on count |
| Base64 Image | 67 MB strings in a textarea |
| Image Converter | eager 1.35 MB `heic2any` import |

There is also no debounce on most live inputs.

### 4.6 Build, PWA, tooling, tests

| # | Finding |
|---|---|
| B1 | **Build:** `npm run build` passes. The service worker precaches 94 files (8.4 MB, including Faker's 2.8 MB), so every first visit downloads 8 MB in the background. |
| B2 | **Missing files:** PWA icons named in `vite.config.js` (`pwa-192x192.png`, `pwa-512x512.png`, `favicon.ico`, `apple-touch-icon.png`, `mask-icon.svg`) and `SEO.jsx` (`og-image.png`) don't exist. |
| B3 | **Manifests:** `index.html` links `public/manifest.json` first, so the generated VitePWA manifest is effectively dead. The favicon is Vite's default logo. |
| B4 | **Headers:** dev sends COOP/COEP; production (Azure SWA) doesn't. Verified that the built app loads and runs without them (`crossOriginIsolated` is false). The single-threaded ffmpeg core doesn't need SharedArrayBuffer, and the remote fonts and images send CORP. |
| B5 | **Possible `/api` conflict (suspected):** Azure SWA may reserve the `/api` prefix for Functions. Check whether refreshing `/api` on the deployed site returns 404; rename it to e.g. `/api-tester` if so. |
| B6 | **Tests:** the suite has 181 tests, all passing, but:<br>• The smoke test checks `toHaveTitle(/Private Toolkit/)`, which only passes because the index title shows before the page title loads.<br>• It never checks for the error screen.<br>• It tests `/csv`, which is a 404 (the real route is `/csv-json`).<br>• The cURL test checks substrings of invalid JavaScript.<br>• There's no coverage for light theme, contrast, mobile overflow or cross-page flows. |
| B7 | **Lint:** 259 problems. 146 come from the vendored `public/ffmpeg/ffmpeg-core.js`, which should be ignored. The rest are about 60 unused imports or variables and React-compiler warnings (setState in effects, use before declaration, impure render), plus Formatters' unreachable block and ImageConverter's async Promise executor. |
| B8 | **Dead code:** `src/components/Navbar.jsx` (never imported) and `debug_cidr.js` in the repo root (it references an undefined `Address6`). |
| B9 | **Licences and dependencies:** ua-parser-js v2 is AGPL-3.0 (v1 was MIT), which needs a licence check. `faker.internet.color()` is deprecated and removed in v10. |

### 4.7 Accessibility (automated count, all routes, desktop)

| Metric | Count |
|---|---|
| Form fields with no programmatic label | **145 of 153** |
| Icon-only buttons with no accessible name | 27 (Snippets 9, Faker 7, CSV↔JSON 4, …) |
| Clickable `div`s used as buttons (drop zones and similar) | 8 |
| File pickers that can't be reached by keyboard | Hex, EXIF, Video, Favicon, Color Blindness, Privacy Scanner, Image |
| Pages with no `<h1>` | 55 of 61 |
| Other | Nested `<button>` in HTTP Status; no `aria-pressed` on any toggle; no reduced-motion support; Home's "Quick Search" doesn't respond to Enter |

## 5. Recommended fix plan

The order matters. Fixing pages one by one before the shared pieces exist would mean touching every page twice, so:

1. **Phase 0 — crash and data-loss fixes.** Small, contained changes with an outsized effect:
   - C1–C3: key route boundaries by pathname, wrap the pinned pane, add a router `errorElement`, and fix the TextStats hook order.
   - C4: hide the AI modal on failure, show the error and offer cancel.
   - C5: advance `lastIndex` by code point and add a match budget or timeout.
   - C6: don't `preventDefault` in editable targets or on Tab, and scope Keycode capture.
   - C7: stringify EXIF values.
   - The Unix crash guard.
   - C9: check the ffmpeg exit code and empty output, and re-encode when stream copy isn't possible.
   - C10: revoke only object URLs that are no longer used.
   - C11: replace Curl's inline parser with the (fixed) shared one.
   - C12: collapse whitespace instead of deleting it.
   - C13: use pdf-lib's getters, and show an "unable to analyze" state instead of the false all-clear.
   - The QR capacity check.
   - Base64 decode-on-injection.
2. **Phase 1 — foundations (theme and shared UI).**
   - **Tokens:** surfaces (`--bg-input`, `--bg-inset`/`--bg-code`, `--bg-subtle`), `--on-primary` and `--primary-text` per theme and hue, `--success/--warning/--danger/--info` with light variants, and `--primary-rgb`/`--accent` derived from the hue (or use `color-mix()`).
   - **Global CSS:** `color-scheme` per theme; an inline `<head>` script that sets the theme before first paint; the header on tokens; the input rule scoped to text-like fields; `button { color: inherit }`; `accent-color: var(--primary)`; fix the CSS import order; global `.spin` and keyframes.
   - **Shared components:** `PageHeader`, `CopyButton`/`useCopy` (through toasts), `FileDropZone` + `useObjectURL` + `downloadBlob`, `SegmentedControl`, `SliderField`, `ColorField`, a theme-aware `CodeBlock`/`CodeEditor`, `StatusBanner`/`ErrorBanner`, `Modal`.
   - **Layout:** let `<main>` scroll (no fixed-height pages), make the header fit at 375px, add a tablet close button, and use container-aware split layouts.
3. **Phase 2 — cross-page features.**
   - **Palette:** send input only for smart suggestions, rank results, scroll the selection into view, focus immediately.
   - **Detection:** one shared detector for SmartPaste, the palette and Inspector. Timestamps before Base64, plus new rules for UUID, cURL, SQL, YAML, IP/CIDR, colours, SVG and data URIs.
   - **`useSmartInput`:** scoped to its own route, ignores empty input, and supports `mode` and an `onInject` callback.
   - **Pipeline:** typed (text vs media), with a visible indicator, a toast on send, and an optional session copy.
   - **Pin view:** title and AI context follow the focused pane; the pin is persisted; hidden on mobile; visible on touch.
   - **AI:** track the loaded model, use `engine.reload`, handle chat errors, and let the panel close with Escape, render Markdown and fit mobile widths.
   - **Brand:** one name everywhere.
   - **Feedback:** toasts instead of `alert()`.
4. **Phase 3 — page by page.** Go in health order (Broken → Major → Moderate → Minor) using each group file's fix sketches. Do related tools together so they share code:
   - API Tester and Curl (one tokenizer and generator);
   - Hash and HMAC (consider merging);
   - UUID and Nano ID (consider merging, and fix the ULID);
   - EXIF and Privacy Scanner (one metadata reader);
   - Formatters, Converter and Inspector (one XML/JSON toolkit);
   - Image Converter and Favicon (one encode/ICO helper).
5. **Phase 4 — tests and tooling.**
   - The smoke test should fail on the error screen and check real titles.
   - Fix `/csv`.
   - Add a light-theme contrast and 375px overflow sweep, plus cross-page flow tests (palette, smart paste, pipeline, pin).
   - Ignore the vendored ffmpeg file in ESLint.
   - Reconsider `continue-on-error` on the CI test job.
   - Delete the dead files.

### Decisions needed from you

*Settled with defaults on 2026-10-23. See [Status after the fixes](#status-after-the-fixes-2026-10-23).*

1. **Name:** "Vibe Toolbelt" or "Private Toolkit"?
2. **Light theme:** design it properly (new surface tokens and light code themes), or only make it readable?
3. **Privacy and offline:** self-host the fonts, bundle Monaco, and drop the Unsplash image so "100% client-side / offline" is true, or soften the claims?
4. **Overlapping tools:** merge Hash+HMAC, UUID+Nano ID and EXIF+Privacy Scanner, and re-file the sidebar categories (e.g. a "Generators" group, plus "Images & Files" instead of putting QR, PDF and Favicon under Converters)?
5. **Privacy Scanner:** build the advertised PII text scanner, or change the claims?
6. **AES:** move to AES-GCM + PBKDF2 (keeping a labelled legacy OpenSSL mode), or keep CryptoJS compatibility and fix the wording?

## How this audit was produced

1. All 62 page files and the shared components, hooks, contexts and utilities were read in full, in seven domain groups. Claimed bugs were reproduced where possible by running the page logic against the real installed libraries in Node, by server-rendering pages, or by headless browsers using the app's real CSS.
2. Every route was loaded in three configurations: dark at 1366px, light at 1366px, and dark at 375px mobile. Each load recorded crashes, console errors, failed requests, text below 3:1 contrast, dark "islands" in light mode, and horizontal overflow.
3. Contact sheets of all routes in both themes were reviewed by eye.
4. Cross-page flows were driven end to end: the palette, smart paste, the pipeline, pinning, favorites, the theme toggle and hue presets.
5. The production build was served without COOP/COEP headers and checked.
6. `npm run build`, `npm run lint` and the Playwright suite were run.

The verification scripts are not part of the repo.
