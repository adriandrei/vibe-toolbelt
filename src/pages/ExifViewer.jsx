import React, { useState, useRef } from 'react'
import ExifReader from 'exifreader'
import { Upload, MapPin, Camera, Info, ShieldCheck, Download, Image as ImageIcon } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function ExifViewer() {
    useDocumentTitle('EXIF Viewer')
    const [file, setFile] = useState(null)
    const [preview, setPreview] = useState(null)
    const [tags, setTags] = useState(null)
    const [isProcessing, setIsProcessing] = useState(false)

    const handleFile = async (e) => {
        const selected = e.target.files?.[0] || e.dataTransfer?.files?.[0]
        if (!selected) return

        setFile(selected)
        setPreview(URL.createObjectURL(selected))
        setTags(null)
        setIsProcessing(true)

        try {
            // Parse EXIF
            const tags = await ExifReader.load(selected)
            setTags(tags)
        } catch (err) {
            console.error(err)
            alert('Could not read EXIF data. The image might not have standard metadata.')
        }
        setIsProcessing(false)
    }

    const downloadSafeCopy = () => {
        if (!preview) return

        const img = new Image()
        img.src = preview
        img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.width
            canvas.height = img.height
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0)

            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `safe_${file.name}`
                a.click()
                URL.revokeObjectURL(url)
            }, file.type)
        }
    }

    // Helper to extract GPS
    const getGpsLocation = () => {
        if (!tags || !tags.GPSLatitude || !tags.GPSLongitude) return null

        // ExifReader returns arrays for some descriptions
        const lat = tags.GPSLatitude.description
        const lng = tags.GPSLongitude.description

        return { lat, lng }
    }

    const gps = getGpsLocation()

    // Common important tags to surface to top
    const commonTags = [
        { label: 'Camera Make', key: 'Make', icon: Camera },
        { label: 'Camera Model', key: 'Model', icon: Camera },
        { label: 'Software', key: 'Software', icon: Info },
        { label: 'Date Taken', key: 'DateTimeOriginal', icon: Info },
        { label: 'Shutter Speed', key: 'ExposureTime', icon: Camera },
        { label: 'Aperture', key: 'FNumber', icon: Camera },
        { label: 'ISO', key: 'ISOSpeedRatings', icon: Camera },
        { label: 'Flash', key: 'Flash', icon: Camera },
    ]

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient">EXIF Metadata Viewer</h2>
                <p style={{ color: 'var(--text-muted)' }}>Analyze hidden image data and create privacy-safe copies.</p>
            </div>

            <div className="responsive-stack" style={{ display: 'flex', gap: 'var(--space-lg)', flexDirection: 'row' }}>

                {/* Left: Input & Preview */}
                <div style={{ flex: 1, minWidth: '300px' }}>

                    {!file ? (
                        <div
                            className="drop-zone"
                            style={{
                                border: '2px dashed var(--border)',
                                padding: '60px 40px',
                                textAlign: 'center',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                background: 'var(--bg-panel)',
                                height: '100%',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            onDragOver={e => e.preventDefault()}
                            onDrop={e => { e.preventDefault(); handleFile(e) }}
                            onClick={() => document.getElementById('exif-input').click()}
                        >
                            <input
                                id="exif-input"
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={handleFile}
                            />
                            <Upload size={48} style={{ color: 'var(--primary)', marginBottom: 16 }} />
                            <div style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: 8 }}>Drop an image here</div>
                            <div style={{ color: 'var(--text-dim)' }}>JPG, PNG, HEIC, TIFF, WEBP</div>
                        </div>
                    ) : (
                        <div className="glass-panel" style={{ padding: 'var(--space-md)', height: 'fit-content' }}>
                            <img
                                src={preview}
                                alt="Preview"
                                style={{
                                    width: '100%',
                                    borderRadius: 'var(--radius-sm)',
                                    marginBottom: 'var(--space-md)',
                                    display: 'block',
                                    maxHeight: '400px',
                                    objectFit: 'contain',
                                    background: '#000'
                                }}
                            />

                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, maxWidth: '200px' }}>
                                    {file.name}
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                                    {(file.size / 1024 / 1024).toFixed(2)} MB
                                </div>
                            </div>

                            <button
                                onClick={downloadSafeCopy}
                                className="btn-primary"
                                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px' }}
                            >
                                <ShieldCheck size={18} /> Download Safe Copy
                            </button>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 8, textAlign: 'center', lineHeight: 1.4 }}>
                                This re-encodes the image, stripping all metadata (GPS, Camera info) for privacy.
                            </div>

                            <button
                                onClick={() => { setFile(null); setTags(null); setPreview(null); }}
                                style={{
                                    width: '100%', marginTop: 12, padding: 8, background: 'transparent',
                                    color: 'var(--text-muted)', border: 'none', cursor: 'pointer'
                                }}
                            >
                                Analyze Another
                            </button>
                        </div>
                    )}
                </div>

                {/* Right: Metadata */}
                <div style={{ flex: 2, minWidth: '300px' }}>
                    {tags ? (
                        <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                                <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Image Data</h3>
                            </div>

                            {/* GPS Alert */}
                            {gps ? (
                                <div style={{
                                    margin: '16px 24px',
                                    padding: '16px',
                                    background: 'rgba(239, 68, 68, 0.1)',
                                    border: '1px solid rgba(239, 68, 68, 0.2)',
                                    borderRadius: 'var(--radius-md)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 16
                                }}>
                                    <div style={{ background: '#ef4444', padding: 8, borderRadius: '50%', color: '#fff' }}>
                                        <MapPin size={20} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontWeight: 600, color: '#fca5a5' }}>GPS Location Found!</div>
                                        <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)' }}>
                                            {gps.lat}, {gps.lng}
                                        </div>
                                    </div>
                                    <a
                                        href={`https://www.google.com/maps/search/?api=1&query=${gps.lat},${gps.lng}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{
                                            padding: '8px 16px', background: '#ef4444', color: '#fff',
                                            textDecoration: 'none', borderRadius: 6, fontSize: '0.9rem', fontWeight: 500
                                        }}
                                    >
                                        View Map
                                    </a>
                                </div>
                            ) : (
                                <div style={{ margin: '16px 24px', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', borderRadius: 'var(--radius-md)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <ShieldCheck size={16} /> No GPS location data found.
                                </div>
                            )}

                            {/* Info Grid */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, padding: '0 24px 24px 24px' }}>
                                {commonTags.map(tag => {
                                    const value = tags[tag.key]?.description
                                    if (!value) return null
                                    return (
                                        <div key={tag.key} style={{ background: 'var(--bg-app)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: 4 }}>
                                                <tag.icon size={12} /> {tag.label}
                                            </div>
                                            <div style={{ fontWeight: 500, wordBreak: 'break-word' }}>{value}</div>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Full Table */}
                            <div style={{ padding: '0 24px 24px 24px' }}>
                                <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 12, color: 'var(--text-dim)' }}>ALL TAGS</div>
                                <div style={{ background: 'var(--bg-app)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                        <tbody>
                                            {Object.entries(tags).filter(([k]) => k !== 'MakerNote' && k !== 'UserComment').map(([key, value], i) => (
                                                <tr key={key} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                                                    <td style={{ padding: '8px 12px', color: 'var(--text-muted)', width: '40%' }}>{key}</td>
                                                    <td style={{ padding: '8px 12px', wordBreak: 'break-all' }}>{value.description?.substring(0, 100) || String(value.value).substring(0, 100)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="glass-panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-dim)', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
                            <ImageIcon size={48} style={{ opacity: 0.2 }} />
                            <div>Upload an image to inspect its metadata</div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                @media (max-width: 768px) {
                    .responsive-stack { flexDirection: column !important; }
                }
            `}</style>
        </div>
    )
}
