import { useEffect, useId, useMemo, useState } from 'react'
import { UAParser } from 'ua-parser-js'
import { isAICrawler, isBot } from 'ua-parser-js/bot-detection'
import { Bot, Cpu, Globe, Monitor, RotateCcw, Smartphone, Trash2, UserRound } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import StatusBanner from '../components/ui/StatusBanner'
import { useSmartInput } from '../hooks/useSmartInput'

const OWN_UA = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const HINTS_AVAILABLE = typeof navigator !== 'undefined' && Boolean(navigator.userAgentData)

const EXAMPLES = [
    { label: 'iPhone', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
    { label: 'Android', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' },
    { label: 'Windows Firefox', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0' },
    { label: 'Googlebot', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    { label: 'curl', ua: 'curl/8.7.1' },
]

const DEVICE_TYPES = { mobile: 'Mobile', tablet: 'Tablet', smarttv: 'Smart TV', console: 'Game console', wearable: 'Wearable', xr: 'XR headset', embedded: 'Embedded' }
const DESKTOP_OS = /^(windows|mac ?os|macos|linux|ubuntu|debian|fedora|chrom(e|ium) ?os|freebsd|openbsd|netbsd|solaris|mint|arch|gentoo|red ?hat|suse|centos|mandriva|slackware|unix)/i

// Plain object with only the fields shown (the library's result has methods)
function summarize(result, ua) {
    const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj?.[k] || null]))
    return {
        ua,
        browser: pick(result.browser, ['name', 'version', 'major', 'type']),
        engine: pick(result.engine, ['name', 'version']),
        os: pick(result.os, ['name', 'version']),
        device: pick(result.device, ['type', 'vendor', 'model']),
        cpu: pick(result.cpu, ['architecture']),
        bot: isBot(ua),
        aiCrawler: isAICrawler(ua),
    }
}

function deviceKind(info) {
    if (info.device.type) return { label: DEVICE_TYPES[info.device.type] ?? info.device.type, inferred: false }
    if (!info.bot && info.os.name && DESKTOP_OS.test(info.os.name)) return { label: 'Desktop', inferred: true }
    return { label: null, inferred: false }
}

function Value({ value }) {
    return value
        ? <span style={{ fontWeight: 500, color: 'var(--text-main)', overflowWrap: 'anywhere', textAlign: 'right' }}>{value}</span>
        : <span style={{ color: 'var(--text-dim)' }}>Unknown</span>
}

function Card({ icon: Icon, color, title, children }) {
    return (
        <section className="card card-compact" aria-label={title}>
            <h2 className="section-title" style={{ marginBottom: 'var(--space-sm)', paddingBottom: 'var(--space-sm)', borderBottom: '1px solid var(--border)' }}>
                <Icon size={18} aria-hidden="true" style={{ color }} /> {title}
            </h2>
            <dl style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</dl>
        </section>
    )
}

function Row({ label, value, hint }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-sm)', fontSize: '0.9rem' }}>
            <dt style={{ color: 'var(--text-muted)' }}>{label}</dt>
            <dd style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', minWidth: 0 }}>
                <Value value={value} />
                {hint && <span className="field-hint" style={{ marginTop: 0, textAlign: 'right' }}>{hint}</span>}
            </dd>
        </div>
    )
}

export default function UserAgent() {
    const inputId = useId()
    const hintsId = useId()
    const [ua, setUa] = useState(OWN_UA)
    const [useHints, setUseHints] = useState(true)
    const [hinted, setHinted] = useState(null) // { ua, info } from client hints
    useSmartInput({ input: setUa })

    const text = ua.trim()
    const isOwn = text !== '' && text === OWN_UA.trim()
    const canUseHints = isOwn && HINTS_AVAILABLE

    const parsed = useMemo(() => (text ? summarize(new UAParser(text).getResult(), text) : null), [text])

    // Chromium freezes parts of its UA string; client hints give the real values
    useEffect(() => {
        if (!canUseHints || !useHints) return undefined
        let cancelled = false
        Promise.resolve(new UAParser(text).getResult().withClientHints())
            .then(result => {
                if (!cancelled) setHinted({ ua: text, info: summarize(result, text) })
            })
            .catch(() => {})
        return () => {
            cancelled = true
        }
    }, [canUseHints, useHints, text])

    const fromHints = canUseHints && useHints && hinted?.ua === text
    const info = fromHints ? hinted.info : parsed
    const device = info ? deviceKind(info) : null
    const recognised = info && (info.browser.name || info.os.name || info.engine.name || info.device.type || info.device.model)

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card card-compact">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-xs)' }}>
                    <label htmlFor={inputId} className="field-label" style={{ marginBottom: 0 }}>User-agent string</label>
                    <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                        <CopyButton text={text} label="Copy string" />
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setUa('')} disabled={!ua}>
                            <Trash2 size={14} aria-hidden="true" /> Clear
                        </button>
                    </div>
                </div>
                <textarea
                    id={inputId}
                    value={ua}
                    onChange={e => setUa(e.target.value)}
                    placeholder="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …"
                    spellCheck={false}
                    rows={3}
                    style={{ minHeight: 0 }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 'var(--space-sm)' }}>
                    <button type="button" className="btn btn-sm btn-outline" onClick={() => setUa(OWN_UA)} disabled={isOwn}>
                        <RotateCcw size={14} aria-hidden="true" /> Use my browser's UA
                    </button>
                    <span className="field-hint" style={{ marginTop: 0, marginLeft: 'var(--space-xs)' }}>Examples:</span>
                    {EXAMPLES.map(ex => (
                        <button key={ex.label} type="button" className={`chip ${text === ex.ua ? 'is-active' : ''}`} aria-pressed={text === ex.ua} onClick={() => setUa(ex.ua)}>
                            {ex.label}
                        </button>
                    ))}
                </div>
                {canUseHints && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
                        <input id={hintsId} type="checkbox" checked={useHints} onChange={e => setUseHints(e.target.checked)} style={{ marginTop: 3 }} />
                        <label htmlFor={hintsId} style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Use client hints for this browser. Chromium reports a frozen user-agent string (for example macOS 10.15.7 or Windows 10); client hints report the real platform version and architecture.
                        </label>
                    </div>
                )}
            </section>

            {!info && (
                <div className="card">
                    <EmptyState icon={UserRound} title="Paste a user-agent string">
                        Or pick an example above, or use your own browser's string.
                    </EmptyState>
                </div>
            )}

            {info && (
                <>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {isOwn && <span className="badge badge-primary">Your browser</span>}
                            {fromHints && <span className="badge badge-info">Client hints applied</span>}
                            {info.bot && <span className="badge badge-warning"><Bot size={12} aria-hidden="true" /> {info.aiCrawler ? 'AI crawler' : 'Bot or tool'}</span>}
                        </div>
                        <CopyButton text={() => JSON.stringify(info, null, 2)} label="Copy as JSON" variant="secondary" />
                    </div>

                    {info.bot && (
                        <StatusBanner tone="info" title={info.aiCrawler ? 'This is an AI crawler' : 'This looks like a bot, crawler or command-line tool'}>
                            Automated clients usually don't describe a browser, OS or device, so most fields stay unknown.
                        </StatusBanner>
                    )}
                    {!recognised && !info.bot && (
                        <StatusBanner tone="warning" title="Nothing recognised">
                            No browser, engine, OS or device was found. The string may be truncated, or not a user-agent string.
                        </StatusBanner>
                    )}

                    <div className="auto-grid" style={{ '--auto-grid-min': '220px' }}>
                        <Card icon={Globe} color="var(--info)" title="Browser">
                            <Row label="Name" value={info.browser.name} />
                            <Row label="Version" value={info.browser.version} />
                            <Row label="Major" value={info.browser.major} />
                            {info.browser.type && <Row label="Type" value={info.browser.type} />}
                        </Card>
                        <Card icon={Monitor} color="var(--primary-text)" title="Operating system">
                            <Row label="Name" value={info.os.name} />
                            <Row label="Version" value={info.os.version} />
                        </Card>
                        <Card icon={Cpu} color="var(--accent-text)" title="Engine">
                            <Row label="Name" value={info.engine.name} />
                            <Row label="Version" value={info.engine.version} />
                        </Card>
                        <Card icon={Smartphone} color="var(--success)" title="Device">
                            <Row label="Type" value={device.label} hint={device.inferred ? 'Inferred from the OS' : undefined} />
                            <Row label="Vendor" value={info.device.vendor} />
                            <Row label="Model" value={info.device.model} />
                            <Row label="CPU" value={info.cpu.architecture} />
                        </Card>
                    </div>
                </>
            )}
        </div>
    )
}
