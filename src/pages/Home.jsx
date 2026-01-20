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

export default function Home() {
    useDocumentTitle('Home')

    return (
        <div>
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-2xl)' }}>
                <h1 style={{ fontSize: '3rem', marginBottom: 'var(--space-sm)', letterSpacing: '-0.02em' }}>
                    <span className="text-gradient">Developer Tools</span>
                </h1>
                <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)', maxWidth: '600px', margin: '0 auto' }}>
                    A collection of essential utilities for modern web development.
                    Beautiful, fast, and secure.
                </p>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 'var(--space-lg)'
            }}>
                <ToolCard
                    to="/diff"
                    icon={FileDiff}
                    title="Secure Diff"
                    description="Compare text and code safely offline. No data is ever sent to a server."
                    color="#3b82f6"
                />
                <ToolCard
                    to="/uuid"
                    icon={Fingerprint}
                    title="UUID Generator"
                    description="Generate standard UUIDs in bulk. Fast, random, and copy-paste ready."
                    color="#a855f7"
                />
                <ToolCard
                    to="/formatters"
                    icon={Braces}
                    title="Formatters"
                    description="Prettify minified JSON or clean up messy SQL queries."
                    color="#f43f5e"
                />
                <ToolCard
                    to="/css"
                    icon={Palette}
                    title="Glassmorphism"
                    description="Design beautiful frosted glass CSS effects with a visual editor."
                    color="#ec4899"
                />
                <ToolCard
                    to="/base64"
                    icon={Code}
                    title="Base64 Converter"
                    description="Encode and decode text to Base64 format in real-time. Supports UTF-8."
                    color="var(--primary)"
                />
                <ToolCard
                    to="/jwt"
                    icon={Key}
                    title="JWT Decoder"
                    description="Decode JSON Web Tokens to inspect headers and claims without sending them to a server."
                    color="var(--accent)"
                />
                <ToolCard
                    to="/username"
                    icon={User}
                    title="Username Gen"
                    description="Generate secure, random, and unique usernames for your applications."
                    color="#10b981"
                />
            </div>
        </div>
    )
}
