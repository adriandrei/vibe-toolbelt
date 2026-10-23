# Audit — Text & analysis

**Pages:** `/inspect` Inspector · `/regex` Regex Tester · `/diff` Diff (+ `components/DiffViewer.jsx`) · `/text-stats` · `/list` · `/case` · `/lorem`

Part of the [project audit](README.md). Each finding is labelled with **severity** (critical / high / medium / low) and **confidence**:
- *confirmed-by-running*: reproduced with the real code or libraries.
- *confirmed-by-reading*: the code path was traced in the source.
- *suspected*: needs a check in a real browser or device.

Line numbers refer to commit `a3c843b`.

**How it was verified:** Pages were server-rendered (esbuild + react-dom/server, AI context stubbed), and verbatim copies of the matching, diff and case logic were run in Node/V8.

---

**The most serious findings:**
1. **/text-stats crashes on every render.** In the pinned split pane that crash takes down the whole app.
2. **/regex can hang the tab for good.** It loops forever when the `u` flag is on, the pattern can match empty, and the text contains an emoji.
3. **/regex freezes on slow patterns.** Catastrophic backtracking runs on every keystroke, on the main thread.

---

### /inspect — src/pages/Inspector.jsx (610 lines)

**What it does:**
- One textarea. Everything recomputes on every keystroke, with no debounce.
- `detectFormats` (L57-166) runs 18 regex/parse checks on the trimmed input and can show several chips at once.
  - Hex and Base64 are only checked when JSON, XML or SQL did not match.
  - 15 formats get an "Open Tool" `<Link state>`. Email, MAC and Semver get no link.
- Stats: characters (counted in UTF-16 units), UTF-8 bytes, lines, words, Shannon entropy with a badge (<3 low, <5 medium, otherwise high), and the top 10 characters.
- SHA-1/256/512 via SubtleCrypto, only for inputs under 100,000 characters.
- One preview, where the first match wins: timestamp → pretty-printed JSON → naive XML formatter → Base64 decode (only if the result is printable ASCII) → JWT header/payload.

**Integrations:**
- **"Open in tool" routing exists.** Inspector is effectively a third router-state producer, alongside SmartPaste and the palette.
  - **Consumed correctly (11 links):** formatters ×3 (receives `{input, mode}`), jwt, url, unix ×2, cron, cidr ×3.
  - **`/base64`:** the input arrives, but the page opens in Encode mode.
  - **Dropped (3 links):** `/hex` (HexViewer only reads files), `/uuid` (a generator) and `/gradient` (no smart input). A hex color should go to `/color` anyway.
- **Pinned tools get overwritten.** `useSmartInput` doesn't check the pathname, so a pinned tool that consumes smart input (e.g. Base64) also takes the input that "Open Tool" sends to the main pane, and loses its own text.
- No AI context, no pipeline, and it doesn't consume smart input itself.

**Inspector vs `src/utils/analyzers.js` (confirmed-by-running, same corpus through both):**

| Input | Inspector | analyzers.js (SmartPaste / palette) |
|---|---|---|
| `1609459200` (10-digit timestamp) | JSON + Unix TS | `/base64` — the Base64 step (L61) runs before the timestamp step (L78). Any digit string over 8 chars whose length mod 4 ≠ 1 decodes. Only 13-digit ms timestamps reach `/unix`. |
| `16094592000` (11 digits) | Unix TS, read as ms → 1970-07-06 | `/base64`. The `/unix` page reads it as seconds → 2480-01-07. |
| MD5 / SHA hex | Hex | `/base64` |
| Unsigned JWT `eyJ…eyJ….` | none | `/jwt` |
| `0 0 * * MON`, `0 0 12 * * ?` | none | `/cron` |
| User-agent string, `HTTPS://EXAMPLE.COM` | none | `/ua`, `/url` |
| `42`, `true`, `null` | JSON | null |
| UUID v4, IPs, CIDR, email, ISO date, XML, SQL, color | detected | null |
| UUIDv7, nil UUID, `2001:db8::1`, `::1`, `<?xml?>…`, `<soap:Envelope>…`, `<root/>`, base64url | none | null |

**Bugs (functional):**
1. **Base64 "Open Tool" double-encodes.** L87 passes only `input`; Base64.jsx defaults to `'encode'` (L27) and only maps `input` (L32). Clicking it shows base64-of-base64. SmartPaste has the same problem. [medium · confirmed-by-reading]
2. **Hex, UUID and Hex Color "Open Tool" lose the input** (L80, L98, L150): the target page opens empty. [medium · confirmed-by-reading]
3. **Detection gaps:**
   - UUID only v1–5 (L9).
   - IPv6 only in full, uncompressed form (L16).
   - XML regex (L24) fails on a prolog, a prefixed root name or a self-closing root.
   - JWT requires a non-empty signature (L8).
   - Cron only numeric 5-field (L22).
   - `base64url` is defined (L11) but never used.
   [medium · confirmed-by-running]
4. **Any JSON scalar is flagged as JSON** (L63-66). `"42"` gets a JSON chip, a Formatters link and a "Formatted JSON Preview". The match also suppresses the Hex/Base64 checks. [low · confirmed-by-running]
5. **False positives:**
   - Single long words such as "Internationalization" → Base64 (L84).
   - Any 10–13 digits, e.g. the phone number `0712345678` → Unix TS 1970-01-09 (L19).
   - The ISO regex has no end anchor (L18), so a log line "2024-01-01 12:00:00 ERROR…" gets an ISO chip and `/unix` receives the whole line.
   - `1 2 3 4 5` → Cron.
   - `999.999.999.999/99` → CIDR.
   [low · confirmed-by-running]
6. **Seconds/ms heuristic disagrees with /unix.** Inspector uses `length === 10` (L132, L251); UnixTimestamp.jsx uses `< 1e11` (~L40), so 11-digit input differs (see table). [low · confirmed-by-running]
7. **Entropy and frequency mix code points with UTF-16 length.** L44 iterates code points but L47 and L218 divide by `.length`: `"😀😀"` gives 0.5 bits instead of 0.
   - The level ignores alphabet size: a random 32-char hex key scores 3.906 → "Medium".
   - The "/ 8.000" label (L449) assumes bytes.
   [low · confirmed-by-running]
8. **Hash effect has no cancellation** (L235-241). An older digest can resolve last and show hashes for stale input. [low · suspected]
9. **`formatXml` doesn't indent under 1-character parent tags** (L29-38, copied from Formatters): `<a><b>x</b></a>` comes out flat. Output uses `\r\n`. [low · confirmed-by-running]
10. **Base64 and JWT previews decode with `atob`, which yields Latin-1.** UTF-8 Base64 (e.g. "über") fails the ASCII check, so there's no preview; non-ASCII JWT claims show mojibake (L273-286). [low · confirmed-by-running for Base64]
11. **Quadratic regexes:** the email (L14) and XML (L24) patterns take about 0.5 s each on 40K characters of adversarial input, on every keystroke. [low · timing confirmed, real-world trigger suspected]
12. **Hex Color chip:** `${color}15` (L359-360) is invalid CSS for `#rgb` and `#rrggbbaa`. The color itself is used as the label text color (L364, L374), so `#000` is invisible in dark mode. [low]
13. **Clipboard** (L298, L305) isn't awaited or caught, so "copied" shows even on failure. [low]

**UX issues:**
- **Grid overflows on small phones.** `minmax(350px,1fr)` (L342) is wider than the 343px content box at 375px width, and Layout's `overflow:hidden` clips the right edge (worse at 360px).
- **Missing controls:** no Clear button, no label (placeholder only), no debounce.
- **Invisible characters:** `\r` and other invisible characters render as blank cells in the character-frequency list.
- **Not wired in:** it can't receive SmartPaste or palette input, although it's the natural fallback when the analyzer returns null.

**Theming issues:**
- L399, 403, 407, 411, 418, 472: `rgba(255,255,255,0.03)` tiles are invisible in light mode → use `var(--bg-card)`.
- L531: `#a855f7` gradient end ignores the hue preset → use `var(--accent)`.

**Fix sketch:**
1–2. Pass `mode:'decode'` and let Base64 map `mode`. Repoint Hex Color to `/color`, add smart input to the Hex/UUID targets or drop those links.
3–5. Replace both detectors with one shared module returning ranked candidates. Check timestamps before Base64, add anchors, accept compressed IPv6, UUID v6–8 and XML prologs, and only flag objects/arrays as JSON.
6. Share a single seconds/ms helper with `/unix`.
7. Divide by the code-point count; normalise entropy by `log2(alphabet size)`.
8. Add a `cancelled` flag in the effect cleanup.
9. Share one fixed `formatXml` with Formatters.
10. Decode with `TextDecoder`.
11. Debounce; skip regexes above a size cap.
12. Validate before appending alpha; use a neutral text color.
13. Shared `CopyButton`.

---

### /regex — src/pages/RegexTester.jsx (647 lines)

**What it does:**
- Pattern input plus flags input (filtered to `gimsuy`) and a toggle button per flag.
- An `exec` loop computes matches; they're highlighted, and "Match Details" lists the first 20 with index and `$n` groups.
- Replace mode runs `text.replace(new RegExp(regex, flags), replaceWith)` and has a Copy button.
- Cheat-sheet sidebar: clicking an item appends it to the end of the pattern.
- "Generate with AI": WebLLM returns `{pattern, flags}` as JSON; failures are reported with `alert()`.

**Integrations:**
- **AI:** the deps `[regex, flags, text, matches]` cover everything `getContext` reads, so no stale closure. `mode`, `replaceWith` and the replace result aren't in the context, so replace-mode prompts lack them.
- **No pipeline and no smart input.**
- **Pinned pane:** the cheat sheet squeezes the main column, and the AI `tool` name flips between panes (see group section).

**Bugs (functional):**
1. **Infinite loop with the `u` flag** (L151-159). `lastIndex++` lands inside a surrogate pair; V8 snaps back for `/u` regexes, so the same empty match repeats forever and the results array grows until the tab runs out of memory.
   - Repro: flags `gu` + `\b` on `a😀`; `\d*` on `Vibe 😀`; `gmu` + `^` on a line starting with an emoji.
   - Typing a `*` or toggling `u` is enough, and an AI-generated pattern can trigger it too.
   [critical · confirmed-by-running on Node 24 / V8, the same engine as Chrome]
2. **Catastrophic backtracking freezes the UI.** Matching runs synchronously inside render (L142-175), and again in replace mode (L181-182).
   - `(a+)+$` on 26 a's plus `!` takes 596 ms, and the time roughly quadruples per 2 extra chars (about 10 s at 30).
   - It re-runs on every keystroke, so the user can't even edit the pattern to escape.
   [high · confirmed-by-running]
3. **Highlighting has no cap** (L207-233). Every match becomes a span: `.` or `\w` with `g` on 100KB gives about 100K spans. The page also renders twice per keystroke (once from state, again from the AI-context re-register via `useAI`). [medium · confirmed-by-reading]
4. **"Generating..." can get stuck forever.** `chat()` returns silently when `aiStatus !== 'ready'` (AIContext.jsx L50), never calling `onDone`/`onAbort`. If the assistant panel is streaming ('thinking') or the model was switched, the input stays disabled until remount. [medium · confirmed-by-reading]
5. **AI button misbehaves during generation.** While generating, status is 'thinking', so the label flips to "Enable AI (Load Model)" and clicking alerts "load the model first" (L317-339). [low · confirmed-by-reading]
6. **Cheat-sheet "Flags" entries insert text instead of toggling.** Clicking `g`, `i` etc. (L59-69, L606) appends the letter to the pattern; `.replace(/\\/g,'\\')` is a no-op. [low · confirmed-by-reading]
7. **Zero-width matches:**
   - Counted in Match Details but invisible in the preview (`\b` on "hi there" → 4 empty matches).
   - Without `u`, empty matches split emoji in the preview.
   [low · confirmed-by-running]
8. **Group display:** group names aren't shown, and a group that didn't participate renders as an empty `$2:` chip (L552-556). [low · confirmed-by-running]
9. **Empty replace result** (`''`) hides the Copy button and shows a blank box (L497). [low]
10. **AI flags aren't sanitized** (L122), unlike the flags input (L401). The `d` and `v` flags are unsupported (L401, L422). [low]
11. **Blocking alerts and clipboard:** `alert()` (L128, L318) can fire after navigating away; clipboard (L236) isn't awaited or caught. [low]

**UX issues:**
- **Cheat sheet squeezes the page.** It's a fixed 280px flex sibling (L246, L573), so on a phone, or in the pinned pane, the main column shrinks to about 40px.
- **`sticky` does nothing** in the normal layout (L578), because Layout's `<main>` has `overflow:hidden` (Layout.jsx L136).
- **Slash-delimited patterns aren't parsed:** pasting `/abc/gi` is taken literally.
- **Labels aren't associated** with their inputs (L314), and the flags input has no label.

**Theming issues:**
- L555: `#333` group chips → dark text on dark gray in light mode → `var(--bg-app)` + `var(--text-main)`.
- L526: `#a5b4fc` replace text has poor contrast in light mode → `var(--text-main)`.
- L328-329: white text on `rgba(168,85,247,.2)` → unreadable in light mode.
- L297-300, L627: purple accents ignore the hue → `var(--accent)` / `var(--primary-glow)`.
- L545, L621: `rgba(255,255,255,.05)` is invisible in light mode.
- L263, 277, 329, 364, 547: `#fff` on `var(--primary)` → about 2:1 contrast with the Amber/Emerald/Cyber presets.

**Fix sketch:**
1. Use `text.matchAll(re)` (requires `g`), or advance `lastIndex` by `re.unicode ? code point length : 1`.
2–3. Run matching in a Web Worker with a ~500 ms timeout and terminate on overrun; debounce input; cap highlighted matches; memoize the highlight.
4–5. Have `chat()` throw or return a status when not ready; reset `isGenerating` in `finally`; treat 'thinking' as loaded.
6. Make Flags entries call `toggleFlag`.
7–11. Use a visible caret marker for empty matches; show `match.groups` names; check `replaceResult !== null`; filter AI flags; use toasts instead of `alert()`.

---

### /diff — src/pages/Diff.jsx (204 lines) + src/components/DiffViewer.jsx (176 lines)

**What it does:**
- Two textareas; `diff.diffLines` (diff v8.0.3).
- Unified view (`<pre>`) or side-by-side (two-column grid).
- "+N added / −N removed" counter and "Copy Patch" (`createPatch('file', …)`).
- DiffViewer is also used by Formatters, in split mode.

**Integrations:**
- **AI:** deps are complete. The context always appends `...`, sends only the first 500 characters of each text plus the (wrong) counts, and never the actual diff, so "Summarize the changes" can't work on real inputs.
- **No pipeline and no smart input.**

**Bugs (functional):**
1. **Split view collapses whitespace.** The column divs (DiffViewer L111-116, L142-146) lack `white-space: pre`.
   - Indentation disappears, and whitespace-only changes show as −/+ pairs that look identical.
   - Formatters' diff (split mode) shows prettified output with no indentation at all.
   [high · confirmed-by-reading]
2. **Counter counts newlines, not lines** (Diff.jsx L26-27). `foo`→`bar` shows +0/−0 (the case in tests/text.spec.js); `a\nb`→`a\nc` +0/−0; empty→`x\ny` +1. [medium · confirmed-by-running]
3. **Side-by-side never pairs modified lines** (DiffViewer L19-47). `b`→`B` renders as two staggered rows with placeholders. [medium · confirmed-by-running]
4. **EOF-newline and CRLF noise.** `foo` vs `foo\nbar` marks `foo` as changed; CRLF vs LF marks every line changed. The view shows no "no newline at end of file" marker. diff v8's `ignoreNewlineAtEof` and `stripTrailingCr` options fix both (verified) but aren't used. [low · confirmed-by-running]
5. **Four `diffLines` calls per keystroke.** Diff L17 for stats, Diff L46-84 for a `splitDiff` that's never used, and DiffViewer computes both views regardless of mode. Each takes about 27 ms on 3,000 lines → ~110 ms per keystroke. [medium · confirmed-by-running]
6. **Copy Patch** (L86-91) isn't awaited or caught, and uses generic `file` headers. [low]
7. **Dead code:** the filters at Diff L54 and DiffViewer L20 are always true; unused imports `useEffect` and `FileDiff`. [low]

**UX issues:**
- **Missing features:** no "identical" state, no ignore-whitespace, swap or clear, and no folding of long unchanged blocks.
- **Mobile:** the split grid (L89) stays two columns on phones.
- **Labels:** not associated with their textareas.
- **Naming:** "Secure Text Diff" (header) vs "Secure Diff" (sidebar) vs "Diff Checker" (README).

**Theming issues:**
- DiffViewer L126, L156: `rgba(255,255,255,.02)` placeholders are invisible in light mode.
- DiffViewer L69, L128, L158: `#10b981` / `#ef4444` text has about 2.5:1 contrast on light backgrounds → light-mode `--success` / `--danger` tokens.
- Diff L116, L133: `#fff` on primary.

**Fix sketch:**
1. Add `whiteSpace:'pre'` (or `'pre-wrap'`) to the split columns.
2. Use `part.count`.
3. Pair adjacent removed+added blocks row by row.
4. Pass `{ignoreNewlineAtEof:true, stripTrailingCr:true}` (or expose a toggle).
5. Compute once in a shared `useLineDiff` hook and only the active view.
6. Await clipboard; use `createTwoFilesPatch('a/original', 'b/modified', …)`.
7. Delete Diff.jsx's `splitDiff`.

---

### /text-stats — src/pages/TextStats.jsx (159 lines)

**What it does (as written):** computes characters, words, sentences, paragraphs, lines, spaces, bytes, read/speak time, top characters and top words. It renders only words, characters/bytes, lines/paragraphs, times and top words; sentences, spaces and top characters are computed but never shown. Also has pipeline Read/Send, Clear and an AI context. **In practice nothing renders.**

**Integrations:** the pipeline wiring is correct but unreachable. The AI-context call is what causes the crash.

**Bugs (functional):**
1. **Crashes on every render.** `useRegisterAIContext({...}, [text, stats])` (L11-24) reads `stats` in the deps array before `const stats = useMemo(…)` is declared (L26). The SSR harness throws `ReferenceError: Cannot access 'stats' before initialization`; the other 6 pages render fine in the same harness. Introduced in commit ef3671a. [critical · confirmed-by-running]
   - **Persists across navigation.** Every route uses an unkeyed `<ErrorBoundary>` and react-router's `RenderedRoute` isn't keyed, so the boundary instance is reused. After the crash, every other tool still shows "Something went wrong" until "Try Again". [confirmed-by-reading react-router `_renderMatches`]
   - **Pinning kills the whole app.** Layout renders the pinned page with no ErrorBoundary (Layout.jsx L158-161), so the error reaches the router's root default boundary: the entire UI, sidebar included, becomes "Unexpected Application Error!" until reload.
   - **Tests miss it.** tests/smoke.spec.js still passes for /text-stats: it only checks `<main>`, the sidebar and the title, which stays "Private Toolkit…" because the page never commits.
2. **Latent bugs, once the crash is fixed:**
   - Top words use the ASCII-only `\b\w+\b` (L54): "Ärger über Ärger café" → `rger ×2`.
   - The sentence regex (L31) splits on every period: "Dr. Smith paid $3.50 for e.g. coffee. Really?! Yes..." → 7 (true count 3).
   - Character count is in UTF-16 units.
   [low · confirmed-by-running]

**UX issues:**
- **Mobile:** the fixed `2fr 1fr` grid (L89) leaves a ~105px stats column on phones.
- **Naming:** typo "Text Analyztics" (L83), vs "Text Statistics" (title) and "Text Stats" (sidebar).
- **Hidden work:** stats are computed but not displayed.

**Theming issues:**
- L111: `rgba(0,0,0,.2)` textarea → gray box in light mode → `var(--bg-app)`.
- L136: `rgba(255,255,255,.05)` chips are invisible in light mode → `var(--bg-card)`.

**Fix sketch:**
1. Move the hook call below the `stats` useMemo. App-wide: wrap `PinnedComponent` in an ErrorBoundary and key route boundaries by pathname.
2. Use `/[\p{L}\p{N}]+/gu` for words; use a smarter sentence split, or drop it.

---

### /list — src/pages/ListSorter.jsx (214 lines)

**What it does:**
- Splits input on `\n`, with options: trim (on), remove empty (on), dedupe (off; case-sensitive via `Set`, or case-insensitive keep-first).
- Sort asc/desc/off by alpha (`localeCompare`), numeric (`parseFloat || 0`) or length.
- Read-only result textarea with Copy, plus a stats bar.

**Integrations:** none.

**Bugs (functional):**
1. **"Removed" can go negative.** L60 always excludes blank lines from the input count, but with Remove Empty off the result keeps them: `a\n\nb\n` → Input 2, Result 4, Removed −2. [low-medium · confirmed-by-running]
2. **"Duplicates Found" ignores the Trim toggle** (L65): with Trim off and Dedupe on, `a` / `a ` keeps both lines but reports 1 duplicate. [low · confirmed-by-running]
3. **Numeric sort treats non-numbers as 0** (L44): `banana`, `$5` and `v3` interleave with `0`; `1,000` sorts as 1. [low · confirmed-by-running]
4. **Case sensitivity barely changes the sort** (L50): it uses locale collation, so the order is a, A, b, B in both modes and only dedupe changes. `item10` sorts before `item2`. [low · confirmed-by-running]
5. **Clipboard** (L70) isn't awaited. [low]

**UX issues:**
- **Mobile:** the fixed `1fr 1fr` grid (L143) leaves two ~160px textareas on phones.
- **Labels:** the A→Z / Z→A labels (L104-108) stay the same for numeric and length sorts.
- **Accessibility:** toggles have no `aria-pressed`, and labels aren't associated.

**Theming issues:**
- L78: `rgba(255,255,255,.03)` is invisible in light mode.
- L183: `rgba(0,0,0,.15)` is gray in light mode.
- L169: `#fff`.

**Fix sketch:**
1–2. Derive the stats from the same preprocessing steps as the result.
3. Sort NaN values last.
4. Use `Intl.Collator(undefined, {numeric:true, sensitivity: caseSensitive ? 'variant' : 'accent'})`, or an ordinal compare when case-sensitive.

---

### /case — src/pages/CaseConverter.jsx (210 lines)

**What it does:**
- A textarea pre-filled with real text rather than a placeholder (L8).
- 12 live conversions, each with "Send to Pipeline" and Copy, plus Pipeline Read and Clear.
- Words are split only on ASCII lowercase→uppercase boundaries, `_`/`-` runs and whitespace.

**Integrations:** pipeline Read/Send are wired correctly. No AI, no smart input.

**Bugs (functional), all confirmed-by-running:**
1. **Acronym, digit and non-ASCII boundaries are missed** (L23, ASCII `[a-z][A-Z]` only). [medium]
   - `XMLHttpRequest` → `xmlhttpRequest` / `xmlhttp_request`
   - `getHTTPResponseCode` → `get_httpresponse_code`
   - `user_id2Name` → `user_id2name`
   - `version2Beta` → `version2beta`
   - `ärgerÜber` → `ärgerüber`
   - `Ärger über`, emoji and `  multiple   spaces ` work correctly.
2. **Only space, `_` and `-` count as separators** (L24), so punctuation ends up inside identifiers: `hello, world!` → `hello,World!` / `hello,_world!`; `user.firstName` → `user.first_name`. [medium-low]
3. **Multi-line input merges into one identifier:** `first_name\nlast_name\n…` → `firstNameLastName…`. [medium]
4. **Sentence case** (L59-62) only capitalises the first character of the whole text, and does nothing if the text starts with whitespace. [low]
5. **Title case** lowercases word tails and turns hyphens into spaces: `iPhone NASA` → `I Phone Nasa`. [low]

**UX issues:**
- Copy (L10-16) gives no feedback at all.
- Results are single-line with an ellipsis (L165-173), so multi-line output can't be read.
- The textarea can't be resized and has no label.

**Theming issues:**
- L119: `rgba(0,0,0,.2)` → `var(--bg-app)`.
- L192: `rgba(var(--primary-rgb), .1)` uses the fixed RGB triplet and ignores the hue → `var(--primary-glow)`.

**Fix sketch:**
1–2. Tokenise with `str.match(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{N}+/gu)` and drop punctuation.
3. Convert per line.
4. Capitalise after `^\s*` and after `[.!?]\s+`.

---

### /lorem — src/pages/Lorem.jsx (88 lines)

**What it does:** count + unit (paragraphs / sentences / words) + Generate, using `fakerEN_US.lorem` (random Latin, without the classic opener). It generates once on mount and has a Copy button.

**Integrations:** none.

**Bugs (functional):**
1. **Count isn't clamped** (L35). `max="100"` isn't enforced for typed values: 20,000 paragraphs is a 3 MB string rendered into one div, and 1e6 would be about 150 MB, crashing the tab. [medium-low · generation confirmed-by-running]
2. **Clearing the field snaps it to "0".** 0, negative and NaN counts silently produce an empty result. [low · confirmed-by-running]
3. **Copy** (L68) has no feedback and no error handling. [low]

**UX issues:**
- Changing count or unit doesn't regenerate, while the other tools are live.
- Labels aren't associated.
- The page pulls in the whole `vendor-faker` chunk (vite.config.js L80; the config comment says ~2.8 MB).

**Theming issues:** L52 `#fff` on primary; hardcoded radius 6.

**Fix sketch:** clamp the count to 1–100; use a small word list instead of faker; use a shared `CopyButton`.

---

### Group-level patterns

**Duplicated code that should become shared components:**
1. **Copy buttons.** 7 handlers on 6 pages with 3 different behaviours: some show feedback without error handling, CaseConverter catches errors but shows nothing, Lorem has neither. → One `<CopyButton>` that awaits the write and reports through `useToast()`, which exists but is unused.
2. **Mode toggles.** RegexTester Match/Replace (L257-287) and Diff Unified/Split (L110-143) are copy-pasted; ListSorter has its own `toggleStyle`. → `<SegmentedControl>` with `aria-pressed`.
3. **Text panels.** Label + textarea + Clear + PipelineRead appears on 7 pages, with four different textarea backgrounds. → `<TextPanel>` with a properly labelled textarea.
4. **Text metrics.** Inspector (L201-229) and TextStats (L26-65) compute the same metrics with different algorithms. → A code-point-aware `utils/textMetrics.js`.
5. **Format detection.** Inspector's detector and `analyzers.js` are separate and disagree (see table). `formatXml` is duplicated between Inspector L29 and Formatters L13, with the same bug. The diff logic is duplicated between Diff.jsx and DiffViewer.

**Cross-page inconsistencies:**
- **Mobile layout:**
  - Only CaseConverter, Diff inputs and RegexTester use `.split-pane`.
  - TextStats, ListSorter, the DiffViewer split view, RegexTester's cheat sheet and Inspector's 350px grid all break on phones.
  - `.split-pane` uses a viewport media query, so it stays two columns inside the half-width pinned pane.
- **AI context with a pinned pane:**
  - Two pages fight over the single `toolContext`. Each switch changes `tool`, which makes AIAssistant (L33-37) clear the conversation.
  - Unpinning sets the context to null while the main page is still mounted.
  - Every keystroke in RegexTester, Diff or TextStats re-renders all `useAI` consumers, because the provider value is a new object each render.
- **Integration coverage is uneven:**
  - AI context only on RegexTester, Diff and TextStats; pipeline only on CaseConverter and TextStats.
  - None of the 7 pages consume smart input.
  - Inspector produces router state that 3 of its targets ignore.
- **Naming, widths and headers vary:** max widths are 800/900/1200/1400; Lorem has no subtitle; tool names differ between header, sidebar and README.
- **Accessibility:** none of the 8 files use `htmlFor` or `aria-*` anywhere.

**Theming:**
- None of the six undefined CSS variables appear in these 8 files.
- None of these pages use checkbox, radio, range, color or file inputs, so the global input rule doesn't affect them.
- No `dangerouslySetInnerHTML` or other XSS sinks in this group.
- **Recurring hardcoded colors, and the tokens to replace them:**
  - `rgba(255,255,255,0.02–0.05)` surfaces (invisible in light mode) and `rgba(0,0,0,0.15–0.2)` textarea backgrounds (gray in light mode) → `--surface-subtle` / `--surface-input`.
  - Semantic green/red/amber → `--success` / `--danger` / `--warning` with light-mode variants.
  - `#fff` on primary → an `--on-primary` token, dark for light hues.
  - `#a855f7` purple → `var(--accent)`.
