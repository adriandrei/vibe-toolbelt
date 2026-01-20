import React from 'react'
import { Link } from 'react-router-dom'
import { Code, Key, User, ArrowRight, FileDiff, Fingerprint, Braces, Palette } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const ToolCard = ({ to, icon: Icon, title, description, color }) => (
    <Link to={to} className="glass-panel" style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-lg)',
        transition: 'transform 0.2s ease, border-color 0.2s ease',
        height: '100%',
        textDecoration: 'none' // Ensure no underline
    }}
        onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)'
            e.currentTarget.style.borderColor = color
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none'
            e.currentTarget.style.borderColor = 'var(--glass-border)'
        }}
    >
        <div style={{
            background: `hsla(${color === 'var(--accent)' ? '280' : 'var(--hue)'}, 80%, 20%, 0.5)`,
            width: '48px',
            height: '48px',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 'var(--space-md)',
            color: color
        }}>
            <Icon size={24} />
        </div>
        <h3 style={{ fontSize: '1.25rem', marginBottom: 'var(--space-sm)', color: 'var(--text-main)' }}>{title}</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-lg)', flexGrow: 1 }}>{description}</p>

        <div style={{ display: 'flex', alignItems: 'center', color: color, fontWeight: 500, fontSize: '0.9rem' }}>
            Launch Tool <ArrowRight size={16} style={{ marginLeft: 'var(--space-xs)' }} />
        </div>
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
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', gap: 'var(--space-2xl)' }}>
            {/* Hero Section */}
            <div style={{ textAlign: 'center', margin: 'var(--space-xl) 0' }}>
                <h1 style={{
                    fontSize: '3.5rem',
                    marginBottom: 'var(--space-md)',
                    letterSpacing: '-0.03em',
                    lineHeight: 1.1,
                    textShadow: '0 0 40px rgba(168, 85, 247, 0.2)'
                }}>
                    The <span className="text-gradient">Ultimate</span><br />
                    Developer Toolkit
                </h1>
                <p style={{
                    fontSize: '1.25rem',
                    color: 'var(--text-muted)',
                    maxWidth: '650px',
                    margin: '0 auto var(--space-xl)',
                    lineHeight: 1.6
                }}>
                    A privacy-focused collection of essential utilities. <br />
                    Fast, secure, and always at your fingertips.
                </p>

                {/* Ctrl + K Visual Cue */}
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    padding: 'var(--space-sm) var(--space-lg)',
                    borderRadius: 'var(--radius-full)',
                    color: 'var(--text-main)',
                    fontSize: '0.95rem',
                    boxShadow: 'var(--glass-shadow)'
                }}>
                    <span>Press</span>
                    <span style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px 8px',
                        fontSize: '0.85rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: 'var(--accent)'
                    }}>
                        Ctrl
                    </span>
                    <span>+</span>
                    <span style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px 8px',
                        fontSize: '0.85rem',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 600,
                        color: 'var(--accent)'
                    }}>
                        K
                    </span>
                    <span>to search tools instantly</span>
                </div>
            </div>

            {/* Featured Tools Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 'var(--space-lg)'
            }}>
                <ToolCard
                    to="/diff"
                    icon={FileDiff}
                    title="Secure Diff"
                    description="Compare text and code safely offline."
                    color="#3b82f6"
                />
                <ToolCard
                    to="/uuid"
                    icon={Fingerprint}
                    title="UUID Generator"
                    description="Generate standard UUIDs in bulk."
                    color="#a855f7"
                />
                <ToolCard
                    to="/formatters"
                    icon={Braces}
                    title="Formatters"
                    description="Prettify JSON or clean up SQL queries."
                    color="#f43f5e"
                />
                <ToolCard
                    to="/css"
                    icon={Palette}
                    title="Glassmorphism"
                    description="Design beautiful frosted glass CSS effects."
                    color="#ec4899"
                />
                <ToolCard
                    to="/base64"
                    icon={Code}
                    title="Base64"
                    description="Encode and decode text to Base64 format."
                    color="var(--primary)"
                />
                <ToolCard
                    to="/jwt"
                    icon={Key}
                    title="JWT Decoder"
                    description="Inspect JSON Web Tokens securely."
                    color="var(--accent)"
                />
            </div>

            <Footer />
        </div>
    )
}
