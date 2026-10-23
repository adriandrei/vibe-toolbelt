// Image loading, resizing and encoding shared by the image tools
// (Image Converter, Favicon Generator, EXIF Viewer, Image to Base64).
//
//   const img = await loadImage(file)          // HEIC, SVG and raster images
//   const canvas = renderImage(img, { width, height, rotation, flipH })
//   const blob = await encodeCanvas(canvas, { type: 'image/webp', quality: 0.8 })
//   img.close()
//
// Every failure is an ImageError with a message that can be shown as is.

export class ImageError extends Error {
    constructor(message, { code, cause } = {}) {
        super(message)
        this.name = 'ImageError'
        this.code = code
        if (cause) this.cause = cause
    }
}

// Largest canvas side we allow; browsers start failing silently above this.
export const MAX_CANVAS_SIDE = 16384

export const FORMATS = {
    'image/png': { ext: 'png', label: 'PNG', alpha: true, lossy: false },
    'image/jpeg': { ext: 'jpg', label: 'JPEG', alpha: false, lossy: true },
    'image/webp': { ext: 'webp', label: 'WebP', alpha: true, lossy: true },
    'image/avif': { ext: 'avif', label: 'AVIF', alpha: true, lossy: true },
    'image/bmp': { ext: 'bmp', label: 'BMP', alpha: false, lossy: false },
    'image/x-icon': { ext: 'ico', label: 'ICO', alpha: true, lossy: false },
    'application/pdf': { ext: 'pdf', label: 'PDF', alpha: false, lossy: true },
}

const EXTRA_EXTENSIONS = {
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/tiff': 'tif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/jxl': 'jxl',
    'image/vnd.microsoft.icon': 'ico',
}

const TYPE_LABELS = {
    'image/gif': 'GIF',
    'image/svg+xml': 'SVG',
    'image/tiff': 'TIFF',
    'image/heic': 'HEIC',
    'image/heif': 'HEIF',
    'image/jxl': 'JPEG XL',
}

export function extensionForType(type, fallback = 'bin') {
    const t = (type || '').toLowerCase()
    return FORMATS[t]?.ext ?? EXTRA_EXTENSIONS[t] ?? fallback
}

export function typeLabel(type) {
    const t = (type || '').toLowerCase()
    return FORMATS[t]?.label ?? TYPE_LABELS[t] ?? (t.startsWith('image/') ? t.slice(6).toUpperCase() : t || 'unknown')
}

// ---------------------------------------------------------------------------
// File type detection

const HEIC_NAME = /\.(heic|heif|hif)$/i
const HEIC_TYPE = /^image\/hei[cf](-sequence)?$/i

function ascii(bytes, start, length) {
    let s = ''
    for (let i = start; i < start + length && i < bytes.length; i++) s += String.fromCharCode(bytes[i])
    return s
}

/**
 * Identifies an image from its first bytes (at least 32 for ISO-BMFF files).
 * Returns a MIME type or null.
 */
export function sniffImageType(input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input)
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
    if (b.length >= 6 && ascii(b, 0, 4) === 'GIF8') return 'image/gif'
    if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return 'image/webp'
    if (b.length >= 4 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a))) return 'image/tiff'
    if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
        const boxSize = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0
        const brands = [ascii(b, 8, 4)]
        for (let i = 16; i + 4 <= Math.min(boxSize, b.length, 256); i += 4) brands.push(ascii(b, i, 4))
        if (brands.some(x => x === 'avif' || x === 'avis')) return 'image/avif'
        if (brands.some(x => /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(x))) return 'image/heic'
    }
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0x0a) return 'image/jxl'
    if (b.length >= 12 && b[0] === 0 && b[1] === 0 && b[2] === 0 && b[3] === 0x0c && ascii(b, 4, 4) === 'JXL ') return 'image/jxl'
    if (b.length >= 18 && b[0] === 0x42 && b[1] === 0x4d) {
        const dib = b[14] | (b[15] << 8) | (b[16] << 16) | (b[17] << 24)
        if ([12, 40, 52, 56, 64, 108, 124].includes(dib)) return 'image/bmp'
    }
    if (b.length >= 6 && b[0] === 0 && b[1] === 0 && (b[2] === 1 || b[2] === 2) && b[3] === 0) {
        const count = b[4] | (b[5] << 8)
        if (count > 0 && count < 256) return 'image/x-icon'
    }
    const head = new TextDecoder().decode(b.subarray(0, 2048)).replace(/^\uFEFF/, '').trimStart()
    if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return 'image/svg+xml'
    return null
}

export function isHeicFile(file) {
    return HEIC_TYPE.test(file?.type || '') || HEIC_NAME.test(file?.name || '')
}

export function isSvgFile(file) {
    return (file?.type || '').toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file?.name || '')
}

// The real type from the file's first bytes; the name and MIME type only
// decide for HEIC and SVG, whose signatures are less reliable.
async function detectType(blob, name) {
    let sniffed = null
    try {
        sniffed = sniffImageType(new Uint8Array(await blob.slice(0, 2048).arrayBuffer()))
    } catch {
        // unreadable: decoding will fail with a clear message
    }
    if (sniffed) return sniffed
    if (HEIC_TYPE.test(blob.type || '') || HEIC_NAME.test(name || '')) return 'image/heic'
    if ((blob.type || '').toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(name || '')) return 'image/svg+xml'
    return null
}

// ---------------------------------------------------------------------------
// Canvas helpers

export function createCanvas(width, height) {
    const w = Math.max(1, Math.round(width))
    const h = Math.max(1, Math.round(height))
    if (w > MAX_CANVAS_SIDE || h > MAX_CANVAS_SIDE) {
        throw new ImageError(`${w}×${h} px is too large. The maximum is ${MAX_CANVAS_SIDE} px per side.`, { code: 'too-large' })
    }
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageError(`Not enough memory for a ${w}×${h} px image.`, { code: 'too-large' })
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    return canvas
}

/** Frees a canvas's pixel memory right away (instead of waiting for GC). */
export function releaseCanvas(canvas) {
    if (canvas && canvas.width) {
        canvas.width = 0
        canvas.height = 0
    }
}

export function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => {
        try {
            canvas.toBlob(resolve, type, quality)
        } catch {
            resolve(null)
        }
    })
}

// ---------------------------------------------------------------------------
// Loading

function decodeWithElement(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob)
        const img = new Image()
        const release = () => URL.revokeObjectURL(url)
        img.onload = () => resolve({ img, release })
        img.onerror = () => {
            release()
            reject(new ImageError('The image could not be decoded.', { code: 'undecodable' }))
        }
        img.src = url
    })
}

async function decodeRaster(blob) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(blob)
            if (bitmap.width && bitmap.height) {
                return { image: bitmap, width: bitmap.width, height: bitmap.height, vector: false, source: blob, close: () => bitmap.close() }
            }
            bitmap.close()
        } catch {
            // Some formats (ICO in some browsers) only decode through <img>
        }
    }
    const { img, release } = await decodeWithElement(blob)
    if (!img.naturalWidth || !img.naturalHeight) {
        release()
        throw new ImageError('The image has no size.')
    }
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, vector: false, source: blob, close: release }
}

// SVGs without width/height have no reliable intrinsic size in <img>, so we
// give them one (from the viewBox, 1024 px on the long side).
function normalizeSvg(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const svg = doc.documentElement
    if (!svg || svg.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) {
        throw new ImageError('This SVG file is not valid XML.', { code: 'invalid-svg' })
    }
    const length = (value) => {
        const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(value || '')
        const n = m ? parseFloat(m[1]) : NaN
        return Number.isFinite(n) && n > 0 ? n : null
    }
    let w = length(svg.getAttribute('width'))
    let h = length(svg.getAttribute('height'))
    if (w && h) return { text, width: Math.round(w), height: Math.round(h) }

    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    const ratio = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : 1
    if (w) h = w / ratio
    else if (h) w = h * ratio
    else if (ratio >= 1) { w = 1024; h = 1024 / ratio }
    else { h = 1024; w = 1024 * ratio }
    svg.setAttribute('width', String(Math.max(1, Math.round(w))))
    svg.setAttribute('height', String(Math.max(1, Math.round(h))))
    return { text: new XMLSerializer().serializeToString(doc), width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) }
}

async function decodeSvg(blob) {
    const { text, width, height } = normalizeSvg(await blob.text())
    const { img, release } = await decodeWithElement(new Blob([text], { type: 'image/svg+xml' }))
    return { image: img, width, height, vector: true, source: blob, close: release }
}

/**
 * Decodes a HEIC/HEIF file at full quality (lossless PNG). The decoder
 * (heic2any, ~1.3 MB) is only downloaded the first time it's needed.
 */
export async function decodeHeic(blob) {
    let heic2any
    try {
        heic2any = (await import('heic2any')).default
    } catch (err) {
        throw new ImageError('Couldn’t load the HEIC decoder. Check your connection and try again.', { cause: err })
    }
    try {
        const out = await heic2any({ blob, toType: 'image/png', multiple: false })
        const png = Array.isArray(out) ? out[0] : out
        if (!(png instanceof Blob) || !png.size) throw new Error('empty result')
        return png
    } catch (err) {
        // heic2any rejects with { code, message } objects, not Errors
        const raw = String(err?.message || err || '')
        const detail = raw.replace(/^ERR_[A-Z]+\s*/, '').trim()
        throw new ImageError(`Couldn’t decode this HEIC/HEIF image${detail ? ` (${detail})` : ''}.`, { cause: err })
    }
}

/**
 * Loads a File/Blob into something drawImage() accepts.
 * Resolves to { image, width, height, vector, source, close() } where
 * `source` is a browser-decodable Blob (for HEIC: the lossless PNG decode).
 * Always call close() when done.
 */
export async function loadImage(blob, { name = blob?.name } = {}) {
    if (!blob || !blob.size) throw new ImageError('The file is empty.')
    const type = await detectType(blob, name)

    if (type === 'image/heic') {
        try {
            return await decodeRaster(blob) // Safari decodes HEIC natively
        } catch {
            const png = await decodeHeic(blob)
            const loaded = await decodeRaster(png)
            return { ...loaded, source: png }
        }
    }
    if (type === 'image/svg+xml') {
        try {
            return await decodeSvg(blob)
        } catch (err) {
            if (err?.code === 'invalid-svg') throw err
            throw new ImageError('This SVG couldn’t be rendered. It may be malformed or use features browsers can’t draw as an image.', { code: 'undecodable', cause: err })
        }
    }
    try {
        return await decodeRaster(blob)
    } catch (err) {
        throw new ImageError(
            type
                ? `This browser can’t decode ${typeLabel(type)} images. Try PNG, JPEG, WebP or GIF.`
                : 'This file isn’t a valid image. It may be damaged or have the wrong extension.',
            { code: 'undecodable', cause: err }
        )
    }
}

// ---------------------------------------------------------------------------
// Drawing

/**
 * Scales a region of a loaded image to dw×dh with good quality: large
 * reductions are done in halving steps, which avoids the aliasing of a
 * single big drawImage. Vector images are drawn straight at the target size.
 */
export function scaleRegion(loaded, sx, sy, sw, sh, dw, dh) {
    const outW = Math.max(1, Math.round(dw))
    const outH = Math.max(1, Math.round(dh))
    let src = loaded.image
    let x = sx
    let y = sy
    let w = sw
    let h = sh
    let temp = null
    if (!loaded.vector) {
        while (w >= outW * 2 && h >= outH * 2) {
            const nw = Math.max(outW, Math.round(w / 2))
            const nh = Math.max(outH, Math.round(h / 2))
            const step = createCanvas(nw, nh)
            step.getContext('2d').drawImage(src, x, y, w, h, 0, 0, nw, nh)
            if (temp) releaseCanvas(temp)
            temp = step
            src = step
            x = 0
            y = 0
            w = nw
            h = nh
        }
    }
    const out = createCanvas(outW, outH)
    out.getContext('2d').drawImage(src, x, y, w, h, 0, 0, outW, outH)
    if (temp) releaseCanvas(temp)
    return out
}

/**
 * Output size for a resize request.
 * - width/height empty: keep the source size
 * - one side: the other follows the aspect ratio (or stays, if !keepAspect)
 * - both with keepAspect: fit inside the box
 */
export function fitSize(srcW, srcH, { width, height, keepAspect = true } = {}) {
    const W = Number(width) || 0
    const H = Number(height) || 0
    if (W && H) {
        if (!keepAspect) return { width: W, height: H }
        const s = Math.min(W / srcW, H / srcH)
        return { width: Math.max(1, Math.round(srcW * s)), height: Math.max(1, Math.round(srcH * s)) }
    }
    if (W) return { width: W, height: keepAspect ? Math.max(1, Math.round(srcH * (W / srcW))) : srcH }
    if (H) return { width: keepAspect ? Math.max(1, Math.round(srcW * (H / srcH))) : srcW, height: H }
    return { width: srcW, height: srcH }
}

/**
 * Draws a loaded image with rotation (0/90/180/270), flips, an optional
 * source crop and an output size (in the rotated orientation).
 */
export function renderImage(loaded, { width, height, rotation = 0, flipH = false, flipV = false, crop } = {}) {
    const sx = crop?.x ?? 0
    const sy = crop?.y ?? 0
    const sw = crop?.width ?? loaded.width
    const sh = crop?.height ?? loaded.height
    const turned = rotation === 90 || rotation === 270
    const outW = Math.max(1, Math.round(width ?? (turned ? sh : sw)))
    const outH = Math.max(1, Math.round(height ?? (turned ? sw : sh)))
    const drawW = turned ? outH : outW
    const drawH = turned ? outW : outH

    const scaled = scaleRegion(loaded, sx, sy, sw, sh, drawW, drawH)
    if (!rotation && !flipH && !flipV) return scaled

    const out = createCanvas(outW, outH)
    const ctx = out.getContext('2d')
    ctx.translate(outW / 2, outH / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    ctx.drawImage(scaled, -drawW / 2, -drawH / 2)
    releaseCanvas(scaled)
    return out
}

/** Wraps a canvas so it can be passed where a loaded image is expected. */
export function canvasAsImage(canvas) {
    return { image: canvas, width: canvas.width, height: canvas.height, vector: false, source: null, close: () => releaseCanvas(canvas) }
}

function flatten(canvas, background = '#ffffff') {
    const out = createCanvas(canvas.width, canvas.height)
    const ctx = out.getContext('2d')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0)
    return out
}

// ---------------------------------------------------------------------------
// Encoding

let supportPromise = null

/**
 * Which output types this browser's canvas can really encode. Browsers
 * silently fall back to PNG for types they don't support (WebP in older
 * Safari, AVIF almost everywhere). BMP, ICO and PDF are written by us.
 */
export function getEncoderSupport() {
    if (!supportPromise) {
        supportPromise = (async () => {
            const result = { 'image/png': true, 'image/bmp': true, 'image/x-icon': true, 'application/pdf': true }
            for (const type of ['image/jpeg', 'image/webp', 'image/avif']) {
                try {
                    const blob = await canvasToBlob(createCanvas(2, 2), type, 0.8)
                    result[type] = !!blob && blob.type === type
                } catch {
                    result[type] = false
                }
            }
            return result
        })()
    }
    return supportPromise
}

function encodeBmp(canvas) {
    const w = canvas.width
    const h = canvas.height
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
    const rowSize = Math.ceil((w * 3) / 4) * 4
    const imageSize = rowSize * h
    const buffer = new ArrayBuffer(54 + imageSize)
    const view = new DataView(buffer)
    view.setUint8(0, 0x42)
    view.setUint8(1, 0x4d)
    view.setUint32(2, 54 + imageSize, true)
    view.setUint32(10, 54, true)
    view.setUint32(14, 40, true)
    view.setInt32(18, w, true)
    view.setInt32(22, h, true) // positive height: bottom-up rows
    view.setUint16(26, 1, true)
    view.setUint16(28, 24, true)
    view.setUint32(34, imageSize, true)
    view.setInt32(38, 2835, true) // 72 dpi
    view.setInt32(42, 2835, true)
    const out = new Uint8Array(buffer)
    for (let y = 0; y < h; y++) {
        let o = 54 + (h - 1 - y) * rowSize
        let i = y * w * 4
        for (let x = 0; x < w; x++, i += 4) {
            out[o++] = data[i + 2]
            out[o++] = data[i + 1]
            out[o++] = data[i]
        }
    }
    return new Blob([buffer], { type: 'image/bmp' })
}

/**
 * Encodes a canvas and checks that the browser produced the requested type.
 * Formats without transparency (JPEG, BMP) are flattened onto `background`.
 */
export async function encodeCanvas(canvas, { type = 'image/png', quality = 0.92, background = '#ffffff' } = {}) {
    const info = FORMATS[type]
    if (!info || type === 'image/x-icon' || type === 'application/pdf') {
        throw new ImageError(`Can’t encode ${type} directly.`)
    }
    const src = info.alpha ? canvas : flatten(canvas, background)
    try {
        if (type === 'image/bmp') return encodeBmp(src)
        const blob = await canvasToBlob(src, type, info.lossy ? quality : undefined)
        if (!blob) {
            throw new ImageError(`The browser couldn’t encode a ${canvas.width}×${canvas.height} px image. It may be too large.`, { code: 'encode-failed' })
        }
        if (blob.type !== type) {
            throw new ImageError(`This browser can’t save ${info.label} images. Choose another format.`, { code: 'unsupported' })
        }
        return blob
    } finally {
        if (src !== canvas) releaseCanvas(src)
    }
}

// ---------------------------------------------------------------------------
// ICO

/** Renders a square icon: `contain` pads the image, `cover` crops it. */
export function renderIcon(loaded, size, { fit = 'contain', padding = 0, background = null } = {}) {
    const canvas = createCanvas(size, size)
    const ctx = canvas.getContext('2d')
    if (background) {
        ctx.fillStyle = background
        ctx.fillRect(0, 0, size, size)
    }
    const inner = Math.max(1, Math.round(size * (1 - 2 * padding)))
    let sx = 0
    let sy = 0
    let sw = loaded.width
    let sh = loaded.height
    let dw
    let dh
    if (fit === 'cover') {
        const side = Math.min(sw, sh)
        sx = (sw - side) / 2
        sy = (sh - side) / 2
        sw = side
        sh = side
        dw = inner
        dh = inner
    } else {
        const s = inner / Math.max(sw, sh)
        dw = Math.max(1, Math.round(sw * s))
        dh = Math.max(1, Math.round(sh * s))
    }
    const scaled = scaleRegion(loaded, sx, sy, sw, sh, dw, dh)
    ctx.drawImage(scaled, Math.round((size - dw) / 2), Math.round((size - dh) / 2))
    releaseCanvas(scaled)
    return canvas
}

/**
 * Packs PNG images into an .ico file (PNG-compressed entries, supported by
 * every browser and Windows Vista+). entries: [{ size, data: Uint8Array }]
 */
export function writeIco(entries) {
    const list = [...entries].sort((a, b) => a.size - b.size)
    const headerSize = 6 + 16 * list.length
    const total = headerSize + list.reduce((n, e) => n + e.data.byteLength, 0)
    const bytes = new Uint8Array(total)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 0, true) // reserved
    view.setUint16(2, 1, true) // type: icon
    view.setUint16(4, list.length, true)
    let offset = headerSize
    list.forEach((entry, i) => {
        const p = 6 + i * 16
        const side = entry.size >= 256 ? 0 : entry.size // 0 means 256
        view.setUint8(p, side)
        view.setUint8(p + 1, side)
        view.setUint8(p + 2, 0) // palette size
        view.setUint8(p + 3, 0) // reserved
        view.setUint16(p + 4, 1, true) // colour planes
        view.setUint16(p + 6, 32, true) // bits per pixel
        view.setUint32(p + 8, entry.data.byteLength, true)
        view.setUint32(p + 12, offset, true)
        bytes.set(entry.data, offset)
        offset += entry.data.byteLength
    })
    return new Blob([bytes], { type: 'image/x-icon' })
}

/** Renders `sizes` (e.g. [16, 32, 48]) from a loaded image into one .ico. */
export async function createIco(loaded, sizes, options) {
    const entries = []
    for (const size of [...new Set(sizes)].filter(s => s >= 1 && s <= 256)) {
        const canvas = renderIcon(loaded, size, options)
        try {
            const png = await encodeCanvas(canvas, { type: 'image/png' })
            entries.push({ size, data: new Uint8Array(await png.arrayBuffer()) })
        } finally {
            releaseCanvas(canvas)
        }
    }
    if (!entries.length) throw new ImageError('Choose at least one icon size.')
    return writeIco(entries)
}

// ---------------------------------------------------------------------------
// PDF

const PDF_MAX_PT = 14400 // PDF page size limit (200 inches)

// 96 px per inch on screen, 72 pt per inch in PDF
export function pdfPageSize(pxW, pxH) {
    let w = pxW * 0.75
    let h = pxH * 0.75
    const k = Math.min(1, PDF_MAX_PT / w, PDF_MAX_PT / h)
    w = Math.max(1, w * k)
    h = Math.max(1, h * k)
    return { w, h }
}

/** A JPEG page ready for buildPdf(), flattened onto `background`. */
export async function canvasToPdfPage(canvas, { quality = 0.92, background = '#ffffff' } = {}) {
    const jpeg = await encodeCanvas(canvas, { type: 'image/jpeg', quality, background })
    return { data: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height }
}

/** One page per image, each page sized to its image. */
export async function buildPdf(pages) {
    if (!pages.length) throw new ImageError('There are no pages to put in the PDF.')
    let jsPDF
    try {
        ({ jsPDF } = await import('jspdf'))
    } catch (err) {
        throw new ImageError('Couldn’t load the PDF writer. Check your connection and try again.', { cause: err })
    }
    let doc = null
    for (const page of pages) {
        const { w, h } = pdfPageSize(page.width, page.height)
        const orientation = w > h ? 'landscape' : 'portrait'
        if (!doc) doc = new jsPDF({ unit: 'pt', format: [w, h], orientation, compress: true })
        else doc.addPage([w, h], orientation)
        doc.addImage(page.data, 'JPEG', 0, 0, w, h, undefined, 'NONE')
    }
    return doc.output('blob')
}
