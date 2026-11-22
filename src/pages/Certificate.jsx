import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowUpDown, BadgeCheck, CircleAlert, Download, FileBadge, FileText, Loader2, LockKeyhole, Minus, Trash2, X } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import CodeBlock from '../components/ui/CodeBlock'
import Field from '../components/ui/Field'
import FileDropZone from '../components/ui/FileDropZone'
import StatusBanner from '../components/ui/StatusBanner'
import EmptyState from '../components/ui/EmptyState'
import { useToast } from '../components/ToastProvider'
import { useSmartInput } from '../hooks/useSmartInput'
import { useIncomingFiles } from '../hooks/useIncomingFiles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useNow } from '../utils/clock'
import { downloadBlob, formatBytes } from '../utils/download'
import { decodeEncapsulated, describeNode, parseDer } from '../utils/asn1'
import {
    MAX_INPUT_BYTES,
    analyzeChain,
    certificateTitle,
    colonHex,
    findIssuerIndex,
    fingerprints,
    formatName,
    inspect,
    isSelfSigned,
    oidName,
    pemEncode,
    publicKeyToJwk,
    spkiPin,
    validityStatus,
    verifySignature,
} from '../utils/x509'
import './Certificate.css'

const ACCEPT = '.pem,.crt,.cer,.cert,.der,.csr,.req,.key,.pub,.p7b,.p7c,.p8,.pk8,.txt'
const TONE_BADGE = { success: 'badge-success', warning: 'badge-warning', danger: 'badge-danger' }
const ROLE_LABELS = { leaf: 'Leaf', intermediate: 'Intermediate', root: 'Root' }
const MAX_TREE_CHILDREN = 200
const MAX_HEX_BYTES = 256 // unknown extension values shown as hex
const COLON_HEX = /^[0-9A-F]{2}(?::[0-9A-F]{2})+$/
const LARGE_BUNDLE = 4 // above this, unrelated certificates get a one-line note instead of a chain card

const Spinner = (props) => <Loader2 {...props} className="spin" />

const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`

function formatLocal(ms) {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

function formatUtc(ms) {
    const iso = new Date(ms).toISOString()
    return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`
}

function fileBase(name, fallback) {
    const cleaned = String(name || '').replace(/^\*\./, 'wildcard.').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 64)
    return cleaned || fallback
}

function keyDetails(key) {
    const parts = [key.summary]
    if (key.rsa) parts.push(`exponent ${key.rsa.e}`)
    if (key.curve?.aliases) parts.push(key.curve.aliases)
    return parts.join(' · ')
}

// Where an item came from, when that adds something: unlabelled input, PKCS#7, unusual labels
function sourceNote(item, usualLabel) {
    if (!item.label) return item.source.split(' · ')[0]
    if (['PKCS7', 'CMS', 'PKCS #7 SIGNED DATA'].includes(item.label)) return 'PKCS#7 bundle'
    return item.label === usualLabel ? null : item.label
}

// "AB:CD:EF…" that wraps only between bytes
function Hex({ value }) {
    const parts = value.split(':')
    return (
        <span className="cert-code">
            {parts.map((part, i) => (i < parts.length - 1 ? <span key={i}>{part}:<wbr /></span> : <span key={i}>{part}</span>))}
        </span>
    )
}

// Fingerprints, key pins and signature checks for every item (WebCrypto is async).
// Certificates are checked against whichever pasted certificate issued them.
async function computeExtras(items) {
    const certIndexes = items.flatMap((item, i) => (item.kind === 'certificate' ? [i] : []))
    const certs = certIndexes.map(i => items[i].certificate)
    return Promise.all(items.map(async (item, i) => {
        try {
            if (item.kind === 'certificate') {
                const cert = item.certificate
                const [fp, pin] = await Promise.all([fingerprints(cert.der), spkiPin(cert.publicKey.der)])
                const k = certIndexes.indexOf(i)
                const issuer = findIssuerIndex(certs, k)
                const signature = issuer < 0
                    ? { status: 'no-issuer' }
                    : {
                        ...(await verifySignature({ data: cert.tbsDer, signature: cert.signature, algorithm: cert.signatureAlgorithm, publicKey: certs[issuer].publicKey })),
                        issuerItem: certIndexes[issuer],
                        self: issuer === k,
                    }
                return { fingerprints: fp, pin, signature }
            }
            if (item.kind === 'csr') {
                const { csr } = item
                const [pin, signature] = await Promise.all([
                    spkiPin(csr.publicKey.der),
                    verifySignature({ data: csr.infoDer, signature: csr.signature, algorithm: csr.signatureAlgorithm, publicKey: csr.publicKey }),
                ])
                return { pin, signature: { ...signature, self: true } }
            }
            if (item.kind === 'publicKey') return { pin: await spkiPin(item.publicKey.der) }
        } catch (error) {
            return { error: error?.message || String(error) }
        }
        return {}
    }))
}

function summarize(items) {
    const counts = new Map()
    const names = {
        certificate: ['certificate', 'certificates'],
        csr: ['certificate request', 'certificate requests'],
        publicKey: ['public key', 'public keys'],
        privateKey: ['private key', 'private keys'],
        ecParameters: ['set of EC parameters', 'sets of EC parameters'],
    }
    for (const item of items) if (names[item.kind]) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1)
    return [...counts].map(([kind, n]) => plural(n, ...names[kind])).join(' · ')
}

// What the AI assistant gets: public material only, never private keys
function aiContext(items, errors) {
    const pem = []
    const lines = []
    for (const item of items) {
        if (item.kind === 'certificate') {
            const c = item.certificate
            pem.push(pemEncode('CERTIFICATE', c.der))
            lines.push(`Certificate: subject ${formatName(c.subject)}; issuer ${formatName(c.issuer)}; valid ${new Date(c.notBefore.ms).toISOString()} to ${new Date(c.notAfter.ms).toISOString()}; key ${c.publicKey.summary}; signature ${c.signatureAlgorithm.label}; SANs ${c.sanNames.map(n => `${n.label}:${n.value}`).join(', ') || 'none'}`)
        } else if (item.kind === 'csr') {
            pem.push(pemEncode('CERTIFICATE REQUEST', item.csr.der))
            lines.push(`Certificate request: subject ${formatName(item.csr.subject)}; key ${item.csr.publicKey.summary}`)
        } else if (item.kind === 'publicKey') {
            pem.push(pemEncode('PUBLIC KEY', item.publicKey.der))
            lines.push(`Public key: ${item.publicKey.summary}`)
        } else if (item.kind === 'privateKey') {
            lines.push(`Private key (${item.privateKey.type}): withheld`)
        }
    }
    for (const e of errors) lines.push(`Error in ${e.source}: ${e.message}`)
    return { input: pem.join(''), output: lines.join('\n') }
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

function ValidityBadge({ notBefore, notAfter }) {
    const now = useNow()
    const status = validityStatus(notBefore.ms, notAfter.ms, now)
    return <span className={`badge ${TONE_BADGE[status.tone]}`}>{status.text}</span>
}

function NameView({ name }) {
    if (!name.rdns.length) return <span className="cert-muted">(empty)</span>
    // Most specific first (CN at the top), as in the one-line DN
    const rows = [...name.rdns].reverse().flatMap((rdn, i) => rdn.map((a, j) => ({ key: `${i}.${j}`, a, joined: j > 0 })))
    return (
        <div className="cert-name">
            {rows.map(({ key, a, joined }) => (
                <div key={key} className="cert-name-row">
                    <span className="cert-name-key">
                        {joined && '+'}
                        {a.short === a.oid ? a.short : <abbr title={`${a.label} (${a.oid})`}>{a.short}</abbr>}
                    </span>
                    <span className="cert-name-value">{a.value}</span>
                </div>
            ))}
        </div>
    )
}

function TimeValue({ time }) {
    return (
        <>
            <div>{formatLocal(time.ms)}</div>
            <div className="cert-meta">
                <span className="mono">{formatUtc(time.ms)}</span> · {time.type} {time.text}
            </div>
        </>
    )
}

function SignatureCheck({ signature, numberOf }) {
    if (!signature) return <span className="cert-check cert-muted"><Spinner size={14} aria-hidden="true" /> Checking…</span>
    const by = signature.self ? null : numberOf?.(signature.issuerItem)
    switch (signature.status) {
        case 'valid':
            return (
                <span className="cert-check tone-success">
                    <BadgeCheck size={16} aria-hidden="true" />
                    {signature.self ? 'Valid: it verifies with its own key' : `Valid: signed by certificate ${by}`}
                </span>
            )
        case 'invalid':
            return (
                <span className="cert-check tone-danger">
                    <CircleAlert size={16} aria-hidden="true" />
                    {signature.self ? 'Doesn’t verify with its own key.' : `Doesn’t verify with certificate ${by}’s key.`} {signature.reason}
                </span>
            )
        case 'no-issuer':
            return <span className="cert-check cert-muted"><Minus size={16} aria-hidden="true" /> Not checked: the issuer’s certificate isn’t included.</span>
        default:
            return <span className="cert-check cert-muted"><Minus size={16} aria-hidden="true" /> Not checked: {signature.reason}</span>
    }
}

function FingerprintRows({ rows, error }) {
    return (
        <div className="cert-fingerprints">
            {rows.map(({ label, value, copyLabel }) => (
                <div key={label} className="cert-fp-row">
                    <span className="cert-fp-label">{label}</span>
                    {value
                        ? <Hex value={value} />
                        : <span className="cert-muted">{error ? 'Not available' : <><Spinner size={12} aria-hidden="true" /> Computing…</>}</span>}
                    <CopyButton text={value ?? ''} iconOnly label={copyLabel} />
                </div>
            ))}
            {error && <div className="field-error">{error}</div>}
        </div>
    )
}

function Extensions({ extensions, title }) {
    if (!extensions.length) return null
    return (
        <div className="cert-section">
            <h3 className="cert-section-title">{title} · {extensions.length}</h3>
            <ul className="cert-ext-list">
                {extensions.map((ext, i) => (
                    <li key={`${ext.oid}-${i}`} className="cert-ext">
                        <div className="cert-ext-head">
                            <span className="cert-ext-name">{ext.label}</span>
                            {ext.critical && <span className="badge">critical</span>}
                            <span className="cert-ext-oid">{ext.oid}</span>
                        </div>
                        {ext.parsed ? (
                            <div className="cert-ext-rows">
                                {ext.parsed.rows.map((row, j) => (
                                    <div key={j} className={`cert-ext-row${row.label ? '' : ' no-label'}`}>
                                        {row.label && <span className="cert-ext-label">{row.label}</span>}
                                        <span className={`cert-ext-value${row.mono ? ' cert-code' : ''}`}>
                                            {COLON_HEX.test(row.value) ? <Hex value={row.value} /> : row.value}
                                            {row.detail && <span className="cert-meta"> · {row.detail}</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="cert-code">
                                {ext.value.length ? <Hex value={colonHex(ext.value.subarray(0, MAX_HEX_BYTES))} /> : '(empty)'}
                                {ext.value.length > MAX_HEX_BYTES && <span className="cert-meta"> … {ext.value.length} bytes in all, see the raw ASN.1</span>}
                            </div>
                        )}
                        {ext.error && <div className="field-error">Can’t decode this value: {ext.error}</div>}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function Warnings({ warnings }) {
    if (!warnings.length) return null
    return (
        <StatusBanner tone="warning" title={plural(warnings.length, 'warning')}>
            <ul className="cert-list">
                {warnings.map(w => <li key={w}>{w}</li>)}
            </ul>
        </StatusBanner>
    )
}

// ---------------------------------------------------------------------------
// Raw ASN.1 tree (rendered lazily: only open nodes render their children)
// ---------------------------------------------------------------------------

function Asn1NodeView({ node, base, depth }) {
    const info = describeNode(node, { oidName })
    const encapsulated = useMemo(() => (node.constructed ? null : decodeEncapsulated(node)), [node])
    const [open, setOpen] = useState(depth < 3)
    const line = (
        <>
            <span className="cert-asn1-tag">{info.name}</span>
            {info.value && !encapsulated && <span className={`cert-asn1-value${info.error ? ' is-error' : ''}`}>{info.value}</span>}
            <span className="cert-asn1-meta">{encapsulated ? 'holds DER · ' : ''}{info.size} · at {base + node.offset}</span>
        </>
    )
    const children = node.constructed ? node.children : encapsulated ? [encapsulated.root] : null
    if (!children?.length) return <div className="cert-asn1-leaf">{line}</div>
    const childBase = node.constructed ? base : base + encapsulated.base
    return (
        <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>{line}</summary>
            {open && (
                <div className="cert-asn1-children">
                    {children.slice(0, MAX_TREE_CHILDREN).map((child, i) => <Asn1NodeView key={i} node={child} base={childBase} depth={depth + 1} />)}
                    {children.length > MAX_TREE_CHILDREN && <div className="cert-asn1-leaf cert-asn1-meta">… {children.length - MAX_TREE_CHILDREN} more elements not shown</div>}
                </div>
            )}
        </details>
    )
}

function Asn1Tree({ der }) {
    const parsed = useMemo(() => {
        try {
            return { root: parseDer(der) }
        } catch (error) {
            return { error: error.message }
        }
    }, [der])
    if (parsed.error) return <div className="field-error">{parsed.error}</div>
    return (
        <div className="cert-asn1">
            <Asn1NodeView node={parsed.root} base={0} depth={0} />
        </div>
    )
}

function RawAsn1({ der }) {
    const [open, setOpen] = useState(false)
    return (
        <details className="cert-raw" onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>Raw ASN.1 · {plural(der.length, 'byte')}</summary>
            {open && <Asn1Tree der={der} />}
        </details>
    )
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

function CardHead({ kicker, title, headingId, badges, actions }) {
    return (
        <div className="cert-head">
            <div className="cert-head-main">
                <div className="cert-kicker">{kicker}</div>
                <h2 id={headingId} className="cert-title">{title}</h2>
                {badges && <div className="cert-badges">{badges}</div>}
            </div>
            {actions && <div className="cert-actions">{actions}</div>}
        </div>
    )
}

function CertificateCard({ item, number, total, role, extra, numberOf, cardRef }) {
    const headingId = useId()
    const cert = item.certificate
    const title = certificateTitle(cert)
    const jwk = useMemo(() => publicKeyToJwk(cert.publicKey).jwk, [cert])
    const pem = useMemo(() => pemEncode('CERTIFICATE', cert.der), [cert])
    const kicker = [total > 1 ? `Certificate ${number} of ${total}` : 'Certificate', sourceNote(item, 'CERTIFICATE')].filter(Boolean).join(' · ')
    const shortSerial = cert.serial.hex.replace('-', '').length <= 16
    return (
        <section className="card cert-card" ref={cardRef} tabIndex={-1} aria-labelledby={headingId}>
            <CardHead
                kicker={kicker}
                title={title}
                headingId={headingId}
                badges={(
                    <>
                        <ValidityBadge notBefore={cert.notBefore} notAfter={cert.notAfter} />
                        {role && <span className="badge badge-primary">{ROLE_LABELS[role]}</span>}
                        {isSelfSigned(cert) && <span className="badge">Self-signed</span>}
                        {cert.isCa && <span className="badge">CA</span>}
                        <span className="badge">{cert.publicKey.summary}</span>
                    </>
                )}
                actions={(
                    <>
                        <CopyButton text={pem} label="Copy PEM" />
                        <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => downloadBlob(new Blob([cert.der], { type: 'application/pkix-cert' }), `${fileBase(title, 'certificate')}.der`)}
                        >
                            <Download size={14} aria-hidden="true" /> Download DER
                        </button>
                    </>
                )}
            />

            <dl className="cert-fields">
                <dt>Subject <CopyButton iconOnly text={formatName(cert.subject)} label="Copy subject DN" /></dt>
                <dd><NameView name={cert.subject} /></dd>
                <dt>Issuer <CopyButton iconOnly text={formatName(cert.issuer)} label="Copy issuer DN" /></dt>
                <dd><NameView name={cert.issuer} /></dd>
                <dt>Serial number</dt>
                <dd>
                    <div className="cert-inline">
                        <Hex value={cert.serial.colon} />
                        <CopyButton iconOnly text={cert.serial.hex} label="Copy serial number" />
                    </div>
                    {shortSerial && <div className="cert-meta">Decimal {cert.serial.decimal}</div>}
                </dd>
                <dt>Version</dt>
                <dd>{cert.version}</dd>
                <dt>Not before</dt>
                <dd><TimeValue time={cert.notBefore} /></dd>
                <dt>Not after</dt>
                <dd><TimeValue time={cert.notAfter} /></dd>
                <dt>Signature algorithm</dt>
                <dd>{cert.signatureAlgorithm.label} <span className="cert-meta mono">{cert.signatureAlgorithm.oid}</span></dd>
                <dt>Signature</dt>
                <dd><SignatureCheck signature={extra?.signature} numberOf={numberOf} /></dd>
                <dt>Public key</dt>
                <dd>
                    <div className="cert-inline">
                        <span>{keyDetails(cert.publicKey)}</span>
                        {jwk && <CopyButton text={JSON.stringify(jwk, null, 2)} label="Copy JWK" />}
                    </div>
                </dd>
                {item.trust && (
                    <>
                        <dt>Trust settings</dt>
                        <dd>
                            {item.trust.alias && <div>Alias: {item.trust.alias}</div>}
                            <div>Trusted for: {item.trust.trusted.join(', ') || 'nothing listed'}</div>
                            {item.trust.rejected.length > 0 && <div>Rejected for: {item.trust.rejected.join(', ')}</div>}
                            <div className="cert-meta">OpenSSL “TRUSTED CERTIFICATE” settings; the fingerprints cover the certificate only.</div>
                        </dd>
                    </>
                )}
            </dl>

            <div className="cert-section">
                <h3 className="cert-section-title">Fingerprints</h3>
                <FingerprintRows
                    error={extra?.error}
                    rows={[
                        { label: 'SHA-256', value: extra?.fingerprints?.sha256, copyLabel: 'Copy SHA-256 fingerprint' },
                        { label: 'SHA-1', value: extra?.fingerprints?.sha1, copyLabel: 'Copy SHA-1 fingerprint' },
                        { label: 'SPKI pin (SHA-256)', value: extra?.pin, copyLabel: 'Copy SPKI pin' },
                    ]}
                />
            </div>

            <Extensions extensions={cert.extensions} title="Extensions" />
            <Warnings warnings={cert.warnings} />
            <RawAsn1 der={cert.der} />
        </section>
    )
}

function CsrCard({ item, extra }) {
    const headingId = useId()
    const { csr } = item
    const title = csr.commonName || csr.sanNames[0]?.value || formatName(csr.subject) || 'Certificate request'
    const jwk = useMemo(() => publicKeyToJwk(csr.publicKey).jwk, [csr])
    const signature = extra?.signature
    return (
        <section className="card cert-card" aria-labelledby={headingId}>
            <CardHead
                kicker={['Certificate request', sourceNote(item, 'CERTIFICATE REQUEST')].filter(Boolean).join(' · ')}
                title={title}
                headingId={headingId}
                badges={<span className="badge">{csr.publicKey.summary}</span>}
                actions={<CopyButton text={pemEncode('CERTIFICATE REQUEST', csr.der)} label="Copy PEM" />}
            />
            <dl className="cert-fields">
                <dt>Subject <CopyButton iconOnly text={formatName(csr.subject)} label="Copy subject DN" /></dt>
                <dd><NameView name={csr.subject} /></dd>
                <dt>Public key</dt>
                <dd>
                    <div className="cert-inline">
                        <span>{keyDetails(csr.publicKey)}</span>
                        {jwk && <CopyButton text={JSON.stringify(jwk, null, 2)} label="Copy JWK" />}
                    </div>
                </dd>
                <dt>Signature algorithm</dt>
                <dd>{csr.signatureAlgorithm.label} <span className="cert-meta mono">{csr.signatureAlgorithm.oid}</span></dd>
                <dt>Self-signature</dt>
                <dd>
                    <SignatureCheck signature={signature} />
                    <div className="cert-meta">Proves the requester holds the private key.</div>
                </dd>
                {csr.attributes.map(a => (
                    <AttributeRow key={a.oid} attribute={a} />
                ))}
            </dl>
            <div className="cert-section">
                <h3 className="cert-section-title">Key fingerprint</h3>
                <FingerprintRows error={extra?.error} rows={[{ label: 'SPKI pin (SHA-256)', value: extra?.pin, copyLabel: 'Copy SPKI pin' }]} />
            </div>
            <Extensions extensions={csr.extensions} title="Requested extensions" />
            <Warnings warnings={csr.warnings} />
            <RawAsn1 der={csr.der} />
        </section>
    )
}

function AttributeRow({ attribute }) {
    return (
        <>
            <dt>{attribute.label}</dt>
            <dd>{attribute.value}</dd>
        </>
    )
}

function PublicKeyCard({ item, extra }) {
    const headingId = useId()
    const key = item.publicKey
    const { jwk, reason } = useMemo(() => publicKeyToJwk(key), [key])
    const size = key.type === 'EC' ? `${key.curve.name}${key.curve.aliases ? ` (${key.curve.aliases})` : ''}${key.bits ? ` · ${key.bits}-bit` : ''}` : key.bits ? `${key.bits}-bit` : null
    return (
        <section className="card cert-card" aria-labelledby={headingId}>
            <CardHead
                kicker={['Public key', item.format, item.label ? null : sourceNote(item)].filter(Boolean).join(' · ')}
                title={key.summary}
                headingId={headingId}
                actions={<CopyButton text={pemEncode('PUBLIC KEY', key.der)} label={item.format === 'PKCS#1' ? 'Copy as PUBLIC KEY PEM' : 'Copy PEM'} />}
            />
            <dl className="cert-fields">
                <dt>Algorithm</dt>
                <dd>{key.algorithm} <span className="cert-meta mono">{key.oid}</span></dd>
                {size && (
                    <>
                        <dt>{key.type === 'EC' ? 'Curve' : 'Size'}</dt>
                        <dd>{size}</dd>
                    </>
                )}
                {key.rsa && (
                    <>
                        <dt>Exponent</dt>
                        <dd>{String(key.rsa.e)}</dd>
                    </>
                )}
            </dl>
            <div className="cert-section">
                <h3 className="cert-section-title">Key fingerprint</h3>
                <FingerprintRows error={extra?.error} rows={[{ label: 'SPKI pin (SHA-256)', value: extra?.pin, copyLabel: 'Copy SPKI pin' }]} />
            </div>
            <div className="cert-section">
                <div className="cert-section-head">
                    <h3 className="cert-section-title">JWK</h3>
                    {jwk && <CopyButton text={JSON.stringify(jwk, null, 2)} label="Copy JWK" />}
                </div>
                {jwk ? <CodeBlock code={JSON.stringify(jwk, null, 2)} language="json" showCopy={false} /> : <div className="cert-muted">{reason}</div>}
            </div>
            <Warnings warnings={key.warnings} />
            <RawAsn1 der={key.der} />
        </section>
    )
}

function PrivateKeyCard({ item, onClear }) {
    const headingId = useId()
    const key = item.privateKey
    const known = key.type && key.type !== 'unknown'
    const title = key.encrypted && !known ? 'Encrypted private key' : known ? `${key.type} private key` : 'Private key'
    const size = key.curve ? `${key.curve.name}${key.curve.aliases ? ` (${key.curve.aliases})` : ''}` : key.bits ? `${key.bits}-bit` : null
    return (
        <section className="card cert-card" aria-labelledby={headingId}>
            <CardHead kicker={['Private key', sourceNote(item, item.label)].filter(Boolean).join(' · ')} title={title} headingId={headingId} />
            <StatusBanner
                tone="warning"
                icon={LockKeyhole}
                title="This is a secret key"
                action={<button type="button" className="btn btn-sm btn-secondary" onClick={onClear}>Clear input</button>}
            >
                Anyone who has it can sign or decrypt as its owner. It was read in this tab only: nothing is uploaded or stored, and only its type and size are shown here.
            </StatusBanner>
            <dl className="cert-fields">
                <dt>Type</dt>
                <dd>{known ? key.type : key.encrypted ? 'Unknown until it’s decrypted' : 'Unknown'}</dd>
                {size && (
                    <>
                        <dt>{key.curve ? 'Curve' : 'Size'}</dt>
                        <dd>{size}</dd>
                    </>
                )}
                <dt>Format</dt>
                <dd>{key.formatLabel}</dd>
                {key.encrypted !== null && (
                    <>
                        <dt>Encryption</dt>
                        <dd>{key.encrypted ? key.encryption?.summary ?? 'Encrypted' : 'Not encrypted'}</dd>
                    </>
                )}
            </dl>
            {key.unsupported && <StatusBanner tone="info" title="The details can’t be read">{key.unsupported}</StatusBanner>}
        </section>
    )
}

function SignatureBadge({ signature }) {
    const [tone, text] = {
        pending: ['', 'Checking signature…'],
        valid: ['badge-success', 'Signature valid'],
        invalid: ['badge-danger', 'Signature invalid'],
    }[signature.status] ?? ['', 'Signature not checked']
    return <span className={`badge ${tone}`}>{text}</span>
}

function LinkBadges({ link, signature }) {
    if (link.selfSigned) {
        return (
            <div className="cert-link is-broken">
                <span className="badge badge-danger">Self-signed: a chain ends here</span>
            </div>
        )
    }
    const nameText = link.names === 'different' ? 'Issuer name doesn’t match' : link.names === 'exact' ? 'Issuer name matches' : 'Issuer name matches (normalised)'
    const keyText = link.keyIds === null ? 'No key IDs to compare' : link.keyIds ? 'Key IDs match' : 'Key IDs differ'
    const broken = !link.ok || signature.status === 'invalid'
    return (
        <div className={`cert-link${broken ? ' is-broken' : ''}`}>
            <span className={`badge ${link.names === 'different' ? 'badge-danger' : 'badge-success'}`}>{nameText}</span>
            <span className={`badge ${link.keyIds === false ? 'badge-danger' : link.keyIds ? 'badge-success' : ''}`}>{keyText}</span>
            <SignatureBadge signature={signature} />
        </div>
    )
}

function ChainCard({ certItems, chain, extras, onSelect, onReorder }) {
    const headingId = useId()
    const n = certItems.length
    const signatureOf = (i) => (extras ? extras[certItems[i].index]?.signature : null)
    const linkSignature = (i) => {
        if (!extras) return { status: 'pending' }
        const s = signatureOf(i)
        return s && s.issuerItem === certItems[i + 1].index ? s : { status: 'not-checked' }
    }
    const last = certItems[n - 1].certificate
    const rootSignature = chain.endsAtRoot ? (extras ? signatureOf(n - 1) : { status: 'pending' }) : null
    const signatureProblems = certItems.slice(0, -1).flatMap((_, i) => (linkSignature(i).status === 'invalid' ? [`The signature on certificate ${i + 1} doesn’t verify with certificate ${i + 2}’s key.`] : []))
    if (rootSignature?.status === 'invalid') signatureProblems.push(`Certificate ${n} looks self-signed, but its signature doesn’t verify with its own key.`)
    const problems = [...chain.issues, ...signatureProblems]
    const unchecked = extras && certItems.slice(0, -1).some((_, i) => linkSignature(i).status === 'unsupported')

    let status
    if (!chain.related) {
        status = <StatusBanner tone="info" title="These certificates don’t form a chain">None of them issued the certificate listed after it.{chain.suggestedOrder ? '' : ' They may be unrelated.'}</StatusBanner>
    } else if (problems.length) {
        status = (
            <StatusBanner tone="danger" title={plural(problems.length, 'problem')}>
                <ul className="cert-list">{problems.map(p => <li key={p}>{p}</li>)}</ul>
            </StatusBanner>
        )
    } else {
        status = (
            <StatusBanner tone="success" title={chain.endsAtRoot ? 'The chain links up to a self-signed root' : 'The chain links up'}>
                Issuer names{chain.links.some(l => l.keyIds) ? ', key IDs' : ''} and {extras ? 'signatures' : 'signatures (checking…)'} match from the leaf up.
                {unchecked && ' Some signatures can’t be checked in this browser.'}
                {!chain.endsAtRoot && ' The root isn’t included, which is normal for a server’s chain.'}
            </StatusBanner>
        )
    }

    return (
        <section className="card cert-card" aria-labelledby={headingId}>
            <CardHead kicker={plural(n, 'certificate')} title="Chain" headingId={headingId} />
            <div aria-live="polite">{status}</div>
            {chain.suggestedOrder && (
                <StatusBanner
                    tone="info"
                    title="These certificates seem to be out of order"
                    action={<button type="button" className="btn btn-sm btn-secondary" onClick={() => onReorder(chain.suggestedOrder)}><ArrowUpDown size={14} aria-hidden="true" /> Put in chain order</button>}
                >
                    A chain lists the leaf first, then each issuer.
                </StatusBanner>
            )}
            <ol className="cert-chain">
                {certItems.map((item, i) => {
                    const cert = item.certificate
                    const role = chain.roles[i]
                    return (
                        <li key={item.index}>
                            <div className="cert-chain-item">
                                <span className="cert-chain-num" aria-hidden="true">{i + 1}</span>
                                <div className="cert-chain-body">
                                    <button type="button" className="cert-chain-title" onClick={() => onSelect(item.index)}>{certificateTitle(cert)}</button>
                                    <div className="cert-badges">
                                        {role && <span className="badge badge-primary">{ROLE_LABELS[role]}</span>}
                                        <ValidityBadge notBefore={cert.notBefore} notAfter={cert.notAfter} />
                                    </div>
                                </div>
                            </div>
                            {i < n - 1 && <LinkBadges link={chain.links[i]} signature={linkSignature(i)} />}
                            {i === n - 1 && rootSignature && (
                                <div className={`cert-link${rootSignature.status === 'invalid' ? ' is-broken' : ''}`}>
                                    <span className="badge">Self-signed</span>
                                    <SignatureBadge signature={rootSignature} />
                                </div>
                            )}
                            {i === n - 1 && !rootSignature && (
                                <div className="cert-link">Issued by {formatName(last.issuer) || 'an empty name'}, which isn’t included.</div>
                            )}
                        </li>
                    )
                })}
            </ol>
            <p className="field-hint" style={{ marginTop: 0 }}>
                This checks how the certificates link to each other: names, key IDs and signatures. It isn’t a trust decision: nothing is
                checked against a trust store, and revocation, hostnames and name constraints aren’t checked.
            </p>
        </section>
    )
}

// Everything below the input. Memoised with stable props, so typing in a big
// input doesn't re-render every card until the debounced result changes.
const Results = memo(function Results({ items, errors, orderedCerts, chain, extras, onSelect, onReorder, onClear, registerCard }) {
    const numberOf = (index) => orderedCerts.findIndex(i => i.index === index) + 1
    // Items in input order, with the certificates in chain order when reordered
    let certCursor = 0
    const displayItems = items.map(item => (item.kind === 'certificate' ? orderedCerts[certCursor++] : item))
    const summary = summarize(items)
    // Few certificates: always show how they link. Many (a CA bundle): only when most of them link up.
    const showChainCard = !!chain && (orderedCerts.length <= LARGE_BUNDLE || chain.linked * 2 >= orderedCerts.length - 1)

    return (
        <>
            <div aria-live="polite" className="cert-summary">
                {summary && <span>Found {summary}.</span>}
            </div>

            {errors.map(error => (
                <StatusBanner key={`${error.source}-${error.message}`} tone="danger" title={`Can’t read ${error.source === 'Input' ? 'the input' : error.source}`}>
                    {error.message}
                </StatusBanner>
            ))}

            {showChainCard && <ChainCard certItems={orderedCerts} chain={chain} extras={extras} onSelect={onSelect} onReorder={onReorder} />}
            {chain && !showChainCard && (
                <StatusBanner tone="info" title={`${orderedCerts.length} certificates that don’t form one chain`}>
                    {chain.linked ? `Only ${plural(chain.linked, 'certificate')} issued the one listed after it` : 'None of them issued the one listed after it'} (a CA bundle, for example), so each is shown on its own.
                </StatusBanner>
            )}

            {displayItems.map((item) => {
                const extra = extras?.[item.index]
                switch (item.kind) {
                    case 'certificate': {
                        const k = orderedCerts.indexOf(item)
                        return (
                            <CertificateCard
                                key={item.index}
                                item={item}
                                number={k + 1}
                                total={orderedCerts.length}
                                role={showChainCard && chain.related ? chain.roles[k] : null}
                                extra={extra}
                                numberOf={numberOf}
                                cardRef={(element) => registerCard(item.index, element)}
                            />
                        )
                    }
                    case 'csr':
                        return <CsrCard key={item.index} item={item} extra={extra} />
                    case 'publicKey':
                        return <PublicKeyCard key={item.index} item={item} extra={extra} />
                    case 'privateKey':
                        return <PrivateKeyCard key={item.index} item={item} onClear={onClear} />
                    case 'ecParameters':
                        return (
                            <StatusBanner key={item.index} tone="info" title={`EC parameters · ${item.source}`}>
                                Named curve {item.curve.name}{item.curve.aliases ? ` (${item.curve.aliases})` : ''}{item.curve.oid ? `, OID ${item.curve.oid}` : ''}.
                            </StatusBanner>
                        )
                    case 'bundle':
                        return <StatusBanner key={item.index} tone="info" title={item.source}>{item.message}</StatusBanner>
                    case 'error':
                        return <StatusBanner key={item.index} tone="danger" title={`Can’t read ${item.source}`}>{item.message}</StatusBanner>
                    default:
                        return <StatusBanner key={item.index} tone="info" title={`Not supported: ${item.label ?? item.source}`}>{item.message}</StatusBanner>
                }
            })}
        </>
    )
})

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const NO_ERRORS = []

export default function Certificate() {
    const toast = useToast()
    const [text, setText] = useState('')
    const [file, setFile] = useState(null) // { name, size, bytes } of a loaded file
    // Big inputs (CA bundles) take a moment to decode, so wait a little longer for typing to pause
    const debouncedText = useDebouncedValue(text, text.length > 50_000 ? 400 : 150)

    useSmartInput({
        input: (value) => {
            setFile(null)
            setText(value)
        },
    })

    const result = useMemo(() => {
        if (file) return inspect(file.bytes)
        return debouncedText.trim() ? inspect(debouncedText) : null
    }, [file, debouncedText])
    const items = useMemo(() => (result?.items ?? []).map((item, index) => ({ ...item, index })), [result])
    const errors = result?.errors ?? NO_ERRORS
    const certItems = useMemo(() => items.filter(i => i.kind === 'certificate'), [items])

    // "Put in chain order" reorders the certificates until the input changes
    const [orderState, setOrderState] = useState({ result: null, order: null })
    const order = orderState.result === result ? orderState.order : null
    const orderedCerts = useMemo(() => (order ? order.map(i => certItems[i]) : certItems), [order, certItems])
    const chain = useMemo(() => (orderedCerts.length > 1 ? analyzeChain(orderedCerts.map(i => i.certificate)) : null), [orderedCerts])

    const [extrasState, setExtrasState] = useState({ items: null, data: null })
    useEffect(() => {
        if (!items.length) return undefined
        let cancelled = false
        computeExtras(items).then((data) => {
            if (!cancelled) setExtrasState({ items, data })
        })
        return () => {
            cancelled = true
        }
    }, [items])
    const extras = extrasState.items === items ? extrasState.data : null

    const cardRefs = useRef(new Map())
    const registerCard = useCallback((index, element) => {
        if (element) cardRefs.current.set(index, element)
        else cardRefs.current.delete(index)
    }, [])
    const focusCard = useCallback((index) => {
        const element = cardRefs.current.get(index)
        if (!element) return
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        element.focus({ preventScroll: true })
    }, [])

    const reorder = useCallback((suggested) => {
        const current = order ?? certItems.map((_, i) => i)
        setOrderState({ result, order: suggested.map(k => current[k]) })
    }, [order, certItems, result])

    const clear = useCallback(() => {
        setText('')
        setFile(null)
    }, [])

    const loadFile = async ([picked]) => {
        try {
            const bytes = new Uint8Array(await picked.arrayBuffer())
            setText('')
            setFile({ name: picked.name, size: picked.size, bytes })
        } catch (error) {
            toast.error(`Couldn’t read ${picked.name}: ${error?.message || error}`)
        }
    }

    // A certificate or key file handed over by Smart Drop or "Open with"
    useIncomingFiles('/certificate', loadFile)

    useRegisterAIContext({
        tool: 'Certificate & Key Inspector',
        getContext: () => aiContext(items, errors),
        suggestedPrompts: [
            'Explain this certificate in plain words',
            'Why might this chain fail to validate?',
            'What do these extensions do?',
            'Is this key size and algorithm still safe?',
        ],
    })

    const hasInput = !!text.trim() || !!file

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card cert-input">
                <Field
                    label="Certificate, request or key"
                    labelAction={
                        <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!text && !file}>
                            <Trash2 size={14} aria-hidden="true" /> Clear
                        </button>
                    }
                    hint="PEM (one or more blocks), or Base64 or hex DER. Everything is decoded in this tab: nothing is uploaded."
                >
                    <textarea
                        value={text}
                        onChange={(event) => {
                            setFile(null)
                            setText(event.target.value)
                        }}
                        placeholder={'-----BEGIN CERTIFICATE-----\nMIIDdzCCAl+gAwIBAgIE…\n-----END CERTIFICATE-----'}
                        spellCheck={false}
                        autoComplete="off"
                        autoCapitalize="off"
                        data-1p-ignore
                        data-lpignore="true"
                        className="cert-textarea"
                    />
                </Field>
                {file && (
                    <div className="cert-file">
                        <FileText size={16} aria-hidden="true" className="cert-muted" />
                        <span className="cert-file-name">{file.name}</span>
                        <span className="cert-meta">{formatBytes(file.size)}</span>
                        <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => setFile(null)}>
                            <X size={14} aria-hidden="true" />
                        </button>
                    </div>
                )}
                <FileDropZone
                    compact
                    accept={ACCEPT}
                    maxSizeMB={MAX_INPUT_BYTES / 1024 / 1024}
                    onFiles={loadFile}
                    icon={FileBadge}
                    label="Drop a file here or click to browse"
                    hint="PEM or DER: .pem .crt .cer .der .csr .key .pub .p7b"
                />
            </section>

            {!hasInput && (
                <EmptyState icon={FileBadge} title="Nothing to inspect yet">
                    Paste a certificate, a chain, a certificate request or a key, or drop a file. Private keys are recognised but never shown.
                </EmptyState>
            )}

            <Results
                items={items}
                errors={errors}
                orderedCerts={orderedCerts}
                chain={chain}
                extras={extras}
                onSelect={focusCard}
                onReorder={reorder}
                onClear={clear}
                registerCard={registerCard}
            />
        </div>
    )
}
