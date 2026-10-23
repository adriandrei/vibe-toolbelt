import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion as Motion } from 'framer-motion'
import { ArrowRight, Github, Search, ShieldCheck, Sparkles, Star, WifiOff, Zap } from 'lucide-react'
import SEO from '../components/SEO'
import PageHeader from '../components/ui/PageHeader'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { useFavorites } from '../hooks/useFavorites'
import { BRAND } from '../config/brand'
import { SETTINGS_TOOL, TOOL_CATEGORIES, TOOL_COUNT, getTool } from '../config/tools'
import { MODELS } from '../services/ai/webllmService'
import { isMacPlatform, openCommandPalette } from '../utils/palette'

const YEAR = new Date().getFullYear()
const SHORTCUT = isMacPlatform ? '⌘K' : 'Ctrl K'
const CONTACT_EMAIL = 'adriandrei@hotmail.com'

const CATEGORIES = TOOL_CATEGORIES
    .map(category => ({ ...category, items: category.items.filter(item => item.path !== '/') }))
    .filter(category => category.items.length > 0)

// "Phi-3.5 Mini (Recommended)" -> "Phi-3.5 Mini"
const MODEL_CHIPS = MODELS.map(model => ({ id: model.id, name: model.label.replace(/\s*\(.*\)\s*$/, ''), size: model.size }))

// Page-scoped styles: hover and focus states can't be inline
const HOME_CSS = `
.home-hero { position: relative; isolation: isolate; padding: var(--space-xl) 0 var(--space-sm); }
.home-hero::before {
    content: ''; position: absolute; z-index: -1; inset: -15% 8% 0; pointer-events: none;
    background: radial-gradient(closest-side, var(--primary-glow), transparent);
}
.home-hero .page-title { font-size: clamp(2.25rem, 2.2vw + 1.6rem, 3.75rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
.home-hero .page-subtitle { font-size: 1.05rem; line-height: 1.6; max-width: 58ch; color: var(--text-muted); }
.home-hero .page-header-actions { justify-content: center; margin-top: var(--space-md); width: 100%; }
.home-hero-actions { display: flex; flex-direction: column; align-items: center; gap: var(--space-sm); width: 100%; }
.home-search {
    display: inline-flex; align-items: center; gap: 0.75rem; width: min(100%, 24rem);
    padding: 0.8rem 0.9rem 0.8rem 1.1rem; border-radius: var(--radius-full);
    border: 1px solid var(--border-hover); background: var(--bg-panel); color: var(--text-muted);
    font-size: 1rem; box-shadow: var(--shadow-md);
    transition: border-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease;
}
.home-search:hover { border-color: var(--primary-border); color: var(--text-main); box-shadow: var(--shadow-md), 0 0 0 4px var(--primary-glow); }
.home-search-label { flex: 1; text-align: left; }
.home-hint { font-size: 0.85rem; color: var(--text-dim); max-width: 46ch; }
@media (hover: none) { .home-hint, .home-search .kbd { display: none; } }

.home-section-title {
    display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap;
    font-size: 1.15rem; font-weight: 700; color: var(--text-main);
    margin-bottom: var(--space-md); scroll-margin-top: calc(var(--header-height) + var(--space-md));
}
.home-section-title:focus { outline: none; }
.home-section-title > svg { color: var(--primary-text); flex-shrink: 0; }
.home-count { font-size: 0.8rem; font-weight: 500; color: var(--text-dim); }

.home-features { container-type: inline-size; }
.home-features-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-md); }
@container (min-width: 36rem) { .home-features-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@container (min-width: 62rem) { .home-features-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.home-feature { display: flex; flex-direction: column; gap: var(--space-sm); height: 100%; }
.home-feature h3 { font-size: 1.05rem; font-weight: 700; color: var(--text-main); }
.home-feature p { font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; }
.home-feature-icon {
    display: inline-flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem;
    border-radius: var(--radius-md); background: var(--primary-glow); color: var(--primary-text);
}
.home-feature.is-accent { border-color: var(--primary-border); background: color-mix(in srgb, var(--primary) 9%, var(--bg-panel)); }
.home-feature-footer { margin-top: auto; display: flex; flex-wrap: wrap; gap: var(--space-xs); align-items: center; }
.home-link { color: var(--primary-text); font-size: 0.875rem; font-weight: 600; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.home-link:hover { text-decoration-thickness: 2px; }

.home-jump { display: flex; flex-wrap: wrap; gap: var(--space-xs); }

.home-tool-card {
    display: flex; align-items: flex-start; gap: 0.85rem; height: 100%;
    padding: 0.9rem 1rem; border-radius: var(--radius-lg);
    background: var(--bg-panel); border: 1px solid var(--border); color: var(--text-main);
    transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.home-tool-card:hover, .home-tool-card:focus-visible { border-color: var(--primary-border); box-shadow: var(--shadow-md); transform: translateY(-2px); }
.home-tool-icon {
    display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
    width: 2.4rem; height: 2.4rem; border-radius: var(--radius-md);
    background: var(--primary-glow); color: var(--primary-text);
}
.home-tool-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.home-tool-name { font-weight: 600; font-size: 0.95rem; line-height: 1.3; }
.home-tool-desc { font-size: 0.82rem; line-height: 1.45; color: var(--text-muted); }
.home-tool-arrow {
    align-self: center; flex-shrink: 0; color: var(--primary-text);
    opacity: 0; transform: translateX(-4px); transition: opacity 0.15s ease, transform 0.15s ease;
}
.home-tool-card:hover .home-tool-arrow, .home-tool-card:focus-visible .home-tool-arrow { opacity: 1; transform: none; }
@media (hover: none) { .home-tool-arrow { opacity: 0.6; transform: none; } }
@media (prefers-reduced-motion: reduce) { .home-tool-card:hover, .home-tool-card:focus-visible { transform: none; } }

.home-cta {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-lg);
    border-color: var(--primary-border);
    background: linear-gradient(135deg, color-mix(in srgb, var(--primary) 10%, var(--bg-panel)), color-mix(in srgb, var(--accent) 8%, var(--bg-panel)));
}
.home-cta h2 { font-size: 1.25rem; font-weight: 700; color: var(--text-main); margin-bottom: var(--space-xs); }
.home-cta p { color: var(--text-muted); max-width: 52ch; }
.home-cta-actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); }

.home-footer {
    display: flex; flex-direction: column; align-items: center; gap: var(--space-sm);
    padding: var(--space-xl) 0 var(--space-md); border-top: 1px solid var(--border);
    color: var(--text-dim); font-size: 0.85rem; text-align: center;
}
.home-footer-links { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-xs) var(--space-lg); }
.home-footer-links a { color: var(--text-muted); }
.home-footer-links a:hover { color: var(--text-main); text-decoration: underline; text-underline-offset: 3px; }
`

function NewTabNote() {
    return <span className="sr-only"> (opens in a new tab)</span>
}

function ToolCard({ tool }) {
    const Icon = tool.icon
    return (
        <Link to={tool.path} className="home-tool-card">
            <span className="home-tool-icon" aria-hidden="true"><Icon size={20} /></span>
            <span className="home-tool-text">
                <span className="home-tool-name">{tool.label}</span>
                <span className="home-tool-desc">{tool.description}</span>
            </span>
            <ArrowRight className="home-tool-arrow" size={16} aria-hidden="true" />
        </Link>
    )
}

function ToolGrid({ tools }) {
    return (
        <ul role="list" className="auto-grid" style={{ '--auto-grid-min': '15rem', listStyle: 'none' }}>
            {tools.map(tool => (
                <li key={tool.path}>
                    <ToolCard tool={tool} />
                </li>
            ))}
        </ul>
    )
}

const FEATURES = [
    {
        id: 'privacy',
        icon: ShieldCheck,
        title: 'Private by default',
        text: 'Your input is processed in this tab: no uploads, accounts, analytics or cookies. The few requests the app can make, like API Tester calls, are ones you start.',
        link: { to: '/privacy', label: 'Privacy policy' },
    },
    {
        id: 'offline',
        icon: WifiOff,
        title: 'Works offline',
        text: 'Install it from your browser and keep working without a connection. Large engines, like video and the code editor, are cached the first time you open them.',
    },
    {
        id: 'ai',
        icon: Sparkles,
        title: 'On-device AI',
        accent: true,
        text: 'An optional assistant runs open models in your browser with WebGPU. The model downloads once, when you choose to load it; prompts never leave your device.',
        models: true,
        link: { to: SETTINGS_TOOL.path, label: 'Choose a model in Settings' },
    },
    {
        id: 'speed',
        icon: Zap,
        title: 'Quick to get around',
        text: `Search with ${SHORTCUT}, star your favorites, pin a second tool beside the first on wide screens, and pass results between tools.`,
    },
]

export default function Home() {
    useDocumentTitle(null)
    const { favorites } = useFavorites()
    const favoriteTools = favorites.map(getTool).filter(tool => tool && tool.path !== '/')
    const headings = useRef({})

    const jumpTo = (id) => {
        const heading = headings.current[id]
        if (!heading) return
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
        heading.focus({ preventScroll: true })
    }

    return (
        <div className="page page-wide page-home" style={{ gap: 'var(--space-2xl)' }}>
            <PageHeader className="home-hero" title={BRAND.name} subtitle={`${TOOL_COUNT} developer tools that run in your browser: formatters, encoders, crypto, media and more. No account, no ads, no tracking.`}>
                <div className="home-hero-actions">
                    <button
                        type="button"
                        className="home-search"
                        onClick={openCommandPalette}
                        aria-keyshortcuts={isMacPlatform ? 'Meta+K' : 'Control+K'}
                    >
                        <Search size={18} aria-hidden="true" />
                        <span className="home-search-label">Search {TOOL_COUNT} tools…</span>
                        <span className="kbd" aria-hidden="true">{SHORTCUT}</span>
                    </button>
                    <p className="home-hint">Or paste anything on this page (a JWT, JSON, a timestamp…) and get a suggestion for the right tool.</p>
                </div>
            </PageHeader>
            <SEO />
            <style>{HOME_CSS}</style>

            {favoriteTools.length > 0 && (
                <section aria-labelledby="home-favorites">
                    <h2 id="home-favorites" className="home-section-title">
                        <Star size={18} aria-hidden="true" fill="currentColor" /> Favorites
                        <span className="home-count">{favoriteTools.length}</span>
                    </h2>
                    <ToolGrid tools={favoriteTools} />
                </section>
            )}

            <section className="home-features" aria-label="Highlights">
                <div className="home-features-grid">
                    {FEATURES.map((feature, index) => {
                        const Icon = feature.icon
                        return (
                            <Motion.article
                                key={feature.id}
                                className={`card card-compact home-feature ${feature.accent ? 'is-accent' : ''}`}
                                initial={{ y: 12 }}
                                animate={{ y: 0 }}
                                transition={{ duration: 0.35, delay: index * 0.05, ease: 'easeOut' }}
                            >
                                <span className="home-feature-icon" aria-hidden="true"><Icon size={20} /></span>
                                <h3>{feature.title}</h3>
                                <p>{feature.text}</p>
                                {(feature.models || feature.link) && (
                                    <div className="home-feature-footer">
                                        {feature.models && MODEL_CHIPS.map(model => (
                                            <span key={model.id} className="badge">{model.name} · {model.size}</span>
                                        ))}
                                        {feature.link && <Link to={feature.link.to} className="home-link">{feature.link.label}</Link>}
                                    </div>
                                )}
                            </Motion.article>
                        )
                    })}
                </div>
            </section>

            <section aria-labelledby="home-all-tools" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
                <div>
                    <h2 id="home-all-tools" className="home-section-title">
                        All tools <span className="home-count">{TOOL_COUNT}</span>
                    </h2>
                    <nav aria-label="Jump to a category" className="home-jump">
                        {CATEGORIES.map(category => (
                            <button key={category.id} type="button" className="chip" onClick={() => jumpTo(category.id)}>
                                {category.name}
                                <span className="home-count" aria-hidden="true">{category.items.length}</span>
                            </button>
                        ))}
                    </nav>
                </div>

                {CATEGORIES.map(category => {
                    const CategoryIcon = category.icon
                    return (
                        <section key={category.id} aria-labelledby={`home-cat-${category.id}`}>
                            <h2
                                id={`home-cat-${category.id}`}
                                className="home-section-title"
                                tabIndex={-1}
                                ref={(el) => { headings.current[category.id] = el }}
                            >
                                <CategoryIcon size={18} aria-hidden="true" />
                                {category.name}
                                <span className="home-count">{category.items.length} tool{category.items.length === 1 ? '' : 's'}</span>
                            </h2>
                            <ToolGrid tools={category.items} />
                        </section>
                    )
                })}
            </section>

            <section className="card home-cta" aria-labelledby="home-open-source">
                <div>
                    <h2 id="home-open-source">Open source</h2>
                    <p>{BRAND.name} is open source. Star it on GitHub, report a bug or suggest the next tool.</p>
                </div>
                <div className="home-cta-actions">
                    <a className="btn btn-primary" href={BRAND.repoUrl} target="_blank" rel="noopener noreferrer">
                        <Github size={16} aria-hidden="true" /> Star on GitHub<NewTabNote />
                    </a>
                    <a className="btn btn-secondary" href={`${BRAND.repoUrl}/issues`} target="_blank" rel="noopener noreferrer">
                        Report a bug or idea<NewTabNote />
                    </a>
                </div>
            </section>

            <footer className="home-footer">
                <nav aria-label="About this site" className="home-footer-links">
                    <Link to="/privacy">Privacy policy</Link>
                    <Link to="/terms">Terms of use</Link>
                    <a href={BRAND.repoUrl} target="_blank" rel="noopener noreferrer">Source code<NewTabNote /></a>
                    <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
                </nav>
                <p>© {YEAR} {BRAND.name}. {BRAND.tagline}.</p>
            </footer>
        </div>
    )
}
