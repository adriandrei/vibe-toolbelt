import { useState } from 'react'
import { CopyPlus, Plus, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SliderField from '../components/ui/SliderField'
import ColorField from '../components/ui/ColorField'
import CodeBlock from '../components/ui/CodeBlock'
import SegmentedControl from '../components/ui/SegmentedControl'
import { PipelineSend } from '../components/PipelineFeature'
import { parseColor } from '../utils/color'

// opacity is a percentage (0-100)
const layer = (x, y, blur, spread, opacity, color = '#000000', inset = false) => ({ x, y, blur, spread, opacity, color, inset })

const PRESETS = [
    { name: 'Subtle', layers: [layer(0, 1, 3, 0, 10), layer(0, 1, 2, -1, 10)] },
    { name: 'Medium', layers: [layer(0, 10, 15, -3, 10), layer(0, 4, 6, -4, 10)] },
    { name: 'Large', layers: [layer(0, 20, 25, -5, 10), layer(0, 8, 10, -6, 10)] },
    { name: 'Floating', layers: [layer(0, 25, 50, -12, 25)] },
    { name: 'Hard', layers: [layer(6, 6, 0, 0, 100, '#111827')] },
    { name: 'Inner', layers: [layer(0, 2, 4, 0, 15, '#000000', true)] },
]

const STAGES = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'checker', label: 'Checkerboard' },
]
// The stage is a preview surface the user picks, so its colours are literal
const STAGE_BACKGROUNDS = { light: '#f4f4f5', dark: '#18181b' }

// Layers get ids above every id already in use, so React keys stay unique
const maxId = (list) => list.reduce((max, l) => Math.max(max, l.id), 0)
const withIds = (layers, after = 0) => layers.map((l, i) => ({ ...l, id: after + i + 1 }))

function shadowValue(l) {
    const { r, g, b } = parseColor(l.color) ?? { r: 0, g: 0, b: 0 }
    const alpha = +(l.opacity / 100).toFixed(2)
    return `${l.inset ? 'inset ' : ''}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px rgba(${r}, ${g}, ${b}, ${alpha})`
}

export default function BoxShadow() {
    const [layers, setLayers] = useState(() => withIds([layer(0, 10, 15, -3, 10)]))
    const [stage, setStage] = useState('light')
    const [boxColor, setBoxColor] = useState('#ffffff')
    const [radius, setRadius] = useState(12)

    const values = layers.map(shadowValue)
    const shadow = values.join(', ')
    const css = values.length === 1
        ? `box-shadow: ${values[0]};`
        : `box-shadow:\n  ${values.join(',\n  ')};`

    const update = (id, patch) => setLayers(list => list.map(l => (l.id === id ? { ...l, ...patch } : l)))
    const remove = (id) => setLayers(list => (list.length > 1 ? list.filter(l => l.id !== id) : list))
    const duplicate = (id) => setLayers((list) => {
        const i = list.findIndex(l => l.id === id)
        return i < 0 ? list : [...list.slice(0, i + 1), { ...list[i], id: maxId(list) + 1 }, ...list.slice(i + 1)]
    })
    const add = () => setLayers(list => [...list, { ...layer(0, 4, 12, 0, 20), id: maxId(list) + 1 }])
    const applyPreset = (preset) => setLayers(list => withIds(preset.layers, maxId(list)))

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        <h2 className="section-title">Presets</h2>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                            {PRESETS.map(p => (
                                <button key={p.name} type="button" className="chip" onClick={() => applyPreset(p)}>
                                    {p.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {layers.map((l, i) => (
                        <section key={l.id} className="card card-compact" aria-label={`Layer ${i + 1}`} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                                <h2 className="section-title">Layer {i + 1}</h2>
                                <div style={{ display: 'flex', gap: 2 }}>
                                    <button type="button" className="icon-btn" onClick={() => duplicate(l.id)} aria-label={`Duplicate layer ${i + 1}`} title="Duplicate layer">
                                        <CopyPlus size={16} aria-hidden="true" />
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn"
                                        onClick={() => remove(l.id)}
                                        disabled={layers.length === 1}
                                        aria-label={`Remove layer ${i + 1}`}
                                        title={layers.length === 1 ? 'At least one layer is needed' : 'Remove layer'}
                                    >
                                        <Trash2 size={16} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>

                            <div className="auto-grid" style={{ '--auto-grid-min': '210px', gap: 'var(--space-md) var(--space-lg)' }}>
                                <SliderField label="X offset (px)" value={l.x} onChange={x => update(l.id, { x })} min={-100} max={100} unit="px" showInput />
                                <SliderField label="Y offset (px)" value={l.y} onChange={y => update(l.id, { y })} min={-100} max={100} unit="px" showInput />
                                <SliderField label="Blur (px)" value={l.blur} onChange={blur => update(l.id, { blur })} min={0} max={150} unit="px" showInput />
                                <SliderField label="Spread (px)" value={l.spread} onChange={spread => update(l.id, { spread })} min={-100} max={100} unit="px" showInput />
                                <SliderField label="Opacity (%)" value={l.opacity} onChange={opacity => update(l.id, { opacity })} min={0} max={100} unit="%" showInput />
                                <ColorField label="Colour" value={l.color} onChange={color => update(l.id, { color })} />
                            </div>

                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.9rem', cursor: 'pointer', alignSelf: 'flex-start' }}>
                                <input type="checkbox" checked={l.inset} onChange={e => update(l.id, { inset: e.target.checked })} />
                                Inset shadow
                            </label>
                        </section>
                    ))}

                    <button type="button" className="btn btn-secondary" onClick={add} style={{ alignSelf: 'flex-start' }}>
                        <Plus size={16} aria-hidden="true" /> Add layer
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <h2 className="section-title">Preview</h2>
                            <SegmentedControl ariaLabel="Preview background" size="sm" value={stage} onChange={setStage} options={STAGES} />
                        </div>
                        <div
                            className={stage === 'checker' ? 'checkerboard' : undefined}
                            style={{
                                minHeight: 340,
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 'var(--space-xl)',
                                overflow: 'hidden',
                                background: stage === 'checker' ? undefined : STAGE_BACKGROUNDS[stage],
                            }}
                        >
                            <div
                                role="img"
                                aria-label="Box with the generated shadow"
                                style={{ width: 'min(200px, 70%)', aspectRatio: '1', background: boxColor, borderRadius: radius, boxShadow: shadow }}
                            />
                        </div>
                        <div className="auto-grid" style={{ '--auto-grid-min': '200px' }}>
                            <ColorField label="Box colour" value={boxColor} onChange={setBoxColor} />
                            <SliderField label="Box corner radius" value={radius} onChange={setRadius} min={0} max={100} unit="px" />
                        </div>
                    </div>

                    <div className="card card-compact">
                        <CodeBlock code={css} language="css" title="CSS" copyLabel="Copy CSS" actions={<PipelineSend dataToSend={css} />} />
                    </div>
                </div>
            </div>
        </div>
    )
}
