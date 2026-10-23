import { useId, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Search, SearchX } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import { usePane } from '../contexts/pane'
import { STATUS_CATEGORIES, STATUS_CODES, specUrl } from '../utils/httpStatus'

const CATEGORY = Object.fromEntries(STATUS_CATEGORIES.map(c => [c.id, c]))

function matches(status, query) {
    if (!query) return true
    if (/^[1-5]xx$/.test(query)) return status.cat === query
    return String(status.code).includes(query)
        || status.text.toLowerCase().includes(query)
        || status.desc.toLowerCase().includes(query)
        || status.spec.toLowerCase().includes(query)
}

function StatusRow({ status, expanded, onToggle, compact, last }) {
    const id = useId()
    const cat = CATEGORY[status.cat]
    const url = specUrl(status.spec)
    const label = `${status.code} ${status.text}`

    return (
        <li style={{ borderLeft: `3px solid ${cat.color}`, borderBottom: last ? 'none' : '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)', padding: '0 var(--space-sm) 0 0' }}>
                <button
                    type="button"
                    className="btn btn-ghost"
                    aria-expanded={expanded}
                    aria-controls={`${id}-details`}
                    onClick={onToggle}
                    style={{
                        flex: 1,
                        minWidth: 0,
                        justifyContent: 'flex-start',
                        whiteSpace: 'normal',
                        textAlign: 'left',
                        borderRadius: 0,
                        padding: '0.75rem var(--space-md)',
                        gap: 'var(--space-md)',
                        color: 'var(--text-main)',
                    }}
                >
                    <span className="mono" style={{ color: cat.color, fontSize: '1.1rem', fontWeight: 700, minWidth: '3ch' }}>{status.code}</span>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: '0.95rem' }}>{status.text}</span>
                    {!compact && (
                        <span className="badge" style={{ background: cat.bg, color: cat.color, borderColor: cat.border }}>{cat.label}</span>
                    )}
                    <ChevronDown
                        size={16}
                        aria-hidden="true"
                        style={{ flexShrink: 0, color: 'var(--text-dim)', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
                    />
                </button>
                <CopyButton iconOnly text={label} label={`Copy “${label}”`} />
            </div>
            <div
                id={`${id}-details`}
                hidden={!expanded}
                style={{ padding: '0 var(--space-md) var(--space-md) calc(var(--space-md) + 3ch + var(--space-md))', fontSize: '0.9rem', color: 'var(--text-muted)' }}
            >
                <p style={{ maxWidth: '70ch' }}>{status.desc}</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)', fontSize: '0.8rem' }}>
                    {compact && <span className="badge" style={{ background: cat.bg, color: cat.color, borderColor: cat.border }}>{cat.label}</span>}
                    {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {status.spec} <ExternalLink size={12} aria-hidden="true" />
                            <span className="sr-only">(opens in a new tab)</span>
                        </a>
                    ) : (
                        <span>{status.spec}</span>
                    )}
                    <CopyButton text={String(status.code)} label="Copy code" />
                </div>
            </div>
        </li>
    )
}

export default function HttpStatus() {
    const searchId = useId()
    const { size } = usePane()
    const [search, setSearch] = useState('')
    const [category, setCategory] = useState('all')
    const [expanded, setExpanded] = useState(() => new Set())

    const query = search.trim().toLowerCase()
    const filtered = useMemo(
        () => STATUS_CODES.filter(s => (category === 'all' || s.cat === category) && matches(s, query)),
        [category, query]
    )

    const toggle = (code) => setExpanded(prev => {
        const next = new Set(prev)
        if (next.has(code)) next.delete(code)
        else next.add(code)
        return next
    })

    const chip = (value, label, color) => (
        <button
            key={value}
            type="button"
            className={`chip ${category === value ? 'is-active' : ''}`}
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
        >
            {color && <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />}
            {label}
        </button>
    )

    return (
        <div className="page page-medium">
            <ToolHeader />

            <section className="card card-compact" aria-label="Search and filter">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-md)', alignItems: 'center' }}>
                    <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 0 }}>
                        <label htmlFor={searchId} className="sr-only">Search status codes</label>
                        <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                        <input
                            id={searchId}
                            type="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search by code, name or description…"
                            autoComplete="off"
                            style={{ padding: '0.6rem 0.75rem 0.6rem 2.25rem', fontSize: '0.9rem' }}
                        />
                    </div>
                    <div role="group" aria-label="Filter by class" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {chip('all', 'All')}
                        {STATUS_CATEGORIES.map(c => chip(c.id, size === 'sm' ? c.id : `${c.id} ${c.label}`, c.color))}
                    </div>
                </div>
                <div className="field-hint" role="status" style={{ marginTop: 'var(--space-sm)' }}>
                    Showing {filtered.length} of {STATUS_CODES.length} status codes
                </div>
            </section>

            {filtered.length > 0 ? (
                <ul className="card" style={{ listStyle: 'none', padding: 0, overflow: 'hidden' }}>
                    {filtered.map((s, i) => (
                        <StatusRow
                            key={s.code}
                            status={s}
                            expanded={expanded.has(s.code)}
                            onToggle={() => toggle(s.code)}
                            compact={size === 'sm'}
                            last={i === filtered.length - 1}
                        />
                    ))}
                </ul>
            ) : (
                <div className="card">
                    <EmptyState icon={SearchX} title="No matching status codes">
                        Nothing matches “{search.trim()}”{category !== 'all' ? ` in ${category}` : ''}.{' '}
                        <button type="button" className="btn btn-sm btn-outline" onClick={() => { setSearch(''); setCategory('all') }} style={{ marginTop: 'var(--space-sm)' }}>
                            Clear filters
                        </button>
                    </EmptyState>
                </div>
            )}
        </div>
    )
}
