// Accessible versions of Prism's One Light / One Dark themes.
//
// The stock themes use several token colours below 4.5:1 on our inset
// backgrounds (e.g. One Light's green strings are 2.9:1). Each token colour
// that falls short is shifted in lightness, keeping its hue and saturation,
// until it reaches the target contrast against the theme's code background.
import oneLight from 'react-syntax-highlighter/dist/esm/styles/prism/one-light'
import oneDark from 'react-syntax-highlighter/dist/esm/styles/prism/one-dark'

const TARGET = 4.6

function hslToRgb(h, s, l) {
    s /= 100
    l /= 100
    const k = (n) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return [255 * f(0), 255 * f(8), 255 * f(4)]
}

function luminance([r, g, b]) {
    return [r, g, b]
        .map((v) => {
            v /= 255
            return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
}

function contrast(a, b) {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function adjust(color, bg, darken) {
    const m = typeof color === 'string' && color.match(/^hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)$/)
    if (!m) return color
    const h = Number(m[1])
    const s = Number(m[2])
    let l = Number(m[3])
    if (contrast(hslToRgb(h, s, l), bg) >= TARGET) return color
    while (l > 2 && l < 98 && contrast(hslToRgb(h, s, l), bg) < TARGET) l += darken ? -1 : 1
    return `hsl(${h}, ${s}%, ${l}%)`
}

function makeAccessible(theme, bg, darken) {
    const out = {}
    for (const [key, value] of Object.entries(theme)) {
        out[key] = value && value.color ? { ...value, color: adjust(value.color, bg, darken) } : value
    }
    return out
}

// Backgrounds match --bg-inset in variables.css (worst case across hues)
export const codeThemeLight = makeAccessible(oneLight, hslToRgb(250, 18, 95.5), true)
export const codeThemeDark = makeAccessible(oneDark, hslToRgb(250, 22, 6.5), false)
