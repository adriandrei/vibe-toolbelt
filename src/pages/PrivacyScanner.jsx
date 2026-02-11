import React, { useState } from 'react'
import ExifReader from 'exifreader'
import { PDFDocument } from 'pdf-lib'
import { ShieldAlert, FileText, Image, File, CheckCircle, AlertTriangle, Upload } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function PrivacyScanner() {
    useDocumentTitle('Privacy File Scanner')
    const [file, setFile] = useState(null)
    const [metadata, setMetadata] = useState([])
    const [warnings, setWarnings] = useState([])
    const [isScanning, setIsScanning] = useState(false)

    const handleFile = async (e) => {
        const f = e.target.files[0]
        if (!f) return
        setFile(f)
        setMetadata([])
        setWarnings([])
        setIsScanning(true)

        try {
            const buffer = await f.arrayBuffer()
            const foundMeta = []
            const foundWarnings = []

            // Basic File Info
            foundMeta.push({ key: 'Filename', value: f.name })
            foundMeta.push({ key: 'Size', value: `${(f.size / 1024).toFixed(2)} KB` })
            foundMeta.push({ key: 'Type', value: f.type || 'Unknown' })
            foundMeta.push({ key: 'Last Modified', value: new Date(f.lastModified).toLocaleString() })

            // Image Handler
            if (f.type.startsWith('image/')) {
                try {
                    const tags = ExifReader.load(buffer)
                    // Check for GPS
                    if (tags['GPSLatitude'] || tags['GPSLongitude']) {
                        foundWarnings.push('GPS Location Data found! Contains precise coordinates.')
                    }
                    // Check for Camera Models / Serial Numbers
                    if (tags['Model']) foundMeta.push({ key: 'Camera Model', value: tags['Model'].description })
                    if (tags['Software']) foundMeta.push({ key: 'Software', value: tags['Software'].description })
                    if (tags['lens'] || tags['LensModel']) foundMeta.push({ key: 'Lens Info', value: tags['LensModel']?.description || 'Detected' })

                    // Add other potentially sensitive tags
                    const sensitiveKeys = ['Artist', 'Copyright', 'OwnerName', 'Serial Number', 'BodySerialNumber']
                    sensitiveKeys.forEach(k => {
                        const tagKey = Object.keys(tags).find(t => t.toLowerCase().includes(k.toLowerCase().replace(' ', '')))
                        if (tagKey && tags[tagKey]) {
                            foundWarnings.push(`Sensitive Tag Found: ${k} (${tags[tagKey].description})`)
                            foundMeta.push({ key: k, value: tags[tagKey].description })
                        }
                    })
                } catch (e) {
                    console.error('EXIF parsing failed', e)
                }
            }

            // PDF Handler
            if (f.type === 'application/pdf') {
                try {
                    const pdfDoc = await PDFDocument.load(buffer)
                    const title = pdfDoc.TITLE
                    const author = pdfDoc.AUTHOR
                    const subject = pdfDoc.SUBJECT
                    const keywords = pdfDoc.KEYWORDS
                    const creator = pdfDoc.CREATOR
                    const producer = pdfDoc.PRODUCER
                    const creationDate = pdfDoc.getCreationDate()
                    const modDate = pdfDoc.getModificationDate()

                    if (author) foundWarnings.push(`Author Metadata Found: "${author}"`)
                    if (creator) foundMeta.push({ key: 'Creator Tool', value: creator })
                    if (producer) foundMeta.push({ key: 'Producer', value: producer })
                    if (title) foundMeta.push({ key: 'Title', value: title })

                    // Check for JS
                    // (Simple check not exhaustive)
                } catch (e) {
                    console.error('PDF parsing failed', e)
                }
            }

            setMetadata(foundMeta)
            setWarnings(foundWarnings)
        } catch (e) {
            console.error(e)
        } finally {
            setIsScanning(false)
        }
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Privacy File Scanner</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Scan files for hidden metadata, location data, and PII without uploading to any server.
                </p>
            </div>

            {/* Upload Zone */}
            <div className="glass-panel" style={{ padding: 'var(--space-xl)', textAlign: 'center', marginBottom: 'var(--space-lg)', border: file ? '1px solid var(--primary)' : '2px dashed var(--border)' }}>
                <input
                    type="file"
                    onChange={handleFile}
                    style={{ display: 'none' }}
                    id="privacy-upload"
                />
                <label htmlFor="privacy-upload" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <ShieldAlert size={48} style={{ marginBottom: 'var(--space-md)', color: file ? 'var(--primary)' : 'var(--text-muted)' }} />
                    <h3 style={{ fontSize: '1.2rem', marginBottom: 'var(--space-sm)' }}>
                        {file ? 'File Selected: ' + file.name : 'Click to Scan File'}
                    </h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        Supports Images (EXIF), PDF Metadata, and more.
                    </p>
                </label>
            </div>

            {/* Results */}
            {file && !isScanning && (
                <div style={{ display: 'grid', gap: 'var(--space-md)' }}>

                    {/* Warnings Section */}
                    {warnings.length > 0 ? (
                        <div className="glass-panel" style={{ padding: 'var(--space-md)', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-md)', color: '#ef4444', fontWeight: 600 }}>
                                <AlertTriangle size={24} />
                                <span>Privacy Risks Found ({warnings.length})</span>
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 20 }}>
                                {warnings.map((w, i) => (
                                    <li key={i} style={{ color: '#fca5a5', marginBottom: 4 }}>{w}</li>
                                ))}
                            </ul>
                        </div>
                    ) : (
                        <div className="glass-panel" style={{ padding: 'var(--space-md)', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <CheckCircle size={24} color="#22c55e" />
                            <span style={{ color: '#22c55e', fontWeight: 600 }}>No obvious privacy risks found.</span>
                        </div>
                    )}

                    {/* Metadata Grid */}
                    <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-md)', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>File Analysis</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 24px' }}>
                            {metadata.map((m, i) => (
                                <React.Fragment key={i}>
                                    <div style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{m.key}:</div>
                                    <div style={{ color: 'var(--text-main)', wordBreak: 'break-all' }}>{m.value}</div>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
