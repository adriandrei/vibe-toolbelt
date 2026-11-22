import { useId, useMemo, useState } from 'react'
import { ArrowLeftRight, Bell, Check, Heart, Search, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import ColorField from '../components/ui/ColorField'
import SegmentedControl from '../components/ui/SegmentedControl'
import ShareButton from '../components/ui/ShareButton'
import StatusBanner from '../components/ui/StatusBanner'
import { useToast } from '../components/ToastProvider'
import { useSharedState } from '../hooks/useSharedState'
import { useSmartInput } from '../hooks/useSmartInput'
import { normalizeColor, toHex } from '../utils/color'
import {
    BLACK, CRITERIA, WHITE,
    apcaContrast, effectiveColors, formatRatio, pairRatio, parseHex, passes, suggestColor,
} from '../utils/contrast'
import './Contrast.css'

const ROW_TEXT = {
    'normal-aa': { label: 'Normal text', detail: 'WCAG 1.4.3' },
    'normal-aaa': { label: 'Normal text', detail: 'WCAG 1.4.6' },
    'large-aa': { label: 'Large text', detail: '24px and up, or 18.66px bold · 1.4.3' },
    'large-aaa': { label: 'Large text', detail: 'WCAG 1.4.6' },
    ui: { label: 'UI components and graphics', detail: 'Borders, icons, focus rings · 1.4.11' },
}

const SUGGESTIONS = [
    { key: 'fg-aa', adjust: 'fg', target: 4.5, level: 'AA' },
    { key: 'fg-aaa', adjust: 'fg', target: 7, level: 'AAA' },
    { key: 'bg-aa', adjust: 'bg', target: 4.5, level: 'AA' },
    { key: 'bg-aaa', adjust: 'bg', target: 7, level: 'AAA' },
]

const BACKDROPS = [
    { value: 'white', label: 'White' },
    { value: 'black', label: 'Black' },
]

function verdictFor(ratio) {
    if (passes(ratio, 7)) return { tone: 'success', title: 'Passes AAA for all text' }
    if (passes(ratio, 4.5)) return { tone: 'success', title: 'Passes AA for all text', body: 'AAA only for large text.' }
    if (passes(ratio, 3)) return { tone: 'warning', title: 'Large text and UI only', body: 'Fails AA for normal-size text.' }
    return { tone: 'danger', title: 'Fails every WCAG 2 contrast check', body: 'Even large text and UI components need 3:1.' }
}

function Sample({ fg, bg, backdrop, children, className = '' }) {
    return (
        <div data-user-content="" style={{ background: backdrop, borderRadius: 'var(--radius-sm)' }}>
            <div className={className} style={{ background: bg, color: fg }}>{children}</div>
        </div>
    )
}

function SuggestionCard({ item, colors, onUse }) {
    const { result, adjust, target, level } = item
    const what = adjust === 'fg' ? 'text colour' : 'background'
    const title = `${adjust === 'fg' ? 'Text colour' : 'Background'} for ${level} (${target}:1)`
    const pick = (color) => (adjust === 'fg' ? { fg: color, bg: colors.bg } : { fg: colors.fg, bg: color })

    if (result.status === 'passes') {
        return (
            <div className="contrast-suggestion">
                <div className="contrast-suggestion-title">{title}</div>
                <div className="contrast-note" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
                    <Check size={14} aria-hidden="true" style={{ color: 'var(--success)' }} /> Already passes.
                </div>
            </div>
        )
    }

    const option = result.status === 'found' ? result : result.best
    const sample = pick(option.color)
    return (
        <div className="contrast-suggestion">
            <div className="contrast-suggestion-title">{title}</div>
            <Sample fg={sample.fg} bg={sample.bg} backdrop={colors.backdrop} className="contrast-swatch">Aa</Sample>
            <div className="contrast-suggestion-value">
                <code>{option.color}</code>
                <span>{formatRatio(option.ratio)}:1{result.status === 'found' ? ` · ${result.direction}` : ''}</span>
            </div>
            {result.status === 'found' && result.opaque && (
                <div className="contrast-note">Made opaque: no see-through version gets there.</div>
            )}
            {result.status === 'unreachable' && (
                <div className="contrast-note">
                    No {what} reaches {target}:1 here. {option.color === '#000000' ? 'Black' : 'White'} gives the most contrast.
                </div>
            )}
            <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onUse(adjust, option.color)}
                aria-label={`Use ${option.color} as the ${what}`}
                style={{ alignSelf: 'flex-start', marginTop: 'auto' }}
            >
                Use
            </button>
        </div>
    )
}

export default function Contrast() {
    const toast = useToast()
    const resultId = useId()
    const previewId = useId()
    const suggestId = useId()
    const [fg, setFg] = useState('#6366f1')
    const [bg, setBg] = useState('#ffffff')
    const [backdrop, setBackdrop] = useState('white')

    const model = useMemo(() => {
        const fgRgb = parseHex(fg) ?? BLACK
        const bgRgb = parseHex(bg) ?? WHITE
        const backdropRgb = backdrop === 'black' ? BLACK : WHITE
        const eff = effectiveColors(fgRgb, bgRgb, backdropRgb)
        const ratio = pairRatio(fgRgb, bgRgb, backdropRgb)
        return {
            fgRgb,
            bgRgb,
            eff,
            ratio,
            otherRatio: pairRatio(fgRgb, bgRgb, backdrop === 'black' ? WHITE : BLACK),
            apca: apcaContrast(eff.fg, eff.bg),
            suggestions: SUGGESTIONS.map(s => ({ ...s, result: suggestColor({ fg: fgRgb, bg: bgRgb, backdrop: backdropRgb, target: s.target, adjust: s.adjust }) })),
        }
    }, [fg, bg, backdrop])

    const { fgRgb, bgRgb, eff, ratio, otherRatio, apca } = model
    const fgTranslucent = fgRgb.a < 1
    const bgTranslucent = bgRgb.a < 1
    const backdropHex = backdrop === 'black' ? '#000000' : '#ffffff'
    const verdict = verdictFor(ratio)
    const colors = { fg, bg, backdrop: backdropHex }

    const applyShared = (value) => (typeof value === 'string' ? normalizeColor(value, true) : null)

    useSmartInput({
        input: (value) => {
            const color = applyShared(value)
            if (color) setFg(color)
            else toast.warning('That isn’t a colour. Try a hex value like #336699, rgb(), hsl() or a colour name.')
        },
    })

    useSharedState((shared) => {
        if (!shared || typeof shared !== 'object') return
        const nextFg = applyShared(shared.fg)
        const nextBg = applyShared(shared.bg)
        if (nextFg) setFg(nextFg)
        if (nextBg) setBg(nextBg)
        if (shared.backdrop === 'white' || shared.backdrop === 'black') setBackdrop(shared.backdrop)
    })

    const swap = () => {
        setFg(bg)
        setBg(fg)
    }

    const use = (adjust, color) => {
        if (adjust === 'fg') setFg(color)
        else setBg(color)
        toast.success(`${adjust === 'fg' ? 'Text colour' : 'Background'} set to ${color}`)
    }

    const apcaText = Math.abs(apca) < 0.05 ? '0' : apca.toFixed(1).replace('-', '−')

    return (
        <div className="page page-medium">
            <ToolHeader actions={<ShareButton getState={() => ({ fg, bg, backdrop })} />} />

            <section className="card" aria-label="Colours" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div className="contrast-fields">
                    <ColorField
                        label="Text colour"
                        value={fg}
                        onChange={setFg}
                        allowAlpha
                        hint={fgTranslucent ? `See-through: measured as ${toHex(eff.fg, false)}, as drawn on the background.` : 'Any CSS colour: hex, rgb(), hsl(), oklch() or a name.'}
                    />
                    <button type="button" className="icon-btn contrast-swap" onClick={swap} aria-label="Swap text and background colours" title="Swap colours">
                        <ArrowLeftRight size={18} aria-hidden="true" />
                    </button>
                    <ColorField
                        label="Background"
                        value={bg}
                        onChange={setBg}
                        allowAlpha
                        hint={bgTranslucent ? `See-through: measured as ${toHex(eff.bg, false)}, on ${backdrop}.` : 'Any CSS colour: hex, rgb(), hsl(), oklch() or a name.'}
                    />
                </div>
                {bgTranslucent && (
                    <StatusBanner tone="info" title="The background is see-through">
                        <p style={{ margin: 0 }}>
                            What’s behind it changes the result, so choose what it sits on. On {backdrop === 'black' ? 'white' : 'black'} the ratio would be {formatRatio(otherRatio)}:1.
                        </p>
                        <SegmentedControl ariaLabel="What the background sits on" size="sm" options={BACKDROPS} value={backdrop} onChange={setBackdrop} style={{ marginTop: 'var(--space-sm)' }} />
                    </StatusBanner>
                )}
            </section>

            <div className="split-pane">
                <section className="card" aria-labelledby={resultId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <h2 id={resultId} className="section-title">Contrast ratio</h2>
                    <div>
                        <div className="contrast-ratio" data-testid="contrast-ratio">
                            {formatRatio(ratio)}<span className="contrast-ratio-unit">:1</span>
                        </div>
                        <div className="field-hint" style={{ marginTop: 0 }}>WCAG 2 ratio, from 1:1 to 21:1. Never rounded up to a threshold.</div>
                    </div>
                    <StatusBanner tone={verdict.tone} title={verdict.title}>{verdict.body}</StatusBanner>
                    <table className="contrast-table">
                        <caption className="sr-only">WCAG 2 contrast checks</caption>
                        <thead>
                            <tr>
                                <th scope="col">Use</th>
                                <th scope="col">Level</th>
                                <th scope="col">Needs</th>
                                <th scope="col">Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {CRITERIA.map((c) => {
                                const ok = passes(ratio, c.min)
                                return (
                                    <tr key={c.id} data-criterion={c.id}>
                                        <th scope="row" className="contrast-use">
                                            {ROW_TEXT[c.id].label}
                                            <small>{ROW_TEXT[c.id].detail}</small>
                                        </th>
                                        <td>{c.level}</td>
                                        <td className="mono">{c.min}:1</td>
                                        <td>
                                            {ok ? (
                                                <span className="badge badge-success"><Check size={12} aria-hidden="true" /> Pass</span>
                                            ) : (
                                                <span className="badge badge-danger"><X size={12} aria-hidden="true" /> Fail</span>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    <div className="contrast-apca">
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <span className="section-title">APCA <span className="badge badge-info">Draft</span></span>
                            <span className="mono" data-testid="apca" style={{ fontWeight: 600 }}>Lc {apcaText}</span>
                        </div>
                        <p className="contrast-note" style={{ margin: 0 }}>
                            For information only: APCA is a candidate method for WCAG 3, not a requirement.
                            {apca < 0 ? ' Negative means light text on a dark background.' : ''} Rough guide: 75+ body text, 60+ other text, 45+ large headings, 30+ placeholder text, 15+ non-text.
                        </p>
                    </div>
                </section>

                <section className="card" aria-labelledby={previewId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <h2 id={previewId} className="section-title">Preview</h2>
                    {/* Visual only (it shows failing pairs on purpose): the ratio and checks above carry the information */}
                    <div className="contrast-preview-frame" data-user-content="" aria-hidden="true" style={{ background: backdropHex, flex: 1 }}>
                        <div className="contrast-preview" style={{ background: bg, color: fg }}>
                            <p className="contrast-sample-normal" style={{ margin: 0 }}>
                                Normal text at 16px. The quick brown fox jumps over the lazy dog.
                            </p>
                            <p className="contrast-sample-large" style={{ margin: 0 }}>Large text at 24px</p>
                            <p className="contrast-sample-bold" style={{ margin: 0 }}>Large bold text at 18.66px</p>
                            <div className="contrast-sample-row">
                                <span className="contrast-sample-button">Button</span>
                                <span className="contrast-sample-button" style={{ background: toHex(eff.fg, false), color: toHex(eff.bg, false), borderColor: toHex(eff.fg, false) }}>
                                    <Search size={16} aria-hidden="true" /> Search
                                </span>
                                <Bell size={24} aria-hidden="true" />
                                <Heart size={24} aria-hidden="true" />
                            </div>
                        </div>
                    </div>
                    <div className="field-hint" style={{ marginTop: 0 }}>
                        Large text is 24px (18pt) and up, or 18.66px (14pt) and up when bold. The filled button uses the colours the other way round.
                    </div>
                </section>
            </div>

            <section className="card" aria-labelledby={suggestId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div>
                    <h2 id={suggestId} className="section-title">Suggestions</h2>
                    <p className="field-hint" style={{ margin: 0 }}>
                        The closest colours that pass, with the same hue and chroma: only the OKLCH lightness changes (chroma is reduced only where the colour wouldn’t fit in sRGB).
                    </p>
                </div>
                <div className="auto-grid" style={{ '--auto-grid-min': '200px' }}>
                    {model.suggestions.map(item => <SuggestionCard key={item.key} item={item} colors={colors} onUse={use} />)}
                </div>
            </section>
        </div>
    )
}
