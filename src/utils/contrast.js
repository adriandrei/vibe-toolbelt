// Colour contrast maths for the Contrast Checker: WCAG 2.x ratios with alpha
// compositing, OKLCH lightness adjustments for suggestions, and APCA (draft).
//
// Colours are plain objects { r, g, b, a } with r/g/b in 0–255 (may be
// fractional after compositing) and a in 0–1, as returned by parseColor().
import { contrastRatio, toHex } from './color.js'

export const WHITE = { r: 255, g: 255, b: 255, a: 1 }
export const BLACK = { r: 0, g: 0, b: 0, a: 1 }

// WCAG 2.x success criteria checked by the tool
export const CRITERIA = [
    { id: 'normal-aa', group: 'Normal text', level: 'AA', min: 4.5, sc: '1.4.3' },
    { id: 'normal-aaa', group: 'Normal text', level: 'AAA', min: 7, sc: '1.4.6' },
    { id: 'large-aa', group: 'Large text', level: 'AA', min: 3, sc: '1.4.3' },
    { id: 'large-aaa', group: 'Large text', level: 'AAA', min: 4.5, sc: '1.4.6' },
    { id: 'ui', group: 'UI components and graphics', level: 'AA', min: 3, sc: '1.4.11' },
]

const THRESHOLDS = [3, 4.5, 7]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * "#rgb", "#rgba", "#rrggbb" or "#rrggbbaa" to { r, g, b, a }, exactly (the
 * alpha byte becomes aa/255). Null for anything else.
 */
export function parseHex(hex) {
    let h = String(hex ?? '').trim().replace(/^#/, '')
    if (!/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null
    if (h.length <= 4) h = [...h].map(c => c + c).join('')
    const byte = (i) => parseInt(h.slice(i, i + 2), 16)
    return { r: byte(0), g: byte(2), b: byte(4), a: h.length === 8 ? byte(6) / 255 : 1 }
}

/** `top` drawn over `bottom` (source-over, in sRGB like browsers). Returns an opaque colour. */
export function composite(top, bottom) {
    const a = clamp(top.a ?? 1, 0, 1)
    const base = (bottom.a ?? 1) < 1 ? composite(bottom, WHITE) : bottom
    return {
        r: top.r * a + base.r * (1 - a),
        g: top.g * a + base.g * (1 - a),
        b: top.b * a + base.b * (1 - a),
        a: 1,
    }
}

/**
 * The colours as they are seen: a translucent background is drawn on
 * `backdrop` (what's behind it, white by default), then a translucent text
 * colour is drawn on that.
 */
export function effectiveColors(fg, bg, backdrop = WHITE) {
    const background = (bg.a ?? 1) < 1 ? composite(bg, backdrop) : { ...bg, a: 1 }
    const foreground = (fg.a ?? 1) < 1 ? composite(fg, background) : { ...fg, a: 1 }
    return { fg: foreground, bg: background }
}

/** WCAG 2.x contrast ratio of the colours as seen (1–21). */
export function pairRatio(fg, bg, backdrop = WHITE) {
    const eff = effectiveColors(fg, bg, backdrop)
    return contrastRatio(eff.fg, eff.bg)
}

/** Pass/fail uses the exact ratio: 4.499 fails 4.5. */
export function passes(ratio, min) {
    return ratio >= min
}

/**
 * Two decimals, rounded, except that a value is never rounded up across a
 * threshold (3, 4.5, 7): 4.499 shows as 4.49, not 4.50, so the number shown
 * always agrees with the pass/fail result.
 */
export function formatRatio(ratio) {
    let shown = Math.round(ratio * 100) / 100
    for (const t of THRESHOLDS) {
        if (ratio < t && shown >= t) shown = Math.floor(ratio * 100) / 100
    }
    return shown.toFixed(2)
}

// ---------------------------------------------------------------- OKLCH

const toLinear = (c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const fromLinear = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255

/** sRGB (0–255) to OKLCH (Björn Ottosson's OKLab). l is 0–1, h in degrees. */
export function rgbToOklch({ r, g, b }) {
    const lr = toLinear(r)
    const lg = toLinear(g)
    const lb = toLinear(b)
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    const c = Math.sqrt(A * A + B * B)
    let h = (Math.atan2(B, A) * 180) / Math.PI
    if (h < 0) h += 360
    return { l: L, c, h }
}

// OKLCH to linear sRGB (unclamped, may be out of gamut)
function oklchToLinear({ l, c, h }) {
    const rad = (h * Math.PI) / 180
    const A = c * Math.cos(rad)
    const B = c * Math.sin(rad)
    const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
    const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
    const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
    return [
        4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
        -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
        -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
    ]
}

const inGamut = (rgb) => rgb.every(v => v >= -1e-6 && v <= 1 + 1e-6)

/**
 * OKLCH to sRGB (0–255, rounded to whole channels). When the colour is
 * outside sRGB, chroma is reduced until it fits, so lightness and hue stay.
 */
export function oklchToRgb({ l, c, h }) {
    const L = clamp(l, 0, 1)
    let rgb = oklchToLinear({ l: L, c, h })
    if (!inGamut(rgb)) {
        let lo = 0
        let hi = c
        for (let i = 0; i < 24; i++) {
            const mid = (lo + hi) / 2
            if (inGamut(oklchToLinear({ l: L, c: mid, h }))) lo = mid
            else hi = mid
        }
        rgb = oklchToLinear({ l: L, c: lo, h })
    }
    const [r, g, b] = rgb.map(v => clamp(Math.round(fromLinear(clamp(v, 0, 1))), 0, 255))
    return { r, g, b }
}

// ---------------------------------------------------------------- suggestions

/**
 * The nearest colour, keeping the hue and chroma of the one being changed
 * (only its OKLCH lightness moves), that reaches `target` against the other.
 *
 *   suggestColor({ fg, bg, backdrop, target: 4.5, adjust: 'fg' })
 *
 * Returns
 *   { status: 'passes' }                                 already meets the target
 *   { status: 'found', color, rgb, ratio, direction, opaque }
 *   { status: 'unreachable', best: { color, rgb, ratio } } nothing reaches it
 *
 * `color` is a hex string (with alpha when the original was translucent).
 * When the original is translucent and no lightness gets there, an opaque
 * version is tried (`opaque: true`). Suggestions are checked after rounding
 * to whole RGB values, so they really pass.
 */
export function suggestColor({ fg, bg, backdrop = WHITE, target, adjust = 'fg' }) {
    const current = pairRatio(fg, bg, backdrop)
    if (passes(current, target)) return { status: 'passes', ratio: current }

    const original = adjust === 'fg' ? fg : bg
    const attempt = (alpha) => searchLightness({ fg, bg, backdrop, target, adjust, original, alpha })

    const result = attempt(original.a ?? 1)
    if (result) return { status: 'found', ...result, opaque: false }
    if ((original.a ?? 1) < 1) {
        const opaque = attempt(1)
        if (opaque) return { status: 'found', ...opaque, opaque: true }
    }

    // Unreachable: the best this hue can do is black or white
    const candidates = [BLACK, WHITE].map(c => {
        const color = { ...c, a: 1 }
        const ratio = adjust === 'fg' ? pairRatio(color, bg, backdrop) : pairRatio(fg, color, backdrop)
        return { color: toHex(color), rgb: color, ratio }
    })
    const best = candidates[0].ratio >= candidates[1].ratio ? candidates[0] : candidates[1]
    return { status: 'unreachable', best }
}

function searchLightness({ fg, bg, backdrop, target, adjust, original, alpha }) {
    const start = rgbToOklch(original)
    // Grey has no meaningful hue; keep it grey
    const chroma = start.c < 1e-4 ? 0 : start.c
    const candidateAt = (l) => ({ ...oklchToRgb({ l, c: chroma, h: start.h }), a: alpha })
    const ratioOf = (color) => (adjust === 'fg' ? pairRatio(color, bg, backdrop) : pairRatio(fg, color, backdrop))
    const ok = (l) => {
        const color = candidateAt(l)
        const ratio = ratioOf(color)
        return passes(ratio, target) ? { color, ratio } : null
    }

    const STEP = 0.005
    const found = []
    for (const dir of [-1, 1]) {
        let prev = start.l
        for (let l = start.l + dir * STEP; ; l += dir * STEP) {
            const edge = dir < 0 ? l <= 0 : l >= 1
            const at = edge ? (dir < 0 ? 0 : 1) : l
            const hit = ok(at)
            if (hit) {
                // Bisect between the last miss and this hit for the closest lightness
                let miss = prev
                let pass = at
                let best = hit
                for (let i = 0; i < 20; i++) {
                    const mid = (miss + pass) / 2
                    const midHit = ok(mid)
                    if (midHit) {
                        pass = mid
                        best = midHit
                    } else {
                        miss = mid
                    }
                }
                found.push({ distance: Math.abs(pass - start.l), direction: dir < 0 ? 'darker' : 'lighter', ...best })
                break
            }
            if (edge) break
            prev = at
        }
    }
    if (!found.length) return null
    found.sort((a, b) => a.distance - b.distance || b.ratio - a.ratio)
    const { color, ratio, direction } = found[0]
    return { color: toHex(color), rgb: color, ratio, direction }
}

// ---------------------------------------------------------------- APCA

// APCA-W3 0.0.98G-4g (the public draft constants). Informational only: it
// is a candidate method for WCAG 3, not a requirement today.
const APCA = {
    mainTRC: 2.4,
    sRco: 0.2126729,
    sGco: 0.7151522,
    sBco: 0.072175,
    normBG: 0.56,
    normTXT: 0.57,
    revTXT: 0.62,
    revBG: 0.65,
    blkThrs: 0.022,
    blkClmp: 1.414,
    scaleBoW: 1.14,
    scaleWoB: 1.14,
    loBoWoffset: 0.027,
    loWoBoffset: 0.027,
    deltaYmin: 0.0005,
    loClip: 0.1,
}

function apcaY({ r, g, b }) {
    const f = (v) => (clamp(v, 0, 255) / 255) ** APCA.mainTRC
    return APCA.sRco * f(r) + APCA.sGco * f(g) + APCA.sBco * f(b)
}

/**
 * APCA lightness contrast (Lc) of opaque text on an opaque background.
 * Positive for dark text on a light background, negative for light on dark.
 */
export function apcaContrast(text, background) {
    let txtY = apcaY(text)
    let bgY = apcaY(background)
    txtY = txtY > APCA.blkThrs ? txtY : txtY + (APCA.blkThrs - txtY) ** APCA.blkClmp
    bgY = bgY > APCA.blkThrs ? bgY : bgY + (APCA.blkThrs - bgY) ** APCA.blkClmp
    if (Math.abs(bgY - txtY) < APCA.deltaYmin) return 0
    if (bgY > txtY) {
        const sapc = (bgY ** APCA.normBG - txtY ** APCA.normTXT) * APCA.scaleBoW
        return sapc < APCA.loClip ? 0 : (sapc - APCA.loBoWoffset) * 100
    }
    const sapc = (bgY ** APCA.revBG - txtY ** APCA.revTXT) * APCA.scaleWoB
    return sapc > -APCA.loClip ? 0 : (sapc + APCA.loWoBoffset) * 100
}
