import React, { useState } from 'react'
import { PDFDocument, degrees } from 'pdf-lib'
import { Upload, FileText, Download, Trash2, ArrowUp, ArrowDown, RotateCw, Scissors } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function PdfTools() {
    useDocumentTitle('PDF Transformer')
    const [mode, setMode] = useState('merge') // 'merge' | 'modify'
    const [files, setFiles] = useState([])
    const [isProcessing, setIsProcessing] = useState(false)

    // Modify State
    const [activeFile, setActiveFile] = useState(null)
    const [rotation, setRotation] = useState(0)
    const [pageRange, setPageRange] = useState('') // e.g., "1-3, 5"

    // Handlers
    const handleFileUpload = (e) => {
        const newFiles = Array.from(e.target.files).map(f => ({
            id: Math.random().toString(36).substr(2, 9),
            file: f,
            name: f.name,
            size: f.size
        }))

        if (mode === 'merge') {
            setFiles(prev => [...prev, ...newFiles])
        } else {
            // For modify, we only take the first one
            setActiveFile(newFiles[0])
            setRotation(0)
            setPageRange('')
        }
    }

    const removeFile = (id) => {
        setFiles(prev => prev.filter(f => f.id !== id))
    }

    const moveFile = (index, direction) => {
        if (direction === 'up' && index > 0) {
            const newFiles = [...files]
            const temp = newFiles[index]
            newFiles[index] = newFiles[index - 1]
            newFiles[index - 1] = temp
            setFiles(newFiles)
        }
        if (direction === 'down' && index < files.length - 1) {
            const newFiles = [...files]
            const temp = newFiles[index]
            newFiles[index] = newFiles[index + 1]
            newFiles[index + 1] = temp
            setFiles(newFiles)
        }
    }

    // --- OPERATIONS ---

    const mergePdfs = async () => {
        if (files.length === 0) return
        setIsProcessing(true)
        try {
            const mergedPdf = await PDFDocument.create()

            for (const fileObj of files) {
                const arrayBuffer = await fileObj.file.arrayBuffer()
                const pdf = await PDFDocument.load(arrayBuffer)
                const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
                copiedPages.forEach((page) => mergedPdf.addPage(page))
            }

            const pdfBytes = await mergedPdf.save()
            downloadPdf(pdfBytes, 'merged_document.pdf')
        } catch (err) {
            console.error(err)
            alert('Failed to merge PDFs. One might be encrypted or corrupted.')
        }
        setIsProcessing(false)
    }

    const processActiveFile = async () => {
        if (!activeFile) return
        setIsProcessing(true)
        try {
            const arrayBuffer = await activeFile.file.arrayBuffer()
            const pdfDoc = await PDFDocument.load(arrayBuffer)

            // 1. Filter Pages (Split/Extract)
            // If range is provided, we create a NEW doc with only those pages
            // If not, we work on the existing doc (or a copy of it)

            let finalDoc = pdfDoc

            if (pageRange.trim()) {
                const newDoc = await PDFDocument.create()
                const totalPages = pdfDoc.getPageCount()
                const indicesToKeep = parsePageRange(pageRange, totalPages)

                const copiedPages = await newDoc.copyPages(pdfDoc, indicesToKeep)
                copiedPages.forEach(page => newDoc.addPage(page))
                finalDoc = newDoc
            }

            // 2. Rotate Pages (if rotation is set)
            // Note: If we just created a new doc, we rotate its pages. 
            // If we are using the original, we rotate all pages.
            // Current simple logic: Rotate ALL pages in the result.
            if (rotation !== 0) {
                const pages = finalDoc.getPages()
                pages.forEach(page => {
                    const current = page.getRotation().angle
                    page.setRotation(degrees(current + rotation))
                })
            }

            const pdfBytes = await finalDoc.save()
            const prefix = pageRange ? 'extracted' : 'modified'
            downloadPdf(pdfBytes, `${prefix}_${activeFile.name}`)

        } catch (err) {
            console.error(err)
            alert('Operation failed. Check your page ranges.')
        }
        setIsProcessing(false)
    }

    // Helper
    const downloadPdf = (bytes, name) => {
        const blob = new Blob([bytes], { type: 'application/pdf' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = name
        link.click()
    }

    const parsePageRange = (rangeStr, maxPages) => {
        // e.g. "1, 3-5, 8" -> [0, 2, 3, 4, 7] (0-indexed)
        const indices = new Set()
        const parts = rangeStr.split(',')

        parts.forEach(part => {
            const p = part.trim()
            if (p.includes('-')) {
                const [start, end] = p.split('-').map(n => parseInt(n))
                if (!isNaN(start) && !isNaN(end)) {
                    for (let i = start; i <= end; i++) {
                        if (i >= 1 && i <= maxPages) indices.add(i - 1)
                    }
                }
            } else {
                const n = parseInt(p)
                if (!isNaN(n) && n >= 1 && n <= maxPages) {
                    indices.add(n - 1)
                }
            }
        })
        return Array.from(indices).sort((a, b) => a - b)
    }

    return (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient">PDF Transformer</h2>
                <p style={{ color: 'var(--text-muted)' }}>Securely merge, split, and rotate PDFs offline.</p>
            </div>

            {/* Mode Toggle */}
            <div className="glass-panel" style={{ padding: 4, display: 'flex', gap: 4, marginBottom: 'var(--space-lg)' }}>
                <button
                    onClick={() => setMode('merge')}
                    style={{
                        flex: 1,
                        padding: '10px',
                        border: 'none',
                        background: mode === 'merge' ? 'var(--primary)' : 'transparent',
                        color: mode === 'merge' ? '#fff' : 'var(--text-muted)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        fontWeight: 500
                    }}
                >
                    Merge PDFs
                </button>
                <button
                    onClick={() => setMode('modify')}
                    style={{
                        flex: 1,
                        padding: '10px',
                        border: 'none',
                        background: mode === 'modify' ? 'var(--primary)' : 'transparent',
                        color: mode === 'modify' ? '#fff' : 'var(--text-muted)',
                        borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        fontWeight: 500
                    }}
                >
                    Modify (Split/Rotate)
                </button>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-lg)', minHeight: '300px' }}>

                {/* MERGE MODE */}
                {mode === 'merge' && (
                    <>
                        <div
                            className="drop-zone"
                            style={{
                                border: '2px dashed var(--border)',
                                padding: '40px',
                                textAlign: 'center',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                marginBottom: 'var(--space-md)'
                            }}
                            onClick={() => document.getElementById('pdf-merge-input').click()}
                        >
                            <input
                                id="pdf-merge-input"
                                type="file"
                                accept=".pdf"
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleFileUpload}
                            />
                            <Upload size={32} style={{ color: 'var(--primary)', marginBottom: 8 }} />
                            <div style={{ fontWeight: 500 }}>Click to add PDFs</div>
                        </div>

                        {files.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 'var(--space-lg)' }}>
                                {files.map((f, i) => (
                                    <div key={f.id} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '12px',
                                        background: 'var(--bg-app)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid var(--border)'
                                    }}>
                                        <FileText size={18} style={{ color: 'var(--text-dim)', marginRight: 12 }} />
                                        <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {f.name}
                                        </div>
                                        <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', marginRight: 12 }}>
                                            {(f.size / 1024 / 1024).toFixed(2)} MB
                                        </div>

                                        <button onClick={() => moveFile(i, 'up')} disabled={i === 0} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', opacity: i === 0 ? 0.3 : 1 }}>
                                            <ArrowUp size={16} />
                                        </button>
                                        <button onClick={() => moveFile(i, 'down')} disabled={i === files.length - 1} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', opacity: i === files.length - 1 ? 0.3 : 1 }}>
                                            <ArrowDown size={16} />
                                        </button>
                                        <button onClick={() => removeFile(f.id)} style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <button
                            onClick={mergePdfs}
                            disabled={files.length === 0 || isProcessing}
                            style={{
                                width: '100%',
                                padding: '14px',
                                background: 'var(--primary)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                fontSize: '1rem',
                                fontWeight: 600,
                                cursor: files.length === 0 ? 'not-allowed' : 'pointer',
                                opacity: files.length === 0 ? 0.5 : 1,
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: 8
                            }}
                        >
                            {isProcessing ? 'Merging...' : <><Download size={18} /> Merge & Download</>}
                        </button>
                    </>
                )}

                {/* MODIFY MODE */}
                {mode === 'modify' && (
                    <>
                        <div
                            className="drop-zone"
                            style={{
                                border: '2px dashed var(--border)',
                                padding: '40px',
                                textAlign: 'center',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                marginBottom: 'var(--space-md)'
                            }}
                            onClick={() => document.getElementById('pdf-mod-input').click()}
                        >
                            <input
                                id="pdf-mod-input"
                                type="file"
                                accept=".pdf"
                                style={{ display: 'none' }}
                                onChange={handleFileUpload}
                            />
                            {activeFile ? (
                                <div>
                                    <FileText size={48} style={{ color: 'var(--primary)', marginBottom: 8 }} />
                                    <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{activeFile.name}</div>
                                    <div style={{ color: 'var(--text-dim)' }}>Click to replace</div>
                                </div>
                            ) : (
                                <div>
                                    <Scissors size={32} style={{ color: 'var(--primary)', marginBottom: 8 }} />
                                    <div style={{ fontWeight: 500 }}>Click to select a PDF</div>
                                </div>
                            )}
                        </div>

                        {activeFile && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>

                                {/* Rotate Card */}
                                <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <RotateCw size={16} /> Rotation (All Pages)
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        {[0, 90, 180, 270].map(deg => (
                                            <button
                                                key={deg}
                                                onClick={() => setRotation(deg)}
                                                style={{
                                                    flex: 1,
                                                    padding: '8px',
                                                    background: rotation === deg ? 'var(--primary)' : 'rgba(255,255,255,0.05)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: 4,
                                                    color: rotation === deg ? '#fff' : 'var(--text-main)',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                {deg}°
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Split Card */}
                                <div style={{ padding: '16px', background: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Scissors size={16} /> Extract Pages
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="e.g. 1-3, 5, 8-10 (Leave empty to keep all)"
                                        value={pageRange}
                                        onChange={e => setPageRange(e.target.value)}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            background: 'transparent',
                                            border: '1px solid var(--border)',
                                            borderRadius: 4,
                                            color: 'var(--text-main)'
                                        }}
                                    />
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>
                                        Format: 1, 3-5. Use 1 for first page.
                                    </div>
                                </div>

                                <button
                                    onClick={processActiveFile}
                                    disabled={isProcessing}
                                    style={{
                                        width: '100%',
                                        padding: '14px',
                                        background: 'var(--primary)',
                                        color: '#fff',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: '1rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        gap: 8,
                                        marginTop: 8
                                    }}
                                >
                                    {isProcessing ? 'Processing...' : <><Download size={18} /> Download Modified PDF</>}
                                </button>
                            </div>
                        )}
                    </>
                )}

            </div>
        </div>
    )
}
