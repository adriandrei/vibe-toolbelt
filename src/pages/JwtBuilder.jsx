import { useEffect, useId, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, Clock, Dices, Eye, EyeOff, Fingerprint, Info, KeyRound, Loader2, ScanSearch, Trash2, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import Field from '../components/ui/Field'
import StatusBanner from '../components/ui/StatusBanner'
import { useToast } from '../components/ToastProvider'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useSmartInput } from '../hooks/useSmartInput'
import { openInTool } from '../utils/smartNav'
import { formatRelative, useNow } from '../utils/clock'
import { algFamily, decodeToken, describeValidity, evaluateTimes, normalizeToken, readNumericDate } from '../utils/jwt'
import {
    ALGORITHM_GROUPS,
    ALG_DESCRIPTIONS,
    DATE_CLAIMS,
    DEFAULT_ALG,
    MIN_RSA_BITS,
    SigningKeyError,
    defaultHeaderText,
    generateKeyPairPem,
    headerAlgOf,
    importSigningKey,
    isSupportedAlg,
    parseJsonObject,
    prepareToken,
    randomSecret,
    randomUuid,
    readSecret,
    secretWarning,
    setClaims,
    signToken,
    stringifyJson,
    syncHeaderAlg,
} from '../utils/jwtBuild'
import './JwtBuilder.css'

const EXP_PRESETS = [
    { label: '15 min', seconds: 15 * 60 },
    { label: '1 h', seconds: 3600 },
    { label: '1 day', seconds: 86400 },
    { label: '7 days', seconds: 7 * 86400 },
]

const EXP_UNITS = [
    { value: 60, label: 'minutes' },
    { value: 3600, label: 'hours' },
    { value: 86400, label: 'days' },
]

const KEY_PLACEHOLDERS = {
    rsa: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQ…\n-----END PRIVATE KEY-----',
    ec: '-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg…\n-----END PRIVATE KEY-----',
    okp: '-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI…\n-----END PRIVATE KEY-----',
}

const TONE_BADGE = { success: 'badge-success', warning: 'badge-warning', danger: 'badge-danger', neutral: '' }

const Spinner = (props) => <Loader2 {...props} className="spin" />
const nowSeconds = () => Math.floor(Date.now() / 1000)

function initialPayloadText() {
    const now = nowSeconds()
    return stringifyJson({ sub: '1234567890', name: 'John Doe', iat: now, exp: now + 3600 })
}

function formatDate(date) {
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

function quickValue(payload, name) {
    const value = payload?.[name]
    if (value === undefined) return ''
    if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value.join(', ')
    return typeof value === 'string' ? value : JSON.stringify(value)
}

// "a, b" becomes ["a", "b"] for aud; an empty field removes the claim.
function parseQuickValue(name, text) {
    if (text === '') return undefined
    if (name === 'aud' && text.includes(',')) return text.split(',').map(s => s.trim()).filter(Boolean)
    return text
}

function PartTitle({ id, children, actions }) {
    return (
        <div className="jwtb-head" style={{ marginBottom: 'var(--space-sm)' }}>
            <div role="heading" aria-level={2} className="section-title" id={id}>{children}</div>
            {actions && <div className="jwtb-actions">{actions}</div>}
        </div>
    )
}

// A claim field bound to the payload JSON. While it has focus it shows what
// was typed, so "a, " isn't tidied away before the next audience is typed.
function QuickClaim({ name, label, payload, disabled, onChange, placeholder }) {
    const [draft, setDraft] = useState(null)
    const value = quickValue(payload, name)
    return (
        <Field label={label}>
            <input
                type="text"
                value={draft ?? value}
                disabled={disabled}
                placeholder={placeholder}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                onFocus={() => setDraft(value)}
                onBlur={() => setDraft(null)}
                onChange={(e) => {
                    setDraft(e.target.value)
                    onChange(name, parseQuickValue(name, e.target.value))
                }}
            />
        </Field>
    )
}

// Readable dates for iat / nbf / exp; re-renders every second on its own.
function DateClaims({ payload, onRemove }) {
    const now = useNow()
    const present = DATE_CLAIMS.filter(name => payload[name] !== undefined)
    if (!present.length) return null
    const validity = describeValidity(evaluateTimes(payload, now))
    return (
        <div style={{ display: 'grid', gap: 'var(--space-xs)' }}>
            {validity && <div><span className={`badge ${TONE_BADGE[validity.tone]}`}>{validity.text}</span></div>}
            <ul className="jwtb-dates" aria-label="Date claims">
                {present.map(name => {
                    const parsed = readNumericDate(payload[name])
                    return (
                        <li key={name}>
                            <code className="mono jwtb-claim-name">{name}</code>
                            {parsed.error || !parsed.date ? (
                                <span className="jwtb-date-value" style={{ color: 'var(--danger)' }}>{JSON.stringify(payload[name])}: {parsed.error}</span>
                            ) : (
                                <span className="jwtb-date-value">
                                    <span title={parsed.date.toISOString()}>{formatDate(parsed.date)}</span>
                                    <span style={{ color: 'var(--text-dim)' }}> · {formatRelative(parsed.seconds - now / 1000)}</span>
                                </span>
                            )}
                            <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => onRemove(name)}>
                                <X size={14} aria-hidden="true" />
                            </button>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}

function TokenView({ token, pending }) {
    const [header, payload, signature] = token.split('.')
    return (
        <div
            className={`code-well jwtb-mono jwtb-token${pending ? ' is-pending' : ''}`}
            role="textbox"
            aria-readonly="true"
            aria-multiline="true"
            aria-label="Signed token"
            aria-busy={pending || undefined}
            tabIndex={0}
        >
            <span className="jwtb-part-header">{header}</span>
            <span className="jwtb-dot">.</span>
            <span className="jwtb-part-payload">{payload}</span>
            <span className="jwtb-dot">.</span>
            <span className="jwtb-part-signature">{signature}</span>
        </div>
    )
}

function Placeholder({ icon: Icon = Info, children }) {
    return (
        <div className="jwtb-placeholder">
            <Icon size={18} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>{children}</div>
        </div>
    )
}

export default function JwtBuilder() {
    const navigate = useNavigate()
    const toast = useToast()
    const tokenHeadingId = useId()
    const publicHeadingId = useId()
    const customExpId = useId()

    const [storedAlg, setStoredAlg] = useLocalStorage('jwt-builder-alg', DEFAULT_ALG)
    const alg = isSupportedAlg(storedAlg) ? storedAlg : DEFAULT_ALG
    const family = algFamily(alg)
    const isHmac = family === 'hmac'

    const [headerText, setHeaderText] = useState(() => defaultHeaderText(alg))
    const [payloadText, setPayloadText] = useState(initialPayloadText)
    const [secret, setSecret] = useState('')
    const [secretBase64, setSecretBase64] = useState(false)
    const [showSecret, setShowSecret] = useState(false)
    const [keyText, setKeyText] = useState('')
    const [generating, setGenerating] = useState(false)
    const [generated, setGenerated] = useState(null) // { alg, pem } of the pair made here
    const [keyResult, setKeyResult] = useState(null) // { id, ok } | { id, error }
    const [signResult, setSignResult] = useState(null) // { id, token } | { id, error }
    const [customExp, setCustomExp] = useState('30')
    const [customUnit, setCustomUnit] = useState(60)

    // A JWT (to edit and re-sign) or a JSON payload can be opened here.
    useSmartInput({
        input: (text) => {
            const decoded = decodeToken(normalizeToken(text).value)
            if (decoded?.kind === 'jws' && decoded.header.value && decoded.payload.type === 'claims') {
                setHeaderText(stringifyJson(decoded.header.value))
                setPayloadText(stringifyJson(decoded.payload.value))
                if (isSupportedAlg(decoded.header.value.alg)) setStoredAlg(decoded.header.value.alg)
                toast.info('Loaded the token’s header and payload. Add the key to sign it again.')
                return
            }
            const json = parseJsonObject(text, 'payload')
            if (json.value) setPayloadText(stringifyJson(json.value))
            else toast.warning('That isn’t a JWT or a JSON object, so nothing was loaded.')
        },
    })

    const prepared = useMemo(() => prepareToken({ alg, headerText, payloadText }), [alg, headerText, payloadText])

    // ---- signing key ----
    const secretState = useMemo(() => (isHmac && secret !== '' ? readSecret(secret, secretBase64) : null), [isHmac, secret, secretBase64])
    const keyId = !isHmac && keyText.trim() ? JSON.stringify([alg, keyText]) : null

    useEffect(() => {
        if (!keyId) return undefined
        let cancelled = false
        importSigningKey(keyText, alg).then(
            (ok) => {
                if (!cancelled) setKeyResult({ id: keyId, ok })
            },
            (error) => {
                if (!cancelled) setKeyResult({ id: keyId, error: error instanceof SigningKeyError ? error.message : `The key couldn’t be read: ${error?.message || error}` })
            },
        )
        return () => {
            cancelled = true
        }
    }, [keyId, keyText, alg])

    const keyState = keyId && keyResult?.id === keyId ? keyResult : null
    let signingKey = null
    let keyIssue = null // { kind: 'waiting' | 'pending' | 'error', text }
    if (isHmac) {
        if (!secret) keyIssue = { kind: 'waiting', text: 'Enter the secret to sign with.' }
        else if (secretState.error) keyIssue = { kind: 'error', text: secretState.error }
        else signingKey = secretState.bytes
    } else if (!keyId) keyIssue = { kind: 'waiting', text: 'Paste a private key or generate a key pair to sign with.' }
    else if (!keyState) keyIssue = { kind: 'pending', text: 'Reading the key…' }
    else if (keyState.error) keyIssue = { kind: 'error', text: keyState.error }
    else signingKey = keyState.ok.key

    // ---- signing (live) ----
    const signId = prepared.header && prepared.payload && signingKey
        ? JSON.stringify([JSON.stringify(prepared.header), JSON.stringify(prepared.payload), isHmac ? ['secret', secret, secretBase64] : ['key', keyId]])
        : null

    useEffect(() => {
        if (!signId) return undefined
        let cancelled = false
        signToken({ header: prepared.header, payload: prepared.payload, key: signingKey }).then(
            (token) => {
                if (!cancelled) setSignResult({ id: signId, token })
            },
            (error) => {
                if (!cancelled) setSignResult({ id: signId, error: error?.message || String(error) })
            },
        )
        return () => {
            cancelled = true
        }
    }, [signId, prepared.header, prepared.payload, signingKey])

    const current = signId && signResult?.id === signId ? signResult : null
    const token = current?.token ?? null
    const editorErrors = [prepared.headerError && `Header: ${prepared.headerError}`, prepared.payloadError && `Payload: ${prepared.payloadError}`].filter(Boolean)
    // While a new signature is computed, the previous token stays (dimmed, not copyable)
    const pending = !editorErrors.length && !token && !current?.error && (keyIssue?.kind === 'pending' || (!keyIssue && !current))
    const pendingToken = pending ? signResult?.token ?? null : null

    // ---- actions ----
    const chooseAlg = (next) => {
        if (!isSupportedAlg(next) || next === alg) return
        setStoredAlg(next)
        const synced = syncHeaderAlg(headerText, next)
        if (synced !== null) setHeaderText(synced)
    }

    const changeHeader = (text) => {
        setHeaderText(text)
        const typed = headerAlgOf(text)
        if (typed && typed !== alg) setStoredAlg(typed)
    }

    const fixHeaderAlg = () => {
        const synced = syncHeaderAlg(headerText, alg)
        if (synced !== null) setHeaderText(synced)
    }

    const updateClaims = (patch) => {
        try {
            setPayloadText(setClaims(payloadText, patch))
        } catch (error) {
            toast.error(error.message)
        }
    }

    const setCustomExpiry = () => {
        const amount = Number(customExp)
        if (!Number.isFinite(amount) || amount <= 0) {
            toast.warning('Enter a positive number for the custom expiry.')
            return
        }
        updateClaims({ exp: nowSeconds() + Math.round(amount * customUnit) })
    }

    const addKid = (kid) => {
        const parsed = parseJsonObject(headerText, 'header')
        if (parsed.error) {
            toast.error('Fix the header JSON first.')
            return
        }
        setHeaderText(stringifyJson({ ...parsed.value, kid }))
    }

    const generateSecret = () => {
        setSecret(randomSecret(alg))
        setSecretBase64(true)
        setShowSecret(true)
    }

    const generateKeys = async () => {
        const forAlg = alg
        setGenerating(true)
        try {
            const pem = await generateKeyPairPem(forAlg)
            setKeyText(pem)
            setGenerated({ alg: forAlg, pem })
        } catch (error) {
            toast.error(`Couldn’t generate a key pair: ${error.message}`)
        } finally {
            setGenerating(false)
        }
    }

    const openInDecoder = () => {
        if (!token) return
        // The decoder reads a public key from smart input, so it verifies at once.
        // It can't take a secret, so HMAC tokens open without one.
        openInTool(navigate, '/jwt', !isHmac && keyState?.ok ? { input: token, key: keyState.ok.publicPem } : { input: token })
    }

    // ---- view ----
    const payload = prepared.payload
    const shortSecret = secretState?.bytes ? secretWarning(secretState.bytes, alg) : null
    const secretHasEdgeSpace = !secretBase64 && /^\s|\s$/.test(secret)
    const keyOk = keyState?.ok
    const justGenerated = generated && generated.alg === alg && generated.pem === keyText
    const headerKid = parseJsonObject(headerText, 'header').value?.kid

    let output
    if (editorErrors.length) {
        output = (
            <Placeholder icon={CircleAlert}>
                Fix the {prepared.headerError && prepared.payloadError ? 'header and payload' : prepared.headerError ? 'header' : 'payload'} to sign the token:
                <ul>{editorErrors.map(e => <li key={e}>{e}</li>)}</ul>
            </Placeholder>
        )
    } else if (keyIssue?.kind === 'waiting') {
        output = <Placeholder icon={KeyRound}>{keyIssue.text}</Placeholder>
    } else if (keyIssue?.kind === 'error') {
        output = <Placeholder icon={CircleAlert}>The {isHmac ? 'secret' : 'key'} can’t be used: {keyIssue.text}</Placeholder>
    } else if (current?.error) {
        output = <StatusBanner tone="danger" title="Signing failed">{current.error}</StatusBanner>
    } else if (token) {
        output = <TokenView token={token} />
    } else if (pendingToken) {
        output = <TokenView token={pendingToken} pending />
    } else {
        output = <Placeholder icon={Spinner}>Signing…</Placeholder>
    }

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }} aria-label="Algorithm and key">
                <Field
                    label="Algorithm"
                    hint={`${ALG_DESCRIPTIONS[alg]}. ${isHmac ? 'The same secret signs and verifies.' : 'The private key signs; anyone with the public key can verify.'}`}
                >
                    <select value={alg} onChange={(e) => chooseAlg(e.target.value)}>
                        {ALGORITHM_GROUPS.map(group => (
                            <optgroup key={group.label} label={group.label}>
                                {group.algs.map(a => <option key={a} value={a}>{a} · {ALG_DESCRIPTIONS[a]}</option>)}
                            </optgroup>
                        ))}
                    </select>
                </Field>

                {isHmac ? (
                    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                        <Field
                            label="Secret"
                            labelAction={
                                <div className="jwtb-actions">
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={generateSecret} title={`Generate a random ${alg.slice(2)}-bit secret`}>
                                        <Dices size={14} aria-hidden="true" /> Generate
                                    </button>
                                    <CopyButton text={secret} iconOnly label="Copy secret" />
                                    <button
                                        type="button"
                                        className="icon-btn"
                                        aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                                        aria-pressed={showSecret}
                                        title={showSecret ? 'Hide secret' : 'Show secret'}
                                        onClick={() => setShowSecret(v => !v)}
                                    >
                                        {showSecret ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                                    </button>
                                </div>
                            }
                            error={secretState?.error}
                            hint={secretHasEdgeSpace ? 'The secret starts or ends with whitespace, which is part of the key.' : 'Used only in this tab, never stored.'}
                        >
                            <input
                                type={showSecret ? 'text' : 'password'}
                                value={secret}
                                onChange={(e) => setSecret(e.target.value)}
                                placeholder="your-256-bit-secret"
                                autoComplete="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                data-1p-ignore
                                data-lpignore="true"
                                className="mono jwtb-mono"
                            />
                        </Field>
                        <label className="jwtb-check">
                            <input type="checkbox" checked={secretBase64} onChange={(e) => setSecretBase64(e.target.checked)} />
                            Secret is Base64- or Base64url-encoded
                        </label>
                        {shortSecret && <StatusBanner tone="warning" title="Secret too short">{shortSecret}</StatusBanner>}
                    </div>
                ) : (
                    <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                        <Field
                            label="Private key"
                            error={keyState?.error}
                            hint={`PKCS#8 PEM (BEGIN PRIVATE KEY), PKCS#1 or SEC1 PEM (converted for you), or a private JWK.${family === 'rsa' ? ` RSA keys need at least ${MIN_RSA_BITS} bits.` : ''} Used only in this tab, never stored.`}
                        >
                            <textarea
                                value={keyText}
                                onChange={(e) => setKeyText(e.target.value)}
                                placeholder={KEY_PLACEHOLDERS[family]}
                                spellCheck={false}
                                autoComplete="off"
                                autoCapitalize="off"
                                className={`jwtb-mono${keyState?.error ? ' field-invalid' : ''}`}
                                style={{ minHeight: 150, fontSize: '0.8rem', wordBreak: 'break-all' }}
                            />
                        </Field>
                        <div className="jwtb-actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={generateKeys} disabled={generating}>
                                {generating ? <Spinner size={14} aria-hidden="true" /> : <KeyRound size={14} aria-hidden="true" />}
                                {generating ? 'Generating…' : `Generate ${alg} key pair`}
                            </button>
                            <CopyButton text={keyText.trim()} label="Copy private key" />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKeyText('')} disabled={!keyText}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                            {keyOk && <span className="badge badge-success">{keyOk.description}</span>}
                            {!keyState && keyId && <span className="badge"><Spinner size={12} aria-hidden="true" /> Reading…</span>}
                        </div>
                        {keyOk?.notes.map(note => <div key={note} className="field-hint" style={{ marginTop: 0 }}>{note}</div>)}
                        {justGenerated && (
                            <StatusBanner tone="info" title={`New ${alg} key pair`}>
                                Generated on this device and never stored or sent. Copy the private key now if you’ll need it again; the public key is below.
                            </StatusBanner>
                        )}
                    </div>
                )}
            </section>

            <div className="split-pane" style={{ alignItems: 'start' }}>
                <section className="card">
                    <Field
                        label="Header"
                        error={prepared.headerError}
                        hint={`JSON. "alg" follows the algorithm above.`}
                    >
                        <textarea
                            value={headerText}
                            onChange={(e) => changeHeader(e.target.value)}
                            spellCheck={false}
                            autoComplete="off"
                            autoCapitalize="off"
                            className={`jwtb-mono${prepared.headerError ? ' field-invalid' : ''}`}
                            style={{ minHeight: 130, fontSize: '0.85rem' }}
                        />
                    </Field>
                    {prepared.headerFixable && (
                        <button type="button" className="btn btn-outline btn-sm" onClick={fixHeaderAlg} style={{ marginTop: 'var(--space-sm)' }}>
                            Set "alg" to {alg}
                        </button>
                    )}
                </section>

                <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                    <Field label="Payload" error={prepared.payloadError} hint="JSON claims. Dates are seconds since 1970 (NumericDate).">
                        <textarea
                            value={payloadText}
                            onChange={(e) => setPayloadText(e.target.value)}
                            spellCheck={false}
                            autoComplete="off"
                            autoCapitalize="off"
                            className={`jwtb-mono${prepared.payloadError ? ' field-invalid' : ''}`}
                            style={{ minHeight: 200, fontSize: '0.85rem' }}
                        />
                    </Field>

                    {prepared.warnings.length > 0 && (
                        <StatusBanner tone="warning" title="Verifiers may reject these claims">
                            {prepared.warnings.map(w => <div key={w}>{w}</div>)}
                        </StatusBanner>
                    )}

                    <div className="jwtb-claims">
                        <div className="auto-grid" style={{ '--auto-grid-min': '8.5rem', gap: 'var(--space-sm)' }}>
                            <QuickClaim name="iss" label="Issuer (iss)" payload={payload} disabled={!payload} onChange={(name, value) => updateClaims({ [name]: value })} placeholder="https://issuer.example" />
                            <QuickClaim name="sub" label="Subject (sub)" payload={payload} disabled={!payload} onChange={(name, value) => updateClaims({ [name]: value })} placeholder="user-123" />
                            <QuickClaim name="aud" label="Audience (aud)" payload={payload} disabled={!payload} onChange={(name, value) => updateClaims({ [name]: value })} placeholder="api, web" />
                        </div>

                        <div className="jwtb-claim-row" role="group" aria-label="Time and ID claims">
                            <span className="field-label"><Clock size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Now</span>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateClaims({ iat: nowSeconds() })} disabled={!payload}>Set iat</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateClaims({ nbf: nowSeconds() })} disabled={!payload}>Set nbf</button>
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => updateClaims({ jti: randomUuid() })} disabled={!payload} title="A random UUID as the token ID">
                                <Fingerprint size={14} aria-hidden="true" /> New jti
                            </button>
                        </div>

                        <div className="jwtb-claim-row" role="group" aria-label="Set expiry">
                            <span className="field-label">exp = now +</span>
                            {EXP_PRESETS.map(p => (
                                <button key={p.label} type="button" className="chip" onClick={() => updateClaims({ exp: nowSeconds() + p.seconds })} disabled={!payload} aria-label={`Expire in ${p.label}`}>
                                    {p.label}
                                </button>
                            ))}
                            <span className="jwtb-custom-exp">
                                <label htmlFor={customExpId} className="sr-only">Custom expiry amount</label>
                                <input
                                    id={customExpId}
                                    type="number"
                                    min="1"
                                    step="any"
                                    value={customExp}
                                    onChange={(e) => setCustomExp(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') setCustomExpiry()
                                    }}
                                    disabled={!payload}
                                />
                                <select value={customUnit} onChange={(e) => setCustomUnit(Number(e.target.value))} aria-label="Custom expiry unit" disabled={!payload}>
                                    {EXP_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                                </select>
                                <button type="button" className="btn btn-secondary btn-sm" onClick={setCustomExpiry} disabled={!payload}>Set exp</button>
                            </span>
                        </div>

                        {payload ? (
                            <DateClaims payload={payload} onRemove={(name) => updateClaims({ [name]: undefined })} />
                        ) : (
                            <div className="field-hint" style={{ marginTop: 0 }}>Fix the payload JSON to use these helpers.</div>
                        )}
                    </div>
                </section>
            </div>

            <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }} aria-labelledby={tokenHeadingId}>
                <PartTitle
                    id={tokenHeadingId}
                    actions={
                        <>
                            <CopyButton text={() => token ?? ''} label="Copy token" variant="primary" disabled={!token && !pending} />
                            <button type="button" className="btn btn-secondary btn-sm" onClick={openInDecoder} disabled={!token && !pending}>
                                <ScanSearch size={14} aria-hidden="true" /> Open in JWT Decoder
                            </button>
                        </>
                    }
                >
                    Signed token <span className="badge badge-primary">{alg}</span>
                </PartTitle>
                {output}
                {(token || pendingToken) && (
                    <div className="jwtb-legend" aria-hidden="true">
                        <span className="jwtb-part-header">Header</span>
                        <span className="jwtb-part-payload">Payload</span>
                        <span className="jwtb-part-signature">Signature</span>
                        <span className="jwtb-legend-length">{(token || pendingToken).length} characters</span>
                    </div>
                )}
                {!isHmac && keyOk && token && (
                    <div className="field-hint" style={{ marginTop: 0 }}>The decoder opens with the public key below, so it can check the signature.</div>
                )}
                {isHmac && token && (
                    <div className="field-hint" style={{ marginTop: 0 }}>In the decoder, enter the same secret to check the signature.</div>
                )}
            </section>

            {!isHmac && keyOk && (
                <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }} aria-labelledby={publicHeadingId}>
                    <div>
                        <PartTitle id={publicHeadingId}>
                            Public key <span className="badge">{keyOk.description}</span>
                        </PartTitle>
                        <div className="field-hint" style={{ marginTop: 0 }}>
                            Derived from the private key. Give this half to whoever verifies the tokens.
                        </div>
                    </div>
                    <div className="split-pane" style={{ alignItems: 'start' }}>
                        <div style={{ display: 'grid', gap: 'var(--space-xs)', minWidth: 0 }}>
                            <div className="jwtb-head">
                                <span className="field-label" style={{ marginBottom: 0 }}>PEM (SPKI)</span>
                                <CopyButton text={keyOk.publicPem} label="Copy PEM" />
                            </div>
                            <pre className="code-well jwtb-mono jwtb-key-block" role="textbox" aria-readonly="true" aria-multiline="true" aria-label="Public key PEM" tabIndex={0}>{keyOk.publicPem.trim()}</pre>
                        </div>
                        <div style={{ display: 'grid', gap: 'var(--space-xs)', minWidth: 0 }}>
                            <div className="jwtb-head">
                                <span className="field-label" style={{ marginBottom: 0 }}>JWK</span>
                                <div className="jwtb-actions">
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => addKid(keyOk.kid)} disabled={headerKid === keyOk.kid} title="Put this key’s RFC 7638 thumbprint in the header as kid">
                                        Use as kid
                                    </button>
                                    <CopyButton text={stringifyJson(keyOk.publicJwk)} label="Copy JWK" />
                                </div>
                            </div>
                            <pre className="code-well jwtb-mono jwtb-key-block" role="textbox" aria-readonly="true" aria-multiline="true" aria-label="Public key JWK" tabIndex={0}>{stringifyJson(keyOk.publicJwk)}</pre>
                        </div>
                    </div>
                </section>
            )}
        </div>
    )
}
