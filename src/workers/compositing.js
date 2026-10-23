// Canvas drawing shared by the compositor worker and the page's canvas
// fallback (src/utils/media.js). Works with 2D contexts of both <canvas> and
// OffscreenCanvas, and with any drawable source (VideoFrame, <video>).

// Letterboxes `source` into the canvas (a captured window can change size).
export function drawContained(ctx, source, sourceWidth, sourceHeight, width, height) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
    if (!sourceWidth || !sourceHeight) return
    const scale = Math.min(width / sourceWidth, height / sourceHeight)
    const w = sourceWidth * scale
    const h = sourceHeight * scale
    ctx.drawImage(source, (width - w) / 2, (height - h) / 2, w, h)
}

// Round webcam bubble in the bottom-left corner. Draws the centre square of
// the camera frame (no squashing) and strokes the ring outside the clip so its
// full width shows.
export function drawCameraBubble(ctx, source, sourceWidth, sourceHeight, width, height) {
    if (!sourceWidth || !sourceHeight) return
    const size = Math.round(Math.min(width, height) * 0.25)
    const margin = Math.round(size * 0.15)
    const r = size / 2
    const cx = margin + r
    const cy = height - margin - r
    const side = Math.min(sourceWidth, sourceHeight)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(source, (sourceWidth - side) / 2, (sourceHeight - side) / 2, side, side, cx - r, cy - r, size, size)
    ctx.restore()
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.lineWidth = Math.max(3, Math.round(size * 0.025))
    ctx.strokeStyle = '#ffffff'
    ctx.stroke()
}
