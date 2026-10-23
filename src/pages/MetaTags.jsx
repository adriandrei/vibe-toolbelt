import { useId, useMemo, useState } from 'react'
import { ImageIcon, ImageOff, Tags } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CodeBlock from '../components/ui/CodeBlock'
import EmptyState from '../components/ui/EmptyState'
import Field from '../components/ui/Field'
import SegmentedControl from '../components/ui/SegmentedControl'
import { useDebouncedValue } from '../hooks/useDebouncedValue'

const INITIAL = {
    title: '',
    description: '',
    url: '',
    image: '',
    imageAlt: '',
    siteName: '',
    author: '',
    keywords: '',
    twitterSite: '',
    card: 'summary_large_image',
}

// Soft limits: what search results and link previews usually show
const LIMITS = { title: 60, description: 160 }

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (s) => escapeText(s).replace(/"/g, '&quot;')

function absoluteUrl(value) {
    const text = value.trim()
    if (!text) return { ok: true, url: null }
    try {
        const url = new URL(text)
        if (url.protocol === 'http:' || url.protocol === 'https:') return { ok: true, url }
    } catch {
        // invalid
    }
    return { ok: false, url: null }
}

const handle = (value) => {
    const text = value.trim().replace(/^@+/, '')
    return text ? `@${text}` : ''
}

function buildMetaTags(input) {
    const d = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
    const meta = (attr, name, content) => (content ? `<meta ${attr}="${name}" content="${escapeAttr(content)}">` : null)
    const sections = []
    const add = (comment, lines) => {
        const present = lines.filter(Boolean)
        if (present.length) sections.push([`<!-- ${comment} -->`, ...present].join('\n'))
    }
    const twitterHandle = handle(d.twitterSite)

    add('Primary meta tags', [
        d.title && `<title>${escapeText(d.title)}</title>`,
        meta('name', 'description', d.description),
        meta('name', 'keywords', d.keywords),
        meta('name', 'author', d.author),
        d.url && `<link rel="canonical" href="${escapeAttr(d.url)}">`,
    ])
    const hasOg = d.title || d.description || d.url || d.image || d.siteName
    add('Open Graph (Facebook, LinkedIn, Slack…)', hasOg ? [
        meta('property', 'og:type', 'website'),
        meta('property', 'og:url', d.url),
        meta('property', 'og:site_name', d.siteName),
        meta('property', 'og:title', d.title),
        meta('property', 'og:description', d.description),
        meta('property', 'og:image', d.image),
        d.image && meta('property', 'og:image:alt', d.imageAlt),
    ] : [])
    const hasTwitter = d.title || d.description || d.image || twitterHandle
    add('X / Twitter', hasTwitter ? [
        meta('name', 'twitter:card', d.card),
        meta('name', 'twitter:site', twitterHandle),
        meta('name', 'twitter:title', d.title),
        meta('name', 'twitter:description', d.description),
        meta('name', 'twitter:image', d.image),
        d.image && meta('name', 'twitter:image:alt', d.imageAlt),
    ] : [])
    return sections.join('\n\n')
}

function Counter({ value, limit }) {
    const n = value.trim().length
    const over = n > limit
    return (
        <span style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', color: over ? 'var(--warning)' : 'var(--text-dim)', fontWeight: over ? 600 : 400 }}>
            {n} / {limit}
        </span>
    )
}

function SocialPreview({ data, imageUrl, pageUrl }) {
    const [allowImages, setAllowImages] = useState(false)
    const [failed, setFailed] = useState(null)
    const debouncedImage = useDebouncedValue(imageUrl?.href ?? '', 400)
    const large = data.card === 'summary_large_image'
    const host = pageUrl?.hostname ?? 'example.com'
    const imageHost = imageUrl?.hostname

    let media
    if (!imageUrl) {
        media = (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, height: '100%', color: 'var(--on-stage)', opacity: 0.7, fontSize: '0.8rem', textAlign: 'center', padding: 'var(--space-sm)' }}>
                <ImageIcon size={large ? 28 : 20} aria-hidden="true" />
                {large && 'No image'}
            </div>
        )
    } else if (!allowImages) {
        media = (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-xs)', height: '100%', padding: 'var(--space-sm)', textAlign: 'center' }}>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAllowImages(true)}>
                    <ImageIcon size={14} aria-hidden="true" /> {large ? 'Load image' : 'Load'}
                </button>
                {large && <span style={{ fontSize: '0.75rem', color: 'var(--on-stage)', opacity: 0.75 }}>Fetches it from {imageHost}</span>}
            </div>
        )
    } else if (debouncedImage && failed === debouncedImage) {
        media = (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, height: '100%', color: 'var(--on-stage)', fontSize: '0.8rem', textAlign: 'center', padding: 'var(--space-sm)' }}>
                <ImageOff size={large ? 24 : 18} aria-hidden="true" />
                {large && "Couldn't load the image (not found, or blocked by its server)"}
            </div>
        )
    } else if (debouncedImage) {
        media = (
            <img
                key={debouncedImage}
                src={debouncedImage}
                alt={data.imageAlt.trim()}
                referrerPolicy="no-referrer"
                onError={() => setFailed(debouncedImage)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
        )
    }

    const text = (
        <div style={{ padding: 'var(--space-sm) var(--space-md)', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-dim)', overflowWrap: 'anywhere' }}>{host}</span>
            <span style={{ fontWeight: 600, color: data.title.trim() ? 'var(--text-main)' : 'var(--text-dim)', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {data.title.trim() || 'Page title'}
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {data.description.trim() || 'The description appears here.'}
            </span>
        </div>
    )

    return (
        <div
            role="img"
            aria-label={`Link preview: ${data.title.trim() || 'untitled'} on ${host}`}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-elevated)', display: large ? 'block' : 'flex', maxWidth: 520 }}
        >
            <div className="stage" style={{ borderRadius: 0, ...(large ? { aspectRatio: '1.91 / 1' } : { width: 112, minHeight: 112, flexShrink: 0 }) }}>
                {media}
            </div>
            {text}
        </div>
    )
}

export default function MetaTags() {
    const formId = useId()
    const [data, setData] = useState(INITIAL)
    const set = (name) => (event) => setData(d => ({ ...d, [name]: event.target.value }))

    const html = useMemo(() => buildMetaTags(data), [data])
    const pageUrl = absoluteUrl(data.url)
    const imageUrl = absoluteUrl(data.image)
    const titleOver = data.title.trim().length > LIMITS.title
    const descOver = data.description.trim().length > LIMITS.description

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane">
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <h2 className="section-title">Page details</h2>
                    <Field
                        label="Page title"
                        labelAction={<Counter value={data.title} limit={LIMITS.title} />}
                        hint={titleOver ? 'Search results usually cut titles off after about 60 characters.' : 'Shown in browser tabs, search results and link previews.'}
                    >
                        <input id={`${formId}-title`} type="text" name="title" value={data.title} onChange={set('title')} placeholder="Acme Widgets: hand-made since 1999" />
                    </Field>
                    <Field
                        label="Description"
                        labelAction={<Counter value={data.description} limit={LIMITS.description} />}
                        hint={descOver ? 'Search results usually show about 155–160 characters; the rest is cut off.' : 'One or two sentences that summarise the page.'}
                    >
                        <textarea id={`${formId}-description`} name="description" value={data.description} onChange={set('description')} rows={3} style={{ minHeight: 0, fontFamily: 'var(--font-family)', fontSize: '0.95rem' }} placeholder="What the page is about, in a sentence or two." />
                    </Field>
                    <Field label="Page URL (canonical)" error={pageUrl.ok ? null : 'Use an absolute URL, starting with https://'} hint="The preferred address of this page.">
                        <input id={`${formId}-url`} type="url" name="url" value={data.url} onChange={set('url')} placeholder="https://example.com/page" spellCheck={false} />
                    </Field>
                    <Field label="Image URL" error={imageUrl.ok ? null : 'Use an absolute URL, starting with https://'} hint="For link previews; 1200 × 630 px works well.">
                        <input id={`${formId}-image`} type="url" name="image" value={data.image} onChange={set('image')} placeholder="https://example.com/og-image.png" spellCheck={false} />
                    </Field>
                    <Field label="Image description (alt text)">
                        <input id={`${formId}-alt`} type="text" name="imageAlt" value={data.imageAlt} onChange={set('imageAlt')} placeholder="A short description of the image" />
                    </Field>
                    <div className="auto-grid" style={{ '--auto-grid-min': '180px' }}>
                        <Field label="Site name">
                            <input id={`${formId}-site`} type="text" name="siteName" value={data.siteName} onChange={set('siteName')} placeholder="Acme" />
                        </Field>
                        <Field label="Author">
                            <input id={`${formId}-author`} type="text" name="author" value={data.author} onChange={set('author')} placeholder="Jane Doe" />
                        </Field>
                        <Field label="X / Twitter account">
                            <input id={`${formId}-twitter`} type="text" name="twitterSite" value={data.twitterSite} onChange={set('twitterSite')} placeholder="@acme" spellCheck={false} />
                        </Field>
                    </div>
                    <Field label="Keywords" hint="Comma separated. Search engines ignore them today, but some site search tools still read them.">
                        <input id={`${formId}-keywords`} type="text" name="keywords" value={data.keywords} onChange={set('keywords')} placeholder="widgets, hand-made, gifts" />
                    </Field>
                    <div>
                        <span className="field-label">Card style</span>
                        <SegmentedControl
                            ariaLabel="Card style"
                            value={data.card}
                            onChange={card => setData(d => ({ ...d, card }))}
                            options={[{ value: 'summary_large_image', label: 'Large image' }, { value: 'summary', label: 'Summary' }]}
                        />
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', minWidth: 0 }}>
                    <section className="card" aria-label="Generated HTML">
                        <h2 className="section-title" style={{ marginBottom: 'var(--space-sm)' }}>Generated HTML</h2>
                        {html ? (
                            <CodeBlock code={html} language="markup" title="Paste into the page's <head>" copyLabel="Copy HTML" />
                        ) : (
                            <EmptyState icon={Tags} title="Nothing to generate yet">
                                Fill in a title or description. Only fields with a value produce tags.
                            </EmptyState>
                        )}
                    </section>
                    <section className="card" aria-label="Link preview">
                        <h2 className="section-title" style={{ marginBottom: 'var(--space-xs)' }}>Link preview</h2>
                        <p className="field-hint" style={{ marginTop: 0, marginBottom: 'var(--space-sm)' }}>
                            Roughly how the page looks when shared. Each site styles cards differently. The image only loads when you ask, since that contacts its server.
                        </p>
                        <SocialPreview data={data} imageUrl={imageUrl.url} pageUrl={pageUrl.url} />
                    </section>
                </div>
            </div>
        </div>
    )
}
