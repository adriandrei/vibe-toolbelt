import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { FileText, Eye, Sparkles } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useAI } from '../contexts/AIContext'

export default function Markdown() {
    useDocumentTitle('Markdown Preview')
    const [input, setInput] = useState('# Hello World\n\n- Item 1\n- Item 2\n\n```js\nconsole.log("Code block")\n```')
    const { aiStatus, chat } = useAI()
    const [isImproving, setIsImproving] = useState(false)

    const handleAiImprove = async () => {
        if (aiStatus !== 'ready') {
            alert('Please load the local AI model first in the settings (AI Settings) page before running in-page AI tasks!')
            return
        }

        setIsImproving(true)
        let accumulated = ''
        
        const systemPrompt = `You are a helpful Markdown editor assistant. Improve the user's markdown document below. 
Fix any spelling or grammar errors, format the lists cleanly, ensure all code blocks are properly fenced and correct, and output ONLY the improved markdown document. 
Do not include any conversational talk, preamble, introduction, warnings, or explanation outside the markdown block itself. 
Return ONLY the raw markdown content.`

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: input }
        ]

        try {
            await chat(messages, {
                onToken: (token) => {
                    accumulated += token
                    setInput(accumulated)
                },
                onDone: () => {
                    setIsImproving(false)
                },
                onAbort: () => {
                    setIsImproving(false)
                }
            })
        } catch (err) {
            console.error('AI improvement failed', err)
            setIsImproving(false)
        }
    }

    return (
        <div style={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient" style={{ fontSize: '1.8rem' }}>Markdown Editor</h2>
            </div>

            <div className="split-pane">
                {/* Editor */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <div style={{ marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
                            <FileText size={16} /> Editor
                        </label>
                        <button
                            onClick={handleAiImprove}
                            disabled={isImproving}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                padding: '6px 12px',
                                background: isImproving ? 'var(--border)' : 'var(--primary)',
                                color: '#fff',
                                borderRadius: 'var(--radius-sm)',
                                fontSize: '0.8rem',
                                cursor: isImproving ? 'not-allowed' : 'pointer',
                                fontWeight: 600,
                                border: 'none',
                                transition: 'all 0.2s'
                            }}
                        >
                            <Sparkles size={13} style={{ animation: isImproving ? 'spin 1.5s linear infinite' : 'none' }} />
                            {isImproving ? 'Improving...' : aiStatus === 'ready' ? 'Improve with AI' : 'Enable AI (Load Model)'}
                        </button>
                    </div>
                    <textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        style={{
                            flex: 1,
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.9rem',
                            resize: 'none',
                            background: 'rgba(0,0,0,0.2)'
                        }}
                    />
                </div>

                {/* Preview */}
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: 'var(--space-md)' }}>
                    <label style={{ marginBottom: 'var(--space-sm)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Eye size={16} /> Preview
                    </label>
                    <div style={{
                        flex: 1,
                        overflowY: 'auto',
                        background: 'transparent',
                        color: 'var(--text-main)',
                        borderRadius: 'var(--radius-md)',
                        padding: 'var(--space-lg)',
                        lineHeight: 1.6,
                        border: '1px solid var(--border)'
                    }}>
                        <style>{`
                          .markdown-body h1, .markdown-body h2, .markdown-body h3 { border-bottom: 1px solid var(--border); margin-top: 24px; margin-bottom: 16px; font-weight: 600; line-height: 1.25; color: var(--text-main); }
                          .markdown-body h1 { font-size: 2em; padding-bottom: 0.3em; }
                          .markdown-body h2 { font-size: 1.5em; padding-bottom: 0.3em; }
                          .markdown-body p { margin-top: 0; margin-bottom: 16px; }
                          .markdown-body code { padding: 0.2em 0.4em; margin: 0; font-size: 85%; background-color: var(--bg-app); border-radius: 3px; font-family: var(--font-mono); color: var(--accent); }
                          .markdown-body pre { padding: 16px; overflow: auto; line-height: 1.45; background-color: var(--bg-app); border-radius: 6px; border: 1px solid var(--border); }
                          .markdown-body pre code { background-color: transparent; padding: 0; color: var(--text-main); }
                          .markdown-body ul, .markdown-body ol { padding-left: 2em; margin-top: 0; margin-bottom: 16px; }
                          .markdown-body blockquote { margin: 0; padding: 0 1em; color: var(--text-muted); border-left: 0.25em solid var(--border); }
                          .markdown-body a { color: var(--primary); text-decoration: none; }
                          .markdown-body a:hover { text-decoration: underline; }
                        `}</style>
                        <div className="markdown-body">
                            <ReactMarkdown>
                                {input}
                            </ReactMarkdown>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
