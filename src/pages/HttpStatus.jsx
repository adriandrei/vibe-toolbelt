import React, { useState, useMemo } from 'react'
import { Globe, Search, Copy, Check, Info } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const STATUS_CODES = [
    // 1xx
    { code: 100, text: 'Continue', desc: 'Server has received the request headers; client should proceed to send the body.', cat: '1xx' },
    { code: 101, text: 'Switching Protocols', desc: 'Server is switching protocols as requested by client.', cat: '1xx' },
    { code: 102, text: 'Processing', desc: 'Server has received and is processing the request, but no response is available yet.', cat: '1xx' },
    { code: 103, text: 'Early Hints', desc: 'Used to return some response headers before final HTTP message.', cat: '1xx' },
    // 2xx
    { code: 200, text: 'OK', desc: 'Standard response for successful requests.', cat: '2xx' },
    { code: 201, text: 'Created', desc: 'Request fulfilled and a new resource has been created.', cat: '2xx' },
    { code: 202, text: 'Accepted', desc: 'Request accepted for processing, but processing is not complete.', cat: '2xx' },
    { code: 203, text: 'Non-Authoritative Information', desc: 'Request processed, but response may be from another source.', cat: '2xx' },
    { code: 204, text: 'No Content', desc: 'Request processed successfully but no content to return.', cat: '2xx' },
    { code: 206, text: 'Partial Content', desc: 'Server delivering only part of the resource due to a range header.', cat: '2xx' },
    { code: 207, text: 'Multi-Status', desc: 'Provides status for multiple independent operations (WebDAV).', cat: '2xx' },
    // 3xx
    { code: 301, text: 'Moved Permanently', desc: 'Resource has been permanently moved to a new URI.', cat: '3xx' },
    { code: 302, text: 'Found', desc: 'Resource temporarily resides under a different URI.', cat: '3xx' },
    { code: 303, text: 'See Other', desc: 'Response can be found under a different URI using GET.', cat: '3xx' },
    { code: 304, text: 'Not Modified', desc: 'Resource has not been modified since the last request.', cat: '3xx' },
    { code: 307, text: 'Temporary Redirect', desc: 'Resource temporarily moved; request method must not change.', cat: '3xx' },
    { code: 308, text: 'Permanent Redirect', desc: 'Resource permanently moved; request method must not change.', cat: '3xx' },
    // 4xx
    { code: 400, text: 'Bad Request', desc: 'Server cannot process the request due to client error (malformed syntax, etc).', cat: '4xx' },
    { code: 401, text: 'Unauthorized', desc: 'Authentication is required and has failed or not been provided.', cat: '4xx' },
    { code: 402, text: 'Payment Required', desc: 'Reserved for future use. Some APIs use this for rate limiting.', cat: '4xx' },
    { code: 403, text: 'Forbidden', desc: 'Server understood the request but refuses to authorize it.', cat: '4xx' },
    { code: 404, text: 'Not Found', desc: 'Requested resource could not be found on the server.', cat: '4xx' },
    { code: 405, text: 'Method Not Allowed', desc: 'Request method is not supported for the requested resource.', cat: '4xx' },
    { code: 406, text: 'Not Acceptable', desc: 'Server cannot produce a response matching the Accept headers.', cat: '4xx' },
    { code: 407, text: 'Proxy Authentication Required', desc: 'Client must first authenticate with the proxy.', cat: '4xx' },
    { code: 408, text: 'Request Timeout', desc: 'Server timed out waiting for the request.', cat: '4xx' },
    { code: 409, text: 'Conflict', desc: 'Request conflicts with the current state of the server.', cat: '4xx' },
    { code: 410, text: 'Gone', desc: 'Resource is no longer available and no forwarding address is known.', cat: '4xx' },
    { code: 411, text: 'Length Required', desc: 'Server refuses request without a defined Content-Length.', cat: '4xx' },
    { code: 412, text: 'Precondition Failed', desc: 'One or more conditions in the request header failed.', cat: '4xx' },
    { code: 413, text: 'Payload Too Large', desc: 'Request entity is larger than the server is willing to process.', cat: '4xx' },
    { code: 414, text: 'URI Too Long', desc: 'Request URI is too long for the server to process.', cat: '4xx' },
    { code: 415, text: 'Unsupported Media Type', desc: 'Media type of the request data is not supported.', cat: '4xx' },
    { code: 418, text: "I'm a Teapot", desc: 'Server refuses to brew coffee because it is a teapot (RFC 2324). 🍵', cat: '4xx' },
    { code: 422, text: 'Unprocessable Entity', desc: 'Request is well-formed but unable to be processed (WebDAV).', cat: '4xx' },
    { code: 425, text: 'Too Early', desc: 'Server is unwilling to risk processing a request that might be replayed.', cat: '4xx' },
    { code: 429, text: 'Too Many Requests', desc: 'User has sent too many requests in a given time (rate limiting).', cat: '4xx' },
    { code: 451, text: 'Unavailable For Legal Reasons', desc: 'Resource is unavailable due to legal demands.', cat: '4xx' },
    // 5xx
    { code: 500, text: 'Internal Server Error', desc: 'Generic error when an unexpected condition was encountered.', cat: '5xx' },
    { code: 501, text: 'Not Implemented', desc: 'Server does not support the functionality required.', cat: '5xx' },
    { code: 502, text: 'Bad Gateway', desc: 'Server acting as a gateway received an invalid response from upstream.', cat: '5xx' },
    { code: 503, text: 'Service Unavailable', desc: 'Server is currently unable to handle the request (overloaded or down).', cat: '5xx' },
    { code: 504, text: 'Gateway Timeout', desc: 'Server acting as a gateway did not receive a timely response.', cat: '5xx' },
    { code: 505, text: 'HTTP Version Not Supported', desc: 'Server does not support the HTTP version used in the request.', cat: '5xx' },
    { code: 507, text: 'Insufficient Storage', desc: 'Server is unable to store the representation needed (WebDAV).', cat: '5xx' },
    { code: 511, text: 'Network Authentication Required', desc: 'Client needs to authenticate to gain network access (captive portals).', cat: '5xx' },
]

const CATEGORIES = {
    '1xx': { label: 'Informational', color: '#818cf8', bg: 'rgba(129,140,248,0.1)' },
    '2xx': { label: 'Success', color: '#22c55e', bg: 'rgba(34,197,94,0.1)' },
    '3xx': { label: 'Redirection', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    '4xx': { label: 'Client Error', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
    '5xx': { label: 'Server Error', color: '#f97316', bg: 'rgba(249,115,22,0.1)' },
}

export default function HttpStatus() {
    useDocumentTitle('HTTP Status Codes')
    const [search, setSearch] = useState('')
    const [filterCat, setFilterCat] = useState('all')
    const [expanded, setExpanded] = useState(null)
    const [copied, setCopied] = useState(null)

    const filtered = useMemo(() => {
        return STATUS_CODES.filter(s => {
            const q = search.toLowerCase()
            const matchSearch = !q || s.code.toString().includes(q) || s.text.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)
            const matchCat = filterCat === 'all' || s.cat === filterCat
            return matchSearch && matchCat
        })
    }, [search, filterCat])

    const copy = (text, key) => {
        navigator.clipboard.writeText(text)
        setCopied(key)
        setTimeout(() => setCopied(null), 2000)
    }

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 className="text-gradient" style={{ fontSize: '2rem' }}>HTTP Status Codes</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 'var(--space-sm)' }}>
                    Searchable reference of all HTTP status codes
                </p>
            </div>

            {/* Search + Filter */}
            <div className="glass-panel" style={{ padding: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                        <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                        <input
                            type="text" value={search} onChange={e => setSearch(e.target.value)}
                            placeholder="Search by code, name, or description..."
                            style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: '0.9rem' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button onClick={() => setFilterCat('all')} style={{
                            padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
                            background: filterCat === 'all' ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                            border: filterCat === 'all' ? '1px solid var(--primary)' : '1px solid var(--border)',
                            color: filterCat === 'all' ? 'var(--primary)' : 'var(--text-muted)', cursor: 'pointer'
                        }}>All</button>
                        {Object.entries(CATEGORIES).map(([cat, info]) => (
                            <button key={cat} onClick={() => setFilterCat(cat)} style={{
                                padding: '6px 14px', borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
                                background: filterCat === cat ? info.bg : 'rgba(255,255,255,0.03)',
                                border: filterCat === cat ? `1px solid ${info.color}` : '1px solid var(--border)',
                                color: filterCat === cat ? info.color : 'var(--text-muted)', cursor: 'pointer'
                            }}>{cat}</button>
                        ))}
                    </div>
                </div>
                <div style={{ marginTop: 'var(--space-sm)', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                    Showing {filtered.length} of {STATUS_CODES.length} status codes
                </div>
            </div>

            {/* Status Code List */}
            <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
                {filtered.map(s => {
                    const catInfo = CATEGORIES[s.cat]
                    const isExpanded = expanded === s.code
                    return (
                        <button
                            key={s.code}
                            onClick={() => setExpanded(isExpanded ? null : s.code)}
                            className="glass-panel"
                            style={{
                                padding: '14px var(--space-md)',
                                textAlign: 'left', cursor: 'pointer',
                                borderLeft: `3px solid ${catInfo.color}`,
                                transition: 'all 0.2s', width: '100%'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                                <span style={{
                                    fontFamily: 'var(--font-mono)', fontSize: '1.2rem', fontWeight: 700,
                                    color: catInfo.color, minWidth: 50
                                }}>
                                    {s.code}
                                </span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{s.text}</div>
                                    {isExpanded && (
                                        <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                                            {s.desc}
                                        </div>
                                    )}
                                </div>
                                <span style={{
                                    padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                                    background: catInfo.bg, color: catInfo.color,
                                    fontSize: '0.7rem', fontWeight: 600
                                }}>
                                    {catInfo.label}
                                </span>
                                <button
                                    onClick={e => { e.stopPropagation(); copy(`${s.code} ${s.text}`, s.code) }}
                                    style={{ color: copied === s.code ? 'var(--accent)' : 'var(--text-dim)', padding: 4 }}
                                    title="Copy code + name"
                                >
                                    {copied === s.code ? <Check size={14} /> : <Copy size={14} />}
                                </button>
                            </div>
                        </button>
                    )
                })}
            </div>

            {filtered.length === 0 && (
                <div className="glass-panel" style={{ padding: 'var(--space-xl)', textAlign: 'center', color: 'var(--text-dim)' }}>
                    <Globe size={40} style={{ marginBottom: 'var(--space-md)', opacity: 0.3 }} />
                    <div>No status codes match your search</div>
                </div>
            )}
        </div>
    )
}
