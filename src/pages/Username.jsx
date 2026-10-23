import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import SliderField from '../components/ui/SliderField'
import { randomInt } from '../utils/ids'

const ADJECTIVES = [
    'Swift', 'Cyber', 'Neon', 'Happy', 'Brave', 'Quiet', 'Misty', 'Cool', 'Hyper', 'Solar', 'Lunar', 'Cosmic',
    'Pixel', 'Retro', 'Nano', 'Vivid', 'Lazy', 'Wild', 'Calm', 'Bold', 'Clever', 'Fuzzy', 'Golden', 'Silent',
    'Rapid', 'Lucky', 'Mellow', 'Sunny', 'Frosty', 'Stormy', 'Crimson', 'Azure', 'Amber', 'Velvet', 'Atomic', 'Turbo',
    'Mighty', 'Gentle', 'Nimble', 'Witty', 'Jolly', 'Zesty', 'Sly', 'Plucky', 'Snappy', 'Breezy', 'Electric', 'Polar',
]
const NOUNS = [
    'Ninja', 'Coder', 'Fox', 'Wolf', 'Panda', 'Tiger', 'Dev', 'Bot', 'Ace', 'Star', 'Moon', 'Sun',
    'Orbit', 'Wave', 'Pulse', 'Byte', 'Panther', 'Spark', 'Beam', 'Flux', 'Otter', 'Falcon', 'Badger', 'Comet',
    'Rocket', 'Lynx', 'Raven', 'Koala', 'Gecko', 'Heron', 'Bison', 'Cobra', 'Dragon', 'Phoenix', 'Yeti', 'Kraken',
    'Wizard', 'Pilot', 'Ranger', 'Nomad', 'Sage', 'Scout', 'Puffin', 'Meteor', 'Glacier', 'Canyon', 'River', 'Maple',
]

const STYLES = [
    { value: 'readable', label: 'Readable' },
    { value: 'random', label: 'Random' },
]
const SEPARATORS = [
    { value: '', label: 'None' },
    { value: '_', label: '_' },
    { value: '-', label: '-' },
    { value: '.', label: '.' },
]
const CASES = [
    { value: 'pascal', label: 'PascalCase' },
    { value: 'lower', label: 'lowercase' },
]
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'
const LETTERS_DIGITS = `${LETTERS}0123456789`

const pick = (list) => list[randomInt(list.length)]

function formatLarge(n) {
    const units = [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million']]
    if (n >= 1e15) {
        const exp = Math.floor(Math.log10(n))
        return <>{(n / 10 ** exp).toFixed(1)} × 10<sup>{exp}</sup></>
    }
    const unit = units.find(([size]) => n >= size)
    return unit ? `${(n / unit[0]).toFixed(n / unit[0] < 10 ? 1 : 0)} ${unit[1]}` : n.toLocaleString()
}

function makeName({ style, length, separator, withNumber, letterCase }) {
    if (style === 'random') {
        // Starts with a letter, as most sites require
        let out = pick(LETTERS)
        for (let i = 1; i < length; i++) out += pick(LETTERS_DIGITS)
        return out
    }
    let words = [pick(ADJECTIVES), pick(NOUNS)]
    if (letterCase === 'lower') words = words.map(w => w.toLowerCase())
    const name = words.join(separator)
    return withNumber ? `${name}${separator}${randomInt(1000)}` : name
}

// Unique names; stops early if the options can't produce that many
function makeBatch(options) {
    const names = new Set()
    for (let attempts = 0; names.size < options.count && attempts < options.count * 50; attempts++) names.add(makeName(options))
    return [...names]
}

const DEFAULTS = { style: 'readable', count: 5, length: 8, separator: '', withNumber: true, letterCase: 'pascal' }

export default function Username() {
    const [options, setOptions] = useState(DEFAULTS)
    const [names, setNames] = useState(() => makeBatch(DEFAULTS))

    const update = (patch) => {
        const next = { ...options, ...patch }
        setOptions(next)
        setNames(makeBatch(next))
    }

    const combinations = options.style === 'random'
        ? LETTERS.length * LETTERS_DIGITS.length ** (options.length - 1)
        : ADJECTIVES.length * NOUNS.length * (options.withNumber ? 1000 : 1)

    return (
        <div className="page page-narrow">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <div>
                    <div className="field-label">Style</div>
                    <SegmentedControl ariaLabel="Style" options={STYLES} value={options.style} onChange={(style) => update({ style })} />
                    <div className="field-hint">
                        {options.style === 'readable' ? 'An adjective and a noun, like SwiftFox482.' : 'Lowercase letters and digits, starting with a letter.'}
                    </div>
                </div>

                {options.style === 'readable' ? (
                    <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
                            <div>
                                <div className="field-label">Separator</div>
                                <SegmentedControl ariaLabel="Separator" size="sm" options={SEPARATORS} value={options.separator} onChange={(separator) => update({ separator })} />
                            </div>
                            <div>
                                <div className="field-label">Case</div>
                                <SegmentedControl ariaLabel="Case" size="sm" options={CASES} value={options.letterCase} onChange={(letterCase) => update({ letterCase })} />
                            </div>
                        </div>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', cursor: 'pointer' }}>
                            <input type="checkbox" checked={options.withNumber} onChange={(e) => update({ withNumber: e.target.checked })} />
                            Add a number (0–999)
                        </label>
                    </div>
                ) : (
                    <SliderField label="Length" value={options.length} onChange={(length) => update({ length })} min={4} max={24} unit=" characters" />
                )}

                <SliderField label="How many" value={options.count} onChange={(count) => update({ count })} min={1} max={20} />

                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    About {formatLarge(combinations)} possible names.
                    Generated with your browser’s secure random generator; check availability on the site you’re signing up for.
                </div>
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                    <div role="heading" aria-level={2} className="section-title">Usernames</div>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <CopyButton text={names.join('\n')} label="Copy all" />
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setNames(makeBatch(options))}>
                            <RefreshCw size={14} aria-hidden="true" /> Generate new names
                        </button>
                    </div>
                </div>
                <ul style={{ listStyle: 'none', display: 'grid', gap: 'var(--space-xs)', margin: 0, padding: 0 }} aria-label="Generated usernames">
                    {names.map((name) => (
                        <li
                            key={name}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-sm)',
                                padding: '0.5rem 0.75rem',
                                background: 'var(--bg-inset)',
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)',
                            }}
                        >
                            <span className="mono" style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '1.05rem', color: 'var(--text-main)' }}>{name}</span>
                            <CopyButton text={name} iconOnly label={`Copy ${name}`} />
                        </li>
                    ))}
                </ul>
            </section>
        </div>
    )
}
