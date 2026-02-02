import React, { useState, useRef, useEffect } from 'react'
import { Download, Copy, Code, Layout, Palette, Monitor, Type } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import {
    vscDarkPlus,
    dracula,
    atomDark,
    materialDark,
    oneDark,
    nord
} from 'react-syntax-highlighter/dist/esm/styles/prism'
import * as htmlToImage from 'html-to-image'

// Theme Map
const THEMES = {
    'VS Code': vscDarkPlus,
    'Dracula': dracula,
    'Atom': atomDark,
    'Material': materialDark,
    'One Dark': oneDark,
    'Nord': nord
}

// Gradient Presets
const BACKGROUNDS = [
    'linear-gradient(140deg, rgb(165, 142, 251), rgb(233, 191, 248))',
    'linear-gradient(to right, #4facfe 0%, #00f2fe 100%)',
    'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)',
    'linear-gradient(to top, #30cfd0 0%, #330867 100%)',
    'linear-gradient(to right, #b8cbb8 0%, #b8cbb8 0%, #b465da 0%, #cf6cc9 33%, #ee609c 66%, #ee609c 100%)',
    'linear-gradient(to top, #fbc2eb 0%, #a6c1ee 100%)',
    'linear-gradient(to right, #fa709a 0%, #fee140 100%)',
    '#1e1e1e', // Solid Dark
    'transparent'
]

export default function Snippets() {
    useDocumentTitle('Snippets')

    // State
    const [code, setCode] = useState(`function bounce(vibe) {
  if (vibe === 'checked') {
    return '🚀 Ready for lift off';
  }
  return 'Loading...';
}`)
    const [language, setLanguage] = useState('javascript')
    const [themeName, setThemeName] = useState('Dracula')
    const [background, setBackground] = useState(BACKGROUNDS[0])
    const [padding, setPadding] = useState(64)
    const [windowStyle, setWindowStyle] = useState('mac') // mac, win, none
    const [title, setTitle] = useState('snippet.js')
    const [showTitle, setShowTitle] = useState(true)
    const [isExporting, setIsExporting] = useState(false)

    const exportRef = useRef(null)

    // Export Handler
    const handleExport = async () => {
        if (!exportRef.current) return
        setIsExporting(true)
        try {
            const dataUrl = await htmlToImage.toPng(exportRef.current, { pixelRatio: 2 })
            const link = document.createElement('a')
            link.download = 'snippet.png'
            link.href = dataUrl
            link.click()
        } catch (err) {
            console.error('Export failed', err)
        }
        setIsExporting(false)
    }

    return (
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: 'var(--space-lg)', flexDirection: 'column-reverse' }} className="responsive-stack">

            {/* Controls Sidebar (Bottom on mobile, Left on Desktop via CSS ideally, but here simpler column reverse stack or similar) */}
            {/* Actually, let's do a standard layouts: Left controls, Right preview */}
            <style>{`
                .snippet-layout {
                    display: grid;
                    grid-template-columns: 300px 1fr;
                    gap: var(--space-lg);
                }
                @media (max-width: 900px) {
                    .snippet-layout {
                        grid-template-columns: 1fr;
                    }
                }
                .input-group { margin-bottom: var(--space-md); }
                .input-label { display: block; color: var(--text-muted); font-size: 0.9rem; margin-bottom: 8px; }
            `}</style>

            <div className="snippet-layout">
                {/* Sidebar Controls */}
                <div className="glass-panel" style={{ padding: 'var(--space-md)', height: 'fit-content' }}>
                    <h3 style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Layout size={20} /> Settings
                    </h3>

                    {/* Window Style */}
                    <div className="input-group">
                        <label className="input-label">Window Style</label>
                        <div style={{ display: 'flex', background: 'var(--bg-app)', padding: 4, borderRadius: 'var(--radius-sm)' }}>
                            {['mac', 'win', 'none'].map(s => (
                                <button
                                    key={s}
                                    onClick={() => setWindowStyle(s)}
                                    style={{
                                        flex: 1,
                                        padding: '8px',
                                        border: 'none',
                                        background: windowStyle === s ? 'var(--primary)' : 'transparent',
                                        color: windowStyle === s ? '#fff' : 'var(--text-muted)',
                                        borderRadius: 4,
                                        cursor: 'pointer',
                                        textTransform: 'capitalize',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Background */}
                    <div className="input-group">
                        <label className="input-label"><Palette size={14} style={{ display: 'inline', marginRight: 4 }} /> Background</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                            {BACKGROUNDS.map((bg, i) => (
                                <button
                                    key={i}
                                    onClick={() => setBackground(bg)}
                                    style={{
                                        width: '100%',
                                        aspectRatio: '1',
                                        background: bg,
                                        border: background === bg ? '2px solid #fff' : '1px solid var(--border)',
                                        borderRadius: '50%',
                                        cursor: 'pointer',
                                        position: 'relative'
                                    }}
                                >
                                    {background === bg && <div style={{ position: 'absolute', inset: 0, border: '2px solid var(--bg-panel)', borderRadius: '50%' }}></div>}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Theme */}
                    <div className="input-group">
                        <label className="input-label">Syntax Theme</label>
                        <select
                            value={themeName}
                            onChange={e => setThemeName(e.target.value)}
                            style={{ width: '100%', padding: '10px', background: 'var(--bg-app)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                        >
                            {Object.keys(THEMES).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    {/* Language */}
                    <div className="input-group">
                        <label className="input-label"><Code size={14} style={{ display: 'inline', marginRight: 4 }} /> Language</label>
                        <select
                            value={language}
                            onChange={e => setLanguage(e.target.value)}
                            style={{ width: '100%', padding: '10px', background: 'var(--bg-app)', color: 'var(--text-main)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                        >
                            <option value="javascript">JavaScript</option>
                            <option value="typescript">TypeScript</option>
                            <option value="html">HTML</option>
                            <option value="css">CSS</option>
                            <option value="python">Python</option>
                            <option value="json">JSON</option>
                            <option value="sql">SQL</option>
                            <option value="bash">Bash</option>
                            <option value="markdown">Markdown</option>
                            <option value="csharp">C#</option>
                            <option value="go">Go</option>
                            <option value="rust">Rust</option>
                        </select>
                    </div>

                    {/* Padding */}
                    <div className="input-group">
                        <label className="input-label">Padding ({padding}px)</label>
                        <input
                            type="range"
                            min="0"
                            max="128"
                            step="8"
                            value={padding}
                            onChange={e => setPadding(Number(e.target.value))}
                            style={{ width: '100%' }}
                        />
                    </div>

                    <div style={{ borderTop: '1px solid var(--border)', margin: 'var(--space-md) 0' }} />

                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: 'var(--primary)',
                            color: '#fff',
                            border: 'none',
                            borderRadius: 'var(--radius-md)',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            gap: 8
                        }}
                    >
                        {isExporting ? 'Exporting...' : <><Download size={18} /> Export PNG</>}
                    </button>

                </div>

                {/* Preview Area */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* Editor Input (Hidden/Overlay) */}
                    {/* We use a simple textarea for input, and render the result */}
                    <div style={{ marginBottom: 'var(--space-md)' }}>
                        <label className="input-label">Code Content (Type here)</label>
                        <textarea
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            style={{
                                width: '100%',
                                height: '150px',
                                background: 'var(--bg-app)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                                padding: '12px',
                                color: 'var(--text-main)',
                                fontFamily: 'var(--font-mono)',
                                resize: 'vertical'
                            }}
                            spellCheck="false"
                        />
                    </div>

                    {/* The Canvas */}
                    <div style={{ overflow: 'auto', background: '#0f0f12', padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)' }}>
                        <div
                            ref={exportRef}
                            style={{
                                padding: `${padding}px`,
                                background: background,
                                minWidth: 'fit-content',
                                minHeight: '400px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            <div style={{
                                minWidth: '400px',
                                background: themeName === 'Material' ? '#263238' : '#282a36', // Fallback
                                borderRadius: '8px',
                                boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
                                overflow: 'hidden'
                            }}>
                                {/* Window Header */}
                                {windowStyle !== 'none' && (
                                    <div style={{
                                        padding: '12px 16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        background: 'rgba(0,0,0,0.2)'
                                    }}>
                                        {windowStyle === 'mac' && (
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }}></div>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }}></div>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }}></div>
                                            </div>
                                        )}
                                        {windowStyle === 'win' && (
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                {/* Windows style min/max/close icons simplified */}
                                                <div style={{ width: 12, height: 1, background: 'rgba(255,255,255,0.5)', marginTop: 6 }}></div>
                                                <div style={{ width: 12, height: 12, border: '1px solid rgba(255,255,255,0.5)' }}></div>
                                                <div style={{ width: 12, height: 12, position: 'relative' }}>
                                                    <div style={{ position: 'absolute', top: 5, left: 0, width: 14, height: 1, background: 'rgba(255,255,255,0.5)', transform: 'rotate(45deg)' }}></div>
                                                    <div style={{ position: 'absolute', top: 5, left: 0, width: 14, height: 1, background: 'rgba(255,255,255,0.5)', transform: 'rotate(-45deg)' }}></div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Title Input */}
                                        <input
                                            value={title}
                                            onChange={e => setTitle(e.target.value)}
                                            style={{
                                                background: 'transparent',
                                                border: 'none',
                                                color: 'rgba(255,255,255,0.4)',
                                                textAlign: 'center',
                                                width: '100%',
                                                marginLeft: windowStyle === 'mac' ? -52 : 0, // visual centering
                                                fontSize: '0.85rem',
                                                fontFamily: 'sans-serif',
                                                outline: 'none'
                                            }}
                                        />
                                    </div>
                                )}

                                {/* Code Render */}
                                <div style={{ fontSize: '14px', lineHeight: '1.5' }}>
                                    <SyntaxHighlighter
                                        language={language}
                                        style={THEMES[themeName]}
                                        customStyle={{ margin: 0, padding: '24px', background: 'transparent' }} // Transparent to let container bg show if needed, usually theme has its own
                                        showLineNumbers={false}
                                        wrapLines={true}
                                    >
                                        {code}
                                    </SyntaxHighlighter>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
