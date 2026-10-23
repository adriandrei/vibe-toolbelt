import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import ReactCrop from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import {
    Camera,
    Check,
    Crop as CropIcon,
    Download,
    Film,
    Loader2,
    Music,
    Pause,
    Play,
    RefreshCw,
    Scissors,
    SlidersHorizontal,
    X,
} from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import FileDropZone from '../components/ui/FileDropZone'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import { useToast } from '../components/ToastProvider'
import { usePipeline } from '../contexts/PipelineContext'
import { usePane } from '../contexts/pane'
import { useEscape } from '../hooks/useEscape'
import { useLeaveGuard } from '../hooks/useLeaveGuard'
import { useObjectURL } from '../hooks/useObjectURL'
import { downloadBlob, formatBytes, splitFilename } from '../utils/download'
import {
    describeMediaElementError,
    formatClock,
    loadFFmpegCore,
    parseFfmpegInfo,
    parseFfmpegTime,
    probeVideo,
    summarizeFfmpegLog,
} from '../utils/media'

const VIDEO_ACCEPT = 'video/*,.mkv,.mov,.m4v,.avi,.webm,.mp4,.ogv,.3gp,.flv,.wmv,.ts,.mts,.m2ts'
const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac'
const FADE_SECONDS = 2

const FORMATS = {
    mp4: { label: 'MP4 · H.264 video, AAC audio', short: 'MP4', ext: 'mp4', mime: 'video/mp4' },
    webm: { label: 'WebM · VP8 video, Vorbis audio', short: 'WebM', ext: 'webm', mime: 'video/webm' },
    gif: { label: 'Animated GIF (no sound)', short: 'GIF', ext: 'gif', mime: 'image/gif' },
    mp3: { label: 'MP3 · audio only', short: 'MP3', ext: 'mp3', mime: 'audio/mpeg' },
}

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.5, 2].map((value) => ({ value, label: `${value}×` }))
const ASPECTS = [
    { value: 'free', label: 'Free', ratio: undefined },
    { value: '16:9', label: '16:9', ratio: 16 / 9 },
    { value: '9:16', label: '9:16', ratio: 9 / 16 },
    { value: '1:1', label: '1:1', ratio: 1 },
    { value: '4:3', label: '4:3', ratio: 4 / 3 },
]
const HEIGHTS = [2160, 1440, 1080, 720, 480, 360]
const GIF_FPS_OPTIONS = [8, 10, 12, 15, 20, 24]
const GIF_WIDTHS = [320, 480, 640, 800]
const JOB_LABELS = {
    engine: 'Loading the video engine…',
    reading: 'Reading the video…',
    encoding: 'Encoding…',
}

// Dense panels: slightly smaller than the global field size (as in ColorField)
const compactField = { padding: '0.5rem 0.75rem', fontSize: '0.9rem' }
const fieldsetStyle = { border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: 'var(--space-md)' }
const subheading = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-xs)' }

const secs = (value) => (Math.round(value * 1000) / 1000).toFixed(3)
const ratioFor = (aspect) => ASPECTS.find((a) => a.value === aspect)?.ratio

function safeExtension(name, fallback) {
    const ext = splitFilename(name || '').ext.toLowerCase()
    return /^[a-z0-9]{1,5}$/.test(ext) ? ext : fallback
}

function parseTrim(startText, endText, duration) {
    if (duration == null) return { start: 0, end: null, isTrimmed: false, errors: {}, valid: true }
    const errors = {}
    const start = startText.trim() === '' ? 0 : Number(startText)
    const end = endText.trim() === '' ? duration : Number(endText)
    if (!Number.isFinite(start) || start < 0) errors.start = 'Enter a time in seconds (0 or more).'
    else if (start >= duration) errors.start = `Start must be before the end of the video (${duration.toFixed(2)} s).`
    if (!Number.isFinite(end) || end <= 0) errors.end = 'Enter a time in seconds.'
    else if (end > duration + 0.05) errors.end = `The video is only ${duration.toFixed(2)} s long.`
    if (!errors.start && !errors.end && end - start < 0.1) errors.end = 'End must be at least 0.1 s after the start.'
    if (errors.start || errors.end) return { start: 0, end: duration, isTrimmed: false, errors, valid: false }
    const clampedEnd = Math.min(duration, end)
    const isTrimmed = start > 0.01 || clampedEnd < duration - 0.02
    return { start: isTrimmed ? start : 0, end: isTrimmed ? clampedEnd : duration, isTrimmed, errors, valid: true }
}

// Percent crop (as drawn on the preview) -> even pixel values in the source
function cropToPixels(crop, width, height) {
    if (!crop || !width || !height || !crop.width || !crop.height) return null
    let x = Math.round((crop.x / 100) * width)
    let y = Math.round((crop.y / 100) * height)
    x -= x % 2
    y -= y % 2
    let w = Math.min(Math.round((crop.width / 100) * width), width - x)
    let h = Math.min(Math.round((crop.height / 100) * height), height - y)
    w -= w % 2
    h -= h % 2
    if (w < 16 || h < 16) return null
    if (w >= width - 1 && h >= height - 1) return null
    return { x, y, w, h }
}

// Largest centred crop with the given aspect ratio inside 90% of the frame
function initialCrop(ratio, width, height) {
    if (!ratio || !width || !height) return { unit: '%', x: 10, y: 10, width: 80, height: 80 }
    let w = width * 0.9
    let h = w / ratio
    if (h > height * 0.9) {
        h = height * 0.9
        w = h * ratio
    }
    const pw = (w / width) * 100
    const ph = (h / height) * 100
    return { unit: '%', x: (100 - pw) / 2, y: (100 - ph) / 2, width: pw, height: ph }
}

// Fades are timed on the output (after trim and speed changes)
function fadePlan(fade, outDuration) {
    const wantIn = fade === 'in' || fade === 'both'
    const wantOut = (fade === 'out' || fade === 'both') && outDuration != null
    if (!wantIn && !wantOut) return {}
    const count = (wantIn ? 1 : 0) + (wantOut ? 1 : 0)
    const length = outDuration != null ? Math.min(FADE_SECONDS, outDuration / count) : FADE_SECONDS
    if (length < 0.05) return {}
    return {
        in: wantIn ? length : null,
        out: wantOut ? { start: Math.max(0, outDuration - length), duration: length } : null,
    }
}

function friendlyError(title, message) {
    const error = new Error(message)
    error.friendly = true
    error.title = title
    return error
}

/**
 * ffmpeg argument lists to try in order (a stream copy first when the input
 * already fits the target container, then a full re-encode).
 */
function buildExportPlan(s, info, paths) {
    const input = info.inputs[0]
    if (!input) throw friendlyError('This file couldn’t be read', 'ffmpeg didn’t recognise it as a video. It may be damaged or in an unsupported format.')
    const useReplacement = Boolean(paths.audio)
    if (useReplacement && !info.inputs[1]?.audio) throw friendlyError('The replacement audio can’t be used', 'That file has no audio track ffmpeg can read.')
    if (s.format !== 'mp3' && !input.video) throw friendlyError('This file has no video', 'It only contains audio. Choose MP3 to export it.')
    if (s.format === 'mp3' && !useReplacement && !input.audio) throw friendlyError('No audio to export', 'This video has no audio track, so it can’t be exported as MP3.')

    const width = s.width || input.video?.width || 0
    const height = s.height || input.video?.height || 0
    const inArgs = []
    if (s.trim.isTrimmed) inArgs.push('-ss', secs(s.trim.start), '-t', secs(s.trim.end - s.trim.start))
    inArgs.push('-i', paths.input)
    if (useReplacement) inArgs.push('-i', paths.audio)

    const fades = fadePlan(s.fade, s.outDuration)
    const timing = []
    if (s.speed !== 1) timing.push(`setpts=PTS/${s.speed}`)
    if (fades.in) timing.push(`fade=t=in:st=0:d=${secs(fades.in)}`)
    if (fades.out) timing.push(`fade=t=out:st=${secs(fades.out.start)}:d=${secs(fades.out.duration)}`)
    const audioFilters = []
    // A replacement track is a soundtrack: it isn't sped up
    if (!useReplacement && s.speed !== 1) audioFilters.push(`atempo=${s.speed}`)
    if (fades.in) audioFilters.push(`afade=t=in:st=0:d=${secs(fades.in)}`)
    if (fades.out) audioFilters.push(`afade=t=out:st=${secs(fades.out.start)}:d=${secs(fades.out.duration)}`)
    const limit = useReplacement ? (s.outDuration != null ? ['-t', secs(s.outDuration)] : ['-shortest']) : []

    const crop = s.crop ? [`crop=${s.crop.w}:${s.crop.h}:${s.crop.x}:${s.crop.y}`] : []
    const cw = s.crop?.w ?? width
    const ch = s.crop?.h ?? height

    if (s.format === 'gif') {
        const gifWidth = cw ? Math.min(s.gifWidth, cw) : s.gifWidth
        const chain = [...crop, ...timing, `fps=${s.gifFps}`, `scale=${gifWidth}:-1:flags=lanczos`].join(',')
        return [[
            ...inArgs,
            '-filter_complex', `[0:v:0]${chain},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a[v]`,
            '-map', '[v]', '-an', '-loop', '0', paths.output,
        ]]
    }

    if (s.format === 'mp3') {
        const canCopy = !useReplacement && input.audio?.codec === 'mp3' && !audioFilters.length && !s.trim.isTrimmed
        const build = (copy) => [
            ...inArgs,
            '-map', useReplacement ? '1:a:0' : '0:a:0', '-vn',
            ...(copy ? ['-c:a', 'copy'] : [...(audioFilters.length ? ['-af', audioFilters.join(',')] : []), '-c:a', 'libmp3lame', '-q:a', '2']),
            ...limit, paths.output,
        ]
        return canCopy ? [build(true), build(false)] : [build(false)]
    }

    // MP4 / WebM
    const isMp4 = s.format === 'mp4'
    const target = s.maxHeight === 'original' ? null : Number(s.maxHeight)
    const geometry = [...crop]
    let scaled = false
    if (target && (!ch || ch > target)) {
        // Never upscale; keep both sides even for 4:2:0 encoders
        geometry.push(ch ? `scale=-2:${target}` : `scale=-2:'trunc(min(ih,${target})/2)*2'`)
        scaled = true
    }
    const edited = geometry.length > 0 || timing.length > 0 || s.trim.isTrimmed
    // 4:2:0 needs even sides: drop the odd last row/column (no resampling)
    const evenFix = !scaled && (!cw || !ch || cw % 2 || ch % 2) ? ['crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0'] : []
    const videoCodec = input.video.codec
    const audioCodec = input.audio?.codec
    const videoCopyOk = !edited && (isMp4 ? ['h264', 'hevc'] : ['vp8', 'vp9', 'av1']).includes(videoCodec)
    const audioSource = s.audioMode === 'mute' ? null : useReplacement ? '1:a:0' : input.audio ? '0:a:0' : null
    const audioCopyOk = Boolean(audioSource) && !useReplacement && !audioFilters.length && !s.trim.isTrimmed
        && (isMp4 ? ['aac', 'mp3', 'alac'] : ['opus', 'vorbis']).includes(audioCodec)
    const videoEncoder = isMp4
        ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p']
        : ['-c:v', 'libvpx', '-b:v', '2500k', '-crf', '10', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p']
    // This ffmpeg core crashes in libopus and libvpx-vp9, so WebM is VP8 + Vorbis
    const audioEncoder = isMp4 ? ['-c:a', 'aac', '-b:a', '160k'] : ['-c:a', 'libvorbis', '-q:a', '5']
    // MediaRecorder files use millisecond timestamps ("1k fps"): write a
    // standard constant frame rate instead, which every player handles.
    const fps = input.video.fps
    const rate = !fps || fps > 120 ? ['-r', '30'] : []

    const build = (allowCopy) => {
        const args = [...inArgs, '-map', '0:v:0']
        if (audioSource) args.push('-map', audioSource)
        if (allowCopy && videoCopyOk) {
            args.push('-c:v', 'copy')
            if (isMp4 && videoCodec === 'hevc') args.push('-tag:v', 'hvc1')
        } else {
            const filters = [...geometry, ...evenFix, ...timing]
            if (filters.length) args.push('-vf', filters.join(','))
            args.push(...videoEncoder, ...rate)
        }
        if (!audioSource) {
            args.push('-an')
        } else if (allowCopy && audioCopyOk) {
            args.push('-c:a', 'copy')
        } else {
            if (audioFilters.length) args.push('-af', audioFilters.join(','))
            args.push(...audioEncoder)
        }
        if (isMp4) args.push('-movflags', '+faststart')
        args.push(...limit, paths.output)
        return args
    }
    return videoCopyOk || audioCopyOk ? [build(true), build(false)] : [build(false)]
}

function describeEngineError(err) {
    const message = String(err?.message ?? err ?? '')
    if (/download|connection|HTTP/i.test(message)) return message
    return `The ffmpeg engine failed to start${message ? ` (${message})` : ''}. Check your connection, then retry.`
}

function describeExportError(err, log) {
    const details = summarizeFfmpegLog(log).join('\n')
    if (err?.friendly) return { title: err.title, message: err.message, details: '' }
    const text = `${err?.message ?? err ?? ''}\n${details}`
    if (/out of memory|\bOOM\b|Cannot enlarge memory/i.test(text)) {
        return {
            title: 'Not enough memory',
            message: 'The browser ran out of memory while processing this video. Trim it, lower the resolution, or export a shorter clip.',
            details,
        }
    }
    if (err?.crashed) {
        return {
            title: 'The video engine crashed',
            message: 'ffmpeg stopped unexpectedly with these settings (it may have run out of memory). It has been restarted: try a shorter clip, a lower resolution or another format.',
            details: details || String(err?.message ?? err ?? ''),
        }
    }
    return {
        title: 'Export failed',
        message: 'ffmpeg couldn’t produce a file with these settings. Try another format, or undo some edits.',
        details: details || String(err?.message ?? err ?? ''),
    }
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

function EngineStatus({ engine, onRetry }) {
    if (engine.status === 'error') {
        return (
            <StatusBanner
                tone="warning"
                title="The video engine couldn’t load"
                action={(
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
                        <RefreshCw size={14} aria-hidden="true" /> Retry
                    </button>
                )}
            >
                {engine.error}
            </StatusBanner>
        )
    }
    let text = 'The video engine (about 32 MB) loads the first time you export.'
    if (engine.status === 'ready') text = 'Video engine ready. Everything runs on your device.'
    if (engine.status === 'loading') {
        text = `Loading the video engine${engine.progress != null ? ` (${Math.round(engine.progress * 100)}%)` : '…'}`
    }
    return (
        <div role="status" className="field-hint" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
            {engine.status === 'ready' && <Check size={14} aria-hidden="true" style={{ color: 'var(--success)', flexShrink: 0 }} />}
            {engine.status === 'loading' && <Loader2 size={14} className="spin" aria-hidden="true" style={{ flexShrink: 0 }} />}
            {text}
        </div>
    )
}

export default function VideoTools() {
    const id = useId()
    const toast = useToast()
    const pane = usePane()
    const { takeMedia, hasMedia } = usePipeline()

    // Source video
    const [source, setSource] = useState(null) // { id, file, fromRecorder, saved }
    const sourceUrl = useObjectURL(source?.file ?? null)
    const [meta, setMeta] = useState(null) // { status, width, height, duration, reason }
    const [pendingMedia, setPendingMedia] = useState(null)
    const [confirmClear, setConfirmClear] = useState(false)
    const sourceSeq = useRef(0)
    const sourceIdRef = useRef(0)

    // Playback
    const videoRef = useRef(null)
    const [playing, setPlaying] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)

    // Edits
    const [trimStartText, setTrimStartText] = useState('0')
    const [trimEndText, setTrimEndText] = useState('')
    const [crop, setCrop] = useState(undefined)
    const [isCropping, setIsCropping] = useState(false)
    const [aspect, setAspect] = useState('free')
    const [speed, setSpeed] = useState(1)
    const [audioMode, setAudioMode] = useState('keep')
    const [audioFile, setAudioFile] = useState(null)
    const [fade, setFade] = useState('none')

    // Output preferences (kept when the project is cleared)
    const [format, setFormat] = useState('mp4')
    const [maxHeight, setMaxHeight] = useState('original')
    const [gifFps, setGifFps] = useState(12)
    const [gifWidth, setGifWidth] = useState(480)

    // Engine and export
    const engineRef = useRef(null)
    const logRef = useRef([])
    const jobRef = useRef(null)
    const jobSeq = useRef(0)
    const [engine, setEngine] = useState({ status: 'idle', progress: null, error: null })
    const [job, setJob] = useState(null) // { id, phase, progress }
    const [result, setResult] = useState(null) // { blob, name, size }
    const [exportError, setExportError] = useState(null)

    const exporting = job !== null
    const unsavedRecording = Boolean(source?.fromRecorder && !source.saved)
    useLeaveGuard(
        exporting || unsavedRecording,
        exporting
            ? 'An export is still running. Leaving will cancel it.'
            : 'This recording from Screen Recorder hasn’t been exported or downloaded yet. Leave and lose it?',
    )

    const loadSource = useCallback((file, { fromRecorder = false } = {}) => {
        sourceSeq.current += 1
        sourceIdRef.current = sourceSeq.current
        setSource({ id: sourceSeq.current, file, fromRecorder, saved: !fromRecorder })
        setMeta({ status: 'loading', width: 0, height: 0, duration: null })
        setPlaying(false)
        setCurrentTime(0)
        setTrimStartText('0')
        setTrimEndText('')
        setCrop(undefined)
        setIsCropping(false)
        setAspect('free')
        setSpeed(1)
        setAudioMode('keep')
        setAudioFile(null)
        setFade('none')
        setResult(null)
        setExportError(null)
    }, [])

    // A recording handed over by the Screen Recorder (main pane only)
    useEffect(() => {
        if (pane.kind !== 'main' || !hasMedia) return
        const media = takeMedia('/video')
        if (!media?.file) return
        const incoming = { file: media.file, fromRecorder: media.source === '/recorder' }
        if (source?.fromRecorder && !source.saved) setPendingMedia(incoming)
        else loadSource(incoming.file, { fromRecorder: incoming.fromRecorder })
    }, [pane.kind, hasMedia, takeMedia, loadSource, source])

    /* ---------- ffmpeg engine: one instance per page, created on demand ---------- */

    const ensureEngine = useCallback(() => {
        let current = engineRef.current
        if (!current) {
            const ffmpeg = new FFmpeg()
            const onLog = ({ message }) => {
                const log = logRef.current
                log.push(message)
                if (log.length > 400) log.splice(0, log.length - 400)
                const running = jobRef.current
                if (!running?.outDuration) return
                const t = parseFfmpegTime(message)
                if (t == null) return
                const progress = Math.min(0.99, t / running.outDuration)
                setJob((prev) => (prev && prev.id === running.id && prev.phase === 'encoding' ? { ...prev, progress } : prev))
            }
            ffmpeg.on('log', onLog)
            current = { ffmpeg, onLog, ready: null }
            engineRef.current = current
        }
        if (!current.ready) {
            const owner = current
            setEngine({ status: 'loading', progress: null, error: null })
            owner.ready = loadFFmpegCore(owner.ffmpeg, (fraction) => {
                if (engineRef.current !== owner) return
                const progress = fraction == null ? null : Math.round(fraction * 100) / 100
                setEngine((prev) => (prev.status === 'loading' && prev.progress !== progress ? { ...prev, progress } : prev))
            }).then(() => {
                if (engineRef.current === owner) setEngine({ status: 'ready', progress: null, error: null })
                return owner.ffmpeg
            }, (err) => {
                if (engineRef.current === owner) {
                    owner.ready = null
                    setEngine({ status: 'error', progress: null, error: describeEngineError(err) })
                }
                throw err
            })
        }
        return current.ready
    }, [])

    const disposeEngine = useCallback(() => {
        const current = engineRef.current
        engineRef.current = null
        if (!current) return
        current.ffmpeg.off('log', current.onLog)
        current.ffmpeg.terminate()
    }, [])

    // Terminate the worker (and free its memory) when the page goes away
    useEffect(() => () => {
        jobRef.current = null
        disposeEngine()
    }, [disposeEngine])

    // Start loading the engine in the background once there is a video
    const hasSource = source !== null
    useEffect(() => {
        if (!hasSource) return undefined
        const timer = setTimeout(() => ensureEngine().catch(() => {}), 0)
        return () => clearTimeout(timer)
    }, [hasSource, ensureEngine])

    const retryEngine = () => {
        disposeEngine()
        ensureEngine().catch(() => {})
    }

    /* ---------- Derived editing state ---------- */

    const duration = meta?.duration ?? null
    const canPreview = Boolean(meta && meta.status !== 'unplayable' && meta.status !== 'loading' && meta.width)
    const trim = parseTrim(trimStartText, trimEndText, duration)
    const outDuration = duration != null && trim.valid ? (trim.end - trim.start) / speed : null
    const cropPx = canPreview ? cropToPixels(crop, meta.width, meta.height) : null
    const effectiveFade = duration == null && (fade === 'out' || fade === 'both') ? (fade === 'both' ? 'in' : 'none') : fade
    const usesAudioFile = audioMode === 'replace' && format !== 'gif'

    const blockers = []
    if (!trim.valid) blockers.push('Fix the trim times to export.')
    if (usesAudioFile && !audioFile) blockers.push('Choose a replacement audio file, or set Audio to Keep or Mute.')
    if (format === 'mp3' && audioMode === 'mute') blockers.push('Audio is muted, so there’s nothing to export as MP3. Set Audio to Keep or Replace.')

    useEscape(() => setIsCropping(false), isCropping)

    // The preview plays at the chosen speed
    useEffect(() => {
        if (videoRef.current) videoRef.current.playbackRate = speed
    }, [speed])

    /* ---------- Preview events ---------- */

    const applyDuration = (sourceId, value, width, height) => {
        if (sourceIdRef.current !== sourceId) return
        const known = Number.isFinite(value) && value > 0
        setMeta({ status: known ? 'ready' : 'no-duration', width, height, duration: known ? value : null })
        if (known) {
            setTrimStartText('0')
            setTrimEndText(value.toFixed(2))
        }
    }

    const handleLoadedMetadata = (event) => {
        const video = event.currentTarget
        const sourceId = source?.id
        const { videoWidth: width, videoHeight: height } = video
        video.playbackRate = speed
        if (!width || !height) {
            setMeta({ status: 'unplayable', width: 0, height: 0, duration: null, reason: 'This browser can’t decode the video’s picture.' })
            return
        }
        if (Number.isFinite(video.duration) && video.duration > 0) {
            applyDuration(sourceId, video.duration, width, height)
            return
        }
        // Cue-less WebM (e.g. MediaRecorder output from other tools): measure it
        setMeta({ status: 'measuring', width, height, duration: null })
        probeVideo(sourceUrl)
            .then(({ duration: measured }) => applyDuration(sourceId, measured, width, height))
            .catch(() => applyDuration(sourceId, null, width, height))
    }

    const handleDurationChange = (event) => {
        const value = event.currentTarget.duration
        if ((meta?.status === 'measuring' || meta?.status === 'no-duration') && Number.isFinite(value) && value > 0) {
            applyDuration(source?.id, value, meta.width, meta.height)
        }
    }

    const handleVideoError = (event) => {
        setMeta({ status: 'unplayable', width: 0, height: 0, duration: null, reason: describeMediaElementError(event.currentTarget.error) })
        setPlaying(false)
    }

    const togglePlay = () => {
        const video = videoRef.current
        if (!video) return
        if (video.paused || video.ended) {
            video.play().catch((err) => {
                if (err?.name !== 'AbortError') toast.error(`Playback failed: ${err?.message || err}`)
            })
        } else {
            video.pause()
        }
    }

    const seek = (event) => {
        const time = Number(event.target.value)
        if (videoRef.current) videoRef.current.currentTime = time
        setCurrentTime(time)
    }

    const saveFrame = () => {
        const video = videoRef.current
        if (!video || !video.videoWidth || video.readyState < 2) {
            toast.warning('The video frame isn’t ready yet. Try again in a moment.')
            return
        }
        const area = cropPx ?? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight }
        const canvas = document.createElement('canvas')
        canvas.width = area.w
        canvas.height = area.h
        canvas.getContext('2d').drawImage(video, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h)
        const stamp = formatClock(video.currentTime, { tenths: true }).replace(/[:.]/g, '-')
        const base = splitFilename(source.file.name).base || 'video'
        canvas.toBlob((blob) => {
            if (!blob) {
                toast.error('This frame couldn’t be captured.')
                return
            }
            downloadBlob(blob, `${base}-frame-${stamp}.png`)
        }, 'image/png')
    }

    /* ---------- Crop ---------- */

    const toggleCropEditing = () => {
        if (isCropping) {
            setIsCropping(false)
            return
        }
        if (!crop && meta?.width) setCrop(initialCrop(ratioFor(aspect), meta.width, meta.height))
        setIsCropping(true)
    }

    const changeAspect = (value) => {
        setAspect(value)
        if (meta?.width) setCrop(initialCrop(ratioFor(value), meta.width, meta.height))
    }

    const removeCrop = () => {
        setCrop(undefined)
        setIsCropping(false)
        setAspect('free')
    }

    /* ---------- Project ---------- */

    const clearProject = () => {
        sourceIdRef.current = 0
        setSource(null)
        setMeta(null)
        setPlaying(false)
        setCurrentTime(0)
        setTrimStartText('0')
        setTrimEndText('')
        setCrop(undefined)
        setIsCropping(false)
        setAspect('free')
        setSpeed(1)
        setAudioMode('keep')
        setAudioFile(null)
        setFade('none')
        setResult(null)
        setExportError(null)
        setConfirmClear(false)
    }

    const requestClear = () => {
        if (unsavedRecording) setConfirmClear(true)
        else clearProject()
    }

    const downloadOriginal = () => {
        if (!source) return
        downloadBlob(source.file, source.file.name)
        setSource((prev) => (prev ? { ...prev, saved: true } : prev))
    }

    /* ---------- Export ---------- */

    const cancelExport = () => {
        if (!jobRef.current) return
        jobRef.current = null
        setJob(null)
        // ffmpeg.wasm can only be interrupted by terminating its worker;
        // a fresh engine is loaded in the background for the next export.
        disposeEngine()
        ensureEngine().catch(() => {})
        toast.info('Export cancelled.')
    }

    const runExport = async () => {
        if (!source || jobRef.current || blockers.length) return
        const settings = {
            format,
            trim,
            speed,
            crop: cropPx,
            fade: effectiveFade,
            audioMode: format === 'gif' ? 'mute' : audioMode,
            audioFile: usesAudioFile ? audioFile : null,
            maxHeight,
            gifFps,
            gifWidth,
            width: meta?.width || 0,
            height: meta?.height || 0,
            outDuration,
        }
        const sourceFile = source.file
        const sourceId = source.id
        const info = { id: ++jobSeq.current, outDuration: format === 'gif' ? null : outDuration }
        const isCurrent = () => jobRef.current === info
        jobRef.current = info
        setIsCropping(false)
        setResult(null)
        setExportError(null)
        setJob({ id: info.id, phase: 'engine', progress: null })

        let ffmpeg
        try {
            ffmpeg = await ensureEngine()
        } catch (err) {
            if (isCurrent()) {
                jobRef.current = null
                setJob(null)
                setExportError({ title: 'The video engine couldn’t load', message: describeEngineError(err), details: '' })
            }
            return
        }
        if (!isCurrent()) return

        const spec = FORMATS[settings.format]
        const dir = `/job${info.id}`
        const outPath = `/output${info.id}.${spec.ext}`
        const inputName = `input.${safeExtension(sourceFile.name, 'mp4')}`
        const audioName = settings.audioFile ? `audio.${safeExtension(settings.audioFile.name, 'mp3')}` : null
        const written = []
        let mounted = false
        try {
            setJob({ id: info.id, phase: 'reading', progress: null })
            await ffmpeg.createDir(dir)
            const files = [new File([sourceFile], inputName)]
            if (audioName) files.push(new File([settings.audioFile], audioName))
            try {
                // Read the files lazily from disk instead of copying them into memory
                await ffmpeg.mount('WORKERFS', { files }, dir)
                mounted = true
            } catch {
                for (const file of files) {
                    await ffmpeg.writeFile(`${dir}/${file.name}`, new Uint8Array(await file.arrayBuffer()))
                    written.push(`${dir}/${file.name}`)
                }
            }
            if (!isCurrent()) return
            const paths = { input: `${dir}/${inputName}`, audio: audioName ? `${dir}/${audioName}` : null, output: outPath }

            // Probe the streams (codecs decide between stream copy and re-encode)
            logRef.current = []
            await ffmpeg.exec(['-hide_banner', '-i', paths.input, ...(paths.audio ? ['-i', paths.audio] : [])])
            if (!isCurrent()) return
            const plan = buildExportPlan(settings, parseFfmpegInfo(logRef.current), paths)

            setJob({ id: info.id, phase: 'encoding', progress: info.outDuration ? 0 : null })
            let data = null
            for (const args of plan) {
                logRef.current = []
                let code
                try {
                    code = await ffmpeg.exec(['-hide_banner', ...args])
                } catch (err) {
                    // A wasm crash (e.g. "memory access out of bounds") leaves the
                    // engine unusable; anything else here is a cancel.
                    if (isCurrent()) err.crashed = true
                    throw err
                }
                if (!isCurrent()) return
                if (code === 0) {
                    const output = await ffmpeg.readFile(outPath).catch(() => null)
                    if (output && output.byteLength > 0) {
                        data = output
                        break
                    }
                }
                await ffmpeg.deleteFile(outPath).catch(() => {})
            }
            if (!data) throw new Error('ffmpeg produced no output')

            const blob = new Blob([data], { type: spec.mime })
            const name = `${splitFilename(sourceFile.name).base || 'video'}-edited.${spec.ext}`
            downloadBlob(blob, name)
            setResult({ blob, name, size: blob.size })
            setSource((prev) => (prev && prev.id === sourceId ? { ...prev, saved: true } : prev))
        } catch (err) {
            if (isCurrent()) {
                setExportError(describeExportError(err, logRef.current))
                if (err?.crashed && engineRef.current?.ffmpeg === ffmpeg) {
                    disposeEngine()
                    ensureEngine().catch(() => {})
                }
            }
        } finally {
            if (isCurrent()) {
                jobRef.current = null
                setJob(null)
            }
            if (engineRef.current?.ffmpeg === ffmpeg) {
                await ffmpeg.deleteFile(outPath).catch(() => {})
                if (mounted) await ffmpeg.unmount(dir).catch(() => {})
                for (const path of written) await ffmpeg.deleteFile(path).catch(() => {})
                await ffmpeg.deleteDir(dir).catch(() => {})
            }
        }
    }

    /* ---------- Render ---------- */

    const heightOptions = HEIGHTS.filter((h) => !meta?.height || h < meta.height)
    const trimSummary = duration == null
        ? (meta?.status === 'measuring' ? 'Measuring the video’s length…' : 'Trimming needs the video’s length, which couldn’t be read.')
        : trim.valid
            ? `Keeps ${formatClock(trim.start, { tenths: true })} – ${formatClock(trim.end, { tenths: true })} (${(trim.end - trim.start).toFixed(1)} s)${speed !== 1 && outDuration != null ? `, ${outDuration.toFixed(1)} s at ${speed}×` : ''}.`
            : 'Fix the times above.'

    return (
        <div className="page page-wide">
            <ToolHeader />

            {!source ? (
                <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                    <FileDropZone
                        accept={VIDEO_ACCEPT}
                        onFiles={([file]) => loadSource(file)}
                        icon={Film}
                        label="Drop a video here or click to browse"
                        hint="MP4, WebM, MOV, MKV and more. Files are processed on your device and never uploaded."
                        style={{ minHeight: 220 }}
                    />
                    <p className="field-hint" style={{ marginTop: 0, textAlign: 'center' }}>
                        Trim, crop, change the speed, add fades, replace the audio, and export MP4, WebM, GIF or MP3.
                    </p>
                </section>
            ) : (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: pane.size === 'sm' ? 'minmax(0, 1fr)' : pane.size === 'md' ? 'minmax(0, 1fr) minmax(270px, 320px)' : 'minmax(0, 1fr) minmax(300px, 380px)',
                        gap: 'var(--space-lg)',
                        alignItems: 'start',
                    }}
                >
                    {/* Preview column */}
                    <div style={{ display: 'grid', gap: 'var(--space-md)', minWidth: 0 }}>
                        <div className="card card-compact" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }}>
                            <Film size={18} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                            <div style={{ minWidth: 0, flex: '1 1 180px' }}>
                                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={source.file.name}>
                                    {source.file.name}
                                </div>
                                <div className="field-hint" style={{ marginTop: 0 }}>
                                    {formatBytes(source.file.size)}
                                    {duration != null && ` · ${formatClock(duration, { tenths: true })}`}
                                    {meta?.width ? ` · ${meta.width}×${meta.height}` : ''}
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                                {source.fromRecorder && (
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={downloadOriginal}>
                                        <Download size={14} aria-hidden="true" /> Download original
                                    </button>
                                )}
                                <button type="button" className="btn btn-ghost btn-sm" onClick={requestClear} disabled={exporting}>
                                    <X size={14} aria-hidden="true" /> Clear project
                                </button>
                            </div>
                        </div>

                        {unsavedRecording && (
                            <StatusBanner tone="info" title="Recording from Screen Recorder">
                                It only exists in this tab until you export it or download the original.
                            </StatusBanner>
                        )}
                        {meta?.status === 'unplayable' && (
                            <StatusBanner tone="warning" title="This browser can’t preview this video">
                                {meta.reason} You can still convert it: pick a format and export. Trimming, cropping, fades and frame snapshots need a preview.
                            </StatusBanner>
                        )}
                        {meta?.status === 'no-duration' && (
                            <StatusBanner tone="warning" title="The video’s length couldn’t be read">
                                Trimming and fade-out are unavailable, but you can still crop, change the speed and convert it.
                            </StatusBanner>
                        )}

                        <div
                            className="stage"
                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 220, border: '1px solid var(--border)' }}
                        >
                            {meta?.status === 'unplayable' ? (
                                <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-xl)', textAlign: 'center' }}>
                                    <Film size={36} aria-hidden="true" style={{ opacity: 0.7 }} />
                                    <div style={{ fontWeight: 600 }}>Preview unavailable</div>
                                </div>
                            ) : (
                                <ReactCrop
                                    crop={canPreview ? crop : undefined}
                                    onChange={(_, percentCrop) => setCrop(percentCrop)}
                                    aspect={ratioFor(aspect)}
                                    disabled={!isCropping || exporting}
                                    keepSelection
                                    ruleOfThirds={isCropping}
                                    style={{ maxHeight: 'min(62vh, 560px)' }}
                                >
                                    <video
                                        key={source.id}
                                        ref={videoRef}
                                        src={sourceUrl ?? undefined}
                                        playsInline
                                        preload="metadata"
                                        aria-label={`Preview of ${source.file.name}`}
                                        onLoadedMetadata={handleLoadedMetadata}
                                        onDurationChange={handleDurationChange}
                                        onError={handleVideoError}
                                        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                                        onPlay={() => setPlaying(true)}
                                        onPause={() => setPlaying(false)}
                                        onEnded={() => setPlaying(false)}
                                        style={{ display: 'block', maxWidth: '100%' }}
                                    />
                                </ReactCrop>
                            )}
                        </div>

                        <div className="card card-compact" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-md)' }}>
                            <button type="button" className="icon-btn" onClick={togglePlay} disabled={!canPreview} aria-label={playing ? 'Pause' : 'Play'}>
                                {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                            </button>
                            <input
                                type="range"
                                min={0}
                                max={duration ?? 0}
                                step={0.01}
                                value={Math.min(currentTime, duration ?? 0)}
                                onChange={seek}
                                disabled={!canPreview || duration == null}
                                aria-label="Seek"
                                aria-valuetext={`${formatClock(currentTime)} of ${formatClock(duration)}`}
                                style={{ flex: '1 1 160px', minWidth: 0 }}
                            />
                            <span className="mono" style={{ fontSize: '0.85rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                                {formatClock(currentTime, { tenths: true })} / {meta?.status === 'measuring' ? 'measuring…' : formatClock(duration, { tenths: true })}
                            </span>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={saveFrame} disabled={!canPreview}>
                                <Camera size={14} aria-hidden="true" /> Save frame
                            </button>
                        </div>
                    </div>

                    {/* Tools column */}
                    <div style={{ display: 'grid', gap: 'var(--space-md)', minWidth: 0 }}>
                        <section className="card card-compact" aria-labelledby={`${id}-edit`}>
                            <fieldset disabled={exporting} style={fieldsetStyle}>
                                <h2 id={`${id}-edit`} className="section-title">
                                    <SlidersHorizontal size={16} aria-hidden="true" /> Edit
                                </h2>

                                <div>
                                    <h3 className="field-label" style={subheading}><Scissors size={14} aria-hidden="true" /> Trim</h3>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 110px), 1fr))', gap: 'var(--space-sm)' }}>
                                        <Field label="Start (s)" error={trim.errors.start}>
                                            <input type="number" inputMode="decimal" min="0" step="0.1" value={trimStartText} onChange={(e) => setTrimStartText(e.target.value)} disabled={duration == null} style={compactField} />
                                        </Field>
                                        <Field label="End (s)" error={trim.errors.end}>
                                            <input type="number" inputMode="decimal" min="0" step="0.1" value={trimEndText} onChange={(e) => setTrimEndText(e.target.value)} disabled={duration == null} style={compactField} />
                                        </Field>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', marginTop: 'var(--space-sm)' }}>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTrimStartText(currentTime.toFixed(2))} disabled={duration == null} title="Set the start to the current playback position">
                                            Start at {formatClock(currentTime, { tenths: true })}
                                        </button>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setTrimEndText(currentTime.toFixed(2))} disabled={duration == null} title="Set the end to the current playback position">
                                            End at {formatClock(currentTime, { tenths: true })}
                                        </button>
                                    </div>
                                    <div className="field-hint">{trimSummary}</div>
                                </div>

                                <div>
                                    <h3 className="field-label" style={subheading}><CropIcon size={14} aria-hidden="true" /> Crop</h3>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                                        <button type="button" className={`btn btn-sm ${isCropping ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={isCropping} onClick={toggleCropEditing} disabled={!canPreview}>
                                            <CropIcon size={14} aria-hidden="true" /> {isCropping ? 'Done' : crop ? 'Adjust crop' : 'Crop video'}
                                        </button>
                                        {crop && (
                                            <button type="button" className="btn btn-ghost btn-sm" onClick={removeCrop}>
                                                <X size={14} aria-hidden="true" /> Remove crop
                                            </button>
                                        )}
                                    </div>
                                    {isCropping && (
                                        <SegmentedControl size="sm" ariaLabel="Crop aspect ratio" value={aspect} onChange={changeAspect} options={ASPECTS} style={{ marginTop: 'var(--space-sm)' }} />
                                    )}
                                    <div className="field-hint">
                                        {isCropping
                                            ? 'Drag the box on the video to choose the area to keep. Press Done or Esc when you’re finished.'
                                            : cropPx
                                                ? `Exports ${cropPx.w}×${cropPx.h} pixels from (${cropPx.x}, ${cropPx.y}).`
                                                : 'Full frame.'}
                                    </div>
                                </div>

                                <div>
                                    <h3 className="field-label" style={subheading}>Speed</h3>
                                    <SegmentedControl size="sm" ariaLabel="Speed" value={speed} onChange={setSpeed} options={SPEED_OPTIONS} />
                                </div>

                                <div>
                                    <h3 className="field-label" style={subheading}><Music size={14} aria-hidden="true" /> Audio</h3>
                                    <SegmentedControl
                                        size="sm"
                                        ariaLabel="Audio"
                                        value={audioMode}
                                        onChange={setAudioMode}
                                        disabled={format === 'gif'}
                                        options={[
                                            { value: 'keep', label: 'Keep' },
                                            { value: 'mute', label: 'Mute' },
                                            { value: 'replace', label: 'Replace' },
                                        ]}
                                    />
                                    {format === 'gif' && <div className="field-hint">GIFs have no sound.</div>}
                                    {format !== 'gif' && audioMode === 'replace' && (
                                        <div style={{ marginTop: 'var(--space-sm)' }}>
                                            {audioFile ? (
                                                <div className="chip is-active" style={{ maxWidth: '100%', paddingRight: 4 }}>
                                                    <Music size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
                                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={audioFile.name}>{audioFile.name}</span>
                                                    <button type="button" className="icon-btn icon-btn-sm" onClick={() => setAudioFile(null)} aria-label={`Remove ${audioFile.name}`}>
                                                        <X size={14} aria-hidden="true" />
                                                    </button>
                                                </div>
                                            ) : (
                                                <FileDropZone
                                                    compact
                                                    accept={AUDIO_ACCEPT}
                                                    onFiles={([file]) => setAudioFile(file)}
                                                    icon={Music}
                                                    label="Choose an audio file"
                                                    hint="MP3, WAV, M4A, OGG…"
                                                    disabled={exporting}
                                                />
                                            )}
                                            <div className="field-hint">Plays from its start and is cut to the video’s length. It isn’t sped up.</div>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <h3 className="field-label" style={subheading}>Fade ({FADE_SECONDS} s)</h3>
                                    <SegmentedControl
                                        size="sm"
                                        ariaLabel="Fade"
                                        value={fade}
                                        onChange={setFade}
                                        options={[
                                            { value: 'none', label: 'None' },
                                            { value: 'in', label: 'In' },
                                            { value: 'out', label: 'Out', disabled: duration == null, title: duration == null ? 'Needs the video’s length' : undefined },
                                            { value: 'both', label: 'In + out', disabled: duration == null, title: duration == null ? 'Needs the video’s length' : undefined },
                                        ]}
                                    />
                                    {fade !== 'none' && <div className="field-hint">Fades to and from black{format === 'gif' ? '' : ', and fades the sound'}.</div>}
                                </div>
                            </fieldset>
                        </section>

                        <section className="card card-compact" aria-labelledby={`${id}-export`} style={{ display: 'grid', gap: 'var(--space-md)' }}>
                            <h2 id={`${id}-export`} className="section-title">
                                <Download size={16} aria-hidden="true" /> Export
                            </h2>
                            <fieldset disabled={exporting} style={fieldsetStyle}>
                                <Field label="Format">
                                    <select value={format} onChange={(e) => setFormat(e.target.value)} style={compactField}>
                                        {Object.entries(FORMATS).map(([value, spec]) => <option key={value} value={value}>{spec.label}</option>)}
                                    </select>
                                </Field>
                                {(format === 'mp4' || format === 'webm') && (
                                    <Field label="Resolution" hint="Videos are never upscaled.">
                                        <select value={maxHeight} onChange={(e) => setMaxHeight(e.target.value)} style={compactField}>
                                            <option value="original">Original{meta?.width ? ` (${(cropPx?.w ?? meta.width)}×${(cropPx?.h ?? meta.height)})` : ''}</option>
                                            {heightOptions.map((h) => <option key={h} value={String(h)}>{h}p</option>)}
                                        </select>
                                    </Field>
                                )}
                                {format === 'gif' && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 'var(--space-sm)' }}>
                                        <Field label="Frame rate">
                                            <select value={gifFps} onChange={(e) => setGifFps(Number(e.target.value))} style={compactField}>
                                                {GIF_FPS_OPTIONS.map((value) => <option key={value} value={value}>{value} fps</option>)}
                                            </select>
                                        </Field>
                                        <Field label="Width">
                                            <select value={gifWidth} onChange={(e) => setGifWidth(Number(e.target.value))} style={compactField}>
                                                {GIF_WIDTHS.map((value) => <option key={value} value={value}>{value} px</option>)}
                                            </select>
                                        </Field>
                                    </div>
                                )}
                            </fieldset>

                            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={runExport} disabled={exporting || blockers.length > 0}>
                                    {exporting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                                    {exporting ? 'Exporting…' : `Export ${FORMATS[format].short}`}
                                </button>
                                {exporting && (
                                    <button type="button" className="btn btn-secondary" onClick={cancelExport}>Cancel</button>
                                )}
                            </div>
                            {job && <ProgressBar value={job.progress} label={JOB_LABELS[job.phase]} />}
                            {!exporting && blockers.length > 0 && <div className="field-hint" style={{ marginTop: 0, color: 'var(--warning)' }}>{blockers[0]}</div>}
                            {exportError && (
                                <StatusBanner tone="danger" title={exportError.title}>
                                    {exportError.message}
                                    {exportError.details && (
                                        <details style={{ marginTop: 'var(--space-xs)' }}>
                                            <summary style={{ cursor: 'pointer' }}>Technical details</summary>
                                            <pre className="code-well" style={{ marginTop: 'var(--space-xs)', fontSize: '0.75rem', maxHeight: 160 }}>{exportError.details}</pre>
                                        </details>
                                    )}
                                </StatusBanner>
                            )}
                            {result && (
                                <StatusBanner
                                    tone="success"
                                    title="Export finished"
                                    action={(
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadBlob(result.blob, result.name)}>
                                            Download again
                                        </button>
                                    )}
                                >
                                    {result.name} · {formatBytes(result.size)}
                                </StatusBanner>
                            )}
                            <EngineStatus engine={engine} onRetry={retryEngine} />
                        </section>
                    </div>
                </div>
            )}

            <Modal
                open={confirmClear}
                onClose={() => setConfirmClear(false)}
                title="Discard this recording?"
                size="sm"
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setConfirmClear(false)}>Keep it</button>
                        <button type="button" className="btn btn-danger" onClick={clearProject}>Discard</button>
                    </>
                )}
            >
                <p style={{ color: 'var(--text-muted)' }}>
                    The recording from Screen Recorder hasn’t been exported or downloaded, so it will be lost.
                </p>
            </Modal>

            <Modal
                open={pendingMedia !== null}
                onClose={() => setPendingMedia(null)}
                title="Open the new recording?"
                size="sm"
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setPendingMedia(null)}>Keep current</button>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                                if (jobRef.current) cancelExport()
                                if (pendingMedia) loadSource(pendingMedia.file, { fromRecorder: pendingMedia.fromRecorder })
                                setPendingMedia(null)
                            }}
                        >
                            Open new recording
                        </button>
                    </>
                )}
            >
                <p style={{ color: 'var(--text-muted)' }}>
                    The recording that’s open now hasn’t been exported or downloaded. Opening the new one discards it.
                </p>
            </Modal>
        </div>
    )
}
