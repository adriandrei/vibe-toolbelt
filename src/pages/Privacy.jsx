import { Link } from 'react-router-dom'
import { Shield } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { BRAND } from '../config/brand'
import { ALL_TOOLS, SETTINGS_TOOL } from '../config/tools'
import { MODELS } from '../services/ai/webllmService'

const LAST_UPDATED = '2026-10-18'
const LAST_UPDATED_LABEL = '18 October 2026'
const CONTACT_EMAIL = 'adriandrei@hotmail.com'

const S = {
    article: { display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)', lineHeight: 1.65, color: 'var(--text-muted)' },
    section: { display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' },
    h2: { fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-main)' },
    list: { paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' },
    strong: { color: 'var(--text-main)', fontWeight: 600 },
    link: { color: 'var(--primary-text)', textDecoration: 'underline', textUnderlineOffset: 3 },
    code: { fontFamily: 'var(--font-mono)', fontSize: '0.85em', color: 'var(--text-code)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.05rem 0.35rem', whiteSpace: 'nowrap' },
}

// Link to a tool by its title, so a renamed route doesn't break the page
function ToolLink({ title, children }) {
    const tool = ALL_TOOLS.find(t => t.title === title)
    if (!tool) return children ?? title
    return <Link to={tool.path} style={S.link}>{children ?? tool.title}</Link>
}

function Key({ children }) {
    return <code style={S.code}>{children}</code>
}

const STORED = [
    { what: 'Theme and accent colour', where: 'Local storage', keys: ['pt-theme', 'pt-hue'] },
    { what: 'Favorite tools', where: 'Local storage', keys: ['vibe-tools-favorites'] },
    { what: 'Sidebar groups you collapsed', where: 'Local storage', keys: ['pt-sidebar-collapsed'] },
    { what: 'The tool pinned in split view', where: 'Local storage', keys: ['pt-pinned-tool'] },
    { what: 'Your AI model choice', where: 'Local storage', keys: ['ai_model'] },
    { what: 'Tool preferences (Formatters options, the code language chosen in the API Tester and cURL Converter)', where: 'Local storage', keys: ['vt-formatters-prefs', 'api-code-target', 'curl-target'] },
    {
        what: <>API Tester history, collections and environments. <strong style={S.strong}>These can contain tokens, passwords or API keys you entered.</strong></>,
        where: 'Local storage',
        keys: ['api-history', 'api-collections', 'api-envs', 'api-active-env'],
    },
    { what: 'Text passed between tools with the pipeline (cleared when you close the tab)', where: 'Session storage', keys: ['pt-pipeline'] },
    { what: 'A one-time flag used to reload once after an app update', where: 'Session storage', keys: ['pt-chunk-reload'] },
    { what: `Downloaded AI model files (${MODELS.map(m => `${m.label.replace(/\s*\(.*\)\s*$/, '')}: ${m.size}`).join(', ')})`, where: 'Cache Storage', keys: ['webllm/…'] },
    { what: 'The app itself, for offline use (scripts, styles, fonts, and the video engine once used)', where: 'Service worker caches', keys: [] },
]

export default function Privacy() {
    useDocumentTitle('Privacy Policy')

    return (
        <div className="page page-narrow page-legal">
            <PageHeader
                icon={Shield}
                title="Privacy Policy"
                subtitle={`What ${BRAND.name} keeps on your device, and what it sends over the network.`}
            />
            <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: 'calc(-1 * var(--space-sm))' }}>
                Last updated <time dateTime={LAST_UPDATED}>{LAST_UPDATED_LABEL}</time>
            </p>

            <article className="card" style={S.article}>
                <section style={S.section} aria-labelledby="privacy-summary">
                    <h2 id="privacy-summary" style={S.h2}>In short</h2>
                    <ul style={S.list}>
                        <li>The tools run in your browser. What you paste, type or open is processed on your device and isn’t uploaded to us.</li>
                        <li>There are no accounts, analytics, ads, tracking pixels or cookies.</li>
                        <li>A few features use the network, either because that’s their job or because you asked them to. They’re listed below.</li>
                        <li>Settings and some tool data are saved in your browser so they’re there next time. You can delete them at any time.</li>
                    </ul>
                </section>

                <section style={S.section} aria-labelledby="privacy-network">
                    <h2 id="privacy-network" style={S.h2}>What goes over the network</h2>
                    <ul style={S.list}>
                        <li>
                            <strong style={S.strong}>Loading the app.</strong> Your browser downloads the app’s files from our host, Azure Static Web Apps (Microsoft). Like any web server, it keeps standard access logs: your IP address, the time, the files requested and your browser’s user agent. Fonts and the code editor are bundled with the app, so no font service or CDN is contacted.
                        </li>
                        <li>
                            <strong style={S.strong}>The AI assistant, if you load a model.</strong> Choosing a model in <Link to={SETTINGS_TOOL.path} style={S.link}>Settings</Link> downloads its files once from <Key>huggingface.co</Key> and <Key>raw.githubusercontent.com</Key>. Those services see your IP address and which files were requested. Your prompts and the answers are processed on your device and never leave it.
                        </li>
                        <li>
                            <strong style={S.strong}>The <ToolLink title="API Tester" />.</strong> It sends requests to the URLs you enter, with the headers and body you set. That’s its purpose: the servers you call receive whatever you send them.
                        </li>
                        <li>
                            <strong style={S.strong}>The Markdown preview.</strong> Images referenced by URL in your document are loaded from the servers that host them.
                        </li>
                        <li>
                            <strong style={S.strong}>Links to other sites</strong>, such as GitHub, follow those sites’ own privacy policies.
                        </li>
                    </ul>
                    <p>Everything else, including formatting, encoding, hashing, encryption, image, video and PDF processing, happens locally.</p>
                </section>

                <section style={S.section} aria-labelledby="privacy-stored">
                    <h2 id="privacy-stored" style={S.h2}>What’s stored in your browser</h2>
                    <p>This data stays on your device and is never sent to us.</p>
                    <ul role="list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
                        {STORED.map((row) => (
                            <li key={row.keys.join() || row.where} style={{ padding: '0.6rem 0', borderTop: '1px solid var(--border)' }}>
                                <div style={{ color: 'var(--text-main)' }}>{row.what}</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '0.85rem' }}>
                                    <span>{row.where}</span>
                                    {row.keys.map(k => <Key key={k}>{k}</Key>)}
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>

                <section style={S.section} aria-labelledby="privacy-clear">
                    <h2 id="privacy-clear" style={S.h2}>How to delete your data</h2>
                    <ul style={S.list}>
                        <li><strong style={S.strong}>Everything at once:</strong> clear this site’s data in your browser (for example, in Chrome: the icon left of the address bar, then <em>Site settings</em> and <em>Delete data</em>; in Firefox: the padlock, then <em>Clear cookies and site data</em>; in Safari: <em>Settings</em>, <em>Privacy</em>, <em>Manage Website Data</em>). This removes settings, favorites, API Tester data, downloaded AI models and the offline copy of the app.</li>
                        <li><strong style={S.strong}>API Tester data:</strong> delete saved requests, collections and environments in the <ToolLink title="API Tester" />.</li>
                        <li><strong style={S.strong}>AI models:</strong> remove downloaded models in <Link to={SETTINGS_TOOL.path} style={S.link}>Settings</Link>.</li>
                        <li><strong style={S.strong}>Favorites:</strong> click the star next to a tool in the sidebar to remove it.</li>
                    </ul>
                </section>

                <section style={S.section} aria-labelledby="privacy-changes">
                    <h2 id="privacy-changes" style={S.h2}>Changes</h2>
                    <p>If what the app stores or sends changes, this page will be updated and the date above will change. The source code is public on <a href={BRAND.repoUrl} target="_blank" rel="noopener noreferrer" style={S.link}>GitHub<span className="sr-only"> (opens in a new tab)</span></a>, so you can check how it works.</p>
                </section>

                <section style={S.section} aria-labelledby="privacy-contact">
                    <h2 id="privacy-contact" style={S.h2}>Contact</h2>
                    <p>Questions or concerns about privacy? Email <a href={`mailto:${CONTACT_EMAIL}`} style={S.link}>{CONTACT_EMAIL}</a>.</p>
                </section>
            </article>
        </div>
    )
}
