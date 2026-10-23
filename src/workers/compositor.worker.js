// Composites a screen capture and a round webcam bubble into one video track,
// off the main thread.
//
// The page transfers MediaStreamTrackProcessor readables (screen, camera) and
// a MediaStreamTrackGenerator writable. A new frame is composited whenever
// either source delivers one (at most `fps` per second). Nothing here depends
// on requestAnimationFrame or window timers, which browsers pause or throttle
// in background tabs, so the recording keeps moving while the tab is hidden.

import { drawCameraBubble, drawContained } from './compositing.js'

let job = null

self.onmessage = ({ data }) => {
    if (data?.type === 'start') start(data)
    else if (data?.type === 'stop') stop()
}

function start({ screen, camera, output, width, height, fps = 30 }) {
    stop()
    const canvas = new OffscreenCanvas(width, height)
    const current = {
        canvas,
        ctx: canvas.getContext('2d', { alpha: false }),
        writer: output.getWriter(),
        width,
        height,
        minGap: (1000 / fps) * 0.85,
        lastOutput: 0,
        lastTimestamp: 0,
        screenFrame: null,
        cameraFrame: null,
        readers: [],
        stopped: false,
    }
    job = current
    pump(current, screen, 'screenFrame')
    if (camera) pump(current, camera, 'cameraFrame')
}

async function pump(current, readable, slot) {
    const reader = readable.getReader()
    current.readers.push(reader)
    try {
        for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            if (current.stopped) {
                value.close()
                break
            }
            current[slot]?.close()
            current[slot] = value
            composite(current)
        }
    } catch {
        // The source track ended or the stream was cancelled
    }
}

function composite(current) {
    if (current.stopped || !current.screenFrame) return
    const now = performance.now()
    if (now - current.lastOutput < current.minGap) return
    const { writer } = current
    if (writer.desiredSize !== null && writer.desiredSize <= 0) return
    current.lastOutput = now

    const { ctx, width, height, screenFrame, cameraFrame } = current
    drawContained(ctx, screenFrame, screenFrame.displayWidth, screenFrame.displayHeight, width, height)
    if (cameraFrame) drawCameraBubble(ctx, cameraFrame, cameraFrame.displayWidth, cameraFrame.displayHeight, width, height)

    // Microsecond timestamps from one clock, strictly increasing
    const timestamp = Math.max(Math.round(now * 1000), current.lastTimestamp + 1)
    current.lastTimestamp = timestamp
    const frame = new VideoFrame(current.canvas, { timestamp })
    writer.write(frame).catch(() => frame.close())
}

function stop() {
    const current = job
    job = null
    if (!current) return
    current.stopped = true
    current.readers.forEach((reader) => reader.cancel().catch(() => {}))
    current.screenFrame?.close()
    current.cameraFrame?.close()
    current.screenFrame = null
    current.cameraFrame = null
    current.writer.close().catch(() => {})
}
