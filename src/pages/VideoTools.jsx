import React, { useState, useEffect, useRef } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { Upload, Play, Pause, Scissors, Crop, Download, X, Film, AlertCircle } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useEscape } from '../hooks/useEscape'

export default function VideoTools() {
    useDocumentTitle('Video Tools')

    // FFmpeg state
    const [loaded, setLoaded] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const ffmpegRef = useRef(new FFmpeg())
    const [message, setMessage] = useState(null)

    // Video state
    const [videoFile, setVideoFile] = useState(null)
    const [videoURL, setVideoURL] = useState(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [duration, setDuration] = useState(0)
    const [currentTime, setCurrentTime] = useState(0)
    const videoRef = useRef(null)

    // Editor state
    const [trimRange, setTrimRange] = useState([0, 0])
    const [crop, setCrop] = useState(null) // { x, y, width, height }
    const [isCropping, setIsCropping] = useState(false)
    const [exportFormat, setExportFormat] = useState('mp4')
    const [isProcessing, setIsProcessing] = useState(false)

    useEscape(() => {
        if (isCropping) {
            setIsCropping(false)
            setCrop(null)
        }
    })

    // Config
    const loadFFmpeg = async () => {
        setIsLoading(true)
        const origin = window.location.origin
        const ffmpeg = ffmpegRef.current
        ffmpeg.on('log', ({ message }) => {
            console.log(message)
            setMessage(message)
        })
        try {
            const coreURL = await toBlobURL(`${origin}/ffmpeg/ffmpeg-core.js`, 'text/javascript')
            const wasmURL = await toBlobURL(`${origin}/ffmpeg/ffmpeg-core.wasm`, 'application/wasm')
            await ffmpeg.load({
                coreURL,
                wasmURL,
                workerURL: coreURL, // single-threaded; avoids 404 on missing .worker.js
            })
            setLoaded(true)
        } catch (error) {
            console.error('FFmpeg load failed:', error)
            setMessage('Failed to load FFmpeg. Check console.')
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        loadFFmpeg()
    }, [])

    // Video Handlers
    const handleFileUpload = (e) => {
        const file = e.target.files[0]
        if (file) {
            setVideoFile(file)
            setVideoURL(URL.createObjectURL(file))
            // Reset state
            setCrop(null)
            setIsCropping(false)
            setTrimRange([0, 0])
        }
    }

    const onLoadedMetadata = () => {
        if (videoRef.current) {
            const videoDuration = videoRef.current.duration
            setDuration(videoDuration)
            setTrimRange([0, videoDuration])
        }
    }

    const onTimeUpdate = () => {
        if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime)
        }
    }

    const togglePlay = () => {
        if (videoRef.current) {
            if (isPlaying) videoRef.current.pause()
            else videoRef.current.play()
            setIsPlaying(!isPlaying)
        }
    }

    // Export Logic
    const handleExport = async () => {
        if (!loaded) return
        setIsProcessing(true)

        // Reload FFmpeg to clear WASM memory state from any previous run
        setLoaded(false)
        const ffmpeg = ffmpegRef.current
        ffmpeg.terminate()
        await loadFFmpeg()
        setIsProcessing(true) // loadFFmpeg sets isLoading, reset

        try {
            // Write with original extension so FFmpeg detects format correctly
            const ext = videoFile.name.split('.').pop() || 'mp4'
            const inputName = `input.${ext}`
            await ffmpeg.writeFile(inputName, await fetchFile(videoFile))

            const outputName = `output.${exportFormat}`
            const hasTrimStart = trimRange[0] > 0
            const hasTrimEnd = trimRange[1] < duration

            // Build crop filter if active
            let cropFilter = null
            if (crop) {
                const videoEl = videoRef.current
                const scaleX = videoEl.videoWidth / videoEl.clientWidth
                const scaleY = videoEl.videoHeight / videoEl.clientHeight
                const realX = Math.round(crop.x * scaleX)
                const realY = Math.round(crop.y * scaleY)
                const realW = Math.round(crop.width * scaleX)
                const realH = Math.round(crop.height * scaleY)
                cropFilter = `crop=${realW}:${realH}:${realX}:${realY}`
            }

            let command = []

            if (exportFormat === 'gif') {
                // GIF: always needs encoding — no stream copy possible
                if (hasTrimStart) command.push('-ss', trimRange[0].toString())
                command.push('-i', inputName)
                if (hasTrimEnd) command.push('-t', (trimRange[1] - trimRange[0]).toString())
                const gifBase = cropFilter ? `${cropFilter},` : ''
                command.push(
                    '-filter_complex',
                    `[0:v]${gifBase}fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
                    '-loop', '0',
                    outputName
                )

            } else if (exportFormat === 'webm') {
                // WebM always needs re-encoding (VP8+Vorbis) — can't copy H.264/AAC into WebM
                if (hasTrimStart) command.push('-ss', trimRange[0].toString())
                command.push('-i', inputName)
                if (hasTrimEnd) command.push('-t', (trimRange[1] - trimRange[0]).toString())
                if (cropFilter) command.push('-vf', cropFilter)
                command.push('-c:v', 'libvpx', '-crf', '10', '-b:v', '1M', '-c:a', 'libvorbis', outputName)

            } else if (cropFilter) {
                // MP4 with crop — must re-encode video
                if (hasTrimStart) command.push('-ss', trimRange[0].toString())
                command.push('-i', inputName)
                if (hasTrimEnd) command.push('-t', (trimRange[1] - trimRange[0]).toString())
                command.push('-vf', cropFilter, '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', outputName)

            } else {
                // MP4 trim only — stream copy (no codec, no WASM memory pressure)
                if (hasTrimStart) command.push('-ss', trimRange[0].toString())
                command.push('-i', inputName)
                if (hasTrimEnd) command.push('-t', (trimRange[1] - trimRange[0]).toString())
                command.push('-c', 'copy', outputName)
            }

            setMessage('Processing...')
            await ffmpeg.exec(command)

            const data = await ffmpeg.readFile(outputName)
            const mimeType = exportFormat === 'gif' ? 'image/gif' : `video/${exportFormat}`
            const url = URL.createObjectURL(new Blob([data], { type: mimeType }))

            const a = document.createElement('a')
            a.href = url
            a.download = outputName
            a.click()
            URL.revokeObjectURL(url)
            setMessage('Export complete!')
        } catch (error) {
            console.error('Export failed:', error)
            setMessage(`Export failed: ${error?.message ?? error}`)
        } finally {
            setIsProcessing(false)
        }
    }

    return (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 20px' }}>
            <div style={{ textAlign: 'center', marginBottom: 24, padding: '40px 0' }}>
                <h2 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: 12 }}>Video Studio</h2>
                <div style={{ color: 'var(--text-muted)' }}>
                    {loaded ? 'Ready to process' : isLoading ? 'Loading Core Engine...' : 'Engine Offline'}
                </div>
            </div>

            {!videoFile ? (
                <div
                    className="glass-panel"
                    style={{
                        padding: 60,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 20,
                        border: '2px dashed var(--border)',
                        cursor: 'pointer'
                    }}
                    onClick={() => document.getElementById('file-upload').click()}
                >
                    <div style={{
                        width: 80, height: 80, borderRadius: '50%',
                        background: 'rgba(59, 130, 246, 0.1)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#3b82f6'
                    }}>
                        <Upload size={40} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                        <h3 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Click to Upload Video</h3>
                        <p style={{ color: 'var(--text-dim)' }}>Drag & drop or select a file</p>
                    </div>
                    <input
                        id="file-upload"
                        type="file"
                        accept="video/*"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                    />
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 350px', gap: 24, alignItems: 'start' }}>
                    {/* Left Column: Preview */}
                    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ position: 'relative', background: '#000', aspectRatio: '16/9' }}>
                            <video
                                ref={videoRef}
                                src={videoURL}
                                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                                onLoadedMetadata={onLoadedMetadata}
                                onTimeUpdate={onTimeUpdate}
                                onClick={togglePlay}
                            />
                            {/* Overlay Controls if Cropping */}
                            {isCropping && (
                                <div style={{
                                    position: 'absolute',
                                    inset: 0,
                                    border: '2px solid #ef4444',
                                    pointerEvents: 'none'
                                }}>
                                    <div style={{
                                        position: 'absolute',
                                        top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                                        background: 'rgba(0,0,0,0.5)', padding: '4px 8px', borderRadius: 4,
                                        color: '#fff', fontSize: '0.8rem'
                                    }}>
                                        Crop Mode Active (Preview Only)
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Playback Controls */}
                        <div style={{ padding: 16, borderTop: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                <button
                                    onClick={togglePlay}
                                    style={{
                                        background: 'none', border: 'none', color: 'var(--text-main)',
                                        cursor: 'pointer', padding: 8, borderRadius: '50%',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                    }}
                                    className="hover-bg"
                                >
                                    {isPlaying ? <Pause size={24} /> : <Play size={24} />}
                                </button>

                                <input
                                    type="range"
                                    min="0"
                                    max={duration}
                                    value={currentTime}
                                    step="0.1"
                                    onChange={(e) => {
                                        const time = parseFloat(e.target.value)
                                        videoRef.current.currentTime = time
                                        setCurrentTime(time)
                                    }}
                                    style={{ flex: 1 }}
                                />

                                <span style={{ fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)' }}>
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Tools */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div className="glass-panel" style={{ padding: 20 }}>
                            <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Scissors size={18} /> Tools
                            </h3>

                            {/* Trimming */}
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: 8, color: 'var(--text-dim)' }}>
                                    Trim Video
                                </label>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>Start (sec)</div>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <input
                                                type="number"
                                                value={trimRange[0]}
                                                onChange={(e) => setTrimRange([parseFloat(e.target.value), trimRange[1]])}
                                                style={{ width: '100%', padding: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)' }}
                                            />
                                            <button
                                                onClick={() => setTrimRange([currentTime, trimRange[1]])}
                                                title="Set to current time"
                                                style={{ padding: '0 8px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)', cursor: 'pointer' }}
                                            >
                                                Set
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>End (sec)</div>
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            <input
                                                type="number"
                                                value={trimRange[1]}
                                                onChange={(e) => setTrimRange([trimRange[0], parseFloat(e.target.value)])}
                                                style={{ width: '100%', padding: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)' }}
                                            />
                                            <button
                                                onClick={() => setTrimRange([trimRange[0], currentTime])}
                                                title="Set to current time"
                                                style={{ padding: '0 8px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)', cursor: 'pointer' }}
                                            >
                                                Set
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Cropping */}
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: 8, color: 'var(--text-dim)' }}>
                                    Crop
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                                    <button
                                        onClick={() => {
                                            if (!videoRef.current) return
                                            const { videoWidth, videoHeight } = videoRef.current
                                            const size = Math.min(videoWidth, videoHeight)
                                            setCrop({
                                                x: (videoWidth - size) / 2,
                                                y: (videoHeight - size) / 2,
                                                width: size,
                                                height: size
                                            })
                                            setIsCropping(true)
                                        }}
                                        style={{ padding: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)', cursor: 'pointer' }}
                                    >
                                        Square (1:1)
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (!videoRef.current) return
                                            const { videoWidth, videoHeight } = videoRef.current
                                            // 9:16
                                            const width = Math.min(videoWidth, videoHeight * 9 / 16)
                                            const height = width * 16 / 9
                                            setCrop({
                                                x: (videoWidth - width) / 2,
                                                y: (videoHeight - height) / 2,
                                                width,
                                                height
                                            })
                                            setIsCropping(true)
                                        }}
                                        style={{ padding: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)', cursor: 'pointer' }}
                                    >
                                        Portrait (9:16)
                                    </button>
                                </div>

                                {isCropping && crop && (
                                    <div style={{ marginTop: 8 }}>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                                            Active Crop: {Math.round(crop.width)}x{Math.round(crop.height)}
                                        </div>
                                        <button
                                            onClick={() => { setIsCropping(false); setCrop(null); }}
                                            style={{
                                                width: '100%', padding: 8,
                                                background: 'rgba(239, 68, 68, 0.1)',
                                                border: '1px solid #ef4444',
                                                borderRadius: 6,
                                                color: '#ef4444',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem'
                                            }}
                                        >
                                            <X size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} /> Clear Crop
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="glass-panel" style={{ padding: 20 }}>
                            <h3 style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Download size={18} /> Export
                            </h3>

                            <select
                                value={exportFormat}
                                onChange={(e) => setExportFormat(e.target.value)}
                                style={{
                                    width: '100%', padding: 10, marginBottom: 16,
                                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                                    borderRadius: 6, color: 'var(--text-main)'
                                }}
                            >
                                <option value="mp4">MP4 (H.264)</option>
                                <option value="webm">WebM (VP9)</option>
                                <option value="gif">Animated GIF</option>
                            </select>

                            <button
                                onClick={handleExport}
                                disabled={isProcessing || !loaded}
                                style={{
                                    width: '100%', padding: 12,
                                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                                    border: 'none', borderRadius: 8,
                                    color: 'white', fontWeight: 600,
                                    cursor: isProcessing ? 'not-allowed' : 'pointer',
                                    opacity: isProcessing ? 0.7 : 1
                                }}
                            >
                                {isProcessing ? 'Processing...' : 'Export Video'}
                            </button>

                            {message && (
                                <div style={{ marginTop: 12, padding: 8, borderRadius: 4, background: 'rgba(0,0,0,0.2)', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                    {message}
                                </div>
                            )}
                        </div>

                        <button
                            onClick={() => setVideoFile(null)}
                            style={{
                                marginTop: 8, width: '100%', padding: 10,
                                background: 'transparent', border: '1px solid var(--border)',
                                borderRadius: 6, color: 'var(--text-dim)',
                                cursor: 'pointer'
                            }}
                        >
                            <X size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Clear Project
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function formatTime(seconds) {
    if (!seconds) return "00:00"
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}
