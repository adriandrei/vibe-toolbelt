import { useEffect, useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Lock, Trash2, CornerDownRight, ShieldCheck } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import CodeBlock from '../components/ui/CodeBlock'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useNow, formatRelative } from '../utils/clock'
import { bytesToBase64, bytesToHex } from '../utils/encoding'
import {
    REGISTERED_CLAIMS,
    algFamily,
    describeType,
    describeValidity,
    decodeToken,
    evaluateTimes,
    normalizeToken,
    readNumericDate,
    verifyToken,
} from '../utils/jwt'

const SECRET_ENCODINGS = [
    { value: 'text', label: 'Text' },
    { value: 'base64', label: 'Base64' },
    { value: 'hex', label: 'Hex' },
]

const TONE_BADGE = { success: 'badge-success', warning: 'badge-warning', danger: 'badge-danger', neutral: '' }

const STEP_TITLES = {
    header: 'Can’t check the signature',
    secret: 'The secret can’t be used',
    key: 'The key can’t be used',
    verify: 'Verification failed',
}

const Spinner = (props) => <Loader2 {...props} className="spin" />

function formatDate(date) {
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

function stringify(value) {
    return JSON.stringify(value, null, 2)
}

function PartTitle({ children, actions }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
            <div role="heading" aria-level={2} className="section-title">{children}</div>
            {actions && <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>{actions}</div>}
        </div>
    )
}

// Expiry badge: re-renders every second on its own so the rest of the page doesn't.
function ValidityBadge({ claims }) {
    const now = useNow()
    const validity = describeValidity(evaluateTimes(claims, now))
    if (!validity) return null
    return <span className={`badge ${TONE_BADGE[validity.tone]}`}>{validity.text}</span>
}

function ClaimValue({ name, value }) {
    const now = useNow()
    if (name === 'exp' || name === 'nbf' || name === 'iat') {
        const parsed = readNumericDate(value)
        if (parsed.error) return <span style={{ color: 'var(--danger)' }}>{String(JSON.stringify(value))}: {parsed.error}</span>
        const delta = parsed.seconds - now / 1000
        return (
            <span>
                <span title={parsed.date.toISOString()}>{formatDate(parsed.date)}</span>
                <span style={{ color: 'var(--text-dim)' }}> · {formatRelative(delta)}</span>
                <span className="mono" style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}> ({value})</span>
            </span>
        )
    }
    if (Array.isArray(value) && value.every(v => typeof v === 'string')) return <span className="mono">{value.join(', ')}</span>
    return <span className="mono">{typeof value === 'string' ? value : JSON.stringify(value)}</span>
}

function ClaimsTable({ claims }) {
    const names = Object.keys(REGISTERED_CLAIMS).filter(name => claims[name] !== undefined)
    if (!names.length) return null
    return (
        <section className="card">
            <PartTitle>Registered claims</PartTitle>
            <div role="table" aria-label="Registered claims">
                {names.map(name => (
                    <div
                        key={name}
                        role="row"
                        style={{ display: 'grid', gridTemplateColumns: 'minmax(6.5rem, max-content) minmax(0, 1fr)', gap: 'var(--space-sm) var(--space-md)', padding: '0.5rem 0', borderTop: '1px solid var(--border)' }}
                    >
                        <div role="rowheader">
                            <code className="mono" style={{ color: 'var(--primary-text)', fontWeight: 600 }}>{name}</code>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{REGISTERED_CLAIMS[name]}</div>
                        </div>
                        <div role="cell" style={{ minWidth: 0, wordBreak: 'break-word', fontSize: '0.9rem' }}>
                            <ClaimValue name={name} value={claims[name]} />
                        </div>
                    </div>
                ))}
            </div>
        </section>
    )
}

function VerificationResult({ state, claims }) {
    const now = useNow()
    if (state.status === 'checking') {
        return (
            <StatusBanner tone="info" icon={Spinner} title="Checking the signature…" />
        )
    }
    if (state.status === 'idle') return null
    if (state.status === 'unsecured') {
        return (
            <StatusBanner tone="warning" title="Unsecured token (alg: none)">
                There’s no signature to check: anyone can create or change this token. Never accept unsigned tokens.
                {state.hasSignature && ' It also carries a signature part, which “none” tokens must leave empty.'}
            </StatusBanner>
        )
    }
    if (state.status === 'error') {
        return <StatusBanner tone="danger" title={STEP_TITLES[state.step] || 'Verification failed'}>{state.message}</StatusBanner>
    }
    if (state.status === 'invalid') {
        return (
            <StatusBanner tone="danger" title="Invalid signature">
                {state.message} The token was changed, or it was signed with a different key.
                {state.notes?.map(note => <div key={note}>{note}</div>)}
            </StatusBanner>
        )
    }
    // valid signature: now evaluate the time claims separately
    const times = claims ? evaluateTimes(claims, now) : null
    const validity = times ? describeValidity(times) : null
    const claimsOk = !times || times.status === 'valid' || times.status === 'no-exp' || times.status === 'n/a'
    const suffix = !times || times.status === 'n/a'
        ? 'the payload has no time claims'
        : times.status === 'valid'
            ? 'within its validity period'
            : validity.text.charAt(0).toLowerCase() + validity.text.slice(1)
    return (
        <StatusBanner tone={claimsOk ? 'success' : 'warning'} title={`Signature valid · ${suffix}`}>
            Checked with: {state.keyLabel}.
            {!claimsOk && ' The signature is genuine, but a server would reject the token at this time.'}
            {times?.issuedInFuture && ' “iat” is in the future: check the issuer’s clock.'}
            {state.notes?.map(note => <div key={note}>{note}</div>)}
        </StatusBanner>
    )
}

function PayloadView({ payload, json, onOpenNested }) {
    if (payload.type === 'error') return <StatusBanner tone="danger" title="Can’t decode the payload">{payload.error}</StatusBanner>
    if (payload.type === 'binary') {
        return (
            <>
                <StatusBanner tone="info" title="Binary payload">The payload isn’t UTF-8 text ({payload.bytes.length} bytes). Shown as Base64.</StatusBanner>
                <CodeBlock code={bytesToBase64(payload.bytes)} language="text" showCopy={false} maxHeight={360} />
            </>
        )
    }
    if (payload.type === 'nested') {
        return (
            <>
                <StatusBanner
                    tone="info"
                    title="Nested token"
                    action={<button type="button" className="btn btn-sm btn-outline" onClick={onOpenNested}><CornerDownRight size={14} aria-hidden="true" /> Decode it</button>}
                >
                    The payload is another JWT.
                </StatusBanner>
                <CodeBlock code={payload.text} language="text" showCopy={false} maxHeight={360} />
            </>
        )
    }
    if (payload.type === 'text') {
        return (
            <>
                <div className="field-hint" style={{ marginTop: 0, marginBottom: 'var(--space-xs)' }}>The payload isn’t JSON, so it’s shown as text.</div>
                <CodeBlock code={payload.text} language="text" showCopy={false} maxHeight={360} />
            </>
        )
    }
    return (
        <>
            {payload.type === 'json' && (
                <div className="field-hint" style={{ marginTop: 0, marginBottom: 'var(--space-xs)' }}>
                    The payload is JSON but not a claims object (it’s {describeType(payload.value)}).
                </div>
            )}
            <CodeBlock code={json} language="json" showCopy={false} maxHeight={480} />
        </>
    )
}

export default function Jwt() {
    const [token, setToken] = useState('')
    const [secret, setSecret] = useState('')
    const [secretEncoding, setSecretEncoding] = useState('text')
    const [showSecret, setShowSecret] = useState(false)
    const [keyText, setKeyText] = useState('')
    const [verification, setVerification] = useState(null)

    useSmartInput({ input: setToken, key: setKeyText })

    const normalized = useMemo(() => normalizeToken(token), [token])
    const decoded = useMemo(() => decodeToken(normalized.value), [normalized.value])
    const jws = decoded?.kind === 'jws' ? decoded : null
    const family = jws ? algFamily(jws.alg) : null
    const claims = jws?.payload.type === 'claims' ? jws.payload.value : null

    const headerJson = useMemo(() => (decoded?.header?.value ? stringify(decoded.header.value) : ''), [decoded])
    const payloadJson = useMemo(() => (jws && (jws.payload.type === 'claims' || jws.payload.type === 'json') ? stringify(jws.payload.value) : jws?.payload.text ?? ''), [jws])
    const payloadCopy = jws?.payload.type === 'binary' ? bytesToBase64(jws.payload.bytes) : payloadJson
    const bothJson = useMemo(() => (jws?.header.value && (jws.payload.type === 'claims' || jws.payload.type === 'json') ? stringify({ header: jws.header.value, payload: jws.payload.value }) : ''), [jws])

    // What verification depends on; results are only shown for the inputs they were computed with
    const usesSecret = family === 'hmac'
    const usesKey = family === 'rsa' || family === 'ec' || family === 'okp'
    const verifyKey = JSON.stringify([normalized.value, usesSecret ? secret : '', usesSecret ? secretEncoding : '', usesKey ? keyText : ''])
    const needsAsync = !!jws && !jws.header.error && !jws.algError && ((usesSecret && secret !== '') || (usesKey && keyText.trim() !== ''))

    useEffect(() => {
        if (!needsAsync) return undefined
        let cancelled = false
        const timer = setTimeout(async () => {
            let result
            try {
                result = await verifyToken({ token: normalized.value, decoded: jws, secret, secretEncoding, keyText })
            } catch (error) {
                result = { status: 'error', step: 'verify', message: error?.message || String(error) }
            }
            if (!cancelled) setVerification({ key: verifyKey, result })
        }, 200)
        return () => {
            cancelled = true
            clearTimeout(timer)
        }
    }, [needsAsync, verifyKey, normalized.value, jws, secret, secretEncoding, keyText])

    let verifyState = { status: 'idle' }
    if (jws) {
        if (jws.header.error) verifyState = { status: 'error', step: 'header', message: jws.header.error }
        else if (jws.algError) verifyState = { status: 'error', step: 'header', message: jws.algError }
        else if (family === 'none') verifyState = { status: 'unsecured', hasSignature: jws.parts[2] !== '' }
        else if (family === 'unsupported') verifyState = { status: 'error', step: 'header', message: jws.alg === 'ES256K' ? 'ES256K (secp256k1) isn’t available in browsers’ WebCrypto, so it can’t be verified here.' : `Unsupported algorithm “${jws.alg}”. Supported: HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512 and EdDSA.` }
        else if (needsAsync) verifyState = verification?.key === verifyKey ? verification.result : { status: 'checking' }
    }

    useRegisterAIContext({
        tool: 'JWT Decoder',
        getContext: () => ({
            input: normalized.value,
            output: jws
                ? [
                    headerJson && `Header:\n${headerJson}`,
                    payloadJson && `Payload:\n${payloadJson}`,
                    `Signature check: ${verifyState.status}${verifyState.message ? ` (${verifyState.message})` : ''}`,
                    `Current time: ${new Date().toISOString()}`,
                ].filter(Boolean).join('\n\n')
                : decoded?.error || '',
        }),
        suggestedPrompts: [
            'Explain each claim in this payload',
            'Is this token expired?',
            'What algorithm is used and is it safe?',
            'What is the purpose of this token?',
        ],
    })

    const keyPlaceholder = family === 'okp'
        ? '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA…\n-----END PUBLIC KEY-----'
        : family === 'ec'
            ? '-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE…\n-----END PUBLIC KEY-----'
            : '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA…\n-----END PUBLIC KEY-----'

    const header = decoded?.header?.value
    const signatureBytes = jws?.signature.bytes

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                <Field
                    label="Token"
                    labelAction={
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <PipelineRead onRead={setToken} />
                            <CopyButton text={normalized.value} label="Copy token" disabled={!normalized.value} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setToken('')} disabled={!token}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    }
                    hint={normalized.notes.length ? `${normalized.notes.join('. ')}.` : 'Paste a JWT, an Authorization header value or a “Bearer …” string. Nothing leaves your browser.'}
                    error={decoded?.error}
                >
                    <textarea
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="Paste a JWT (eyJh...)"
                        spellCheck={false}
                        autoComplete="off"
                        autoCapitalize="off"
                        className={decoded?.error ? 'field-invalid' : ''}
                        style={{ minHeight: 110, wordBreak: 'break-all' }}
                    />
                </Field>
            </section>

            {!decoded && (
                <EmptyState icon={ShieldCheck} title="Nothing decoded yet">
                    Paste a token to see its header, payload and expiry, and to check its signature.
                </EmptyState>
            )}

            {decoded?.kind === 'jwe' && (
                <>
                    <StatusBanner tone="info" icon={Lock} title="Encrypted token (JWE)">
                        This token has 5 parts: its payload is encrypted and can only be read with the recipient’s key, which this tool doesn’t do. The header is readable:
                    </StatusBanner>
                    {header ? <section className="card"><PartTitle actions={<CopyButton text={headerJson} label="Copy" />}>Protected header</PartTitle><CodeBlock code={headerJson} language="json" showCopy={false} /></section> : <StatusBanner tone="danger" title="Can’t decode the header">{decoded.header.error}</StatusBanner>}
                </>
            )}

            {jws && (
                <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', alignItems: 'center' }}>
                        {jws.alg && <span className="badge badge-primary" title="Signing algorithm (alg)">alg: {jws.alg}</span>}
                        {jws.algError && <span className="badge badge-danger">alg: invalid</span>}
                        {header?.typ !== undefined && <span className="badge" title="Token type (typ)">typ: {String(header.typ)}</span>}
                        {header?.kid !== undefined && <span className="badge" title="Key ID (kid)" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>kid: {String(header.kid)}</span>}
                        {claims && <ValidityBadge claims={claims} />}
                        <span style={{ flex: 1 }} />
                        <PipelineSend dataToSend={bothJson} label="Send header + payload" />
                    </div>

                    <div className="split-pane" style={{ alignItems: 'start' }}>
                        <section className="card">
                            <PartTitle actions={<CopyButton text={headerJson || jws.header.text || ''} label="Copy" />}>Header</PartTitle>
                            {jws.header.error ? (
                                <>
                                    <StatusBanner tone="danger" title="Can’t decode the header">{jws.header.error}</StatusBanner>
                                    {jws.header.text && <div className="code-well" style={{ marginTop: 'var(--space-sm)' }}>{jws.header.text}</div>}
                                </>
                            ) : (
                                <CodeBlock code={headerJson} language="json" showCopy={false} />
                            )}
                        </section>
                        <section className="card">
                            <PartTitle actions={<><PipelineSend dataToSend={payloadJson} label="Send payload" /><CopyButton text={payloadCopy} label="Copy" /></>}>Payload</PartTitle>
                            <PayloadView payload={jws.payload} json={payloadJson} onOpenNested={() => setToken(jws.payload.text)} />
                        </section>
                    </div>

                    {claims && <ClaimsTable claims={claims} />}

                    <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                        <PartTitle>
                            <KeyRound size={18} aria-hidden="true" style={{ color: 'var(--primary-text)' }} /> Verify signature
                            {jws.alg && <span className="badge badge-primary">{jws.alg}</span>}
                        </PartTitle>

                        {usesSecret && (
                            <Field
                                label="Secret"
                                labelAction={
                                    <div style={{ display: 'flex', gap: 'var(--space-xs)', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                        <SegmentedControl size="sm" ariaLabel="Secret encoding" options={SECRET_ENCODINGS} value={secretEncoding} onChange={setSecretEncoding} />
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
                                hint={secretEncoding === 'text' ? 'The shared secret, as UTF-8 text. Choose Base64 or Hex for binary secrets.' : `The shared secret as ${secretEncoding === 'hex' ? 'hex digits' : 'Base64 or Base64url'}.`}
                            >
                                <input
                                    type={showSecret ? 'text' : 'password'}
                                    value={secret}
                                    onChange={(e) => setSecret(e.target.value)}
                                    placeholder="your-256-bit-secret"
                                    autoComplete="off"
                                    spellCheck={false}
                                    data-1p-ignore
                                    data-lpignore="true"
                                    className="mono"
                                />
                            </Field>
                        )}

                        {usesKey && (
                            <Field
                                label="Public key"
                                hint={`PEM public key or X.509 certificate, a JWK, or a JWKS (the key matching the token’s kid is used).${family === 'rsa' ? ' RSA keys need at least 2048 bits.' : ''}`}
                            >
                                <textarea
                                    value={keyText}
                                    onChange={(e) => setKeyText(e.target.value)}
                                    placeholder={keyPlaceholder}
                                    spellCheck={false}
                                    autoComplete="off"
                                    style={{ minHeight: 130, fontSize: '0.8rem' }}
                                />
                            </Field>
                        )}

                        {verifyState.status === 'idle' && (usesSecret || usesKey) && (
                            <div className="field-hint" style={{ marginTop: 0 }}>
                                {usesSecret ? 'Enter the secret to check the signature.' : 'Paste the public key to check the signature.'}
                            </div>
                        )}

                        <div aria-live="polite">
                            <VerificationResult state={verifyState} claims={claims} />
                        </div>

                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-xs)' }}>
                                <span className="field-label" style={{ marginBottom: 0 }}>
                                    Signature {signatureBytes && <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>· {signatureBytes.length} bytes</span>}
                                </span>
                                <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
                                    <CopyButton text={jws.parts[2]} label="Copy Base64url" />
                                    {signatureBytes?.length > 0 && <CopyButton text={bytesToHex(signatureBytes)} label="Copy hex" />}
                                </div>
                            </div>
                            {jws.signature.error ? (
                                <div className="field-error">{jws.signature.error}</div>
                            ) : (
                                <div className="code-well" style={{ wordBreak: 'break-all', fontSize: '0.8rem', maxHeight: 140 }}>
                                    {jws.parts[2] || <span style={{ color: 'var(--text-dim)' }}>(empty)</span>}
                                </div>
                            )}
                        </div>
                    </section>
                </>
            )}
        </div>
    )
}
