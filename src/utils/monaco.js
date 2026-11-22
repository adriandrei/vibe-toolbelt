// Monaco, bundled with the app (no CDN), so the editors work offline and no
// third-party request is made. Importing this module configures
// @monaco-editor/react to use the bundled copy and Vite-built workers.
// Only the editor core plus the languages the app uses. JSON gets the full
// language service (validation, folding) in its worker. Everything else uses
// the lightweight "basic languages": Monarch tokenizers for syntax
// highlighting, each a few KB, registered here and loaded lazily the first
// time an editor uses the language. Importing 'monaco-editor' itself (its
// editor.main), or the TypeScript/CSS/HTML language services, would add their
// workers (~12 MB for TypeScript alone) and an LSP client for IntelliSense
// that read-only formatting doesn't need.
//
// Monaco 0.56+ paths: the package's "exports" map 'monaco-editor/<path>' to
// esm/vs/<path>.js. The editor core is editor.api plus the editor features;
// the modules after features/register.all are the rest of what editor.main
// loads besides languages (core commands, suggest, go-to commands, …).
import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/features/register.all'
import 'monaco-editor/editor/browser/coreCommands'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations'
import 'monaco-editor/editor/contrib/dropOrPasteInto/browser/copyPasteContribution'
import 'monaco-editor/editor/contrib/gotoSymbol/browser/goToCommands'
import 'monaco-editor/editor/contrib/gotoError/browser/markerSelectionStatus'
import 'monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens'
import 'monaco-editor/editor/contrib/suggest/browser/suggestController'
import 'monaco-editor/editor/common/standaloneStrings'
import 'monaco-editor/language/json/monaco.contribution'
import 'monaco-editor/languages/definitions/sql/register'
import 'monaco-editor/languages/definitions/xml/register'
import 'monaco-editor/languages/definitions/html/register'
import 'monaco-editor/languages/definitions/css/register'
import 'monaco-editor/languages/definitions/scss/register'
import 'monaco-editor/languages/definitions/less/register'
import 'monaco-editor/languages/definitions/javascript/register'
import 'monaco-editor/languages/definitions/typescript/register'
import 'monaco-editor/languages/definitions/yaml/register'
import 'monaco-editor/languages/definitions/graphql/register'
import 'monaco-editor/languages/definitions/markdown/register'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import { contrastRatio, parseColor, toHex } from './color'

self.MonacoEnvironment = {
    getWorker(_workerId, label) {
        if (label === 'json') return new JsonWorker()
        return new EditorWorker()
    },
}

loader.config({ monaco })

// The AMD/CDN loader used to expose `window.monaco`; keep it for debugging and
// the end-to-end tests that drive the editors through the Monaco API.
if (typeof window !== 'undefined') window.monaco = monaco

export const MONACO_FONT = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

// Monaco measures glyphs when an editor is created. The self-hosted mono font
// may still be loading at that point, so measure again once it is available.
if (typeof document !== 'undefined' && document.fonts?.load) {
    document.fonts.load("13px 'JetBrains Mono Variable'")
        .then(() => monaco.editor.remeasureFonts())
        .catch(() => {})
}

export const MONACO_THEMES = { light: 'vt-light', dark: 'vt-dark' }

function token(styles, name, fallback) {
    const parsed = parseColor(styles.getPropertyValue(name).trim())
    return parsed ? toHex(parsed) : fallback
}

// Syntax colours of Monaco's stock themes ('vs', 'vs-dark') that can fall
// below 4.5:1 on the app's editor background (with the current-line highlight,
// for some accent hues), grouped by colour. defineAppThemes darkens (light
// theme) or lightens (dark theme) each one just enough.
const LOW_CONTRAST_TOKENS = {
    light: {
        '#cd3131': ['invalid'],
        '#4864aa': ['variable.predefined'],
        '#dd0000': ['constant'],
        '#008000': ['comment'],
        '#098658': ['number', 'attribute.value.number', 'attribute.value.unit'],
        '#808080': ['annotation', 'metatag.html', 'metatag.xml'],
        '#008080': ['type'],
        '#e00000': ['metatag'],
        '#ff0000': ['attribute.name', 'metatag.content.html', 'string.sql'],
        '#af00db': ['keyword.flow'],
        '#666666': ['operator.scss'],
        '#778899': ['operator.sql'],
        '#c700c7': ['predefined.sql'],
    },
    dark: {
        '#f44747': ['invalid'],
        '#4864aa': ['variable.predefined'],
        '#608b4e': ['comment'],
        '#b46695': ['regexp'],
        '#cc6666': ['annotation'],
        '#808080': ['delimiter.html', 'delimiter.xml'],
        '#ff0000': ['string.sql'],
        '#778899': ['operator.sql'],
    },
}
// The same for the bracket pair colours and unmatched brackets
const LOW_CONTRAST_COLORS = {
    light: { 'editorBracketHighlight.foreground2': '#319331', 'editorBracketHighlight.unexpectedBracket.foreground': '#ff1212' },
    dark: { 'editorBracketHighlight.unexpectedBracket.foreground': '#ff1212' },
}

// Mixes `hex` towards black (light theme) or white (dark theme) until it has
// at least 4.5:1 contrast (4.6 for rounding) against `background`.
function readable(hex, background, isLight) {
    const target = isLight ? 0 : 255
    let c = parseColor(hex)
    for (let i = 0; i < 30 && contrastRatio(c, background) < 4.6; i++) {
        c = { r: c.r + (target - c.r) * 0.08, g: c.g + (target - c.g) * 0.08, b: c.b + (target - c.b) * 0.08, a: 1 }
    }
    return toHex(c, false)
}

function readableSyntax(isLight, editorBackground, lineHighlight) {
    const bg = parseColor(editorBackground)
    const hl = parseColor(lineHighlight)
    if (!bg || !hl) return { rules: [], colors: {} }
    // The worst case: text on the highlighted current line
    const mix = (k) => hl[k] * hl.a + bg[k] * (1 - hl.a)
    const background = { r: mix('r'), g: mix('g'), b: mix('b') }
    const scheme = isLight ? 'light' : 'dark'
    const rules = Object.entries(LOW_CONTRAST_TOKENS[scheme]).flatMap(([hex, tokens]) => {
        const foreground = readable(hex, background, isLight).slice(1)
        return tokens.map((name) => ({ token: name, foreground }))
    })
    const colors = Object.fromEntries(Object.entries(LOW_CONTRAST_COLORS[scheme]).map(([key, hex]) => [key, readable(hex, background, isLight)]))
    return { rules, colors }
}

/**
 * (Re)defines the two editor themes from the app's design tokens, so the
 * editors sit on the same surface colours as the rest of the page and follow
 * the accent hue. Safe to call repeatedly (e.g. after a theme or hue change).
 */
export function defineAppThemes(m = monaco) {
    if (typeof document === 'undefined') return
    const styles = getComputedStyle(document.documentElement)
    const isLight = document.documentElement.getAttribute('data-theme') === 'light'
    const current = {
        'editor.background': token(styles, '--bg-inset', isLight ? '#f3f3f8' : '#101018'),
        'editorGutter.background': token(styles, '--bg-inset', isLight ? '#f3f3f8' : '#101018'),
        'editor.lineHighlightBackground': token(styles, '--bg-hover', isLight ? '#00000010' : '#ffffff12'),
        'editor.lineHighlightBorder': '#00000000',
        'editorLineNumber.foreground': token(styles, '--text-dim', isLight ? '#6b6b80' : '#9a9aae'),
        'editorLineNumber.activeForeground': token(styles, '--text-muted', isLight ? '#45455a' : '#c8c8d8'),
        'editor.selectionBackground': token(styles, '--primary-border', isLight ? '#5b5bd666' : '#8080ff73'),
        'editorCursor.foreground': token(styles, '--primary', isLight ? '#4b4bd6' : '#8a8aff'),
        'editorWidget.background': token(styles, '--bg-elevated', isLight ? '#ffffff' : '#1e1e2a'),
        'editorWidget.border': token(styles, '--border-hover', isLight ? '#00000033' : '#ffffff33'),
        'focusBorder': token(styles, '--primary', isLight ? '#4b4bd6' : '#8a8aff'),
        'scrollbarSlider.background': token(styles, '--border-hover', isLight ? '#00000033' : '#ffffff33'),
        'scrollbarSlider.hoverBackground': token(styles, '--border-strong', isLight ? '#00000055' : '#ffffff55'),
    }
    const syntax = readableSyntax(isLight, current['editor.background'], current['editor.lineHighlightBackground'])
    const active = { rules: syntax.rules, colors: { ...current, ...syntax.colors } }
    const stock = { rules: [], colors: {} }
    // Only the active theme can be read from the page; the other one keeps the
    // stock colours until it becomes active and is redefined.
    m.editor.defineTheme(MONACO_THEMES.light, { base: 'vs', inherit: true, ...(isLight ? active : stock) })
    m.editor.defineTheme(MONACO_THEMES.dark, { base: 'vs-dark', inherit: true, ...(isLight ? stock : active) })
}

export { monaco }
