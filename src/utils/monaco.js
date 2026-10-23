// Monaco, bundled with the app (no CDN), so the editors work offline and no
// third-party request is made. Importing this module configures
// @monaco-editor/react to use the bundled copy and Vite-built workers.
// Only the editor core plus the languages the app uses (JSON, SQL, XML).
// Importing 'monaco-editor' itself would also bundle the TypeScript, CSS and
// HTML language workers (~9 MB) that nothing here needs.
import * as monaco from 'monaco-editor/esm/vs/editor/edcore.main'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution'
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import { parseColor, toHex } from './color'

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
    // Only the active theme can be read from the page; the other one keeps the
    // stock colours until it becomes active and is redefined.
    m.editor.defineTheme(MONACO_THEMES.light, { base: 'vs', inherit: true, rules: [], colors: isLight ? current : {} })
    m.editor.defineTheme(MONACO_THEMES.dark, { base: 'vs-dark', inherit: true, rules: [], colors: isLight ? {} : current })
}

export { monaco }
