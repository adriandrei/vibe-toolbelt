import { useEffect, useRef } from 'react'
import Editor, { DiffEditor } from '@monaco-editor/react'
import { Loader2 } from 'lucide-react'
import { useTheme } from './ThemeProvider'
import { MONACO_FONT, MONACO_THEMES, defineAppThemes, monaco } from '../utils/monaco'

const BASE_OPTIONS = {
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: MONACO_FONT,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    automaticLayout: true,
    padding: { top: 12, bottom: 12 },
    fixedOverflowWidgets: true,
    // Let the page scroll when the editor reaches its top or bottom
    scrollbar: { alwaysConsumeMouseWheel: false },
    tabSize: 2,
}

function EditorLoading() {
    return (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <Loader2 size={16} className="spin" aria-hidden="true" /> Loading editor…
        </div>
    )
}

// Keeps the editor themes in sync with the app theme and accent hue.
function useMonacoTheme() {
    const { theme, hue } = useTheme()
    useEffect(() => {
        defineAppThemes(monaco)
    }, [theme, hue])
    return theme === 'light' ? MONACO_THEMES.light : MONACO_THEMES.dark
}

const frameStyle = (height, resizable) => ({
    position: 'relative',
    height,
    minHeight: 200,
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    background: 'var(--bg-inset)',
    resize: resizable ? 'vertical' : undefined,
})

/**
 * Theme-aware Monaco editor, bundled locally (see utils/monaco.js).
 *
 *   <CodeEditor value={text} onChange={setText} language="json" ariaLabel="Input JSON" />
 *   <CodeEditor value={output} language="sql" readOnly placeholder="Output appears here" />
 *
 * The frame has a fixed (CSS) height and can be resized vertically by the user.
 */
export default function CodeEditor({
    value,
    onChange,
    language = 'plaintext',
    readOnly = false,
    height = 'clamp(240px, 50vh, 640px)',
    resizable = true,
    ariaLabel,
    placeholder,
    options,
    onMount,
    className = '',
    style,
}) {
    const themeName = useMonacoTheme()

    return (
        <div className={className} style={{ ...frameStyle(height, resizable), ...style }}>
            <Editor
                height="100%"
                language={language}
                theme={themeName}
                value={value}
                onChange={(next) => onChange?.(next ?? '')}
                beforeMount={(m) => defineAppThemes(m)}
                onMount={onMount}
                loading={<EditorLoading />}
                options={{
                    ...BASE_OPTIONS,
                    readOnly,
                    domReadOnly: readOnly,
                    renderLineHighlight: readOnly ? 'none' : 'line',
                    ariaLabel,
                    ...options,
                }}
            />
            {placeholder && !value && (
                <div
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        top: 12,
                        left: 64,
                        right: 16,
                        pointerEvents: 'none',
                        color: 'var(--text-dim)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 13,
                        lineHeight: '19px',
                    }}
                >
                    {placeholder}
                </div>
            )}
        </div>
    )
}

/**
 * Side-by-side (or inline) Monaco diff, computed in the editor worker so large
 * documents don't block the page.
 */
export function CodeDiffEditor({ original, modified, language = 'plaintext', inline = false, height = 'clamp(240px, 50vh, 640px)', ariaLabel, className = '', style }) {
    const themeName = useMonacoTheme()
    const editorRef = useRef(null)

    // The wrapper disposes the models before the diff widget, which Monaco
    // reports as an error. Keep them alive and dispose them once the widget
    // itself is gone (this cleanup runs before the wrapper's own).
    useEffect(() => () => {
        const models = editorRef.current?.getModel?.()
        editorRef.current = null
        setTimeout(() => {
            models?.original?.dispose()
            models?.modified?.dispose()
        }, 0)
    }, [])

    return (
        <div className={className} style={{ ...frameStyle(height, true), ...style }}>
            <DiffEditor
                height="100%"
                language={language}
                theme={themeName}
                original={original}
                modified={modified}
                keepCurrentOriginalModel
                keepCurrentModifiedModel
                beforeMount={(m) => defineAppThemes(m)}
                onMount={(editor) => { editorRef.current = editor }}
                loading={<EditorLoading />}
                options={{
                    ...BASE_OPTIONS,
                    readOnly: true,
                    originalEditable: false,
                    renderSideBySide: !inline,
                    useInlineViewWhenSpaceIsLimited: true,
                    ignoreTrimWhitespace: false,
                    renderOverviewRuler: false,
                    maxComputationTime: 3000,
                    ariaLabel,
                }}
            />
        </div>
    )
}
