import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Gauge, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import SliderField from '../components/ui/SliderField'
import StatusBanner from '../components/ui/StatusBanner'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { openInTool } from '../utils/smartNav'
import {
    DEFAULT_OPTIONS,
    DEFAULT_SYMBOLS,
    LIMITS,
    LOOKALIKES,
    entropyOf,
    generateValues,
    normalizeOptions,
    parseSymbolSet,
    strengthOf,
} from '../utils/passwordGen'
import './PasswordGenerator.css'

const MODES = [
    { value: 'password', label: 'Password' },
    { value: 'passphrase', label: 'Passphrase' },
    { value: 'pin', label: 'PIN' },
]

const SEPARATORS = [
    { value: 'hyphen', label: 'Hyphen', title: 'word-word' },
    { value: 'space', label: 'Space', title: 'word word' },
    { value: 'period', label: 'Period', title: 'word.word' },
    { value: 'underscore', label: 'Underscore', title: 'word_word' },
    { value: 'none', label: 'None', title: 'wordword' },
]

const NOUNS = { password: ['password', 'passwords'], passphrase: ['passphrase', 'passphrases'], pin: ['PIN', 'PINs'] }
const TONES = ['danger', 'danger', 'warning', 'success', 'success']
const EFF_DICE_URL = 'https://www.eff.org/dice'

const Spinner = (props) => <Loader2 {...props} className="spin" />
const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1)

// The EFF list (about 116 kB) is only loaded when a passphrase is first needed.
let wordListPromise = null
function loadWordList() {
    if (!wordListPromise) {
        wordListPromise = import('@wordlist/english-eff/long').then(m => m.long)
        wordListPromise.catch(() => {
            wordListPromise = null // allow a retry
        })
    }
    return wordListPromise
}

// A batch remembers the settings it was made for, so a result is never shown
// next to options it doesn't match. Values live in memory only.
let batchSeq = 0
const batchKey = (options, wordList) => JSON.stringify([options, !!wordList])

function makeBatch(options, wordList) {
    const key = batchKey(options, wordList)
    const id = ++batchSeq
    if (options.mode === 'passphrase' && !wordList) return { key, id, values: [] }
    try {
        return { key, id, values: generateValues(options, { wordList }) }
    } catch (error) {
        return { key, id, values: [], error: error.message }
    }
}

// Tints digits and symbols so look-alike characters are easier to tell apart.
function Characters({ value, tint }) {
    if (!tint) return value
    const runs = []
    for (const ch of value) {
        const kind = /[0-9]/.test(ch) ? 'digit' : /[A-Za-z]/.test(ch) ? 'letter' : 'symbol'
        const last = runs[runs.length - 1]
        if (last && last.kind === kind) last.text += ch
        else runs.push({ kind, text: ch })
    }
    return runs.map((run, i) => (run.kind === 'letter' ? <span key={i}>{run.text}</span> : <span key={i} className={`pwgen-${run.kind}`}>{run.text}</span>))
}

function Check({ checked, onChange, children, detail, disabled }) {
    return (
        <label className="pwgen-check">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
            <span>
                {children}
                {detail && <> <span className="pwgen-check-detail">{detail}</span></>}
            </span>
        </label>
    )
}

function describeChar(ch) {
    if (ch === ' ') return 'space'
    if (/\s/.test(ch)) return 'whitespace'
    return `“${ch}”`
}

function Meter({ level }) {
    return (
        <div className="pwgen-meter" aria-hidden="true">
            {[0, 1, 2, 3, 4].map(i => (
                <span key={i} style={i <= level ? { background: `var(--${TONES[level]})` } : undefined} />
            ))}
        </div>
    )
}

export default function PasswordGenerator() {
    const navigate = useNavigate()
    const optionsHeadingId = useId()
    const [stored, setStored] = useLocalStorage('pwgen-options', DEFAULT_OPTIONS)
    const options = useMemo(() => normalizeOptions(stored), [stored])
    const [wordList, setWordList] = useState(null)
    const [listError, setListError] = useState(null)
    const [listAttempt, setListAttempt] = useState(0)
    const [batch, setBatch] = useState(() => makeBatch(options, null))

    const { mode, count } = options
    const needsList = mode === 'passphrase' && !wordList

    useEffect(() => {
        if (!needsList) return undefined
        let cancelled = false
        loadWordList().then(
            (list) => {
                if (!cancelled) setWordList(list)
            },
            (error) => {
                if (!cancelled) setListError(error?.message || String(error))
            },
        )
        return () => {
            cancelled = true
        }
    }, [needsList, listAttempt])

    // Regenerate whenever the batch no longer matches the options: after the
    // word list arrives, or when the options change in another tab or pane.
    const stale = batch.key !== batchKey(options, wordList)
    useEffect(() => {
        if (!stale) return undefined
        const timer = setTimeout(() => setBatch(makeBatch(options, wordList)), 0)
        return () => clearTimeout(timer)
    }, [stale, options, wordList])

    const update = (patch) => {
        const next = normalizeOptions({ ...options, ...patch })
        setStored(next)
        setBatch(makeBatch(next, wordList))
    }
    const regenerate = () => setBatch(makeBatch(options, wordList))
    const retryList = () => {
        setListError(null)
        setListAttempt(n => n + 1)
    }
    const audit = (value) => openInTool(navigate, '/password', { input: value })

    const entropy = useMemo(() => entropyOf(options), [options])
    const strength = entropy.error ? null : strengthOf(entropy.bits)
    const current = stale ? null : batch
    const values = current?.values ?? []
    const [singular, plural] = NOUNS[mode]
    const tint = mode === 'password'

    // Symbol set field (passwords, and passphrases with "Add a symbol")
    const symbols = parseSymbolSet(options.symbolSet)
    const symbolsUsed = mode === 'password' ? options.symbols : mode === 'passphrase' && options.addSymbol
    const avoidingLookalikes = mode === 'password' && options.avoidLookalikes
    const lookalikeSymbols = avoidingLookalikes ? symbols.chars.filter(ch => LOOKALIKES.includes(ch)) : []
    let symbolError = null
    if (symbolsUsed && !symbols.chars.length) symbolError = 'Add at least one symbol (ASCII punctuation such as ! # % *).'
    else if (symbolsUsed && lookalikeSymbols.length === symbols.chars.length) symbolError = 'All of these symbols are look-alikes: add others, or allow look-alike characters.'
    const usable = symbols.chars.length - lookalikeSymbols.length
    const symbolHint = [
        `${usable} symbol${usable === 1 ? '' : 's'}${lookalikeSymbols.length ? ` (${lookalikeSymbols.join(' ')} skipped as look-alike)` : ''}. Remove any a site doesn’t accept.`,
        symbols.ignored.length ? `Ignored: ${symbols.ignored.map(describeChar).join(', ')} (only ASCII punctuation counts).` : '',
        symbols.repeated ? 'Repeats count once.' : '',
    ].filter(Boolean).join(' ')

    const symbolField = (
        <Field
            label="Symbols to use"
            labelAction={
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => update({ symbolSet: DEFAULT_SYMBOLS })} disabled={options.symbolSet === DEFAULT_SYMBOLS || !symbolsUsed}>
                    <RotateCcw size={14} aria-hidden="true" /> Reset
                </button>
            }
            hint={symbolHint}
            error={symbolError}
        >
            <input
                type="text"
                className="mono pwgen-symbols-input"
                value={options.symbolSet}
                onChange={(e) => update({ symbolSet: e.target.value })}
                disabled={!symbolsUsed}
                maxLength={LIMITS.symbolSet.max}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
            />
        </Field>
    )

    let results
    if (mode === 'passphrase' && listError) {
        results = (
            <StatusBanner
                tone="danger"
                title="The word list didn’t load"
                action={<button type="button" className="btn btn-sm btn-secondary" onClick={retryList}><RotateCcw size={14} aria-hidden="true" /> Retry</button>}
            >
                {listError} If you’re offline, reconnect and retry.
            </StatusBanner>
        )
    } else if (mode === 'passphrase' && !wordList) {
        results = (
            <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--text-muted)', fontSize: '0.9rem', minHeight: 64 }}>
                <Spinner size={16} aria-hidden="true" /> Loading the word list…
            </div>
        )
    } else if (current?.error) {
        results = <StatusBanner tone="danger" title={`Can’t generate a ${singular} with these settings`}>{current.error}</StatusBanner>
    } else if (values.length === 1) {
        results = (
            <div className="pwgen-single" role="group" aria-label={`Generated ${singular}`}>
                <div className="pwgen-value"><Characters value={values[0]} tint={tint} /></div>
                <div className="pwgen-single-actions">
                    <CopyButton text={values[0]} label={`Copy ${singular}`} variant="primary" />
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => audit(values[0])}>
                        <Gauge size={14} aria-hidden="true" /> Check in Password Audit
                    </button>
                </div>
            </div>
        )
    } else if (values.length > 1) {
        results = (
            <ol className="pwgen-list" aria-label={`Generated ${plural}`}>
                {values.map((value, i) => (
                    <li key={`${current.id}-${i}`}>
                        <span className="pwgen-index" aria-hidden="true">{i + 1}</span>
                        <span className="pwgen-value"><Characters value={value} tint={tint} /></span>
                        <CopyButton text={value} iconOnly label={`Copy ${singular} ${i + 1}`} />
                        <button
                            type="button"
                            className="icon-btn icon-btn-sm"
                            aria-label={`Check ${singular} ${i + 1} in Password Audit`}
                            title="Check in Password Audit"
                            onClick={() => audit(value)}
                        >
                            <Gauge size={14} aria-hidden="true" />
                        </button>
                    </li>
                ))}
            </ol>
        )
    }

    return (
        <div className="page page-narrow">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }} aria-label={`Generated ${plural}`}>
                <div className="pwgen-toolbar">
                    <SegmentedControl ariaLabel="Type" options={MODES} value={mode} onChange={(value) => update({ mode: value })} />
                    <div className="pwgen-toolbar-actions">
                        {count > 1 && <CopyButton text={values.join('\n')} label="Copy all" variant="primary" disabled={!values.length} />}
                        <button type="button" className="btn btn-secondary btn-sm" onClick={regenerate} disabled={needsList}>
                            <RefreshCw size={14} aria-hidden="true" /> Regenerate
                        </button>
                    </div>
                </div>

                {results}

                {strength && (
                    <div className="pwgen-strength">
                        <Meter level={strength.level} />
                        <div className="pwgen-strength-label" aria-live="polite">
                            <span style={{ fontWeight: 700, color: `var(--${TONES[strength.level]})` }}>
                                {strength.label} · {Math.floor(entropy.bits)} bits
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>entropy per {singular}</span>
                        </div>
                        <div className="field-hint" style={{ marginTop: 0 }}>
                            {entropy.formula}.
                            {entropy.upperBound && ' “At least one from each set” rules out some combinations, so this is a slight upper bound.'}
                            {mode === 'pin' && ' A PIN only holds up where wrong guesses are limited, like a phone that locks after a few tries.'}
                        </div>
                    </div>
                )}
            </section>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }} aria-labelledby={optionsHeadingId}>
                <div role="heading" aria-level={2} className="section-title" id={optionsHeadingId}>{capitalize(singular)} options</div>

                {mode === 'password' && (
                    <>
                        <SliderField
                            label="Length"
                            value={options.length}
                            onChange={(length) => update({ length })}
                            min={LIMITS.length.min}
                            max={LIMITS.length.max}
                            format={(v) => `${v} characters`}
                            showInput
                        />
                        <fieldset className="pwgen-fieldset">
                            <legend className="field-label">Characters</legend>
                            <div className="pwgen-checks">
                                <Check checked={options.lower} onChange={(lower) => update({ lower })} detail="a–z">Lowercase</Check>
                                <Check checked={options.upper} onChange={(upper) => update({ upper })} detail="A–Z">Uppercase</Check>
                                <Check checked={options.digits} onChange={(digits) => update({ digits })} detail="0–9">Digits</Check>
                                <Check checked={options.symbols} onChange={(on) => update({ symbols: on })} detail="!#$…">Symbols</Check>
                            </div>
                        </fieldset>
                        {symbolField}
                        <div className="pwgen-checks">
                            <Check checked={options.avoidLookalikes} onChange={(avoidLookalikes) => update({ avoidLookalikes })} detail={Array.from(LOOKALIKES).join(' ')}>
                                Avoid look-alike characters
                            </Check>
                            <Check checked={options.requireEach} onChange={(requireEach) => update({ requireEach })}>
                                At least one from each set
                            </Check>
                        </div>
                    </>
                )}

                {mode === 'passphrase' && (
                    <>
                        <SliderField
                            label="Words"
                            value={options.words}
                            onChange={(words) => update({ words })}
                            min={LIMITS.words.min}
                            max={LIMITS.words.max}
                            format={(v) => `${v} words`}
                        />
                        <div>
                            <div className="field-label" aria-hidden="true">Separator</div>
                            <SegmentedControl ariaLabel="Separator" size="sm" options={SEPARATORS} value={options.separator} onChange={(separator) => update({ separator })} />
                        </div>
                        <div>
                            <div className="pwgen-checks">
                                <Check checked={options.capitalize} onChange={(capitalizeWords) => update({ capitalize: capitalizeWords })}>Capitalise words</Check>
                                <Check checked={options.addNumber} onChange={(addNumber) => update({ addNumber })}>Add a digit</Check>
                                <Check checked={options.addSymbol} onChange={(addSymbol) => update({ addSymbol })}>Add a symbol</Check>
                            </div>
                            {(options.addNumber || options.addSymbol) && (
                                <div className="field-hint">
                                    {options.addNumber && options.addSymbol ? 'Each is added' : 'It’s added'} to the end of a randomly chosen word.
                                </div>
                            )}
                        </div>
                        {options.addSymbol && symbolField}
                        <div className="field-hint" style={{ marginTop: 0 }}>
                            <a className="pwgen-link" href={EFF_DICE_URL} target="_blank" rel="noopener noreferrer">
                                Words from the EFF long word list (CC BY 3.0 US)
                            </a>
                        </div>
                    </>
                )}

                {mode === 'pin' && (
                    <SliderField
                        label="Digits"
                        value={options.pinLength}
                        onChange={(pinLength) => update({ pinLength })}
                        min={LIMITS.pinLength.min}
                        max={LIMITS.pinLength.max}
                        format={(v) => `${v} digits`}
                    />
                )}

                <SliderField label="How many" value={count} onChange={(n) => update({ count: n })} min={LIMITS.count.min} max={LIMITS.count.max} showInput />

                <div className="field-hint" style={{ marginTop: 0 }}>
                    Made on your device with the browser’s cryptographic random generator. Results are never sent or stored; only these options are remembered.
                </div>
            </section>
        </div>
    )
}
