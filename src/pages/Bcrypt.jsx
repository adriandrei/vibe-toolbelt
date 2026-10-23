import { useEffect, useMemo, useState } from 'react'
import bcrypt from 'bcryptjs'
import { ArrowDownToLine, Eye, EyeOff, Loader2, ShieldCheck, ShieldQuestion } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SliderField from '../components/ui/SliderField'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineSend } from '../components/PipelineFeature'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useWorkerClient } from '../utils/workerClient'
import { utf8Length } from '../utils/encoding'

const MIN_COST = 4
const MAX_COST = 15
const DEFAULT_MS_AT_10 = 80 // rough bcryptjs speed before we've measured this device
const AUTO_CHECK_LIMIT_MS = 3000 // slower checks need a click
const HASH_RE = /^\$2([aby])\$(\d{2})\$([./A-Za-z0-9]{22})([./A-Za-z0-9]{31})$/

const Spinner = (props) => <Loader2 {...props} className="spin" />

function formatMs(ms) {
    if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
    return `${Math.round(ms / 60_000)} min`
}

function estimateMs(msAt10, cost) {
    return msAt10 * 2 ** (cost - 10)
}

// Explains why a string isn't a bcrypt hash; null when it looks valid.
function validateHash(value) {
    if (HASH_RE.test(value)) {
        const cost = bcrypt.getRounds(value)
        if (cost < 4 || cost > 31) return `Cost ${cost} is out of range (bcrypt allows 4–31).`
        return null
    }
    if (!value.startsWith('$2')) return 'A bcrypt hash starts with $2a$, $2b$ or $2y$.'
    if (/^\$2x\$/.test(value)) return '$2x$ hashes (an old, buggy PHP variant) aren’t supported.'
    if (!/^\$2[aby]\$/.test(value)) return `Unknown bcrypt version “${value.slice(0, 4)}”. Expected $2a$, $2b$ or $2y$.`
    if (!/^\$2[aby]\$\d{2}\$/.test(value)) return 'The cost must be two digits, e.g. $2b$10$.'
    if (value.length !== 60) return `A bcrypt hash has 60 characters; this one has ${value.length}.`
    return 'The salt and hash may only use the characters ./A–Z a–z 0–9.'
}

function RevealButton({ shown, onToggle, label }) {
    return (
        <button
            type="button"
            className="icon-btn"
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            aria-pressed={shown}
            title={shown ? `Hide ${label}` : `Show ${label}`}
            onClick={onToggle}
        >
            {shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
    )
}

function TruncationWarning({ password }) {
    if (!bcrypt.truncates(password)) return null
    return (
        <StatusBanner tone="warning" title="Only the first 72 bytes count">
            This password is {utf8Length(password)} bytes in UTF-8. bcrypt ignores everything after byte 72, so any password with the same first 72 bytes matches too.
        </StatusBanner>
    )
}

export default function Bcrypt() {
    // Hashing
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [cost, setCost] = useState(10)
    const [hashResult, setHashResult] = useState(null) // { id, hash, ms } | { id, error }
    const [hashProgress, setHashProgress] = useState(null) // { id, value }
    const [msAt10, setMsAt10] = useState(DEFAULT_MS_AT_10)
    const hashClient = useWorkerClient(() => new Worker(new URL('../workers/bcrypt.worker.js', import.meta.url), { type: 'module' }))

    // Checking
    const [checkPassword, setCheckPassword] = useState('')
    const [showCheckPassword, setShowCheckPassword] = useState(false)
    const [checkHash, setCheckHash] = useState('')
    const [checkResult, setCheckResult] = useState(null) // { id, match, ms } | { id, error }
    const [checkProgress, setCheckProgress] = useState(null)
    const [confirmedSlowId, setConfirmedSlowId] = useState(null)
    const checkClient = useWorkerClient(() => new Worker(new URL('../workers/bcrypt.worker.js', import.meta.url), { type: 'module' }))

    // ---- hashing: debounced, and a newer input cancels the running job ----
    const hashId = `${cost}\u0000${password}`
    useEffect(() => {
        if (!password) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
            hashClient
                .request('hash', { password, cost }, {
                    onProgress: (value) => {
                        if (!cancelled) setHashProgress({ id: hashId, value })
                    },
                })
                .then((res) => {
                    if (cancelled) return
                    setHashResult({ id: hashId, ...res })
                    if (cost >= 8) setMsAt10(res.ms / 2 ** (cost - 10))
                })
                .catch((error) => {
                    if (!cancelled && !error.cancelled) setHashResult({ id: hashId, error: error.message })
                })
        }, 400)
        return () => {
            cancelled = true
            clearTimeout(timer)
            hashClient.cancel()
        }
    }, [password, cost, hashId, hashClient])

    const hashCurrent = hashResult?.id === hashId ? hashResult : null
    const hashing = !!password && !hashCurrent
    const hashProgressValue = hashProgress?.id === hashId ? hashProgress.value : 0
    const generated = hashCurrent?.hash || ''
    const parts = generated ? generated.match(HASH_RE) : null

    // ---- checking ----
    const trimmedHash = checkHash.trim()
    const hashError = trimmedHash ? validateHash(trimmedHash) : null
    const checkCost = trimmedHash && !hashError ? bcrypt.getRounds(trimmedHash) : null
    const checkEstimate = checkCost ? estimateMs(msAt10, checkCost) : 0
    const checkId = `${checkPassword}\u0000${trimmedHash}`
    const canCheck = !!checkPassword && !!trimmedHash && !hashError
    const needsConfirm = canCheck && checkEstimate > AUTO_CHECK_LIMIT_MS && confirmedSlowId !== checkId

    useEffect(() => {
        if (!canCheck || needsConfirm) return undefined
        let cancelled = false
        const timer = setTimeout(() => {
            checkClient
                .request('compare', { password: checkPassword, hash: trimmedHash }, {
                    onProgress: (value) => {
                        if (!cancelled) setCheckProgress({ id: checkId, value })
                    },
                })
                .then((res) => {
                    if (!cancelled) setCheckResult({ id: checkId, ...res })
                })
                .catch((error) => {
                    if (!cancelled && !error.cancelled) setCheckResult({ id: checkId, error: error.message })
                })
        }, 400)
        return () => {
            cancelled = true
            clearTimeout(timer)
            checkClient.cancel()
        }
    }, [canCheck, needsConfirm, checkPassword, trimmedHash, checkId, checkClient])

    const checkCurrent = checkResult?.id === checkId ? checkResult : null
    const checking = canCheck && !needsConfirm && !checkCurrent
    const checkProgressValue = checkProgress?.id === checkId ? checkProgress.value : 0

    const estimate = estimateMs(msAt10, cost)
    const costHint = useMemo(() => {
        const level = cost < 10 ? 'Below the usual minimum of 10: fine for tests, too fast for real passwords.' : cost <= 12 ? 'A common choice for web apps.' : 'Strong, but slow for logins on busy servers.'
        return `${level} About ${formatMs(estimate)} per hash on this device.`
    }, [cost, estimate])

    useRegisterAIContext({
        tool: 'Bcrypt',
        getContext: () => ({
            input: `Cost factor: ${cost}`,
            output: generated ? `Generated hash: ${generated}` : '',
        }),
        suggestedPrompts: [
            'Which cost factor should I use?',
            'Why does the same password give a different hash each time?',
            'What is the 72-byte limit in bcrypt?',
            'Should I use bcrypt or Argon2?',
        ],
    })

    return (
        <div className="page page-medium">
            <ToolHeader />

            <div className="split-pane" style={{ alignItems: 'start' }}>
                <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                    <div role="heading" aria-level={2} className="section-title">
                        <ShieldCheck size={18} aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> Hash a password
                    </div>

                    <Field
                        label="Password"
                        labelAction={<RevealButton shown={showPassword} onToggle={() => setShowPassword(v => !v)} label="password" />}
                    >
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter password to hash..."
                            autoComplete="off"
                            spellCheck={false}
                            data-1p-ignore
                            data-lpignore="true"
                        />
                    </Field>

                    <SliderField
                        label="Cost factor"
                        value={cost}
                        onChange={setCost}
                        min={MIN_COST}
                        max={MAX_COST}
                        format={(v) => `${v} · 2^${v} = ${(2 ** v).toLocaleString()} rounds`}
                        hint={costHint}
                    />

                    <TruncationWarning password={password} />

                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-xs)' }}>
                            <span className="field-label" style={{ marginBottom: 0 }}>bcrypt hash</span>
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                                <PipelineSend dataToSend={generated} disabled={hashing} label="Send" />
                                <CopyButton text={generated} label="Copy hash" disabled={!generated || hashing} />
                            </div>
                        </div>
                        <div className="code-well" style={{ minHeight: '3.2rem', wordBreak: 'break-all', opacity: hashing && generated ? 0.55 : 1 }} aria-live="polite" aria-busy={hashing}>
                            {!password ? (
                                <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-family)' }}>Type a password to hash it.</span>
                            ) : hashCurrent?.error ? (
                                <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-family)' }}>{hashCurrent.error}</span>
                            ) : generated ? (
                                <span>{generated}</span>
                            ) : (
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-dim)', fontFamily: 'var(--font-family)' }}>
                                    <Spinner size={14} aria-hidden="true" /> Hashing… {hashProgressValue > 0 && `${Math.round(hashProgressValue * 100)}%`}
                                </span>
                            )}
                        </div>
                        {hashing && <progress max={1} value={hashProgressValue} aria-label="Hashing progress" style={{ width: '100%', marginTop: 'var(--space-xs)' }} />}
                        {parts && !hashing && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', marginTop: 'var(--space-xs)', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                                <span className="badge">version 2{parts[1]}</span>
                                <span className="badge">cost {Number(parts[2])}</span>
                                <span className="badge" title={parts[3]}>22-char salt</span>
                                <span className="badge" title={parts[4]}>31-char hash</span>
                                <span>· made in {formatMs(hashCurrent.ms)}</span>
                            </div>
                        )}
                        {parts && !hashing && (
                            <div className="field-hint">A new random salt is used each time, so the same password gives a different hash. All of them verify.</div>
                        )}
                    </div>
                </section>

                <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                    <div role="heading" aria-level={2} className="section-title">
                        <ShieldQuestion size={18} aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> Check a password
                    </div>

                    <Field
                        label="Password to check"
                        labelAction={<RevealButton shown={showCheckPassword} onToggle={() => setShowCheckPassword(v => !v)} label="password to check" />}
                    >
                        <input
                            type={showCheckPassword ? 'text' : 'password'}
                            value={checkPassword}
                            onChange={(e) => setCheckPassword(e.target.value)}
                            placeholder="Enter password..."
                            autoComplete="off"
                            spellCheck={false}
                            data-1p-ignore
                            data-lpignore="true"
                        />
                    </Field>

                    <Field
                        label="bcrypt hash"
                        labelAction={generated && !hashing ? (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCheckHash(generated)}>
                                <ArrowDownToLine size={14} aria-hidden="true" /> Use generated hash
                            </button>
                        ) : null}
                        error={hashError ? `Invalid hash: ${hashError}` : null}
                        hint={checkCost ? `Cost ${checkCost}: about ${formatMs(checkEstimate)} to check on this device.` : 'A 60-character hash such as $2b$10$…'}
                    >
                        <input
                            type="text"
                            value={checkHash}
                            onChange={(e) => setCheckHash(e.target.value)}
                            placeholder="$2a$10$..."
                            autoComplete="off"
                            spellCheck={false}
                            className="mono"
                        />
                    </Field>

                    <TruncationWarning password={checkPassword} />

                    <div aria-live="polite">
                        {needsConfirm ? (
                            <StatusBanner
                                tone="info"
                                title={`This hash uses cost ${checkCost}`}
                                action={<button type="button" className="btn btn-sm btn-primary" onClick={() => setConfirmedSlowId(checkId)}>Check (≈ {formatMs(checkEstimate)})</button>}
                            >
                                Checking it keeps a background thread busy for about {formatMs(checkEstimate)}.
                            </StatusBanner>
                        ) : checking ? (
                            <div style={{ display: 'grid', gap: 'var(--space-xs)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                    <Spinner size={14} aria-hidden="true" /> Checking… {checkProgressValue > 0 && `${Math.round(checkProgressValue * 100)}%`}
                                </div>
                                <progress max={1} value={checkProgressValue} aria-label="Checking progress" style={{ width: '100%' }} />
                            </div>
                        ) : checkCurrent?.error ? (
                            <StatusBanner tone="danger" title="Couldn’t check the password">{checkCurrent.error}</StatusBanner>
                        ) : checkCurrent ? (
                            checkCurrent.match ? (
                                <StatusBanner tone="success" title="Match">The password is correct for this hash (checked in {formatMs(checkCurrent.ms)}).</StatusBanner>
                            ) : (
                                <StatusBanner tone="danger" title="No match">This password doesn’t produce this hash.</StatusBanner>
                            )
                        ) : !hashError && (
                            <div className="field-hint" style={{ marginTop: 0 }}>Enter a password and a hash to check them.</div>
                        )}
                    </div>
                </section>
            </div>
        </div>
    )
}
