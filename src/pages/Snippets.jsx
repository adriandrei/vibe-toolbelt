import { useEffect, useId, useRef, useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import {
    atomDark, dracula, ghcolors, gruvboxDark, gruvboxLight, materialDark, materialOceanic,
    nightOwl, nord, okaidia, oneDark, oneLight, solarizedlight, vscDarkPlus,
} from 'react-syntax-highlighter/dist/esm/styles/prism'
import { toBlob, toSvg } from 'html-to-image'
import { ClipboardCopy, Download, FileCode2, Loader2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import SliderField from '../components/ui/SliderField'
import SegmentedControl from '../components/ui/SegmentedControl'
import ColorField from '../components/ui/ColorField'
import { PipelineRead } from '../components/PipelineFeature'
import { usePipeline } from '../contexts/PipelineContext'
import { useToast } from '../components/ToastProvider'
import { usePane } from '../contexts/pane'
import { detectFormats } from '../utils/detect'
import { downloadBlob, downloadDataURL, splitFilename } from '../utils/download'
import { luminance, parseColor } from '../utils/color'

const THEMES = {
    'VS Code Dark+': vscDarkPlus,
    Dracula: dracula,
    'Atom Dark': atomDark,
    'Material Dark': materialDark,
    'Material Oceanic': materialOceanic,
    'One Dark': oneDark,
    Nord: nord,
    'Night Owl': nightOwl,
    'Gruvbox Dark': gruvboxDark,
    Okaidia: okaidia,
    'One Light': oneLight,
    'GitHub Light': ghcolors,
    'Solarized Light': solarizedlight,
    'Gruvbox Light': gruvboxLight,
}

const LANGUAGES = [
    ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['jsx', 'JSX'], ['tsx', 'TSX'], ['markup', 'HTML / XML'],
    ['css', 'CSS'], ['scss', 'SCSS'], ['json', 'JSON'], ['yaml', 'YAML'], ['python', 'Python'], ['java', 'Java'],
    ['kotlin', 'Kotlin'], ['csharp', 'C#'], ['go', 'Go'], ['rust', 'Rust'], ['c', 'C'], ['cpp', 'C++'], ['php', 'PHP'],
    ['ruby', 'Ruby'], ['swift', 'Swift'], ['sql', 'SQL'], ['bash', 'Bash'], ['powershell', 'PowerShell'],
    ['docker', 'Dockerfile'], ['graphql', 'GraphQL'], ['markdown', 'Markdown'], ['diff', 'Diff'], ['text', 'Plain text'],
]

// Language for code loaded from the pipeline: known by the sending tool, or
// detected when the detector is confident (CSS declarations can look like YAML)
const SOURCE_LANGUAGE = { '/css': 'css', '/gradient': 'css', '/triangle': 'css', '/box-shadow': 'css', '/color': 'css', '/svg': 'markup' }
const DETECTED_LANGUAGE = { json: 'json', xml: 'markup', svg: 'markup', sql: 'sql', yaml: 'yaml', markdown: 'markdown', curl: 'bash' }

// Frame backgrounds are part of the exported image (user content)
const BACKGROUNDS = [
    { name: 'Lavender', value: 'linear-gradient(140deg, rgb(165, 142, 251), rgb(233, 191, 248))' },
    { name: 'Sky', value: 'linear-gradient(to right, #4facfe 0%, #00f2fe 100%)' },
    { name: 'Mist', value: 'linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)' },
    { name: 'Deep sea', value: 'linear-gradient(to top, #30cfd0 0%, #330867 100%)' },
    { name: 'Candy', value: 'linear-gradient(to right, #b465da 0%, #cf6cc9 33%, #ee609c 66%, #ee609c 100%)' },
    { name: 'Cotton', value: 'linear-gradient(to top, #fbc2eb 0%, #a6c1ee 100%)' },
    { name: 'Sunrise', value: 'linear-gradient(to right, #fa709a 0%, #fee140 100%)' },
    { name: 'Charcoal', value: '#1e1e1e' },
    { name: 'Transparent', value: 'transparent' },
]

const WINDOW_STYLES = [
    { value: 'mac', label: 'macOS' },
    { value: 'windows', label: 'Windows' },
    { value: 'none', label: 'None' },
]

const SCALES = [
    { value: 1, label: '1×' },
    { value: 2, label: '2×' },
    { value: 3, label: '3×' },
]

const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace"
const SANS = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"

// ---------------------------------------------------------------------------
// Fonts for the export.
//
// html-to-image would otherwise read every stylesheet, re-fetch the font
// files and rebuild the font CSS on every export. The fonts are self-hosted
// (same origin), so their @font-face rules are readable: each export embeds
// only the faces (unicode-range subsets) its text uses, and every face is
// inlined as a data URL once per session and then reused.
const EXPORT_FONTS = ['JetBrains Mono Variable', 'Inter Variable']
let fontFaces = null
const inlinedFaces = new Map()

function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(blob)
    })
}

function parseUnicodeRange(range) {
    if (!range) return null
    return range.split(',').map((part) => {
        const r = part.trim().replace(/^u\+/i, '')
        if (r.includes('?')) return [parseInt(r.replace(/\?/g, '0'), 16), parseInt(r.replace(/\?/g, 'F'), 16)]
        const [lo, hi = lo] = r.split('-')
        return [parseInt(lo, 16), parseInt(hi, 16)]
    })
}

function getFontFaces() {
    if (!fontFaces) {
        const rules = []
        const collect = (list) => {
            for (const rule of list) {
                if (rule instanceof CSSFontFaceRule) rules.push(rule)
                else if (rule.cssRules) collect(rule.cssRules)
            }
        }
        for (const sheet of document.styleSheets) {
            try {
                collect(sheet.cssRules)
            } catch {
                // a cross-origin sheet: not ours, skip it
            }
        }
        fontFaces = rules
            .filter(rule => EXPORT_FONTS.includes(rule.style.getPropertyValue('font-family').replace(/["']/g, '').trim()))
            .map(rule => ({
                css: rule.cssText,
                base: rule.parentStyleSheet?.href || document.baseURI,
                ranges: parseUnicodeRange(rule.style.getPropertyValue('unicode-range')),
            }))
    }
    return fontFaces
}

function inlineFace(face) {
    if (!inlinedFaces.has(face)) {
        const job = (async () => {
            let css = face.css
            const urls = new Set([...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(m => m[1]).filter(u => !u.startsWith('data:')))
            for (const u of urls) {
                const res = await fetch(new URL(u, face.base).href)
                if (!res.ok) throw new Error(`couldn’t load a font file (HTTP ${res.status})`)
                css = css.split(u).join(await readAsDataURL(await res.blob()))
            }
            return css
        })()
        job.catch(() => inlinedFaces.delete(face))
        inlinedFaces.set(face, job)
    }
    return inlinedFaces.get(face)
}

async function fontEmbedCSS(text) {
    const codePoints = [...new Set(Array.from(text, ch => ch.codePointAt(0)))]
    const faces = getFontFaces().filter(face => !face.ranges || codePoints.some(cp => face.ranges.some(([lo, hi]) => cp >= lo && cp <= hi)))
    return (await Promise.all(faces.map(inlineFace))).join('\n')
}

const canCopyImages = () => typeof window !== 'undefined' && window.isSecureContext && typeof window.ClipboardItem === 'function' && !!navigator.clipboard?.write

function themeBackground(theme) {
    const pre = theme['pre[class*="language-"]'] || {}
    const code = theme['code[class*="language-"]'] || {}
    const bg = pre.background || pre.backgroundColor || code.background || code.backgroundColor
    return bg && bg !== 'none' ? bg : '#1e1e1e'
}

function WindowControls({ style, ink }) {
    if (style === 'mac') {
        return (
            <div style={{ display: 'flex', gap: 8 }}>
                {['#ff5f56', '#ffbd2e', '#27c93f'].map(c => <span key={c} style={{ width: 12, height: 12, borderRadius: '50%', background: c }} />)}
            </div>
        )
    }
    // Windows: minimise, maximise, close
    return (
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ width: 11, height: 1, background: ink }} />
            <span style={{ width: 10, height: 10, border: `1px solid ${ink}` }} />
            <span style={{ position: 'relative', width: 12, height: 12 }}>
                <span style={{ position: 'absolute', top: 5.5, left: -1, width: 14, height: 1, background: ink, transform: 'rotate(45deg)' }} />
                <span style={{ position: 'absolute', top: 5.5, left: -1, width: 14, height: 1, background: ink, transform: 'rotate(-45deg)' }} />
            </span>
        </div>
    )
}

export default function Snippets() {
    const toast = useToast()
    const { size } = usePane()
    const codeId = useId()
    const [code, setCode] = useState(`function bounce(vibe) {
  if (vibe === 'checked') {
    return '🚀 Ready for lift off'
  }
  return 'Loading...'
}`)
    const [language, setLanguage] = useState('javascript')
    const [themeName, setThemeName] = useState('Dracula')
    const [background, setBackground] = useState(BACKGROUNDS[0].value)
    const [customColor, setCustomColor] = useState('#0f172a')
    const [padding, setPadding] = useState(64)
    const [fontSize, setFontSize] = useState(14)
    const [windowStyle, setWindowStyle] = useState('mac')
    const [title, setTitle] = useState('snippet.js')
    const [lineNumbers, setLineNumbers] = useState(false)
    const [scale, setScale] = useState(2)
    const [busy, setBusy] = useState(null) // 'png' | 'svg' | 'copy'
    const exportRef = useRef(null)
    const frameRef = useRef(null)

    // The preview is scaled down to fit narrow panes; the export is always full size
    const [dims, setDims] = useState({ available: 0, width: 0, height: 0 })
    useEffect(() => {
        const frame = frameRef.current
        const node = exportRef.current
        if (!frame || !node || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => {
            setDims({ available: frame.clientWidth, width: node.offsetWidth, height: node.offsetHeight })
        })
        observer.observe(frame)
        observer.observe(node)
        return () => observer.disconnect()
    }, [])
    const fit = dims.width > 0 && dims.available > 0 ? Math.min(1, dims.available / dims.width) : 1

    const theme = THEMES[themeName]
    const windowBg = themeBackground(theme)
    const lightWindow = luminance(parseColor(windowBg) ?? { r: 30, g: 30, b: 30 }) > 0.4
    const ink = lightWindow ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.5)'
    const codeTagStyle = theme['code[class*="language-"]'] || {}
    const baseName = splitFilename(title.trim() || 'code').base || 'code'

    const exportOptions = async () => {
        await document.fonts.ready
        return { pixelRatio: scale, fontEmbedCSS: await fontEmbedCSS(`${code}${title}`), cacheBust: false }
    }

    const run = async (kind, task) => {
        if (!exportRef.current || busy) return
        setBusy(kind)
        try {
            await task(exportRef.current)
        } catch (err) {
            toast.error(`Export failed: ${err?.message || 'the image couldn’t be rendered'}`)
        } finally {
            setBusy(null)
        }
    }

    const exportPng = () => run('png', async (node) => {
        const blob = await toBlob(node, await exportOptions())
        if (!blob) throw new Error('the browser returned an empty image')
        downloadBlob(blob, `${baseName}.png`)
    })

    const exportSvg = () => run('svg', async (node) => {
        const dataUrl = await toSvg(node, await exportOptions())
        await downloadDataURL(dataUrl, `${baseName}.svg`)
    })

    const copyImage = () => run('copy', async (node) => {
        // Safari needs the ClipboardItem created right away, holding a promise
        const png = exportOptions().then(options => toBlob(node, options)).then((blob) => {
            if (!blob) throw new Error('the browser returned an empty image')
            return blob
        })
        await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })])
        toast.success('Image copied to the clipboard')
    })

    const { payload } = usePipeline()
    const loadFromPipeline = (text) => {
        setCode(text)
        const best = detectFormats(text)[0]
        const guess = SOURCE_LANGUAGE[payload?.source] ?? (best?.confidence >= 0.8 ? DETECTED_LANGUAGE[best.id] : null)
        if (guess) setLanguage(guess)
    }

    const wide = size === 'lg'

    const settings = (
        <div className="card" style={{ gridArea: 'settings', display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', minWidth: 0 }}>
            <Field label="Language">
                <select value={language} onChange={e => setLanguage(e.target.value)}>
                    {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
            </Field>
            <Field label="Syntax theme">
                <select value={themeName} onChange={e => setThemeName(e.target.value)}>
                    {Object.keys(THEMES).map(name => <option key={name} value={name}>{name}</option>)}
                </select>
            </Field>
            <div>
                <span className="field-label">Window</span>
                <SegmentedControl ariaLabel="Window style" value={windowStyle} onChange={setWindowStyle} options={WINDOW_STYLES} size="sm" block />
            </div>
            {windowStyle !== 'none' && (
                <Field label="Window title">
                    <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="snippet.js" style={{ padding: '0.55rem 0.75rem', fontSize: '0.9rem' }} />
                </Field>
            )}
            <div>
                <span className="field-label">Background</span>
                <div role="group" aria-label="Background" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {BACKGROUNDS.map(bg => {
                        const active = background === bg.value
                        return (
                            <button
                                key={bg.name}
                                type="button"
                                aria-pressed={active}
                                aria-label={bg.name}
                                title={bg.name}
                                onClick={() => setBackground(bg.value)}
                                className={bg.value === 'transparent' ? 'checkerboard' : undefined}
                                style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: '50%',
                                    background: bg.value === 'transparent' ? undefined : bg.value,
                                    border: '1px solid var(--border-strong)',
                                    outline: active ? '2px solid var(--primary)' : 'none',
                                    outlineOffset: 2,
                                }}
                            />
                        )
                    })}
                </div>
                <ColorField
                    label="Custom colour"
                    value={customColor}
                    onChange={(c) => {
                        setCustomColor(c)
                        setBackground(c)
                    }}
                    style={{ marginTop: 'var(--space-sm)' }}
                    inputStyle={{ fontSize: '0.85rem' }}
                />
            </div>
            <SliderField label="Padding" value={padding} onChange={setPadding} min={0} max={128} step={8} unit="px" />
            <SliderField label="Font size" value={fontSize} onChange={setFontSize} min={10} max={24} unit="px" />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', alignSelf: 'flex-start', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={lineNumbers} onChange={e => setLineNumbers(e.target.checked)} />
                Line numbers
            </label>
        </div>
    )

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div
                style={{
                    display: 'grid',
                    gap: 'var(--space-lg)',
                    alignItems: 'start',
                    gridTemplateColumns: wide ? 'minmax(240px, 300px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
                    gridTemplateRows: wide ? 'auto 1fr' : undefined,
                    gridTemplateAreas: wide ? '"settings code" "settings preview"' : '"code" "preview" "settings"',
                }}
            >
                {settings}

                <div className="card card-compact" style={{ gridArea: 'code', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                        <label className="field-label" htmlFor={codeId} style={{ marginBottom: 0 }}>Code</label>
                        <PipelineRead onRead={loadFromPipeline} />
                    </div>
                    <textarea
                        id={codeId}
                        value={code}
                        onChange={e => setCode(e.target.value)}
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        wrap="off"
                        placeholder="Paste or type code…"
                        style={{ minHeight: 160 }}
                    />
                </div>

                <div className="card card-compact" style={{ gridArea: 'preview', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <h2 className="section-title" style={{ marginRight: 'auto' }}>Preview</h2>
                        <SegmentedControl ariaLabel="Export scale" value={scale} onChange={setScale} options={SCALES} size="sm" />
                        <button type="button" className="btn btn-primary btn-sm" onClick={exportPng} disabled={!!busy} aria-label="Download PNG" title="Download PNG">
                            {busy === 'png' ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />} PNG
                        </button>
                        {canCopyImages() && (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={copyImage} disabled={!!busy}>
                                {busy === 'copy' ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <ClipboardCopy size={14} aria-hidden="true" />} Copy image
                            </button>
                        )}
                        <button type="button" className="btn btn-secondary btn-sm" onClick={exportSvg} disabled={!!busy} aria-label="Download SVG" title="Download SVG (the code is embedded as HTML; opens in browsers)">
                            {busy === 'svg' ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <FileCode2 size={14} aria-hidden="true" />} SVG
                        </button>
                    </div>

                    {/* The checkerboard shows through a transparent background. The scaling
                        wrapper sits outside the exported node, so exports stay full size. */}
                    <div
                        ref={frameRef}
                        className={background === 'transparent' ? 'checkerboard' : undefined}
                        style={{ overflow: 'hidden', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', background: background === 'transparent' ? undefined : 'var(--stage)' }}
                    >
                        <div style={{ width: fit < 1 ? dims.width * fit : 'max-content', height: fit < 1 ? dims.height * fit : 'auto', margin: '0 auto' }}>
                            <div style={{ width: 'max-content', transform: fit < 1 ? `scale(${fit})` : undefined, transformOrigin: '0 0' }}>
                                <div ref={exportRef} style={{ width: 'max-content', padding, background }}>
                                    <div
                                        style={{
                                            minWidth: 320,
                                            background: windowBg,
                                            borderRadius: 10,
                                            overflow: 'hidden',
                                            boxShadow: padding > 0 ? '0 20px 60px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(0, 0, 0, 0.08)' : 'none',
                                        }}
                                    >
                                        {windowStyle !== 'none' && (
                                            <div
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: '1fr auto 1fr',
                                                    alignItems: 'center',
                                                    gap: 12,
                                                    padding: '12px 16px',
                                                    fontFamily: SANS,
                                                    fontSize: 13,
                                                    lineHeight: '16px',
                                                    color: ink,
                                                }}
                                            >
                                                {windowStyle === 'mac' ? <WindowControls style="mac" ink={ink} /> : <span />}
                                                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>{title}</span>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    {windowStyle === 'windows' && <WindowControls style="windows" ink={ink} />}
                                                </div>
                                            </div>
                                        )}
                                        <SyntaxHighlighter
                                            language={language}
                                            style={theme}
                                            showLineNumbers={lineNumbers}
                                            lineNumberStyle={{ minWidth: '2.25em', paddingRight: '1em', opacity: 0.5 }}
                                            customStyle={{
                                                margin: 0,
                                                padding: windowStyle === 'none' ? '20px 24px' : '4px 24px 22px',
                                                background: 'transparent',
                                                border: 'none',
                                                borderRadius: 0,
                                                overflow: 'visible',
                                                fontSize,
                                                lineHeight: 1.6,
                                                fontFamily: MONO,
                                            }}
                                            codeTagProps={{
                                                style: { ...codeTagStyle, background: 'transparent', fontFamily: MONO, fontSize: 'inherit', lineHeight: 'inherit' },
                                            }}
                                        >
                                            {code || ' '}
                                        </SyntaxHighlighter>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    {fit < 1 && (
                        <div className="field-hint" style={{ margin: 0, textAlign: 'center' }}>
                            Preview shown at {Math.round(fit * 100)}% to fit; exports are full size ({dims.width * scale} × {dims.height * scale} px at {scale}×).
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
