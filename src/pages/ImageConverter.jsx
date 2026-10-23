import { useEffect, useId, useMemo, useRef, useState } from 'react'
import ReactCrop, { centerCrop, makeAspectCrop } from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Archive, Check, Crop as CropIcon, Download, FileText, FlipHorizontal, FlipVertical, ImagePlus, Images, Loader2, RefreshCw, RotateCw, Trash2, Undo2, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import Field from '../components/ui/Field'
import SliderField from '../components/ui/SliderField'
import ColorField from '../components/ui/ColorField'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'
import { useToast } from '../components/ToastProvider'
import { useObjectURL } from '../hooks/useObjectURL'
import { useLeaveGuard } from '../hooks/useLeaveGuard'
import { usePane } from '../contexts/pane'
import { downloadBlob, formatBytes, splitFilename } from '../utils/download'
import {
    FORMATS, MAX_CANVAS_SIDE, buildPdf, canvasAsImage, canvasToPdfPage, createIco, encodeCanvas,
    extensionForType, fitSize, getEncoderSupport, isHeicFile, loadImage, releaseCanvas, renderImage,
} from '../utils/image'

const ACCEPT = 'image/*,.heic,.heif,.avif,.ico,.svg,.tif,.tiff,.jxl'

const FORMAT_OPTIONS = [
    { value: 'image/png', label: 'PNG', hint: 'Lossless and keeps transparency.' },
    { value: 'image/jpeg', label: 'JPEG', hint: 'Smallest for photos. Transparent areas are filled with the background colour.' },
    { value: 'image/webp', label: 'WebP', hint: 'Smaller than JPEG and PNG, and keeps transparency.' },
    { value: 'image/avif', label: 'AVIF', hint: 'Very small files, but slow to encode.' },
    { value: 'image/bmp', label: 'BMP', hint: 'Uncompressed 24-bit bitmap. Transparent areas are filled.' },
    { value: 'image/x-icon', label: 'ICO (icon)', hint: 'Several icon sizes in one .ico file. Non-square images are padded.' },
    { value: 'application/pdf', label: 'PDF', hint: 'Each image becomes a page the size of the image.' },
]

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const CROP_ASPECTS = [
    { value: 'free', label: 'Free' },
    { value: '1', label: '1:1' },
    { value: '1.3333', label: '4:3' },
    { value: '1.5', label: '3:2' },
    { value: '1.7778', label: '16:9' },
]

let idCounter = 0
const newId = () => `img-${++idCounter}`

function validateDimension(value) {
    if (value === '') return null
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1) return 'Whole pixels, at least 1'
    if (n > MAX_CANVAS_SIDE) return `At most ${MAX_CANVAS_SIDE}`
    return null
}

function outputName(name, type) {
    const base = splitFilename(name || 'image').base || 'image'
    return `${base}.${extensionForType(type)}`
}

function uniqueNames(names) {
    const used = new Set()
    return names.map((name) => {
        const { base, ext } = splitFilename(name)
        let candidate = name
        for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext ? `.${ext}` : ''}`
        used.add(candidate.toLowerCase())
        return candidate
    })
}

function isFresh(img, key) {
    return !!img.result && img.result.key === key && img.result.rev === img.rev
}

async function convertImage(img, settings) {
    const loaded = await loadImage(img.source.blob, { name: img.name })
    let canvas = null
    try {
        const transform = { rotation: img.rotation, flipH: img.flipH, flipV: img.flipV }
        if (settings.format === 'image/x-icon') {
            canvas = renderImage(loaded, transform)
            const longest = Math.max(canvas.width, canvas.height)
            let sizes = settings.icoSizes.filter(s => s <= Math.max(16, longest))
            if (!sizes.length) sizes = [Math.min(...settings.icoSizes)]
            const skipped = settings.icoSizes.filter(s => !sizes.includes(s))
            const blob = await createIco(canvasAsImage(canvas), sizes, { fit: 'contain' })
            const largest = Math.max(...sizes)
            return {
                blob, type: 'image/x-icon', width: largest, height: largest,
                note: `Sizes ${sizes.join(', ')}${skipped.length ? ` (${skipped.join(', ')} skipped: larger than the image)` : ''}`,
            }
        }
        const turned = img.rotation === 90 || img.rotation === 270
        const baseW = turned ? loaded.height : loaded.width
        const baseH = turned ? loaded.width : loaded.height
        const { width, height } = fitSize(baseW, baseH, { width: settings.width, height: settings.height, keepAspect: settings.keepAspect })
        canvas = renderImage(loaded, { ...transform, width, height })
        if (settings.format === 'application/pdf') {
            const page = await canvasToPdfPage(canvas, { quality: settings.quality / 100, background: settings.background })
            const blob = await buildPdf([page])
            return { blob, type: 'application/pdf', width, height, page }
        }
        const blob = await encodeCanvas(canvas, { type: settings.format, quality: (settings.quality ?? 92) / 100, background: settings.background ?? '#ffffff' })
        return { blob, type: blob.type, width, height }
    } finally {
        loaded.close()
        releaseCanvas(canvas)
    }
}

function StatusBadge({ img, fresh }) {
    if (img.status === 'loading') {
        return <span className="badge"><Loader2 size={12} className="spin" aria-hidden="true" /> {img.heic ? 'Decoding HEIC…' : 'Loading…'}</span>
    }
    if (img.status === 'error') return <span className="badge badge-danger">Can’t open</span>
    if (img.converting) return <span className="badge badge-primary"><Loader2 size={12} className="spin" aria-hidden="true" /> Converting…</span>
    if (img.convertError) return <span className="badge badge-danger">Failed</span>
    if (fresh) return <span className="badge badge-success"><Check size={12} aria-hidden="true" /> Done</span>
    if (img.result) return <span className="badge badge-warning" title="Settings changed since this was converted">Out of date</span>
    return <span className="badge">Ready</span>
}

function ImageCard({ img, fresh, busy, compact, onRotate, onFlip, onCrop, onRevert, onRemove, onDownload }) {
    const sourceUrl = useObjectURL(img.source?.blob ?? null)
    const showResult = fresh && img.result.type.startsWith('image/')
    const resultUrl = useObjectURL(showResult ? img.result.blob : null)
    const src = showResult ? resultUrl : sourceUrl
    // Square previews on wide panes, shorter ones on phones. A quarter-turned
    // preview is shrunk so it still fits a non-square box.
    const boxRatio = compact ? 3 / 2 : 1
    const turned = img.rotation === 90 || img.rotation === 270
    const k = turned ? Math.min(boxRatio, 1 / boxRatio) : 1
    const transform = showResult ? 'none' : `rotate(${img.rotation}deg) scale(${(img.flipH ? -1 : 1) * k}, ${(img.flipV ? -1 : 1) * k})`
    const edited = img.rotation !== 0 || img.flipH || img.flipV || img.cropped
    const canEdit = img.status === 'ready' && !img.converting && !busy
    const result = img.result
    const change = result ? Math.round((result.blob.size / img.size - 1) * 100) : 0

    return (
        <article className="card card-compact" aria-label={img.name} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', padding: 'var(--space-sm)' }}>
            <div className="checkerboard" style={{ position: 'relative', aspectRatio: String(boxRatio), borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {src ? (
                    <img
                        src={src}
                        alt={showResult ? `Converted ${img.name}` : `Preview of ${img.name}`}
                        style={{ width: '100%', height: '100%', objectFit: 'contain', transform, transition: 'transform 0.2s ease' }}
                    />
                ) : img.status === 'error' ? (
                    <X size={32} aria-hidden="true" style={{ color: 'var(--danger)' }} />
                ) : (
                    <Loader2 size={24} className="spin" aria-hidden="true" style={{ color: 'var(--text-muted)' }} />
                )}
                <div style={{ position: 'absolute', top: 8, left: 8 }}>
                    <StatusBadge img={img} fresh={fresh} />
                </div>
            </div>

            <div style={{ minWidth: 0 }}>
                <div title={img.name} style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{img.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {formatBytes(img.size)}
                    {img.source && ` · ${img.source.width}×${img.source.height}`}
                    {img.cropped && ' · cropped'}
                </div>
                {result && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        → {FORMATS[result.type]?.label ?? result.type} · {formatBytes(result.blob.size)} · {result.width}×{result.height}{' '}
                        <span style={{ color: change < 0 ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                            ({change > 0 ? '+' : ''}{change}%)
                        </span>
                    </div>
                )}
                {fresh && result.note && <div className="field-hint" style={{ marginTop: 2 }}>{result.note}</div>}
                {img.status === 'error' && <div className="field-error" role="alert">{img.error}</div>}
                {img.convertError && <div className="field-error" role="alert">{img.convertError}</div>}
            </div>

            <div role="toolbar" aria-label={`Edit ${img.name}`} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, marginTop: 'auto' }}>
                <button type="button" className="icon-btn" onClick={onRotate} disabled={!canEdit} aria-label="Rotate 90° clockwise" title="Rotate 90°"><RotateCw size={16} aria-hidden="true" /></button>
                <button type="button" className="icon-btn" onClick={() => onFlip('h')} disabled={!canEdit} aria-label="Flip horizontally" aria-pressed={img.flipH} title="Flip horizontally"><FlipHorizontal size={16} aria-hidden="true" /></button>
                <button type="button" className="icon-btn" onClick={() => onFlip('v')} disabled={!canEdit} aria-label="Flip vertically" aria-pressed={img.flipV} title="Flip vertically"><FlipVertical size={16} aria-hidden="true" /></button>
                <button type="button" className="icon-btn" onClick={onCrop} disabled={!canEdit} aria-label="Crop" title="Crop"><CropIcon size={16} aria-hidden="true" /></button>
                {edited && (
                    <button type="button" className="icon-btn" onClick={onRevert} disabled={!canEdit} aria-label="Undo all edits" title="Undo all edits"><Undo2 size={16} aria-hidden="true" /></button>
                )}
                <button type="button" className="icon-btn" onClick={onRemove} disabled={img.converting} aria-label={`Remove ${img.name}`} title="Remove"><Trash2 size={16} aria-hidden="true" /></button>
                {result && (
                    <button type="button" className={`btn btn-sm ${fresh ? 'btn-secondary' : 'btn-ghost'}`} onClick={onDownload} style={{ marginLeft: 'auto' }} title={fresh ? undefined : 'Converted with earlier settings'}>
                        <Download size={14} aria-hidden="true" /> {extensionForType(result.type).toUpperCase()}
                    </button>
                )}
            </div>
        </article>
    )
}

function CropDialog({ target, onClose, onApply, applying }) {
    const url = useObjectURL(target.blob ?? null)
    const [aspect, setAspect] = useState('free')
    const [crop, setCrop] = useState()
    const imgRef = useRef(null)
    const aspectValue = aspect === 'free' ? undefined : Number(aspect)

    const initialCrop = (ratio) => {
        const el = imgRef.current
        if (!el) return undefined
        const { width, height } = el
        if (!ratio) return { unit: '%', x: 5, y: 5, width: 90, height: 90 }
        return centerCrop(makeAspectCrop({ unit: '%', width: 90 }, ratio, width, height), width, height)
    }

    const px = crop && target.width ? {
        w: Math.max(1, Math.round((crop.width / 100) * target.width)),
        h: Math.max(1, Math.round((crop.height / 100) * target.height)),
    } : null

    return (
        <Modal
            open
            onClose={onClose}
            title="Crop image"
            size="xl"
            footer={(
                <>
                    <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button type="button" className="btn btn-primary" onClick={() => onApply(crop)} disabled={!crop || !crop.width || !crop.height || applying || !url}>
                        {applying ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Apply crop
                    </button>
                </>
            )}
        >
            {target.loading && (
                <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
                    <Loader2 size={16} className="spin" aria-hidden="true" /> Preparing the full-resolution image…
                </div>
            )}
            {target.error && <StatusBanner tone="danger" title="Can’t crop this image">{target.error}</StatusBanner>}
            {url && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center', justifyContent: 'space-between' }}>
                        <SegmentedControl
                            ariaLabel="Aspect ratio"
                            size="sm"
                            options={CROP_ASPECTS}
                            value={aspect}
                            onChange={(next) => {
                                setAspect(next)
                                setCrop(initialCrop(next === 'free' ? undefined : Number(next)))
                            }}
                        />
                        {px && <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{px.w} × {px.h} px</span>}
                    </div>
                    <div className="stage" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 'var(--space-sm)' }}>
                        <ReactCrop crop={crop} onChange={(_, percent) => setCrop(percent)} aspect={aspectValue} keepSelection ruleOfThirds minWidth={8} minHeight={8}>
                            <img
                                ref={imgRef}
                                src={url}
                                alt="Image to crop"
                                onLoad={() => setCrop(initialCrop(aspectValue))}
                                style={{ display: 'block', maxWidth: '100%', maxHeight: '58vh' }}
                            />
                        </ReactCrop>
                    </div>
                    <p className="field-hint" style={{ marginTop: 0 }}>
                        The crop is cut from the full-resolution image ({target.width} × {target.height} px). Drag the handles, or focus the selection and use the arrow keys.
                    </p>
                </div>
            )}
        </Modal>
    )
}

export default function ImageConverter() {
    const toast = useToast()
    const { size } = usePane()
    const icoLabelId = useId()
    const [images, setImages] = useState([])
    const [format, setFormat] = useState('image/png')
    const [quality, setQuality] = useState(90)
    const [width, setWidth] = useState('')
    const [height, setHeight] = useState('')
    const [keepAspect, setKeepAspect] = useState(true)
    const [background, setBackground] = useState('#ffffff')
    const [icoSizes, setIcoSizes] = useState([16, 32, 48, 256])
    const [pdfMode, setPdfMode] = useState('separate')
    const [support, setSupport] = useState(null)
    const [progress, setProgress] = useState(null) // { done, total } while converting
    const [cropTarget, setCropTarget] = useState(null)
    const [applyingCrop, setApplyingCrop] = useState(false)
    const [packing, setPacking] = useState(false)

    const imagesRef = useRef(images)
    const queueRef = useRef(Promise.resolve())
    const cropTokenRef = useRef(0)
    const aliveRef = useRef(true)

    useEffect(() => {
        imagesRef.current = images
    })

    useEffect(() => {
        aliveRef.current = true
        return () => {
            aliveRef.current = false
        }
    }, [])

    useEffect(() => {
        let alive = true
        getEncoderSupport().then((s) => {
            if (alive) setSupport(s)
        })
        return () => {
            alive = false
        }
    }, [])

    const converting = progress !== null
    useLeaveGuard(converting, 'Images are still being converted. Leave anyway?')

    const info = FORMATS[format]
    const isIco = format === 'image/x-icon'
    const isPdf = format === 'application/pdf'
    const unsupported = support ? !support[format] : false
    const widthError = isIco ? null : validateDimension(width)
    const heightError = isIco ? null : validateDimension(height)
    const settingsInvalid = unsupported || !!widthError || !!heightError || (isIco && !icoSizes.length)

    const settings = useMemo(() => ({
        format,
        quality: info.lossy ? quality : null,
        width: isIco || width === '' ? null : Number(width),
        height: isIco || height === '' ? null : Number(height),
        keepAspect: isIco ? null : keepAspect,
        background: info.alpha ? null : background,
        icoSizes: isIco ? [...icoSizes].sort((a, b) => a - b) : null,
    }), [format, info, quality, isIco, width, height, keepAspect, background, icoSizes])
    const settingsKey = JSON.stringify(settings)

    const updateImage = (id, change) => {
        setImages(prev => prev.map(img => (img.id === id ? change(img) : img)))
    }

    // Rotations, flips, crops and reverts invalidate the previous result
    const editImage = (id, change) => {
        setImages(prev => prev.map(img => (img.id === id ? { ...img, ...change(img), rev: img.rev + 1, result: null, convertError: null } : img)))
    }

    const decodeItem = async (item) => {
        if (!aliveRef.current || !imagesRef.current.some(i => i.id === item.id)) return
        let loaded = null
        try {
            loaded = await loadImage(item.file, { name: item.name })
            const source = { blob: loaded.source, width: loaded.width, height: loaded.height }
            updateImage(item.id, img => ({ ...img, status: 'ready', original: source, source, file: null }))
        } catch (err) {
            updateImage(item.id, img => ({ ...img, status: 'error', error: err?.message || 'This file couldn’t be opened.', file: null }))
            toast.error(`Couldn’t open ${item.name}: ${err?.message || 'unknown error'}`)
        } finally {
            loaded?.close()
        }
    }

    const addFiles = (files) => {
        const items = files.map(file => ({
            id: newId(),
            name: file.name || 'image.png',
            size: file.size,
            file,
            heic: isHeicFile(file),
            status: 'loading',
            error: null,
            original: null,
            source: null,
            rotation: 0,
            flipH: false,
            flipV: false,
            cropped: false,
            rev: 0,
            converting: false,
            convertError: null,
            result: null,
        }))
        setImages(prev => [...prev, ...items])
        imagesRef.current = [...imagesRef.current, ...items]
        // Decode one at a time: HEIC decoding is heavy
        for (const item of items) queueRef.current = queueRef.current.then(() => decodeItem(item))
    }

    const convertAll = async () => {
        if (converting || settingsInvalid) return
        const key = settingsKey
        const snapshot = settings
        const todo = imagesRef.current.filter(img => img.status === 'ready' && !isFresh(img, key)).map(img => img.id)
        if (!todo.length) return
        setProgress({ done: 0, total: todo.length })
        let failed = 0
        try {
            for (let n = 0; n < todo.length; n++) {
                if (!aliveRef.current) return
                const img = imagesRef.current.find(i => i.id === todo[n])
                if (img && img.status === 'ready') {
                    updateImage(img.id, i => ({ ...i, converting: true, convertError: null }))
                    try {
                        const result = await convertImage(img, snapshot)
                        // Keep the result only if the image wasn't edited meanwhile
                        updateImage(img.id, i => (i.rev === img.rev ? { ...i, converting: false, result: { ...result, key, rev: img.rev } } : { ...i, converting: false }))
                    } catch (err) {
                        failed++
                        updateImage(img.id, i => ({ ...i, converting: false, convertError: err?.message || 'Conversion failed.' }))
                    }
                }
                setProgress({ done: n + 1, total: todo.length })
            }
        } finally {
            if (aliveRef.current) setProgress(null)
        }
        if (failed) toast.error(`${failed} image${failed === 1 ? '' : 's'} couldn’t be converted. See the cards for details.`)
    }

    const freshImages = images.filter(img => isFresh(img, settingsKey))
    const pendingCount = images.filter(img => img.status === 'ready' && !isFresh(img, settingsKey)).length
    const staleCount = images.filter(img => img.result && !isFresh(img, settingsKey)).length
    const loadingCount = images.filter(img => img.status === 'loading').length

    const downloadZip = async () => {
        if (!freshImages.length || packing) return
        setPacking(true)
        try {
            const { default: JSZip } = await import('jszip')
            const zip = new JSZip()
            const names = uniqueNames(freshImages.map(img => outputName(img.name, img.result.type)))
            freshImages.forEach((img, i) => zip.file(names[i], img.result.blob))
            // Images are already compressed: storing them is much faster
            const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
            downloadBlob(blob, 'converted-images.zip')
        } catch (err) {
            toast.error(`Couldn’t create the ZIP: ${err?.message || 'unknown error'}`)
        } finally {
            setPacking(false)
        }
    }

    const downloadCombinedPdf = async () => {
        if (!freshImages.length || packing) return
        setPacking(true)
        try {
            const blob = await buildPdf(freshImages.map(img => img.result.page))
            downloadBlob(blob, 'images.pdf')
        } catch (err) {
            toast.error(`Couldn’t create the PDF: ${err?.message || 'unknown error'}`)
        } finally {
            setPacking(false)
        }
    }

    const openCrop = async (img) => {
        const token = ++cropTokenRef.current
        const base = { id: img.id, rev: img.rev, name: img.name }
        if (!img.rotation && !img.flipH && !img.flipV) {
            setCropTarget({ ...base, blob: img.source.blob, width: img.source.width, height: img.source.height })
            return
        }
        // Crop what the user sees: bake rotation and flips in first (losslessly)
        setCropTarget({ ...base, loading: true })
        let loaded = null
        let canvas = null
        try {
            loaded = await loadImage(img.source.blob, { name: img.name })
            canvas = renderImage(loaded, { rotation: img.rotation, flipH: img.flipH, flipV: img.flipV })
            const blob = await encodeCanvas(canvas, { type: 'image/png' })
            if (token === cropTokenRef.current) setCropTarget({ ...base, blob, width: canvas.width, height: canvas.height })
        } catch (err) {
            if (token === cropTokenRef.current) setCropTarget({ ...base, error: err?.message || 'The image couldn’t be prepared.' })
        } finally {
            loaded?.close()
            releaseCanvas(canvas)
        }
    }

    const closeCrop = () => {
        cropTokenRef.current++
        setCropTarget(null)
    }

    const applyCrop = async (percent) => {
        const target = cropTarget
        if (!target?.blob || !percent) return
        const clampPx = (v, max) => Math.min(max, Math.max(0, v))
        const x = clampPx(Math.round((percent.x / 100) * target.width), target.width - 1)
        const y = clampPx(Math.round((percent.y / 100) * target.height), target.height - 1)
        const rect = {
            x,
            y,
            width: Math.max(1, Math.min(target.width - x, Math.round((percent.width / 100) * target.width))),
            height: Math.max(1, Math.min(target.height - y, Math.round((percent.height / 100) * target.height))),
        }
        setApplyingCrop(true)
        let loaded = null
        let canvas = null
        try {
            loaded = await loadImage(target.blob, { name: target.name })
            canvas = renderImage(loaded, { crop: rect })
            const blob = await encodeCanvas(canvas, { type: 'image/png' })
            const current = imagesRef.current.find(i => i.id === target.id)
            if (!current || current.rev !== target.rev) {
                toast.warning('The image changed while you were cropping, so the crop wasn’t applied.')
            } else {
                const source = { blob, width: canvas.width, height: canvas.height }
                editImage(target.id, () => ({ source, rotation: 0, flipH: false, flipV: false, cropped: true }))
            }
            closeCrop()
        } catch (err) {
            toast.error(`Couldn’t crop: ${err?.message || 'unknown error'}`)
        } finally {
            loaded?.close()
            releaseCanvas(canvas)
            setApplyingCrop(false)
        }
    }

    const toggleIcoSize = (size) => {
        setIcoSizes(prev => (prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size]))
    }

    const formatOption = FORMAT_OPTIONS.find(o => o.value === format)
    const summary = [
        `${images.length} image${images.length === 1 ? '' : 's'}`,
        freshImages.length ? `${freshImages.length} converted` : null,
        staleCount ? `${staleCount} out of date` : null,
        loadingCount ? `${loadingCount} loading` : null,
    ].filter(Boolean).join(' · ')

    return (
        <div className="page page-wide">
            <ToolHeader />

            <section className="card" aria-label="Output settings">
                <fieldset disabled={converting} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                    <legend className="sr-only">Output settings</legend>
                    <div className="auto-grid" style={{ '--auto-grid-min': '220px', alignItems: 'start', gap: 'var(--space-lg)' }}>
                        <Field label="Format" hint={unsupported ? undefined : formatOption?.hint} error={unsupported ? `This browser can’t encode ${info.label}. Choose another format.` : undefined}>
                            <select value={format} onChange={(e) => setFormat(e.target.value)} style={{ padding: '0.6rem 0.75rem' }}>
                                {FORMAT_OPTIONS.map(o => {
                                    const off = support ? !support[o.value] : false
                                    return <option key={o.value} value={o.value} disabled={off}>{o.label}{off ? ' (not supported by this browser)' : ''}</option>
                                })}
                            </select>
                        </Field>

                        {info.lossy ? (
                            <SliderField label="Quality" value={quality} onChange={setQuality} min={10} max={100} unit="%" hint="Lower is smaller but blurrier." />
                        ) : (
                            <div>
                                <span className="field-label">Quality</span>
                                <p className="field-hint" style={{ marginTop: 0 }}>{info.label} is lossless, so there’s no quality setting.</p>
                            </div>
                        )}

                        {isIco ? (
                            <div role="group" aria-labelledby={icoLabelId}>
                                <span id={icoLabelId} className="field-label">Icon sizes (px)</span>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {ICO_SIZES.map(s => (
                                        <button key={s} type="button" className={`chip ${icoSizes.includes(s) ? 'is-active' : ''}`} aria-pressed={icoSizes.includes(s)} onClick={() => toggleIcoSize(s)}>
                                            {s}
                                        </button>
                                    ))}
                                </div>
                                {icoSizes.length ? (
                                    <p className="field-hint">Sizes larger than the image are skipped. Resize doesn’t apply to icons.</p>
                                ) : (
                                    <p className="field-error">Choose at least one size.</p>
                                )}
                            </div>
                        ) : (
                            <div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)', gap: 6, alignItems: 'start' }}>
                                    <Field label="Width (px)" error={widthError}>
                                        <input type="number" inputMode="numeric" min={1} max={MAX_CANVAS_SIDE} placeholder="Auto" value={width} onChange={(e) => setWidth(e.target.value)} style={{ padding: '0.6rem 0.75rem' }} />
                                    </Field>
                                    <span aria-hidden="true" style={{ paddingTop: '2.1rem', color: 'var(--text-dim)' }}>×</span>
                                    <Field label="Height (px)" error={heightError}>
                                        <input type="number" inputMode="numeric" min={1} max={MAX_CANVAS_SIDE} placeholder="Auto" value={height} onChange={(e) => setHeight(e.target.value)} style={{ padding: '0.6rem 0.75rem' }} />
                                    </Field>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={keepAspect} onChange={(e) => setKeepAspect(e.target.checked)} />
                                    Keep aspect ratio
                                </label>
                                <p className="field-hint">
                                    {width && height && keepAspect ? 'Images are scaled to fit inside this box.' : 'Leave empty to keep the original size.'}
                                </p>
                            </div>
                        )}

                        {!info.alpha && (
                            <ColorField label="Background" value={background} onChange={setBackground} hint={`${info.label} has no transparency, so transparent areas get this colour.`} />
                        )}

                        {isPdf && (
                            <div>
                                <span className="field-label">PDF files</span>
                                <SegmentedControl
                                    ariaLabel="PDF files"
                                    size="sm"
                                    value={pdfMode}
                                    onChange={setPdfMode}
                                    options={[{ value: 'separate', label: 'One per image' }, { value: 'combined', label: 'One combined PDF' }]}
                                />
                                <p className="field-hint">{pdfMode === 'combined' ? 'Pages follow the order of the images below.' : 'Each image is downloaded as its own PDF (or all of them in a ZIP).'}</p>
                            </div>
                        )}
                    </div>
                </fieldset>
                <p className="field-hint" style={{ marginTop: 'var(--space-md)' }}>
                    Everything happens in your browser. Converted images never keep EXIF or GPS metadata.
                </p>
            </section>

            <FileDropZone
                accept={ACCEPT}
                multiple
                allowPaste
                maxSizeMB={200}
                onFiles={addFiles}
                compact={images.length > 0}
                icon={ImagePlus}
                label={images.length ? 'Add more images' : 'Drop images here, paste, or click to browse'}
                hint={images.length ? (size === 'sm' ? undefined : 'or drop / paste them here') : 'PNG, JPEG, WebP, AVIF, GIF, SVG, BMP, ICO and HEIC/HEIF (iPhone photos).'}
                style={images.length ? undefined : { minHeight: 200 }}
            />

            {images.length > 0 ? (
                <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)', alignItems: 'center' }}>
                        <button type="button" className="btn btn-primary" onClick={convertAll} disabled={converting || !pendingCount || settingsInvalid}>
                            {converting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                            {converting
                                ? `Converting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                                : pendingCount ? `Convert ${pendingCount} image${pendingCount === 1 ? '' : 's'} to ${info.label}` : 'All converted'}
                        </button>
                        {isPdf && pdfMode === 'combined' ? (
                            <button type="button" className="btn btn-secondary" onClick={downloadCombinedPdf} disabled={!freshImages.length || packing || converting}>
                                {packing ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
                                Download PDF ({freshImages.length} page{freshImages.length === 1 ? '' : 's'})
                            </button>
                        ) : (
                            <button type="button" className="btn btn-secondary" onClick={downloadZip} disabled={!freshImages.length || packing || converting}>
                                {packing ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
                                Download ZIP ({freshImages.length})
                            </button>
                        )}
                        <button type="button" className="btn btn-ghost" onClick={() => setImages([])} disabled={converting}>
                            <X size={16} aria-hidden="true" /> Clear all
                        </button>
                        <span role="status" style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-muted)' }}>{summary}</span>
                    </div>
                    {staleCount > 0 && !converting && (
                        <StatusBanner tone="warning" title="Settings changed">
                            {staleCount} result{staleCount === 1 ? ' was' : 's were'} made with different settings and {staleCount === 1 ? 'isn’t' : 'aren’t'} in the ZIP. Convert again to update {staleCount === 1 ? 'it' : 'them'}.
                        </StatusBanner>
                    )}

                    <div className="auto-grid" style={{ '--auto-grid-min': '200px' }}>
                        {images.map(img => (
                            <ImageCard
                                key={img.id}
                                img={img}
                                fresh={isFresh(img, settingsKey)}
                                busy={converting}
                                compact={size === 'sm'}
                                onRotate={() => editImage(img.id, i => ({ rotation: (i.rotation + 90) % 360 }))}
                                onFlip={(axis) => editImage(img.id, i => (axis === 'h' ? { flipH: !i.flipH } : { flipV: !i.flipV }))}
                                onCrop={() => openCrop(img)}
                                onRevert={() => editImage(img.id, i => ({ source: i.original, rotation: 0, flipH: false, flipV: false, cropped: false }))}
                                onRemove={() => setImages(prev => prev.filter(i => i.id !== img.id))}
                                onDownload={() => downloadBlob(img.result.blob, outputName(img.name, img.result.type))}
                            />
                        ))}
                    </div>
                </>
            ) : (
                <EmptyState icon={Images} title="No images yet">
                    Add images to convert them between formats, resize, rotate, flip or crop them, all at once.
                </EmptyState>
            )}

            {cropTarget && (
                <CropDialog
                    key={`${cropTarget.id}-${cropTarget.rev}`}
                    target={cropTarget}
                    onClose={closeCrop}
                    onApply={applyCrop}
                    applying={applyingCrop}
                />
            )}
        </div>
    )
}
