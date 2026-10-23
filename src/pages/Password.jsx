import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, RotateCcw } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import StatusBanner from '../components/ui/StatusBanner'
import { useWorkerClient } from '../utils/workerClient'
import { BRAND } from '../config/brand'

const MAX_LENGTH = 100 // zxcvbn gets slow on long input; it only scores the first 100 characters
const LABELS = ['Very Weak', 'Weak', 'Fair', 'Good', 'Strong']
const TONES = ['danger', 'danger', 'warning', 'success', 'success']
const USER_INPUTS = [BRAND.name, ...BRAND.name.toLowerCase().split(/\s+/), 'toolkit', 'password']

const SCENARIOS = [
    { key: 'online_throttling_100_per_hour', title: 'Online, rate-limited', detail: 'A login form that allows 100 guesses per hour' },
    { key: 'online_no_throttling_10_per_second', title: 'Online, no rate limit', detail: '10 guesses per second against a live service' },
    { key: 'offline_slow_hashing_1e4_per_second', title: 'Offline, slow hash', detail: 'Stolen bcrypt/scrypt/Argon2 hashes: 10,000 guesses per second' },
    { key: 'offline_fast_hashing_1e10_per_second', title: 'Offline, fast hash', detail: 'Stolen MD5/SHA-1 hashes on GPUs: 10 billion guesses per second' },
]

const Spinner = (props) => <Loader2 {...props} className="spin" />

function describeMatch(match) {
    switch (match.pattern) {
        case 'dictionary': {
            const where = { passwords: 'common password', english_wikipedia: 'English word', female_names: 'name', male_names: 'name', surnames: 'surname', us_tv_and_film: 'word from TV and film', user_inputs: 'word related to this site' }[match.dictionary_name] || 'dictionary word'
            const extras = [match.reversed && 'reversed', match.l33t && 'with l33t substitutions'].filter(Boolean).join(', ')
            return `${where}${match.rank ? ` #${match.rank.toLocaleString()}` : ''}${extras ? ` (${extras})` : ''}`
        }
        case 'spatial':
            return `keyboard pattern${match.turns ? ` with ${match.turns} turn${match.turns === 1 ? '' : 's'}` : ''}`
        case 'repeat':
            return `repeated ${match.repeat_count ? `${match.repeat_count}×` : ''}`
        case 'sequence':
            return 'sequence'
        case 'regex':
            return match.regex_name === 'recent_year' ? 'recent year' : 'pattern'
        case 'date':
            return 'date'
        default:
            return 'random characters'
    }
}

function Meter({ score }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }} aria-hidden="true">
            {[0, 1, 2, 3, 4].map(i => (
                <div
                    key={i}
                    style={{
                        height: 8,
                        borderRadius: 4,
                        background: score !== null && i <= score ? `var(--${TONES[score]})` : 'var(--border-strong)',
                        transition: 'background-color 0.2s ease',
                    }}
                />
            ))}
        </div>
    )
}

export default function Password() {
    const [password, setPassword] = useState('')
    const [show, setShow] = useState(false)
    const [result, setResult] = useState(null) // { input, ...analysis } | { input, error }
    const [attempt, setAttempt] = useState(0)
    const client = useWorkerClient(() => new Worker(new URL('../workers/zxcvbn.worker.js', import.meta.url), { type: 'module' }))

    const analysed = Array.from(password).slice(0, MAX_LENGTH).join('')
    const truncated = analysed.length < password.length

    useEffect(() => {
        if (!analysed) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
            client
                .request('analyze', { password: analysed, userInputs: USER_INPUTS })
                .then((res) => {
                    if (!cancelled) setResult({ input: analysed, ...res })
                })
                .catch((error) => {
                    if (!cancelled && !error.cancelled) setResult({ input: analysed, error: error.message })
                })
        }, 150)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [analysed, client, attempt])

    const current = result?.input === analysed ? result : null
    // Keep the last analysis on screen (dimmed) while the next one runs, so the meter doesn't flicker
    const shown = password ? (current || (result && !result.error ? result : null)) : null
    const pending = !!password && !current
    const score = shown && !shown.error ? shown.score : null

    return (
        <div className="page page-narrow">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <Field
                    label="Password"
                    labelAction={
                        <button
                            type="button"
                            className="icon-btn"
                            aria-label={show ? 'Hide password' : 'Show password'}
                            aria-pressed={show}
                            title={show ? 'Hide password' : 'Show password'}
                            onClick={() => setShow(v => !v)}
                        >
                            {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                        </button>
                    }
                    hint={truncated ? `Only the first ${MAX_LENGTH} characters are analysed; longer passwords are at least this strong.` : 'Checked on your device with zxcvbn. Nothing is sent or stored.'}
                >
                    <input
                        type={show ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Type a password..."
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                        data-1p-ignore
                        data-lpignore="true"
                        style={{ fontSize: '1.1rem' }}
                    />
                </Field>

                <div style={{ display: 'grid', gap: 'var(--space-xs)', opacity: pending && shown ? 0.6 : 1, transition: 'opacity 0.15s ease' }}>
                    <Meter score={score} />
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }} aria-live="polite">
                        <span style={!password ? { fontSize: '0.9rem', color: 'var(--text-muted)' } : { fontWeight: 700, fontSize: '1.25rem', color: score !== null ? `var(--${TONES[score]})` : 'var(--text-muted)' }}>
                            {!password ? 'Type a password to check it' : score !== null ? LABELS[score] : current?.error ? 'Couldn’t analyse' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '1rem', fontWeight: 500 }}><Spinner size={16} aria-hidden="true" /> Analysing…</span>}
                        </span>
                        {score !== null && (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                                Score {score}/4 · about 10<sup>{Math.round(shown.guessesLog10)}</sup> guesses
                            </span>
                        )}
                    </div>
                </div>

                {current?.error && (
                    <StatusBanner
                        tone="danger"
                        title="The strength checker didn’t load"
                        action={<button type="button" className="btn btn-sm btn-secondary" onClick={() => setAttempt(n => n + 1)}><RotateCcw size={14} aria-hidden="true" /> Retry</button>}
                    >
                        {current.error} If you’re offline, reconnect and retry.
                    </StatusBanner>
                )}
            </section>

            {shown && !shown.error && (
                <section className="card" style={{ display: 'grid', gap: 'var(--space-md)', opacity: pending ? 0.6 : 1, transition: 'opacity 0.15s ease' }}>
                    {shown.feedback.warning && <StatusBanner tone="warning" title={shown.feedback.warning} />}

                    <div>
                        <div role="heading" aria-level={2} className="section-title" style={{ marginBottom: 'var(--space-xs)' }}>Time to crack</div>
                        <div>
                            {SCENARIOS.map(s => (
                                <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--space-md)', padding: '0.5rem 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                                    <div style={{ minWidth: 0, flex: '1 1 10rem' }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{s.title}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>{s.detail}</div>
                                    </div>
                                    <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto', textAlign: 'right' }}>{shown.crackTimesDisplay[s.key]}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {shown.feedback.suggestions.length > 0 && (
                        <div>
                            <div role="heading" aria-level={2} className="section-title" style={{ marginBottom: 'var(--space-xs)' }}>Suggestions</div>
                            <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', fontSize: '0.9rem', display: 'grid', gap: 2 }}>
                                {shown.feedback.suggestions.map(s => <li key={s}>{s}</li>)}
                            </ul>
                        </div>
                    )}

                    {shown.sequence.length > 0 && (
                        <div>
                            <div role="heading" aria-level={2} className="section-title" style={{ marginBottom: 'var(--space-xs)' }}>What zxcvbn found</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)' }}>
                                {shown.sequence.map((m, i) => (
                                    <span key={i} className="chip" style={{ cursor: 'default', maxWidth: '100%' }}>
                                        <span className="mono" style={{ color: 'var(--text-main)', overflowWrap: 'anywhere' }}>{show ? m.token : '•'.repeat(Math.min(m.token.length, 12))}</span>
                                        <span>{describeMatch(m)}</span>
                                    </span>
                                ))}
                            </div>
                            {!show && <div className="field-hint">Show the password to see which parts matched.</div>}
                        </div>
                    )}
                </section>
            )}
        </div>
    )
}
