import { useMemo } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, FileText, House, Search, SearchX, Shield } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { ALL_TOOLS, getTool, searchTools } from '../config/tools'
import { isMacPlatform, openCommandPalette } from '../utils/palette'

// Pages that aren't in the tool registry but are worth suggesting
const STATIC_PAGES = [
    { path: '/privacy', label: 'Privacy policy', title: 'Privacy Policy', icon: Shield, description: 'What the app stores on your device and sends over the network.', keywords: 'privacy policy data gdpr' },
    { path: '/terms', label: 'Terms of use', title: 'Terms of Use', icon: FileText, description: 'The terms for using the app and its AI assistant.', keywords: 'terms service conditions legal' },
]

const CANDIDATES = [...ALL_TOOLS.filter(tool => tool.path !== '/'), ...STATIC_PAGES]

// Shown when nothing resembles the missing path
const STARTING_POINTS = ['/inspect', '/formatters', '/jwt', '/base64'].map(getTool).filter(Boolean)

function editDistance(a, b) {
    if (a === b) return 0
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let diagonal = row[0]
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const above = row[j]
            row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
            diagonal = above
        }
    }
    return row[b.length]
}

// Tools whose names or paths are close to the words in the missing path,
// e.g. /jwt-decode -> JWT Decoder, /crn -> Cron Parser, /api -> API Tester.
function suggestionsFor(pathname) {
    let raw = pathname
    try {
        raw = decodeURIComponent(pathname)
    } catch {
        // malformed escape sequence: use the path as it is
    }
    const slug = raw.toLowerCase().replace(/^\/+|\/+$/g, '')
    const words = slug.split(/[^a-z0-9]+/).filter(word => word.length >= 2)
    if (!words.length) return []

    const scores = new Map()
    const add = (tool, points) => scores.set(tool.path, { tool, score: (scores.get(tool.path)?.score ?? 0) + points })

    // The registry's own search, on the whole phrase and on each word (3+ letters)
    const queries = new Set([words.join(' '), ...words].filter(query => query.length >= 3))
    for (const query of queries) {
        searchTools(query, CANDIDATES).slice(0, 4).forEach((tool, rank) => add(tool, 4 - rank))
    }

    // Typos: compare each word with the words of each tool's path and label
    const phrase = words.join('-')
    for (const tool of CANDIDATES) {
        const path = tool.path.slice(1)
        const targets = new Set([path, ...path.split(/[^a-z0-9]+/), ...tool.label.toLowerCase().split(/[^a-z0-9]+/)].filter(t => t.length >= 2))
        let best = 0
        for (const word of new Set([phrase, ...words])) {
            for (const target of targets) {
                const similarity = 1 - editDistance(word, target) / Math.max(word.length, target.length)
                if (similarity > best) best = similarity
            }
        }
        if (best >= 0.75) add(tool, best * 6)
    }

    return [...scores.values()]
        .filter(entry => entry.score >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map(entry => entry.tool)
}

export default function NotFound() {
    useDocumentTitle('Page not found')
    const location = useLocation()
    const navigate = useNavigate()
    // React Router numbers its history entries (re-read on every navigation, since
    // useLocation re-renders this page); idx > 0 means there's an app page to go back to
    const canGoBack = (window.history.state?.idx ?? 0) > 0
    const matches = useMemo(() => suggestionsFor(location.pathname), [location.pathname])
    const suggestions = matches.length ? matches : STARTING_POINTS

    return (
        <div className="page page-narrow page-not-found" style={{ paddingTop: 'clamp(0px, 6vh, 3rem)' }}>
            <PageHeader
                icon={SearchX}
                title="Page not found"
                subtitle={(
                    <>
                        Error 404: there’s nothing at <code className="mono" style={{ color: 'var(--text-main)', overflowWrap: 'anywhere' }}>{location.pathname}</code>. The link may be old or mistyped.
                    </>
                )}
                actions={(
                    <>
                        <Link to="/" className="btn btn-primary">
                            <House size={16} aria-hidden="true" /> Go home
                        </Link>
                        {canGoBack && (
                            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
                                <ArrowLeft size={16} aria-hidden="true" /> Go back
                            </button>
                        )}
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={openCommandPalette}
                            aria-keyshortcuts={isMacPlatform ? 'Meta+K' : 'Control+K'}
                        >
                            <Search size={16} aria-hidden="true" /> Search tools
                            <span className="kbd" aria-hidden="true">{isMacPlatform ? '⌘K' : 'Ctrl K'}</span>
                        </button>
                    </>
                )}
            />

            {/* Soft 404 (the host serves the app shell with HTTP 200): keep it out of search results */}
            <Helmet>
                <meta name="robots" content="noindex" />
            </Helmet>

            {suggestions.length > 0 && (
                <section className="card card-compact" aria-labelledby="not-found-suggestions">
                    <h2 id="not-found-suggestions" className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>{matches.length ? 'Were you looking for…' : 'Some places to start'}</h2>
                    <ul role="list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
                        {suggestions.map(tool => {
                            const Icon = tool.icon
                            return (
                                <li key={tool.path}>
                                    <Link
                                        to={tool.path}
                                        className="btn btn-ghost btn-block"
                                        style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', gap: 'var(--space-sm)', padding: '0.6rem 0.75rem' }}
                                    >
                                        <Icon size={18} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                                            <span style={{ color: 'var(--text-main)' }}>{tool.title}</span>
                                            <span style={{ fontWeight: 400, fontSize: '0.8rem', color: 'var(--text-muted)' }}>{tool.description}</span>
                                        </span>
                                        <ArrowRight size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                                    </Link>
                                </li>
                            )
                        })}
                    </ul>
                </section>
            )}
        </div>
    )
}
