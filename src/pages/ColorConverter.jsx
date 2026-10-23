import { useId, useState } from 'react'
import { Dices } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SliderField from '../components/ui/SliderField'
import CopyButton from '../components/ui/CopyButton'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { contrastRatio, parseColor, toHex, toRgbString } from '../utils/color'

// ---------------------------------------------------------------- parsing

const CSS_WIDE = /^(inherit|initial|unset|revert|revert-layer|currentcolor)$/i
let rasterContext = null

// Modern syntaxes (oklch(), lab(), color(display-p3 …), color-mix()…) that
// the canvas keeps in their own colour space: draw one pixel and read it back
// as (gamut-clipped) sRGB.
function rasterize(input) {
    if (typeof CSS === 'undefined' || !CSS.supports('color', input) || CSS_WIDE.test(input) || /var\(/i.test(input)) return null
    if (!rasterContext) {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        rasterContext = canvas.getContext('2d', { willReadFrequently: true })
    }
    const ctx = rasterContext
    // Two different sentinels: if both survive, the canvas rejected the value
    ctx.fillStyle = '#010203'
    ctx.fillStyle = input
    const first = ctx.fillStyle
    ctx.fillStyle = '#030201'
    ctx.fillStyle = input
    if (ctx.fillStyle !== first) return null
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return { r, g, b, a: Math.round((a / 255) * 1000) / 1000 }
}

function parseAnyColor(input) {
    const value = String(input ?? '').trim()
    if (!value) return null
    return parseColor(value) ?? rasterize(value)
}

// ------------------------------------------------------------ conversions

function rgbToHsl({ r, g, b }) {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    if (d === 0) return { h: 0, s: 0, l: l * 100 }
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    let h
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    return { h: h * 60, s: s * 100, l: l * 100 }
}

function hslToRgb({ h, s, l }) {
    s /= 100
    l /= 100
    const k = (n) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
    return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }
}

const toLinear = (c) => {
    c /= 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

// sRGB -> OKLab -> OKLCH (Björn Ottosson's matrices)
function rgbToOklch({ r, g, b }) {
    const lr = toLinear(r)
    const lg = toLinear(g)
    const lb = toLinear(b)
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    const C = Math.sqrt(A * A + B * B)
    let H = (Math.atan2(B, A) * 180) / Math.PI
    if (H < 0) H += 360
    return { l: L, c: C, h: H }
}

const fmt = (n, digits = 1) => String(+n.toFixed(digits))
const fmtHue = (h) => fmt(Number(fmt(h)) >= 360 ? 0 : h)

function formatAll(color) {
    const { a } = color
    const translucent = a < 1
    const alpha = fmt(a, 3)
    const hsl = rgbToHsl(color)
    const hue = hsl.s === 0 ? 0 : hsl.h
    const w = (Math.min(color.r, color.g, color.b) / 255) * 100
    const bl = (1 - Math.max(color.r, color.g, color.b) / 255) * 100
    const ok = rgbToOklch(color)
    const chroma = ok.c < 0.00005 ? 0 : ok.c
    return [
        { key: 'hex', label: 'HEX', value: toHex(color) },
        { key: 'rgb', label: 'RGB', value: toRgbString(color) },
        {
            key: 'hsl',
            label: 'HSL',
            value: translucent
                ? `hsla(${fmtHue(hue)}, ${fmt(hsl.s)}%, ${fmt(hsl.l)}%, ${alpha})`
                : `hsl(${fmtHue(hue)}, ${fmt(hsl.s)}%, ${fmt(hsl.l)}%)`,
        },
        { key: 'hwb', label: 'HWB', value: `hwb(${fmtHue(hue)} ${fmt(w)}% ${fmt(bl)}%${translucent ? ` / ${alpha}` : ''})` },
        {
            key: 'oklch',
            label: 'OKLCH',
            value: `oklch(${fmt(ok.l * 100, 2)}% ${fmt(chroma, 4)} ${chroma ? fmt(ok.h, 2) : 0}${translucent ? ` / ${alpha}` : ''})`,
        },
    ]
}

// Colour composited over an opaque background (for contrast with alpha)
const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) })
const WHITE = { r: 255, g: 255, b: 255 }
const BLACK = { r: 0, g: 0, b: 0 }

function ContrastBadge({ label, ratio }) {
    const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Fail'
    const tone = ratio >= 4.5 ? 'badge-success' : ratio >= 3 ? 'badge-warning' : 'badge-danger'
    return (
        <span className={`badge ${tone}`} title={`WCAG contrast ratio against ${label.toLowerCase()}`}>
            {label} {ratio.toFixed(2)}:1 · {level}
        </span>
    )
}

const INITIAL = { r: 99, g: 102, b: 241, a: 1 }

export default function ColorConverter() {
    const inputId = useId()
    // r, g, b are integers (0-255) and a is 0-1; `hue` remembers the hue
    // while the colour is grey, so the hue slider doesn't jump back to 0
    const [color, setColor] = useState({ ...INITIAL, hue: rgbToHsl(INITIAL).h })
    const [text, setText] = useState(toHex(INITIAL))

    const commit = (next, { keepText = false, hue } = {}) => {
        const rounded = {
            r: Math.round(Math.min(255, Math.max(0, next.r))),
            g: Math.round(Math.min(255, Math.max(0, next.g))),
            b: Math.round(Math.min(255, Math.max(0, next.b))),
            a: Math.min(1, Math.max(0, next.a ?? 1)),
        }
        const hsl = rgbToHsl(rounded)
        setColor(prev => ({ ...rounded, hue: hue ?? (hsl.s > 0 ? hsl.h : prev.hue) }))
        if (!keepText) setText(toHex(rounded))
    }

    const applyText = (value) => {
        setText(value)
        const parsed = parseAnyColor(value)
        if (parsed) commit(parsed, { keepText: true })
    }

    useSmartInput({ input: applyText })

    const hsl = rgbToHsl(color)
    const hue = hsl.s > 0 ? hsl.h : color.hue
    const setHsl = (patch) => {
        const next = { h: hue, s: hsl.s, l: hsl.l, ...patch }
        commit({ ...hslToRgb(next), a: color.a }, { hue: next.h % 360 })
    }

    const randomize = () => {
        const n = Math.floor(Math.random() * 0x1000000)
        commit({ r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 })
    }

    const valid = parseAnyColor(text) !== null
    const formats = formatAll(color)
    const hex = formats[0].value
    const solid = toHex(color, false)
    const css = `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`

    return (
        <div className="page page-medium">
            <ToolHeader />

            <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-lg)', alignItems: 'center' }}>
                <div
                    className="checkerboard"
                    style={{
                        width: 'min(140px, 100%)',
                        aspectRatio: '1',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--border-strong)',
                        overflow: 'hidden',
                        flexShrink: 0,
                    }}
                >
                    <div
                        role="img"
                        aria-label={`Colour swatch ${hex}`}
                        style={{ width: '100%', height: '100%', background: css, boxShadow: 'inset 0 0 0 1px var(--border)' }}
                    />
                </div>

                <div style={{ flex: '1 1 260px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <label className="field-label" htmlFor={inputId} style={{ marginBottom: 0 }}>Colour</label>
                        <PipelineRead onRead={applyText} />
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                        <input
                            type="color"
                            value={solid}
                            aria-label="Colour picker"
                            onChange={e => commit({ ...parseColor(e.target.value), a: color.a })}
                        />
                        <input
                            id={inputId}
                            type="text"
                            value={text}
                            spellCheck={false}
                            autoComplete="off"
                            aria-invalid={!valid}
                            aria-describedby={`${inputId}-msg`}
                            className={valid ? undefined : 'field-invalid'}
                            onChange={e => applyText(e.target.value)}
                            onBlur={() => { if (valid) setText(prev => prev.trim()) }}
                            style={{ fontFamily: 'var(--font-mono)', padding: '0.55rem 0.75rem', fontSize: '0.95rem', minWidth: 0 }}
                        />
                        <button type="button" className="btn btn-secondary" onClick={randomize} title="Random colour" aria-label="Random colour">
                            <Dices size={16} aria-hidden="true" /> <span className="hide-sm">Random</span>
                        </button>
                    </div>
                    {valid ? (
                        <div id={`${inputId}-msg`} className="field-hint">Hex (3, 4, 6 or 8 digits), rgb(), hsl(), hwb(), oklch(), lab() or a colour name.</div>
                    ) : (
                        <div id={`${inputId}-msg`} className="field-error">Not a colour. Try #6366f1, rgb(99 102 241 / 50%) or rebeccapurple.</div>
                    )}
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <ContrastBadge label="On white" ratio={contrastRatio(over(color, WHITE), WHITE)} />
                        <ContrastBadge label="On black" ratio={contrastRatio(over(color, BLACK), BLACK)} />
                    </div>
                </div>
            </div>

            <div className="split-pane">
                <section className="card" aria-label="HSL" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <h2 className="section-title">HSL</h2>
                    <SliderField label="Hue (°)" value={Math.round(hue) % 360} onChange={h => setHsl({ h })} min={0} max={359} unit="°" showInput />
                    <SliderField label="Saturation (%)" value={Math.round(hsl.s)} onChange={s => setHsl({ s })} min={0} max={100} unit="%" showInput />
                    <SliderField label="Lightness (%)" value={Math.round(hsl.l)} onChange={l => setHsl({ l })} min={0} max={100} unit="%" showInput />
                </section>
                <section className="card" aria-label="RGB and alpha" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <h2 className="section-title">RGB and alpha</h2>
                    <SliderField label="Red" value={color.r} onChange={r => commit({ ...color, r })} min={0} max={255} showInput />
                    <SliderField label="Green" value={color.g} onChange={g => commit({ ...color, g })} min={0} max={255} showInput />
                    <SliderField label="Blue" value={color.b} onChange={b => commit({ ...color, b })} min={0} max={255} showInput />
                    <SliderField label="Alpha (%)" value={Math.round(color.a * 100)} onChange={a => commit({ ...color, a: a / 100 })} min={0} max={100} unit="%" showInput />
                </section>
            </div>

            <section className="card" aria-label="Formats" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <h2 className="section-title">Formats</h2>
                    <PipelineSend dataToSend={hex} label="Send HEX to pipeline" />
                </div>
                {formats.map(f => (
                    <div
                        key={f.key}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-md)',
                            padding: '0.6rem 0.75rem',
                            background: 'var(--bg-inset)',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-md)',
                        }}
                    >
                        <span style={{ width: '3.5rem', flexShrink: 0, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--primary-text)' }}>{f.label}</span>
                        <code className="mono" style={{ flex: 1, minWidth: 0, fontSize: '0.9rem', color: 'var(--text-code)', overflowWrap: 'anywhere' }}>{f.value}</code>
                        <CopyButton text={f.value} iconOnly label={`Copy ${f.label}`} />
                    </div>
                ))}
            </section>
        </div>
    )
}
