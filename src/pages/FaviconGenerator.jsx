import React, { useState, useRef } from 'react'
import { Upload, Download, Package, Check, RefreshCw, X, Layers } from 'lucide-react'
import JSZip from 'jszip'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function FaviconGenerator() {
    useDocumentTitle('Favicon Generator')
    const [file, setFile] = useState(null)
    const [preview, setPreview] = useState(null)
    const [isGenerating, setIsGenerating] = useState(false)
    const [generatedZip, setGeneratedZip] = useState(null)
    const fileInputRef = useRef(null)

    const handleFile = (file) => {
        if (!file) return
        setFile(file)
        setPreview(URL.createObjectURL(file))
        setGeneratedZip(null)
    }

    const resizeImage = async (img, width, height) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, width, height)
        return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    }

    const generateIco = async (img) => {
        // Create 32x32 ICO
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 32
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, 32, 32)

        return new Promise((resolve) => {
            canvas.toBlob(async (pngBlob) => {
                const pngBuffer = await pngBlob.arrayBuffer()
                const size = pngBuffer.byteLength
                const offset = 22

                const buffer = new ArrayBuffer(offset + size)
                const view = new DataView(buffer)

                // Header
                view.setUint16(0, 0, true)
                view.setUint16(2, 1, true)
                view.setUint16(4, 1, true)

                // Directory
                view.setUint8(6, 32) // W
                view.setUint8(7, 32) // H
                view.setUint8(8, 0)
                view.setUint8(9, 0)
                view.setUint16(10, 1, true)
                view.setUint16(12, 32, true)
                view.setUint32(14, size, true)
                view.setUint32(18, offset, true)

                const bytes = new Uint8Array(buffer)
                bytes.set(new Uint8Array(pngBuffer), offset)

                resolve(new Blob([buffer], { type: 'image/x-icon' }))
            }, 'image/png')
        })
    }

    const generate = async () => {
        setIsGenerating(true)
        try {
            const zip = new JSZip()
            const img = new Image()
            img.src = preview
            await new Promise(r => img.onload = r)

            // 1. favicon.ico (32x32)
            const icoBlob = await generateIco(img)
            zip.file('favicon.ico', icoBlob)

            // 2. PNGs
            const sizes = [16, 32, 192, 512]
            for (const size of sizes) {
                const blob = await resizeImage(img, size, size)
                zip.file(`icon-${size}.png`, blob)
            }

            // 3. Apple Touch Icon
            const appleBlob = await resizeImage(img, 180, 180)
            zip.file('apple-touch-icon.png', appleBlob)

            // 4. Manifest
            const manifest = {
                name: "My App",
                short_name: "App",
                icons: [
                    { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
                    { src: "/icon-512.png", type: "image/png", sizes: "512x512" }
                ],
                theme_color: "#ffffff",
                background_color: "#ffffff",
                display: "standalone"
            }
            zip.file('site.webmanifest', JSON.stringify(manifest, null, 2))

            // 5. HTML snippet
            const html = `
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">`.trim()
            zip.file('tags.html', html)

            const content = await zip.generateAsync({ type: 'blob' })
            setGeneratedZip(URL.createObjectURL(content))
        } catch (e) {
            console.error(e)
        } finally {
            setIsGenerating(false)
        }
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
                <h2 className="text-gradient">Favicon Generator</h2>
                <p style={{ color: 'var(--text-muted)' }}>Generate all necessary icons and manifest for your website.</p>
            </div>

            <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>

                    {/* Input Side */}
                    <div style={{ flex: 1, minWidth: '280px' }}>
                        {!file ? (
                            <div
                                onClick={() => fileInputRef.current.click()}
                                style={{
                                    height: '280px',
                                    border: '2px dashed var(--border)',
                                    borderRadius: 'var(--radius-lg)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    cursor: 'pointer',
                                    background: 'rgba(255,255,255,0.02)'
                                }}
                            >
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept="image/*"
                                    onChange={e => handleFile(e.target.files[0])}
                                    style={{ display: 'none' }}
                                />
                                <Upload size={48} style={{ color: 'var(--text-dim)', marginBottom: 16 }} />
                                <p style={{ fontWeight: 500 }}>Upload Master Image</p>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ideally 512x512 PNG</p>
                            </div>
                        ) : (
                            <div style={{ position: 'relative', height: '280px', background: '#000', borderRadius: 'var(--radius-lg)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <img src={preview} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                                <button
                                    onClick={() => setFile(null)}
                                    style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', padding: 6, cursor: 'pointer' }}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Action Side */}
                    <div style={{ flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <div style={{ marginBottom: 'var(--space-md)' }}>
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Package size={20} /> What you get</h3>
                            <ul style={{ paddingLeft: 20, marginTop: 10, color: 'var(--text-muted)', lineHeight: '1.6' }}>
                                <li><strong>favicon.ico</strong> (32x32)</li>
                                <li><strong>apple-touch-icon.png</strong> (180x180)</li>
                                <li><strong>icon-192.png</strong> & <strong>icon-512.png</strong></li>
                                <li><strong>site.webmanifest</strong></li>
                                <li><strong>HTML tags</strong> snippet</li>
                            </ul>
                        </div>

                        <button
                            onClick={generate}
                            disabled={!file || isGenerating}
                            style={{
                                padding: '16px',
                                background: isGenerating ? 'var(--text-muted)' : 'var(--primary)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                fontWeight: 600,
                                cursor: !file || isGenerating ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                                fontSize: '1rem'
                            }}
                        >
                            {isGenerating ? <RefreshCw className="spin" /> : <RefreshCw />}
                            {isGenerating ? 'Generating...' : 'Generate Favicon Package'}
                        </button>

                        {/* Download Box */}
                        {generatedZip && (
                            <div style={{ marginTop: 'var(--space-md)', padding: 'var(--space-md)', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 'var(--radius-md)', animation: 'fadeIn 0.3s' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, color: '#10b981', fontWeight: 600 }}>
                                    <Check size={20} /> Ready!
                                </div>
                                <a
                                    href={generatedZip}
                                    download="favicons.zip"
                                    style={{
                                        display: 'block',
                                        padding: '12px',
                                        background: '#10b981',
                                        color: '#fff',
                                        textAlign: 'center',
                                        borderRadius: 'var(--radius-sm)',
                                        textDecoration: 'none',
                                        fontWeight: 600
                                    }}
                                >
                                    <Download size={16} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Download ZIP
                                </a>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
