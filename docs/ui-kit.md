# UI kit and page conventions

How a tool page is built in this app. Following this keeps every page consistent, readable in both themes, and wired into the cross-page features.

## Page skeleton

```jsx
import ToolHeader from '../components/ui/ToolHeader'

export default function MyTool() {
  return (
    <div className="page page-medium">      {/* page-narrow | page-medium | page-wide | (none = full) */}
      <ToolHeader />                         {/* title, icon, description from src/config/tools.js; sets the tab title */}
      <section className="card">…</section>
    </div>
  )
}
```

- **Names come from the registry** (`src/config/tools.js`): `label` is the sidebar name, `title` the page heading and tab title, and `description` the subtitle. Don't hardcode page titles. `<ToolHeader subtitle=… actions=…/>` overrides the subtitle and adds header buttons.
- **The brand** is `BRAND.name` from `src/config/brand.js`. Never hardcode it.
- **Layout adapts to the pane, not the viewport.** A tool can be shown at phone width or in the half-width pinned pane. Use:
  - `.split-pane`: one column below 640px pane width, two above.
  - `.auto-grid`, which auto-fits cards (set `--auto-grid-min` inline to tune it).
  - `usePane().size` (`'sm' | 'md' | 'lg'`) from `src/contexts/pane.js` for inline layout decisions.
- **Avoid** fixed pixel widths above about 300px, `height: calc(100vh - …)` page layouts, and grids with `minmax(300px+, …)` without `min(100%, …)`.

## Colours (src/styles/variables.css)

Never hardcode UI colours. Literal colours are only for *user content* (the gradient being edited, a QR code's colours, a preview stage the user picks).

| Use | Token |
|---|---|
| Page / card / elevated surfaces | `--bg-app`, `--bg-panel`, `--bg-card`, `--bg-elevated` |
| Text fields (set globally) | `--bg-input` |
| Code/output wells, read-only results | `--bg-inset` (or class `.code-well`) |
| Chips, inactive pills, table stripes | `--bg-subtle`; hover/selected fills: `--bg-hover` |
| Media preview stage | `--stage` with text `--on-stage` (class `.stage`); transparency: class `.checkerboard` |
| Text | `--text-main`, `--text-muted`, `--text-dim`; code text `--text-code` |
| Accent fill / border / focus | `--primary`, `--primary-border`, `--primary-glow` (tint) |
| **Accent-coloured text or icons** | **`--primary-text`** (never `--primary` for text) |
| Text on a `--primary` fill | **`--on-primary`** (never `#fff`); computed per hue |
| Secondary accent | `--accent` (fills), `--accent-text` (text) |
| Status | `--success` `--warning` `--danger` `--info` for text and icons; `--*-bg` tints and `--*-border` borders |
| Lines | `--border`, `--border-hover`, `--border-strong` |
| Shadows | `--shadow-sm/md/lg`, `--primary-shadow` |
| Translucent accent | `color-mix(in srgb, var(--primary) 15%, transparent)` or `rgba(var(--primary-rgb), .15)` (both follow the hue) |

Fonts are self-hosted: use `var(--font-family)` and `var(--font-mono)`.

## CSS classes (src/styles/components.css)

| Group | Classes |
|---|---|
| Layout | `.page` `.page-narrow` `.page-medium` `.page-wide` · `.card` `.card-compact` · `.split-pane` · `.auto-grid` |
| Text | `.section-title` · `.field-label` `.field-hint` `.field-error` `.field-invalid` · `.mono` · `.kbd` · `.sr-only` |
| Buttons | `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-outline` / `.btn-danger`, sizes `.btn-sm` / `.btn-lg`, `.btn-block` · icon-only `.icon-btn` (+ `.icon-btn-sm`), which always needs an `aria-label` |
| Status and tags | `.badge` + `-primary/-success/-warning/-danger/-info` · `.chip` (`.is-active`) |
| Output and previews | `.code-well` · `.stage` · `.checkerboard` · `.drop-zone` (prefer `FileDropZone`) |
| Animation | `.spin` (keyframes `spin`, `pulse`, `fadeIn`, `fadeInUp`, `blink` are global) |

Native form controls are styled globally. Text inputs, textareas and selects are full-width boxed fields. Checkboxes, radios, ranges and colour pickers keep their native size and take `accent-color`; don't fight the global rule with per-control padding hacks.

## Components (src/components/ui/)

Import from the file, e.g. `import CopyButton from '../components/ui/CopyButton'`.

| Component | Use for |
|---|---|
| `ToolHeader` / `PageHeader` | Page heading (h1 + subtitle + actions) |
| `CopyButton` | Any copy action: `<CopyButton text={value} />`, `iconOnly label="Copy CSS"`. Handles failure and feedback |
| `FileDropZone` | Every file picker: keyboard accessible, drag and drop, optional paste (`allowPaste`), `accept`, `multiple`, `maxSizeMB` |
| `SegmentedControl` | Mode toggles and small tab sets (`aria-pressed`) |
| `SliderField` | Labelled range sliders (numeric `onChange`, optional number box) |
| `ColorField` | Colour picker + validated text (emits normalised hex only when valid) |
| `CodeBlock` | Read-only highlighted code that follows the theme (Prism oneDark/oneLight) with copy |
| `StatusBanner` | Inline success/warning/danger/info messages, errors, results |
| `Modal` | Dialogs (portal, Escape, focus trap). Never hand-roll fixed overlays |
| `Field` | Associates a label/hint/error with one control (`htmlFor`/`aria-describedby`) |
| `EmptyState` | "Nothing here yet" placeholders |

## Hooks and utilities

| Hook / helper | Purpose |
|---|---|
| `useCopy()` (hooks/useCopy.js) | `copy(value, { key, toast })` + `isCopied(key)` when a custom copy UI is needed |
| `useToast()` (components/ToastProvider) | `toast.success/error/warning/info(msg)`. **Use instead of `alert()`** |
| `useObjectURL(blob)` | Object URL for a Blob/File, revoked automatically |
| `downloadBlob`, `downloadText`, `downloadDataURL`, `splitFilename`, `formatBytes` (utils/download.js) | Downloads and file names |
| `useDebouncedValue(value, ms)` | Debounce heavy live computations |
| `useLocalStorage(key, initial)` | Persisted state, synced across components and tabs |
| `useLeaveGuard(active, message)` | Protect unsaved work (tab close, in-app navigation, unpinning) |
| `useEscape(fn, enabled)` | Escape key handler with a stable listener |
| `usePane()` | `{ kind: 'main' | 'pinned', path, size }` |
| `parseColor`, `normalizeColor`, `toHex`, `contrastRatio` (utils/color.js) | Colour parsing and normalisation (any CSS colour) |
| `parseXml`, `formatXml`, `minifyXml` (utils/xml.js) | Validated XML pretty-printing |
| `detectFormats`, `analyzeContent` (utils/detect.js) | Content detection shared by Smart Paste, the palette and Inspector |
| `openCommandPalette()`, `isMacPlatform` (utils/palette.js) | Open the ⌘K palette from a button; show ⌘ vs Ctrl |

## Cross-page features

- **Smart input:** a tool opened with data, by Smart Paste, the palette's "Open as…" or Inspector links.
  - Producers call `openInTool(navigate, '/tool', { input, mode })` from `utils/smartNav.js`.
  - Pages consume it with `useSmartInput({ input: setInput, mode: setMode }, { onInject: (values) => run(values.input) })`.
  - Only the main pane consumes it, values are trimmed, and empty values are ignored.
  - **If the page normally converts on a button press, run it in `onInject`** so injected data shows a result straight away.
  - Modes sent today:
    - `/base64` `decode`
    - `/formatters` `json` / `sql` / `xml`
    - `/converter` `yaml`
    - `/image-base64` `decode`
- **Pipeline** (text between tools): `<PipelineSend dataToSend={output} disabled={!!error} />` and `<PipelineRead onRead={text => …} />` from `components/PipelineFeature.jsx`. Reading should load *and process* the text. Media hand-offs (Recorder → Video Studio) use `usePipeline().sendMedia(file, { source, target })` / `takeMedia(target)`.
- **AI assistant:** `useRegisterAIContext({ tool, getContext, suggestedPrompts })`. There's no deps array; `getContext` is read through a ref and always sees the latest state.
- **Tab title:** set by `ToolHeader` (or `useDocumentTitle(title)`); the pinned pane never changes it.

## Behaviour rules

- No `alert()`, `confirm()` or `prompt()`. Use toasts, `StatusBanner` or `Modal`.
- When a result can't be produced, **clear it** (don't leave the previous result next to an error) and disable Copy/Send.
- Validate input and show *why* it's invalid; never fail silently or "succeed" with garbage.
- Work that can take more than ~50 ms (crypto key generation, hashing big inputs, regex on large text, parsing MBs) belongs in a Web Worker (`new Worker(new URL('../workers/x.worker.js', import.meta.url), { type: 'module' })`), or at least debounced and size-capped.
- Clean up every interval, timeout, listener, object URL, media stream and worker on unmount.
- Every control needs an accessible name: a visible label (`Field`/`htmlFor`), `aria-label` for icon buttons, `aria-pressed` for toggles. No clickable `div`s; use `button` or `FileDropZone`.
- Don't use `document.getElementById`/`querySelector` to find your own elements (a tool can be on screen twice); use refs and `useId()`.
