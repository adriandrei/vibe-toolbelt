import React from 'react'
import { Link } from 'react-router-dom'
import { Home, Search, ArrowLeft } from 'lucide-react'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

export default function NotFound() {
    useDocumentTitle('404 — Page Not Found')

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
            textAlign: 'center',
            padding: 'var(--space-xl)'
        }}>
            {/* Glitch-style 404 */}
            <div style={{
                fontSize: 'clamp(6rem, 15vw, 12rem)',
                fontWeight: 900,
                lineHeight: 1,
                background: 'linear-gradient(135deg, var(--primary), #a855f7, #ec4899)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.05em',
                marginBottom: 'var(--space-md)',
                userSelect: 'none',
                animation: 'pulse404 2s ease-in-out infinite alternate'
            }}>
                404
            </div>

            <h1 style={{
                fontSize: '1.5rem',
                fontWeight: 600,
                color: 'var(--text-main)',
                marginBottom: 'var(--space-sm)'
            }}>
                Page Not Found
            </h1>

            <p style={{
                color: 'var(--text-muted)',
                fontSize: '1rem',
                maxWidth: '400px',
                marginBottom: 'var(--space-xl)',
                lineHeight: 1.6
            }}>
                The tool you're looking for doesn't exist or has been moved.
                Try searching or head back home.
            </p>

            <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', justifyContent: 'center' }}>
                <Link
                    to="/"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '12px 24px',
                        background: 'var(--primary)',
                        color: '#fff',
                        borderRadius: 'var(--radius-md)',
                        textDecoration: 'none',
                        fontWeight: 600,
                        transition: 'transform 0.2s, box-shadow 0.2s',
                        boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.transform = 'translateY(-2px)'
                        e.currentTarget.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.5)'
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.transform = 'translateY(0)'
                        e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.4)'
                    }}
                >
                    <Home size={18} /> Go Home
                </Link>

                <button
                    onClick={() => window.history.back()}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '12px 24px',
                        background: 'transparent',
                        color: 'var(--text-main)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        fontWeight: 500,
                        transition: 'border-color 0.2s, background 0.2s'
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.borderColor = 'var(--primary)'
                        e.currentTarget.style.background = 'rgba(99, 102, 241, 0.1)'
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                        e.currentTarget.style.background = 'transparent'
                    }}
                >
                    <ArrowLeft size={18} /> Go Back
                </button>
            </div>

            <style>{`
                @keyframes pulse404 {
                    from { opacity: 0.8; filter: blur(0px); }
                    to { opacity: 1; filter: blur(0px); }
                }
            `}</style>
        </div>
    )
}
