import { useId, useMemo, useState } from 'react'
import { Address4, Address6 } from 'ip-address'
import { Network, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import StatusBanner from '../components/ui/StatusBanner'
import { useSmartInput } from '../hooks/useSmartInput'

const EXAMPLES = ['10.0.0.0/16', '192.168.1.10/24', '10.0.0.0/31', '203.0.113.7', '2001:db8::/32', 'fe80::1/64']

const ALL_ONES_32 = (1n << 32n) - 1n

const fmt = (n) => n.toLocaleString()

// Special-purpose IPv4 ranges (RFC 6890 and friends), most specific first
const V4_RANGES = [
    ['255.255.255.255/32', 'Limited broadcast'],
    ['0.0.0.0/8', '"This network" (RFC 791)'],
    ['10.0.0.0/8', 'Private (RFC 1918)'],
    ['100.64.0.0/10', 'Shared address space / CGNAT (RFC 6598)'],
    ['127.0.0.0/8', 'Loopback'],
    ['169.254.0.0/16', 'Link-local'],
    ['172.16.0.0/12', 'Private (RFC 1918)'],
    ['192.0.0.0/24', 'IETF protocol assignments'],
    ['192.0.2.0/24', 'Documentation (TEST-NET-1)'],
    ['192.88.99.0/24', 'Deprecated 6to4 relay anycast'],
    ['192.168.0.0/16', 'Private (RFC 1918)'],
    ['198.18.0.0/15', 'Benchmarking (RFC 2544)'],
    ['198.51.100.0/24', 'Documentation (TEST-NET-2)'],
    ['203.0.113.0/24', 'Documentation (TEST-NET-3)'],
    ['224.0.0.0/4', 'Multicast'],
    ['240.0.0.0/4', 'Reserved (class E)'],
].map(([cidr, label]) => [new Address4(cidr), label])

function v4Type(address) {
    const hit = V4_RANGES.find(([range]) => address.isInSubnet(range))
    return hit ? hit[1] : 'Public'
}

// 255.255.255.0 → 24; null if the 1 bits aren't contiguous
function maskToPrefix(mask) {
    if (!Address4.isValid(mask)) return null
    const value = new Address4(mask).bigInt()
    const bits = value.toString(2).padStart(32, '0')
    if (!/^1*0*$/.test(bits)) return null
    const firstZero = bits.indexOf('0')
    return firstZero === -1 ? 32 : firstZero
}

function explain(text) {
    const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\/(\d+))?$/.exec(text)
    if (v4) {
        const bad = v4.slice(1, 5).find(part => Number(part) > 255)
        if (bad !== undefined) return `Each part of an IPv4 address must be 0–255; ${bad} is too large.`
        if (v4[5] !== undefined && Number(v4[5]) > 32) return `An IPv4 prefix length must be 0–32, not /${v4[5]}.`
        return 'This isn\'t a valid IPv4 address.'
    }
    if (/^\d+(\.\d+){0,2}(\/\d+)?$/.test(text)) return 'An IPv4 address has four parts, as in 192.168.0.1.'
    if (text.includes(':')) {
        const prefix = /\/(\d+)$/.exec(text)
        if (prefix && Number(prefix[1]) > 128) return `An IPv6 prefix length must be 0–128, not /${prefix[1]}.`
        return 'This isn\'t a valid IPv6 address. Groups are up to four hex digits, and :: may appear only once.'
    }
    return 'Enter an IPv4 or IPv6 address, with an optional prefix length, for example 10.0.0.0/16 or 2001:db8::/32.'
}

function describe4(addr, bare) {
    const prefix = addr.subnetMask
    const hostBits = BigInt(32 - prefix)
    const total = 1n << hostBits
    const start = addr.startAddress().correctForm()
    const end = addr.endAddress().correctForm()
    const ip = addr.addressMinusSuffix
    const rows = [
        { label: 'Address', value: ip },
        { label: 'Network (CIDR)', value: `${start}/${prefix}` },
        { label: 'Netmask', value: Address4.fromBigInt(ALL_ONES_32 ^ (total - 1n)).correctForm() },
        { label: 'Wildcard mask', value: Address4.fromBigInt(total - 1n).correctForm() },
        { label: 'Network address', value: start },
    ]
    if (prefix === 32) {
        rows.push({ label: 'Broadcast', value: null, note: 'None: a /32 is a single host' })
        rows.push({ label: 'Usable hosts', value: ip, note: '1 address' })
    } else if (prefix === 31) {
        rows.push({ label: 'Broadcast', value: null, note: 'None: a /31 is a point-to-point link (RFC 3021)' })
        rows.push({ label: 'Usable hosts', value: `${start} – ${end}`, note: 'Both addresses (RFC 3021)' })
    } else {
        rows.push({ label: 'Broadcast', value: end })
        rows.push({ label: 'Usable hosts', value: `${addr.startAddressExclusive().correctForm()} – ${addr.endAddressExclusive().correctForm()}` })
    }
    const usable = prefix >= 31 ? total : total - 2n
    rows.push({ label: 'Usable host count', value: fmt(usable), note: prefix < 31 ? 'Excludes the network and broadcast addresses' : undefined })
    rows.push({ label: 'Total addresses', value: fmt(total) })
    rows.push({ label: 'Address type', value: v4Type(new Address4(ip)), copy: false })
    return {
        version: 4,
        prefix,
        bits: 32,
        cidr: `${start}/${prefix}`,
        rows,
        hint: bare ? 'No prefix length was given, so this is treated as a single address (/32).' : ip !== start ? `${ip} is a host inside the network ${start}/${prefix}.` : null,
    }
}

function describe6(addr, bare) {
    const prefix = addr.subnetMask
    const total = 1n << BigInt(128 - prefix)
    const start = addr.startAddress().correctForm()
    const end = addr.endAddress().correctForm()
    const ip = addr.correctForm()
    const rows = [
        { label: 'Address', value: ip + (addr.zone || '') },
        { label: 'Expanded', value: addr.canonicalForm() },
        { label: 'Network (CIDR)', value: `${start}/${prefix}` },
        { label: 'First address', value: start },
        { label: 'Last address', value: end },
    ]
    rows.push({
        label: 'Total addresses',
        value: fmt(total),
        note: prefix === 128 ? 'A single address' : prefix === 127 ? 'Point-to-point link (RFC 6164)' : `2^${128 - prefix}; IPv6 has no broadcast address, so all are usable`,
    })
    if (addr.is4() && addr.address4) rows.push({ label: 'Embedded IPv4', value: addr.address4.correctForm() })
    rows.push({ label: 'Address type', value: addr.getType(), copy: false })
    return {
        version: 6,
        prefix,
        bits: 128,
        cidr: `${start}/${prefix}`,
        rows,
        hint: bare ? 'No prefix length was given, so this is treated as a single address (/128).' : ip !== start ? `${ip} is inside the network ${start}/${prefix}.` : null,
    }
}

function analyze(raw) {
    const text = raw.trim()
    if (!text) return null
    let input = text
    // 192.168.1.0/255.255.255.0 or "192.168.1.0 255.255.255.0"
    const dotted = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\s*\/\s*|\s+)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
    if (dotted) {
        const prefix = maskToPrefix(dotted[2])
        if (prefix === null) return { error: `${dotted[2]} isn't a valid netmask: its 1 bits must be contiguous, as in 255.255.255.0.` }
        input = `${dotted[1]}/${prefix}`
    }
    const bare = !input.includes('/')
    try {
        if (Address4.isValid(input)) return describe4(new Address4(input), bare)
        if (Address6.isValid(input)) return describe6(new Address6(input), bare)
    } catch {
        // fall through to the explanation
    }
    return { error: explain(input) }
}

function ResultRow({ label, value, note, copy = true }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(7.5rem, max-content) minmax(0, 1fr) auto', alignItems: 'start', gap: 'var(--space-sm)', padding: '0.6rem var(--space-md)', borderBottom: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', paddingTop: 2 }}>{label}</span>
            <div style={{ minWidth: 0 }}>
                {value !== null && <div className={copy ? 'mono' : undefined} style={{ fontSize: '0.9rem', color: 'var(--text-main)', overflowWrap: 'anywhere' }}>{value}</div>}
                {note && <div style={{ fontSize: '0.8rem', color: value === null ? 'var(--text-muted)' : 'var(--text-dim)' }}>{note}</div>}
            </div>
            {copy && value !== null ? <CopyButton iconOnly text={value} label={`Copy ${label.toLowerCase()}`} /> : <span aria-hidden="true" style={{ width: '1.6rem' }} />}
        </div>
    )
}

function PrefixBar({ prefix, bits }) {
    const pct = (prefix / bits) * 100
    return (
        <div>
            <div
                role="img"
                aria-label={`${prefix} network bit${prefix === 1 ? '' : 's'} and ${bits - prefix} host bit${bits - prefix === 1 ? '' : 's'}`}
                style={{ display: 'flex', height: 10, borderRadius: 'var(--radius-full)', overflow: 'hidden', background: 'var(--bg-subtle)', border: '1px solid var(--border)' }}
            >
                <div style={{ width: `${pct}%`, background: 'var(--primary)' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', fontSize: '0.8rem', color: 'var(--text-dim)', marginTop: 4 }}>
                <span><span style={{ color: 'var(--primary-text)', fontWeight: 600 }}>{prefix}</span> network bit{prefix === 1 ? '' : 's'}</span>
                <span><span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{bits - prefix}</span> host bit{bits - prefix === 1 ? '' : 's'}</span>
            </div>
        </div>
    )
}

export default function CidrCalculator() {
    const inputId = useId()
    const [input, setInput] = useState('')
    useSmartInput({ input: setInput })

    const result = useMemo(() => analyze(input), [input])
    const error = result?.error

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card card-compact">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', marginBottom: 'var(--space-xs)' }}>
                    <label htmlFor={inputId} className="field-label" style={{ marginBottom: 0 }}>IP address or CIDR block</label>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setInput('')} disabled={!input}>
                        <Trash2 size={14} aria-hidden="true" /> Clear
                    </button>
                </div>
                <input
                    id={inputId}
                    type="text"
                    placeholder="e.g. 10.0.0.0/16"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={Boolean(error)}
                    aria-describedby={`${inputId}-hint`}
                    className={error ? 'field-invalid' : ''}
                    style={{ fontFamily: 'var(--font-mono)' }}
                />
                <div id={`${inputId}-hint`} className={error ? 'field-error' : 'field-hint'} role={error ? 'alert' : undefined}>
                    {error || 'IPv4 or IPv6, with an optional /prefix. A dotted netmask (10.0.0.0/255.255.0.0) works too.'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 'var(--space-sm)' }}>
                    <span className="field-hint" style={{ marginTop: 0 }}>Examples:</span>
                    {EXAMPLES.map(ex => (
                        <button key={ex} type="button" className={`chip mono ${input.trim() === ex ? 'is-active' : ''}`} aria-pressed={input.trim() === ex} onClick={() => setInput(ex)}>
                            {ex}
                        </button>
                    ))}
                </div>
            </section>

            {!result && (
                <div className="card">
                    <EmptyState icon={Network} title="Enter an address or block">
                        Get the network and broadcast addresses, netmask, usable host range and counts.
                    </EmptyState>
                </div>
            )}

            {result && !error && (
                <section className="card" style={{ padding: 0, overflow: 'hidden' }} aria-label="Network details">
                    <div style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                            <h2 className="section-title">
                                <span className="mono" style={{ overflowWrap: 'anywhere' }}>{result.cidr}</span>
                            </h2>
                            <span className="badge badge-primary">IPv{result.version}</span>
                        </div>
                        <PrefixBar prefix={result.prefix} bits={result.bits} />
                        {result.hint && <StatusBanner tone="info">{result.hint}</StatusBanner>}
                    </div>
                    <div style={{ borderTop: '1px solid var(--border)' }}>
                        {result.rows.map(row => <ResultRow key={row.label} {...row} />)}
                    </div>
                </section>
            )}
        </div>
    )
}
