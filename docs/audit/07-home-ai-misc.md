# Audit — Home, AI settings & misc

**Pages:** `/` Home · `/ai-settings` · `*` 404 · `/privacy` · `/terms` · `/faker` · `/cron` · `/unix` · `/keycode`, plus app-shell infrastructure

Part of the [project audit](README.md). Each finding is labelled with **severity** (critical / high / medium / low) and **confidence**:
- *confirmed-by-running*: reproduced with the real code or libraries.
- *confirmed-by-reading*: the code path was traced in the source.
- *suspected*: needs a check in a real browser or device.

Line numbers refer to commit `a3c843b`.

**How it was verified:** Logic was replicated in Node against cronstrue 3.9 and faker 9.9. Read-only checks ran in the browser pane against the dev server.

---

### / — `src/pages/Home.jsx` (440 lines)
**What it does:**
- Uses Helmet `<SEO title="Home">`, so the tab title is "Home | Private Toolkit". It also adds description, OG, Twitter and canonical tags.
- The hero has a glow that follows the hue and loops forever, a fixed "Updated with 40+ Tools" pill, and a "Quick Search Ctrl K" pill. The pill fires a fake Ctrl+K keydown on `window`, and Layout's listener opens the palette.
- Four fixed feature cards (privacy, offline PWA, in-browser AI with Phi/Qwen chips, speed).
- The tool grid is built from TOOL_CATEGORIES, minus `/`. That gives 58 cards with framer-motion `whileInView`.
- A "Spread the Word" GitHub button (`window.open`) and a footer with Privacy, Terms, a mailto link and the copyright.
- No search box, favorites or recents on the page.

**Integrations:**
- **Tool list:** derived from TOOL_CATEGORIES, so Home has no list of its own. A script diff shows all 59 TOOL_CATEGORIES routes exist in ROUTE_MAP (61). The only routes not in Home, Sidebar or palette are `/privacy` and `/terms`, which are linked from the footer only. There are no dead or duplicate links. Drift risk remains: ROUTE_MAP and TOOL_CATEGORIES are two lists kept by hand.
- **Favorites:** Home shows none, so it can't get out of sync with the Sidebar.
- **SEO vs useDocumentTitle:** they do not fight in plain navigation. react-helmet-async's `updateTitle` skips an undefined title, so unmounting Home leaves the title alone. Home → /cron → Home behaved correctly in the app. The real problems are:
  - Two brands in tab titles: "Home | Private Toolkit" vs "… | Vibe Toolbelt".
  - A duplicate `<meta name="description">` (one static, one from Helmet; confirmed-by-running).
  - `og:image` points to `/og-image.png`, which isn't in `public/`, and the path is relative.
  - OG tags injected by JS are invisible to link-preview scrapers.

**Bugs (functional):**
1. `Home.jsx:178-196` — medium. "Quick Search" can't be used from the keyboard. framer-motion's `whileTap` makes the div focusable (tabIndex 0). But Enter is turned into synthetic pointer events (motion-dom `press/utils/keyboard.mjs`), not a click, so `onClick` never fires. It also has no `role`. Tab to the pill, press Enter: nothing happens. Confirmed-by-running.
2. `Home.jsx:23,65-71` — low. The hover arrow never appears: `.group` and `.group-hover-arrow` are defined nowhere, and Tailwind isn't installed. Computed opacity stays 0 (confirmed-by-running). Other dead classes: `:174` `hidden md:block` (the line break always applies, mobile too) and `:197` `text-muted`.
3. `Home.jsx:153,259-261,277-280` — low (accuracy).
   - "40+ Tools": there are 58.
   - "No external API calls" is false. Google Fonts load on every page (`index.html:12-16`). WebLLM downloads weights from huggingface.co and model libraries from raw.githubusercontent.com. API Tester fetches any URL the user enters (`ApiTester.jsx:172`).
   - The "Install as PWA" claim is weakened by the manifest problems (I5). Confirmed-by-reading.
4. `Home.jsx:414` — low. `window.open(url,'_blank')` without `noopener` keeps `window.opener`. Confirmed-by-reading.
5. `Home.jsx:112-132,331-336` — low (accessibility). Nothing in `src` respects reduced motion: no MotionConfig, useReducedMotion or media query. The glow loops forever and cards stay at opacity 0 until the IntersectionObserver fires. Confirmed-by-reading.

**UX issues:**
- "AI & Intelligence" holds one "AI Settings" card labelled "Open tool". The "Faker" category holds one "Data Gen" card.
- The `kbd` hint always says "Ctrl", even on macOS.
- The page mixes brands: "Private Toolkit" in the h1 and footer, "Vibe Toolbelt" at `:409`.
- On 320 px phones the grids (`minmax(300px)` / `minmax(260px)` plus 20 px padding) need more than the 248 px available. Layout's `main{overflow:hidden}` clips them (from layout math).
- Unused imports: `useState`, `Share2`, `Linkedin`, `Bot`, `Cpu`.

**Theming issues:**
- Fixed violet that ignores hue: `:145-146` `rgba(139,92,246,.1/.2)`, `:244`, `:401-402` (plus fixed blue `rgba(59,130,246,.08)`). Use `color-mix(in srgb, var(--primary) 10%, transparent)` or `--primary-glow`.
- `:51,287,292` use `rgba(var(--primary-rgb))` and `rgba(var(--accent-rgb))`. These are fixed triplets, and `--accent-rgb` is pink (236,72,153) while `--accent` is purple (hue 280).
- `:302-304`: the model chips use `rgba(255,255,255,.1)` for background and border, so they disappear on light panels (confirmed-by-running). Use `--bg-card` and `--border`.
- `:295` puts a white icon on `--primary`.
- `.text-gradient` "Ultimate" ends in `--accent` fixed at hue 280, so with the Emerald preset it runs green to purple.

**Fix sketch:**
1. Use a real `<button>` that calls an `openSearch()` exposed by Layout through context; show ⌘ on Mac.
2. Add a `.glass-panel:hover .group-hover-arrow{opacity:1;transform:none}` rule or remove the arrow; strip the Tailwind class names.
3. Compute the tool count from TOOL_CATEGORIES; rewrite the privacy copy.
4. Use `<a target="_blank" rel="noopener noreferrer">`.
5. Wrap the app in `<MotionConfig reducedMotion="user">`.

### /ai-settings — `src/pages/AISettings.jsx` (264 lines)
**What it does:**
- **WebGPU card:** spinner while checking, then supported or unsupported.
- **Model radios** from MODELS. Changing one calls `changeModel`, which saves `ai_model` and sets status to `idle`.
- **Load card:** `loading` shows an inline progress bar, `ready` shows "Model loaded and ready". Everything else (idle, thinking, unsupported) shows a "Load <label>" button, disabled only when WebGPU is `false`.
- **Theme & Accent Customizer:** six COLOR_PRESETS pills and a 0–360 hue slider (`setHue`, saved as `pt-hue`). This is where the hue picker lives. Light/dark is only in the Sidebar footer.
- **Clear Model Cache:** deletes Cache Storage entries whose names contain "mlc" or "webllm", calls `deleteDatabase('mlc-webllm')` and `deleteDatabase('webllm')` without awaiting, then shows "Cache Cleared!" for 3 s.

**Integrations:**
- Wired to `useAI` and `useTheme`; preset highlighting works.
- The inline progress UI (`:110-126`) can never be seen. AILoadingModal is a full-screen overlay at z-index 9999 for the whole load (`AILoadingModal.jsx:8-32`). It blocks clicks but not keyboard focus.
- web-llm 0.2.82 caches under `webllm/model`, `webllm/config` and `webllm/wasm`. It uses Cache Storage by default (`useIndexedDBCache:false`). So the Cache Storage filter matches, but both IndexedDB names are wrong and do nothing.

**Bugs (functional):**
1. `:79-86` + `global.css:67-79` — medium. The global `input{width:100%}` rule hits the radios. At a 646 px viewport each radio was 361 px wide and squeezed the description column to 145 px. The circle floats mid-card and the text wraps word by word. Confirmed-by-running, with a screenshot.
2. `:84` / `AIContext.jsx:55-61,75-79` — medium. Switching model during a generation gives a false "ready":
   - Status is `thinking`; the user clicks Qwen; `changeModel` sets `idle`.
   - When the stream ends, `onDone` sets `ready`.
   - The page and badge now say "ready" with Qwen selected, but the worker still runs Phi and every chat goes to Phi.
   - Reachable with the mouse, since there is no overlay during `thinking`. Confirmed-by-reading.
3. `:110-156` — low. The ternary treats `thinking` as "not loaded", so the "Load <model>" button shows while the AI is generating. Clicking it briefly flashes the modal. Oddly, this is also the only UI way out of the known stuck-`thinking` state. Confirmed-by-reading.
4. `llm.worker.js:6-33` — medium. Loads are not queued and the old engine is never unloaded:
   - `engine = await CreateMLCEngine()` runs with no `unload()`, and `onmessage` is async, so two LOADs can run at once.
   - Following bug 2, clicking "Load Qwen" while Phi is still streaming leads to: CHAT_DONE sets `ready`, and the modal announces "Qwen … is loaded" while Qwen is still downloading. Chats go to Phi until Qwen finishes (confirmed-by-reading).
   - The previous model's weights stay resident until garbage collection. That peaks at about 5 GB of VRAM and may make the second load fail (suspected).
5. `:13-29` — low. Clear cache problems:
   - It wipes every model, not the selected one, with no confirmation before a multi-GB re-download.
   - It shows success even when nothing matched.
   - Errors only go to `console.error`, and `drop_console:true` (`vite.config.js:66`) strips that in production, so failures are silent.
   - The IndexedDB names are wrong. Confirmed-by-reading against web-llm's source.
6. `AIContext.jsx:10-12` — low. The saved `ai_model` isn't checked against MODELS. If a model id is renamed or removed, no radio is checked, the button reads "Load " and the load fails (leading to the known stuck overlay). Confirmed-by-reading.
7. `:136-138` / `AIContext.jsx:28` — low. While WebGPU detection is still pending (`null`), the Load button is enabled but `loadModel` silently does nothing. Confirmed-by-reading.

**UX issues:**
- `:53` "Switch to Chrome 113+ or Edge 113+" is out of date: Safari 26 and Firefox 141+ on Windows ship WebGPU. It's also misleading on Chrome when the adapter is null (GPU blocklisted) or the page isn't a secure context.
- No per-model "cached" status or size (`hasModelInCache`, `navigator.storage.estimate()`), no way to unload and free VRAM, and "Model loaded and ready" doesn't say which model.
- `:134` "cached permanently" is wrong: storage can be evicted unless `navigator.storage.persist()` is granted.
- The radios stay enabled during load and generation.
- The hue picker sits under "AI Settings" while light/dark is in the Sidebar footer, which is hard to discover.
- The hue slider has no accessible name, and the preset pills have no `aria-pressed`.

**Theming issues:**
- The global input rule also turns the hue slider into a 34 px padded box (inline `height:6px` is overridden by 2×16 px padding and the border; confirmed-by-running).
- `:141-142` puts `#fff` on `--primary`. Contrast with the presets in dark mode: Emerald 1.40:1, Amber 1.83, Cyber Blue 2.03; in light mode 1.67 / 2.51 / 2.88. The same pattern appears in NotFound, Faker, ErrorBoundary and CommandPalette.
- `:74,184` use `rgba(255,255,255,.02)`, and `:116` (plus `AILoadingModal.jsx:72`) uses `rgba(255,255,255,.06)` for the progress track, which is invisible in light mode. Use `--bg-card` / `--border`.
- `:128` `#22c55e` text on a light panel is 2.28:1. Add a success token with a darker light-mode value.
- The hue doesn't reach `--accent` (fixed at 280), `--primary-rgb`, `--accent-rgb` or the second body gradient, so gradients run green to purple with Emerald.
- No `color-scheme` is declared anywhere, so native radios and sliders render with light-scheme styling in dark mode.

**Fix sketch:**
1. In `global.css`: `input:is([type=radio],[type=checkbox],[type=range],[type=color],[type=file]){width:auto;padding:0;border:0;background:none}`.
2. Track `loadedModel` in context; treat "ready" as `ready && loadedModel===selectedModel`; `onDone` should only restore `ready` if the model is unchanged.
3. Handle `thinking` explicitly in the Load card.
4. In the worker, keep one MLCEngine and call `await engine.reload(id)`, which unloads the previous model; serialize LOADs.
5. Use `deleteModelAllInfoInCache(selectedModel)` and `hasModelInCache`, ask for confirmation, and show errors in the UI.
6. Validate the saved id against MODELS.
7. Disable Load while detection is `null`.

### * — `src/pages/NotFound.jsx` (119 lines)
**What it does:** A gradient "404", a heading and a short text, a "Go Home" link and a "Go Back" button (`window.history.back()`), plus a pulse keyframe (its `blur(0px)` at both ends does nothing). It renders inside Layout.

**Integrations:**
- Not wrapped in an ErrorBoundary (`App.jsx:42-45`; already known).
- Azure Static Web Apps' fallback serves the shell with HTTP 200, so these are soft 404s with no `noindex`.

**Bugs (functional):**
1. `:84` — low. If the 404 was opened directly (new tab or bookmark), `history.back()` leaves the site or does nothing. Confirmed-by-reading.

**UX issues:**
- The text says "Try searching" (`:51-52`), but there is no search; the Search icon is imported and unused (`:3`).
- No suggestions for near-miss URLs.

**Theming issues:**
- `:24` uses fixed `#a855f7` and `#ec4899`.
- `:69,73,77,100` use fixed indigo `rgba(99,102,241,…)`; use `--primary-glow` or `color-mix`.
- `:63-64` puts `#fff` on `--primary`.

**Fix sketch:** Go back with `navigate(-1)` only when `history.state?.idx>0`, otherwise go to `/`. Add a button that opens the palette.

### /privacy — `src/pages/Privacy.jsx` (79 lines) · /terms — `src/pages/Terms.jsx` (71 lines)
**What it does:** Static text in a `.glass-panel` with an icon, h1 and description header. Privacy covers no server storage, local storage, third parties and contact. Terms covers an as-is disclaimer, usage, changes and contact.

**Integrations:** Linked only from Home's footer (`Home.jsx:88-89`). They aren't in TOOL_CATEGORIES, so they don't appear in the Sidebar, its search or the palette. NotFound, Layout, AISettings and PrivacyBadge (a plain div) don't link them either.

**Bugs (functional):**
1. `Privacy.jsx:37-46`, `Terms.jsx:31-40` — low. The classes `tool-page`, `tool-header`, `tool-icon`, `tool-title`, `tool-description` and `tool-content` are defined nowhere. The icon sits on its own line, the h1 falls back to the browser's 32 px, it's left-aligned, and there is no gap before the panel. Confirmed-by-running.
2. `Privacy.jsx:21,25`, `Terms.jsx:21` — low. `--text-secondary` is undefined, so text inherits `--text-main` (computed rgb(241,241,244)). It's readable, just not muted. Confirmed-by-running.
3. Privacy content — medium (trust/legal):
   - "All processing happens locally" (`:50-51,66`) is false for API Tester.
   - It doesn't disclose Google Fonts (loaded every page; IP sent to Google), Hugging Face or GitHub raw for the AI model, or the host's access logs (`staticwebapp.config.json` implies Azure Static Web Apps).
   - The storage list (`:56-62`) is wrong. API Tester saves request history automatically on every send (`ApiTester.jsx:206,222-225`), not "where explicitly saved". `api-collections` and `api-envs` may hold secrets. Missing: `ai_model`, `pt-theme`, `pt-hue`, gigabytes of `webllm/*` cache, and the service-worker precache.
   - Branding says "Vibe Toolbelt" while the shell says "Private Toolkit".

**UX issues:** No "last updated" date; Terms has no disclaimer about AI output.

**Theming issues:** Only the undefined variable above.

**Fix sketch:** Use the standard centered `.text-gradient` header (or define the `tool-*` classes); swap in `--text-muted`; rewrite the third-party and storage sections; link both pages from the Sidebar footer.

### /faker — `src/pages/Faker.jsx` (316 lines)
**What it does:**
- A recursive schema builder: 16 faker types plus Nested Object and Array of Objects (arrays get 1–3 random items).
- Row count slider from 1 to 1000; output format JSON, CSV or SQL; generation is synchronous; read-only output textarea with a Copy button.
- CSV and SQL only use root fields. Nested values are JSON-encoded into one cell. SQL is one `INSERT INTO users` per row.
- No seed and no download.

**Integrations:** No smart input (the palette's `{input}` is correctly ignored), no toast.

**Faker v9 API check:** All 16 calls exist in 9.9.0. `faker.internet.color()` (`:20`) is deprecated since 9.6, will be removed in v10, and warns on every call (20,001 warnings in a 20k-call run). 1000 rows × 16 types takes about 20 ms, so there's no freeze at the cap.

**Bugs (functional):**
1. `:189-191` — medium. Column names are never quoted, and the default schema has a column named `user`. `INSERT INTO users (id, user) …` is a syntax error on PostgreSQL and SQL Server, where `user` is reserved. Empty or spaced names produce `INSERT INTO users (, active, first name)`. Confirmed-by-running.
2. `:134,140,156-163` — medium. Duplicate field names lose data silently:
   - `item[name]` overwrites the earlier value; CSV and SQL repeat the column with the last value (the run gave `"26","26"` with the boolean lost), and SQL rejects the duplicate column.
   - Duplicates are easy to create: "Add Field to X" always names children `newField`, so two clicks give one key in the output.
   - Root fields are named `'field_'+length`, which reuses an existing name after a deletion. Confirmed-by-running.
3. `:180,183` — low. The CSV header isn't escaped: a field named `a,b` shifts every column (ran). Values are quoted but embedded `"` aren't doubled; this is latent, since no current generator produces `"` across 20k samples.
4. `:193-195` — low. Booleans come out as bare `true/false`, which SQL Server rejects. Missing values become the literal token `undefined`.
5. `:217` — low. Changing Format doesn't regenerate, so you can copy JSON after picking CSV.
6. `:20` — low. The deprecated call above: console spam in dev and a break on the v10 upgrade.
7. `:152-177` — low. Nesting is unbounded: seven levels of nested arrays × 1000 rows took 741 ms and produced 58.5 MB of JSON, which then goes into a textarea. One or two more levels would hang or crash the tab. Confirmed-by-running.

**UX issues:**
- The table name `users` is hardcoded; no SQL dialect; CSV doesn't flatten nested fields; arrays can't hold plain values; numbers are fixed to 0–100.
- Copy gives no feedback, its promise rejection isn't handled, and it stays active on empty output.
- The trash buttons are icon-only with no `aria-label`.
- Names disagree: title "Fake Data Generator", heading "Schema Builder", Sidebar "Data Gen" under "Faker". Typo "Lorum" (`:22`).

**Theming issues:**
- `:212`: the slider is turned into a padded box by the global input rule.
- `:269` puts `#fff` on `--primary`.

**Fix sketch:**
1. Quote identifiers per dialect, validate names, and make the table name configurable.
2. Generate unique default names and block generation when names repeat.
3. Add a `csvCell()` helper that doubles `"`.
4. Emit dialect-appropriate booleans and `NULL`.
5. Regenerate when the format changes.
6. Switch to `faker.color.rgb()`.
7. Cap depth or estimated size, or generate in a Worker.

### /cron — `src/pages/CronParser.jsx` (109 lines)
**What it does:**
- Runs `cronstrue.toString` on each change and shows the description, or "Invalid cron expression".
- Accepts what cronstrue accepts (verified): 5 fields, 6 fields (seconds first, or year last when the sixth part is a 4-digit year), 7 fields and `@daily`-style shortcuts.
- Four 5-field example buttons.
- There is **no next-run calculation**: `nextDates` (`:11`) is never set or shown.

**Integrations:**
- Injected input is parsed immediately and nothing overwrites it.
- **Palette:** it passes the query on every selection. Typing "cron" and pressing Enter puts "cron" in the box with an error (confirmed-by-running). An empty-query selection injects `''`, because `useSmartInput.js:22` only skips undefined/null, so the default expression is wiped and the error shows.
- **Pinned pane:** a pinned Cron is hijacked by any navigation that carries `state.input`. With Cron pinned, palette "base64" sent the main pane to /base64 and the pinned Cron became "base64" with an error (confirmed-by-running). `useSmartInput` isn't tied to its own route.
- **SmartPaste:** raw whitespace is fine; cronstrue tolerates it.

**Bugs (functional):**
1. The palette and pinned-pane injection above — medium.
2. `:26-29` — low. cronstrue's specific messages ("minutes part must be >= 0 and <= 59", "8 parts; too many!") are replaced by a generic one.
3. `:16-30` — low. Invalid or never-firing expressions are shown as valid: `*/0 * * * *` reads "Every 0 minutes", and `0 0 31 2 *` reads "on day 31 … only in February" (ran).
4. `:18` — low. An empty box shows the error state.

**UX issues:**
- No upcoming run times, field breakdown, timezone, 24-hour option (`use24HourTimeFormat`) or copy.
- Nothing says how 6-field crons are read.
- The `<label>` (`:41`) isn't tied to the input.
- Names disagree: "CRON Parsing" (title), "CRON Parser" (heading), "Cron Parser" (Sidebar).

**Theming issues:** `:93` example buttons use `rgba(255,255,255,.05)` and have no fill in light mode; use `--bg-card`.

**Fix sketch:**
1. The palette should send `{input}` only for its smart suggestions. `useSmartInput` should ignore `''` and only take state meant for its own route.
2. Show `e.message`.
3. Add upcoming runs (croner or cron-parser) and flag expressions that never fire.
4. Treat an empty box as a neutral state, not an error.

### /unix — `src/pages/UnixTimestamp.jsx` (212 lines)
**What it does:**
- A live clock ticking every second with Pause; the interval is cleaned up correctly.
- Input made only of digits is a number: below 1e11 it's treated as seconds, otherwise milliseconds. Anything else goes through `Date.parse`.
- Shows the big seconds value plus rows for ms, ISO, local, UTC and relative time, each with a silent Copy.
- Uses smart input; the clock updates a separate `now` value, so it never overwrites injected input.

**Bugs (functional):**
1. `:39-42,165-173` — **high**. Any number of 17 or more digits crashes the page. `new Date` returns an Invalid Date, which is truthy, so `toISOString()` throws a RangeError and the ErrorBoundary shows "Invalid time value" (confirmed-by-running with `17000000000000000`). Nanosecond timestamps (19 digits) always crash. If Unix is pinned, the right pane has no ErrorBoundary and the router has no `errorElement`, so React Router's default error screen replaces the whole layout (confirmed-by-reading).
2. `:30,45` + `SmartPaste.jsx:36,67` — medium. Input isn't trimmed. SmartPaste detects on trimmed text but injects the raw clipboard. Pasting `1700000000000\n` suggests "Unix Timestamp", then the page shows "Invalid Date" next to a clean-looking `1700000000000` (the text input strips the newline). A leading space fails the same way. Confirmed-by-running.
3. `analyzers.js:61-73` vs `:78-92` — medium (integration). 10-digit second timestamps never reach this page. The Base64 check runs first, and any 10–12 digit string passes it. So `1700000000` is offered as "Base64 Decoder"; pasting it on Home opened /base64. Only 13-digit and 9-digit values reach /unix. Confirmed-by-running.
4. `:30,45` — medium. Negative numbers fall into `Date.parse`: `-1` gives 2001-01-01 local, `-86400` gives year +086399, with no warning (ran on V8).
5. `:30` — low. Fractional seconds like `1700000000.5` give "Invalid Date" (ran).
6. `:39-41` — low. 16-digit microseconds are read as milliseconds (year +055840). Millisecond values below 1e11 (before 1973) are read as seconds: `86400000` gives 1972-09-27. The page never shows which unit it assumed. Ran.
7. `:59-90,16-20` — medium (accessibility). `FormattedRow` is declared inside the component, and the clock keeps ticking while you're converting input. Every second all rows remount: a mouse selection disappears and keyboard focus on a Copy button is lost. Confirmed-by-reading.
8. `:45` — low. "2024-01-01" is parsed as UTC, but "2024-01-01T00:00" and "2024/01/01" as local time. Nothing says so, and the Local row shows no zone name. Ran.
9. Palette words like "unix" get injected and show "Invalid Date". A pinned copy is hijacked the same way as Cron's.

**UX issues:**
- The 4 rem ticker (`:125`) is about 384 px wide versus about 263 px available at a 375 px viewport, so `main{overflow:hidden}` clips digits on phones (layout math).
- Undefined classes `tool-title`, `tool-icon`, `tool-desc`, `tool-grid`, `section-title` and `action-btn` (`:81,94-106`) leave the header unstyled.
- No "now" button, date picker or timezone choice.

**Theming issues:**
- `:129`: the glow uses the fixed `rgba(var(--primary-rgb),.3)`; use `--primary-glow`.
- Primary-colored digits on a light background: Emerald 1.51:1, Amber 2.27:1.

**Fix sketch:**
1. Set the date to null when `isNaN(d.getTime())`; pick the unit by digit count (s / ms / µs / ns) with a manual override.
2. Trim the input (and trim in SmartPaste).
3. Run the timestamp check before Base64 in `analyzers.js`.
4. Treat `^-?\d+(\.\d+)?$` as numeric.
5. Covered by 4.
6. Covered by 1.
7. Move `FormattedRow` to module scope and stop the ticker while there is input.
8. Show the assumed timezone.

### /keycode — `src/pages/KeycodeViewer.jsx` (120 lines)
**What it does:** A `window` keydown listener that calls `preventDefault()` on every key and records key, code, keyCode, which, location and modifiers, keeping the last 50. The hero shows `keyCode`; cards show the other fields; modifier pills; history chips.

**Integrations:** Layout's Ctrl/Cmd+K listener still fires (neither listener stops propagation), so the palette opens.

**Bugs (functional):**
1. `:12,31` — **high, critical when pinned**. Blocking every key's default breaks every other input on the page:
   - On /keycode, Ctrl+K opens the palette but typing does nothing (value stayed `""`; confirmed-by-running). The same goes for the Sidebar search and the AI assistant input.
   - Tab can't move focus (a keyboard trap), and Backspace, End and the arrows do nothing.
   - Browser shortcuts a page can intercept are likely blocked too (suspected).
   - When pinned, the whole app breaks: in Cron Parser's input, "a", Backspace and Tab all did nothing (confirmed-by-running).
2. `:108` — low. `key={h.timestamp+i}` changes on every press, so all 50 chips remount, and keys can collide.
3. Rendered twice (route + pinned), it registers two listeners and records twice; titles go stale (I8).

**UX issues:**
- The hero leads with the deprecated `keyCode` and also shows deprecated `which` (`:70,80`), neither marked as legacy. `location` is a raw 0–3.
- No capture on/off, Clear or copy, and nothing explains that the page captures every key.
- Unusable on touch devices, and there's no aria-live region.

**Theming issues:**
- `:91` the inactive pill `rgba(255,255,255,.05)` is invisible in light mode.
- `:92` `#fff` on `--primary`.
- `:43,68` use fixed `--primary-rgb` tints.

**Fix sketch:**
1. Skip events from editable targets and never block Tab or modifier keys. Better: capture only inside a focused area (`tabIndex=0` with `onKeyDown`), add a capture toggle, and disable it in the pinned pane.
2. Give each entry an id from a counter ref.
- Lead with `key`/`code` and label keyCode/which "(deprecated)".

## Infrastructure findings
- **I1. Theme flash — medium.** `ThemeProvider.jsx:24-32` sets `data-theme` and `--hue` in an effect, after first paint. There's no script in `index.html` to do it earlier, and the default `'dark'` ignores `prefers-color-scheme` (`:15-17`). Combined with `global.css:21` (a 0.3 s colour transition on body), users who saved light mode see a dark frame and then a fade on every load; custom hues flash indigo first. No `color-scheme` is declared anywhere. Fix: an inline `<head>` script that sets both from localStorage, plus `color-scheme` per theme.
- **I2. Layout header — medium.** `Layout.jsx:89` hardcodes `rgba(9,9,11,.4)`. In light mode it becomes a mid-grey bar (about rgb 150,149,152, confirmed-by-running). The "100% Client-Side" badge on it is 1.17:1 and the idle AI badge 2.29:1. The pinned-pane header `:149` (`rgba(0,0,0,.2)`) has the same problem. Use `--glass-bg` or `color-mix(var(--bg-app) 70%)`. "Private Toolkit" is hardcoded at `:115` and `Sidebar.jsx:367`.
- **I3. Sidebar theme toggle** (`Sidebar.jsx:273-301`) — low. It works and is labelled, but it never updates `<meta name="theme-color">` (fixed `#0f172a`) and has no "system" option.
- **I4. CSS order — medium.** `App.jsx:4` imports `responsive.css`, and `main.jsx` imports App before `variables.css` and `global.css`. Stylesheet order is responsive → SmartPaste → variables → global (confirmed-by-running). So `variables.css`'s fixed `--space-xs…xl` override responsive's fluid `clamp()` values and its ≥1921 px `--space-md:32px` (computed `--space-md` = `1rem`). Only `--space-xxs` and `--sidebar-width` come from `responsive.css`.
- **I5. PWA manifest — medium.**
  - `index.html:17` links `/manifest.json`. In builds, vite-plugin-pwa adds `/manifest.webmanifest` just before `</head>` (plugin source), and browsers use the first link.
  - So `public/manifest.json` is what counts: "Private Toolkit", a `/vite.svg` icon claiming 192 and 512 sizes, "any maskable" (discouraged), `orientation: portrait`, theme `#09090b`.
  - The VitePWA manifest ("Vibe Toolbelt", theme `#ffffff`) is effectively dead. Its `pwa-192x192.png` and `pwa-512x512.png` don't exist, nor do the `includeAssets` files (`public/` holds only `ffmpeg/`, `manifest.json`, `staticwebapp.config.json`, `vite.svg`).
  - Azure's fallback would likely serve `index.html` for those missing PNGs (suspected).
  - The favicon is Vite's default logo. There are three different theme colours.
- **I6. index.html — low.** Its title brand differs from the other pages' titles; the description meta is duplicated by Helmet. Google Fonts send a cross-origin resource policy header, so the dev COEP setting doesn't block them (verified). But they contradict the privacy copy and aren't cached for offline use. Self-host the fonts.
- **I7. vite.config.js — low.**
  - `drop_console` (`:66`) also strips `console.error`.
  - The 4 MB precache limit (`:17`) exists to precache faker (about 2.8 MB), so every install downloads it.
  - The cross-origin isolation headers (COOP/COEP) are set only for dev and preview (`:49-60`), not in `staticwebapp.config.json`.
- **I8. Titles — low.** `useDocumentTitle.js:5-9` restores the previous title on unmount, which goes stale with pins. On /cron, pinning Keycode made the title "Keycode Viewer"; going Home gave "Home | Private Toolkit"; unpinning then set "CRON Parsing | Vibe Toolbelt" while on Home (confirmed-by-running).
- **I9. Error isolation — medium.** The pinned pane (`Layout.jsx:158-161`) and the `*` route have no ErrorBoundary and the router has no `errorElement`, so one crash in a pinned tool replaces the whole app.

## Group-level patterns
- **Two brands:** "Private Toolkit" (index.html, SEO.jsx, Sidebar, Layout, Home, manifest.json, package name) vs "Vibe Toolbelt" (every title suffix, Privacy, Terms, the Home call-to-action, the VitePWA manifest).
- **Smart-input chain:**
  - The palette injects the query, even `''`, on every selection.
  - SmartPaste injects untrimmed text.
  - The analyzer order sends 10-digit timestamps to Base64.
  - `useSmartInput` accepts `''`, isn't scoped to its own route (so pinned tools steal input), and its replace-navigation drops `?search` and `#hash`.
- **Theming:**
  - Translucent whites that assume dark mode (AISettings, Cron, Keycode, Home, AILoadingModal, AIStatusBadge).
  - `#fff` on `--primary` fails contrast for 3 of the 6 presets.
  - `--accent`, `--primary-rgb` and `--accent-rgb` ignore the hue.
  - The global input rule breaks radios and sliders.
  - No `color-scheme`.
- **Inconsistent headers:** centred gradient h2 (AISettings, Cron), per-column h2 (Faker), unstyled h1 from undefined classes (Unix, Privacy, Terms), no header at all (Keycode).
- **Dead class names** copied from a stylesheet that doesn't exist (`tool-*`, Tailwind classes).
- **Components defined inside components** that remount on every render (`FormattedRow`, `KeyCard`).
- **No user feedback:** copy buttons are silent, `useToast` is unused everywhere, and errors only reach the console (stripped in production).
- **Naming drift** across title, heading and Sidebar (Cron, Faker, Keycode).
- **Accessibility gaps:** labels not tied to inputs, icon-only buttons with no name, no reduced-motion support.
- **Hand-kept lists:** ROUTE_MAP vs TOOL_CATEGORIES, and the hardcoded "40+".
