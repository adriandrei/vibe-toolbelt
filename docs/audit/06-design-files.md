# Audit — Design, images & files

**Pages:** `/css` Glassmorphism · `/gradient` · `/triangle` · `/box-shadow` · `/color-blindness` · `/color` · `/snippets` · `/qrcode` · `/favicon` · `/svg` · `/image-base64` · `/pdf`

Part of the [project audit](README.md). Each finding is labelled with **severity** (critical / high / medium / low) and **confidence**:
- *confirmed-by-running*: reproduced with the real code or libraries.
- *confirmed-by-reading*: the code path was traced in the source.
- *suspected*: needs a check in a real browser or device.

Line numbers refer to commit `a3c843b`.

**How it was verified:** Logic was run in Node. Controls and SVG filters were measured in headless Chromium, Firefox and WebKit using the app's real CSS. `curl -I` was used on the third-party assets.

---

Three cross-cutting findings for this group:
- **COEP is not a problem here.** `images.unsplash.com` and `fonts.googleapis.com` both send `Cross-Origin-Resource-Policy: cross-origin` and `Access-Control-Allow-Origin: *`, so they load under `require-corp`.
- **Buttons without an explicit `color` render black.** `global.css` doesn't set `color: inherit` on buttons and no `color-scheme` is declared, so they get the browser's `ButtonText`, which is black (`rgb(0,0,0)` in both themes, measured). In dark mode that's near-invisible.
- **The global input rule really does break controls (measured).** Range inputs become 50px-tall padded boxes with a large rounded focus ring. A colour input with no `padding: 0` override gets an 8×8 content box (Triangle) or a 0px-high one (BoxShadow), so the swatch disappears. A checkbox with no override stretches to `width: 100%`.

---

### /css — src/pages/Glass.jsx (169 lines)
**What it does**
- Sliders for blur (0–40px), "Transparency" (really the alpha of the base colour, 0–1) and saturation (0–2).
- Base colour via a colour picker plus a free-text field.
- Live frosted card over a remote Unsplash photo.
- CSS output with background, backdrop-filter (plus `-webkit-`), and a hardcoded border, radius and shadow; Copy button with a "Copied!" state.
- The generated CSS matches the preview card.

**Integrations:** none. Sending the CSS to the pipeline would be an obvious fit.

**Bugs**
- **L14–19, L93–96 · medium · confirmed-by-running.** `hexToRgb` only handles `#rrggbb`. Typing `#fff` gives `rgba(255, 15, NaN, 0.2)`, `ffffff` gives `rgba(255, 255, 15, …)` (wrong colour, no error), and `red` gives NaN. The CSS output is invalid while the preview keeps showing the last valid colour.
- **L63–64 · low-medium · confirmed-by-reading.** "Transparency 20%" is actually alpha 0.2, i.e. 80% transparent. The label is inverted.
- **L57/68/79, L23–24 · low · confirmed-by-running.** Slider values are stored as strings. At saturation 1.1 the CSS reads `saturate(110.00000000000001%)`.
- **L30–34 · low · confirmed-by-reading.** `clipboard.writeText` isn't awaited or caught, so "Copied!" shows even when the copy fails. Where `navigator.clipboard` doesn't exist (e.g. plain http on a LAN IP) it throws and nothing happens.

**UX**
- L143–162: the absolutely positioned Copy button overlaps the first CSS line at narrow widths.
- L105: the preview loads a third-party image. That contradicts PrivacyBadge's "No data is sent to any server" and doesn't work offline (PWA has no runtime caching).
- No numeric inputs.
- Labels aren't linked to their inputs (L52/63/74/85).

**Theming**
- L121: if the remote image is missing (offline or blocked), the white card text sits on a light page in light mode and is unreadable. Add a local gradient fallback under the image.
- L55–81: the sliders get the global boxed style.
- L87–92: the colour input picks up the global border, background and radius, unlike Gradient's borderless picker.

**Fix sketch**
- Validate with `CSS.supports('color', v)` and normalise to `#rrggbb` before `hexToRgb`.
- Store numbers (`+e.target.value`) and round the output.
- Relabel the slider "Opacity".
- `try { await writeText } catch {}` and only then set `copied`.
- Bundle a local background image or gradient.

---

### /gradient — src/pages/Gradient.jsx (86 lines)
**What it does:** two colours (picker + text each), angle 0–360, `linear-gradient(...)` output with an icon-only copy button, preview panel. Linear, two stops only.

**Integrations:** none. Inspector.jsx L150 sends detected hex colours here with `state: { input }`, but Gradient never reads it (no `useSmartInput`), so the colour is dropped. That hand-off should probably go to `/color` anyway.

**Bugs**
- **L27/35 → L11/L65 · medium · confirmed-by-running (React in Chromium).** An invalid or half-typed colour (`#ff000`, `notacolor`) shows up in the CSS output while the preview keeps the old gradient: React's `style.background = invalid` is silently ignored. The colour pickers (L26/34) also fall back to black for those values.
- **L50–55 · low.** Copy has no feedback, no error handling and no `aria-label`. The icon is vertically centred over the code text with no padding reserved, so it overlaps once the line wraps (it does wrap in a ~340px column).

**UX:** no radial or conic gradients, no stop positions, no swapping colours.

**Theming**
- L47 `rgba(0,0,0,0.3)` code block looks like a muddy grey slab (#b3b3b3) in light mode (screenshot). Use `var(--bg-app)` or a new `--bg-code` token.
- L41: the range slider gets the global box and has no `accentColor`, so it's browser-default blue regardless of the hue preset.

**Fix sketch:** validate colours and keep a separate "last valid" value for the preview while flagging the invalid text field; add copy feedback through a shared hook; read `location.state.input`.

---

### /triangle — src/pages/Triangle.jsx (142 lines)
**What it does**
- Direction top/bottom/left/right, colour (picker + text), size 10–300 (which is the border width).
- Preview plus "clean" CSS using per-side `border-*` declarations.

**Border math, checked for all four directions:** correct. "Top" has a coloured bottom border with transparent left/right, so it points up; bottom, left and right mirror that. The preview's `borderTop: 'none'` matches the CSS leaving `border-top` out. Each triangle is a right isosceles triangle, 2·size wide by size tall (or the reverse for left/right).

**Bugs**
- **L109 · medium · confirmed-by-running.** The colour input sets `border: none; background: none` but not `padding: 0`, so the global 16px padding leaves an 8×8 content box. The swatch renders as a tiny dash and the picker looks missing.
- **L136–137 · medium · confirmed-by-reading.** No overflow handling. At size 300 a top/bottom triangle is 600px wide in a ~376px column. The centred overflow spills over the controls column, and the left side can't be scrolled to; on mobile it's clipped by Layout's `main { overflow: hidden }`.
- **L110 · low-medium.** An invalid colour gives invalid CSS and a stale preview. On a direction change, the invalid `solid` value is dropped for the newly coloured side, so the triangle disappears.
- **L36–44 · low (latent).** The unused `cssOutput` uses `border-width: 0 w w w` for "bottom", which zeroes the coloured top border. Delete it.

**UX:** "Size (100px)" actually produces a 200px-wide triangle. No separate width/height and no corner (diagonal) directions. Copy (L125–130) has no feedback or label.

**Theming:** L122 `rgba(0,0,0,0.3)` code block and L136 `rgba(0,0,0,0.2)` stage are dark-only literals. L116: boxed slider, default blue.

**Fix sketch:** `padding: 0` on the colour input (or fix the global rule); `overflow: hidden` on the stage or cap the size to the stage width; separate width and height controls.

---

### /box-shadow — src/pages/BoxShadow.jsx (133 lines)
**What it does:** any number of shadow layers, each with x, y, blur, spread, opacity, colour and inset. Preview is a white 200px box on a white stage. One-line `box-shadow` CSS output. The CSS matches the preview.

**Integrations:** none.

**Bugs**
- **L80 · medium · confirmed-by-running.** The colour input is 30px tall with 16px global padding top and bottom, so its content height is 0. Only a thin line shows and the colour can't be seen.
- **L91 · medium · confirmed-by-running.** The "+ Add Layer" button has no `color`, so its text is black (`ButtonText`) on the dark glass panel. In the default theme it's near-invisible.
- **L85 · low-medium · confirmed-by-running.** The checkbox picks up the global `width: 100%` and becomes 188px wide inside the flex label. "Inset Shadow" gets squeezed onto two lines.

**UX**
- Copy (L121) has no feedback.
- No numeric inputs.
- Preview stage is white only (L101): you can't check shadows on a dark surface, and in dark mode it's a glaring slab. Add a stage background toggle.
- The page has no centred title or description like the others (L42).

**Theming:** L125 `rgba(0,0,0,0.3)` and `fontFamily: 'monospace'` instead of `var(--font-mono)`. L60–76: five boxed default-blue sliders per layer.

**Fix sketch:** `padding: 0` on the colour input and `width: auto` on the checkbox (or fix globally); `color: inherit` on the add button (or globally on `button`).

---

### /color-blindness — src/pages/ColorBlindness.jsx (129 lines)
**What it does:** upload one image (read as a data URL, click only), then pick normal, protanopia, deuteranopia, tritanopia or achromatopsia. Each mode applies an SVG `feColorMatrix` through CSS `filter: url(#id)`.

**Integrations:** none.

**Bugs**
- **L52 · high · confirmed-by-running (Playwright, red test swatch).** The filter definitions sit in an `<svg style="display:none">`, which makes results depend on the browser:

  | Engine | Output for pure red | What happens |
  |---|---|---|
  | Firefox | `[255,0,0]` | Filter isn't applied at all; every mode shows the original |
  | Chromium | `[145,142,0]` | Applied in sRGB (`color-interpolation-filters` ignored in the display:none subtree) |
  | WebKit | `[198,197,0]` | Applied in linearRGB (the SVG default) |

  The same filter in a visible 0×0 SVG gives linearRGB in all three engines.

- **L21–46 · medium · confirmed-by-running.** These are the widely copied "ColorJack" matrices, which are approximations and don't come from a colour-vision model.
  - Protanopia: pure red should look dark. Machado 2009 (linear) gives `[109,95,0]`; the page gives `[145,142,0]` (Chrome) or `[198,197,0]` (Safari).
  - Deuteranopia: red comes out bright yellow, `[159,179,0]` / `[207,218,0]` vs Machado `[163,144,0]`.
  - Achromatopsia uses Rec.601 luma weights (0.299/0.587/0.114), which belong in gamma space. In linear space red becomes 149 grey vs the correct 127.
- **L10–17 · low.** No error handling, and big photos are kept as a base64 data-URL string. An object URL would be lighter.

**UX**
- No original-vs-simulated comparison.
- No anomalous trichromacy modes (protanomaly etc. are the most common forms).
- No drag-and-drop.
- The upload `<label>` wraps a `display:none` input, so keyboard users can't open it.
- Suspected: `maxHeight: 100%` on the image (L113) has no effect because the parent height isn't definite, so tall images aren't fitted to the view.

**Theming:** L77–78 `#fff` text on `var(--primary)` (see the contrast table under group-level patterns).

**Fix sketch**
- Render `<svg width="0" height="0" aria-hidden style={{position:'absolute'}}>`.
- Set `color-interpolation-filters="linearRGB"` on each `<filter>` explicitly.
- Switch to Machado 2009 matrices (severity 1.0) and Rec.709 luminance for achromatopsia.
- Add severity or anomaly variants and a split view.

---

### /color — src/pages/ColorConverter.jsx (243 lines)
**What it does:** HEX text input, a hidden picker over the swatch, HSL sliders, RGB number inputs plus sliders, random colour. Copy rows for HEX, RGB, HSL, HWB and "CSS" (which is the same as HEX).

**Integrations:** none. It should use `useSmartInput` and be where the Inspector sends colours.

**Conversion results (functions copied verbatim and run)**
- 3-digit hex works, with or without `#`.
- 4- and 8-digit hex are rejected by the L71 regex, and L156 `maxLength={7}` makes 8-digit impossible to type. No alpha support anywhere.
- Integer HSL: 15,002,160 of 16,777,216 colours (89.4%) don't survive HEX→HSL→HEX; worst error is 5/255 per channel (e.g. `#02e4e6` → `#02dfe3`).
- 9,351 colours display as `hsl(360, …)`.

**Bugs**
- **L69 · medium · confirmed-by-running (logic).** Hex text is stored raw.
  - Pasting `6366f1` (no `#`) updates RGB and HSL, but the HEX and CSS rows show `6366F1` (invalid CSS) and the swatch stays on the old colour (L133).
  - Partial or invalid input (`#12`, `#abcd`) stays in the HEX/CSS copy rows while RGB/HSL show the previous colour.
  - `#abcd` makes the swatch draw a translucent colour that matches none of the other rows.
- **L139 · low.** For 3-digit or no-`#` hex, the picker opens at the hardcoded `#6366f1` instead of the current colour.
- **L84–89 · low.** HSL state is rounded, so moving one HSL slider recomputes the HEX from the rounded values. Consider one decimal place internally.
- **L211 · low.** The RGB number field accepts decimals, giving `rgb(12.7, …)`. Clearing the field snaps it to 0.

**UX**
- You can't paste `rgb(...)`, `hsl(...)` or named colours; only hex is accepted.
- The "CSS" row duplicates HEX.
- `randomColor` can never produce `#ffffff` (L58, trivial).

**Theming:** L114 `rgba(0,0,0,0.2)` input background. L134 the white 15% swatch border vanishes in light mode, so a white colour is invisible on a white panel. L172–193 and L214–217: boxed sliders.

**Fix sketch:** parse any CSS colour (`CSS.supports` plus a canvas/`getComputedStyle` round-trip) into a canonical `{r,g,b,a}`; derive the hex string from state rather than storing the raw text; support `#rgba`/`#rrggbbaa` and an alpha slider.

---

### /snippets — src/pages/Snippets.jsx (336 lines)
**What it does**
- A carbon.now.sh-style code screenshot tool: textarea input, 12 languages (all registered in refractor 5), 6 dark Prism themes, 9 background presets including transparent, padding, mac/win/none window chrome with an editable title.
- Export PNG via `html-to-image` `toPng` at pixelRatio 2.
- README calls it a "Local code snippet manager", which it isn't.

**Integrations:** none. Reading code from the pipeline would fit.

**Bugs**
- **L266 · medium · confirmed-by-reading + library values.** The window background is hardcoded `#282a36` (Dracula's colour) for every theme except Material (`#263238`), and `customStyle` makes the theme's own `pre` background transparent. Only Dracula comes out right: VS Code should be `#1e1e1e`, Atom `#1d1f21`, Nord `#2E3440`, One Dark `hsl(220,13%,18%)`. Material's `code` tag still paints `#2f2f2f` behind each line over `#263238`, so you see bands.
- **L64 · medium · confirmed-by-running (3 exports).** `toPng` is called without `fontEmbedCSS`/`skipFonts`. On each export, html-to-image can't read the cross-origin Google Fonts sheet, so it:
  - re-fetches all 47 font files,
  - appends 47 `@font-face` rules (about 1.6 MB of base64) to the page's first inline stylesheet — 4.8 MB after three exports, and it keeps growing,
  - embeds Inter even though no visible text in the export uses it.
- **L69–71 · medium.** Failures only go to `console.error`, which terser's `drop_console: true` strips in production, so a failed export gives no feedback at all.
- **L299–313 · low-medium · confirmed-by-running.** The title input gets the global 16px padding, making the title bar 71px tall instead of about 39px — in the preview and in the exported PNG.
- **L54 · low.** `showTitle` is never used; there are also unused imports (`useEffect`, `Copy`, `Monitor`, `Type`) and a no-op `column-reverse` root (L76).

**COEP and fonts:** no breakage (headers above). The code font comes from the Prism theme stacks (Consolas, Menlo, Monaco and so on), i.e. system fonts, so exports look different per OS, and Material's "Roboto Mono" and One Dark's "Fira Code" aren't loaded. The export uses no app tokens, so it looks the same in both themes.

**UX**
- No copy-image-to-clipboard and no SVG export.
- The transparent background has no checkerboard.
- The 400px minimum window width plus padding (L265) cramps mobile and the pinned pane.

**Theming:** L140 the selected-swatch ring is `#fff` (inner ring `var(--bg-panel)`). In light mode, selecting a light or transparent swatch shows no visible selection. L115/L210: `#fff` on primary. L190–198: boxed slider.

**Fix sketch**
- Use each theme's `pre` background for the window.
- Pass `skipFonts: true`, or a once-computed `fontEmbedCSS`, or add `crossorigin="anonymous"` to the fonts `<link>`.
- `padding: 0` on the title input; show a toast on error.

---

### /qrcode — src/pages/QrCode.jsx (167 lines)
**What it does:** text/URL input, size 128–1024, error-correction level L/M/Q/H, foreground and background colour (picker + text), margin toggle, `QRCodeCanvas` (qrcode.react 4.2) preview, PNG download.

**Integrations:** none.

**Bugs**
- **L130–138 · high · confirmed-by-running.** qrcode.react throws `RangeError: Data too long` during render above 1,273 bytes at H, 2,331 at M (the default) or 2,953 at L. A 1.3 KB URL at H is enough.
  - In the main pane, the route ErrorBoundary replaces the page and the text is lost.
  - In the pinned pane (no boundary), the error reaches React Router's root default boundary (react-router 7.12 renders it at `index === 0`), so the whole app shell becomes "Unexpected Application Error".
- **L18 · medium · confirmed-by-reading.** `document.querySelector('canvas')` takes the first canvas in the document, and `canvasRef` (L15) is never attached even though `QRCodeCanvas` forwards refs. With QR pinned and Recorder in the main pane, you download Recorder's hidden `<canvas>`; with QR in both panes, the right pane downloads the left one's code.
- **Download size · medium · confirmed-by-reading (library L984–985).** The canvas is `size × devicePixelRatio` pixels, so "256px" downloads as 512px on Retina and 320px at 125% scaling.
- **L124–129 · low-medium.** The preview wrapper adds 20px of background-coloured padding that isn't in the PNG. With "Include Margin" off, the preview still shows a quiet zone but the file has none. The `borderRadius` condition is inverted.
- **L90/97 · low-medium.** An invalid colour is ignored after the canvas context resets. An invalid background draws black (all black with the default black foreground); an invalid foreground draws white on white. No inverted-colour or contrast warning.
- **L136 · low.** `includeMargin` is deprecated in v4; use `marginSize`.

**UX:** no SVG download and no empty or too-long warning.

**Theming:** L158 `var(--primary-shadow)` is undefined, so no shadow. L122 `rgba(255,255,255,0.02)` overrides the glass background. L53–61: boxed slider.

**Fix sketch**
- Pre-check capacity (or try/catch an encode in `useMemo`) and show an inline error.
- `<QRCodeCanvas ref={canvasRef}>`.
- Render the export at an exact pixel size (offscreen canvas, or `QRCodeSVG` → `drawImage`).
- `marginSize={includeMargin ? 4 : 0}` and drop the wrapper padding.

---

### /favicon — src/pages/FaviconGenerator.jsx (237 lines)
**What it does:** one image (click to upload) → favicon.ico (32×32 PNG inside an ICO), icon-16/32/192/512 PNGs, apple-touch-icon (180), site.webmanifest, tags.html, all zipped with JSZip for download.

**ICO format:** correct (checked by running). Header 0/1/1, directory entry 32×32, planes 1, bpp 32, size, offset 22, PNG payload. The file sizes and link tags are a sensible standard set.

**Integrations:** none.

**Bugs**
- **L76 · high · confirmed-by-reading.** `await new Promise(r => img.onload = r)` has no `onerror`. A file the browser can't decode (HEIC in Chrome/Firefox — the picker accepts `image/*` — a corrupt file, or a non-image picked via "All files") never settles. The button stays on "Generating…" for good; even choosing a new file doesn't reset `isGenerating`.
- **L26/L36 · medium.** `drawImage(img, 0, 0, w, h)` stretches non-square images, e.g. a 1200×600 logo gets squashed.
- **L167 · low-medium.** The X button only calls `setFile(null)`. The old "Ready! Download ZIP" box (old package) stays visible next to the empty upload zone.
- **L17, L117 · low.** The preview and zip object URLs are never revoked (leaks one per upload or generate).
- **L26/36 · low (suspected quality).** Downscaling 512 → 16 in one step with default smoothing gives aliased small icons. Set `imageSmoothingQuality = 'high'` or downscale in steps.
- **L39–40 · low.** A `null` result from `toBlob` throws inside an async callback and leaves generate hanging.
- **L204 · low.** `className="spin"` only exists while ApiTester is mounted, and the `fadeIn` keyframes (L210) are defined nowhere.
- **L118–119 · low.** Errors go to `console.error`, which is stripped in production.

**UX:** manifest name and colours are placeholders ("My App", #ffffff) with no fields to change them; no preview of the generated icons; no drag-and-drop; the drop zone is a non-focusable div; L165 `<img>` has no `alt`; the button doesn't look disabled when no file is chosen.

**Theming:** L194 white text on `var(--text-muted)` while generating is 1.67:1 in dark mode (screenshot). L164 a `#000` preview stage hides dark or transparent artwork; use a checkerboard. L210–221 hardcoded green success colours.

**Fix sketch:** `img.decode()` in try/catch with an error message; contain-fit or pad to square (with an option); clear `preview`/`generatedZip` and revoke them on clear and replace; add name and theme colour inputs.

---

### /svg — src/pages/SvgCompressor.jsx (119 lines)
**What it does:** paste SVG, press Compress. It runs 5 regex passes (strip `\n`/`\t`, strip comments, collapse whitespace, remove whitespace between tags, strip spaces around `= , :`), shows the size saved, and has Copy. No preview, no file upload, no download.

**Integrations:** none. Pipeline read/send and SmartPaste detection of `<svg` would all fit.

**Bugs**
- **L16 · high · confirmed-by-running.** Newlines and tabs are deleted outright, not replaced with a space, so tokens merge and valid SVGs come out broken.

  | Input | Output |
  |---|---|
  | `<rect\nx="1"` | `<rectx="1"` |
  | `<path\n\t\td=` | `<pathd=` |
  | `xmlns="…"\n\tviewBox=` | `"viewBox=` (missing whitespace between attributes is an XML well-formedness error) |
  | `points="0,0\n100,0\n50,100"` | `0,0100,050,100` |
  | `d="M10 10\n20 20"` | `M10 1020 20` |
  | `class="icon\nicon-lg"` | `iconicon-lg` |
  | `<script>// init\nstart()` | `start()` ends up commented out |
  | `.parent\n.child{}` (CSS) | `.parent.child` (descendant selector becomes compound) |

  CRLF files only survive by accident, because the leftover `\r` collapses to a space.
- **L22 · medium.** `>\s+<` → `><` deletes meaningful spaces between `<tspan>`s: "Hello World" becomes "HelloWorld".
- **L24 · medium.** Removing spaces around `= , :` also rewrites text content: `Ratio : 1 , 2 = 3` becomes `Ratio:1,2=3`.
- **L20 · low.** Ignores `xml:space="preserve"`.

**Specific checks:** `viewBox` and `url(#id)` references are left alone (no attributes or ids are removed), but newline-separated viewBox values merge. `<style>`/CDATA blocks stay mostly intact apart from the selector case above. There's no XSS risk because nothing is rendered. If a preview gets added, use `<img src="data:image/svg+xml,…">` rather than innerHTML.

**UX:** the output goes stale when you edit the input; Copy is enabled while empty and gives no feedback; the description promises removal of "redundant data", which doesn't happen; no preview to check the result.

**Theming:** L67/L105 `rgba(0,0,0,0.2)` textareas; L54 `#fff` on primary.

**Fix sketch:** replace the pipeline with `replace(/\s+/g,' ')` only outside text, `<style>`, `<script>` and `xml:space` content — better, parse with `DOMParser`, walk the tree and re-serialise, or use SVGO's browser build. Add a before/after `<img>` preview, upload, and a .svg download.

---

### /image-base64 — src/pages/Base64Image.jsx (240 lines)
**What it does:** drop or click an image → object-URL preview with name and size → `readAsDataURL` into a read-only textarea → Copy Raw (actually the full data URI), Copy HTML `<img>`, Copy CSS `background-image`. The only page in this group with real drag-and-drop.

**Object URLs:** handled correctly. The effect cleanup revokes on change and unmount, and `clear` revokes too (a harmless double revoke).

**Integrations:** none. Sending the data URI to the pipeline would fit.

**Bugs**
- **L22–26, L162 · medium · confirmed-by-reading.** A 50 MB image becomes a ~67 MB string inside a textarea, which freezes the UI. No size limit or warning; show a truncated preview instead.
- **L23–25 · low.** On a read error, `onloadend` sets `null`, which triggers React's "null value" warning and makes the textarea uncontrolled. Clearing while a large read is still running repopulates the output afterwards.
- **L202 · low.** The filename goes unescaped into `alt="…"`: a name containing `"` breaks the snippet (self-injection only).
- **L60–61 · low.** Sizes of 1 GB and up display as "undefined".

**UX**
- "Copy Raw" includes the `data:…;base64,` prefix; add a real raw option.
- No decode direction.
- No drag-over highlight (it only reacts to mouse hover).
- Dropping outside the zone opens the file in the tab.
- The drop zone can't be reached by keyboard.
- Non-image drops are accepted silently.

**Theming:** L123 `#000` preview stage hides black or transparent images (use a checkerboard). L104/108 `rgba(255,255,255,0.02)`. L107 `rgba(var(--primary-rgb),…)` doesn't follow the hue. L168 `rgba(0,0,0,0.2)` textarea. L188/206/224 `rgba(255,255,255,0.05)` buttons.

**Fix sketch:** warn above ~2 MB and render a truncated view; copy the full value on demand; escape the alt text; abort the reader on clear.

---

### /pdf — src/pages/PdfTools.jsx (407 lines)
**What it does**
- **Merge:** add multiple PDFs (click only), reorder with arrows, remove, then `copyPages` into a new document and download.
- **Modify:** one PDF, rotate all pages by 0/90/180/270, and optionally extract a page range into a new single file.
- There is no actual "split into several files".

**Integrations:** none.

**Bugs**
- **L94–101, L136–158 · medium · confirmed-by-running.** An empty or invalid selection produces a blank PDF with no warning. Ranges like `0`, `99` (past the end), `abc`, `5-3`, `3-` or `-3` parse to `[]`. `copyPages(doc, [])` then `save()` (whose default `addDefaultPage: true` kicks in) downloads `extracted_x.pdf` containing one blank page. `1 3 5` and `1;3` quietly keep only page 1; `2-4-6` drops the 6.
- **L157 · low-medium.** `Set` plus `sort` throws away the user's order and duplicates, so `5, 1-3` comes out as 1,2,3,5.
- **L146 · low-medium · confirmed-by-running.** The range loop isn't capped at the page count: `1-1000000000` freezes for 1.4 s, and each extra zero is about 10× longer.
- **L112 · low · confirmed-by-running.** Rotation isn't normalised, so a page already at 270 rotated by 270 is written as `/Rotate 540`. Use `% 360`.
- **L128–134 · low-medium.** The download object URL is never revoked, so each merge result (possibly hundreds of MB) stays in memory.
- **L18–34 · low.** The file input value is never reset, so re-adding a file you just removed does nothing (no change event).
- **L216/L301 · low.** Hardcoded ids plus `getElementById`: with PdfTools in both panes, clicking in the right pane opens the left pane's input.
- **L249–254 · medium · confirmed-by-running.** The reorder arrows have no `color`, so they're black icons on `var(--bg-app)`, near-invisible in dark mode. No `aria-label` either.
- **L76/L122 · low.** Uses `alert()`. "Check your page ranges" is shown for any failure, including encrypted or corrupt files.

**UX:** no page count or thumbnails; no drag-and-drop (dropping a PDF navigates the tab away and loses the list); merging one file is allowed; small files show "0.00 MB" (L246); merged output loses bookmarks and AcroForm (a pdf-lib limitation, worth stating in the UI).

**Theming:** L176/191/343/384 `#fff` on primary; L340 `rgba(255,255,255,0.05)`.

**Fix sketch**
- Validate the range against the page count and show an error for empty, reversed or malformed input.
- Keep the order as entered; support `N-` and `-N`; clamp the loop.
- Revoke the URL after `click()` (in a `setTimeout`).
- `e.target.value = ''` after reading files; use `useRef`/`useId`.

---

## Group-level patterns

1. **Global input rule (global.css).** Measured damage: range inputs become 50px padded boxes with a big focus ring (in all 9 pages that use sliders), colour swatches disappear (Triangle L109, BoxShadow L80), and checkboxes stretch (BoxShadow L85). Only QrCode L108 works around it. Fix: scope the rule to `input:not([type=range],[type=color],[type=checkbox],[type=radio],[type=file])`, and set `accent-color: var(--primary)` globally. Only Glass sets `accentColor`; everything else is browser blue.

2. **Buttons inherit black text.** Add `color: inherit` to the global `button` rule, and declare `color-scheme: dark`/`light` per theme. That fixes BoxShadow's add button, PdfTools' arrows, and native controls generally.

3. **White text on `var(--primary)` fails contrast for half the presets.** WCAG AA needs 4.5:1 (3:1 for large text).

   | Preset | Dark theme | Light theme |
   |---|---|---|
   | Emerald | 1.40 | 1.68 |
   | Amber | 1.82 | 2.51 |
   | Cyber Blue | 2.04 | 2.87 |
   | Crimson | 3.18 | 4.51 |
   | Amethyst | 3.56 | 5.52 |
   | Indigo | 4.84 | 8.50 |

   Affected: Snippets, QR, Favicon, SVG, PDF, ColorBlindness. Add an `--on-primary` token per preset. The `rgba(0,0,0,.2/.3)` code wells (Gradient, Triangle, BoxShadow, ColorConverter, SVG, Base64Image) need a `--bg-inset`/`--bg-code` token.

4. **Duplicated pieces that should be shared components**
   - `<ColorField>` (picker + hex text with validation; 7 copies, all unvalidated, which causes the stale-preview bug).
   - `<SliderField>` (label, value, optional number input, accent colour).
   - `<CodeOutput>` with a `useCopy()` hook built on `useToast`. There are currently 9 copy implementations, none awaited or caught, half without feedback.
   - `<FileDropZone>` (keyboard-accessible, drag-over state, prevents the window-level drop, resets the input value) plus a `useObjectUrl()` hook, to replace 5 drop zones of which only Base64Image actually accepts drops.
   - `<SegmentedControl>` (4 versions with different active styles).
   - A checkerboard preview stage for Favicon, Base64Image, Snippets' transparent option and QR.

5. **Errors.** `console.error` is the only failure path in Snippets and Favicon, and production strips it (`drop_console`). PdfTools uses `alert()`. No page uses `useToast`.

6. **Split-pane conflicts**
   - Global DOM lookups break when a page is rendered twice or alongside another (QR's `querySelector('canvas')`, PdfTools' ids; ColorBlindness' duplicate filter ids are identical, so harmless).
   - The pinned pane has no ErrorBoundary, so one QR overflow takes down the whole app.
   - `.split-pane` and `.snippet-layout` use viewport media queries, so a half-width pinned pane still gets two columns of about 270px. Use container queries.

7. **Integrations:** none used anywhere in the group. The cheapest wins:
   - `useSmartInput` on `/color` (and point Inspector's colour hand-off there instead of `/gradient`, which drops it).
   - SmartPaste detection for `<svg`, `data:image/` and colour strings.
   - Pipeline send for the CSS from Glass, Gradient, Triangle and BoxShadow, the SVG output and the data URI; pipeline read into Snippets and SVG.

8. **Categories and naming**
   - The sidebar files QR Code, PDF Tools, Base64 Image, Favicon Generator and SVG Compressor under "Converters". The README files them under Generators, Images and Files. An "Images & Files" category would be more accurate.
   - Code Snippets is under Design, but the README calls it a snippet manager when it's a screenshot tool.
   - Duplicate sidebar icons: Layers (Favicon and Box Shadow), Image (Base64 Image and SVG).
   - Mismatched names: route `/css` for Glassmorphism, page heading "Glass Generator", doc title "Glassmorphism Generator"; "PDF Tools" vs "PDF Transformer".
   - Page headers are inconsistent (BoxShadow and Snippets lack the centred title), and max widths range from 800 to 1400px, or none.

9. **Accessibility:** only QrCode's checkbox has a linked label. Icon-only buttons have no names. File inputs sit behind non-focusable divs or labels.

10. **Side note, outside this group:** `responsive.css` is imported in App.jsx, which loads before `variables.css` in main.jsx, so variables.css overrides its `--space-*` clamp values. `--space-md` is always 16px, which is why the global input padding measured exactly 16px.
