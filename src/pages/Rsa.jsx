import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, FileLock2, KeyRound, Loader2, LockKeyhole, ShieldCheck, Unlock } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import SegmentedControl from '../components/ui/SegmentedControl'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { useNow } from '../utils/clock'
import { downloadText } from '../utils/download'
import { openInTool } from '../utils/smartNav'
import { bytesToBase64, bytesToBase64Url, utf8Encode } from '../utils/encoding'
import { pemEncode, pkcs8ToPkcs1, rsaModulusBits, spkiToPkcs1 } from '../utils/pem'
import { BRAND } from '../config/brand'

const SIZES = [
    { value: 2048, label: '2048-bit', title: 'The common minimum (≈112-bit security). Fast to generate.' },
    { value: 3072, label: '3072-bit', title: '≈128-bit security, NIST’s recommendation for use beyond 2030.' },
    { value: 4096, label: '4096-bit', title: 'Larger margin; slower to generate, sign and decrypt.' },
]

const FORMATS = [
    { value: 'pkcs8', label: 'PEM · PKCS#8 / SPKI' },
    { value: 'pkcs1', label: 'PEM · PKCS#1' },
    { value: 'jwk', label: 'JWK' },
]

const FORMAT_HINTS = {
    pkcs8: 'Standard PEM (“BEGIN PUBLIC KEY” / “BEGIN PRIVATE KEY”). Works with OpenSSL, Node, Java, Go, WebCrypto and jose.',
    pkcs1: 'Traditional RSA-specific PEM (“BEGIN RSA PUBLIC/PRIVATE KEY”), for older tools that expect it.',
    jwk: 'JSON Web Keys labelled for RS256 signing, with an RFC 7638 thumbprint as “kid”.',
}

const Spinner = (props) => <Loader2 {...props} className="spin" />

function Elapsed({ since }) {
    const now = useNow()
    const seconds = Math.max(0, Math.floor((now - since) / 1000))
    return seconds > 0 ? <span> · {seconds} s</span> : null
}

async function sha256(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
}

async function createKeys(size) {
    const started = performance.now()
    const pair = await crypto.subtle.generateKey(
        { name: 'RSASSA-PKCS1-v1_5', modulusLength: size, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
        true,
        ['sign', 'verify'],
    )
    const ms = performance.now() - started
    const [spki, pkcs8, publicJwk, privateJwk] = await Promise.all([
        crypto.subtle.exportKey('spki', pair.publicKey).then(b => new Uint8Array(b)),
        crypto.subtle.exportKey('pkcs8', pair.privateKey).then(b => new Uint8Array(b)),
        crypto.subtle.exportKey('jwk', pair.publicKey),
        crypto.subtle.exportKey('jwk', pair.privateKey),
    ])
    const pkcs1Public = spkiToPkcs1(spki)
    // RFC 7638 thumbprint: SHA-256 of the canonical {e, kty, n} JSON
    const kid = bytesToBase64Url(await sha256(utf8Encode(JSON.stringify({ e: publicJwk.e, kty: 'RSA', n: publicJwk.n }))))
    const fingerprint = bytesToBase64(await sha256(spki)).replace(/=+$/, '')
    const jwkMeta = { kty: 'RSA', kid, use: 'sig', alg: 'RS256' }
    const { d, p, q, dp, dq, qi } = privateJwk
    return {
        size,
        bits: rsaModulusBits(pkcs1Public),
        ms,
        kid,
        fingerprint,
        privateKey: pair.privateKey,
        public: {
            pkcs8: pemEncode('PUBLIC KEY', spki),
            pkcs1: pemEncode('RSA PUBLIC KEY', pkcs1Public),
            jwk: `${JSON.stringify({ ...jwkMeta, n: publicJwk.n, e: publicJwk.e }, null, 2)}\n`,
        },
        private: {
            pkcs8: pemEncode('PRIVATE KEY', pkcs8),
            pkcs1: pemEncode('RSA PRIVATE KEY', pkcs8ToPkcs1(pkcs8)),
            jwk: `${JSON.stringify({ ...jwkMeta, n: publicJwk.n, e: publicJwk.e, d, p, q, dp, dq, qi }, null, 2)}\n`,
        },
    }
}

// A short RS256 token signed with the new private key, for the JWT page.
async function signSampleJwt(keys) {
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT', kid: keys.kid }
    const payload = { iss: BRAND.name, sub: 'test-user', iat: now, exp: now + 3600 }
    const input = `${bytesToBase64Url(utf8Encode(JSON.stringify(header)))}.${bytesToBase64Url(utf8Encode(JSON.stringify(payload)))}`
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, utf8Encode(input)))
    return `${input}.${bytesToBase64Url(signature)}`
}

function KeyCard({ kind, text, format }) {
    const isPublic = kind === 'public'
    const Icon = isPublic ? Unlock : LockKeyhole
    const base = isPublic ? 'public' : 'private'
    const filename = format === 'jwk' ? `${base}.jwk.json` : `${base}${format === 'pkcs1' ? '-pkcs1' : ''}.pem`
    return (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                <div role="heading" aria-level={2} className="section-title">
                    <Icon size={16} aria-hidden="true" style={{ color: isPublic ? 'var(--success)' : 'var(--warning)' }} />
                    {isPublic ? 'Public key' : 'Private key'}
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                    <CopyButton text={text} label="Copy" />
                    <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => downloadText(text, filename, format === 'jwk' ? 'application/json' : 'application/x-pem-file')}
                    >
                        <Download size={14} aria-hidden="true" /> {filename}
                    </button>
                </div>
            </div>
            <pre className="code-well" style={{ margin: 0, maxHeight: 360, fontSize: '0.75rem', wordBreak: 'break-all', flex: 1 }} aria-label={isPublic ? 'Public key' : 'Private key'} tabIndex={0}>
                {text}
            </pre>
            <div className="field-hint" style={{ marginTop: 0 }}>
                {isPublic ? 'Share this one: it verifies signatures and encrypts.' : 'Keep this secret: it signs and decrypts. It exists only in this tab until you copy or download it.'}
            </div>
        </div>
    )
}

export default function Rsa() {
    const navigate = useNavigate()
    const [size, setSize] = useState(2048)
    const [format, setFormat] = useState('pkcs8')
    const [keys, setKeys] = useState(null)
    const [generating, setGenerating] = useState(null) // { size, started }
    const [error, setError] = useState(null)
    const requestId = useRef(0)

    const generate = async () => {
        if (!globalThis.crypto?.subtle) {
            setError('WebCrypto isn’t available on this page (it needs HTTPS or localhost), so keys can’t be generated here.')
            return
        }
        const id = ++requestId.current
        setGenerating({ size, started: Date.now() })
        setKeys(null)
        setError(null)
        try {
            const result = await createKeys(size)
            if (id === requestId.current) setKeys(result)
        } catch (e) {
            if (id === requestId.current) setError(e?.message || String(e))
        } finally {
            if (id === requestId.current) setGenerating(null)
        }
    }

    const testInJwt = async () => {
        try {
            const token = await signSampleJwt(keys)
            openInTool(navigate, '/jwt', { input: token, key: keys.public.pkcs8 })
        } catch (e) {
            setError(`Couldn’t sign a test token: ${e?.message || e}`)
        }
    }

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card" style={{ display: 'grid', gap: 'var(--space-md)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                    <div>
                        <div className="field-label" aria-hidden="true">Key size</div>
                        <SegmentedControl ariaLabel="Key size" options={SIZES} value={size} onChange={setSize} disabled={!!generating} />
                    </div>
                    <button type="button" className="btn btn-primary" onClick={generate} disabled={!!generating} style={{ marginLeft: 'auto' }}>
                        {generating ? <Spinner size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
                        {generating ? 'Generating…' : 'Generate new keys'}
                    </button>
                </div>
                <div className="field-hint" style={{ marginTop: 0 }}>
                    {SIZES.find(s => s.value === size)?.title} Public exponent 65537. 1024-bit keys aren’t offered: they’re breakable and rejected by modern libraries (including the JWT verifier).
                </div>
            </section>

            {error && <StatusBanner tone="danger" title="Key generation failed">{error}</StatusBanner>}

            {generating && (
                <div aria-live="polite">
                    <StatusBanner tone="info" icon={Spinner} title={<>Generating a {generating.size}-bit key pair<Elapsed since={generating.started} /></>}>
                        Finding large primes takes a moment ({generating.size >= 4096 ? 'often several seconds for 4096-bit' : 'usually under a second'}). The page stays responsive.
                    </StatusBanner>
                </div>
            )}

            {!keys && !generating && !error && (
                <EmptyState icon={FileLock2} title="No keys yet">
                    Choose a size and generate a key pair. Keys are created locally and never leave your browser.
                </EmptyState>
            )}

            {keys && (
                <>
                    <section className="card" style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', alignItems: 'center' }}>
                            <span className="badge badge-success"><ShieldCheck size={12} aria-hidden="true" /> {keys.bits}-bit modulus</span>
                            <span className="badge">e = 65537</span>
                            <span className="badge">generated in {keys.ms < 1000 ? `${Math.round(keys.ms)} ms` : `${(keys.ms / 1000).toFixed(1)} s`}</span>
                        </div>
                        <div style={{ display: 'grid', gap: 2, fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: 0 }}>
                            <div style={{ overflowWrap: 'anywhere' }}><span style={{ color: 'var(--text-dim)' }}>JWK thumbprint (kid):</span> <span className="mono">{keys.kid}</span></div>
                            <div style={{ overflowWrap: 'anywhere' }}><span style={{ color: 'var(--text-dim)' }}>SPKI SHA-256:</span> <span className="mono">{keys.fingerprint}</span></div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginTop: 'var(--space-xs)' }}>
                            <SegmentedControl ariaLabel="Key format" options={FORMATS} value={format} onChange={setFormat} size="sm" />
                            <button type="button" className="btn btn-outline btn-sm" onClick={testInJwt} title="Sign a sample RS256 token with this key and open it in the JWT Decoder">
                                <KeyRound size={14} aria-hidden="true" /> Test with a signed JWT
                            </button>
                        </div>
                        <div className="field-hint" style={{ marginTop: 0 }}>{FORMAT_HINTS[format]}</div>
                    </section>

                    <div className="split-pane" style={{ alignItems: 'stretch' }}>
                        <KeyCard kind="public" text={keys.public[format]} format={format} />
                        <KeyCard kind="private" text={keys.private[format]} format={format} />
                    </div>
                </>
            )}
        </div>
    )
}
