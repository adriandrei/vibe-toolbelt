import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'

const ThemeContext = createContext(null)

export const COLOR_PRESETS = [
    { name: 'Indigo Vibe', hue: 250 },
    { name: 'Emerald Mint', hue: 145 },
    { name: 'Amber Glow', hue: 35 },
    { name: 'Crimson Rose', hue: 340 },
    { name: 'Cyber Blue', hue: 200 },
    { name: 'Amethyst', hue: 280 },
].map(p => ({ ...p, color: `hsl(${p.hue}, 90%, 62%)` }))

const THEME_KEY = 'pt-theme'
const HUE_KEY = 'pt-hue'

function readStorage(key) {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function writeStorage(key, value) {
    try {
        localStorage.setItem(key, value)
    } catch {
        // storage unavailable (private mode): the choice lasts for this visit
    }
}

// ---- colour maths for the derived tokens ----
function hslToRgb(h, s, l) {
    s /= 100
    l /= 100
    const k = n => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return { r: 255 * f(0), g: 255 * f(8), b: 255 * f(4) }
}

function luminance({ r, g, b }) {
    const f = v => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a, b) {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function parseRgb(str) {
    const m = str && str.match(/rgba?\(([^)]+)\)/)
    if (!m) return null
    const [r, g, b] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    return { r, g, b }
}

const rgbTriplet = ({ r, g, b }) => `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`
const rgbCss = ({ r, g, b }) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`

// Picks the lightness (for the given hue/saturation) closest to `start` that
// reaches 4.5:1 against every background.
function readableShade(hue, saturation, start, backgrounds, direction) {
    for (let l = start; l >= 5 && l <= 97; l += direction * 2) {
        const color = hslToRgb(hue, saturation, l)
        if (backgrounds.every(bg => contrast(color, bg) >= 4.5)) return color
    }
    return hslToRgb(hue, saturation, direction > 0 ? 97 : 5)
}

/**
 * Computes per-hue tokens that CSS alone can't: text colour on the accent
 * fill, accent-coloured text that stays readable, and RGB triplets for
 * rgba(var(--primary-rgb), a). Reads the resolved CSS colours from the page.
 */
// Base fill of --primary per theme (must match variables.css)
const PRIMARY_FILL = { dark: { s: 90, l: 65, hoverDelta: 5 }, light: { s: 80, l: 50, hoverDelta: -5 } }
const MIN_BUTTON_CONTRAST = 4.6

/**
 * Text colour for the accent fill, nudging the fill's lightness when neither
 * white nor near-black text reaches AA contrast (some mid-tone hues can't).
 * Returns { fill: rgb | null (unchanged), fillL, text }.
 */
function accentButtonColors(theme, hue, primary) {
    const white = { r: 255, g: 255, b: 255 }
    const darkText = hslToRgb(hue, 30, 10)
    const cw = contrast(white, primary)
    const cd = contrast(darkText, primary)
    if (Math.max(cw, cd) >= MIN_BUTTON_CONTRAST) return { fill: null, text: cw >= MIN_BUTTON_CONTRAST || cw >= cd ? white : darkText }

    const { s, l } = PRIMARY_FILL[theme]
    // Darken until white text passes, or lighten until dark text passes: take the smaller change
    let darker = null
    for (let L = l; L >= 20; L -= 0.5) {
        if (contrast(white, hslToRgb(hue, s, L)) >= MIN_BUTTON_CONTRAST) { darker = L; break }
    }
    let lighter = null
    for (let L = l; L <= 90; L += 0.5) {
        if (contrast(darkText, hslToRgb(hue, s, L)) >= MIN_BUTTON_CONTRAST) { lighter = L; break }
    }
    const useDarker = lighter === null || (darker !== null && l - darker <= lighter - l)
    const fillL = useDarker ? darker : lighter
    return { fill: hslToRgb(hue, s, fillL), fillL, text: useDarker ? white : darkText }
}

function applyDerivedTokens(theme, hue) {
    const root = document.documentElement
    // Start from the stylesheet's accent, not a previous override
    root.style.removeProperty('--primary')
    root.style.removeProperty('--primary-hover')
    const probe = document.createElement('span')
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const read = (name) => {
        probe.style.color = `var(${name})`
        return parseRgb(getComputedStyle(probe).color)
    }
    const primary = read('--primary')
    const accent = read('--accent')
    const panel = read('--bg-panel')
    const app = read('--bg-app')
    probe.remove()
    if (!primary || !panel || !app) return

    const dark = theme === 'dark'
    const button = accentButtonColors(dark ? 'dark' : 'light', hue, primary)
    const onPrimary = button.text
    if (button.fill) {
        const { s: sat, hoverDelta } = PRIMARY_FILL[dark ? 'dark' : 'light']
        root.style.setProperty('--primary', `hsl(${hue}, ${sat}%, ${button.fillL}%)`)
        root.style.setProperty('--primary-hover', `hsl(${hue}, ${sat}%, ${button.fillL + hoverDelta}%)`)
        primary.r = button.fill.r
        primary.g = button.fill.g
        primary.b = button.fill.b
    }

    // Accent text must also be readable on the accent "glow" tint over panels
    const glowOver = (bg, a) => ({ r: primary.r * a + bg.r * (1 - a), g: primary.g * a + bg.g * (1 - a), b: primary.b * a + bg.b * (1 - a) })
    const glow = glowOver(panel, dark ? 0.18 : 0.12)
    const primaryText = dark
        ? readableShade(hue, 95, 76, [panel, app, glow], 1)
        : readableShade(hue, 75, 40, [panel, app, glow], -1)
    const accentText = dark
        ? readableShade((hue + 30) % 360, 95, 76, [panel, app], 1)
        : readableShade((hue + 30) % 360, 70, 40, [panel, app], -1)

    root.style.setProperty('--on-primary', rgbCss(onPrimary))
    root.style.setProperty('--primary-text', rgbCss(primaryText))
    root.style.setProperty('--accent-text', rgbCss(accentText))
    root.style.setProperty('--primary-rgb', rgbTriplet(primary))
    if (accent) root.style.setProperty('--accent-rgb', rgbTriplet(accent))

    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', rgbCss(app))
}

function getSystemPrefersDark() {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
}

export function ThemeProvider({ children }) {
    // 'light' | 'dark' | 'system'
    const [preference, setPreferenceState] = useState(() => {
        const saved = readStorage(THEME_KEY)
        return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
    })
    const [systemDark, setSystemDark] = useState(getSystemPrefersDark)
    const [hue, setHueState] = useState(() => {
        const saved = parseInt(readStorage(HUE_KEY), 10)
        return Number.isFinite(saved) ? ((saved % 360) + 360) % 360 : 250
    })

    const theme = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

    useEffect(() => {
        if (!window.matchMedia) return undefined
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const onChange = (e) => setSystemDark(e.matches)
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [])

    // Before paint, so there's never a frame with the wrong theme
    useLayoutEffect(() => {
        const root = document.documentElement
        root.setAttribute('data-theme', theme)
        root.style.setProperty('--hue', String(hue))
        applyDerivedTokens(theme, hue)
    }, [theme, hue])

    const withTransition = useCallback((fn) => {
        const root = document.documentElement
        root.classList.add('theme-transition')
        fn()
        window.setTimeout(() => root.classList.remove('theme-transition'), 300)
    }, [])

    const setPreference = useCallback((next) => {
        withTransition(() => setPreferenceState(next))
        writeStorage(THEME_KEY, next)
    }, [withTransition])

    const toggle = useCallback(() => {
        setPreference(theme === 'dark' ? 'light' : 'dark')
    }, [theme, setPreference])

    const setHue = useCallback((next) => {
        const value = ((Math.round(Number(next)) % 360) + 360) % 360
        setHueState(value)
        writeStorage(HUE_KEY, String(value))
    }, [])

    const value = useMemo(() => ({ theme, preference, setPreference, toggle, hue, setHue }), [theme, preference, setPreference, toggle, hue, setHue])

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
    const ctx = useContext(ThemeContext)
    if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
    return ctx
}
