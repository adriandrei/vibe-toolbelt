import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { BRAND } from '../config/brand'

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
}

export default function Terms() {
    useDocumentTitle('Terms of Use')

    return (
        <div className="page page-narrow page-legal">
            <PageHeader
                icon={FileText}
                title="Terms of Use"
                subtitle={`The ground rules for using ${BRAND.name}. Plain language, no surprises.`}
            />
            <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-dim)', marginTop: 'calc(-1 * var(--space-sm))' }}>
                Last updated <time dateTime={LAST_UPDATED}>{LAST_UPDATED_LABEL}</time>
            </p>

            <article className="card" style={S.article}>
                <section style={S.section} aria-labelledby="terms-use">
                    <h2 id="terms-use" style={S.h2}>Using the tools</h2>
                    <p>{BRAND.name} is free to use for personal and commercial work. There’s no account to create and nothing to accept beyond these terms.</p>
                    <p>Please don’t use it to break the law or to attack systems you aren’t allowed to test. You’re responsible for the data you process and for respecting the terms of any service you call with the API Tester.</p>
                </section>

                <section style={S.section} aria-labelledby="terms-results">
                    <h2 id="terms-results" style={S.h2}>Check results before you rely on them</h2>
                    <p>The tools are built with care, but they can have bugs. Check important output before you use it in production, especially:</p>
                    <ul style={S.list}>
                        <li>Security tools (hashes, encryption, keys, tokens, passwords). They’re conveniences for development, not audited cryptography; don’t make them the only safeguard for real secrets.</li>
                        <li>Generated data (fake data, IDs, Lorem Ipsum). Fake records can look real by coincidence, so don’t present them as real people or real data.</li>
                        <li>Conversions and formatting of anything you can’t easily recreate. Keep a copy of the original.</li>
                    </ul>
                </section>

                <section style={S.section} aria-labelledby="terms-ai">
                    <h2 id="terms-ai" style={S.h2}>AI assistant</h2>
                    <p>The optional assistant runs small open models on your device. Like any language model, it can be wrong, incomplete or out of date, and it can sound confident when it isn’t. Treat its explanations, code, regular expressions and security advice as suggestions: review and test them before you use them.</p>
                    <p>The models are made by third parties and provided under their own licences. Nothing you type is sent to an AI service; see the <Link to="/privacy" style={S.link}>Privacy Policy</Link>.</p>
                </section>

                <section style={S.section} aria-labelledby="terms-warranty">
                    <h2 id="terms-warranty" style={S.h2}>No warranty</h2>
                    <p>
                        {BRAND.name} is provided “as is”, without warranty of any kind, express or implied, including fitness for a particular purpose. To the extent the law allows, the authors aren’t liable for any claim, damages or other liability arising from the use of the app or its output, including lost data or downtime.
                    </p>
                </section>

                <section style={S.section} aria-labelledby="terms-source">
                    <h2 id="terms-source" style={S.h2}>Open source</h2>
                    <p>The source code is public on <a href={BRAND.repoUrl} target="_blank" rel="noopener noreferrer" style={S.link}>GitHub<span className="sr-only"> (opens in a new tab)</span></a>. Bug reports and suggestions are welcome there.</p>
                </section>

                <section style={S.section} aria-labelledby="terms-changes">
                    <h2 id="terms-changes" style={S.h2}>Changes</h2>
                    <p>These terms may change as the app does. When they do, this page and the date above are updated. Continuing to use the app after a change means you accept the new terms.</p>
                </section>

                <section style={S.section} aria-labelledby="terms-contact">
                    <h2 id="terms-contact" style={S.h2}>Contact</h2>
                    <p>Questions about these terms? Email <a href={`mailto:${CONTACT_EMAIL}`} style={S.link}>{CONTACT_EMAIL}</a>.</p>
                </section>
            </article>
        </div>
    )
}
