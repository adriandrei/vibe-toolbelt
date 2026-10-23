# Audit — Converters & formatters

**Pages:** `/formatters` · `/converter` Universal Converter · `/type-converter` JSON to Type · `/csv-json` · `/markdown` · `/base64` · `/html-entity` · `/number-base` · `/hex` Hex Viewer

Part of the [project audit](README.md). Each finding is labelled with **severity** (critical / high / medium / low) and **confidence**:
- *confirmed-by-running*: reproduced with the real code or libraries.
- *confirmed-by-reading*: the code path was traced in the source.
- *suspected*: needs a check in a real browser or device.

Line numbers refer to commit `a3c843b`.

**How it was verified:** Each page's conversion functions were run verbatim in Node. The real page components were also built with Monaco and AI stubbed, then measured in Playwright inside a copy of Layout's `<main>`.

---

### /formatters — src/pages/Formatters.jsx (396 lines)
**What it does:**
- It has three tabs: JSON, SQL and XML. There are two Monaco editors: input (editable) and output (read-only). Both are hardcoded to `vs-dark`. Monaco loads at runtime from jsDelivr, using the loader's default path `cdn.jsdelivr.net/npm/monaco-editor@0.55.1`, because there is no `loader.config`.
- JSON: `JSON.parse`, then an optional JMESPath filter (`jmespath.search`), then `JSON.stringify` with indent 2 (prettify) or 0 (minify).
- SQL: `sql-formatter` v15 with 12 dialects (all of them valid in 15.7), `keywordCase:'upper'` and `tabWidth:2`. There is no minify.
- XML: a regex pretty-printer (`formatXml`, which outputs `\r\n`) and a `>\s*<` minifier. There is no validation.
- Formatting only runs when you click "Process". There is also a 500 ms debounced auto-run when indent, query, mode or dialect changes; typing in the input never triggers it.
- The output has Code/Diff views. Diff is DiffViewer's split view of input vs output. Copy is only available in Code view.

**Integrations:**
- **Smart input** `{input, mode}` (L44): it is connected, but injected JSON is never formatted (F1). No producer sends `mode`, so that branch is dead code.
- **Command palette:** picking Formatters again while already on it replaces the open document with the search text. Confirmed by running: the input became `"form"`.
- **Pinned pane:** a pinned Formatters also consumes smart input meant for the routed page. Confirmed by running: it took the base64 text that was pasted for /base64.
- **Pipeline:** Send ships `output` (L327), which can be stale (F4). Read calls `setInput` (L269) and does not format. Nothing checks the payload type; L59 `input.trim()` sits outside the `try` and would throw on an object.
- **AI context:** the deps `[input, output]` match `getContext`, so there is no stale closure. The context leaves out mode, dialect and error, and after an error it carries the stale output.
- **DiffViewer:** used as `viewMode="split"` inside a `height:100%; overflow:hidden` wrapper (L367). See F7 and F8.

**Bugs (functional):**
- **F1 (medium, confirmed-by-running) L101–110.** The auto-run effect does not depend on `input`, and on mount it sees `''`. JSON that arrives from SmartPaste or the palette shows in the editor, but the output is still empty after 1.3 s.
- **F2 (high on phone, tablet and short laptop screens; confirmed-by-running in a copy of Layout's `main`) L120.** The page uses `height: calc(100vh - 100px)`. Layout's `main` has `overflow:hidden`, and Monaco has `minHeight: 300px`. Together, content that doesn't fit is clipped and you can't scroll to it.
  - At 375×812 the Output panel starts at y=791 and 338 px of it is clipped, so it is essentially invisible.
  - At 1024×768, 337 px of the output is clipped.
  - At 1366×657, 37 px of the Process button is clipped.
- **F3 (medium, confirmed-by-running) L129/L144/L159.** Clicking any mode tab, even the one already active, clears the input. For example, paste SQL while on the JSON tab, click SQL, and the text is gone.
- **F4 (medium, confirmed-by-running) L66–70 and L78–81.** A JSON or query error sets `error` but keeps the previous `output`.
  - Copy stays visible (L328 only checks `output && viewMode==='code'`), and "Send to Pipeline" sends the previous result while the error is on screen.
  - Clear (L271) also leaves the output in place.
- **F5 (low, confirmed-by-running) L101–110.** The debounce captures `handleFormat` from the render where the toggle changed. If you edit the input within 500 ms of toggling, the old input gets formatted.
- **F6 (medium, confirmed-by-running) formatXml L19.** The regex `/^<?\w[^>]*[^\/]$/` needs element names of at least 2 characters, so single-letter elements never indent.
  - `<a><b>t</b><c>x</c></a>` comes out flush-left.
  - `<root><a><b>1</b></a></root>` puts `</a>` at level 0.
  - CDATA containing `<` or `>` breaks the indentation that follows it.
  - Invalid XML (`<root><a>1</b></root>`) is "formatted" without any error.
  - Minify drops meaningful spaces between elements: `<b>a</b> <i>b</i>` becomes `<b>a</b><i>b</i>`.
- **F7 (medium, confirmed-by-running) L367.** With `overflow:hidden` on the wrapper and no scroll inside DiffViewer, an 80-key diff is 6.4k px tall but only about 0.9k px can be seen. In split view the lines use normal `white-space`, so indentation collapses — and indentation is exactly what a formatter changes.
- **F8 (medium, confirmed-by-running in V8).** Opening Diff after re-indenting is quadratic in jsdiff. Going from 4-space input to 2-space output takes about 3.9 s for 8k lines and 15.9 s for 16k lines. DiffViewer runs `diffLines` twice (once per memo), and runs it again on every keystroke while Diff is open, because `oldText` is the input.
- **F9 (medium, confirmed-by-running).** The JSON round trip silently changes data, with no warning:
  - `12345678901234567890` becomes `12345678901234567000`.
  - `1.0` becomes `1` and `-0` becomes `0`.
  - Integer-like keys are reordered: `{"b":1,"2":2,"1":3}` becomes `{"1":3,"2":2,"b":1}`.
  - Duplicate keys collapse.
- **F10 (medium, confirmed-by-running) L35.** The default dialect `'sql'` turns Postgres `data->>'name'` into `data - > > 'name'`, which is broken SQL. Other dialect-specific syntax (`::int`, `$1`, `[col]`) fails with "Parse error" but gives no hint to switch dialect.
- **F11 (medium, confirmed-by-reading).** Monaco comes from a CDN. Workbox has no `runtimeCaching`, so offline or as an installed PWA both editors stay on "Loading..." forever. This also contradicts the PrivacyBadge text "No data is sent to any server": it is a third-party request, though it carries no user data.

**UX issues:**
- The dialect `<select>` (L178) picks up the global `width:100%`. It takes a full row by itself, and the divider at L198 ends up alone on a third row (screenshot-confirmed).
- Toggles auto-format but typing doesn't, so Process is the only trigger after a paste.
- Diffing input against output is mostly noise: minified → pretty shows "1 line removed, N added", and the `\r\n` from `formatXml` makes every line differ.
- JMESPath errors are raw parser messages. For example, `first-name` gives "Unexpected token type: Number, value: NaN" with no hint to quote the key.
- Indent is fixed at 2, and there is no download.

**Theming issues:**
- L281 and L375 `theme="vs-dark"`: the editors stay dark in light mode. Use `useTheme().theme==='light' ? 'light' : 'vs-dark'`; the prop updates live.
- L209 and L223: the active toggle uses `rgba(255,255,255,0.1)`, which is invisible in light mode (measured background 252 vs 251.7). Use `var(--primary-glow)`.
- L351 `rgba(0,0,0,0.2)`, L332/L338 `#10b981`, L353/L362 `#ef4444`: use tokens (`--danger`, `--success`).
- The select at L178 is affected by the global input rule; add `width:'auto'`.

**Fix sketch:**
- **F1:** after a smart or pipeline injection, run `handleFormat`, or add `input` to the debounce deps.
- **F2:** use `minHeight` instead of `height`, or only fix the height above 1025 px, and let `main` scroll.
- **F3:** change mode without clearing the input.
- **F4:** call `setOutput('')` on every error path and on Clear, and disable Copy/Send while `error` is set.
- **F5:** keep the latest input in a ref.
- **F6:** validate with `DOMParser` (check for `parsererror`) and pretty-print by walking the DOM; output `\n`.
- **F7:** give the wrapper `overflow:auto` and DiffViewer lines `whiteSpace:'pre'`.
- **F8:** call `diffLines(a, b, {timeout: 500})`, compute only the active view, and debounce.
- **F9:** detect lossy numbers (compare the source digits with the re-stringified ones) and warn.
- **F10:** show a dialect hint on parse errors, or make PostgreSQL the default.
- **F11:** `import * as monaco from 'monaco-editor'; loader.config({ monaco })`, plus Vite worker setup.

### /converter — src/pages/Converter.jsx (199 lines)
**What it does:**
- The page is titled "Universal Converter" (the sidebar calls it "JSON <> YAML"). It has From/To selects for JSON, YAML, TOML and XML, converts live on every keystroke inside an effect, and has Swap, Copy and Clear.
- Parsing:
  - JSON uses `JSON.parse`.
  - YAML uses js-yaml v4's `yaml.load`. It is safe (`!!js/function` is rejected), handles anchors and merge keys, and turns timestamps into `Date`.
  - TOML uses `toml.parse` from toml@3, which implements TOML 0.4.
  - XML uses a custom `xmlToJson` built on DOMParser.
- Output: JSON with indent 2, `yaml.dump`, and a custom single-line `jsonToXml` wrapped in `<root>`. The TOML option is just a hardcoded message.
- Verified OK: JSON→YAML→JSON is lossless for strings like `'yes'`, `'0123'`, `'2024-01-01'`, multi-line text and `'a: b'`. Anchors and merge keys expand correctly into JSON. Multi-document YAML gives a clear error.

**Integrations:** none — no smart input, pipeline or AI.

**Bugs (functional):**
- **C1 (medium, confirmed-by-running) L92–94.** The `catch` doesn't clear `right`. The output keeps the last good result (for example `a: 1`) while the input is invalid. Copy (L158) copies it, Swap (L97–102) moves it into the input, and the error banner (L179–194) covers the bottom of the output.
- **C2 (medium, confirmed-by-running) L24.** There is no check for `parsererror`. Invalid XML turns Chrome's error page into JSON, for example `{"parsererror":{"h3":[…],"div":"error on line 1 at column 14…"},"a":""}`. Plain text becomes `{"body":{"parsererror":…}}`. No error is shown, and this happens on every keystroke while you type XML.
- **C3 (medium, confirmed-by-running) L27–46.** `xmlToJson` loses data:
  - Attributes: `<a href="x">link</a>` becomes `"link"`.
  - CDATA: `<a><![CDATA[x<y]]></a>` becomes `{}`.
  - Text in mixed content: `<p>Hello <b>World</b></p>` becomes `{"b":"World"}`.
  - Text next to a comment becomes `{}`.
  - The root element's name is lost, empty elements become `{}`, and all values become strings.
- **C4 (low, confirmed-by-running) L39.** `if (obj[name])` runs on a plain `{}`, so element names that match prototype members collide. `<constructor>x</constructor>` becomes `{"constructor":[null,"x"]}`, and the content of `<__proto__>` is lost.
- **C5 (medium, confirmed-by-running) L8–20.** `jsonToXml`:
  - Doesn't escape text: `a < b & c` goes out as-is, so the XML isn't well-formed and a JSON→XML→JSON round trip fails.
  - Doesn't sanitize element names: `<first name>`, `<2nd>`, `<@id>`.
  - Gives a top-level array several root elements: `<root>1</root><root>2</root>`.
  - Flattens nested arrays (`[[1,2],[3]]` becomes three `<m>`), drops empty arrays, and writes `null` as the text "null".
- **C6 (medium, confirmed-by-running) L76.** toml@3 rejects valid TOML 1.0: dotted keys (`a.b = 1`), local dates (`d = 1979-05-27`) and mixed-type arrays.
- **C7 (low, confirmed-by-running) L87.** TOML appears as a target (L107, L133), but the output becomes the message "TOML Export not supported…". Swap then feeds that sentence back in as TOML input, which fails to parse.
- **C8 (low, confirmed-by-running) L75.** Dates change form: `released: 2024-01-01` becomes `"2024-01-01T00:00:00.000Z"` in both JSON and YAML output. YAML→YAML also renames anchors to `&ref_0` and expands merge keys.

**UX issues:**
- The sidebar label "JSON <> YAML" doesn't match the page, which is "Universal Converter" with four formats.
- The selects (L116, L128) are stretched by the global `width:100%`; each one measured 635 px wide.
- Copy gives no feedback and doesn't catch failures. Trash (L143) and Swap (L124) are icon-only buttons with no label.
- XML output is one line, there is no indent option, and every keystroke re-parses the whole document.

**Theming issues:**
- L148 and L172 `rgba(0,0,0,0.2)`: use `var(--bg-app)`.
- L173, L185–187: hardcoded red values; use a `--danger` token.
- Add `width:auto` to the selects.

**Fix sketch:**
- **C1:** clear or dim `right` on error, and disable Copy and Swap while there is an error.
- **C2:** if `getElementsByTagName('parsererror').length` is non-zero, throw.
- **C3 and C4:** map attributes to `@attr` and text/CDATA (nodeType 3 or 4) to `#text`, and use `Object.hasOwn` or `Object.create(null)`; or use fast-xml-parser.
- **C5:** escape `& < >` (and quotes in attributes), sanitize names, wrap arrays in `<item>`, and pretty-print.
- **C6 and C7:** switch to `smol-toml` (TOML 1.0, with `stringify`), or remove TOML from the target list.
- **C8:** use `yaml.load(s, {schema: yaml.CORE_SCHEMA.extend({implicit: [yaml.types.merge]})})`. Verified: this keeps dates as strings and still supports `<<`.

### /type-converter — src/pages/TypeConverter.jsx (327 lines)
**What it does:**
- A prefilled JSON textarea is parsed live with `useMemo` and shows a valid/invalid badge.
- Targets: TypeScript interfaces, Go structs (with `json` tags; numbers become `float64`), and JSON Schema draft-07 (every key is required).
- Arrays are typed from their first element only. `null` becomes `any` / `interface{}` / `{"type":"null"}`.
- There is a Copy button, labelled "Copy Schema" for every target.

**Integrations:** AI context `{input, output}` with deps `[jsonInput, conversionResult]`. This is correct; there is no stale closure. No smart input or pipeline.

**Bugs (functional):**
- **T1 (high, confirmed-by-running) L54/L108.** A top-level array (the usual API response) is treated as an object:
  - `[{"id":1,…},{"id":2,"extra":true}]` produces `export interface RootObject { 0: 0; 1: 1; }` plus `export interface 1 {…}`.
  - In Go it produces `type 1 struct`.
  - Both are invalid code. JSON Schema handles this case correctly.
- **T2 (medium, confirmed-by-running).** Keys are neither quoted nor cleaned up:
  - TS: `first-name: string;`, `last name:`, `2fa:` and `a.b:` are syntax errors, and a nested key produces `export interface First-name`.
  - Go: `Last name string`, `2fa bool`, `$ref string` and `A.b float64` are invalid.
- **T3 (medium, confirmed-by-running) L62.** `_id` becomes the field `id`, which is unexported in Go. `encoding/json` silently ignores unexported fields.
- **T4 (medium, confirmed-by-running) L90.** Boolean arrays produce `[]boolean`, which is a Go compile error.
- **T5 (medium, confirmed-by-running) L34/L42/L95.** Type names come from the key alone, so they collide. Two different `profile` objects produce two `Profile` declarations: TS merges them into one interface that requires both sets of fields, and Go fails with "redeclared".
- **T6 (medium, confirmed-by-running) L29–39, L121.** Only `[0]` is inspected:
  - `[1,"a",true]` becomes `number[]`.
  - `[{a:1},{b:"x"}]` only gets `a`.
  - `[[1,2],[3]]` becomes `interface NestedItem {0:number;1:number}` (Go: `0 float64`).
  - The schema has the same limits.
- **T7 (low, confirmed-by-running).** A top-level `42` or `null` produces empty output while the badge says "✓ Valid JSON".

**UX issues:**
- The Copy label (L296) says "Copy Schema" for TS and Go too.
- Empty input shows "✕ Invalid JSON" (L218–219).
- There's no root-name option, no `?` for optional fields, and no int vs float distinction.

**Theming issues:**
- L314: the output text is `#a5b4fc`. Measured contrast in light mode is **1.21:1** (unreadable), and the colour ignores the hue. Use `var(--text-main)`.
- L262 `rgba(255,255,255,0.02)`, L310 `rgba(0,0,0,0.2)`, L219/L221/L244/L289 hardcoded red and green: use tokens.

**Fix sketch:**
- **T1:** emit `type RootObject = RootObjectItem[]` (Go: `[]RootObjectItem`).
- **T2:** quote keys that fail `/^[A-Za-z_$][\w$]*$/`, and build PascalCase names from words.
- **T3 and T4:** use proper PascalCase (`_id` → `ID`), and map boolean to `bool` inside arrays.
- **T5:** de-duplicate names using the path or a counter.
- **T6:** merge the shapes of all elements (missing keys become optional), recurse into nested arrays, and use unions for mixed types.
- **T7:** emit `type RootObject = number` or show a message.

### /csv-json — src/pages/CsvJson.jsx (229 lines)
**What it does:**
- Two editable textareas with arrow buttons to convert in either direction. The delimiter can be `, ; |` or tab (the tab option contains a literal tab and works).
- CSV→JSON: a hand-written parser. The first row is headers (trimmed), and every value is a string.
- JSON→CSV: the input must be an array. Headers come from `Object.keys(data[0])`. Values containing the delimiter, `"` or `\n` are quoted.
- Verified OK: quoted commas, escaped `""`, CRLF, line breaks inside quotes, empty fields, trailing newline and a BOM header.

**Integrations:** none.

**Bugs (functional):**
- **CJ1 (medium, confirmed-by-running) L50.** `[{"a":1},{"a":2,"b":3},{"b":4}]` becomes `"a\n1\n2\n"`. Column `b` is silently dropped and the last row is empty.
- **CJ2 (medium, confirmed-by-running) L55.** Nested objects become `[object Object]`, and arrays become `"x,y"`.
- **CJ3 (medium, confirmed-by-running) L16–22.** A quote anywhere switches quote mode on. `12,5" screen\n13,6" screen` gives `{"desc":"5 screen\n13,6 screen"}`: the next row is swallowed and the `"` characters disappear.
- **CJ4 (low, confirmed-by-running) L79/L31/L85.**
  - A CSV with only a header row gives an error instead of `[]`.
  - CR-only line endings make the whole file one row, which gives the same error.
  - Duplicate headers overwrite each other, and extra columns are dropped.
  - Headers are trimmed but values are not (`" Alice"`).
- **CJ5 (low, confirmed-by-running) L56.** Values containing a bare `\r` are not quoted.
- **CJ6 (low, confirmed-by-running) L47/L103.**
  - Non-object arrays produce garbage: `[1,2,3]` gives `"\n\n\n"`, and `["ab","cd"]` gives `0,1\na,b\nc,d`.
  - `[{..}, null]` gives "Invalid JSON: Cannot read properties of null".
  - Every error is prefixed "Invalid JSON:", even for valid JSON that just isn't an array.
- **CJ7 (low, confirmed-by-running) L92/L103.** On error, the other pane keeps its old result.

**UX issues:**
- L143 uses a fixed `1fr auto 1fr` grid with no breakpoint. At 375 px each textarea is 103–112 px wide (measured). Other pages use `.split-pane`.
- L152, L153, L198 and L199 are icon-only Clear/Copy buttons with no label. Copy works on empty text.
- No file import or export. There is no type inference, so a JSON→CSV→JSON round trip turns `1` and `true` into `"1"` and `"true"`.

**Theming issues:** L131 `rgba(255,255,255,0.05)`, L165/L211 `rgba(0,0,0,0.2)`, L221–222 hardcoded red. These look acceptable but should be tokens.

**Fix sketch:**
- **CJ1:** use the ordered union of keys across all rows.
- **CJ2:** `JSON.stringify` objects, or flatten them with dot paths.
- **CJ3:** only treat `"` as opening a quoted field at the start of a field (or use PapaParse).
- **CJ4:** return `[]` for a header-only file, treat a lone `\r` as a newline, and warn about duplicate headers.
- **CJ5:** quote when the value matches `/[\r\n"]/` or contains the delimiter.
- **CJ6:** check that every element is a plain object.
- **CJ7:** clear the target pane on error.

### /markdown — src/pages/Markdown.jsx (137 lines)
**What it does:**
- A textarea plus a live `react-markdown` v10 preview with no plugins (CommonMark only). The preview is styled by a page-local `<style>` that uses theme tokens.
- "Improve with AI" streams a rewrite of the whole document into the editor when the model is `ready`; otherwise it calls `alert()`.
- XSS is verified safe: raw HTML is rendered as escaped text (`<img onerror>` didn't run), and `javascript:` links get `href=""` (`defaultUrlTransform`).

**Integrations:** it calls `useAI()` directly but never `useRegisterAIContext`, so the global AI panel has no document context on this page. No pipeline or smart input.

**Bugs (functional):**
- **M1 (medium, confirmed-by-running) L128–130.** There is no `remark-gfm` (it isn't installed). Tables, task lists, `~~strike~~` and bare-URL autolinks render as plain text.
- **M2 (medium-high, confirmed-by-running) L34–37.** `setInput(accumulated)` replaces the document from the first token on:
  - There is no snapshot or undo.
  - The textarea stays editable, but anything you type is overwritten by the next token.
  - There is no Stop button, although `abortChat` exists.
  - If the model errors mid-stream (L45–48), the document is left truncated.
  - Navigating away doesn't abort the stream.
- **M3 (low, confirmed-by-reading) L15/L83.** "Enable AI (Load Model)" doesn't load anything. It shows a blocking `alert()`, even though `useAI().loadModel` is available.
- **M4 (low, confirmed-by-reading).** Preview links have no `target`, so clicking one navigates the app tab away and the document is lost (nothing is saved). Remote images in the preview load from their hosts, which is a third-party request despite the privacy badge.

**UX issues:**
- Raw HTML such as `<br>` or `<details>` shows as escaped text.
- There's no copy-as-HTML or export.
- Three different names: the document title is "Markdown Preview", the heading is "Markdown Editor", and the sidebar says "Markdown".
- No preview styles for `img{max-width:100%}`, h4–h6, hr or tables.

**Theming issues:**
- L72–73: while improving, the button is `#fff` on `var(--border)`, which measures **2.2:1** in light mode.
- L94 `rgba(0,0,0,0.2)`: use `var(--bg-app)`.
- L119: inline code uses `var(--accent)`, which has a fixed hue and no light variant. It measures 3.78:1 in light mode, below the AA threshold of 4.5:1.

**Fix sketch:**
- **M1:** add `remarkPlugins={[remarkGfm]}` plus table styles.
- **M2:** stream into a separate buffer and apply it when the user accepts (or push to an undo stack); make the textarea `readOnly` while streaming; add Stop (calls `abortChat()`); abort on unmount.
- **M3:** call `loadModel()` or `navigate('/ai-settings')` instead of the alert.
- **M4:** render links with `target="_blank" rel="noopener noreferrer"` and images with `referrerPolicy="no-referrer"`.

### /base64 — src/pages/Base64.jsx (167 lines)
**What it does:**
- Encode/Decode toggle, converting live via an effect on `[input, mode]`.
- Encode: TextEncoder, then `btoa(String.fromCharCode(...bytes))`.
- Decode: `atob`, then a non-fatal TextDecoder.
- Verified OK: `Ä` → `w4Q=` and `😀` → `8J+YgA==` both round-trip. Whitespace, newlines and missing padding decode fine.
- Copy, Clear, and Pipeline Read/Send.

**Integrations:**
- **Smart input** `{input}` only (L32) — see B1. Re-selecting /base64 from the palette replaced the existing input with "base" (confirmed-by-running).
- **Pipeline:** Read calls `setInput` without changing mode, so it has the same double-encode problem. Send can ship error or garbage strings (B4).
- **AI context:** the deps are correct, but the output may be an error string.

**Bugs (functional):**
- **B1 (high, confirmed-by-running) L32.** Smart input never switches to decode. `analyzers.js` routes base64 text here, and it gets encoded again: `SGVsbG8gV29ybGQ=` → `U0dWc2JHOGdWMjl5YkdRPQ==`.
- **B2 (medium, confirmed-by-running) L11.** Spreading the whole byte array into `String.fromCharCode` fails for large input. In Chromium, 100k characters works and 150k fails, and the error is shown as the misleading "Error: Use valid text".
- **B3 (medium, confirmed-by-running) L19.** URL-safe Base64 (`-` and `_`, as in JWT segments) gives "Invalid Base64 string". There is no URL-safe encode option.
- **B4 (low-medium, confirmed-by-reading) L13/L21.** Error messages are written into `output`, so Copy, Pipeline and AI treat them as the result.
- **B5 (low, confirmed-by-running).**
  - Binary or non-UTF-8 data decodes to U+FFFD garbage (`iVBORw0K…` → `�PNG…`).
  - Plain text like "hello world" decodes to garbage with no warning.
  - A `data:` prefix isn't stripped.

**UX issues:** switching mode doesn't swap output into input (the unused `ArrowRightLeft` import suggests that was planned). No file input or download for binary results.

**Theming issues:** L121 and L158 `rgba(0,0,0,0.2)`: use `var(--bg-app)`.

**Fix sketch:**
- **B1:** pass `mode: setMode` to the hook and have the analyzers send `mode:'decode'`, or auto-select decode when injected input matches the base64 pattern.
- **B2:** convert in 32 KB chunks.
- **B3:** convert `-_` to `+/` and re-pad before decoding; add a URL-safe toggle.
- **B4:** keep the error in its own state.
- **B5:** use `TextDecoder('utf-8', {fatal: true})` and fall back to hex or a download.

### /html-entity — src/pages/HtmlEntity.jsx (211 lines)
**What it does:**
- Encode replaces `[\u00A0-\u9999<>&"']` with decimal `&#N;`.
- Decode sets `innerHTML` on a detached `<textarea>` and reads `.value`. Verified XSS-safe: an attempt to break out with `</textarea><img onerror>` did not execute.
- Swap (output becomes input and the mode flips), Clear, Copy, and a reference grid of 25 entities that inserts the character when clicked.

**Integrations:** none.

**Bugs (functional):**
- **H1 (low, confirmed-by-running) L37.** The encoding range stops at U+9999. In `café €100 — 한국 😀 ﬁ`, the é, € and — are encoded but Hangul, emoji and ligatures are left as-is. Only numeric entities are produced, although the reference grid shows named ones.
- **H2 (low, confirmed-by-running) L82–86.** In Decode mode, the grid inserts the raw character `©`, not `&copy;`.
- **H3 (trivial) L34–35.** The textarea created in `htmlEncode` is never used.

**UX issues:** no pipeline or smart input. Copy doesn't catch failures.

**Theming issues:** L103, L113, L194 `rgba(255,255,255,0.03)`, L173 `rgba(0,0,0,0.15)`, L168 `#ef4444`: use tokens.

**Fix sketch:**
- **H1:** offer "specials only" vs "all non-ASCII" using `/[^\x20-\x7E]/gu` and `codePointAt`, and use named entities from a map.
- **H2:** insert `ent.entity` when in decode mode.
- **H3:** remove the unused textarea.

### /number-base — src/pages/NumberBase.jsx (187 lines)
**What it does:**
- Four linked inputs (binary, octal, decimal, hex). Each change strips whitespace, `_` and a leading 0b/0o/0x, then runs `parseInt` for that base.
- Negative numbers and values above 2^53−1 are rejected.
- Shows bit length, bytes and "fits in uint8/16/32/64"; has presets, Clear and Copy (with prefix). Binary is shown in nibble groups when the field isn't focused.

**Integrations:** none.

**Bugs (functional):**
- **N1 (medium, confirmed-by-running) L34/L40.** `parseInt` reads the valid leading digits and ignores the rest:
  - Decimal `12z` → 12, `10.75` → 10, `1e3` → 1.
  - Binary `1012`: the binary field keeps "1012" while decimal shows 5, so the fields disagree.
  - No error is shown in any of these cases.
- **N2 (medium, confirmed-by-running) L33.** Any 0b/0o/0x prefix is stripped, whichever field you type in:
  - Hex `0B12` (really 0xB12 = 2834) becomes 0x12 = 18, and hex `0b101` becomes 257.
  - Decimal `0x1F` becomes 1.
- **N3 (medium, confirmed-by-running) L36/L35.** There is no BigInt, so anything above 2^53−1 errors (`FFFFFFFFFFFFFFFF`) even though L173 advertises uint64. Negative numbers just say "Invalid number".
- **N4 (low-medium, confirmed-by-running) L47–49.** On error the other fields keep the previous values (after typing hex "0x", the others still show 255).
- **N5 (low, confirmed-by-running) L12–14.** Binary is grouped from the left: `100000000` shows as `1000 0000 0`.
- **N6 (low, confirmed-by-running) L39–44, L145–147.** The field you're typing in is rewritten as you type ("007" → "7", "ff" → "FF", the prefix disappears). On focus, binary switches from grouped to raw, which loses the caret position and selection.

**UX issues:** "fits in" ignores signed types. No `inputMode`, so phones show a text keyboard.

**Theming issues:** L95 `rgba(255,255,255,0.03)`, L181 hardcoded red: use tokens.

**Fix sketch:**
- **N1–N3:** validate strictly per base (`/^-?[01]+$/` and so on), strip only that base's prefix, convert with `BigInt`, and show two's complement.
- **N4:** clear the other fields on error.
- **N5:** `bin.replace(/\B(?=(\d{4})+$)/g, ' ')`.
- **N6:** keep the raw text in the active field and normalize only the others.

### /hex — src/pages/HexViewer.jsx (176 lines)
**What it does:**
- A hidden `<input type=file id="hex-upload">` with a label. FileReader reads the entire file into a Uint8Array.
- Pages of 32×16 bytes (512 B), Prev/Next only. 8-digit uppercase offsets, two 8-byte hex halves, and an ASCII column (bytes 32–126 shown, others as `.`).
- Rendering is cheap: a 100 MB file loaded in about 90 ms, and each Next takes about 30 ms.

**Integrations:** none. If the same route is pinned and routed, the `id` is duplicated: "Choose File" in the right pane loaded the file into the left pane (confirmed-by-running).

**Bugs (functional):**
- **X1 (high, confirmed-by-running with JetBrains Mono loaded) L58–59.** Each half `XX XX XX XX XX XX XX XX` is 23ch (about 13.8em) but the box is 13em. The 8th and 16th bytes wrap onto a second line in every row (half height = 2× line height; screenshot-confirmed).
- **X2 (medium, confirmed-by-running) L63–65.** The ASCII column uses normal white-space, so runs of spaces collapse and leading/trailing ones disappear: `"    indented    "` shows as `indented`.
- **X3 (medium, confirmed-by-running) L145–164.** Prev/Next have no `color`, so they get the browser's default black text. In the default dark theme that's 1.24:1 contrast for Next and 1.04:1 for Prev — effectively invisible.
- **X4 (medium, confirmed-by-running).** Prev/Next is the only navigation. A 100 MB file is 204,800 pages, with no go-to-offset, first/last or search.
- **X5 (medium, confirmed-by-running) L100–111.** The input is `display:none` and the label can't take focus, so Tab never reaches "Choose File".
- **X6 (low-medium, confirmed-by-reading) L12–22.**
  - No `onerror` handler, loading state or size guard, and the whole file is held in memory. Very large files probably fail silently (suspected).
  - The picker stays visible while a file loads. Picking a second file sets `fileName` immediately, and if the first reader finishes last, the name and the data no longer match.
- **X7 (low, confirmed-by-running) L30–31.** An empty file shows "Page 1 of 0".

**UX issues:** no drag-and-drop. `Download` is imported but there's no export.

**Theming issues:**
- L169: the background is `#0d1117` while the text is `var(--text-main)` (L57) and `var(--text-muted)` (L63). In light mode that measures **1.06:1** and 2.77:1. Use `var(--bg-app)`.
- L150 and L160: `rgba(255,255,255,0.05)` with no colour. Add `color:var(--text-main)` and use `var(--bg-card)`.
- L138 `rgba(0,0,0,0.2)`.

**Fix sketch:**
- **X1:** `width:'23ch'` with `whiteSpace:'pre'`.
- **X2:** `whiteSpace:'pre'` on the ASCII column.
- **X3:** set a colour on the buttons (and globally `button{color:inherit}`).
- **X4:** add an offset input, First/Last and PgUp/PgDn.
- **X5:** use a focusable, visually-hidden input or a real button that calls `ref.click()`; use `useId()` for the id.
- **X6:** read each page lazily with `file.slice(off, off+512).arrayBuffer()`, add `onerror` and a loading state, and drop results from superseded reads.
- **X7:** show "Empty file".

### Group-level patterns
1. **Fixed-height pages are clipped by `main{overflow:hidden}`.** Formatters, Converter, Markdown and Base64 all use `height: calc(100vh - 100px)`. Measured:
   - Formatters' output is invisible at 375×812 and 1024×768, and the Process button is clipped at 1366×657.
   - Base64, Converter and Markdown lose 200–300 px of output at 812×375.
   - Every such page also overflows by about 48 px at any size, because the header and padding aren't subtracted.
   - Fix it centrally: use `minHeight` plus `main{overflow:auto}`, or a wrapper that only fixes the height on desktop.
2. **The copy button is re-implemented 7 times**, with different feedback in each. None awaits or catches `clipboard.writeText`, so "Copied" shows even when it fails, and the reset timers are never cleaned up. `useToast` exists but nothing uses it. Replace them with one `useCopy()` + `<CopyButton>` that uses toasts.
3. **Error handling differs on every page.** Converter overlays the output, CsvJson and NumberBase use a box, TypeConverter and HtmlEntity show it inline, and Formatters replaces the output. Errors are written into the output in Base64 and Converter (TOML). Stale output sits next to an error in Formatters, Converter, CsvJson and NumberBase. Use one `<ErrorBanner>` and a single rule: an error clears the output and disables Copy/Send.
4. **Repeated building blocks:** input/output panes (label + clear + pipeline + copy) and mode toggles (Formatters, TypeConverter, Base64, HtmlEntity — each with its own active style). Extract `<IOPane>` and `<SegmentedControl>`.
5. **Overlapping tools with inconsistent behaviour:**
   - JSON formatting exists in both Formatters and Converter (JSON→JSON).
   - There are two separate XML implementations with different bugs.
   - There are three ways a conversion gets triggered: live (Converter, Base64, TypeConverter, HtmlEntity, NumberBase), button-only (CsvJson), and Process plus auto-on-toggle (Formatters).
   - The sidebar labels don't match the pages ("JSON <> YAML" for a four-format converter).
   - Suggest one shared parse/serialize module (json, yaml, toml, xml, csv) and one XML library.
6. **Cross-page features are only half connected.**
   - Smart input and the pipeline are wired only in Base64 and Formatters, and both mishandle injected input (no decode, no format).
   - `useSmartInput` is consumed by every mounted instance, including a pinned one, and also on same-route palette navigation.
   - Pipeline payloads aren't type-checked (Recorder sends an object).
   - Converter, CsvJson, TypeConverter, HtmlEntity, NumberBase and HexViewer have no smart input or pipeline; Markdown has no AI context.
   - Suggested hook change: a pathname guard and an `onInject` callback (to process or set the mode), and make `PipelineRead` string-only.
7. **Theming:**
   - No `color-scheme` is declared, and the global `button` rule has no `color: inherit`, so unstyled buttons render black (HexViewer).
   - `#fff` on `var(--primary)` is used for active tabs and primary buttons on every page here. For the Emerald, Amber and Cyber Blue presets the contrast is 1.4 / 1.8 / 2.0 in dark mode and 1.7 / 2.5 / 2.9 in light mode. Add an `--on-primary` token.
   - Dark-only literals (`rgba(255,255,255,…)` fills, `rgba(0,0,0,0.2)` textareas, `#0d1117`, `#a5b4fc`, Monaco `vs-dark`) and status colours should become tokens (`--danger`, `--success`, `--surface-inset`).
   - The global input rule stretches selects (Formatters, Converter).
8. **Accessibility:** icon-only buttons with no name (Converter, CsvJson), and HexViewer can't be operated by keyboard.
9. **Dead code:**
   - Formatters: L77 no-op, L109 duplicate return.
   - HtmlEntity: the unused textarea.
   - Unused imports: FileDiff and ArrowRightLeft (Formatters), ArrowRight (Converter, NumberBase), FileCode, ArrowRightLeft and Sparkles (TypeConverter), Table (CsvJson), ArrowRightLeft (Base64), Download and AlertCircle (HexViewer).
