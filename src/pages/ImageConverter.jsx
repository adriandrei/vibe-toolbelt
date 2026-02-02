import React, { useState, useRef, useEffect } from 'react'
import { Upload, Download, Image as ImageIcon, X, Archive, RefreshCw, FileText } from 'lucide-react'
import JSZip from 'jszip'
import heic2any from 'heic2any'
import { jsPDF } from 'jspdf'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function ImageConverter() {
    useDocumentTitle('Image Converter')
    const [images, setImages] = useState([])
    const [format, setFormat] = useState('image/png')
    const [quality, setQuality] = useState(0.9)
    const [isConverting, setIsConverting] = useState(false)
    const fileInputRef = useRef(null)

    const handleFiles = async (files) => {
        const fileList = Array.from(files)
        const processedImages = []

        for (const file of fileList) {
            let processedFile = file
            let preview = ''

            try {
                // Special handling for HEIC
                if (file.name.toLowerCase().endsWith('.heic') || file.type === 'image/heic') {
                    const blob = await heic2any({
                        blob: file,
                        toType: 'image/jpeg',
                        quality: 0.5 // Preview quality
                    })
                    const actualBlob = Array.isArray(blob) ? blob[0] : blob
                    preview = URL.createObjectURL(actualBlob)
                }
                // SVG, GIF, BMP, WEBP, AVIF, PNG, JPG supported by browser
                else if (file.type.startsWith('image/')) {
                    preview = URL.createObjectURL(file)
                } else {
                    continue
                }

                processedImages.push({
                    id: Math.random().toString(36).substr(2, 9),
                    file, // Keep original file ref
                    preview, // Use browser-compatible blob url for preview
                    convertedUrl: null,
                    status: 'pending'
                })
            } catch (e) {
                console.error('File processing failed', e)
                continue
            }
        }

        setImages(prev => [...prev, ...processedImages])
    }

    const onDrop = (e) => {
        e.preventDefault()
        handleFiles(e.dataTransfer.files)
    }

    // Cleanup object URLs
    useEffect(() => {
        return () => {
            images.forEach(img => {
                URL.revokeObjectURL(img.preview)
                if (img.convertedUrl) URL.revokeObjectURL(img.convertedUrl)
            })
        }
    }, [images])

    const generateIco = async (canvas) => {
        // Basic 256x256 PNG-encoded ICO
        // Header: 2 bytes reserved (0), 2 bytes type (1), 2 bytes count (1)
        // Directory: 1 byte width (0=256), 1 byte height (0=256), 1 byte colors (0), 1 byte res, 2 bytes planes (1), 2 bytes bpp (32), 4 bytes size, 4 bytes offset

        return new Promise((resolve) => {
            // Resize to 256x256 for icon if larger, or keep aspect? ICOs strictly usually are squares.
            // Let's fit centered in 256x256
            const iconCanvas = document.createElement('canvas')
            iconCanvas.width = 256
            iconCanvas.height = 256
            const ctx = iconCanvas.getContext('2d')

            // Draw centered
            const scale = Math.min(256 / canvas.width, 256 / canvas.height)
            const w = canvas.width * scale
            const h = canvas.height * scale
            const x = (256 - w) / 2
            const y = (256 - h) / 2
            ctx.drawImage(canvas, x, y, w, h)

            iconCanvas.toBlob(async (pngBlob) => {
                const pngBuffer = await pngBlob.arrayBuffer()
                const size = pngBuffer.byteLength
                const offset = 22 // 6 header + 16 dir

                const buffer = new ArrayBuffer(offset + size)
                const view = new DataView(buffer)

                // Header
                view.setUint16(0, 0, true) // Reserved
                view.setUint16(2, 1, true) // Type 1 (.ico)
                view.setUint16(4, 1, true) // Count 1

                // Directory Entry
                view.setUint8(6, 0) // Width (0 = 256)
                view.setUint8(7, 0) // Height (0 = 256)
                view.setUint8(8, 0) // Colors
                view.setUint8(9, 0) // Reserved
                view.setUint16(10, 1, true) // Planes
                view.setUint16(12, 32, true) // BPP
                view.setUint32(14, size, true) // Size
                view.setUint32(18, offset, true) // Offset

                // Copy PNG data
                const bytes = new Uint8Array(buffer)
                bytes.set(new Uint8Array(pngBuffer), offset)

                resolve(new Blob([buffer], { type: 'image/x-icon' }))
            }, 'image/png')
        })
    }

    const generatePdf = async (canvas) => {
        const doc = new jsPDF({
            orientation: canvas.width > canvas.height ? 'l' : 'p',
            unit: 'px',
            format: [canvas.width, canvas.height]
        })

        // Add image as typical JPEG or PNG
        const imgData = canvas.toDataURL('image/jpeg', quality)
        doc.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height)
        return doc.output('blob')
    }

    const convertImage = async (img) => {
        return new Promise(async (resolve) => {
            const canvas = document.createElement('canvas')
            const ctx = canvas.getContext('2d')
            const image = new Image()
            image.src = img.preview

            image.onload = async () => {
                canvas.width = image.width
                canvas.height = image.height
                ctx.drawImage(image, 0, 0)

                let resultBlob = null

                try {
                    if (format === 'application/pdf') {
                        resultBlob = await generatePdf(canvas)
                    } else if (format === 'image/x-icon') {
                        resultBlob = await generateIco(canvas)
                    } else {
                        // Standard image formats
                        resultBlob = await new Promise(r => canvas.toBlob(r, format, quality))
                    }

                    if (!resultBlob) throw new Error('Blob creation failed')

                    const url = URL.createObjectURL(resultBlob)
                    resolve({
                        ...img,
                        convertedUrl: url,
                        convertedBlob: resultBlob,
                        status: 'done',
                        finalSize: resultBlob.size
                    })
                } catch (e) {
                    console.error('Conversion error', e)
                    resolve({ ...img, status: 'error' })
                }
            }
            image.onerror = () => resolve({ ...img, status: 'error' })
        })
    }

    const handleConvertAll = async () => {
        setIsConverting(true)
        const results = [...images]
        for (let i = 0; i < results.length; i++) {
            if (results[i].status !== 'done') {
                results[i] = await convertImage(results[i])
                setImages([...results])
            }
        }
        setImages(results)
        setIsConverting(false)
    }

    const downloadZip = async () => {
        const zip = new JSZip()

        let ext = 'png'
        if (format === 'image/jpeg') ext = 'jpeg'
        if (format === 'image/webp') ext = 'webp'
        if (format === 'image/avif') ext = 'avif'
        if (format === 'image/bmp') ext = 'bmp'
        if (format === 'image/x-icon') ext = 'ico'
        if (format === 'application/pdf') ext = 'pdf'

        images.forEach(img => {
            if (img.convertedBlob) {
                const nameBlob = img.file.name
                const name = nameBlob.substring(0, nameBlob.lastIndexOf('.')) || nameBlob
                zip.file(`${name}_converted.${ext}`, img.convertedBlob)
            }
        })

        const content = await zip.generateAsync({ type: 'blob' })
        const url = URL.createObjectURL(content)
        const a = document.createElement('a')
        a.href = url
        a.download = `converted_images.zip`
        a.click()
        URL.revokeObjectURL(url)
    }

    const formatSize = (bytes) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
    }

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-xl)' }}>
                <h2 className="text-gradient">Image Converter</h2>
                <p style={{ color: 'var(--text-muted)' }}>Bulk convert PNG, JPG, WEBP, AVIF, HEIC, SVG to modern formats.</p>
            </div>

            {/* Config & Controls */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-lg)', alignItems: 'center' }}>

                <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-xs)', fontSize: '0.9rem', color: 'var(--text-dim)' }}>Output Format</label>
                    <select
                        value={format}
                        onChange={e => setFormat(e.target.value)}
                        style={{ width: '100%', padding: '10px' }}
                    >
                        <option value="image/png">PNG (Lossless)</option>
                        <option value="image/jpeg">JPEG (Lossy)</option>
                        <option value="image/webp">WEBP (Modern)</option>
                        <option value="image/avif">AVIF (Next Gen)</option>
                        <option value="image/bmp">BMP (Bitmap)</option>
                        <option value="image/x-icon">ICO (Favicon)</option>
                        <option value="application/pdf">PDF (Document)</option>
                    </select>
                </div>

                <div style={{ flex: 1, minWidth: '200px' }}>
                    <label style={{ display: 'block', marginBottom: 'var(--space-xs)', fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                        Quality ({Math.round(quality * 100)}%)
                    </label>
                    <input
                        type="range"
                        min="0.1"
                        max="1"
                        step="0.05"
                        value={quality}
                        onChange={e => setQuality(Number(e.target.value))}
                        disabled={['image/png', 'image/x-icon', 'image/bmp'].includes(format)}
                        style={{ width: '100%' }}
                    />
                    {['image/png', 'image/x-icon', 'image/bmp'].includes(format) && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Quality ignored for {format.split('/')[1]}</div>}
                </div>

                <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' }}>
                    <button
                        onClick={handleConvertAll}
                        disabled={images.length === 0 || isConverting}
                        style={{
                            padding: '12px 24px',
                            background: 'var(--primary)',
                            color: '#fff',
                            borderRadius: 'var(--radius-md)',
                            fontWeight: 600,
                            border: 'none',
                            opacity: images.length === 0 || isConverting ? 0.5 : 1,
                            cursor: images.length === 0 ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                        }}
                    >
                        {isConverting ? <RefreshCw className="spin" size={18} /> : <RefreshCw size={18} />}
                        {isConverting ? 'Processing...' : 'Convert All'}
                    </button>

                    {images.some(i => i.status === 'done') && (
                        <button
                            onClick={downloadZip}
                            style={{
                                padding: '12px 24px',
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-main)',
                                borderRadius: 'var(--radius-md)',
                                fontWeight: 600,
                                border: '1px solid var(--border)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8
                            }}
                        >
                            <Archive size={18} /> ZIP
                        </button>
                    )}
                </div>
            </div>

            {/* Drop Zone */}
            <div
                onDrop={onDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current.click()}
                style={{
                    border: '2px dashed var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: 'var(--space-xl)',
                    textAlign: 'center',
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.02)',
                    marginBottom: 'var(--space-lg)',
                    transition: 'all 0.2s'
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.background = 'rgba(var(--primary-rgb), 0.05)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
            >
                <input
                    type="file"
                    ref={fileInputRef}
                    multiple
                    accept="image/*,.heic,.ico"
                    onChange={e => handleFiles(e.target.files)}
                    style={{ display: 'none' }}
                />
                <Upload size={48} style={{ color: 'var(--text-dim)', marginBottom: 'var(--space-md)' }} />
                <h3 style={{ marginBottom: 'var(--space-sm)' }}>Click or Drag Images Here</h3>
                <p style={{ color: 'var(--text-muted)' }}>PNG, JPG, SVG, GIF, WEBP, AVIF, HEIC, BMP...</p>
            </div>

            {/* Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 'var(--space-md)' }}>
                {images.map(img => (
                    <div key={img.id} className="glass-panel" style={{ padding: 'var(--space-md)', position: 'relative' }}>
                        <button
                            onClick={() => setImages(prev => prev.filter(i => i.id !== img.id))}
                            style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)', borderRadius: '50%', padding: 4, color: '#fff', border: 'none', cursor: 'pointer', zIndex: 10 }}
                        >
                            <X size={14} />
                        </button>

                        <div style={{
                            height: '180px',
                            background: '#000',
                            borderRadius: 'var(--radius-sm)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: 'var(--space-sm)',
                            overflow: 'hidden'
                        }}>
                            <img
                                src={img.status === 'done' && !format.includes('pdf') ? img.convertedUrl : img.preview}
                                alt="preview"
                                style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                            <div style={{
                                fontWeight: 600,
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                                textOverflow: 'ellipsis',
                                maxWidth: '180px',
                                fontSize: '0.9rem'
                            }}>
                                {img.file.name}
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 'var(--space-md)' }}>
                            <span>{formatSize(img.file.size)}</span>
                            {img.status === 'done' && (
                                <span style={{ color: '#10b981' }}>
                                    → {formatSize(img.finalSize)}
                                    ({Math.round((img.finalSize / img.file.size) * 100)}%)
                                </span>
                            )}
                        </div>

                        {img.status === 'done' ? (
                            <a
                                href={img.convertedUrl}
                                download={`${img.file.name.split('.')[0]}_converted.${format === 'application/pdf' ? 'pdf' :
                                        format === 'image/x-icon' ? 'ico' :
                                            format.split('/')[1]
                                    }`}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 6,
                                    width: '100%',
                                    padding: '8px',
                                    background: 'var(--bg-secondary)',
                                    color: 'var(--text-main)',
                                    borderRadius: 'var(--radius-sm)',
                                    textDecoration: 'none',
                                    border: '1px solid var(--border)',
                                    fontSize: '0.9rem'
                                }}
                            >
                                <Download size={14} /> Download
                            </a>
                        ) : (
                            <div style={{
                                padding: '8px',
                                textAlign: 'center',
                                background: 'rgba(255,255,255,0.05)',
                                borderRadius: 'var(--radius-sm)',
                                color: 'var(--text-dim)',
                                fontSize: '0.85rem'
                            }}>
                                Ready
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
