import { useId, useRef, useState } from 'react'
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react'
import { ClipboardCopy, Download, FileCode2, QrCode as QrIcon } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SliderField from '../components/ui/SliderField'
import ColorField from '../components/ui/ColorField'
import Field from '../components/ui/Field'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { PipelineRead } from '../components/PipelineFeature'
import { useToast } from '../components/ToastProvider'
import { contrastRatio, luminance, parseColor } from '../utils/color'
import { downloadBlob, downloadText } from '../utils/download'

const LEVELS = [
    { value: 'L', label: 'Low (7%)', name: 'Low' },
    { value: 'M', label: 'Medium (15%)', name: 'Medium' },
    { value: 'Q', label: 'Quartile (25%)', name: 'Quartile' },
    { value: 'H', label: 'High (30%)', name: 'High' },
]

// ---------------------------------------------------------------------------
// Capacity check. qrcode.react throws "Data too long" while rendering when
// the text doesn't fit, so this mirrors its encoder (qrcodegen): one segment
// in numeric, alphanumeric or byte (UTF-8) mode, measured against version 40,
// the largest QR code.
const DATA_CODEWORDS_V40 = { L: 2956, M: 2334, Q: 1666, H: 1276 }
const NUMERIC = /^[0-9]*$/
const ALPHANUMERIC = /^[A-Z0-9 $%*+./:-]*$/

const MODES = {
    numeric: { unit: 'digits', bits: (n) => 4 + 14 + Math.floor(n / 3) * 10 + [0, 4, 7][n % 3] },
    alphanumeric: { unit: 'characters', bits: (n) => 4 + 13 + Math.floor(n / 2) * 11 + (n % 2) * 6 },
    byte: { unit: 'bytes', bits: (n) => 4 + 16 + n * 8 },
}

function isWellFormed(text) {
    try {
        encodeURI(text) // what the encoder does; throws on lone surrogates
        return true
    } catch {
        return false
    }
}

function maxCount(mode, capacityBits) {
    let lo = 0
    let hi = capacityBits
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2)
        if (MODES[mode].bits(mid) <= capacityBits) lo = mid
        else hi = mid - 1
    }
    return lo
}

function checkCapacity(text, level) {
    if (!text) return { ok: false, empty: true }
    if (!isWellFormed(text)) return { ok: false, error: 'The text contains an invalid character (an unpaired surrogate), so it can’t be encoded.' }
    const mode = NUMERIC.test(text) ? 'numeric' : ALPHANUMERIC.test(text) ? 'alphanumeric' : 'byte'
    const count = mode === 'byte' ? new TextEncoder().encode(text).length : text.length
    const capacityBits = DATA_CODEWORDS_V40[level] * 8
    const usedBits = MODES[mode].bits(count)
    const max = maxCount(mode, capacityBits)
    return { ok: usedBits <= capacityBits, mode, unit: MODES[mode].unit, count, max, usage: usedBits / capacityBits }
}

const canCopyImages = () => typeof window !== 'undefined' && window.isSecureContext && typeof window.ClipboardItem === 'function' && !!navigator.clipboard?.write

export default function QrCode() {
    const toast = useToast()
    const textId = useId()
    const [text, setText] = useState('https://example.com')
    const [size, setSize] = useState(256)
    const [fgColor, setFgColor] = useState('#000000')
    const [bgColor, setBgColor] = useState('#ffffff')
    const [level, setLevel] = useState('M')
    const [quietZone, setQuietZone] = useState(true)
    const [busy, setBusy] = useState(false)

    const canvasRef = useRef(null)
    const svgRef = useRef(null)

    const capacity = checkCapacity(text, level)
    const ready = capacity.ok
    const levelName = LEVELS.find(l => l.value === level)?.name

    const fg = parseColor(fgColor)
    const bg = parseColor(bgColor)
    const contrast = fg && bg ? contrastRatio(fg, bg) : 21
    const inverted = fg && bg && luminance(fg) > luminance(bg)

    const qrProps = { value: text, size, level, fgColor, bgColor, marginSize: quietZone ? 4 : 0 }

    // Exact-size SVG of the current code
    const svgMarkup = () => {
        const svg = svgRef.current
        if (!svg) throw new Error('The QR code isn’t ready yet')
        const clone = svg.cloneNode(true)
        clone.setAttribute('width', String(size))
        clone.setAttribute('height', String(size))
        clone.removeAttribute('role')
        return new XMLSerializer().serializeToString(clone)
    }

    // PNG of exactly size × size pixels, rasterised from the SVG so module
    // edges stay crisp (the on-screen canvas is scaled by devicePixelRatio)
    const renderPng = async () => {
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        const url = URL.createObjectURL(new Blob([svgMarkup()], { type: 'image/svg+xml' }))
        try {
            const img = new Image()
            img.src = url
            await img.decode()
            ctx.imageSmoothingEnabled = false
            ctx.drawImage(img, 0, 0, size, size)
        } catch {
            // Fall back to resampling the preview canvas
            if (!canvasRef.current) throw new Error('The QR code isn’t ready yet')
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            ctx.drawImage(canvasRef.current, 0, 0, size, size)
        } finally {
            URL.revokeObjectURL(url)
        }
        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('The browser couldn’t create the PNG'))), 'image/png')
        })
    }

    const downloadPng = async () => {
        setBusy(true)
        try {
            downloadBlob(await renderPng(), 'qrcode.png')
        } catch (err) {
            toast.error(`PNG export failed: ${err.message}`)
        } finally {
            setBusy(false)
        }
    }

    const downloadSvg = () => {
        try {
            downloadText(svgMarkup(), 'qrcode.svg', 'image/svg+xml')
        } catch (err) {
            toast.error(`SVG export failed: ${err.message}`)
        }
    }

    const copyImage = async () => {
        try {
            // Safari needs the ClipboardItem to be created synchronously with a promise
            await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': renderPng() })])
            toast.success('QR code copied as an image')
        } catch (err) {
            toast.error(`Couldn’t copy the image: ${err.message || 'the browser blocked clipboard access'}`)
        }
    }

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane">
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                            <label className="field-label" htmlFor={textId} style={{ marginBottom: 0 }}>Content</label>
                            <PipelineRead onRead={setText} />
                        </div>
                        <textarea
                            id={textId}
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Type URL or text..."
                            aria-invalid={!ready && !capacity.empty}
                            aria-describedby={`${textId}-usage`}
                            className={!ready && !capacity.empty ? 'field-invalid' : undefined}
                            style={{ minHeight: 96, fontFamily: 'var(--font-family)' }}
                        />
                        <div id={`${textId}-usage`} className={!ready && !capacity.empty ? 'field-error' : 'field-hint'}>
                            {capacity.empty
                                ? 'Enter a link or any text.'
                                : capacity.error
                                    ? capacity.error
                                    : `${capacity.count.toLocaleString()} of ${capacity.max.toLocaleString()} ${capacity.unit} (${Math.min(999, Math.round(capacity.usage * 100))}% of the maximum at ${levelName} error correction)`}
                        </div>
                    </div>

                    <SliderField label="Size (px)" value={size} onChange={setSize} min={64} max={2048} unit="px" showInput hint="Exact width and height of the downloaded image." />

                    <Field label="Error correction" hint="Higher levels survive damage or a logo on top, but hold less data.">
                        <select value={level} onChange={(e) => setLevel(e.target.value)}>
                            {LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                        </select>
                    </Field>

                    <div className="auto-grid" style={{ '--auto-grid-min': '200px' }}>
                        <ColorField label="Foreground" value={fgColor} onChange={setFgColor} />
                        <ColorField label="Background" value={bgColor} onChange={setBgColor} />
                    </div>

                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', alignSelf: 'flex-start' }}>
                        <input type="checkbox" checked={quietZone} onChange={(e) => setQuietZone(e.target.checked)} />
                        Quiet zone (4-module margin)
                    </label>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        <div className="stage" style={{ minHeight: 300, padding: 'var(--space-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {ready ? (
                                <QRCodeCanvas
                                    ref={canvasRef}
                                    {...qrProps}
                                    aria-label={`QR code for: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`}
                                    style={{ width: '100%', maxWidth: size, height: 'auto', display: 'block', boxShadow: 'var(--shadow-md)' }}
                                />
                            ) : capacity.empty ? (
                                <EmptyState icon={QrIcon} title="Nothing to encode">Type a link or some text to generate a QR code.</EmptyState>
                            ) : (
                                <StatusBanner tone="danger" title={capacity.error ? 'Can’t encode this text' : 'Too long for a QR code'} style={{ maxWidth: 420 }}>
                                    {capacity.error || (
                                        <>
                                            This needs {capacity.count.toLocaleString()} {capacity.unit}, but a QR code with {levelName.toLowerCase()} error
                                            correction holds at most {capacity.max.toLocaleString()}.
                                            {level !== 'L' ? ' Shorten the text or choose a lower error correction level.' : ' Shorten the text.'}
                                        </>
                                    )}
                                </StatusBanner>
                            )}
                        </div>
                        {ready && (
                            // Source for the SVG download and the exact-size PNG
                            <div hidden>
                                <QRCodeSVG ref={svgRef} {...qrProps} />
                            </div>
                        )}

                        {ready && contrast < 3 && (
                            <StatusBanner tone="warning" title={`Low contrast (${contrast.toFixed(1)}:1)`}>
                                Many scanners can’t read codes with this little contrast. Use a dark foreground on a light background.
                            </StatusBanner>
                        )}
                        {ready && contrast >= 3 && inverted && (
                            <StatusBanner tone="warning" title="Inverted colours">
                                The foreground is lighter than the background. Some scanners only read dark codes on a light background.
                            </StatusBanner>
                        )}

                        <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-primary" onClick={downloadPng} disabled={!ready || busy} style={{ flex: '1 1 160px' }}>
                                <Download size={16} aria-hidden="true" /> Download PNG
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={downloadSvg} disabled={!ready} style={{ flex: '1 1 120px' }}>
                                <FileCode2 size={16} aria-hidden="true" /> Download SVG
                            </button>
                            {canCopyImages() && (
                                <button type="button" className="btn btn-secondary" onClick={copyImage} disabled={!ready} style={{ flex: '1 1 120px' }}>
                                    <ClipboardCopy size={16} aria-hidden="true" /> Copy image
                                </button>
                            )}
                        </div>
                        <div className="field-hint" style={{ margin: 0 }}>
                            {size} × {size} px PNG{quietZone ? ', including the quiet zone' : ', without a quiet zone (add a light margin around it when you place it)'}.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
