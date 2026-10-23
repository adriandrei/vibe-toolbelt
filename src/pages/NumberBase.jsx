import { useMemo, useState } from 'react'
import { Diff, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'

const BASES = [
    { id: 'bin', label: 'Binary', radix: 2, prefix: '0b', valid: /^[01]+$/, group: 4, inputMode: 'numeric', placeholder: '1011 0101' },
    { id: 'oct', label: 'Octal', radix: 8, prefix: '0o', valid: /^[0-7]+$/, group: 3, inputMode: 'numeric', placeholder: '265' },
    { id: 'dec', label: 'Decimal', radix: 10, prefix: '', valid: /^[0-9]+$/, group: 3, inputMode: 'numeric', placeholder: '181' },
    { id: 'hex', label: 'Hexadecimal', radix: 16, prefix: '0x', valid: /^[0-9a-f]+$/i, group: 4, inputMode: 'text', placeholder: 'B5' },
]
const BASE_BY_ID = Object.fromEntries(BASES.map(b => [b.id, b]))

const MAX_DIGITS = 4096
const WIDTHS = [8, 16, 32, 64]

const PRESETS = [
    { label: '255', base: 'dec', text: '255' },
    { label: '1024', base: 'dec', text: '1024' },
    { label: '-1', base: 'dec', text: '-1' },
    { label: 'INT32_MAX', base: 'dec', text: '2147483647' },
    { label: 'UINT32_MAX', base: 'dec', text: '4294967295' },
    { label: 'INT64_MAX', base: 'dec', text: '9223372036854775807' },
    { label: 'UINT64_MAX', base: 'dec', text: '18446744073709551615' },
]

/** Strict parse: only this base's digits and prefix; spaces and _ separate digits. */
function parseInBase(text, base) {
    let s = text.trim()
    if (!s) return { empty: true }
    let negative = false
    if (s[0] === '-' || s[0] === '+') {
        negative = s[0] === '-'
        s = s.slice(1).trimStart()
    }
    if (base.prefix && s.slice(0, 2).toLowerCase() === base.prefix) s = s.slice(2)
    const digits = s.replace(/[\s_]/g, '')
    if (!digits) return { error: base.prefix && text.trim().toLowerCase().endsWith(base.prefix) ? 'Type the digits after the prefix.' : `Enter ${base.label.toLowerCase()} digits.` }
    if (digits.length > MAX_DIGITS) return { error: `That’s too long (more than ${MAX_DIGITS.toLocaleString()} digits).` }
    if (!base.valid.test(digits)) {
        const bad = [...digits].find(ch => !base.valid.test(ch))
        if (base.id === 'dec') {
            if (/^0[xbo]/i.test(digits)) return { error: `Type prefixed values in their own field: ${digits.slice(0, 2)}… belongs in ${digits[1].toLowerCase() === 'x' ? 'Hexadecimal' : digits[1].toLowerCase() === 'b' ? 'Binary' : 'Octal'}.` }
            if (bad === '.' || bad === ',') return { error: 'Only whole numbers (integers) can be converted.' }
            if (/e/i.test(bad)) return { error: 'Scientific notation isn’t supported; write the number out in full.' }
        }
        const allowed = { bin: '0 and 1', oct: '0 to 7', dec: '0 to 9', hex: '0 to 9 and A to F' }[base.id]
        return { error: `“${bad}” isn’t a ${base.label.toLowerCase()} digit (use ${allowed}).` }
    }
    const value = BigInt(`${base.prefix || ''}${digits}`)
    return { value: negative ? -value : value }
}

const groupDigits = (digits, size) => digits.replace(new RegExp(`\\B(?=(?:.{${size}})+$)`, 'g'), ' ')

function formatInBase(value, base, group) {
    const negative = value < 0n
    let digits = (negative ? -value : value).toString(base.radix)
    if (base.id === 'hex') digits = digits.toUpperCase()
    if (group) digits = groupDigits(digits, base.group)
    return (negative ? '-' : '') + digits
}

function copyText(value, base) {
    const negative = value < 0n
    let digits = (negative ? -value : value).toString(base.radix)
    if (base.id === 'hex') digits = digits.toUpperCase()
    return `${negative ? '-' : ''}${base.prefix}${digits}`
}

// Smallest two's complement width (in bits) that can hold the value
function bitsNeeded(value) {
    if (value >= 0n) return value === 0n ? 1 : value.toString(2).length
    const magnitude = -value - 1n
    return (magnitude === 0n ? 0 : magnitude.toString(2).length) + 1
}

function fitsIn(value) {
    const out = []
    if (value >= 0n) {
        const u = WIDTHS.find(w => value < 1n << BigInt(w))
        if (u) out.push(`uint${u}`)
    }
    const s = WIDTHS.find(w => value >= -(1n << BigInt(w - 1)) && value < 1n << BigInt(w - 1))
    if (s) out.push(`int${s}`)
    return out
}

const fitsWidth = (value, w) => value >= -(1n << BigInt(w - 1)) && value < 1n << BigInt(w)

function guessBase(text) {
    const t = text.trim().replace(/^[-+]/, '')
    if (/^0x/i.test(t)) return 'hex'
    if (/^0b/i.test(t)) return 'bin'
    if (/^0o/i.test(t)) return 'oct'
    if (/^[\d\s_]+$/.test(t)) return 'dec'
    if (/^[\da-f\s_]+$/i.test(t)) return 'hex'
    return 'dec'
}

export default function NumberBase() {
    // The field being typed in keeps its raw text; the others are derived
    const [source, setSource] = useState({ id: 'dec', text: '' })
    const [group, setGroup] = useState(true)
    const [widthChoice, setWidthChoice] = useState('auto')

    const parsed = useMemo(() => parseInBase(source.text, BASE_BY_ID[source.id]), [source])
    const value = parsed.value
    const hasValue = typeof value === 'bigint'

    const autoWidth = hasValue ? (WIDTHS.find(w => fitsWidth(value, w)) ?? 64) : 32
    const width = widthChoice === 'auto' ? autoWidth : widthChoice
    const bits = hasValue ? bitsNeeded(value) : 0
    const fits = hasValue ? fitsIn(value) : []
    const inWidth = hasValue && fitsWidth(value, width)
    const pattern = inWidth ? BigInt.asUintN(width, value) : null

    const load = (text, id = guessBase(text)) => setSource({ id, text: text.trim() })

    useSmartInput({ input: (v) => typeof v === 'string' && load(v) })

    useRegisterAIContext({
        tool: 'Number Base Converter',
        getContext: () => ({
            input: source.text ? `${source.text} (${BASE_BY_ID[source.id].label})` : '',
            output: hasValue ? BASES.map(b => `${b.label}: ${copyText(value, b)}`).join('\n') : '',
        }),
        suggestedPrompts: ['Explain two’s complement for this value', 'What bit flags are set in this number?', 'Is this a common magic number?'],
    })

    const negate = () => {
        if (!hasValue) return
        const base = BASE_BY_ID[source.id]
        setSource({ id: source.id, text: formatInBase(-value, base, false) })
    }

    const optionLabel = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }

    return (
        <div className="page page-medium page-number-base">
            <ToolHeader />

            <section className="card card-compact" aria-label="Presets" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-xs) var(--space-sm)' }}>
                <span className="field-label" style={{ marginBottom: 0 }}>Try</span>
                {PRESETS.map(p => (
                    <button key={p.label} type="button" className="chip mono" onClick={() => load(p.text, p.base)}>{p.label}</button>
                ))}
                <div style={{ display: 'flex', gap: 'var(--space-xs)', marginLeft: 'auto', flexWrap: 'wrap', alignItems: 'center' }}>
                    <PipelineRead onRead={(text) => load(text)} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={negate} disabled={!hasValue} title="Change the sign">
                        <Diff size={14} aria-hidden="true" /> Negate
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSource({ id: source.id, text: '' })} disabled={!source.text}>
                        <Trash2 size={14} aria-hidden="true" /> Clear
                    </button>
                </div>
            </section>

            <section className="card" aria-label="Number in each base" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                {BASES.map((b) => {
                    const active = source.id === b.id
                    const display = active ? source.text : hasValue ? formatInBase(value, b, group) : ''
                    return (
                        <Field
                            key={b.id}
                            label={(
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                    <span className="badge badge-primary mono" style={{ minWidth: 30, justifyContent: 'center' }}>{b.radix}</span>
                                    {b.label}
                                    {b.prefix && <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontWeight: 400 }}>{b.prefix}</span>}
                                </span>
                            )}
                            error={active && parsed.error ? parsed.error : null}
                            labelAction={<CopyButton text={hasValue ? copyText(value, b) : ''} iconOnly label={`Copy ${b.label.toLowerCase()} value`} />}
                        >
                            <input
                                type="text"
                                value={display}
                                onChange={e => setSource({ id: b.id, text: e.target.value })}
                                placeholder={b.placeholder}
                                inputMode={b.inputMode}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                autoCorrect="off"
                                className={active && parsed.error ? 'field-invalid' : ''}
                                style={{
                                    fontFamily: 'var(--font-mono)',
                                    fontSize: '1rem',
                                    padding: '0.65rem 0.8rem',
                                    borderColor: active && !parsed.error && source.text ? 'var(--primary-border)' : undefined,
                                }}
                            />
                        </Field>
                    )
                })}
                <label style={optionLabel}>
                    <input type="checkbox" checked={group} onChange={e => setGroup(e.target.checked)} />
                    Group digits (4 for binary and hex, 3 for octal and decimal)
                </label>
            </section>

            {hasValue && (
                <section className="card" aria-label="Size and two’s complement" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div className="auto-grid" style={{ '--auto-grid-min': '110px' }}>
                        <div>
                            <div className="field-label">Bit length</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--primary-text)' }}>{bits.toLocaleString()} bit{bits === 1 ? '' : 's'}</div>
                        </div>
                        <div>
                            <div className="field-label">Bytes</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 700 }}>{Math.ceil(bits / 8).toLocaleString()}</div>
                        </div>
                        <div>
                            <div className="field-label">Fits in</div>
                            <div style={{ fontSize: '1.15rem', fontWeight: 700 }} className="mono">
                                {fits.length ? fits.join(' · ') : 'Larger than 64 bits'}
                            </div>
                        </div>
                    </div>

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                            <div className="section-title" role="heading" aria-level={2}>Two’s complement</div>
                            <SegmentedControl
                                size="sm"
                                ariaLabel="Integer width"
                                value={widthChoice}
                                onChange={setWidthChoice}
                                options={[{ value: 'auto', label: `Auto (${autoWidth})` }, ...WIDTHS.map(w => ({ value: w, label: `${w}-bit` }))]}
                            />
                        </div>
                        {pattern === null ? (
                            <p className="field-hint" style={{ marginTop: 0 }}>
                                {value.toString()} doesn’t fit in {width} bits (range {(-(1n << BigInt(width - 1))).toString()} to {((1n << BigInt(width)) - 1n).toString()}).
                            </p>
                        ) : (
                            <dl style={{ display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', gap: '0.35rem var(--space-md)', alignItems: 'baseline' }}>
                                <dt className="field-label" style={{ marginBottom: 0 }}>Hex</dt>
                                <dd className="mono" style={{ overflowWrap: 'anywhere' }}>0x{groupDigits(pattern.toString(16).toUpperCase().padStart(width / 4, '0'), 4)}</dd>
                                <dt className="field-label" style={{ marginBottom: 0 }}>Binary</dt>
                                <dd className="mono" style={{ overflowWrap: 'anywhere' }}>{groupDigits(pattern.toString(2).padStart(width, '0'), 4)}</dd>
                                <dt className="field-label" style={{ marginBottom: 0 }}>As int{width}</dt>
                                <dd className="mono">{BigInt.asIntN(width, value).toString()}</dd>
                                <dt className="field-label" style={{ marginBottom: 0 }}>As uint{width}</dt>
                                <dd className="mono">{pattern.toString()}</dd>
                            </dl>
                        )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <PipelineSend dataToSend={value.toString()} label="Send decimal to pipeline" />
                    </div>
                </section>
            )}
        </div>
    )
}
