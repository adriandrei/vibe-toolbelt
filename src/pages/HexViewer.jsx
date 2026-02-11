import React, { useState, useMemo } from 'react'
import { FileCode, Upload, Download, AlertCircle } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function HexViewer() {
    useDocumentTitle('Hex Viewer')
    const [fileData, setFileData] = useState(null)
    const [fileName, setFileName] = useState('')
    const [offset, setOffset] = useState(0)
    const LINES_PER_PAGE = 32 // 16 bytes per line * 32 lines = 512 bytes per page

    const handleFile = (e) => {
        const file = e.target.files[0]
        if (!file) return
        setFileName(file.name)
        const reader = new FileReader()
        reader.onload = (ev) => {
            setFileData(new Uint8Array(ev.target.result))
            setOffset(0)
        }
        reader.readAsArrayBuffer(file)
    }

    const currentPage = useMemo(() => {
        if (!fileData) return []
        const slice = fileData.slice(offset, offset + (LINES_PER_PAGE * 16))
        return slice
    }, [fileData, offset])

    const totalPages = fileData ? Math.ceil(fileData.length / (LINES_PER_PAGE * 16)) : 0
    const pageNum = Math.floor(offset / (LINES_PER_PAGE * 16)) + 1

    const renderHexLine = (lineIndex, bytes) => {
        const hex = []
        const ascii = []
        const startAddr = offset + (lineIndex * 16)

        for (let i = 0; i < 16; i++) {
            if (i < bytes.length) {
                const b = bytes[i]
                hex.push(b.toString(16).padStart(2, '0').toUpperCase())
                ascii.push(b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')
            } else {
                hex.push('  ')
                ascii.push(' ')
            }
        }

        return (
            <div key={startAddr} style={{ display: 'flex', fontFamily: 'var(--font-mono)', fontSize: '0.9rem', lineHeight: '1.5em' }}>
                {/* Address */}
                <div style={{ width: 80, color: 'var(--primary)', userSelect: 'none', opacity: 0.8 }}>
                    {startAddr.toString(16).padStart(8, '0').toUpperCase()}
                </div>

                {/* Hex */}
                <div style={{ display: 'flex', gap: '0.5em', marginLeft: '1em', color: 'var(--text-main)' }}>
                    <div style={{ width: '13em' }}>{hex.slice(0, 8).join(' ')}</div>
                    <div style={{ width: '13em' }}>{hex.slice(8, 16).join(' ')}</div>
                </div>

                {/* ASCII */}
                <div style={{ marginLeft: '1.5em', borderLeft: '1px solid var(--border)', paddingLeft: '1em', color: 'var(--text-muted)' }}>
                    {ascii.join('')}
                </div>
            </div>
        )
    }

    const renderPage = () => {
        if (!fileData) return null
        const lines = []
        for (let i = 0; i < LINES_PER_PAGE; i++) {
            const start = i * 16
            const lineBytes = currentPage.slice(start, start + 16)
            if (lineBytes.length === 0) break
            lines.push(renderHexLine(i, lineBytes))
        }
        return lines
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>Hex Viewer</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Inspect binary file contents in Hexadecimal and ASCII
                </p>
            </div>

            {/* Upload */}
            <div className="glass-panel" style={{ padding: 'var(--space-lg)', textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                {!fileData ? (
                    <div style={{ padding: 'var(--space-xl)', border: '2px dashed var(--border)', borderRadius: 'var(--radius-md)' }}>
                        <Upload size={40} style={{ marginBottom: 'var(--space-md)', color: 'var(--primary)', opacity: 0.5 }} />
                        <h3 style={{ fontSize: '1.1rem', marginBottom: 'var(--space-sm)' }}>Select a file to inspect</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 'var(--space-lg)' }}>
                            Files are processed entirely in your browser.
                        </p>
                        <input
                            type="file"
                            onChange={handleFile}
                            style={{ display: 'none' }}
                            id="hex-upload"
                        />
                        <label htmlFor="hex-upload" style={{
                            padding: '12px 24px', background: 'var(--primary)', color: '#fff',
                            borderRadius: 'var(--radius-md)', fontWeight: 600, cursor: 'pointer'
                        }}>
                            Choose File
                        </label>
                    </div>
                ) : (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                            <FileCode size={24} color="var(--primary)" />
                            <div style={{ textAlign: 'left' }}>
                                <div style={{ fontWeight: 600 }}>{fileName}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{fileData.length.toLocaleString()} bytes</div>
                            </div>
                        </div>
                        <button onClick={() => setFileData(null)} style={{
                            padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border)', background: 'transparent',
                            color: 'var(--text-muted)', cursor: 'pointer'
                        }}>
                            Close File
                        </button>
                    </div>
                )}
            </div>

            {/* Viewer */}
            {fileData && (
                <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    {/* Toolbar */}
                    <div style={{
                        padding: '8px 16px', background: 'rgba(0,0,0,0.2)', borderBottom: '1px solid var(--border)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Page {pageNum} of {totalPages}
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                            <button
                                disabled={pageNum <= 1}
                                onClick={() => setOffset(Math.max(0, offset - (LINES_PER_PAGE * 16)))}
                                style={{
                                    padding: '4px 12px', opacity: pageNum <= 1 ? 0.3 : 1, cursor: pageNum <= 1 ? 'default' : 'pointer',
                                    background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)'
                                }}
                            >
                                Prev
                            </button>
                            <button
                                disabled={pageNum >= totalPages}
                                onClick={() => setOffset(Math.min((totalPages - 1) * LINES_PER_PAGE * 16, offset + (LINES_PER_PAGE * 16)))}
                                style={{
                                    padding: '4px 12px', opacity: pageNum >= totalPages ? 0.3 : 1, cursor: pageNum >= totalPages ? 'default' : 'pointer',
                                    background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)'
                                }}
                            >
                                Next
                            </button>
                        </div>
                    </div>

                    {/* Grid */}
                    <div style={{ padding: 'var(--space-md)', overflowX: 'auto', background: '#0d1117' }}>
                        {renderPage()}
                    </div>
                </div>
            )}
        </div>
    )
}
