// Colour parsing shared by the design tools. Accepts anything CSS accepts
// (hex with or without "#", 3/4/6/8 digits, rgb(), hsl(), hwb(), named colours).

let ctx = null
function getContext() {
    if (!ctx) ctx = document.createElement('canvas').getContext('2d')
    return ctx
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Returns { r, g, b, a } (0-255, alpha 0-1) or null when the string isn't a colour. */
export function parseColor(input) {
    if (typeof input !== 'string') return null
    let s = input.trim()
    if (!s) return null
    if (/^[0-9a-f]+$/i.test(s) && [3, 4, 6, 8].includes(s.length)) s = `#${s}`
    if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', s)) return null
    if (/^(inherit|initial|unset|revert|currentcolor)$/i.test(s)) return null
    // An invalid value leaves fillStyle unchanged, so two different sentinels
    // giving two different results means the canvas rejected the colour.
    const c = getContext()
    c.fillStyle = '#010203'
    c.fillStyle = s
    const value = c.fillStyle
    c.fillStyle = '#030201'
    c.fillStyle = s
    if (c.fillStyle !== value) return null
    if (value.startsWith('#')) {
        return {
            r: parseInt(value.slice(1, 3), 16),
            g: parseInt(value.slice(3, 5), 16),
            b: parseInt(value.slice(5, 7), 16),
            a: 1,
        }
    }
    const m = value.match(/^rgba?\(([^)]+)\)$/)
    if (m) {
        const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
        return { r, g, b, a }
    }
    // Modern syntaxes (oklch(), lab(), color(), color-mix()…) come back
    // unconverted: draw one pixel and read it back as sRGB.
    return rasterize(s)
}

let pixelContext = null
function rasterize(value) {
    if (!pixelContext) {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        pixelContext = canvas.getContext('2d', { willReadFrequently: true })
    }
    const ctx = pixelContext
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = value
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: Math.round((a / 255) * 1000) / 1000 }
}

export function isValidColor(input) {
    return parseColor(input) !== null
}

const hex2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')

/** '#rrggbb', or '#rrggbbaa' when alpha < 1 and `withAlpha` is true. */
export function toHex({ r, g, b, a = 1 }, withAlpha = true) {
    const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`
    return withAlpha && a < 1 ? base + hex2(a * 255) : base
}

export function toRgbString({ r, g, b, a = 1 }) {
    return a < 1 ? `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${+a.toFixed(3)})` : `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`
}

/** Normalises any CSS colour to a hex string, or returns null. */
export function normalizeColor(input, withAlpha = true) {
    const c = parseColor(input)
    return c ? toHex(c, withAlpha) : null
}

/** Relative luminance (WCAG) and contrast ratio helpers. */
export function luminance({ r, g, b }) {
    const f = (v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrastRatio(a, b) {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
