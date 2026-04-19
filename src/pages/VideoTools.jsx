import React, { useState, useEffect, useRef } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import ReactCrop from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { Upload, Play, Pause, Scissors, Crop, Download, X, Film, VolumeX, FastForward, Maximize, Settings, Camera, Music, Type } from 'lucide-react'
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
    const [crop, setCrop] = useState() // { x, y, width, height }
    const [aspect, setAspect] = useState(undefined)
    const [isCropping, setIsCropping] = useState(false)
    const [exportFormat, setExportFormat] = useState('mp4')
    const [isProcessing, setIsProcessing] = useState(false)

    // New processing state
    const [muteAudio, setMuteAudio] = useState(false)
    const [playbackSpeed, setPlaybackSpeed] = useState(1)
    const [downscale, setDownscale] = useState('original')

    // Phase 2 processing state
    const [gifFps, setGifFps] = useState(15)
    const [gifWidth, setGifWidth] = useState(480)
    const [fadeTarget, setFadeTarget] = useState('none') // 'in', 'out', 'both', 'none'
    const [customAudioFile, setCustomAudioFile] = useState(null)

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
            setMuteAudio(false)
            setPlaybackSpeed(1)
            setDownscale('original')
            setFadeTarget('none')
            setCustomAudioFile(null)
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

    const captureSnapshot = () => {
        if (!videoRef.current) return
        const canvas = document.createElement('canvas')
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        const ctx = canvas.getContext('2d')
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height)

        canvas.toBlob((blob) => {
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            // Include formatted timestamp in name
            const ms = Math.floor((videoRef.current.currentTime % 1) * 1000).toString().padStart(3, '0')
            const safeTime = formatTime(videoRef.current.currentTime).replace(':', '-')
            a.download = `snapshot_${safeTime}-${ms}.jpg`
            a.click()
            URL.revokeObjectURL(url)
        }, 'image/jpeg', 0.95)
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

            let audioInputName = null
            if (customAudioFile && !muteAudio && exportFormat !== 'gif' && exportFormat !== 'mp3') {
                const aExt = customAudioFile.name.split('.').pop() || 'mp3'
                audioInputName = `audio.${aExt}`
                await ffmpeg.writeFile(audioInputName, await fetchFile(customAudioFile))
            }

            const outputName = `output.${exportFormat}`
            const hasTrimStart = trimRange[0] > 0
            const hasTrimEnd = trimRange[1] < duration

            let videoFilters = []
            let audioFilters = []

            if (crop && crop.width && crop.height) {
                const videoEl = videoRef.current
                const scaleX = videoEl.videoWidth / videoEl.clientWidth
                const scaleY = videoEl.videoHeight / videoEl.clientHeight
                const realX = Math.floor((crop.x * scaleX) / 2) * 2
                const realY = Math.floor((crop.y * scaleY) / 2) * 2
                const realW = Math.floor((crop.width * scaleX) / 2) * 2
                const realH = Math.floor((crop.height * scaleY) / 2) * 2
                videoFilters.push(`crop=${realW}:${realH}:${realX}:${realY}`)
            }

            if (downscale !== 'original') {
                videoFilters.push(`scale=-2:${downscale}`) // -2 ensures width is divisible by 2 for h264
            }

            if (playbackSpeed !== 1) {
                videoFilters.push(`setpts=${1 / playbackSpeed}*PTS`)
                audioFilters.push(`atempo=${playbackSpeed}`)
            }

            if (fadeTarget !== 'none') {
                const fdur = 2 // 2 second fade
                if (fadeTarget === 'in' || fadeTarget === 'both') {
                    videoFilters.push(`fade=t=in:st=0:d=${fdur}`)
                    audioFilters.push(`afade=t=in:st=0:d=${fdur}`)
                }
                if (fadeTarget === 'out' || fadeTarget === 'both') {
                    const durationScale = hasTrimEnd ? (trimRange[1] - trimRange[0]) : duration
                    const fadeStart = Math.max(0, durationScale - fdur)
                    videoFilters.push(`fade=t=out:st=${fadeStart}:d=${fdur}`)
                    audioFilters.push(`afade=t=out:st=${fadeStart}:d=${fdur}`)
                }
            }

            const vfArg = videoFilters.length > 0 ? videoFilters.join(',') : null
            const afArg = audioFilters.length > 0 ? audioFilters.join(',') : null

            let command = []

            if (exportFormat === 'mp3') {
                // Audio Extraction Only
                if (hasTrimStart) command.push('-ss', trimRange[0].toString())
                command.push('-i', inputName)
                if (hasTrimEnd) command.push('-t', (trimRange[1] - trimRange[0]).toString())
                if (afArg) command.push('-af', afArg)
                command.push('-vn', '-c:a', 'libmp3lame', '-q:a', '2', outputName)
            } else if (exportFormat === 'gif') {
                // GIF: always needs encoding
                if (hasTrimStart) command.push('-ss', trimRange[0].toString())
                command.push('-i', inputName)
                if (hasTrimEnd) command.push('-t', (trimRange[1] - trimRange[0]).toString())

                const preFilters = videoFilters.length > 0 ? `${videoFilters.join(',')},` : ''
                command.push(
                    '-filter_complex',
                    `[0:v]${preFilters}fps=${gifFps},scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
                    '-loop', '0',
                    outputName
                )
            } else {
                // WebM or MP4
                if (hasTrimStart) command.push('-ss', trimRange[0].toString())
                command.push('-i', inputName)

                if (audioInputName) {
                    command.push('-i', audioInputName)
                }

                if (hasTrimEnd) command.push('-t', (trimRange[1] - trimRange[0]).toString())

                if (vfArg || exportFormat === 'webm' || audioInputName) {
                    // Requires re-encoding
                    if (vfArg) command.push('-vf', vfArg)

                    if (audioInputName) {
                        // Map video from input 0, map audio from input 1
                        command.push('-map', '0:v:0', '-map', '1:a:0')
                        // We must explicitly re-encode audio if we filter it, or we can copy if no filter
                        if (afArg) command.push('-af', afArg)

                        // Handle shortest if audio is longer than video
                        command.push('-shortest')
                    } else if (muteAudio) {
                        command.push('-an')
                    } else if (afArg) {
                        command.push('-af', afArg)
                    }

                    if (exportFormat === 'webm') {
                        command.push('-c:v', 'libvpx', '-crf', '10', '-b:v', '1M')
                        if (!muteAudio) command.push('-c:a', 'libvorbis')
                    } else {
                        command.push('-c:v', 'libx264', '-crf', '23')
                        if (!muteAudio && !afArg && !audioInputName) command.push('-c:a', 'aac') // default encode if we filtered audio or replaced it but didn't specify
                        if (audioInputName && !afArg) command.push('-c:a', 'aac')
                    }
                } else {
                    // pure copy possible for MP4? 
                    // Wait, if no crop/scale/speed/webm, we can just copy
                    if (muteAudio) {
                        command.push('-an')
                        command.push('-c:v', 'copy')
                    } else {
                        command.push('-c', 'copy')
                    }
                }
                command.push(outputName)
            }

            setMessage('Processing...')
            await ffmpeg.exec(command)

            const data = await ffmpeg.readFile(outputName)
            const mimeType = exportFormat === 'gif' ? 'image/gif' : exportFormat === 'mp3' ? 'audio/mpeg' : `video/${exportFormat}`
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
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
                    {/* Left Column: Preview */}
                    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', flex: '1 1 500px', minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#000', height: '100%', minHeight: '300px' }}>
                            {isCropping ? (
                                <ReactCrop crop={crop} onChange={c => setCrop(c)} aspect={aspect}>
                                    <video
                                        ref={videoRef}
                                        src={videoURL}
                                        style={{ maxHeight: '600px', maxWidth: '100%', display: 'block' }}
                                        onLoadedMetadata={onLoadedMetadata}
                                        onTimeUpdate={onTimeUpdate}
                                    />
                                </ReactCrop>
                            ) : (
                                <video
                                    ref={videoRef}
                                    src={videoURL}
                                    style={{ maxHeight: '600px', maxWidth: '100%', display: 'block', cursor: 'pointer' }}
                                    onLoadedMetadata={onLoadedMetadata}
                                    onTimeUpdate={onTimeUpdate}
                                    onClick={togglePlay}
                                />
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

                                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                                    <button
                                        onClick={captureSnapshot}
                                        title="Capture Frame (Snapshot)"
                                        style={{
                                            background: 'none', border: 'none', color: 'var(--text-main)',
                                            cursor: 'pointer', padding: 8, borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}
                                        className="hover-bg"
                                    >
                                        <Camera size={20} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Tools */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: '1 1 300px', minWidth: 0 }}>
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
                                <div style={{ display: 'grid', gridTemplateColumns: 'min-content 1fr 1fr', gap: 8, marginBottom: 8 }}>
                                    <button
                                        onClick={() => {
                                            setIsCropping(!isCropping)
                                            if (isCropping) setCrop(undefined)
                                        }}
                                        style={{ padding: '8px 16px', background: isCropping ? 'var(--primary)' : 'var(--bg-input)', border: '1px solid var(--primary)', borderRadius: 6, color: isCropping ? '#fff' : 'var(--primary)', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
                                    >
                                        <Crop size={16} /> {isCropping ? 'Active' : '+ Crop'}
                                    </button>
                                    
                                    {isCropping && (
                                        <>
                                            <button
                                                onClick={() => setAspect(undefined)}
                                                style={{ padding: 8, background: aspect === undefined ? 'rgba(255,255,255,0.1)' : 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)', cursor: 'pointer' }}
                                            >
                                                Freeform
                                            </button>
                                            <button
                                                onClick={() => setAspect(1)}
                                                style={{ padding: 8, background: aspect === 1 ? 'rgba(255,255,255,0.1)' : 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)', cursor: 'pointer' }}
                                            >
                                                Square (1:1)
                                            </button>
                                        </>
                                    )}
                                </div>

                                {isCropping && crop && (
                                    <div style={{ marginTop: 8 }}>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 8 }}>
                                            Drag on the video to define crop region.
                                        </div>
                                        <button
                                            onClick={() => { setIsCropping(false); setCrop(undefined); setAspect(undefined); }}
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

                            {/* Advanced video processing */}
                            <div style={{ marginBottom: 20 }}>
                                <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: 8, color: 'var(--text-dim)' }}>
                                    Processing
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    <div>
                                        <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>Speed</div>
                                        <select
                                            value={playbackSpeed}
                                            onChange={e => setPlaybackSpeed(parseFloat(e.target.value))}
                                            style={{ width: '100%', padding: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)' }}
                                        >
                                            <option value={0.5}>0.5x Slow</option>
                                            <option value={0.75}>0.75x</option>
                                            <option value={1}>1x Normal</option>
                                            <option value={1.5}>1.5x Fast</option>
                                            <option value={2}>2x Faster</option>
                                        </select>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>Mute Audio</div>
                                        <label style={{ display: 'flex', alignItems: 'center', height: '35px', gap: 8, padding: '0 8px', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', opacity: customAudioFile ? 0.3 : 1 }}>
                                            <input
                                                type="checkbox"
                                                checked={muteAudio}
                                                disabled={customAudioFile !== null}
                                                onChange={e => setMuteAudio(e.target.checked)}
                                            />
                                            <span style={{ fontSize: '0.85rem' }}>Muted</span>
                                        </label>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>Replace Audio</div>
                                        <button
                                            onClick={() => document.getElementById('audio-upload').click()}
                                            style={{
                                                width: '100%', height: '35px',
                                                background: customAudioFile ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-input)',
                                                border: `1px solid ${customAudioFile ? '#3b82f6' : 'var(--border)'}`,
                                                color: customAudioFile ? '#3b82f6' : 'var(--text-main)',
                                                borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                                overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '0 8px'
                                            }}
                                            title={customAudioFile ? customAudioFile.name : 'Select Audio'}
                                        >
                                            <Music size={14} style={{ flexShrink: 0 }} />
                                            {customAudioFile ? customAudioFile.name : 'Select MP3/WAV'}
                                        </button>
                                        <input
                                            id="audio-upload"
                                            type="file"
                                            accept="audio/*"
                                            onChange={(e) => setCustomAudioFile(e.target.files[0] || null)}
                                            style={{ display: 'none' }}
                                        />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>Fade Effects (2s)</div>
                                        <select
                                            value={fadeTarget}
                                            onChange={e => setFadeTarget(e.target.value)}
                                            style={{ width: '100%', padding: 8, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)', fontSize: '0.85rem' }}
                                        >
                                            <option value="none">None</option>
                                            <option value="in">Fade In</option>
                                            <option value="out">Fade Out</option>
                                            <option value="both">Fade In + Out</option>
                                        </select>
                                    </div>
                                </div>
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
                                <option value="mp4">MP4 Video (H.264)</option>
                                <option value="webm">WebM Video (VP9)</option>
                                <option value="gif">Animated GIF</option>
                                <option value="mp3">Audio Only (MP3)</option>
                            </select>

                            {exportFormat === 'gif' && (
                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: 8, color: 'var(--text-dim)' }}>
                                        GIF Quality
                                    </label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>Framerate (FPS)</div>
                                            <select
                                                value={gifFps}
                                                onChange={e => setGifFps(parseInt(e.target.value))}
                                                style={{ width: '100%', padding: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)' }}
                                            >
                                                <option value="10">10 FPS (Small)</option>
                                                <option value="15">15 FPS (Standard)</option>
                                                <option value="24">24 FPS (Smooth)</option>
                                                <option value="30">30 FPS (HD)</option>
                                            </select>
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '0.8rem', marginBottom: 4, color: 'var(--text-muted)' }}>Max Width</div>
                                            <select
                                                value={gifWidth}
                                                onChange={e => setGifWidth(parseInt(e.target.value))}
                                                style={{ width: '100%', padding: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)' }}
                                            >
                                                <option value="320">320px (Tiny)</option>
                                                <option value="480">480px (Standard)</option>
                                                <option value="640">640px (Large)</option>
                                                <option value="800">800px (Huge)</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {exportFormat !== 'mp3' && exportFormat !== 'gif' && (
                                <div style={{ marginBottom: 16 }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: 8, color: 'var(--text-dim)' }}>
                                        Downscale Video
                                    </label>
                                    <select
                                        value={downscale}
                                        onChange={e => setDownscale(e.target.value)}
                                        style={{ width: '100%', padding: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-main)' }}
                                    >
                                        <option value="original">Original Resolution</option>
                                        <option value="1080">1080p Max Height</option>
                                        <option value="720">720p Max Height</option>
                                        <option value="480">480p Max Height</option>
                                    </select>
                                </div>
                            )}

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
