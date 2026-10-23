import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowDownLeft, ArrowDownRight, ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SliderField from '../components/ui/SliderField'
import ColorField from '../components/ui/ColorField'
import CodeBlock from '../components/ui/CodeBlock'
import SegmentedControl from '../components/ui/SegmentedControl'
import { PipelineSend } from '../components/PipelineFeature'

// 3×3 picker; the middle cell is empty
const DIRECTIONS = [
    { value: 'top-left', label: 'Top left', icon: ArrowUpLeft },
    { value: 'top', label: 'Up', icon: ArrowUp },
    { value: 'top-right', label: 'Top right', icon: ArrowUpRight },
    { value: 'left', label: 'Left', icon: ArrowLeft },
    null,
    { value: 'right', label: 'Right', icon: ArrowRight },
    { value: 'bottom-left', label: 'Bottom left', icon: ArrowDownLeft },
    { value: 'bottom', label: 'Down', icon: ArrowDown },
    { value: 'bottom-right', label: 'Bottom right', icon: ArrowDownRight },
]

const TECHNIQUES = [
    { value: 'border', label: 'Borders' },
    { value: 'clip-path', label: 'clip-path' },
]

// clip-path polygons for each direction (the shape fills a width × height box)
const POLYGONS = {
    top: '50% 0, 100% 100%, 0 100%',
    bottom: '0 0, 100% 0, 50% 100%',
    left: '0 50%, 100% 0, 100% 100%',
    right: '0 0, 100% 50%, 0 100%',
    'top-left': '0 0, 100% 0, 0 100%',
    'top-right': '0 0, 100% 0, 100% 100%',
    'bottom-left': '0 0, 100% 100%, 0 100%',
    'bottom-right': '100% 0, 100% 100%, 0 100%',
}

const MAX_PREVIEW_HEIGHT = 360
const px = (n) => `${Math.round(n * 100) / 100}px`

/**
 * CSS declarations for a triangle that is exactly `w` × `h` pixels.
 * Border technique: a zero-size box whose coloured border is the triangle
 * and whose transparent neighbouring borders cut it diagonally.
 */
function triangleDeclarations({ direction, w, h, color, technique }) {
    if (technique === 'clip-path') {
        return [
            ['width', px(w)],
            ['height', px(h)],
            ['background', color],
            ['clip-path', `polygon(${POLYGONS[direction]})`],
        ]
    }
    const solid = (n) => `${px(n)} solid ${color}`
    const clear = (n) => `${px(n)} solid transparent`
    const sides = {
        top: [['border-left', clear(w / 2)], ['border-right', clear(w / 2)], ['border-bottom', solid(h)]],
        bottom: [['border-left', clear(w / 2)], ['border-right', clear(w / 2)], ['border-top', solid(h)]],
        left: [['border-top', clear(h / 2)], ['border-bottom', clear(h / 2)], ['border-right', solid(w)]],
        right: [['border-top', clear(h / 2)], ['border-bottom', clear(h / 2)], ['border-left', solid(w)]],
        'top-left': [['border-top', solid(h)], ['border-right', clear(w)]],
        'top-right': [['border-top', solid(h)], ['border-left', clear(w)]],
        'bottom-left': [['border-bottom', solid(h)], ['border-right', clear(w)]],
        'bottom-right': [['border-bottom', solid(h)], ['border-left', clear(w)]],
    }
    return [['width', '0'], ['height', '0'], ...sides[direction]]
}

const camel = (prop) => prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

export default function Triangle() {
    const [direction, setDirection] = useState('top')
    const [width, setWidth] = useState(120)
    const [height, setHeight] = useState(104)
    const [color, setColor] = useState('#10b981')
    const [technique, setTechnique] = useState('border')

    // Scale the preview down so a big triangle never overflows the stage
    const stageRef = useRef(null)
    const [stageWidth, setStageWidth] = useState(0)
    useEffect(() => {
        const el = stageRef.current
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(([entry]) => setStageWidth(entry.contentRect.width))
        observer.observe(el)
        return () => observer.disconnect()
    }, [])
    const scale = stageWidth > 0 ? Math.min(1, stageWidth / width, MAX_PREVIEW_HEIGHT / height) : 1

    const declarations = triangleDeclarations({ direction, w: width, h: height, color, technique })
    const css = declarations.map(([prop, value]) => `${prop}: ${value};`).join('\n')
    const shapeStyle = Object.fromEntries(declarations.map(([prop, value]) => [camel(prop), value]))

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane">
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                    <div>
                        <span className="field-label">Direction</span>
                        <div role="group" aria-label="Direction" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 2.75rem)', gap: 6 }}>
                            {DIRECTIONS.map((d, i) => {
                                if (!d) return <span key={i} aria-hidden="true" />
                                const active = direction === d.value
                                const Icon = d.icon
                                return (
                                    <button
                                        key={d.value}
                                        type="button"
                                        className={`chip ${active ? 'is-active' : ''}`}
                                        aria-pressed={active}
                                        aria-label={d.label}
                                        title={d.label}
                                        onClick={() => setDirection(d.value)}
                                        style={{ width: '2.75rem', height: '2.75rem', padding: 0, justifyContent: 'center', borderRadius: 'var(--radius-sm)' }}
                                    >
                                        <Icon size={18} aria-hidden="true" />
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <SliderField label="Width (px)" value={width} onChange={setWidth} min={2} max={600} unit="px" showInput />
                    <div>
                        <SliderField label="Height (px)" value={height} onChange={setHeight} min={2} max={600} unit="px" showInput />
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ marginTop: 'var(--space-xs)' }}
                            onClick={() => setHeight(Math.max(2, Math.round(width * Math.sqrt(3) / 2)))}
                            title="Set the height to width × √3 / 2"
                        >
                            Make equilateral
                        </button>
                    </div>
                    <ColorField label="Colour" value={color} onChange={setColor} />
                    <div>
                        <span className="field-label">Technique</span>
                        <SegmentedControl ariaLabel="CSS technique" value={technique} onChange={setTechnique} options={TECHNIQUES} size="sm" />
                        <div className="field-hint">
                            {technique === 'border'
                                ? 'Classic border trick: works everywhere, but the triangle can only be a solid colour.'
                                : 'A clipped box: can use gradients or images as its background.'}
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        <div
                            ref={stageRef}
                            className="stage"
                            style={{ minHeight: 300, padding: 'var(--space-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <div style={{ width: width * scale, height: height * scale, flexShrink: 0 }}>
                                <div
                                    role="img"
                                    aria-label={`Triangle pointing ${DIRECTIONS.find(d => d?.value === direction)?.label.toLowerCase()}, ${width} by ${height} pixels`}
                                    style={{ ...shapeStyle, transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: '0 0' }}
                                />
                            </div>
                        </div>
                        <div className="field-hint" style={{ margin: 0, textAlign: 'center' }}>
                            {width} × {height} px{scale < 1 ? ` · shown at ${Math.round(scale * 100)}% to fit` : ''}
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
