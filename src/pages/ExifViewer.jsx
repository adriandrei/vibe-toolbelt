import { useEffect, useId, useRef, useState } from 'react'
import { Aperture, Camera, CalendarClock, Fingerprint, ImageOff, Loader2, MapPin, Search, ShieldCheck, UserRound, Wrench } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import StatusBanner from '../components/ui/StatusBanner'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import { useToast } from '../components/ToastProvider'
import { usePipeline } from '../contexts/PipelineContext'
import { usePane } from '../contexts/pane'
import { useObjectURL } from '../hooks/useObjectURL'
import { downloadBlob, formatBytes } from '../utils/download'
import { sniffImageType, typeLabel } from '../utils/image'
import { createCleanCopy, formatDms, formatLatLon, pickTag, readImageMetadata } from '../utils/metadata'

const ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/tiff,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.avif,.tif,.tiff,.gif'

const HIGHLIGHTS = [
    { label: 'Camera', icon: Camera, get: (m) => [pickTag(m, 'Make'), pickTag(m, 'Model')].filter(Boolean).join(' ') },
    { label: 'Lens', icon: Aperture, get: (m) => pickTag(m, 'LensModel', 'Lens') },
    { label: 'Taken', icon: CalendarClock, get: (m) => pickTag(m, 'DateTimeOriginal', 'CreateDate', 'DateCreated', 'DateTime') },
    { label: 'Exposure', icon: Camera, get: (m) => pickTag(m, 'ExposureTime') },
    { label: 'Aperture', icon: Aperture, get: (m) => pickTag(m, 'FNumber') },
    { label: 'ISO', icon: Camera, get: (m) => pickTag(m, 'ISOSpeedRatings', 'PhotographicSensitivity') },
    { label: 'Focal length', icon: Aperture, get: (m) => pickTag(m, 'FocalLength') },
    { label: 'Flash', icon: Camera, get: (m) => pickTag(m, 'Flash') },
    { label: 'Software', icon: Wrench, get: (m) => pickTag(m, 'Software', 'CreatorTool') },
    { label: 'Owner / author', icon: UserRound, get: (m) => pickTag(m, 'CameraOwnerName', 'OwnerName', 'Artist', 'By-line', 'creator') },
    { label: 'Serial number', icon: Fingerprint, get: (m) => pickTag(m, 'BodySerialNumber', 'SerialNumber', 'CameraSerialNumber') },
]

// "BodySerialNumber" -> Body<wbr>Serial<wbr>Number, so narrow tables wrap
// tag names between words instead of mid-word
function breakable(key) {
    const parts = key.split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[/_-])/)
    return parts.flatMap((part, i) => (i ? [<wbr key={i} />, part] : [part]))
}

function metadataJson(meta) {
    return JSON.stringify(Object.fromEntries(meta.groups.map(g => [g.label, Object.fromEntries(g.rows.map(r => [r.key, r.value]))])), null, 2)
}

function GpsBanner({ gps }) {
    const { latitude: lat, longitude: lon } = gps
    const coords = formatLatLon(lat, lon)
    return (
        <StatusBanner tone="warning" icon={MapPin} title="This photo contains its GPS location">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                <div style={{ color: 'var(--text-main)' }}>
                    <span className="mono">{coords}</span>
                    <span style={{ color: 'var(--text-muted)' }}> · {formatDms(lat, 'lat')} {formatDms(lon, 'lon')}</span>
                </div>
                {(gps.altitude !== null || gps.timestamp) && (
                    <div>
                        {gps.altitude !== null && <>Altitude {Math.round(gps.altitude)} m</>}
                        {gps.altitude !== null && gps.timestamp && ' · '}
                        {gps.timestamp && <>GPS time {gps.timestamp}</>}
                    </div>
                )}
                {gps.refMissing && <div>The file has no N/S or E/W reference, so the hemisphere may be wrong.</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', alignItems: 'center' }}>
                    <CopyButton text={coords} label="Copy coordinates" variant="secondary" />
                    <a className="btn btn-sm btn-ghost" href={`https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`} target="_blank" rel="noopener noreferrer">OpenStreetMap ↗</a>
                    <a className="btn btn-sm btn-ghost" href={`https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`} target="_blank" rel="noopener noreferrer">Google Maps ↗</a>
                </div>
                <div style={{ fontSize: '0.8rem' }}>Map links open a third-party site and send it these coordinates.</div>
            </div>
        </StatusBanner>
    )
}

function TagTable({ meta, filter }) {
    const q = filter.trim().toLowerCase()
    const groups = meta.groups
        .map(g => ({ ...g, rows: q ? g.rows.filter(r => r.key.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)) : g.rows }))
        .filter(g => g.rows.length)
    if (!groups.length) return <p className="field-hint">No tags match “{filter}”.</p>
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
            {groups.map(group => (
                <div key={group.id}>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', tableLayout: 'fixed' }}>
                            <caption style={{ captionSide: 'top', textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: 'var(--text-main)', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
                                {group.label} <span className="badge" style={{ marginLeft: 4 }}>{group.rows.length}</span>
                            </caption>
                            <tbody>
                                {group.rows.map((row, i) => (
                                    <tr key={`${row.key}-${i}`} style={{ background: i % 2 ? 'var(--bg-subtle)' : 'transparent', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                                        <th scope="row" style={{ width: '40%', padding: '6px 10px', textAlign: 'left', fontWeight: 500, color: 'var(--text-muted)', verticalAlign: 'top', overflowWrap: 'break-word' }}>{breakable(row.key)}</th>
                                        <td style={{ padding: '6px 10px', color: 'var(--text-main)', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{row.value}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}
        </div>
    )
}

export default function ExifViewer() {
    const toast = useToast()
    const { size, kind } = usePane()
    const { takeMedia, hasMedia } = usePipeline()
    const filterId = useId()
    const [file, setFile] = useState(null)
    const [state, setState] = useState({ status: 'idle' })
    const [failedUrl, setFailedUrl] = useState(null)
    const [dims, setDims] = useState(null)
    const [detectedType, setDetectedType] = useState(null)
    const [cleaning, setCleaning] = useState(false)
    const [cleanResult, setCleanResult] = useState(null)
    const [filter, setFilter] = useState('')
    const requestRef = useRef(0)
    const previewUrl = useObjectURL(file)

    const handleFile = async (next) => {
        const id = ++requestRef.current
        setFile(next)
        setState({ status: 'loading' })
        setCleanResult(null)
        setDims(null)
        setDetectedType(null)
        setFilter('')
        try {
            const head = new Uint8Array(await next.slice(0, 4096).arrayBuffer())
            if (id === requestRef.current) setDetectedType(sniffImageType(head) || next.type || null)
            const meta = await readImageMetadata(next)
            if (id !== requestRef.current) return
            setState({ status: 'done', meta })
        } catch (err) {
            if (id !== requestRef.current) return
            setState({ status: 'error', message: err?.message || 'The metadata couldn’t be read.' })
        }
    }

    const handleFileRef = useRef(handleFile)
    useEffect(() => {
        handleFileRef.current = handleFile
    })

    // A photo handed over by the Privacy Scanner ("Remove metadata"), also
    // when this page is already open (the scanner may be in the pinned pane)
    useEffect(() => {
        if (kind !== 'main' || !hasMedia) return
        const media = takeMedia('/exif')
        if (media?.file) handleFileRef.current(media.file)
    }, [kind, hasMedia, takeMedia])

    const saveCleanCopy = async () => {
        if (!file || cleaning) return
        const id = requestRef.current
        setCleaning(true)
        try {
            const result = await createCleanCopy(file)
            downloadBlob(result.blob, result.name)
            if (id === requestRef.current) setCleanResult({ name: result.name, size: result.blob.size, lossless: result.lossless, note: result.note })
            toast.success(`Saved ${result.name}`)
        } catch (err) {
            if (id === requestRef.current) setCleanResult(null)
            toast.error(err?.message || 'Couldn’t create a clean copy.')
        } finally {
            setCleaning(false)
        }
    }

    const meta = state.status === 'done' ? state.meta : null
    const highlights = meta ? HIGHLIGHTS.map(h => ({ ...h, value: h.get(meta) })).filter(h => h.value) : []
    const previewFailed = failedUrl !== null && failedUrl === previewUrl

    return (
        <div className="page page-wide">
            <ToolHeader />

            {!file ? (
                <FileDropZone
                    accept={ACCEPT}
                    onFiles={([f]) => handleFile(f)}
                    allowPaste
                    icon={Aperture}
                    label="Drop a photo here, paste it, or click to browse"
                    hint="JPEG, PNG, WebP, HEIC, AVIF, TIFF or GIF. The file is read in your browser and never uploaded."
                    style={{ minHeight: 240 }}
                />
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: size === 'sm' ? 'minmax(0, 1fr)' : 'minmax(0, 2fr) minmax(0, 3fr)', gap: 'var(--space-lg)', alignItems: 'start' }}>
                    {/* Preview and actions */}
                    <section className="card" aria-label="Image" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        <div className="checkerboard" style={{ borderRadius: 'var(--radius-md)', minHeight: 180, maxHeight: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            {previewFailed ? (
                                <div className="stage" style={{ width: '100%', alignSelf: 'stretch', display: 'flex' }}>
                                    <EmptyState icon={ImageOff} title="No preview" style={{ color: 'var(--on-stage)', flex: 1 }}>
                                        This browser can’t display {typeLabel(detectedType)} images. The metadata was still read.
                                    </EmptyState>
                                </div>
                            ) : previewUrl && (
                                <img
                                    key={previewUrl}
                                    src={previewUrl}
                                    alt={`Preview of ${file.name}`}
                                    onLoad={(e) => setDims({ url: previewUrl, w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                                    onError={() => setFailedUrl(previewUrl)}
                                    style={{ maxWidth: '100%', maxHeight: 380, objectFit: 'contain', display: 'block' }}
                                />
                            )}
                        </div>

                        <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '4px 12px', fontSize: '0.85rem' }}>
                            <dt style={{ color: 'var(--text-muted)' }}>File</dt>
                            <dd style={{ overflowWrap: 'anywhere', fontWeight: 600 }}>{file.name}</dd>
                            <dt style={{ color: 'var(--text-muted)' }}>Type</dt>
                            <dd>{detectedType ? typeLabel(detectedType) : '…'}</dd>
                            <dt style={{ color: 'var(--text-muted)' }}>Size</dt>
                            <dd>{formatBytes(file.size)}</dd>
                            {dims && dims.url === previewUrl && (
                                <>
                                    <dt style={{ color: 'var(--text-muted)' }}>Dimensions</dt>
                                    <dd>{dims.w} × {dims.h} px</dd>
                                </>
                            )}
                        </dl>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                            <button type="button" className="btn btn-primary btn-block" onClick={saveCleanCopy} disabled={cleaning}>
                                {cleaning ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />}
                                {cleaning ? 'Removing metadata…' : 'Download clean copy'}
                            </button>
                            <p className="field-hint" style={{ marginTop: 0 }}>
                                Removes GPS, camera, owner and other metadata. JPEG, PNG and WebP keep every pixel; other formats are redrawn.
                            </p>
                            {cleanResult && (
                                <StatusBanner tone="success" title={`Saved ${cleanResult.name} (${formatBytes(cleanResult.size)})`}>
                                    {cleanResult.note}
                                </StatusBanner>
                            )}
                        </div>

                        <FileDropZone accept={ACCEPT} onFiles={([f]) => handleFile(f)} compact label="Choose another image" hint={size === 'sm' ? undefined : 'or drop it here'} allowPaste />
                    </section>

                    {/* Metadata */}
                    <section className="card" aria-label="Metadata" aria-busy={state.status === 'loading'} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                        {state.status === 'loading' && (
                            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--text-muted)', padding: 'var(--space-lg) 0' }}>
                                <Loader2 size={18} className="spin" aria-hidden="true" /> Reading metadata…
                            </div>
                        )}

                        {state.status === 'error' && (
                            <StatusBanner tone="danger" title="Couldn’t read the metadata">
                                {state.message} You can still try “Download clean copy”.
                            </StatusBanner>
                        )}

                        {meta && meta.count === 0 && (
                            <StatusBanner tone="success" title="No metadata found">
                                This file has no EXIF, IPTC or XMP data, so there is no location, camera or owner information to remove.
                            </StatusBanner>
                        )}

                        {meta && meta.count > 0 && meta.descriptive === 0 && !meta.gps && (
                            <StatusBanner tone="success" title="No personal metadata found">
                                Only technical details (dimensions, encoding, colour profile) are stored. There is no location, camera, date or owner information.
                            </StatusBanner>
                        )}

                        {meta && meta.count > 0 && (
                            <>
                                {meta.gps ? <GpsBanner gps={meta.gps} /> : meta.descriptive > 0 && (
                                    <StatusBanner tone="info" title="No GPS location in this file">
                                        Some apps and photo pickers (including the iOS one) remove the location when sharing, so the original photo may still have it.
                                    </StatusBanner>
                                )}

                                {highlights.length > 0 && (
                                    <div className="auto-grid" style={{ '--auto-grid-min': '150px', gap: 'var(--space-sm)' }}>
                                        {highlights.map(h => (
                                            <div key={h.label} style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: 2 }}>
                                                    <h.icon size={12} aria-hidden="true" /> {h.label}
                                                </div>
                                                <div style={{ fontWeight: 500, fontSize: '0.9rem', overflowWrap: 'anywhere' }}>{h.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)', justifyContent: 'space-between' }}>
                                    <h2 className="section-title">All metadata <span className="badge">{meta.count} tags</span></h2>
                                    <CopyButton text={() => metadataJson(meta)} label="Copy as JSON" />
                                </div>
                                <div style={{ position: 'relative' }}>
                                    <label htmlFor={filterId} className="sr-only">Filter tags</label>
                                    <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                                    <input
                                        id={filterId}
                                        type="search"
                                        value={filter}
                                        onChange={(e) => setFilter(e.target.value)}
                                        placeholder="Filter tags (e.g. GPS, Date, Model)"
                                        style={{ paddingLeft: 34, paddingTop: 8, paddingBottom: 8, fontSize: '0.9rem' }}
                                    />
                                </div>
                                <TagTable meta={meta} filter={filter} />
                            </>
                        )}
                    </section>
                </div>
            )}
        </div>
    )
}
