import { useMemo, useState } from 'react'
import * as OTPAuth from 'otpauth'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Copy, Download, RefreshCw, Smartphone } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import { useCopy } from '../hooks/useCopy'
import { useNow } from '../utils/clock'
import { downloadBlob } from '../utils/download'
import { BRAND } from '../config/brand'

const ALGORITHMS = ['SHA1', 'SHA256', 'SHA512']
const DIGITS = [6, 7, 8]
const PERIODS = [15, 30, 60, 90, 120]
const BASE32 = /^[A-Z2-7]*$/

function newSecret() {
    return new OTPAuth.Secret({ size: 20 }).base32
}

// Normalises a typed/pasted Base32 secret and explains what's wrong with it.
function checkSecret(raw) {
    const value = raw.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '')
    if (!value) return { value, error: 'Enter a Base32 secret, or generate a new one.' }
    if (!BASE32.test(value)) {
        const bad = value.match(/[^A-Z2-7]/)[0]
        const hint = /[0189]/.test(bad) ? ' Base32 never uses 0, 1, 8 or 9: is this hex?' : ''
        return { value, error: `“${bad}” isn’t a Base32 character (A–Z and 2–7).${hint}` }
    }
    if ([1, 3, 6].includes(value.length % 8)) return { value, error: `${value.length} characters isn’t a valid Base32 length (a character is missing or extra).` }
    const bits = Math.floor((value.length * 5) / 8) * 8
    if (value.length < 16) return { value, bits, warning: `Only ${bits} bits. Use at least 16 characters (80 bits); 32 characters (160 bits) is the usual size. Many authenticator apps reject short secrets.` }
    return { value, bits }
}

function groupCode(code) {
    if (!code) return ''
    const half = Math.ceil(code.length / 2)
    return `${code.slice(0, half)} ${code.slice(half)}`
}

function downloadSvg(svg, filename) {
    if (!svg) return
    downloadBlob(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }), filename)
}

function CodePanel({ totp, period, digits }) {
    const now = useNow()
    const { copy, isCopied } = useCopy()
    const seconds = Math.floor(now / 1000)
    const counter = Math.floor(seconds / period)
    const remaining = period - (seconds % period)
    const code = useMemo(() => totp.generate({ timestamp: counter * period * 1000 }), [totp, counter, period])
    const next = useMemo(() => totp.generate({ timestamp: (counter + 1) * period * 1000 }), [totp, counter, period])
    const urgent = remaining <= 5

    return (
        <div style={{ display: 'grid', gap: 'var(--space-sm)', justifyItems: 'center', textAlign: 'center' }}>
            <div className="field-label" style={{ marginBottom: 0 }}>Current code</div>
            <button
                type="button"
                onClick={() => copy(code, { key: 'code' })}
                aria-label={`Copy code ${code}`}
                title="Copy code"
                className="mono"
                style={{
                    fontSize: digits > 6 ? '2.4rem' : '2.8rem',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    lineHeight: 1.1,
                    color: 'var(--primary-text)',
                    padding: '0.25rem 0.75rem',
                    borderRadius: 'var(--radius-md)',
                    maxWidth: '100%',
                    overflowWrap: 'anywhere',
                }}
            >
                {groupCode(code)}
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: isCopied('code') ? 'var(--success)' : 'var(--text-dim)' }} aria-live="polite">
                {isCopied('code') ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {isCopied('code') ? 'Copied' : 'Click the code to copy it'}
            </div>
            <div
                role="progressbar"
                aria-label="Seconds until the code changes"
                aria-valuemin={0}
                aria-valuemax={period}
                aria-valuenow={remaining}
                aria-valuetext={`${remaining} seconds left`}
                style={{ width: '100%', height: 6, borderRadius: 3, background: 'var(--border-strong)', overflow: 'hidden' }}
            >
                {/* keyed by period so a new period starts full instead of animating backwards */}
                <div
                    key={counter}
                    style={{
                        height: '100%',
                        width: `${(remaining / period) * 100}%`,
                        background: urgent ? 'var(--danger)' : 'var(--primary)',
                        transition: 'width 1s linear, background-color 0.3s ease',
                    }}
                />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.8rem', color: 'var(--text-dim)', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                <span style={{ color: urgent ? 'var(--danger)' : undefined }}>Changes in {remaining} s</span>
                <span>Next: <span className="mono">{groupCode(next)}</span></span>
            </div>
        </div>
    )
}

function VerifyCode({ totp, digits }) {
    const now = useNow()
    const [value, setValue] = useState('')
    const code = value.replace(/\s+/g, '')
    let result = null
    if (code) {
        if (!/^\d+$/.test(code)) result = { tone: 'danger', title: 'Codes are digits only' }
        else if (code.length !== digits) result = { tone: 'info', title: `Enter all ${digits} digits` }
        else {
            const delta = totp.validate({ token: code, timestamp: now, window: 1 })
            result = delta === 0
                ? { tone: 'success', title: 'Valid: this is the current code' }
                : delta === -1
                    ? { tone: 'success', title: 'Valid: the previous code', body: 'Most servers accept one period of clock drift.' }
                    : delta === 1
                        ? { tone: 'warning', title: 'Valid: the next code', body: 'The device that made it is ahead of this clock.' }
                        : { tone: 'danger', title: 'Not valid', body: 'It doesn’t match this secret within ±1 period. Check the secret, the device clock and the settings.' }
        }
    }
    return (
        <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
            <Field label="Check a code" hint="Type a code from your authenticator app to confirm it’s set up correctly.">
                <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={'0'.repeat(digits)}
                    maxLength={digits + 4}
                    className="mono"
                />
            </Field>
            {result && <StatusBanner tone={result.tone} title={result.title}>{result.body}</StatusBanner>}
        </div>
    )
}

export default function Otp() {
    const [secret, setSecret] = useState(newSecret)
    const [label, setLabel] = useState('My Account')
    const [issuer, setIssuer] = useState(BRAND.name)
    const [algorithm, setAlgorithm] = useState('SHA1')
    const [digits, setDigits] = useState(6)
    const [period, setPeriod] = useState(30)
    const [uriText, setUriText] = useState('')
    const [importStatus, setImportStatus] = useState(null) // { tone, message }
    const [qrNode, setQrNode] = useState(null)

    const check = useMemo(() => checkSecret(secret), [secret])

    const totp = useMemo(() => {
        if (check.error) return null
        return new OTPAuth.TOTP({
            issuer: issuer.trim(),
            label: label.trim() || 'Account',
            algorithm,
            digits,
            period,
            secret: OTPAuth.Secret.fromBase32(check.value),
        })
    }, [check, issuer, label, algorithm, digits, period])
    const uri = totp ? totp.toString() : ''

    const importUri = () => {
        const text = uriText.trim()
        if (!text) return
        try {
            const otp = OTPAuth.URI.parse(text)
            if (otp instanceof OTPAuth.HOTP) throw new Error('This is a counter-based (HOTP) URI. This tool makes time-based (TOTP) codes.')
            if (!ALGORITHMS.includes(otp.algorithm)) throw new Error(`Algorithm ${otp.algorithm} isn’t supported here (use SHA1, SHA256 or SHA512).`)
            if (!DIGITS.includes(otp.digits)) throw new Error(`${otp.digits}-digit codes aren’t supported (6, 7 or 8).`)
            if (otp.period < 5 || otp.period > 600) throw new Error(`A ${otp.period}-second period isn’t supported (5–600).`)
            setSecret(otp.secret.base32)
            setLabel(otp.label)
            setIssuer(otp.issuer)
            setAlgorithm(otp.algorithm)
            setDigits(otp.digits)
            setPeriod(otp.period)
            setUriText('')
            setImportStatus({ tone: 'success', message: `Imported ${otp.issuer ? `${otp.issuer}: ` : ''}${otp.label}.` })
        } catch (error) {
            setImportStatus({ tone: 'danger', message: `Couldn’t import: ${error.message}` })
        }
    }

    const nonDefault = algorithm !== 'SHA1' || digits !== 6 || period !== 30
    const periodOptions = PERIODS.includes(period) ? PERIODS : [...PERIODS, period].sort((a, b) => a - b)

    return (
        <div className="page page-medium">
            <ToolHeader />

            <div className="split-pane" style={{ alignItems: 'start' }}>
                <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                    <div role="heading" aria-level={2} className="section-title">Setup</div>

                    <Field
                        label="Secret (Base32)"
                        labelAction={
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSecret(newSecret())}>
                                <RefreshCw size={14} aria-hidden="true" /> New secret
                            </button>
                        }
                        error={check.error}
                        hint={check.warning ? undefined : check.bits ? `${check.bits}-bit secret. Spaces, dashes and lowercase are fine.` : undefined}
                    >
                        <input
                            type="text"
                            value={secret}
                            onChange={(e) => setSecret(e.target.value)}
                            placeholder="JBSWY3DPEHPK3PXP"
                            spellCheck={false}
                            autoComplete="off"
                            autoCapitalize="characters"
                            className="mono"
                        />
                    </Field>
                    {check.warning && <StatusBanner tone="warning" title="Short secret">{check.warning}</StatusBanner>}

                    <div style={{ display: 'grid', gap: 'var(--space-md)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}>
                        <Field label="Account name">
                            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="alice@example.com" autoComplete="off" />
                        </Field>
                        <Field label="Issuer">
                            <input type="text" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder={BRAND.name} autoComplete="off" />
                        </Field>
                    </div>

                    <details>
                        <summary style={{ cursor: 'pointer', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            Advanced: {algorithm} · {digits} digits · {period} s
                        </summary>
                        <div style={{ display: 'grid', gap: 'var(--space-md)', marginTop: 'var(--space-sm)' }}>
                            <div>
                                <div className="field-label">Algorithm</div>
                                <SegmentedControl ariaLabel="Algorithm" size="sm" options={ALGORITHMS} value={algorithm} onChange={setAlgorithm} />
                            </div>
                            <div>
                                <div className="field-label">Digits</div>
                                <SegmentedControl ariaLabel="Digits" size="sm" options={DIGITS.map(d => ({ value: d, label: String(d) }))} value={digits} onChange={setDigits} />
                            </div>
                            <Field label="Period">
                                <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
                                    {periodOptions.map(p => <option key={p} value={p}>{p} seconds</option>)}
                                </select>
                            </Field>
                        </div>
                    </details>
                    {nonDefault && (
                        <StatusBanner tone="info" title="Non-standard settings">
                            Some authenticator apps (including older Google Authenticator versions) ignore the algorithm, digits or period and assume SHA1, 6 digits and 30 s, so their codes won’t match.
                        </StatusBanner>
                    )}

                    <div style={{ display: 'grid', gap: 'var(--space-xs)' }}>
                        <Field label="Import an otpauth:// URI" hint="Paste the link behind a 2FA QR code to load its settings.">
                            <input
                                type="text"
                                value={uriText}
                                onChange={(e) => {
                                    setUriText(e.target.value)
                                    setImportStatus(null)
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') importUri()
                                }}
                                placeholder="otpauth://totp/Issuer:alice?secret=…"
                                spellCheck={false}
                                autoComplete="off"
                                className="mono"
                            />
                        </Field>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={importUri} disabled={!uriText.trim()}>Import</button>
                        </div>
                        {importStatus && <StatusBanner tone={importStatus.tone} title={importStatus.message} />}
                    </div>
                </section>

                <section className="card" style={{ display: 'grid', gap: 'var(--space-lg)' }}>
                    {totp ? (
                        <>
                            <CodePanel totp={totp} period={period} digits={digits} />

                            <div style={{ display: 'grid', gap: 'var(--space-sm)', justifyItems: 'center' }}>
                                {/* QR codes must stay dark-on-white to scan reliably, in both themes */}
                                <div ref={setQrNode} style={{ background: '#ffffff', padding: 12, borderRadius: 'var(--radius-md)', lineHeight: 0, border: '1px solid var(--border)' }}>
                                    <QRCodeSVG value={uri} size={176} bgColor="#ffffff" fgColor="#000000" level="M" marginSize={0} title="QR code for the otpauth URI" />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    <Smartphone size={14} aria-hidden="true" /> Scan with an authenticator app
                                </div>
                                <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'center' }}>
                                    <CopyButton text={uri} label="Copy URI" />
                                    <CopyButton text={check.value} label="Copy secret" />
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => downloadSvg(qrNode?.querySelector('svg'), 'totp-qr.svg')}>
                                        <Download size={14} aria-hidden="true" /> QR (SVG)
                                    </button>
                                </div>
                                <div className="code-well" style={{ width: '100%', fontSize: '0.75rem', wordBreak: 'break-all' }}>{uri}</div>
                            </div>

                            <VerifyCode totp={totp} digits={digits} />
                        </>
                    ) : (
                        <StatusBanner tone="danger" title="No code">Fix the secret to see the code and QR code.</StatusBanner>
                    )}
                </section>
            </div>
        </div>
    )
}
