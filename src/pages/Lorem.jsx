import { useId, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import { PipelineSend } from '../components/PipelineFeature'

// The classic Lorem ipsum vocabulary (Cicero, "De finibus", as mangled by
// typesetters). Small and dependency-free, unlike a full faker locale.
const WORDS = [...new Set((
    'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore ' +
    'magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat ' +
    'duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint occaecat ' +
    'cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum curabitur pretium tincidunt ' +
    'lacus nunc pulvinar sapien vitae ligula ultrices morbi tristique senectus netus malesuada fames ac turpis egestas ' +
    'integer feugiat scelerisque varius vestibulum mattis ullamcorper nibh praesent semper nisl fusce porta lectus ' +
    'quam vulputate dignissim suspendisse viverra accumsan iaculis urna faucibus cras fermentum odio eu mauris blandit ' +
    'aliquam etiam erat donec massa placerat orci facilisi nullam vehicula eget gravida natoque penatibus magnis dis ' +
    'parturient montes nascetur ridiculus mus pellentesque habitant leo vel tellus rutrum tortor condimentum lacinia ' +
    'quisque sagittis purus mi bibendum neque congue hendrerit dictum fringilla phasellus arcu risus at augue interdum ' +
    'posuere euismod luctus convallis aenean sollicitudin imperdiet sem ornare libero justo laoreet molestie'
).split(' '))]

const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit'

const UNITS = [
    { value: 'paragraphs', label: 'Paragraphs' },
    { value: 'sentences', label: 'Sentences' },
    { value: 'words', label: 'Words' },
]

const MIN_COUNT = 1
const MAX_COUNT = 100

// Small seeded PRNG (mulberry32): the same seed always gives the same text,
// so changing the count adds or removes items instead of reshuffling them.
function createRandom(seed) {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function generateLorem({ count, unit, seed, classic }) {
    const random = createRandom(seed)
    const between = (min, max) => min + Math.floor(random() * (max - min + 1))
    const word = () => WORDS[Math.floor(random() * WORDS.length)]
    const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

    const sentence = () => {
        const length = between(6, 14)
        const words = []
        for (let i = 0; i < length; i++) {
            const comma = i > 1 && i < length - 2 && random() < 0.1
            words.push(word() + (comma ? ',' : ''))
        }
        return capitalize(words.join(' ')) + '.'
    }
    const paragraph = (first) => {
        const sentences = []
        const length = between(4, 7)
        for (let i = 0; i < length; i++) sentences.push(first && i === 0 ? `${CLASSIC_OPENING}.` : sentence())
        return sentences.join(' ')
    }

    if (unit === 'words') {
        const opening = classic ? CLASSIC_OPENING.toLowerCase().replace(/,/g, '').split(' ') : []
        const words = []
        for (let i = 0; i < count; i++) words.push(i < opening.length ? opening[i] : word())
        return words.join(' ')
    }
    if (unit === 'sentences') {
        const sentences = []
        for (let i = 0; i < count; i++) sentences.push(classic && i === 0 ? `${CLASSIC_OPENING}.` : sentence())
        return sentences.join(' ')
    }
    const paragraphs = []
    for (let i = 0; i < count; i++) paragraphs.push(paragraph(classic && i === 0))
    return paragraphs.join('\n\n')
}

const clampCount = (n) => Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(Number.isFinite(n) ? n : MIN_COUNT)))

export default function Lorem() {
    const classicId = useId()
    const countId = useId()
    const [count, setCount] = useState(3)
    // What's typed in the number box; may be briefly empty or out of range
    const [countText, setCountText] = useState('3')
    const [unit, setUnit] = useState('paragraphs')
    const [classic, setClassic] = useState(true)
    const [seed, setSeed] = useState(1)

    // Regenerates whenever the count, unit or opening changes
    const text = useMemo(() => generateLorem({ count, unit, seed, classic }), [count, unit, seed, classic])
    const wordCount = useMemo(() => text.split(/\s+/).filter(Boolean).length, [text])

    const unitLabel = UNITS.find(u => u.value === unit).label.toLowerCase()
    const counts = `${wordCount.toLocaleString()} ${wordCount === 1 ? 'word' : 'words'} · ${text.length.toLocaleString()} characters`
    const summary = unit === 'words' ? counts : `${count} ${count === 1 ? unitLabel.replace(/s$/, '') : unitLabel} · ${counts}`

    const typed = Number(countText)
    const countInvalid = countText.trim() === '' || !Number.isInteger(typed) || typed < MIN_COUNT || typed > MAX_COUNT

    const updateCount = (n) => {
        const next = clampCount(n)
        setCount(next)
        setCountText(String(next))
    }

    return (
        <div className="page page-narrow">
            <ToolHeader />

            <section className="card" aria-label="Options" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                        <label className="field-label" htmlFor={countId}>How many</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <input
                                type="range"
                                min={MIN_COUNT}
                                max={MAX_COUNT}
                                value={count}
                                aria-label="How many (slider)"
                                aria-valuetext={`${count} ${unitLabel}`}
                                onChange={(e) => updateCount(Number(e.target.value))}
                                style={{ flex: 1, minWidth: 0 }}
                            />
                            <input
                                id={countId}
                                type="number"
                                inputMode="numeric"
                                min={MIN_COUNT}
                                max={MAX_COUNT}
                                step={1}
                                value={countText}
                                aria-invalid={countInvalid || undefined}
                                aria-describedby={`${countId}-hint`}
                                className={countInvalid ? 'field-invalid' : ''}
                                onChange={(e) => {
                                    setCountText(e.target.value)
                                    const n = e.target.valueAsNumber
                                    if (Number.isFinite(n)) setCount(clampCount(n))
                                }}
                                onBlur={() => setCountText(String(count))}
                                style={{ width: '5.5rem', flexShrink: 0, padding: '0.45rem 0.6rem', fontSize: '0.95rem' }}
                            />
                        </div>
                        <div id={`${countId}-hint`} className={countInvalid ? 'field-error' : 'field-hint'}>
                            {countInvalid ? `Enter a whole number from ${MIN_COUNT} to ${MAX_COUNT} (using ${count})` : `${MIN_COUNT}–${MAX_COUNT}`}
                        </div>
                    </div>
                    <div style={{ flex: '0 1 auto', minWidth: 0 }}>
                        <span className="field-label" aria-hidden="true">Unit</span>
                        <SegmentedControl ariaLabel="Unit" options={UNITS} value={unit} onChange={setUnit} />
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label htmlFor={classicId} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', fontSize: '0.9rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <input id={classicId} type="checkbox" checked={classic} onChange={(e) => setClassic(e.target.checked)} />
                        Start with “Lorem ipsum dolor sit amet…”
                    </label>
                    <button type="button" className="btn btn-secondary" onClick={() => setSeed(s => s + 1)}>
                        <RefreshCw size={16} aria-hidden="true" /> Regenerate
                    </button>
                </div>
            </section>

            <section className="card" aria-label="Generated text">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }} aria-live="polite">{summary}</span>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <PipelineSend dataToSend={text} />
                        <CopyButton text={text} variant="secondary" />
                    </div>
                </div>
                <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7, fontSize: '1rem', color: 'var(--text-main)' }}>
                    {text}
                </div>
            </section>
        </div>
    )
}
