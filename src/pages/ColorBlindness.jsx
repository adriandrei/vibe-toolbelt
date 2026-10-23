import { useId, useRef, useState } from 'react'
import { Eye, ImagePlus, Sparkles, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { useObjectURL } from '../hooks/useObjectURL'
import { usePane } from '../contexts/pane'

// Simulation matrices, applied to linear RGB.
// Dichromacy and anomalous trichromacy: Machado, Oliveira & Fernandes (2009),
// "A Physiologically-based Model for Simulation of Color Vision Deficiency";
// severity 1.0 for the -opias and 0.6 for the -omalies.
// Achromatopsia: Rec. 709 relative luminance.
const MODES = [
    { id: 'normal', name: 'Normal vision', note: 'No simulation', matrix: null },
    {
        id: 'protanopia', name: 'Protanopia', note: 'No red cones · about 1% of men',
        matrix: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
    },
    {
        id: 'deuteranopia', name: 'Deuteranopia', note: 'No green cones · about 1% of men',
        matrix: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
    },
    {
        id: 'tritanopia', name: 'Tritanopia', note: 'No blue cones · very rare',
        matrix: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
    },
    {
        id: 'protanomaly', name: 'Protanomaly', note: 'Weak red cones · about 1% of men',
        matrix: [0.38545, 0.769005, -0.154455, 0.100526, 0.829802, 0.069673, -0.007442, -0.02219, 1.029632],
    },
    {
        id: 'deuteranomaly', name: 'Deuteranomaly', note: 'Weak green cones · about 5% of men (most common)',
        matrix: [0.547494, 0.607765, -0.155259, 0.181692, 0.781742, 0.036566, -0.01041, 0.027275, 0.983136],
    },
    {
        id: 'tritanomaly', name: 'Tritanomaly', note: 'Weak blue cones · rare',
        matrix: [1.104996, -0.046633, -0.058363, -0.032137, 0.971635, 0.060503, 0.001336, 0.317922, 0.680742],
    },
    {
        id: 'achromatopsia', name: 'Achromatopsia', note: 'No colour vision · very rare',
        matrix: [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722],
    },
]
const SIMULATIONS = MODES.filter(m => m.matrix)

// 3×3 RGB matrix -> feColorMatrix 4×5 values (alpha unchanged)
const toFeValues = (m) => [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(' ')

const VIEWS = [
    { value: 'compare', label: 'Compare' },
    { value: 'side', label: 'Side by side' },
    { value: 'all', label: 'All types' },
]

// Built-in test image: colour pairs that are commonly confused
const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420">
<rect width="720" height="420" fill="#ffffff"/>
<g font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700" text-anchor="middle">
<circle cx="110" cy="120" r="80" fill="#e53935"/><text x="110" y="240" fill="#333">Red</text>
<circle cx="290" cy="120" r="80" fill="#43a047"/><text x="290" y="240" fill="#333">Green</text>
<circle cx="470" cy="120" r="80" fill="#fb8c00"/><text x="470" y="240" fill="#333">Orange</text>
<circle cx="630" cy="120" r="70" fill="#8d6e63"/><text x="630" y="240" fill="#333">Brown</text>
<rect x="30" y="280" width="150" height="100" rx="12" fill="#1e88e5"/><text x="105" y="337" fill="#fff">Blue</text>
<rect x="200" y="280" width="150" height="100" rx="12" fill="#8e24aa"/><text x="275" y="337" fill="#fff">Purple</text>
<rect x="370" y="280" width="150" height="100" rx="12" fill="#f06292"/><text x="445" y="337" fill="#fff">Pink</text>
<rect x="540" y="280" width="150" height="100" rx="12" fill="#9e9e9e"/><text x="615" y="337" fill="#fff">Grey</text>
</g>
</svg>`

function Figure({ src, filter, caption, onError }) {
    return (
        <figure style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', minWidth: 0 }}>
            <div className="checkerboard" style={{ borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                <img src={src} alt={caption} onError={onError} style={{ display: 'block', maxWidth: '100%', maxHeight: '60vh', height: 'auto', filter }} />
            </div>
            <figcaption style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>{caption}</figcaption>
        </figure>
    )
}

export default function ColorBlindness() {
    const { size } = usePane()
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
    const [file, setFile] = useState(null)
    const [broken, setBroken] = useState(false)
    const [mode, setMode] = useState('deuteranomaly')
    const [view, setView] = useState('compare')
    const [split, setSplit] = useState(50)
    const url = useObjectURL(file)
    const compareRef = useRef(null)
    const dragging = useRef(false)

    const filterFor = (id) => (id === 'normal' ? 'none' : `url(#cvd-${uid}-${id})`)
    const current = MODES.find(m => m.id === mode)

    const load = (next) => {
        setFile(next)
        setBroken(false)
    }

    const loadSample = () => load(new File([SAMPLE_SVG], 'colour-sample.svg', { type: 'image/svg+xml' }))

    const splitFromPointer = (event) => {
        const rect = compareRef.current?.getBoundingClientRect()
        if (!rect || rect.width === 0) return
        setSplit(Math.round(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100))))
    }

    const onImageError = () => setBroken(true)

    return (
        <div className="page page-wide">
            <ToolHeader />

            {!file ? (
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <FileDropZone
                        accept="image/*"
                        allowPaste
                        maxSizeMB={100}
                        onFiles={([f]) => load(f)}
                        icon={ImagePlus}
                        label="Drop an image, paste a screenshot or click to browse"
                        hint="PNG, JPEG, WebP, GIF, SVG… The image never leaves your device."
                    />
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={loadSample}>
                            <Sparkles size={14} aria-hidden="true" /> Try a sample image
                        </button>
                    </div>
                </div>
            ) : (
                <div className="card card-compact" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <Eye size={18} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 120px' }} title={file.name}>
                        {file.name}
                    </span>
                    <SegmentedControl ariaLabel="View" size="sm" value={view} onChange={setView} options={VIEWS} />
                    <FileDropZone accept="image/*" allowPaste compact maxSizeMB={100} onFiles={([f]) => load(f)} ariaLabel="Replace image" style={{ padding: '0.35rem 0.75rem', borderWidth: 1 }}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Replace…</span>
                    </FileDropZone>
                    <button type="button" className="icon-btn" onClick={() => load(null)} aria-label="Remove image" title="Remove image">
                        <X size={16} aria-hidden="true" />
                    </button>
                </div>
            )}

            <div
                style={{
                    display: 'grid',
                    gap: 'var(--space-lg)',
                    gridTemplateColumns: size === 'lg' && view !== 'all' ? 'minmax(220px, 280px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
                    alignItems: 'start',
                }}
            >
                {/* Mode list: a column beside the image on wide panes, below it on narrow ones */}
                {view !== 'all' || !file ? (
                    <div
                        role="group"
                        aria-label="Vision type"
                        className={size === 'lg' ? undefined : 'auto-grid'}
                        style={size === 'lg' ? { display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' } : { '--auto-grid-min': '150px', gap: 'var(--space-xs)', order: file ? 1 : 0 }}
                    >
                        {MODES.map(m => {
                            const active = m.id === mode
                            return (
                                <button
                                    key={m.id}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setMode(m.id)}
                                    style={{
                                        textAlign: 'left',
                                        padding: '0.55rem 0.8rem',
                                        borderRadius: 'var(--radius-md)',
                                        border: `1px solid ${active ? 'var(--primary-border)' : 'var(--border)'}`,
                                        background: active ? 'var(--primary-glow)' : 'var(--bg-subtle)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 2,
                                    }}
                                >
                                    <span style={{ fontWeight: 600, fontSize: '0.9rem', color: active ? 'var(--primary-text)' : 'var(--text-main)' }}>{m.name}</span>
                                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{m.note}</span>
                                </button>
                            )
                        })}
                    </div>
                ) : null}

                <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    {broken && (
                        <StatusBanner tone="danger" title="This image can’t be displayed">
                            The browser couldn’t decode {file?.name}. Formats such as HEIC or TIFF aren’t supported by most browsers; convert it to PNG or JPEG first.
                        </StatusBanner>
                    )}

                    {url && !broken && view === 'compare' && (
                        <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            <div className="checkerboard" style={{ borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
                                <div
                                    ref={compareRef}
                                    style={{ position: 'relative', maxWidth: '100%', cursor: 'ew-resize', touchAction: 'pan-y', userSelect: 'none' }}
                                    onPointerDown={(e) => {
                                        dragging.current = true
                                        e.currentTarget.setPointerCapture(e.pointerId)
                                        splitFromPointer(e)
                                    }}
                                    onPointerMove={(e) => { if (dragging.current) splitFromPointer(e) }}
                                    onPointerUp={() => { dragging.current = false }}
                                    onPointerCancel={() => { dragging.current = false }}
                                >
                                    <img
                                        src={url}
                                        alt={`${file.name} as seen with ${current.name.toLowerCase()}`}
                                        onError={onImageError}
                                        draggable={false}
                                        style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', height: 'auto', filter: filterFor(mode) }}
                                    />
                                    <img
                                        src={url}
                                        alt=""
                                        aria-hidden="true"
                                        draggable={false}
                                        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', clipPath: `inset(0 ${100 - split}% 0 0)` }}
                                    />
                                    <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `${split}%`, width: 2, marginLeft: -1, background: 'var(--primary)', boxShadow: '0 0 0 1px var(--bg-elevated)' }} />
                                    <span className="badge" style={{ position: 'absolute', top: 8, left: 8, background: 'var(--bg-elevated)' }}>Original</span>
                                    <span className="badge badge-primary" style={{ position: 'absolute', top: 8, right: 8, background: 'var(--bg-elevated)' }}>{current.name}</span>
                                </div>
                            </div>
                            <input
                                type="range"
                                min={0}
                                max={100}
                                value={split}
                                onChange={(e) => setSplit(Number(e.target.value))}
                                aria-label="Divider position"
                                aria-valuetext={`${split}% original, ${100 - split}% ${current.name}`}
                            />
                            <div className="field-hint" style={{ margin: 0, textAlign: 'center' }}>Drag across the image or use the slider: original on the left, simulation on the right.</div>
                        </div>
                    )}

                    {url && !broken && view === 'side' && (
                        <div className="card card-compact auto-grid" style={{ '--auto-grid-min': '240px' }}>
                            <Figure src={url} filter="none" caption="Original" onError={onImageError} />
                            <Figure src={url} filter={filterFor(mode)} caption={current.name} onError={onImageError} />
                        </div>
                    )}

                    {url && !broken && view === 'all' && (
                        <div className="card card-compact auto-grid" style={{ '--auto-grid-min': '220px' }}>
                            {MODES.map(m => <Figure key={m.id} src={url} filter={filterFor(m.id)} caption={m.name} onError={onImageError} />)}
                        </div>
                    )}

                    {!file && (
                        <div className="card" style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            <strong style={{ color: 'var(--text-main)' }}>{current.name}</strong> · {current.note}
                            <p style={{ marginTop: 'var(--space-sm)' }}>
                                Load an image to compare it with how it looks to people with this colour vision deficiency. The simulation uses the
                                Machado (2009) model in linear RGB; the “weak” types are shown at 60% severity.
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Filter definitions: a 0×0 SVG that stays rendered (display:none would make
                Firefox ignore the filters and Chromium apply them in sRGB) */}
            <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
                <defs>
                    {SIMULATIONS.map(m => (
                        <filter key={m.id} id={`cvd-${uid}-${m.id}`} colorInterpolationFilters="linearRGB">
                            <feColorMatrix type="matrix" values={toFeValues(m.matrix)} />
                        </filter>
                    ))}
                </defs>
            </svg>
        </div>
    )
}
