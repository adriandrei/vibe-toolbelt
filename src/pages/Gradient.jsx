import { useState } from 'react'
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SliderField from '../components/ui/SliderField'
import ColorField from '../components/ui/ColorField'
import CodeBlock from '../components/ui/CodeBlock'
import SegmentedControl from '../components/ui/SegmentedControl'
import Field from '../components/ui/Field'
import { PipelineSend } from '../components/PipelineFeature'
import { parseColor, toHex } from '../utils/color'

const TYPES = [
    { value: 'linear', label: 'Linear' },
    { value: 'radial', label: 'Radial' },
    { value: 'conic', label: 'Conic' },
]

const SHAPES = [
    { value: 'ellipse', label: 'Ellipse' },
    { value: 'circle', label: 'Circle' },
]

const POSITIONS = ['center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right']

const MAX_STOPS = 8

const round = (n) => Math.round(n * 10) / 10

/** Builds the CSS gradient. Stops are emitted in position order; positions are
 *  left out when they're the evenly spaced defaults (0% … 100%). */
function buildGradient({ type, angle, shape, position, stops }) {
    const sorted = [...stops].sort((a, b) => a.pos - b.pos)
    const n = sorted.length
    const even = sorted.every((stop, i) => Math.abs(stop.pos - (n === 1 ? 0 : (i * 100) / (n - 1))) < 0.05)
    const list = sorted.map(stop => (even ? stop.color : `${stop.color} ${round(stop.pos)}%`)).join(', ')
    const at = position !== 'center' ? ` at ${position}` : ''
    if (type === 'radial') return `radial-gradient(${shape}${at}, ${list})`
    if (type === 'conic') return `conic-gradient(from ${angle}deg${at}, ${list})`
    return `linear-gradient(${angle}deg, ${list})`
}

// Colour halfway between two hex colours (for a new stop)
function mix(a, b) {
    const ca = parseColor(a) ?? { r: 0, g: 0, b: 0 }
    const cb = parseColor(b) ?? ca
    return toHex({ r: (ca.r + cb.r) / 2, g: (ca.g + cb.g) / 2, b: (ca.b + cb.b) / 2 }, false)
}

export default function Gradient() {
    const [type, setType] = useState('linear')
    const [angle, setAngle] = useState(45)
    const [shape, setShape] = useState('ellipse')
    const [position, setPosition] = useState('center')
    const [stops, setStops] = useState([
        { id: 1, color: '#6366f1', pos: 0 },
        { id: 2, color: '#a855f7', pos: 100 },
    ])

    const gradient = buildGradient({ type, angle, shape, position, stops })
    const css = `background: ${gradient};`

    const updateStop = (id, patch) => setStops(list => list.map(stop => (stop.id === id ? { ...stop, ...patch } : stop)))
    const removeStop = (id) => setStops(list => (list.length > 2 ? list.filter(stop => stop.id !== id) : list))

    const addStop = () => setStops((list) => {
        if (list.length >= MAX_STOPS) return list
        // Put the new stop in the middle of the widest gap
        const sorted = [...list].sort((a, b) => a.pos - b.pos)
        let best = 0
        for (let i = 1; i < sorted.length - 1; i++) {
            if (sorted[i + 1].pos - sorted[i].pos > sorted[best + 1].pos - sorted[best].pos) best = i
        }
        const left = sorted[best]
        const right = sorted[best + 1]
        const id = Math.max(...list.map(stop => stop.id)) + 1
        const stop = { id, color: mix(left.color, right.color), pos: round((left.pos + right.pos) / 2) }
        // The list is re-ordered by position, so "Stop 2" is the second colour
        return [...sorted.slice(0, best + 1), stop, ...sorted.slice(best + 1)]
    })

    // Mirror the gradient: first stop becomes last
    const reverse = () => setStops(list => [...list].reverse().map(stop => ({ ...stop, pos: 100 - stop.pos })))

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane">
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                    <div>
                        <span className="field-label">Type</span>
                        <SegmentedControl ariaLabel="Gradient type" value={type} onChange={setType} options={TYPES} block />
                    </div>

                    {type !== 'radial' && (
                        <SliderField
                            label={type === 'conic' ? 'Start angle (°)' : 'Angle (°)'}
                            value={angle}
                            onChange={setAngle}
                            min={0}
                            max={360}
                            unit="°"
                            showInput
                        />
                    )}

                    {type === 'radial' && (
                        <div>
                            <span className="field-label">Shape</span>
                            <SegmentedControl ariaLabel="Radial shape" value={shape} onChange={setShape} options={SHAPES} size="sm" />
                        </div>
                    )}

                    {type !== 'linear' && (
                        <Field label="Centre">
                            <select value={position} onChange={e => setPosition(e.target.value)}>
                                {POSITIONS.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
                            </select>
                        </Field>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <h2 className="section-title">Colour stops</h2>
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                <button type="button" className="btn btn-ghost btn-sm" onClick={reverse} title="Reverse the order of the colours">
                                    <ArrowLeftRight size={14} aria-hidden="true" /> Reverse
                                </button>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={addStop} disabled={stops.length >= MAX_STOPS}>
                                    <Plus size={14} aria-hidden="true" /> Add stop
                                </button>
                            </div>
                        </div>

                        {stops.map((stop, index) => {
                            const n = index + 1
                            return (
                                <div
                                    key={stop.id}
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                                        gap: 'var(--space-sm)',
                                        padding: 'var(--space-md)',
                                        background: 'var(--bg-subtle)',
                                        border: '1px solid var(--border)',
                                        borderRadius: 'var(--radius-md)',
                                    }}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                                        <ColorField label={`Stop ${n} colour`} value={stop.color} onChange={color => updateStop(stop.id, { color })} />
                                        <SliderField
                                            label={`Stop ${n} position (%)`}
                                            value={stop.pos}
                                            onChange={pos => updateStop(stop.id, { pos })}
                                            min={0}
                                            max={100}
                                            unit="%"
                                            showInput
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        className="icon-btn"
                                        onClick={() => removeStop(stop.id)}
                                        disabled={stops.length <= 2}
                                        aria-label={`Remove stop ${n}`}
                                        title={stops.length <= 2 ? 'A gradient needs at least two stops' : `Remove stop ${n}`}
                                    >
                                        <Trash2 size={16} aria-hidden="true" />
                                    </button>
                                </div>
                            )
                        })}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <div
                        role="img"
                        aria-label={`Gradient preview: ${gradient}`}
                        style={{
                            minHeight: 320,
                            flex: 1,
                            background: gradient,
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--border)',
                            boxShadow: 'var(--shadow-md)',
                        }}
                    />
                    <div className="card card-compact">
                        <CodeBlock code={css} language="css" title="CSS" copyLabel="Copy CSS" actions={<PipelineSend dataToSend={css} />} />
                    </div>
                </div>
            </div>
        </div>
    )
}
