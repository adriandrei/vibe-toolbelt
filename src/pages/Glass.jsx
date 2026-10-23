import { useState } from 'react'
import ToolHeader from '../components/ui/ToolHeader'
import SliderField from '../components/ui/SliderField'
import ColorField from '../components/ui/ColorField'
import CodeBlock from '../components/ui/CodeBlock'
import SegmentedControl from '../components/ui/SegmentedControl'
import { PipelineSend } from '../components/PipelineFeature'
import { parseColor } from '../utils/color'

// Preview backgrounds. Pure CSS (no images), so the page works offline and
// nothing is fetched from third parties. Crisp shapes make the blur visible.
// These colours are user-facing content, not UI chrome.
const SCENES = {
    aurora: {
        label: 'Aurora',
        background: 'linear-gradient(135deg, #0f172a 0%, #312e81 50%, #6d28d9 100%)',
        text: '#ffffff',
        shapes: [
            { left: '4%', top: '8%', size: '42%', background: 'linear-gradient(160deg, #22d3ee, #3b82f6)' },
            { left: '58%', top: '46%', size: '46%', background: 'linear-gradient(200deg, #f472b6, #e11d48)' },
            { left: '66%', top: '2%', size: '18%', background: '#facc15' },
            { left: '14%', top: '68%', size: '14%', background: '#34d399' },
        ],
    },
    sunset: {
        label: 'Sunset',
        background: 'linear-gradient(160deg, #7c2d12 0%, #c2410c 45%, #fb923c 100%)',
        text: '#ffffff',
        shapes: [
            { left: '52%', top: '6%', size: '40%', background: 'linear-gradient(180deg, #fde047, #f97316)' },
            { left: '-6%', top: '52%', size: '48%', background: 'linear-gradient(90deg, #be123c, #9d174d)' },
            { left: '30%', top: '76%', size: '16%', background: '#0ea5e9' },
        ],
    },
    paper: {
        label: 'Light',
        background: 'linear-gradient(135deg, #f8fafc 0%, #e0e7ff 60%, #fae8ff 100%)',
        text: '#1e1b4b',
        shapes: [
            { left: '6%', top: '10%', size: '36%', background: 'linear-gradient(160deg, #a5b4fc, #6366f1)' },
            { left: '60%', top: '50%', size: '42%', background: 'linear-gradient(200deg, #f9a8d4, #ec4899)' },
            { left: '70%', top: '6%', size: '16%', background: '#fbbf24' },
        ],
    },
}

const SCENE_OPTIONS = Object.entries(SCENES).map(([value, scene]) => ({ value, label: scene.label }))

const BORDER = '1px solid rgba(255, 255, 255, 0.125)'
const SHADOW = '0 8px 32px 0 rgba(0, 0, 0, 0.37)'

export default function Glass() {
    const [blur, setBlur] = useState(12)
    const [opacity, setOpacity] = useState(20) // % alpha of the base colour
    const [saturation, setSaturation] = useState(100) // %
    const [radius, setRadius] = useState(12)
    const [color, setColor] = useState('#ffffff')
    const [sceneKey, setSceneKey] = useState('aurora')

    const { r, g, b } = parseColor(color) ?? { r: 255, g: 255, b: 255 }
    const background = `rgba(${r}, ${g}, ${b}, ${+(opacity / 100).toFixed(2)})`
    const filter = `blur(${blur}px) saturate(${saturation}%)`
    const css = [
        `background: ${background};`,
        `backdrop-filter: ${filter};`,
        `-webkit-backdrop-filter: ${filter};`,
        `border: ${BORDER};`,
        `border-radius: ${radius}px;`,
        `box-shadow: ${SHADOW};`,
    ].join('\n')

    const scene = SCENES[sceneKey]

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane">
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                    <SliderField label="Blur (px)" value={blur} onChange={setBlur} min={0} max={40} unit="px" showInput />
                    <SliderField
                        label="Opacity (%)"
                        value={opacity}
                        onChange={setOpacity}
                        min={0}
                        max={100}
                        unit="%"
                        showInput
                        hint="How opaque the base colour is. Lower values let more of the background through."
                    />
                    <SliderField label="Saturation (%)" value={saturation} onChange={setSaturation} min={0} max={200} unit="%" showInput />
                    <SliderField label="Corner radius (px)" value={radius} onChange={setRadius} min={0} max={48} unit="px" showInput />
                    <ColorField label="Base colour" value={color} onChange={setColor} />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <section className="card card-compact" aria-label="Preview" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <h2 className="section-title">Preview</h2>
                            <SegmentedControl ariaLabel="Preview background" size="sm" value={sceneKey} onChange={setSceneKey} options={SCENE_OPTIONS} />
                        </div>
                        <div
                            style={{
                                position: 'relative',
                                overflow: 'hidden',
                                borderRadius: 'var(--radius-md)',
                                minHeight: 300,
                                padding: 'clamp(16px, 7%, 48px)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: scene.background,
                                isolation: 'isolate',
                            }}
                        >
                            {scene.shapes.map((shape, i) => (
                                <div
                                    key={i}
                                    aria-hidden="true"
                                    style={{
                                        position: 'absolute',
                                        left: shape.left,
                                        top: shape.top,
                                        width: shape.size,
                                        aspectRatio: '1',
                                        borderRadius: '50%',
                                        background: shape.background,
                                        zIndex: -1,
                                    }}
                                />
                            ))}
                            <div
                                style={{
                                    width: 'min(100%, 340px)',
                                    minHeight: 190,
                                    padding: 24,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    textAlign: 'center',
                                    gap: 6,
                                    color: scene.text,
                                    background,
                                    backdropFilter: filter,
                                    WebkitBackdropFilter: filter,
                                    border: BORDER,
                                    borderRadius: radius,
                                    boxShadow: SHADOW,
                                }}
                            >
                                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>Glassmorphism</div>
                                <div style={{ opacity: 0.85 }}>Pure CSS effect</div>
                            </div>
                        </div>
                    </section>

                    <section className="card card-compact" aria-label="Generated CSS">
                        <CodeBlock code={css} language="css" title="CSS" copyLabel="Copy CSS" actions={<PipelineSend dataToSend={css} />} />
                    </section>
                </div>
            </div>
        </div>
    )
}
