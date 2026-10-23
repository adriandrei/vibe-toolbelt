import { memo } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { codeThemeDark, codeThemeLight } from './codeThemes'
import { useTheme } from '../ThemeProvider'
import CopyButton from './CopyButton'

const HIGHLIGHT_LIMIT = 200_000

/**
 * Read-only code output that follows the light/dark theme.
 *
 *   <CodeBlock code={css} language="css" />
 *   <CodeBlock code={json} language="json" title="Response" maxHeight={400} />
 *
 * Very large inputs fall back to plain text so typing stays responsive.
 */
function CodeBlock({ code = '', language = 'text', title, maxHeight, wrap = true, showCopy = true, copyLabel = 'Copy', className = '', style, actions }) {
    const { theme } = useTheme()
    const text = typeof code === 'string' ? code : String(code ?? '')
    const canHighlight = language !== 'text' && text.length <= HIGHLIGHT_LIMIT
    const showToolbar = title || showCopy || actions

    return (
        <div className={className} style={{ position: 'relative', minWidth: 0, ...style }}>
            {showToolbar && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>{title}</span>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center' }}>
                        {actions}
                        {showCopy && <CopyButton text={text} label={copyLabel} />}
                    </div>
                </div>
            )}
            {canHighlight ? (
                <SyntaxHighlighter
                    language={language}
                    style={theme === 'light' ? codeThemeLight : codeThemeDark}
                    wrapLongLines={wrap}
                    customStyle={{
                        margin: 0,
                        padding: 'var(--space-md)',
                        background: 'var(--bg-inset)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.85rem',
                        maxHeight,
                        overflow: 'auto',
                    }}
                    codeTagProps={{ style: { fontFamily: 'var(--font-mono)', background: 'transparent', ...(wrap ? { overflowWrap: 'anywhere', wordBreak: 'break-word' } : null) } }}
                >
                    {text}
                </SyntaxHighlighter>
            ) : (
                <pre className="code-well" style={{ maxHeight, margin: 0, whiteSpace: wrap ? 'pre-wrap' : 'pre' }}>{text}</pre>
            )}
        </div>
    )
}

export default memo(CodeBlock)
