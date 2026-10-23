# Audit — Web & API

**Pages:** `/api` API Tester (+ `utils/codeGenerator.js`, `utils/curlParser.js`) · `/curl` · `/url` · `/ua` · `/cidr` · `/meta` · `/http-status` · `/urlencode`

Part of the [project audit](README.md). Each finding is labelled with **severity** (critical / high / medium / low) and **confidence**:
- *confirmed-by-running*: reproduced with the real code or libraries.
- *confirmed-by-reading*: the code path was traced in the source.
- *suspected*: needs a check in a real browser or device.

Line numbers refer to commit `a3c843b`.

**How it was verified:** Parsers and generators were run in Node: ip-address 10.1, ua-parser-js 2.0.8, and the cURL parser and code generators (generated shell run through bash against a stub `curl`). Button colours were measured in headless Chromium and WebKit.

---

### /api — `src/pages/ApiTester.jsx` (811 lines) + `src/utils/codeGenerator.js` (72) + `src/utils/curlParser.js` (56)

**What it does:**
- A `fetch()` client with 7 methods, a URL field and Params / Auth / Headers / Body tabs. A body is sent for every method except GET and HEAD.
- `{{key}}` environment variables are substituted at send time into the URL, header names and values, and the body.
- The params table and the URL query are kept in sync by hand-built string splitting (no `URL` object).
- The Auth tab (None / Basic / Bearer) rewrites an `Authorization` row in the headers table whenever it is edited.
- The response shows status, time and size, plus a Raw view (Prism, always using the JSON grammar) and a Preview (sandboxed `srcdoc` iframe, or `<img src={url}>` for image content types). Response headers are captured but never displayed.
- Saved in localStorage: history (method, URL and time only, de-duplicated, max 50), collections (full request), environments and the active environment id.
- Modals: Generate code (cURL / fetch / Python) and Import cURL (regex parser).

**Integrations:**
- `useLocalStorage` ×4. Only value setters are used, so the stale-closure functional-update issue is not triggered.
- `useTheme` is used only for the Preview iframe colours. The syntax theme is always dark.
- `useEscape` is used at page level and in each modal.
- No smart input, pipeline, AI context or toasts. The `{input}` that CommandPalette passes is ignored, which is harmless.
- Split-pane: the pinned copy keeps its own copy of all 4 stored values (see A12). The pinned pane has no ErrorBoundary, so A1 there brings down the whole app (React Router's default error screen) — confirmed-by-reading.
- COOP/COEP: they don't affect CORS-mode `fetch()`. They do block the `<img>` image preview and cross-origin subresources inside HTML previews in dev and `vite preview` only, so dev behaves differently from production.
- Suspected, needs checking in production: Azure Static Web Apps reserves the `/api` path prefix for Functions (the deploy workflow sets `api_location: ""`). Opening or refreshing `/api` directly may return 404 instead of the SPA.

**Bugs (functional):**
- **A1 — `ApiTester.jsx:513` — high — confirmed-by-running.** A JSON response that is a bare number or `true` (e.g. `42`) is passed to SyntaxHighlighter as a non-string child. The Raw tab (the default) then throws `TypeError: code.match is not a function`. The ErrorBoundary replaces the page and the unsaved request is lost. `0`, `false`, `null` and strings render fine.
- **A2 — `:206`, `:244-249` — high — confirmed-by-reading.** History stores only `{method, url, timestamp}`, but `loadRequest` runs `setHeaders([])`, `setParams([])` and `setBody('')`.
  - Clicking a history item silently deletes the current Content-Type, Authorization and body, while the Auth tab still shows "Bearer".
  - The params table is left empty for a URL that has a query, so the next param edit rebuilds the query from params only: `?q=test&page=2` becomes `?limit=`.
- **A3 — `:234-235`, `:247-248`, `:289`, `:293` — high — confirmed-by-reading.** Saved collection items hold references to the live `headers`/`params` objects, and `updateHeader`/`updateParam` change `n[i][f]` in place. After you save or load a request, later edits change the saved item in memory. The next `setCollections` (saving or deleting any item) writes those edits to storage, so saved requests change silently.
- **A4 — `curlParser.js:7-49` — high — confirmed-by-running.**
  - Chrome's "Copy as cURL" uses `--data-raw $'…'` whenever the body contains a newline, tab, `!` or `'`. That form isn't matched (line 31), so the body is dropped and the method stays GET.
  - The URL is the first quoted `http(s)://` string anywhere in the command (line 47). With `-d '{"callback":"https://hooks.example.org/x"}' https://api…` the URL becomes the callback. With an unquoted URL, an earlier `-H 'Referer: https://…'` is taken instead.
  - `-XPOST`, `-X delete` and `-X 'PUT'` are not recognised (line 11). `--data-binary`, `--json`, `-F`, `-u`, `-G`/`--data-urlencode` and `-I` are ignored.
  - In double-quoted bodies, the lazy `(.*?)\2` stops at the first `\"` (lines 31/36-38), so `-d "{\"a\":1}"` gives a body of `{\`. The bash `'\''` idiom truncates the body. Newlines in bodies are collapsed (line 7).
  - Round trip is broken: the default request → Generate cURL → Import gives the body `{   \`.
- **A5 — `codeGenerator.js:8-16` — high — confirmed-by-running.** All values go inside double quotes, the body only has `"` escaped, and the URL and headers are not escaped at all.
  - `$100` becomes `00`, and a Graph/OData URL with `?$select=subject&$top=5` becomes `?=subject&=5`.
  - JSON `"C:\\temp"` turns into a tab character.
  - Backticks or `$(…)` in a body run when the command is pasted (`` `whoami` `` ran in a test).
  - A header value containing `"` loses its quotes.
  - HEAD is emitted as `-X HEAD`, which makes curl wait for a body that never comes.
- **A6 — `codeGenerator.js:50-55` — medium — confirmed-by-running.** A JSON body is pasted as a Python literal, so `true`/`false`/`null` cause a `NameError`. A non-JSON body ending in `"` produces `"""say "hi""""`, a SyntaxError. Header values are not escaped (line 41).
- **A7 — `:80` — medium — confirmed-by-running.** `replaceAll(pattern, value)` treats `$` sequences in the value specially. An environment value `pa$$w0rd` is sent as `pa$w0rd`; `ab$&cd` becomes `ab{{tok}}cd`.
- **A8 — `:128-136` — medium — confirmed-by-running.** The Basic header is base64-encoded at edit time, so `{{user}}`/`{{pass}}` are encoded literally and never substituted. `btoa` throws on non-Latin-1 text (e.g. `用户`) inside onChange: the field updates but the old Authorization header stays.
- **A9 — `:104-126`, `:267` — medium — confirmed-by-running.**
  - Params → URL builds `k=v` without encoding: the value `rock & roll` reaches the server as `q=rock ` plus a key ` roll`.
  - URL → params decodes and then writes values back raw, so editing any param turns `q=a%26b%3Dc` into `q=a&b=c` and `x%2By` into a space. The `#hash` is dropped.
  - Params are only re-read when the URL contains `?` (line 125), so removing the query or importing a URL without one leaves stale params, which come back on the next param edit.
- **A10 — `:172`, `:208-218`, `:453` — medium — confirmed-by-reading.**
  - Every failure shows `Error: Failed to fetch` with a green "0 Network Error" status (`status < 300`). There is no hint about CORS, mixed content (an `http://` API from the https site), being offline, or the browser dropping forbidden headers (Cookie, sec-*).
  - A URL without a scheme (`api.example.com/users`) or with an unresolved `{{var}}` is fetched relative to the app. A GET then gets the SPA fallback: "200 OK" with the app's own index.html.
- **A11 — `:479-481` — medium — confirmed-by-reading.** The image preview is a second GET to the raw `url` from current state. It is unsubstituted and has no headers or auth, so it breaks for `{{base}}` URLs, protected images and POST responses, and shows the wrong image after the URL is edited.
- **A12 — persistence — medium — confirmed-by-reading.** Two tabs, or main pane plus pinned pane, each keep their own copy and overwrite each other's keys, so collections and environments get lost.
  - Crash path: copy A creates env X (active = X). Copy B edits another env, which rewrites `api-envs` without X while `api-active-env` stays X. After a reload, `activeEnv` (line 631) is undefined and opening Environments throws at line 706. This repeats every time until storage is cleared.
- **A13 — `:487` — low-medium — confirmed-by-reading.** The JSON preview injects the body into `srcdoc` without escaping. A string like `"<b>x</b>"` renders as HTML (inside the sandbox) instead of text. text/plain and XML are also rendered as HTML.
- **A14 — `:129`, `:258-275`, `:244-252` — low-medium — confirmed-by-reading.** The Auth tab isn't synced with the headers. After importing a cURL with an `Authorization` header, the tab still shows the old type, and touching it removes that header. Auth type and data are not saved or restored with collections.
- **A15 — `:34-35`, `:167-169` — low-medium — confirmed-by-reading.** The default `Content-Type: application/json` is sent on GET, which forces a CORS preflight; APIs that allow simple CORS requests but don't answer OPTIONS will fail. The sample JSON body is sent with DELETE and OPTIONS.
- **A16 — `:181-194`, `:512` — medium (performance) — confirmed-by-reading.** The whole response is re-highlighted with Prism on every render; the library component isn't memoised, so each keystroke anywhere re-highlights a multi-MB body. Binary bodies are decoded as UTF-8 and highlighted as JSON.
- **A17 — low.**
  - There is no cancel or timeout: a hung request leaves SEND disabled.
  - `time` is measured when headers arrive (line 173) and excludes the body download.
  - HTTP/2 responses have an empty `statusText`, so only "200" is shown.
- **A18 — `:773`, `:794-804` — low.**
  - Generated code contains raw `{{vars}}`.
  - Headers with an empty value are sent (line 157) but left out of the generated code.
  - The language `'fetch'` isn't a Prism language, so it gets no highlighting (confirmed).
  - The "Copied" state shows a Clock icon.
- **A19 — `:459`, `:777` — low.** The clipboard promise is never awaited, so "Copied" shows even when the copy fails.
- **A20 — `:501` — low.** Select-all checks only `ctrlKey`, so ⌘A on macOS selects the whole page.

**UX issues:**
- **Mobile / half width:**
  - The top bar (305-336) never wraps; at 375px the URL field shrinks to about 0.
  - `responsive-stack` (line 340) is defined nowhere. The only rule is in ExifViewer's style tag, uses the invalid property name `flexDirection`, and exists only while that page is mounted.
  - The modals are fixed at 400/500/600/700px with no `maxWidth`, so they are clipped off-screen.
- **Missing pieces:** no response-headers view, no credentials/cookies option, no clear-history, no confirmation on collection delete.
- **Small frictions:**
  - Import errors use `alert()`, and the import modal doesn't close when the overlay is clicked.
  - Save has no Enter shortcut and silently ignores an empty name.
  - Selecting an environment in order to edit it also makes it the active one.
  - History shows the time without the date.
  - The close buttons have no label, and the method select uses `appearance:none`, so it doesn't look like a dropdown.
- **Privacy:** tokens and Basic credentials (inside saved headers), environment values and URLs carrying tokens are kept in plain-text localStorage indefinitely, which clashes with the "Private Toolkit" branding.

**Theming issues:**
- Lines 471/480 (`#0d0d0d`) and 512/804 (`vscDarkPlus`) are dark regardless of theme, even though `theme` is available. Use `var(--bg-app)` and a light Prism style when `theme === 'light'`.
- Line 474: "Ready" is `--text-dim` at 30% opacity on near-black, which is invisible in light mode.
- Lines 677, 791 and 801: buttons with no `color` use the browser's default button text colour. Verified as rgb(0,0,0) on `--bg-panel` rgb(26,23,38), about 1.2:1, in Chromium and WebKit. In dark mode the close X icons and the code modal's "Copy" label are invisible.
- Lines 542/555 use `rgba(255,255,255,0.03)` (use `--bg-card`). Lines 343/446/681 use `rgba(0,0,0,.1/.2)` (use `--bg-secondary`).
- Lines 333/613/763 put white text on `--primary`. Contrast is 1.4–2.9:1 with the Emerald, Amber and Cyber Blue presets; this needs an `--on-primary` token.
- Line 439 uses `'monospace'` instead of `var(--font-mono)`.

**Fix sketch:**
- A1: pass `typeof b === 'string' ? b : JSON.stringify(b, null, 2)`.
- A2: store the full request in history, or load only method and URL and re-run `parseParamsFromUrl`.
- A3: `structuredClone` on save and load, and update immutably: `hs.map((h, j) => j === i ? {...h, [f]: v} : h)`.
- A4–A6:
  - Parse with a shell tokenizer (quotes, `$'…'`, `'\''`, line continuations) plus a flag table.
  - Generate single-quoted shell arguments (`'${s.replace(/'/g, "'\\''")}'`) and use `-I` for HEAD.
  - Emit Python via `json.loads(r'''…''')`.
  - Add generate → import round-trip tests.
- A7: `res.split(pattern).join(value)`.
- A8: build the Basic header at send time, after substitution, with UTF-8-safe base64 inside a try/catch.
- A9: sync through `URL`/`URLSearchParams`, protecting `{{…}}` placeholders; re-parse on every URL change, import and load; keep the hash.
- A10: require an absolute http(s) URL, warn on unresolved `{{…}}`, show a CORS/mixed-content explainer (optionally probe with `mode: 'no-cors'`), and colour status 0 red.
- A11: show the already-fetched data via `URL.createObjectURL(new Blob([buffer], {type}))`.
- A12: listen to `storage` events or use a shared store; fall back with `activeEnv ?? envs[0]` and repair the stored id.
- A13: escape HTML, and use a `<pre>` for non-HTML content.
- A14: work out the auth type from the existing header on import and load.
- A15: no default Content-Type on GET.
- A16: `useMemo` the formatted body, `React.memo` the highlighter, fall back to plain text above ~200KB, pick the grammar from the content type.
- A17: AbortController plus a Cancel button; status text from the HttpStatus table.
- A18–A20: substituted values in generated code, the same header filter as sending, `language="javascript"`, a Check icon, `await` the clipboard call with a catch, and `ctrlKey || metaKey`.

---

### /curl — `src/pages/Curl.jsx` (130 lines)

**What it does:**
- On every textarea change, regexes pull out the URL, method (substring checks), `-H` headers and a `-d`/`--data` body, and a template builds a `fetch()` snippet shown in a read-only textarea, with a Copy button.
- It does not use `curlParser.js` or `codeGenerator.js`.

**Integrations:** None.
- SmartPaste never sends cURL here. A DevTools cURL contains `Mozilla/` and is routed to /ua instead.
- In the pinned pane, `height: calc(100vh - 100px)` overflows.

**Bugs (functional):**
- **C1 — `:52` — critical — confirmed-by-running.** `.replace(/"([^"]+)":/g, '$1:')` removes the quotes from header names, so any hyphenated header (`Content-Type`, `X-Api-Key`) gives a SyntaxError. The sample in `tests/web.spec.js:31` produces invalid JS; the test passes only because it checks substrings.
- **C2 — `:44`, `:52` — critical — confirmed-by-running.**
  - The body regex `[^'"]+` stops at the first quote, so every JSON body becomes `JSON.stringify({)`.
  - Plain bodies become bare code: `JSON.stringify(simple_body)` is a ReferenceError, and `user=alice&pass=s3cret` is a SyntaxError.
  - Wrapping in `JSON.stringify` is wrong anyway; the body should be a string literal.
- **C3 — `:28-31`, `:44` — high — confirmed-by-running.**
  - `--data-raw` (what Chrome and Firefox emit) is not matched and doesn't switch to POST, so the request becomes a GET with no body.
  - `--data` on its own stays GET.
  - `--request PUT/DELETE/PATCH`, `-XPOST` and `-X HEAD/OPTIONS` all become GET.
- **C4 — `:34` — medium — confirmed-by-running.** Only `-H` with exactly one space is recognised; `--header` is dropped. A value containing the other quote character is cut (`"X-Name: O'Brien"` becomes `O`).
- **C5 — `:24`, `:50` — medium — confirmed-by-running.** A URL containing `'` (`?q=it's`) breaks the single-quoted string. The unquoted branch `http\S+` grabs the first "http" anywhere.
- **C6 — `:60-62` — low.** The catch can never fire, so there is no error state at all.
- **C7 — `:104` — low.** Copy gives no feedback and doesn't handle the clipboard promise.

**UX issues:**
- The heading says "Curl Converter" while the sidebar and page title say "Curl to Fetch".
- Only one output target, although `codeGenerator.js` already supports curl, fetch and Python.
- The placeholder suggests the `-d '{...}'` form, which is exactly what fails.

**Theming issues:** Lines 116/119 use `#1e1e1e`/`#d4d4d4`, a dark block in light mode; line 85 uses `rgba(0,0,0,0.2)`. Use `var(--bg-app)` / `var(--text-main)` or a shared theme-aware code block.

**Fix sketch:** Remove the inline parser and use `parseCurl()` (with the A4 fixes) followed by `generateCode(parsed, 'fetch')`, which already produces valid JS. Make the test assert `new Function(code)` succeeds.

---

### /url — `src/pages/UrlParser.jsx` (104 lines)

**What it does:** Runs `new URL(input)` on every change. It shows Protocol, Host, Hostname, Port, Pathname, Hash and Origin (empty rows hidden) and a query-parameter list, or "Invalid URL".

**Integrations:**
- `useSmartInput` parses immediately on injection, so SmartPaste URLs work.
- CommandPalette bug: typing "url" and picking URL Parser fills the box with `url` and shows a red "Invalid URL" on arrival.
- Pinned: any smart navigation to *another* tool (e.g. a pasted JWT going to /jwt) also overwrites the pinned parser's input. `useSmartInput` doesn't check the pathname, so the pinned copy reads the same `location.state`.

**Bugs (functional):**
- **U1 — `:23-26` — medium — confirmed-by-running.** Params are collected into an object, so repeated keys collapse: `?tag=a&tag=b` shows only `tag=b`.
- **U2 — `:74-76` — low-medium — confirmed-by-reading.** The value span in a `space-between` flex row has no `minWidth: 0` or word-break. Long unbroken values (a token in the hash, a long host) overflow and are clipped by `main { overflow: hidden }`. The responsive test measures `main`, so it can't catch this.
- **U3 — `:28-37` — low.** Username/password and the raw `search` string are never shown.

**UX issues:** No copy buttons (`Copy` is imported but unused). A URL without a scheme just says "Invalid URL" with no hint to add `https://`. Whitespace-only input shows an error.

**Theming issues:** None beyond the inline `#ef4444` error colour.

**Fix sketch:** Use `[...url.searchParams]` as an array keyed by index; add `minWidth: 0; overflowWrap: 'anywhere'`; add username/password/search rows; offer an `https://` prefix.

---

### /ua — `src/pages/UserAgent.jsx` (109 lines)

**What it does:** A textarea prefilled with `navigator.userAgent`, parsed live with `new UAParser(ua).getResult()`. Four cards: Browser, OS, Engine, and Device (with CPU architecture). A "Use My Current UA" button.

**Integrations:**
- `useSmartInput` parses on injection.
- The ua-parser-js v2.0.8 API is used correctly (verified). When the string equals `navigator.userAgent`, v2 also applies its built-in Brave/iPad/mobile detection.
- ua-parser-js v2 is licensed AGPL-3.0-or-later (v1 is MIT); this needs a licensing review.

**Bugs (functional):**
- **UA1 — `:12` with CommandPalette — medium — confirmed-by-reading.** The palette always sends `{input: query}`. Opening it and clicking "User Agent" without typing sends `''`, which `useSmartInput` accepts (it only checks for undefined/null). Your own UA is wiped and the page goes blank. Typing "ua" first parses the word "ua".
- **UA2 — `:83` — medium — confirmed-by-running.** `device.type || 'Desktop'` labels anything unrecognised as Desktop. Googlebot, `curl/8.7.1` and "user agent" all show "Type: Desktop" with every other field "-".
- **UA3:** The pinned copy is overwritten by smart navigation to other tools (same mechanism as /url).
- **UA4:** Pasting a Chrome "Copy as cURL" command on a page routes it here (rule 5 in `analyzers.js`), and the whole command is parsed as if it were a UA.

**UX issues:**
- In Chromium, "Use My Current UA" shows the reduced UA (macOS 10.15.7, "Windows 10" on Windows 11). `getResult().withClientHints()` would give real values.
- No empty state, no copy/export (`Copy` imported but unused), no bot detection (v2 has extensions for this).

**Theming issues:** The card icon colours (64/70/75/80) are hardcoded; Engine uses the error red `#ef4444`.

**Fix sketch:** Ignore empty input in `useSmartInput` (and fix the palette); show "Unknown" unless an engine or OS was detected; optionally use client hints for your own UA.

---

### /cidr — `src/pages/CidrCalculator.jsx` (220 lines)

**What it does:** Tries `Address4` + `isCorrect()`, then `Address6` + `isCorrect()`. Shows Start, End, Total Hosts, and for IPv4 also Netmask and Broadcast, with a copy button per row and a fixed "Valid Block" banner. A bare IP is treated as /32 or /128.

**Verified with ip-address 10.1.0** (start/end/count are correct for every accepted input):

| Input | Result |
|---|---|
| `0.0.0.0/0` | 0.0.0.0–255.255.255.255, 4,294,967,296 hosts, Netmask `0`, rendered as "-" |
| `10.0.0.0/8` | 10.0.0.0–10.255.255.255, 16,777,216, Netmask `8` |
| `192.168.1.10/24` | .0–.255, "256", Netmask `24` |
| `10.0.0.0/31` | .0–.1, 2, Broadcast .1 |
| `10.0.0.5/32`, `10.0.0.5` | a single address, 1 |
| `2001:db8::/32`, `::/0`, `fe80::1/64` | correct |
| `not-an-ip`, `/33`, `256.1.1.1/24`, `"10.0.0.0/16 "`, trailing newline | rejected |
| `2001:DB8::/32`, `2001:0db8::/32`, `2001:0db8:85a3:0000:0000:8a2e:0370:7334/64`, `2001:db8:0:0:0:0:0:0/48`, `::ffff:192.168.1.1/120` | rejected, even though `Address6.isValid()` returns true |

**Integrations:** `useSmartInput` is used, but no analyzer routes IPs here, so the only source is the palette query (e.g. "cidr"), which then fails silently. The pinned copy is overwritten the same way as /url.

**Bugs (functional):**
- **CI1 — `:195` — high — confirmed-by-reading.** The error message is rendered inside `{result && …}`, and every error path sets `result` to null. Invalid input shows nothing at all.
- **CI2 — `:30`, `:50` — high — confirmed-by-running.** `isCorrect()` means "already written in canonical form", not "valid". Valid IPv6 that is uppercase, has leading zeros, is uncompressed or embeds IPv4 is rejected (see table).
- **CI3 — `:16`, `:29`, `:38` — medium — confirmed-by-running.** Only the emptiness check trims, so pasted values with a trailing space or newline are rejected silently.
- **CI4 — `:82` — medium — confirmed-by-running.** "Netmask" shows `subnetMask`, which is the prefix length (24), not 255.255.255.0. For /0 the value 0 is falsy, so the row shows "-" with no copy button (131/133).
- **CI5 — `:73-83` — medium — confirmed-by-running.** "Total Hosts" counts all addresses (256 for a /24; only 254 are usable), and the usable range is never shown. /31 and /32 report a "Broadcast" address, though a /31 has none (RFC 3021).
- **CI6 — `:111` — low.** `ResultRow` is declared inside the component, so every render creates a new component type and remounts all rows.
- **CI7 — `:107` — low.** Copy gives no feedback and doesn't handle the clipboard promise.

**UX issues:**
- The classes `.tool-title`, `.tool-icon`, `.tool-desc`, `.section-title` and `.action-btn` are defined nowhere. The page renders an unstyled h1, unlike every other page.
- Three different names: "IP / CIDR" (sidebar), "CIDR Calculator" (title), "IP / CIDR Calculator" (heading).
- The fixed success banner adds nothing.
- The IPv6 host count has no thousands separators.
- There is no hint when a bare IP was treated as /32.

**Theming issues:** Line 177 uses `var(--primary-light)`, which is undefined; the badge background was verified transparent. Use `--primary-glow`.

**Fix sketch:**
- Validate with `s = input.trim()`, then `Address4.isValid(s)` / `Address6.isValid(s)`, and render the error outside the result block.
- Dotted mask: `Address4.fromBigInt(((1n<<32n)-1n) ^ ((1n<<BigInt(32-p))-1n)).correctForm()` (verified: gives `255.255.255.0`).
- Usable range from `startAddressExclusive()` / `endAddressExclusive()`, with special cases for /31 and /32.

---

### /meta — `src/pages/MetaTags.jsx` (105 lines)

**What it does:** Inputs for title (maxLength 60), description (160), keywords and image URL. A live template prints the title, primary, Open Graph and Twitter tags in a `<pre>`, with a Copy button. There is no preview, so COEP doesn't matter here today.

**Integrations:** None. The page does not use `SEO.jsx`; only Home does. About `src/components/SEO.jsx`:
- The tags it injects through Helmet are invisible to link-preview crawlers that don't run JavaScript.
- `image="/og-image.png"` is relative, and that file is not in `public/`.
- It uses `name="twitter:*"`; MetaTags emits `property=`.
- Its title suffix "Private Toolkit" doesn't match `useDocumentTitle`'s "Vibe Toolbelt".

**Bugs (functional):**
- **M1 — `:7-14`, `:26`, `:30`, `:37` — high — confirmed-by-reading.** `author` and `url` exist in state and in the output but have no inputs, so `author`, `og:url` and `twitter:url` are always empty.
- **M2 — `:21-40` — medium — confirmed-by-running.** Values are not escaped: `Use "quotes" here` produces `content="Use "quotes" here"`, which ends the attribute early. `&` and `<` in the title are not escaped either.
- **M3 — low.** Empty fields still produce empty tags; it uses `property="twitter:*"`, plus a non-standard `<meta name="title">` and no canonical link.

**UX issues:** `maxLength` silently cuts off pasted text, although 60/160 are guidelines and should be a warning. Copy gives no feedback. No search or social-card preview.

**Theming issues:** Line 93 uses `var(--text-code)`, which is undefined.

**Fix sketch:** Add Author and URL inputs; escape `&`, `"` and `<`; emit only non-empty tags; switch to soft length counters.

---

### /http-status — `src/pages/HttpStatus.jsx` (191 lines)

**What it does:** A static list of 46 codes, search across code/name/description, category filter chips, click a row to expand its description, and copy "code name".

**Integrations:** None.

**Bugs (functional):**
- **H1 — `:137-156` — high (default theme) — confirmed-by-running in Chromium and WebKit.** Each row is a `<button>` with no `color`. `global.css` doesn't set `color: inherit` on buttons and no `color-scheme` is declared, so the status name falls back to black, rgb(0,0,0), on the dark panel (about 1.2:1). In dark mode every status name is unreadable.
- **H2 — `:137`, `:170` — medium — confirmed-by-reading.** A button is nested inside a button. This is invalid HTML, and screen readers treat a button's contents as plain content, so the copy button isn't exposed.
- **H3 — `:5-57`, `:94` — low-medium.** The page claims "all" status codes but is missing 205, 208, 226, 300, 305, 416, 417, 421, 423, 424, 426, 428, 431, 506, 508 and 510. 413 and 422 use pre-RFC 9110 names (current: "Content Too Large", "Unprocessable Content").
- **H4 — `:83-87` — low.** The copy timers are never cleared, so copying a second code within 2s clears its checkmark early.
- **H5 — `:76` — low.** The search query isn't trimmed.

**UX issues:** The expand button has no `aria-expanded`. All 46 rows use `backdrop-filter`, which costs performance when scrolling.

**Theming issues:**
- Lines 112/119 use `rgba(255,255,255,0.03)` for chips; use `--bg-card`.
- In light mode the category colours on white are low contrast: `#f59e0b` 2.15:1, `#22c55e` 2.28:1.

**Fix sketch:** Add `color: var(--text-main)` to the row, or better, a global `button { color: inherit }` plus a `color-scheme` per theme. Make the row a div with sibling expand and copy buttons. Fill in the missing codes.

---

### /urlencode — `src/pages/UrlEncode.jsx` (161 lines)

**What it does:** Four modes (encodeURI, decodeURI, encodeURIComponent, decodeURIComponent), live conversion, Swap, Clear, Copy with feedback, and the URIError message shown in the output area.

**Integrations:** Pipeline read and send are wired correctly ("Read" only appears when there is data; "Send" is disabled when the output is empty). Two copies (pinned) don't conflict.

**Bugs (functional):**
- **E1 — `:36-42` — low-medium — confirmed-by-reading.** Swap copies the output even when it is empty because of an error. `%E0%A4%A` gives "URI malformed"; pressing Swap then sets the input to empty and your text is lost.
- **E2 — `:15`, `:17` — low — confirmed-by-running.** The descriptions are wrong: encodeURI does encode `[` and `]` (`%5B%5D`), and encodeURIComponent leaves `!*()'` unencoded rather than "everything".
- **E3 — `:44-48` — low.** "Copied!" is shown without waiting for the clipboard call to succeed.

**UX issues:** There is no form-encoding (`+` as space) mode, so `decodeURIComponent('a+b')` stays `a+b`. decodeURI leaving `%2F` / `%3F` / `%26` / `%23` encoded isn't explained. "Send to Pipeline" gives no feedback.

**Theming issues:** Line 69 uses `rgba(255,255,255,0.03)` (use `--bg-card`); line 152 uses `rgba(0,0,0,0.15)` (use `--bg-app`); line 136 is white on `--primary`.

**Fix sketch:** Disable Swap on error or empty output; correct the descriptions; add a form-encoding mode.

---

### Group-level patterns

1. **Two cURL parsers and two fetch generators.** Curl.jsx's inline regexes duplicate `curlParser.js` and `codeGenerator.js` and do worse; codeGenerator's fetch output is valid JS. Build one shared module with a proper shell tokenizer and correct shell/JS/Python escaping, used by both /curl (multiple output targets) and the API tester's Import and Generate. Add round-trip and "output actually parses" tests.
2. **`useSmartInput` (affects /url, /ua, /cidr).** The palette sends `{input: query}` even for plain tool picks. Every mounted consumer, including the pinned copy, consumes navigation state meant for any route. Fix it once: the palette sends input only for smart suggestions, and the hook takes its own path and ignores state when `pathname` differs and when the input is empty. `analyzers.js` has no cURL or IP detection, so cURL commands go to /ua and IPs never reach /cidr.
3. **Copy.** There are 8 separate copy handlers; none handle the clipboard promise, and feedback is inconsistent (Check icon, Clock icon, or nothing). UrlParser and UserAgent import `Copy` but have no copy button. Make a shared `<CopyButton>` using the existing but unused `useToast`.
4. **Button text colour.** With no `button { color: inherit }` and no `color-scheme`, button text is black on dark backgrounds (HttpStatus rows, ApiTester modals, likely other pages too). One global CSS fix covers it.
5. **Undefined tokens and classes, plus dark-only colours.** Undefined here: `--primary-light`, `--text-code`, `.responsive-stack`, `.tool-*`, `.section-title`, `.action-btn`. Recurring dark-only literals: `#0d0d0d`, `#1e1e1e`, `vscDarkPlus`, `rgba(255,255,255,.03)`. A theme-aware `<CodeBlock>` (ApiTester, Curl, MetaTags) plus `--danger`, `--success` and `--on-primary` tokens would remove most of them.
6. **Modals.** ApiTester's four overlays are hand-written with fixed pixel widths, inconsistent overlay-click and Escape behaviour, and no focus trap or `aria-modal`. Use one shared `<Modal>`.
7. **Page chrome is inconsistent.**
   - Headings: centred gradient h2, CIDR's unstyled h1, or none.
   - Max widths: 800, 900, 1200, 1400, or none.
   - Names don't match between sidebar, title and heading (Curl, CIDR, URL Encode).
   - Errors are shown as ad-hoc `#ef4444` text, not at all (CIDR), or via `alert()` (ApiTester).
   - Labels are not linked to their inputs on any page.
8. **Query-string handling three ways.** UrlParser collapses into an object, ApiTester joins strings by hand, UrlEncode uses the raw functions. Use one shared helper that keeps repeated keys and preserves encoding.
9. **Status codes.** HttpStatus's `STATUS_CODES` could supply status text in the API tester, where HTTP/2 responses have none.
10. **Split pane.** Pages that save to localStorage (ApiTester) or read router state (`useSmartInput`) misbehave when mounted twice. The pinned pane has no ErrorBoundary, so a single page crash (A1) takes down the whole app.
