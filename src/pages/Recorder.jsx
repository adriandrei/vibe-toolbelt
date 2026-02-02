import React, { useState, useRef, useEffect } from 'react'
import { Video, Mic, StopCircle, PlayCircle, Download, Monitor, Camera, X } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function Recorder() {
    useDocumentTitle('Screen Recorder')

    // State
    const [isRecording, setIsRecording] = useState(false)
    const [recordedChunks, setRecordedChunks] = useState([])
    const [micEnabled, setMicEnabled] = useState(true)
    const [camEnabled, setCamEnabled] = useState(false)
    const [status, setStatus] = useState('idle') // idle, preparing, recording, finished

    // Refs for Media Management
    const videoPreviewRef = useRef(null)
    const canvasRef = useRef(null)
    const mediaRecorderRef = useRef(null)
    const screenStreamRef = useRef(null)
    const camStreamRef = useRef(null)
    const micStreamRef = useRef(null)
    const animationFrameRef = useRef(null)
    const audioContextRef = useRef(null)

    // Setup & Teardown
    useEffect(() => {
        return () => {
            stopAllStreams()
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
            if (audioContextRef.current) audioContextRef.current.close()
        }
    }, [])

    const stopAllStreams = () => {
        [screenStreamRef, camStreamRef, micStreamRef].forEach(ref => {
            if (ref.current) {
                ref.current.getTracks().forEach(track => track.stop())
                ref.current = null
            }
        })
    }

    const startRecordingFlow = async () => {
        try {
            setStatus('preparing')
            setRecordedChunks([])

            // 1. Get Screen Stream (Video + System Audio)
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 60 },
                audio: true // System audio
            })
            screenStreamRef.current = screenStream

            // Handle user verify stop from browser UI
            screenStream.getVideoTracks()[0].onended = () => {
                stopRecording()
            }

            // 2. Get Mic/Cam Stream (if enabled)
            let camStream = null
            let micStream = null

            if (camEnabled || micEnabled) {
                try {
                    const constraints = {
                        video: camEnabled ? { width: 320, height: 240, facingMode: 'user' } : false,
                        audio: micEnabled
                    }
                    const userStream = await navigator.mediaDevices.getUserMedia(constraints)

                    if (camEnabled) {
                        camStream = new MediaStream(userStream.getVideoTracks())
                        camStreamRef.current = camStream
                    }
                    if (micEnabled) {
                        micStream = new MediaStream(userStream.getAudioTracks())
                        micStreamRef.current = micStream
                    }
                } catch (err) {
                    console.warn('Could not get user media', err)
                    alert('Could not access Camera/Mic. Recording screen only.')
                }
            }

            // 3. Audio Mixing
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
            audioContextRef.current = audioCtx
            const dest = audioCtx.createMediaStreamDestination()

            // Mix System Audio
            if (screenStream.getAudioTracks().length > 0) {
                const sysSource = audioCtx.createMediaStreamSource(screenStream)
                const sysGain = audioCtx.createGain()
                sysGain.gain.value = 1.0
                sysSource.connect(sysGain).connect(dest)
            }

            // Mix Mic Audio
            if (micStreamRef.current) {
                const micSource = audioCtx.createMediaStreamSource(new MediaStream(micStreamRef.current.getTracks()))
                const micGain = audioCtx.createGain()
                micGain.gain.value = 1.0 // Can adjust volume
                micSource.connect(micGain).connect(dest)
            }

            // 4. Video Composition (Canvas)
            const canvas = canvasRef.current
            const ctx = canvas.getContext('2d')
            // Init hidden video elements for reading frames
            const screenVideo = document.createElement('video')
            screenVideo.srcObject = screenStream
            await screenVideo.play()

            let camVideo = null
            if (camStream) {
                camVideo = document.createElement('video')
                camVideo.srcObject = camStream
                await camVideo.play()
            }

            // Set canvas size to match screen
            const { width, height } = screenStream.getVideoTracks()[0].getSettings()
            canvas.width = width || 1920
            canvas.height = height || 1080

            // Animation Loop
            const draw = () => {
                // Draw Screen
                ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height)

                // Draw Cam (Bubble in bottom left)
                if (camVideo) {
                    const camSize = canvas.height * 0.25 // 25% of screen height
                    const padding = 40
                    const x = padding
                    const y = canvas.height - camSize - padding

                    ctx.save()
                    ctx.beginPath()
                    ctx.arc(x + camSize / 2, y + camSize / 2, camSize / 2, 0, Math.PI * 2)
                    ctx.clip()
                    ctx.drawImage(camVideo, x, y, camSize, camSize)
                    ctx.lineWidth = 4
                    ctx.strokeStyle = '#fff'
                    ctx.stroke()
                    ctx.restore()
                }

                animationFrameRef.current = requestAnimationFrame(draw)
            }
            draw()

            // 5. Start Media Recorder
            const mixedAudioTrack = dest.stream.getAudioTracks()[0]
            const canvasStream = canvas.captureStream(60)

            const finalTracks = [...canvasStream.getVideoTracks()]
            if (mixedAudioTrack) finalTracks.push(mixedAudioTrack)

            const finalStream = new MediaStream(finalTracks)

            // Preview locally
            if (videoPreviewRef.current) {
                videoPreviewRef.current.srcObject = finalStream
            }

            const recorder = new MediaRecorder(finalStream, {
                mimeType: 'video/webm;codecs=vp9'
            })

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    setRecordedChunks(prev => [...prev, e.data])
                }
            }

            recorder.start(1000) // Chunk every second
            mediaRecorderRef.current = recorder
            setIsRecording(true)
            setStatus('recording')

        } catch (err) {
            console.error('Recording setup failed', err)
            setStatus('error')
            stopAllStreams()
        }
    }

    const stopRecording = () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop()
        }
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
        stopAllStreams()
        setIsRecording(false)
        setStatus('finished')

        // Clear preview src to allow playing the blob later if needed (though we show download mostly)
        if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null
    }

    const downloadVideo = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        document.body.appendChild(a)
        a.style = 'display: none'
        a.href = url
        a.download = `recording-${new Date().getTime()}.webm`
        a.click()
        window.URL.revokeObjectURL(url)
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient">Screen Recorder</h2>
                <p style={{ color: 'var(--text-muted)' }}>Offline recording with PiP camera support.</p>
            </div>

            {/* Controls */}
            <div className="glass-panel" style={{
                padding: '16px 24px',
                marginBottom: 'var(--space-md)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {!isRecording && status !== 'finished' && (
                        <button
                            onClick={startRecordingFlow}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '12px 32px', fontSize: '1.1rem',
                                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                fontWeight: 700,
                                boxShadow: '0 4px 15px rgba(239, 68, 68, 0.4)',
                                transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(239, 68, 68, 0.5)'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 15px rgba(239, 68, 68, 0.4)'; }}
                        >
                            <div style={{ width: 12, height: 12, background: '#fff', borderRadius: '50%', boxShadow: '0 0 10px rgba(255,255,255,0.8)' }}></div>
                            Start Recording
                        </button>
                    )}

                    {isRecording && (
                        <button
                            onClick={stopRecording}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px', fontSize: '1rem',
                                background: '#ef4444', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
                                cursor: 'pointer', fontWeight: 600,
                                boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)'
                            }}
                        >
                            <StopCircle size={18} fill="currentColor" /> Stop
                        </button>
                    )}

                    {status === 'finished' && (
                        <button
                            onClick={downloadVideo}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px', fontSize: '1rem',
                                background: '#10b981', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
                                cursor: 'pointer', fontWeight: 600,
                                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
                            }}
                        >
                            <Download size={18} /> Download
                        </button>
                    )}
                </div>

                {!isRecording && (
                    <div style={{ display: 'flex', gap: 8, background: 'var(--bg-app)', padding: 4, borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                        <button
                            onClick={() => setMicEnabled(!micEnabled)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                                background: micEnabled ? 'rgba(16, 185, 129, 0.1)' : 'transparent',
                                color: micEnabled ? '#10b981' : 'var(--text-muted)',
                                border: 'none',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: 500
                            }}
                        >
                            <Mic size={16} /> {micEnabled ? 'Mic On' : 'Muted'}
                        </button>
                        <div style={{ width: 1, background: 'var(--border)', margin: '4px 0' }}></div>
                        <button
                            onClick={() => setCamEnabled(!camEnabled)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                                background: camEnabled ? 'rgba(168, 85, 247, 0.1)' : 'transparent',
                                color: camEnabled ? '#a855f7' : 'var(--text-muted)',
                                border: 'none',
                                borderRadius: 'var(--radius-sm)',
                                cursor: 'pointer',
                                fontSize: '0.9rem',
                                fontWeight: 500
                            }}
                        >
                            <Camera size={16} /> {camEnabled ? 'Cam On' : 'Hidden'}
                        </button>
                    </div>
                )}

                {status === 'finished' && (
                    <button
                        onClick={() => { setStatus('idle'); setRecordedChunks([]); }}
                        style={{
                            padding: '10px 16px', background: 'var(--bg-app)', color: 'var(--text-main)',
                            border: '1px solid var(--border)', cursor: 'pointer', borderRadius: 'var(--radius-md)',
                            fontSize: '0.9rem'
                        }}
                    >
                        New Recording
                    </button>
                )}
            </div>

            {/* Preview Area */}
            <div style={{
                position: 'relative',
                aspectRatio: '16/9',
                background: '#09090b',
                borderRadius: 'var(--radius-lg)',
                overflow: 'hidden',
                border: '1px solid var(--border)',
                boxShadow: isRecording ? '0 0 0 2px #ef4444' : '0 20px 50px rgba(0,0,0,0.5)'
            }}>
                {status === 'idle' && (
                    <div style={{
                        position: 'absolute', inset: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexDirection: 'column', gap: 20,
                        background: 'radial-gradient(circle at center, rgba(168, 85, 247, 0.05) 0%, transparent 70%)'
                    }}>
                        <div style={{
                            width: 80, height: 80, borderRadius: '50%',
                            background: 'rgba(255,255,255,0.03)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            border: '1px solid rgba(255,255,255,0.1)'
                        }}>
                            <Monitor size={40} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: 4 }}>Ready to Record</div>
                            <div style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>Click "Start Recording" to choose a screen</div>
                        </div>
                    </div>
                )}

                {/* The Video Preview (Live or Result) */}
                <video
                    ref={videoPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: (status !== 'idle' && status !== 'finished') ? 'block' : 'none' }}
                />

                {/* For finished state, users might want to preview what they recorded before downloading? 
                    Currently we rely on download. We can add blob preview.
                */}
                {status === 'finished' && recordedChunks.length > 0 && (
                    <video
                        src={URL.createObjectURL(new Blob(recordedChunks, { type: 'video/webm' }))}
                        controls
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                )}

                {/* Hidden processing canvas */}
                <canvas ref={canvasRef} style={{ display: 'none' }} />
            </div>

            {status === 'recording' && (
                <div style={{ textAlign: 'center', marginTop: 12, color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                    <div className="pulse-dot" style={{ width: 10, height: 10, background: '#ef4444', borderRadius: '50%' }}></div>
                    Recording in progress...
                </div>
            )}

            <style>{`
                @keyframes pulse {
                    0% { opacity: 0.5; transform: scale(0.9); }
                    50% { opacity: 1; transform: scale(1.1); }
                    100% { opacity: 0.5; transform: scale(0.9); }
                }
                .pulse-dot {
                    animation: pulse 1.5s infinite ease-in-out;
                }
            `}</style>
        </div>
    )
}
