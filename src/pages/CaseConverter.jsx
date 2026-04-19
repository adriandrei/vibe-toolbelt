import React, { useState } from 'react'
import { Copy, Type, Eraser } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'

export default function CaseConverter() {
    useDocumentTitle('Case Converter')
    const [input, setInput] = useState('Type or paste your text here to convert it...')

    const copyToClipboard = async (text) => {
        try {
            await navigator.clipboard.writeText(text)
        } catch (err) {
            console.error('Failed to copy', err)
        }
    }

    // --- Conversion Logic ---
    const getWords = (str) => {
        if (!str) return []
        // Split by spaces, underscores, hyphens, or camelCase boundaries
        return str
            .replace(/([a-z])([A-Z])/g, '$1 $2') // Split camelCase
            .replace(/[_-]+/g, ' ') // Replace separators with spaces
            .split(/\s+/) // Split by whitespace
            .filter(w => w.length > 0)
    }

    const converters = {
        lowercase: (str) => str.toLowerCase(),
        uppercase: (str) => str.toUpperCase(),
        camelCase: (str) => {
            return getWords(str)
                .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join('')
        },
        pascalCase: (str) => {
            return getWords(str)
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join('')
        },
        snakeCase: (str) => {
            return getWords(str).map(w => w.toLowerCase()).join('_')
        },
        kebabCase: (str) => {
            return getWords(str).map(w => w.toLowerCase()).join('-')
        },
        constantCase: (str) => {
            return getWords(str).map(w => w.toUpperCase()).join('_')
        },
        pathCase: (str) => {
            return getWords(str).map(w => w.toLowerCase()).join('/')
        },
        titleCase: (str) => {
            return getWords(str)
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ')
        },
        sentenceCase: (str) => {
            const lower = str.toLowerCase();
            return lower.charAt(0).toUpperCase() + lower.slice(1);
        },
        alternatingCase: (str) => {
            return str.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join('')
        },
        inverseCase: (str) => {
            return str.split('').map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join('')
        }
    }

    const cases = [
        { id: 'lowercase', label: 'lowercase' },
        { id: 'uppercase', label: 'UPPERCASE' },
        { id: 'camelCase', label: 'camelCase' },
        { id: 'pascalCase', label: 'PascalCase' },
        { id: 'snakeCase', label: 'snake_case' },
        { id: 'constantCase', label: 'CONSTANT_CASE' },
        { id: 'kebabCase', label: 'kebab-case' },
        { id: 'pathCase', label: 'path/case' },
        { id: 'titleCase', label: 'Title Case' },
        { id: 'sentenceCase', label: 'Sentence case' },
        { id: 'alternatingCase', label: 'aLtErNaTiNg cAsE' },
        { id: 'inverseCase', label: 'iNVERSE cASE' },
    ]

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">Case Converter</h2>
                <p style={{ color: 'var(--text-muted)' }}>Convert text between different naming conventions instantly.</p>
            </div>

            <div className="split-pane">
                {/* Input Column */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-dim)' }}>Input</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <PipelineRead onRead={setInput} />
                            <button
                                onClick={() => setInput('')}
                                title="Clear input"
                                style={{ color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none' }}
                            >
                                <Eraser size={16} />
                            </button>
                        </div>
                    </div>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        className="glass-panel"
                        placeholder="Type something..."
                        style={{
                            flex: 1,
                            minHeight: '300px',
                            padding: 'var(--space-md)',
                            border: '1px solid var(--border)',
                            background: 'rgba(0,0,0,0.2)',
                            fontFamily: 'var(--font-mono)',
                            resize: 'none',
                            fontSize: '1rem'
                        }}
                    />
                </div>

                {/* Results Column - Scrollable List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minHeight: 0 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-dim)' }}>Live Conversions</div>

                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-sm)',
                        paddingRight: '4px'
                    }}>
                        {cases.map(type => {
                            const result = converters[type.id](input)
                            return (
                                <div
                                    key={type.id}
                                    className="glass-panel"
                                    style={{
                                        padding: '12px var(--space-md)',
                                        border: '1px solid var(--border)',
                                        background: 'var(--bg-secondary)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-md)',
                                        transition: 'border-color 0.2s'
                                    }}
                                >
                                    <div style={{ flex: 1, overflow: 'hidden' }}>
                                        <div style={{
                                            fontSize: '0.75rem',
                                            color: 'var(--text-muted)',
                                            marginBottom: 4,
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.05em'
                                        }}>
                                            {type.label}
                                        </div>
                                        <div style={{
                                            fontFamily: 'var(--font-mono)',
                                            color: 'var(--text-main)',
                                            whiteSpace: 'nowrap',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            fontSize: '0.95rem'
                                        }}>
                                            {result || <span style={{ opacity: 0.3 }}>...</span>}
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <PipelineSend dataToSend={result} style={{ padding: '4px', border: 'none' }} />
                                        <button
                                            onClick={() => copyToClipboard(result)}
                                            style={{
                                                padding: '8px',
                                                borderRadius: 'var(--radius-sm)',
                                                color: 'var(--text-dim)',
                                                cursor: 'pointer',
                                                border: '1px solid transparent',
                                                background: 'transparent'
                                            }}
                                            title="Copy"
                                            onMouseEnter={e => {
                                                e.currentTarget.style.color = 'var(--primary)'
                                                e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.1)'
                                            }}
                                            onMouseLeave={e => {
                                                e.currentTarget.style.color = 'var(--text-dim)'
                                                e.currentTarget.style.background = 'transparent'
                                            }}
                                        >
                                            <Copy size={18} />
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    )
}
