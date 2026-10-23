import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Layers, Loader2, Package, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import SegmentedControl from '../components/ui/SegmentedControl'
import SliderField from '../components/ui/SliderField'
import ColorField from '../components/ui/ColorField'
import Field from '../components/ui/Field'
import CodeBlock from '../components/ui/CodeBlock'
import StatusBanner from '../components/ui/StatusBanner'
import { useToast } from '../components/ToastProvider'
import { usePane } from '../contexts/pane'
import { useObjectURL } from '../hooks/useObjectURL'
import { downloadBlob, formatBytes } from '../utils/download'
import { createIco, encodeCanvas, isSvgFile, loadImage, releaseCanvas, renderIcon } from '../utils/image'

const ACCEPT = 'image/*,.svg,.heic,.heif,.avif,.ico'

// background: 'icon' follows the "transparent background" setting,
// 'solid' always fills (iOS shows black behind transparent icons; maskable
// icons must cover the whole square).
const ICONS = [
    { file: 'favicon-16x16.png', size: 16, label: 'Browser tab', background: 'icon' },
    { file: 'favicon-32x32.png', size: 32, label: 'Browser tab (high DPI)', background: 'icon' },
    { file: 'apple-touch-icon.png', size: 180, label: 'iPhone / iPad home screen', background: 'solid' },
    { file: 'android-chrome-192x192.png', size: 192, label: 'Android / installed app', background: 'icon' },
    { file: 'android-chrome-512x512.png', size: 512, label: 'App splash screen', background: 'icon' },
    { file: 'maskable-icon-512x512.png', size: 512, label: 'Maskable (Android adaptive)', background: 'solid', maskable: true },
]
const ICO_SIZES = [16, 32, 48]
const MASKABLE_PADDING = 0.2 // keeps content inside Android's circular safe zone

async function renderIcons(file, { fit, padding, transparent, background }) {
    const loaded = await loadImage(file)
    try {
        const icons = []
        for (const spec of ICONS) {
            const solid = spec.background === 'solid' || !transparent
            const canvas = renderIcon(loaded, spec.size, {
                fit,
                padding: spec.maskable ? Math.max(padding, MASKABLE_PADDING) : padding,
                background: solid ? background : null,
            })
            try {
                icons.push({ ...spec, blob: await encodeCanvas(canvas, { type: 'image/png' }) })
            } finally {
                releaseCanvas(canvas)
            }
        }
        const ico = await createIco(loaded, ICO_SIZES, { fit, padding, background: transparent ? null : background })
        return { icons, ico, source: { width: loaded.width, height: loaded.height } }
    } finally {
        loaded.close()
    }
}

function IconTile({ icon }) {
    const url = useObjectURL(icon.blob)
    // Tiny icons are shown at 2× so their pixels can be judged; larger ones are capped at 96 px
    const zoomed = icon.size <= 32
    const display = zoomed ? icon.size * 2 : Math.min(icon.size, 96)
    return (
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <div className="checkerboard" style={{ width: 112, height: 112, borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--border)' }}>
                {url && (
                    <img
                        src={url}
                        alt={`${icon.size}×${icon.size} ${icon.label} icon`}
                        width={display}
                        height={display}
                        style={{ borderRadius: icon.maskable ? '50%' : 0, imageRendering: icon.size <= 32 ? 'pixelated' : 'auto' }}
                    />
                )}
            </div>
            <figcaption style={{ textAlign: 'center', fontSize: '0.75rem', lineHeight: 1.35, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                <div style={{ color: 'var(--text-main)', fontWeight: 600 }}>{icon.size}×{icon.size}{zoomed && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> (2× zoom)</span>}</div>
                <div>{icon.label}</div>
                <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{icon.file}</div>
            </figcaption>
        </figure>
    )
}

function TabPreview({ icon, name }) {
    const url = useObjectURL(icon?.blob ?? null)
    return (
        <div aria-label="Browser tab preview" role="img" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%', padding: '8px 14px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderBottom: 'none', borderRadius: '10px 10px 0 0', boxShadow: 'var(--shadow-sm)' }}>
            {url && <img src={url} alt="" width={16} height={16} />}
            <span style={{ fontSize: '0.85rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name || 'Untitled'}</span>
            <X size={12} aria-hidden="true" style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        </div>
    )
}

export default function FaviconGenerator() {
    const toast = useToast()
    const { size: paneSize } = usePane()
    const [file, setFile] = useState(null)
    const [source, setSource] = useState(null) // { width, height } once decoded
    const [loadState, setLoadState] = useState({ status: 'idle' })
    const [fit, setFit] = useState('contain')
    const [padding, setPadding] = useState(0)
    const [transparent, setTransparent] = useState(true)
    const [background, setBackground] = useState('#ffffff')
    const [appName, setAppName] = useState('My App')
    const [shortName, setShortName] = useState('App')
    const [themeColor, setThemeColor] = useState('#ffffff')
    const [manifestBackground, setManifestBackground] = useState('#ffffff')
    const [result, setResult] = useState(null) // { key, icons, ico } or { key, error }
    const [zipping, setZipping] = useState(false)
    const requestRef = useRef(0)
    const previewUrl = useObjectURL(file)

    const handleFile = async (next) => {
        const id = ++requestRef.current
        setFile(next)
        setSource(null)
        setResult(null)
        setLoadState({ status: 'loading' })
        let loaded = null
        try {
            loaded = await loadImage(next)
            if (id !== requestRef.current) return
            setSource({ width: loaded.width, height: loaded.height, svg: isSvgFile(next) })
            setLoadState({ status: 'ready' })
        } catch (err) {
            if (id !== requestRef.current) return
            setLoadState({ status: 'error', message: err?.message || 'This image couldn’t be read.' })
        } finally {
            loaded?.close()
        }
    }

    const clear = () => {
        requestRef.current++
        setFile(null)
        setSource(null)
        setResult(null)
        setLoadState({ status: 'idle' })
    }

    const options = useMemo(() => ({ fit, padding: padding / 100, transparent, background }), [fit, padding, transparent, background])
    const iconKey = JSON.stringify(options)

    // Re-render the icons whenever the image or the icon options change
    useEffect(() => {
        if (!file || loadState.status !== 'ready') return undefined
        let cancelled = false
        const timer = setTimeout(async () => {
            try {
                const out = await renderIcons(file, options)
                if (!cancelled) setResult({ key: iconKey, file, ...out })
            } catch (err) {
                if (!cancelled) setResult({ key: iconKey, file, error: err?.message || 'The icons couldn’t be generated.' })
            }
        }, 120)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [file, loadState.status, options, iconKey])

    const current = result && result.key === iconKey && result.file === file ? result : null
    const generating = loadState.status === 'ready' && !current
    // While new icons render, keep showing the previous ones (dimmed) instead of flashing
    const shown = current ?? (result && result.file === file ? result : null)
    const nonSquare = source && source.width !== source.height

    const manifest = useMemo(() => JSON.stringify({
        name: appName.trim() || 'My App',
        short_name: shortName.trim() || appName.trim() || 'App',
        icons: [
            { src: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        theme_color: themeColor,
        background_color: manifestBackground,
        display: 'standalone',
        start_url: '/',
    }, null, 2), [appName, shortName, themeColor, manifestBackground])

    const htmlTags = [
        `<link rel="icon" href="/favicon.ico" sizes="48x48">`,
        source?.svg ? `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` : null,
        `<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">`,
        `<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">`,
        `<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`,
        `<link rel="manifest" href="/site.webmanifest">`,
        `<meta name="theme-color" content="${themeColor}">`,
    ].filter(Boolean).join('\n')

    const downloadZip = async () => {
        if (!current?.icons || zipping) return
        setZipping(true)
        try {
            const { default: JSZip } = await import('jszip')
            const zip = new JSZip()
            zip.file('favicon.ico', current.ico)
            for (const icon of current.icons) zip.file(icon.file, icon.blob)
            if (source?.svg) zip.file('favicon.svg', file)
            zip.file('site.webmanifest', manifest)
            zip.file('tags.html', `${htmlTags}\n`)
            downloadBlob(await zip.generateAsync({ type: 'blob' }), 'favicons.zip')
        } catch (err) {
            toast.error(`Couldn’t create the ZIP: ${err?.message || 'unknown error'}`)
        } finally {
            setZipping(false)
        }
    }

    const twoColumns = paneSize !== 'sm'

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" aria-label="Source image" style={{ display: 'grid', gridTemplateColumns: twoColumns ? 'minmax(0, 1fr) minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    {!file ? (
                        <FileDropZone
                            accept={ACCEPT}
                            onFiles={([f]) => handleFile(f)}
                            allowPaste
                            icon={Layers}
                            label="Drop your logo here or click to browse"
                            hint="A square PNG or SVG of at least 512×512 works best."
                            style={{ minHeight: 260 }}
                        />
                    ) : (
                        <>
                            <div className="checkerboard" style={{ position: 'relative', height: 260, borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                {loadState.status === 'loading' && <Loader2 size={24} className="spin" aria-label="Loading image" style={{ color: 'var(--text-muted)' }} />}
                                {loadState.status === 'ready' && previewUrl && (
                                    <img src={previewUrl} alt={`Source image ${file.name}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                )}
                                <button type="button" className="icon-btn" onClick={clear} aria-label="Remove image" title="Remove image" style={{ position: 'absolute', top: 8, right: 8, background: 'var(--bg-elevated)', boxShadow: 'var(--shadow-sm)' }}>
                                    <X size={16} aria-hidden="true" />
                                </button>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                                <strong style={{ color: 'var(--text-main)' }}>{file.name}</strong> · {formatBytes(file.size)}
                                {source && ` · ${source.width}×${source.height}${source.svg ? ' (SVG)' : ''}`}
                            </div>
                            {loadState.status === 'error' && (
                                <StatusBanner tone="danger" title="Can’t use this image">{loadState.message}</StatusBanner>
                            )}
                            {source && Math.max(source.width, source.height) < 512 && !source.svg && (
                                <StatusBanner tone="warning" title="Small source image">
                                    It’s {Math.max(source.width, source.height)} px on the long side, so the 512 px icons will be upscaled and look soft.
                                </StatusBanner>
                            )}
                            <FileDropZone accept={ACCEPT} onFiles={([f]) => handleFile(f)} compact label="Use a different image" hint={paneSize === 'sm' ? undefined : 'or drop it here'} allowPaste />
                        </>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <div>
                        <span className="field-label">{nonSquare ? 'Your image isn’t square' : 'Fit'}</span>
                        <SegmentedControl
                            ariaLabel="How to make the image square"
                            value={fit}
                            onChange={setFit}
                            options={[{ value: 'contain', label: 'Fit (pad)' }, { value: 'cover', label: 'Fill (crop)' }]}
                        />
                        <p className="field-hint">{fit === 'contain' ? 'The whole image is kept and centred; the rest is padding.' : 'The image fills the square; the edges are cropped.'}</p>
                    </div>
                    <SliderField label="Padding" value={padding} onChange={setPadding} min={0} max={25} unit="%" hint="Space around the artwork. Maskable icons always get at least 20%." />
                    <div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
                            Transparent background
                        </label>
                        <p className="field-hint">The Apple touch and maskable icons are always filled, because iOS and Android show transparency as black or white.</p>
                    </div>
                    <ColorField label="Icon background" value={background} onChange={setBackground} />
                </div>
            </section>

            <section className="card" aria-label="Web app manifest" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <h2 className="section-title">Web app manifest</h2>
                <div className="auto-grid" style={{ '--auto-grid-min': '200px' }}>
                    <Field label="App name">
                        <input type="text" value={appName} onChange={(e) => setAppName(e.target.value)} maxLength={80} style={{ padding: '0.6rem 0.75rem' }} />
                    </Field>
                    <Field label="Short name" hint="Shown under the home-screen icon (≤ 12 characters).">
                        <input type="text" value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={30} style={{ padding: '0.6rem 0.75rem' }} />
                    </Field>
                    <ColorField label="Theme colour" value={themeColor} onChange={setThemeColor} hint="Browser toolbar colour on mobile." />
                    <ColorField label="Splash background" value={manifestBackground} onChange={setManifestBackground} hint="Shown while the installed app starts." />
                </div>
            </section>

            {loadState.status === 'ready' && (
                <section className="card" aria-label="Generated icons" aria-busy={generating} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                        <h2 className="section-title"><Package size={18} aria-hidden="true" /> Your favicon package</h2>
                        <button type="button" className="btn btn-primary" onClick={downloadZip} disabled={!current?.icons || zipping}>
                            {zipping || generating ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                            {generating ? 'Generating…' : 'Download ZIP'}
                        </button>
                    </div>
                    {current?.error && <StatusBanner tone="danger" title="Couldn’t generate the icons">{current.error}</StatusBanner>}
                    {shown?.icons && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', opacity: generating ? 0.5 : 1, transition: 'opacity 0.15s ease' }}>
                            <TabPreview icon={shown.icons[0]} name={appName} />
                            <div className="auto-grid" style={{ '--auto-grid-min': '120px', justifyItems: 'center' }}>
                                {shown.icons.map(icon => <IconTile key={icon.file} icon={icon} />)}
                            </div>
                            <p className="field-hint" style={{ marginTop: 0 }}>
                                Also included: <span className="mono">favicon.ico</span> (16, 32 and 48 px, {formatBytes(shown.ico.size)}){source?.svg && <>, <span className="mono">favicon.svg</span></>}, <span className="mono">site.webmanifest</span> and <span className="mono">tags.html</span>.
                            </p>
                        </div>
                    )}
                    <CodeBlock code={htmlTags} language="html" title="Add to your <head>" copyLabel="Copy tags" />
                    <CodeBlock code={manifest} language="json" title="site.webmanifest" copyLabel="Copy manifest" />
                </section>
            )}
        </div>
    )
}
