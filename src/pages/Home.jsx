import React from 'react'
import { Link } from 'react-router-dom'
import { TOOL_CATEGORIES } from '../components/Sidebar'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const ToolCard = ({ to, icon: Icon, label, color }) => (
    <Link to={to} className="glass-panel" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px',
        transition: 'transform 0.2s ease, border-color 0.2s ease, background 0.2s',
        textDecoration: 'none',
        border: '1px solid var(--border)',
        background: 'var(--bg-panel)'
    }}
        onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.borderColor = 'var(--primary)'
            e.currentTarget.style.background = 'var(--bg-card)'
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none'
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.background = 'var(--bg-panel)'
        }}
    >
        <div style={{
            color: 'var(--primary)',
            background: 'rgba(139, 92, 246, 0.1)',
            padding: '8px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <Icon size={20} />
        </div>
        <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.95rem' }}>{label}</div>
    </Link>
)

const Footer = () => (
    <footer style={{
        marginTop: 'auto',
        padding: 'var(--space-2xl) 0 var(--space-xl)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-md)',
        color: 'var(--text-muted)',
        fontSize: '0.9rem'
    }}>
        <div style={{ display: 'flex', gap: 'var(--space-lg)' }}>
            <Link to="/privacy" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'var(--text-main)'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>Privacy</Link>
            <Link to="/terms" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'var(--text-main)'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>Terms</Link>
            <a href="mailto:adriandrei@hotmail.com" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'var(--text-main)'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>Contact</a>
        </div>
        <p>&copy; {new Date().getFullYear()} Vibe Toolbelt. All rights reserved.</p>
    </footer>
)

export default function Home() {
    useDocumentTitle('Home')

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', gap: 'var(--space-xl)' }}>
            {/* Hero Section */}
            <div style={{ textAlign: 'center', margin: 'var(--space-xl) 0 var(--space-lg)' }}>
                <h1 style={{
                    fontSize: 'clamp(2rem, 4vw + 1rem, 3.5rem)',
                    marginBottom: 'var(--space-md)',
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                    textShadow: '0 0 40px rgba(168, 85, 247, 0.2)'
                }}>
                    The <span className="text-gradient">Ultimate</span><br />
                    Developer Toolkit
                </h1>
                <p style={{
                    fontSize: '1.1rem',
                    color: 'var(--text-muted)',
                    maxWidth: '600px',
                    margin: '0 auto var(--space-lg)',
                    lineHeight: 1.6
                }}>
                    A privacy-focused collection of {TOOL_CATEGORIES.flatMap(c => c.items).length}+ utilities. <br />
                    Fast, secure, and always at your fingertips.
                </p>

                {/* Ctrl + K Visual Cue */}
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    padding: '6px 16px',
                    borderRadius: 'var(--radius-full)',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                    boxShadow: 'var(--glass-shadow)'
                }}>
                    <span style={{ color: 'var(--text-muted)' }}>Press</span>
                    <kbd style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '0.8rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: 'var(--text-main)'
                    }}>Ctrl</kbd>
                    <span style={{ color: 'var(--text-muted)' }}>+</span>
                    <kbd style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '0.8rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: 'var(--text-main)'
                    }}>K</kbd>
                    <span style={{ color: 'var(--text-muted)' }}>to search</span>
                </div>
            </div>

            {/* All Tools Grid by Category */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
                {TOOL_CATEGORIES.map((category) => (
                    <div key={category.name} className="fade-in">
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            marginBottom: '16px',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                            letterSpacing: '1px'
                        }}>
                            <category.icon size={16} />
                            {category.name}
                        </div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                            gap: '16px'
                        }}>
                            {category.items.filter(item => item.to !== '/').map((tool) => (
                                <ToolCard
                                    key={tool.to}
                                    to={tool.to}
                                    icon={tool.icon}
                                    label={tool.label}
                                />
                            ))}
                        </div>
                    </div>
                ))}
            </div>

            <Footer />
        </div>
    )
}
