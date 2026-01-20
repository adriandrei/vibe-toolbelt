import React, { useState } from 'react'
import { Globe, Copy } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function MetaTags() {
    useDocumentTitle('Meta Tag Generator')
    const [data, setData] = useState({
        title: '',
        description: '',
        keywords: '',
        author: '',
        image: '',
        url: ''
    })

    const handleChange = (e) => {
        setData({ ...data, [e.target.name]: e.target.value })
    }

    const generateCode = () => {
        return `<!-- Primary Meta Tags -->
<title>${data.title}</title>
<meta name="title" content="${data.title}" />
<meta name="description" content="${data.description}" />
<meta name="keywords" content="${data.keywords}" />
<meta name="author" content="${data.author}" />

<!-- Open Graph / Facebook -->
<meta property="og:type" content="website" />
<meta property="og:url" content="${data.url}" />
<meta property="og:title" content="${data.title}" />
<meta property="og:description" content="${data.description}" />
<meta property="og:image" content="${data.image}" />

<!-- Twitter -->
<meta property="twitter:card" content="summary_large_image" />
<meta property="twitter:url" content="${data.url}" />
<meta property="twitter:title" content="${data.title}" />
<meta property="twitter:description" content="${data.description}" />
<meta property="twitter:image" content="${data.image}" />`
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-xl)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <h2 className="text-gradient">SEO Info</h2>

                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 4 }}>Page Title</label>
                    <input type="text" name="title" value={data.title} onChange={handleChange} style={{ width: '100%' }} maxLength={60} />
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{data.title.length}/60</div>
                </div>

                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 4 }}>Description</label>
                    <textarea name="description" value={data.description} onChange={handleChange} style={{ width: '100%', minHeight: '80px' }} maxLength={160} />
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{data.description.length}/160</div>
                </div>

                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 4 }}>Keywords (comma separated)</label>
                    <input type="text" name="keywords" value={data.keywords} onChange={handleChange} style={{ width: '100%' }} />
                </div>

                <div className="glass-panel" style={{ padding: 'var(--space-md)' }}>
                    <label style={{ display: 'block', marginBottom: 4 }}>Image URL (OG/Twitter)</label>
                    <input type="text" name="image" value={data.image} onChange={handleChange} style={{ width: '100%' }} placeholder="https://example.com/og-image.jpg" />
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                <h2 className="text-gradient">Generated HTML</h2>

                <div className="glass-panel" style={{ padding: 'var(--space-md)', flex: 1, position: 'relative' }}>
                    <button
                        onClick={() => navigator.clipboard.writeText(generateCode())}
                        style={{
                            position: 'absolute',
                            top: 10,
                            right: 10,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            color: 'var(--primary)'
                        }}
                    >
                        <Copy size={14} /> Copy
                    </button>
                    <pre style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.85rem',
                        color: 'var(--text-code)',
                        whiteSpace: 'pre-wrap',
                        marginTop: '20px'
                    }}>
                        {generateCode()}
                    </pre>
                </div>
            </div>
        </div>
    )
}
