// Media helpers shared by the Screen Recorder and the Video Studio.

import { drawCameraBubble, drawContained } from '../workers/compositing.js'

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

// 75.4 -> "01:15", 3725 -> "1:02:05"; with tenths: "01:15.4"
export function formatClock(seconds, { tenths = false } = {}) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
    const total = tenths ? Math.floor(seconds * 10) / 10 : Math.floor(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total - h * 3600 - m * 60
    const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')
    const mm = String(m).padStart(2, '0')
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// "2026-10-18-142233" for file names
export function fileTimestamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

/* ------------------------------------------------------------------------ */
/* MediaRecorder                                                            */
/* ------------------------------------------------------------------------ */

// VP8 first: it is the lightest real-time encoder, so recording doesn't make
// the machine stutter. Safari only records MP4.
const RECORDER_TYPES = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
]

// The first container/codec combination this browser can record, or '' to let
// the browser choose.
export function pickRecorderMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return ''
    return RECORDER_TYPES.find((type) => {
        try {
            return MediaRecorder.isTypeSupported(type)
        } catch {
            return false
        }
    }) ?? ''
}

export function extensionForType(type = '') {
    if (/mp4/i.test(type)) return 'mp4'
    if (/matroska/i.test(type)) return 'mkv'
    return 'webm'
}

// Screen content compresses well; scale the bitrate with the pixel rate.
export function recorderBitrate(width = 1920, height = 1080, frameRate = 30) {
    const bps = (width || 1920) * (height || 1080) * Math.min(frameRate || 30, 60) * 0.05
    return Math.round(Math.min(10_000_000, Math.max(2_500_000, bps)))
}

/* ------------------------------------------------------------------------ */
/* WebM duration fix                                                        */
/* ------------------------------------------------------------------------ */
//
// Chromium's MediaRecorder writes live WebM files: the Segment has an unknown
// size and the Info element has no Duration, so <video>.duration is Infinity
// (no seek bar maximum, broken trims and fades, endless GIF capture).
// fixWebmDuration() writes the measured duration into Segment > Info. Only the
// first few KB are rewritten; the rest of the file is reused as-is.

const EBML_ID = 0x1a45dfa3
const SEGMENT_ID = 0x18538067
const SEEK_HEAD_ID = 0x114d9b74
const INFO_ID = 0x1549a966
const TIMECODE_SCALE_ID = 0x2ad7b1
const DURATION_ID = 0x4489
const CLUSTER_ID = 0x1f43b675

function readVint(bytes, pos, keepMarker) {
    const first = bytes[pos]
    if (first === undefined || first === 0) return null
    let length = 1
    let mask = 0x80
    while (!(first & mask)) {
        length += 1
        mask >>= 1
    }
    if (pos + length > bytes.length) return null
    let value = keepMarker ? first : first & (mask - 1)
    let allOnes = (first & (mask - 1)) === mask - 1
    for (let i = 1; i < length; i++) {
        value = value * 256 + bytes[pos + i]
        if (bytes[pos + i] !== 0xff) allOnes = false
    }
    return { value, length, unknown: !keepMarker && allOnes }
}

function readElement(bytes, pos) {
    const id = readVint(bytes, pos, true)
    if (!id || id.length > 4) return null
    const size = readVint(bytes, pos + id.length, false)
    if (!size) return null
    const dataStart = pos + id.length + size.length
    return {
        id: id.value,
        start: pos,
        idLength: id.length,
        sizeLength: size.length,
        size: size.value,
        sizeUnknown: size.unknown,
        dataStart,
        end: size.unknown ? Infinity : dataStart + size.value,
    }
}

function readUint(bytes, pos, length) {
    let value = 0
    for (let i = 0; i < length; i++) value = value * 256 + bytes[pos + i]
    return value
}

function encodeSize(value, length) {
    if (value > 2 ** (7 * length) - 2) return null
    const out = new Uint8Array(length)
    let rest = value
    for (let i = length - 1; i >= 0; i--) {
        out[i] = rest % 256
        rest = Math.floor(rest / 256)
    }
    out[0] |= 0x80 >> (length - 1)
    return out
}

function minimalSizeLength(value) {
    let length = 1
    while (length < 8 && value > 2 ** (7 * length) - 2) length += 1
    return length
}

/**
 * Returns a copy of a WebM/Matroska blob whose header carries `durationMs`.
 * Returns the original blob when it isn't WebM or can't be patched safely.
 */
export async function fixWebmDuration(blob, durationMs) {
    if (!blob || !(durationMs > 0) || !/webm|matroska/i.test(blob.type || '')) return blob
    try {
        const bytes = new Uint8Array(await blob.slice(0, Math.min(blob.size, 256 * 1024)).arrayBuffer())
        const ebml = readElement(bytes, 0)
        if (!ebml || ebml.id !== EBML_ID || ebml.sizeUnknown) return blob
        const segment = readElement(bytes, ebml.end)
        if (!segment || segment.id !== SEGMENT_ID) return blob

        // Find Segment > Info (it comes before Tracks and the first Cluster)
        let info = null
        let hasSeekHead = false
        for (let pos = segment.dataStart; pos < bytes.length;) {
            const el = readElement(bytes, pos)
            if (!el) break
            if (el.id === INFO_ID) {
                info = el
                break
            }
            if (el.id === SEEK_HEAD_ID) hasSeekHead = true
            if (el.id === CLUSTER_ID || el.sizeUnknown) break
            pos = el.end
        }
        if (!info || info.sizeUnknown || info.end > bytes.length) return blob

        let timecodeScale = 1_000_000
        let duration = null
        for (let pos = info.dataStart; pos < info.end;) {
            const el = readElement(bytes, pos)
            if (!el || el.sizeUnknown || el.end > info.end) return blob
            if (el.id === TIMECODE_SCALE_ID) timecodeScale = readUint(bytes, el.dataStart, el.size) || 1_000_000
            else if (el.id === DURATION_ID) duration = el
            pos = el.end
        }
        const value = (durationMs * 1_000_000) / timecodeScale

        if (duration) {
            // Overwrite in place: nothing moves
            if (duration.size !== 4 && duration.size !== 8) return blob
            const head = bytes.slice(0, info.end)
            const view = new DataView(head.buffer)
            if (duration.size === 8) view.setFloat64(duration.dataStart, value)
            else view.setFloat32(duration.dataStart, value)
            return new Blob([head, blob.slice(info.end)], { type: blob.type })
        }

        // Inserting bytes shifts everything after Info. That's only safe in live
        // files (unknown Segment size, no SeekHead or Cues pointing at offsets).
        if (hasSeekHead || !segment.sizeUnknown) return blob

        const durationEl = new Uint8Array(11)
        durationEl.set([0x44, 0x89, 0x88])
        new DataView(durationEl.buffer).setFloat64(3, value)
        const newInfoSize = info.size + durationEl.length
        const sizeBytes = encodeSize(newInfoSize, info.sizeLength) ?? encodeSize(newInfoSize, minimalSizeLength(newInfoSize))
        return new Blob([
            bytes.subarray(0, info.start + info.idLength),
            sizeBytes,
            bytes.subarray(info.dataStart, info.end),
            durationEl,
            blob.slice(info.end),
        ], { type: blob.type })
    } catch {
        return blob
    }
}

/* ------------------------------------------------------------------------ */
/* <video> helpers                                                          */
/* ------------------------------------------------------------------------ */

const isKnownDuration = (d) => Number.isFinite(d) && d > 0

export function describeMediaElementError(error) {
    switch (error?.code) {
        case 1: return 'Loading was aborted.'
        case 2: return 'A network error interrupted loading.'
        case 3: return 'The file is damaged or uses features this browser can’t decode.'
        case 4: return 'This browser can’t play this format or codec.'
        default: return error?.message || 'The video couldn’t be loaded.'
    }
}

function createHiddenVideo(src) {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    if (src) video.src = src
    return video
}

function releaseVideo(video) {
    video.pause()
    video.removeAttribute('src')
    video.srcObject = null
    video.load()
}

// Resolves with the real duration of an element whose duration is Infinity
// (cue-less WebM): seeking far past the end makes the browser scan the file.
function measureDuration(video, timeout) {
    if (isKnownDuration(video.duration)) return Promise.resolve(video.duration)
    return new Promise((resolve) => {
        let timer = 0
        const done = (value) => {
            clearTimeout(timer)
            video.removeEventListener('durationchange', check)
            video.removeEventListener('timeupdate', check)
            video.removeEventListener('seeked', check)
            resolve(value)
        }
        const check = () => {
            if (isKnownDuration(video.duration)) done(video.duration)
        }
        timer = setTimeout(() => done(null), timeout)
        video.addEventListener('durationchange', check)
        video.addEventListener('timeupdate', check)
        video.addEventListener('seeked', check)
        video.currentTime = 1e101
    })
}

function waitFor(video, okEvent) {
    return new Promise((resolve, reject) => {
        const ok = () => {
            video.removeEventListener('error', fail)
            resolve()
        }
        const fail = () => {
            video.removeEventListener(okEvent, ok)
            reject(new Error(describeMediaElementError(video.error)))
        }
        video.addEventListener(okEvent, ok, { once: true })
        video.addEventListener('error', fail, { once: true })
    })
}

/**
 * Reads the duration and size of a video URL in a hidden element, working
 * around Infinity durations. Resolves { duration (null if unknown), width, height }.
 */
export async function probeVideo(src, { timeout = 8000 } = {}) {
    const video = createHiddenVideo()
    video.preload = 'metadata'
    try {
        const loaded = waitFor(video, 'loadedmetadata')
        video.src = src
        await loaded
        const duration = await measureDuration(video, timeout)
        return { duration, width: video.videoWidth, height: video.videoHeight }
    } finally {
        releaseVideo(video)
    }
}

export function seekVideo(video, time) {
    return new Promise((resolve, reject) => {
        const onSeeked = () => {
            video.removeEventListener('error', onError)
            resolve()
        }
        const onError = () => {
            video.removeEventListener('seeked', onSeeked)
            reject(new Error(describeMediaElementError(video.error)))
        }
        video.addEventListener('seeked', onSeeked, { once: true })
        video.addEventListener('error', onError, { once: true })
        video.currentTime = time
    })
}

function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The frame couldn’t be encoded.'))), type, quality)
    })
}

/**
 * Grabs evenly spaced frames from a video blob by seeking (deterministic, and
 * independent of playback speed or tab visibility). Each frame is a PNG blob
 * URL; the caller must revoke them. Covers at most maxFrames / fps seconds.
 */
export async function captureFrames(blob, { fps = 10, maxFrames = 200, maxWidth = 640, onProgress, isCancelled } = {}) {
    const src = URL.createObjectURL(blob)
    const video = createHiddenVideo()
    const urls = []
    try {
        const loaded = waitFor(video, 'loadeddata')
        video.src = src
        await loaded
        const duration = await measureDuration(video, 8000)
        if (!duration) throw new Error('The recording’s length couldn’t be read.')
        if (!video.videoWidth || !video.videoHeight) throw new Error('The recording has no picture.')

        const scale = Math.min(1, maxWidth / video.videoWidth)
        const width = Math.max(2, Math.round(video.videoWidth * scale))
        const height = Math.max(2, Math.round(video.videoHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        const total = Math.max(1, Math.min(maxFrames, Math.floor(duration * fps)))

        for (let i = 0; i < total; i++) {
            if (isCancelled?.()) throw new DOMException('Cancelled', 'AbortError')
            await seekVideo(video, Math.min(i / fps, Math.max(0, duration - 0.05)))
            ctx.drawImage(video, 0, 0, width, height)
            urls.push(URL.createObjectURL(await canvasToBlob(canvas, 'image/png')))
            onProgress?.((i + 1) / total)
        }
        return { urls, width, height, fps, duration, truncated: duration * fps > maxFrames + 0.5 }
    } catch (err) {
        urls.forEach((url) => URL.revokeObjectURL(url))
        throw err
    } finally {
        releaseVideo(video)
        URL.revokeObjectURL(src)
    }
}

/* ------------------------------------------------------------------------ */
/* Screen + camera compositing                                              */
/* ------------------------------------------------------------------------ */

/**
 * How the camera bubble can be composited in this browser:
 * - 'worker': frames go through MediaStreamTrackProcessor/Generator and a
 *   worker, so recording continues while the tab is hidden (Chromium).
 * - 'canvas': a canvas fallback; browsers may pause it in background tabs.
 */
export function compositingMode() {
    if (typeof window === 'undefined') return 'canvas'
    const ok = typeof window.MediaStreamTrackProcessor === 'function'
        && typeof window.MediaStreamTrackGenerator === 'function'
        && typeof window.OffscreenCanvas === 'function'
        && typeof window.VideoFrame === 'function'
        && typeof window.Worker === 'function'
    return ok ? 'worker' : 'canvas'
}

function startWorkerCompositor(screenTrack, cameraTrack, width, height, fps) {
    const screen = new window.MediaStreamTrackProcessor({ track: screenTrack })
    const camera = new window.MediaStreamTrackProcessor({ track: cameraTrack })
    const generator = new window.MediaStreamTrackGenerator({ kind: 'video' })
    const worker = new Worker(new URL('../workers/compositor.worker.js', import.meta.url), { type: 'module' })
    try {
        worker.postMessage(
            { type: 'start', screen: screen.readable, camera: camera.readable, output: generator.writable, width, height, fps },
            [screen.readable, camera.readable, generator.writable],
        )
    } catch (err) {
        worker.terminate()
        generator.stop()
        throw err
    }
    return {
        mode: 'worker',
        track: generator,
        stop() {
            worker.postMessage({ type: 'stop' })
            setTimeout(() => worker.terminate(), 500)
            generator.stop()
        },
    }
}

async function startCanvasCompositor(screenTrack, cameraTrack, width, height, fps) {
    const screenVideo = createHiddenVideo()
    const cameraVideo = createHiddenVideo()
    screenVideo.srcObject = new MediaStream([screenTrack])
    cameraVideo.srcObject = new MediaStream([cameraTrack])
    await Promise.all([screenVideo.play(), cameraVideo.play()])

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: false })
    const draw = () => {
        drawContained(ctx, screenVideo, screenVideo.videoWidth, screenVideo.videoHeight, width, height)
        drawCameraBubble(ctx, cameraVideo, cameraVideo.videoWidth, cameraVideo.videoHeight, width, height)
    }
    draw()
    // Window timers and requestAnimationFrame are throttled in background tabs;
    // ticks posted by a worker keep arriving.
    const ticker = new Worker(new URL('../workers/ticker.worker.js', import.meta.url), { type: 'module' })
    ticker.onmessage = draw
    ticker.postMessage({ fps })
    const track = canvas.captureStream(fps).getVideoTracks()[0]
    return {
        mode: 'canvas',
        track,
        stop() {
            ticker.terminate()
            track.stop()
            releaseVideo(screenVideo)
            releaseVideo(cameraVideo)
        },
    }
}

/**
 * Composites the screen and a round camera bubble into one video track.
 * Resolves { mode, track, stop() }.
 */
export async function startCompositor({ screenTrack, cameraTrack, fps = 30 }) {
    const settings = screenTrack.getSettings()
    const width = Math.max(2, Math.round((settings.width || 1920) / 2) * 2)
    const height = Math.max(2, Math.round((settings.height || 1080) / 2) * 2)
    if (compositingMode() === 'worker') {
        try {
            return startWorkerCompositor(screenTrack, cameraTrack, width, height, fps)
        } catch {
            // Streams not transferable here: fall back to the canvas path
        }
    }
    return startCanvasCompositor(screenTrack, cameraTrack, width, height, fps)
}

/* ------------------------------------------------------------------------ */
/* ffmpeg.wasm                                                              */
/* ------------------------------------------------------------------------ */

async function fetchToObjectURL(url, type, onProgress) {
    let response
    try {
        response = await fetch(url)
    } catch {
        throw new Error('Couldn’t download the video engine. Check your connection and try again.')
    }
    if (!response.ok) throw new Error(`Couldn’t download the video engine (HTTP ${response.status}).`)
    const total = Number(response.headers.get('content-length')) || 0
    if (!onProgress || !response.body) {
        return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type }))
    }
    const reader = response.body.getReader()
    const chunks = []
    let received = 0
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        onProgress(total && received <= total ? received / total : null)
    }
    return URL.createObjectURL(new Blob(chunks, { type }))
}

/**
 * Loads the self-hosted single-threaded ffmpeg core into an FFmpeg instance.
 * The core is fetched into temporary blob URLs that are released as soon as
 * the worker has compiled it. onProgress(fraction | null) reports the download.
 */
export async function loadFFmpegCore(ffmpeg, onProgress) {
    const base = `${window.location.origin}${import.meta.env.BASE_URL || '/'}ffmpeg/`
    const coreURL = await fetchToObjectURL(`${base}ffmpeg-core.js`, 'text/javascript')
    let wasmURL = null
    try {
        wasmURL = await fetchToObjectURL(`${base}ffmpeg-core.wasm`, 'application/wasm', onProgress)
        // workerURL: the single-threaded core never starts a pthread worker,
        // but ffmpeg.wasm would otherwise try to resolve one next to the core.
        await ffmpeg.load({ coreURL, wasmURL, workerURL: coreURL })
    } finally {
        URL.revokeObjectURL(coreURL)
        if (wasmURL) URL.revokeObjectURL(wasmURL)
    }
}

// Seconds from an ffmpeg stats line ("... time=00:01:02.50 bitrate=...").
export function parseFfmpegTime(line) {
    const m = /time=\s*(-?\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line)
    if (!m) return null
    const value = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
    return value >= 0 ? value : null
}

/**
 * Parses `ffmpeg -i …` output into
 * { inputs: [{ duration, video: { codec, width, height, fps } | null, audio: { codec } | null }] }.
 */
export function parseFfmpegInfo(lines) {
    const inputs = []
    let current = -1
    for (const raw of lines) {
        const line = String(raw)
        let m = /^\s*Input #(\d+),/.exec(line)
        if (m) {
            current = Number(m[1])
            inputs[current] = { duration: null, video: null, audio: null }
            continue
        }
        if (/^\s*Output #/.test(line)) current = -1
        if (current < 0) continue
        m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line)
        if (m) {
            inputs[current].duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
            continue
        }
        m = /Stream #(\d+):\d+[^:]*:\s*(Video|Audio):\s*([\w-]+)/.exec(line)
        if (!m) continue
        const target = inputs[Number(m[1])]
        if (!target) continue
        if (m[2] === 'Video' && !target.video && !/attached pic/.test(line)) {
            const dims = /(\d{2,5})x(\d{2,5})(?=[\s,\]]|$)/.exec(line)
            const rate = /([\d.]+)(k?) fps/.exec(line)
            target.video = {
                codec: m[3],
                width: dims ? Number(dims[1]) : 0,
                height: dims ? Number(dims[2]) : 0,
                // "1k fps": millisecond timestamps (MediaRecorder), i.e. no real frame rate
                fps: rate ? Number(rate[1]) * (rate[2] ? 1000 : 1) : null,
            }
        } else if (m[2] === 'Audio' && !target.audio) {
            target.audio = { codec: m[3] }
        }
    }
    return { inputs }
}

const FFMPEG_ERROR = /error|invalid|not supported|unsupported|could not|couldn't|cannot|unable|no such|does not contain|matches no streams|failed|unknown encoder|not divisible|out of memory/i

// The meaningful error lines of an ffmpeg run, for "technical details".
// ("Aborted()" is how ffmpeg.wasm ends every run, so it isn't one of them.)
export function summarizeFfmpegLog(lines, max = 5) {
    const hits = lines
        .map((line) => String(line).trim())
        .filter((line) => line && line !== 'Aborted()' && FFMPEG_ERROR.test(line) && !/^(configuration|built with|lib\w+\s+\d)/i.test(line))
    return [...new Set(hits)].slice(-max)
}
