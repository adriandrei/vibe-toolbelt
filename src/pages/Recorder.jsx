import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
    Camera,
    CameraOff,
    Check,
    CircleDot,
    Clapperboard,
    Download,
    Image as ImageIcon,
    Loader2,
    Mic,
    MicOff,
    PictureInPicture2,
    RotateCcw,
    ScreenShare,
    Square,
    Volume2,
    VolumeX,
} from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import StatusBanner from '../components/ui/StatusBanner'
import Modal from '../components/ui/Modal'
import { useToast } from '../components/ToastProvider'
import { usePipeline } from '../contexts/PipelineContext'
import { usePane } from '../contexts/pane'
import { useLeaveGuard } from '../hooks/useLeaveGuard'
import { useObjectURL } from '../hooks/useObjectURL'
import { downloadBlob, formatBytes } from '../utils/download'
import {
    captureFrames,
    compositingMode,
    extensionForType,
    fileTimestamp,
    fixWebmDuration,
    formatClock,
    pickRecorderMimeType,
    recorderBitrate,
    startCompositor,
} from '../utils/media'

const GIF_FPS = 10
const GIF_MAX_FRAMES = 200
const GIF_MAX_WIDTH = 640
const GIF_MAX_SECONDS = GIF_MAX_FRAMES / GIF_FPS

const MESSAGES = {
    busy: 'A recording is in progress. Leaving will stop it and discard the video.',
    unsaved: 'Your recording hasn’t been downloaded or opened in Video Studio. Leave and lose it?',
}

function detectSupport() {
    const hasDisplay = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia)
    const hasRecorder = typeof window !== 'undefined' && typeof window.MediaRecorder === 'function'
    let problem = null
    if (!hasDisplay) {
        problem = window.isSecureContext === false
            ? 'Screen capture needs a secure (https) connection.'
            : 'This browser can’t capture the screen. Phones and tablets don’t support screen recording in the browser; use Chrome, Edge, Firefox or Safari on a computer.'
    } else if (!hasRecorder) {
        problem = 'This browser can’t record video (MediaRecorder isn’t available). Try a recent version of Chrome, Edge, Firefox or Safari.'
    }
    return {
        ok: !problem,
        problem,
        compositing: compositingMode(),
        pip: typeof document !== 'undefined' && document.pictureInPictureEnabled === true
            && typeof HTMLVideoElement !== 'undefined' && 'requestPictureInPicture' in HTMLVideoElement.prototype,
    }
}

function describeStartError(err) {
    const name = err?.name
    const message = err?.message || ''
    if (name === 'NotAllowedError' && /system/i.test(message)) {
        return {
            tone: 'danger',
            title: 'Your system blocked screen capture',
            message: 'Allow your browser to record the screen in your operating system’s privacy settings (on macOS: System Settings → Privacy & Security → Screen & System Audio Recording), restart the browser and try again.',
        }
    }
    if (name === 'NotAllowedError') {
        return {
            tone: 'warning',
            title: 'Screen sharing was cancelled',
            message: 'Press Start recording and choose a screen, window or tab to share. If no dialog appeared, screen capture may be blocked for this site in your browser’s settings.',
        }
    }
    if (name === 'NotFoundError') {
        return { tone: 'danger', title: 'Nothing to capture', message: 'The browser didn’t find a screen, window or tab it can share.' }
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
        return {
            tone: 'danger',
            title: 'The screen couldn’t be captured',
            message: 'Sharing stopped before the recording started, another app is using the screen, or the capture failed. Try again, or pick a different window or tab.',
        }
    }
    if (name === 'NotSupportedError' || name === 'TypeError' || name === 'OverconstrainedError' || name === 'SecurityError') {
        return {
            tone: 'danger',
            title: 'Recording isn’t supported here',
            message: `This browser couldn’t start a screen recording${message ? ` (${message})` : ''}.`,
        }
    }
    return { tone: 'danger', title: 'The recording couldn’t start', message: message || 'Something went wrong while starting the recording. Try again.' }
}

function describeDeviceError(err) {
    switch (err?.name) {
        case 'NotAllowedError': return 'access was denied'
        case 'NotFoundError': return 'no device was found'
        case 'NotReadableError': return 'it’s in use by another app'
        case 'OverconstrainedError': return 'it doesn’t support the requested settings'
        default: return err?.message || 'it couldn’t be opened'
    }
}

// Asks for the microphone and/or camera. If asking for both fails, retries
// each one alone so one missing device doesn't cost the other.
async function openDevices({ mic, camera }) {
    const audio = mic ? { echoCancellation: true, noiseSuppression: true, autoGainControl: true } : false
    const video = camera ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false
    const result = { micTrack: null, cameraTrack: null, failures: [] }
    const take = (stream) => {
        result.micTrack ??= stream.getAudioTracks()[0] ?? null
        result.cameraTrack ??= stream.getVideoTracks()[0] ?? null
    }
    try {
        take(await navigator.mediaDevices.getUserMedia({ audio, video }))
        return result
    } catch (err) {
        if (!(mic && camera)) {
            result.failures.push({ device: mic ? 'microphone' : 'camera', reason: describeDeviceError(err) })
            return result
        }
    }
    for (const [device, constraints] of [['microphone', { audio }], ['camera', { video }]]) {
        try {
            take(await navigator.mediaDevices.getUserMedia(constraints))
        } catch (err) {
            result.failures.push({ device, reason: describeDeviceError(err) })
        }
    }
    return result
}

function teardownSession(session) {
    clearInterval(session.timer)
    session.timer = 0
    session.compositor?.stop()
    session.compositor = null
    session.tracks.forEach((track) => {
        try {
            track.stop()
        } catch {
            // already stopped
        }
    })
    session.tracks.clear()
    if (session.audioContext && session.audioContext.state !== 'closed') session.audioContext.close().catch(() => {})
    session.audioContext = null
}

function ProgressBar({ value, label }) {
    const pct = value == null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                <span>{label}</span>
                {pct != null && <span className="mono">{pct}%</span>}
            </div>
            <div
                role="progressbar"
                aria-label={label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
                style={{ height: 8, borderRadius: 'var(--radius-full)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', overflow: 'hidden' }}
            >
                <div
                    // Remount when switching between indeterminate and determinate, so the bar doesn't animate backwards
                    key={pct == null ? 'indeterminate' : 'determinate'}
                    style={{
                        height: '100%',
                        width: pct == null ? '100%' : `${pct}%`,
                        background: 'var(--primary)',
                        opacity: pct == null ? 0.55 : 1,
                        animation: pct == null ? 'pulse 1.4s ease-in-out infinite' : undefined,
                        transition: 'width 0.2s ease',
                    }}
                />
            </div>
        </div>
    )
}

function SourceToggle({ icon: Icon, offIcon: OffIcon, label, pressed, onToggle }) {
    const Shown = pressed ? Icon : OffIcon
    return (
        <button type="button" className={`chip ${pressed ? 'is-active' : ''}`} aria-pressed={pressed} onClick={onToggle}>
            <Shown size={14} aria-hidden="true" />
            {label}
        </button>
    )
}

function StagePlaceholder({ phase, message, unsupported }) {
    const waiting = phase === 'preparing' || phase === 'stopping'
    if (unsupported) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-lg)', textAlign: 'center' }}>
                <ScreenShare size={40} aria-hidden="true" style={{ opacity: 0.5 }} />
                <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>Screen recording unavailable</div>
                <div style={{ opacity: 0.78, fontSize: '0.9rem', maxWidth: '44ch' }}>See the message above.</div>
            </div>
        )
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-lg)', textAlign: 'center' }}>
            {waiting
                ? <Loader2 size={36} className="spin" aria-hidden="true" />
                : <ScreenShare size={40} aria-hidden="true" style={{ opacity: 0.7 }} />}
            <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                {phase === 'stopping' ? 'Finishing the recording…' : waiting ? 'Waiting for you to choose what to share' : 'Ready to record'}
            </div>
            <div style={{ opacity: 0.78, fontSize: '0.9rem', maxWidth: '44ch' }}>
                {phase === 'stopping'
                    ? 'Saving the last second of video.'
                    : waiting
                        ? message
                        : 'Press Start recording, then pick a screen, window or tab. Microphone and camera access is requested afterwards.'}
            </div>
        </div>
    )
}

const fillStyle = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain' }

export default function Recorder() {
    const navigate = useNavigate()
    const toast = useToast()
    const { sendMedia } = usePipeline()
    const { size } = usePane()
    const narrow = size === 'sm'

    const [support] = useState(detectSupport)
    const [options, setOptions] = useState({ mic: true, systemAudio: true, camera: false })
    const [phase, setPhase] = useState('idle') // idle | preparing | recording | stopping | finished | error
    const [prepMessage, setPrepMessage] = useState('')
    const [error, setError] = useState(null)
    const [live, setLive] = useState(null)
    const [stats, setStats] = useState({ elapsed: 0, bytes: 0 })
    const [recording, setRecording] = useState(null)
    const [saved, setSaved] = useState(false)
    const [gif, setGif] = useState(null) // { stage: 'frames' | 'encoding', progress }
    const [confirmDiscard, setConfirmDiscard] = useState(false)
    const [pipActive, setPipActive] = useState(false)

    const sessionRef = useRef(null)
    const gifJobRef = useRef(null)
    const previewRef = useRef(null)
    const playbackRef = useRef(null)
    const recordingUrl = useObjectURL(recording?.blob ?? null)

    const busy = phase === 'preparing' || phase === 'recording' || phase === 'stopping'
    const unsaved = phase === 'finished' && Boolean(recording) && !saved
    useLeaveGuard(busy || unsaved, busy ? MESSAGES.busy : MESSAGES.unsaved)

    // Leaving the page (navigation, unpinning) stops everything
    useEffect(() => () => {
        const session = sessionRef.current
        sessionRef.current = null
        gifJobRef.current = null
        if (!session) return
        session.discard = true
        try {
            if (session.recorder && session.recorder.state !== 'inactive') session.recorder.stop()
        } catch {
            // the recorder already failed
        }
        teardownSession(session)
    }, [])

    // Keep the picture-in-picture button in sync (the user can close the window)
    useEffect(() => {
        const videos = [previewRef.current, playbackRef.current].filter(Boolean)
        const update = () => setPipActive(videos.includes(document.pictureInPictureElement))
        videos.forEach((video) => {
            video.addEventListener('enterpictureinpicture', update)
            video.addEventListener('leavepictureinpicture', update)
        })
        return () => videos.forEach((video) => {
            video.removeEventListener('enterpictureinpicture', update)
            video.removeEventListener('leavepictureinpicture', update)
        })
    }, [recordingUrl])

    const finalizeSession = async (session) => {
        teardownSession(session)
        if (session.discard || sessionRef.current !== session) return
        const preview = previewRef.current
        if (preview) {
            if (document.pictureInPictureElement === preview) document.exitPictureInPicture().catch(() => {})
            preview.srcObject = null
        }
        const type = (session.recorder?.mimeType || 'video/webm').split(';')[0] || 'video/webm'
        const chunks = session.chunks
        session.chunks = []
        if (!chunks.length) {
            sessionRef.current = null
            setError({
                tone: 'danger',
                title: 'Nothing was recorded',
                message: session.failure || 'The recording stopped before any video was captured. Try again.',
            })
            setPhase('error')
            return
        }
        const durationMs = (session.stoppedAt || performance.now()) - session.startedAt
        // MediaRecorder WebM files have no duration in their header; add it so
        // players, the GIF export and Video Studio see the real length.
        const blob = await fixWebmDuration(new Blob(chunks, { type }), durationMs)
        if (session.discard || sessionRef.current !== session) return
        sessionRef.current = null
        setRecording({
            blob,
            name: `recording-${fileTimestamp()}.${extensionForType(type)}`,
            type,
            duration: durationMs / 1000,
            size: blob.size,
            // Replaced by the real frame size once the playback video has loaded
            width: session.size?.width,
            height: session.size?.height,
        })
        setSaved(false)
        setPhase('finished')
        if (session.failure) toast.error(`The recording stopped early: ${session.failure}`)
    }

    const stopSession = (session) => {
        if (!session || session.stopping || session.discard) return
        session.stopping = true
        session.stoppedAt = performance.now()
        clearInterval(session.timer)
        const recorder = session.recorder
        if (recorder && recorder.state !== 'inactive') {
            setPhase('stopping')
            // The final chunk arrives asynchronously; 'stop' fires after it
            recorder.stop()
        } else {
            finalizeSession(session)
        }
    }

    const start = async () => {
        if (!support.ok || sessionRef.current) return
        const wanted = { ...options }
        const session = {
            tracks: new Set(),
            chunks: [],
            bytes: 0,
            audioContext: null,
            compositor: null,
            recorder: null,
            timer: 0,
            startedAt: 0,
            stoppedAt: 0,
            stopping: false,
            discard: false,
            failure: null,
            size: null,
        }
        sessionRef.current = session
        setError(null)
        setPrepMessage('Choose a screen, window or tab in your browser’s dialog.')
        setPhase('preparing')

        // Mixing system audio with the mic needs an AudioContext. Create it
        // during the click: later it might start suspended (and silent).
        if (wanted.mic && wanted.systemAudio) {
            try {
                session.audioContext = new AudioContext()
            } catch {
                // mixing unavailable; handled below
            }
        }

        try {
            const display = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 30 } },
                audio: wanted.systemAudio,
            })
            display.getTracks().forEach((track) => session.tracks.add(track))
            if (sessionRef.current !== session) throw new DOMException('Left the page', 'AbortError')

            const screenTrack = display.getVideoTracks()[0]
            if (!screenTrack) throw new DOMException('No video track', 'NotFoundError')
            if ('contentHint' in screenTrack) screenTrack.contentHint = 'detail'
            const systemTrack = display.getAudioTracks()[0] ?? null

            let micTrack = null
            let cameraTrack = null
            if (wanted.mic || wanted.camera) {
                const devices = wanted.mic && wanted.camera ? 'microphone and camera' : wanted.mic ? 'microphone' : 'camera'
                setPrepMessage(`Allow access to your ${devices} if your browser asks.`)
                const opened = await openDevices(wanted)
                ;[opened.micTrack, opened.cameraTrack].forEach((track) => track && session.tracks.add(track))
                if (sessionRef.current !== session) throw new DOMException('Left the page', 'AbortError')
                micTrack = opened.micTrack
                cameraTrack = opened.cameraTrack
                opened.failures.forEach(({ device, reason }) => {
                    toast.warning(`Couldn’t use the ${device}: ${reason}. Recording without it.`)
                })
            }
            if (screenTrack.readyState === 'ended') throw new DOMException('Sharing stopped', 'AbortError')

            // Video: the screen track itself, or the screen with a camera bubble
            let videoTrack = screenTrack
            let mode = 'direct'
            if (cameraTrack) {
                try {
                    const compositor = await startCompositor({ screenTrack, cameraTrack, fps: 30 })
                    session.compositor = compositor
                    session.tracks.add(compositor.track)
                    videoTrack = compositor.track
                    mode = compositor.mode
                } catch (err) {
                    toast.warning(`The camera bubble couldn’t be added (${err?.message || 'unknown error'}). Recording the screen only.`)
                    cameraTrack.stop()
                    cameraTrack = null
                }
            }

            // Audio: one source as-is, two mixed
            const audioSources = [systemTrack, micTrack].filter(Boolean)
            let audioTrack = audioSources[0] ?? null
            if (audioSources.length > 1) {
                const ctx = session.audioContext ?? new AudioContext()
                session.audioContext = ctx
                if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
                const destination = ctx.createMediaStreamDestination()
                audioSources.forEach((track) => ctx.createMediaStreamSource(new MediaStream([track])).connect(destination))
                audioTrack = destination.stream.getAudioTracks()[0]
                session.tracks.add(audioTrack)
            } else if (session.audioContext) {
                session.audioContext.close().catch(() => {})
                session.audioContext = null
            }

            const settings = screenTrack.getSettings()
            session.size = { width: settings.width, height: settings.height }
            const mimeType = pickRecorderMimeType()
            const recorder = new MediaRecorder(new MediaStream([videoTrack, audioTrack].filter(Boolean)), {
                ...(mimeType ? { mimeType } : {}),
                videoBitsPerSecond: recorderBitrate(settings.width, settings.height, settings.frameRate),
                ...(audioTrack ? { audioBitsPerSecond: 128_000 } : {}),
            })
            session.recorder = recorder
            recorder.ondataavailable = (event) => {
                if (event.data?.size) {
                    session.chunks.push(event.data)
                    session.bytes += event.data.size
                }
            }
            recorder.onerror = (event) => {
                session.failure = event.error?.message || 'the browser reported a recording error'
                stopSession(session)
            }
            recorder.onstop = () => {
                finalizeSession(session)
            }
            // "Stop sharing" in the browser's own bar
            screenTrack.addEventListener('ended', () => stopSession(session))

            const preview = previewRef.current
            if (preview) {
                preview.srcObject = new MediaStream([videoTrack])
                preview.play().catch(() => {})
            }

            recorder.start(1000)
            session.startedAt = performance.now()
            session.timer = setInterval(() => {
                setStats({ elapsed: (performance.now() - session.startedAt) / 1000, bytes: session.bytes })
            }, 500)
            setStats({ elapsed: 0, bytes: 0 })
            setLive({ mode, systemAudio: Boolean(systemTrack), mic: Boolean(micTrack), camera: Boolean(cameraTrack), wanted })
            setPhase('recording')
        } catch (err) {
            teardownSession(session)
            if (sessionRef.current !== session) return
            sessionRef.current = null
            if (previewRef.current) previewRef.current.srcObject = null
            setError(describeStartError(err))
            setPhase('error')
        }
    }

    const stop = () => stopSession(sessionRef.current)

    const toggleOption = (key) => setOptions((prev) => ({ ...prev, [key]: !prev[key] }))

    const downloadRecording = () => {
        if (!recording) return
        downloadBlob(recording.blob, recording.name)
        setSaved(true)
    }

    const openInStudio = () => {
        if (!recording) return
        const file = new File([recording.blob], recording.name, { type: recording.type })
        sendMedia(file, { source: '/recorder', target: '/video' })
        // The recording now lives in the studio: lift the leave guard before navigating
        flushSync(() => setSaved(true))
        navigate('/video')
    }

    const discardRecording = () => {
        gifJobRef.current = null
        setGif(null)
        setRecording(null)
        setSaved(false)
        setConfirmDiscard(false)
        setError(null)
        setPhase('idle')
    }

    const requestNewRecording = () => {
        if (recording && !saved) setConfirmDiscard(true)
        else discardRecording()
    }

    const exportGif = async () => {
        if (!recording || gifJobRef.current) return
        const job = {}
        gifJobRef.current = job
        const isCurrent = () => gifJobRef.current === job
        setGif({ stage: 'frames', progress: 0 })
        let frameUrls = []
        try {
            const frames = await captureFrames(recording.blob, {
                fps: GIF_FPS,
                maxFrames: GIF_MAX_FRAMES,
                maxWidth: GIF_MAX_WIDTH,
                isCancelled: () => !isCurrent(),
                onProgress: (progress) => {
                    if (isCurrent()) setGif({ stage: 'frames', progress })
                },
            })
            frameUrls = frames.urls
            if (!isCurrent()) return
            setGif({ stage: 'encoding', progress: null })
            const { default: gifshot } = await import('gifshot')
            const result = await new Promise((resolve) => {
                gifshot.createGIF({
                    images: frames.urls,
                    gifWidth: frames.width,
                    gifHeight: frames.height,
                    interval: 1 / frames.fps,
                    numFrames: frames.urls.length,
                    frameDuration: 1,
                    sampleInterval: 10,
                    numWorkers: 2,
                    crossOrigin: '',
                }, resolve)
            })
            if (!isCurrent()) return
            if (result.error) throw new Error(result.errorMsg || 'the GIF encoder failed')
            // gifshot returns a data: URL; download a Blob instead (long data URLs fail)
            const gifBlob = await (await fetch(result.image)).blob()
            if (!isCurrent()) return
            downloadBlob(new Blob([gifBlob], { type: 'image/gif' }), recording.name.replace(/\.\w+$/, '.gif'))
            toast.success(`GIF saved (${formatBytes(gifBlob.size)})${frames.truncated ? `: the first ${GIF_MAX_SECONDS} seconds` : ''}.`)
        } catch (err) {
            if (isCurrent() && err?.name !== 'AbortError') toast.error(`GIF export failed: ${err?.message || err}`)
        } finally {
            frameUrls.forEach((url) => URL.revokeObjectURL(url))
            if (isCurrent()) {
                gifJobRef.current = null
                setGif(null)
            }
        }
    }

    const cancelGif = () => {
        gifJobRef.current = null
        setGif(null)
    }

    const togglePip = async () => {
        const video = (phase === 'recording' ? previewRef : playbackRef).current
        if (!video) return
        try {
            if (document.pictureInPictureElement === video) await document.exitPictureInPicture()
            else await video.requestPictureInPicture()
        } catch (err) {
            toast.error(`Picture-in-picture didn’t start: ${err?.message || err}`)
        }
    }

    const ext = recording ? { webm: 'WebM', mp4: 'MP4', mkv: 'MKV' }[extensionForType(recording.type)] : ''
    const pipButton = support.pip && (
        <button type="button" className="btn btn-secondary btn-block" aria-pressed={pipActive} onClick={togglePip}>
            <PictureInPicture2 size={16} aria-hidden="true" />
            {pipActive ? 'Close picture-in-picture' : 'Picture-in-picture'}
        </button>
    )
    const canvasWarning = (
        <StatusBanner tone="warning" title="Keep this tab visible">
            In this browser the camera bubble only updates while this tab is on screen, so switching tabs can freeze the video. Turn the camera off to record the screen directly.
        </StatusBanner>
    )

    return (
        <div className="page page-wide">
            <ToolHeader />

            {!support.ok && (
                <StatusBanner tone="warning" title="Screen recording isn’t available in this browser">{support.problem}</StatusBanner>
            )}
            {phase === 'error' && error && (
                <StatusBanner tone={error.tone} title={error.title}>{error.message}</StatusBanner>
            )}

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : size === 'md' ? 'minmax(0, 1fr) minmax(240px, 300px)' : 'minmax(0, 1fr) minmax(280px, 340px)',
                    gap: 'var(--space-lg)',
                    alignItems: 'start',
                }}
            >
                <div
                    className="stage"
                    style={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '16 / 9',
                        maxHeight: 'min(72vh, 760px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: '1px solid var(--border)',
                        boxShadow: phase === 'recording' ? '0 0 0 2px var(--danger)' : 'var(--shadow-sm)',
                    }}
                >
                    <video
                        ref={previewRef}
                        muted
                        playsInline
                        autoPlay
                        aria-label="Live preview of the recording"
                        style={{ ...fillStyle, display: phase === 'recording' ? 'block' : 'none' }}
                    />
                    {phase === 'finished' && recordingUrl && (
                        <video
                            ref={playbackRef}
                            src={recordingUrl}
                            controls
                            playsInline
                            preload="metadata"
                            aria-label="Recorded video"
                            style={fillStyle}
                            onLoadedMetadata={(event) => {
                                const { videoWidth: width, videoHeight: height } = event.currentTarget
                                if (width && height) setRecording((prev) => (prev ? { ...prev, width, height } : prev))
                            }}
                        />
                    )}
                    {phase !== 'recording' && phase !== 'finished' && <StagePlaceholder phase={phase} message={prepMessage} unsupported={!support.ok} />}
                </div>

                {/* In one column the controls come first, so Start is visible without scrolling */}
                <section className="card" aria-label="Recording controls" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', order: narrow ? -1 : 0 }}>
                    {(phase === 'idle' || phase === 'error') && (
                        <>
                            <div>
                                <h2 className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>What to record</h2>
                                <div role="group" aria-label="Sources to record" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                                    <span className="chip is-active" style={{ cursor: 'default' }}>
                                        <ScreenShare size={14} aria-hidden="true" /> Screen
                                    </span>
                                    <SourceToggle icon={Mic} offIcon={MicOff} label="Microphone" pressed={options.mic} onToggle={() => toggleOption('mic')} />
                                    <SourceToggle icon={Volume2} offIcon={VolumeX} label="System audio" pressed={options.systemAudio} onToggle={() => toggleOption('systemAudio')} />
                                    <SourceToggle icon={Camera} offIcon={CameraOff} label="Camera" pressed={options.camera} onToggle={() => toggleOption('camera')} />
                                </div>
                                <ul className="field-hint" style={{ listStyle: 'none', display: 'grid', gap: 'var(--space-xs)', marginTop: 'var(--space-sm)' }}>
                                    {options.systemAudio && (
                                        <li>System audio: tick “Share audio” in the browser’s dialog. It’s offered for tabs, and for the whole screen on Windows and ChromeOS.</li>
                                    )}
                                    {options.camera && <li>Your camera appears as a round bubble in the bottom-left corner.</li>}
                                    <li>Recording keeps going while you use other tabs and apps.</li>
                                </ul>
                            </div>
                            {options.camera && support.compositing === 'canvas' && canvasWarning}
                            <button type="button" className="btn btn-primary btn-lg btn-block" onClick={start} disabled={!support.ok}>
                                <CircleDot size={18} aria-hidden="true" /> Start recording
                            </button>
                        </>
                    )}

                    {phase === 'preparing' && (
                        <>
                            <div role="status" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start', color: 'var(--text-muted)' }}>
                                <Loader2 size={18} className="spin" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                                <span>{prepMessage}</span>
                            </div>
                            <button type="button" className="btn btn-primary btn-lg btn-block" disabled>
                                <Loader2 size={18} className="spin" aria-hidden="true" /> Starting…
                            </button>
                        </>
                    )}

                    {phase === 'recording' && live && (
                        <>
                            <div role="timer" aria-label="Recording time" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontWeight: 600 }}>
                                <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--danger)', animation: 'pulse 1.4s ease-in-out infinite', flexShrink: 0 }} />
                                <span style={{ color: 'var(--danger)' }}>Recording</span>
                                <span className="mono" style={{ marginLeft: 'auto', fontSize: '1.15rem', color: 'var(--text-main)' }}>{formatClock(stats.elapsed)}</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }} aria-label="Being recorded">
                                <span className="badge badge-primary"><ScreenShare size={12} aria-hidden="true" /> Screen</span>
                                {live.systemAudio && <span className="badge"><Volume2 size={12} aria-hidden="true" /> System audio</span>}
                                {live.mic && <span className="badge"><Mic size={12} aria-hidden="true" /> Microphone</span>}
                                {live.camera && <span className="badge"><Camera size={12} aria-hidden="true" /> Camera</span>}
                                <span className="badge" style={{ marginLeft: 'auto' }}>{formatBytes(stats.bytes)}</span>
                            </div>
                            {live.wanted.systemAudio && !live.systemAudio && (
                                <div className="field-hint" style={{ marginTop: 0 }}>
                                    System audio isn’t being recorded: it wasn’t shared in the browser’s dialog, or isn’t available for what you picked.
                                </div>
                            )}
                            {live.camera && live.mode === 'canvas' && canvasWarning}
                            <button type="button" className="btn btn-danger btn-lg btn-block" onClick={stop}>
                                <Square size={16} fill="currentColor" aria-hidden="true" /> Stop recording
                            </button>
                            {pipButton}
                            <div className="field-hint" style={{ marginTop: 0 }}>
                                You can also stop with “Stop sharing” in the browser’s sharing bar.
                            </div>
                        </>
                    )}

                    {phase === 'stopping' && (
                        <div role="status" style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', color: 'var(--text-muted)' }}>
                            <Loader2 size={18} className="spin" aria-hidden="true" /> Finishing the recording…
                        </div>
                    )}

                    {phase === 'finished' && recording && (
                        <>
                            <div>
                                <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', fontWeight: 600 }}>
                                    <Check size={18} aria-hidden="true" style={{ color: 'var(--success)' }} /> Recording ready
                                </div>
                                <div className="field-hint">
                                    {formatClock(recording.duration)} · {formatBytes(recording.size)}
                                    {recording.width ? ` · ${recording.width}×${recording.height}` : ''} · {ext}
                                </div>
                            </div>
                            <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                                <button type="button" className="btn btn-primary btn-block" onClick={downloadRecording}>
                                    <Download size={16} aria-hidden="true" /> Download video ({ext})
                                </button>
                                <button type="button" className="btn btn-secondary btn-block" onClick={openInStudio}>
                                    <Clapperboard size={16} aria-hidden="true" /> Edit in Video Studio
                                </button>
                                <button type="button" className="btn btn-secondary btn-block" onClick={exportGif} disabled={Boolean(gif)}>
                                    {gif ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <ImageIcon size={16} aria-hidden="true" />}
                                    {gif ? 'Making GIF…' : 'Export GIF'}
                                </button>
                                {pipButton}
                            </div>
                            {gif ? (
                                <div style={{ display: 'grid', gap: 'var(--space-xs)' }}>
                                    <ProgressBar
                                        value={gif.stage === 'frames' ? gif.progress : null}
                                        label={gif.stage === 'frames' ? 'Capturing frames' : 'Encoding the GIF…'}
                                    />
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={cancelGif} style={{ justifySelf: 'start' }}>
                                        Cancel GIF
                                    </button>
                                </div>
                            ) : (
                                <div className="field-hint" style={{ marginTop: 0 }}>
                                    GIFs are {GIF_FPS} fps and up to {GIF_MAX_WIDTH} px wide
                                    {recording.duration > GIF_MAX_SECONDS
                                        ? `, and cover the first ${GIF_MAX_SECONDS} seconds. Use Video Studio to pick a section.`
                                        : '.'}
                                </div>
                            )}
                            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)', display: 'grid', gap: 'var(--space-sm)' }}>
                                {saved ? (
                                    <div className="field-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <Check size={14} aria-hidden="true" style={{ color: 'var(--success)' }} /> Saved
                                    </div>
                                ) : (
                                    <div className="field-hint" style={{ marginTop: 0, color: 'var(--warning)' }}>
                                        Not saved yet. Download it or open it in Video Studio before you leave this page.
                                    </div>
                                )}
                                <button type="button" className="btn btn-ghost btn-block" onClick={requestNewRecording}>
                                    <RotateCcw size={16} aria-hidden="true" /> New recording
                                </button>
                            </div>
                        </>
                    )}
                </section>
            </div>

            <Modal
                open={confirmDiscard}
                onClose={() => setConfirmDiscard(false)}
                title="Discard this recording?"
                size="sm"
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setConfirmDiscard(false)}>Keep it</button>
                        <button type="button" className="btn btn-danger" onClick={discardRecording}>Discard</button>
                    </>
                )}
            >
                <p style={{ color: 'var(--text-muted)' }}>
                    It hasn’t been downloaded or opened in Video Studio, so it will be lost.
                </p>
            </Modal>
        </div>
    )
}
