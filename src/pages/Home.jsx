import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { TOOL_CATEGORIES } from '../components/Sidebar'
import SEO from '../components/SEO'
import { Search, ArrowRight, Github, Shield, Zap, Globe, Twitter, Linkedin, Share2, Check } from 'lucide-react'

const ToolCard = ({ to, icon: Icon, label }) => (
    <Link to={to} className="glass-panel group" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        padding: '16px',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        textDecoration: 'none',
        border: '1px solid var(--border)',
        background: 'var(--bg-panel)',
        position: 'relative',
        overflow: 'hidden'
    }}
        onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-4px)'
            e.currentTarget.style.borderColor = 'var(--primary)'
            e.currentTarget.style.boxShadow = 'var(--glass-shadow)'
            e.currentTarget.style.background = 'var(--bg-card)'
        }}
        onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'none'
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.boxShadow = 'none'
            e.currentTarget.style.background = 'var(--bg-panel)'
        }}
    >
        <div style={{
            color: 'var(--primary)',
            background: 'rgba(139, 92, 246, 0.1)',
            padding: '10px',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.3s ease'
        }}>
            <Icon size={24} />
        </div>
        <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '1rem', marginBottom: '2px' }}>{label}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Open tool</div>
        </div>
        <div style={{
            opacity: 0,
            transform: 'translateX(-10px)',
            transition: 'all 0.3s ease'
        }} className="group-hover-arrow">
            <ArrowRight size={16} color="var(--primary)" />
        </div>
    </Link>
)

const FeatureItem = ({ icon: Icon, title, description }) => (
    <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '24px',
        borderRadius: '16px',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)'
    }}>
        <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            background: 'var(--bg-app)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--primary)',
            marginBottom: '8px'
        }}>
            <Icon size={20} />
        </div>
        <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>{title}</h3>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            {description}
        </p>
    </div>
)

const Footer = () => (
    <footer style={{
        marginTop: 'auto',
        padding: '60px 0 40px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
        color: 'var(--text-muted)',
    }}>
        <div style={{ display: 'flex', gap: '32px' }}>
            <Link to="/privacy" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'var(--text-main)'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>Privacy Policy</Link>
            <Link to="/terms" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'var(--text-main)'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>Terms of Service</Link>
            <a href="mailto:adriandrei@hotmail.com" style={{ color: 'var(--text-muted)', textDecoration: 'none', transition: 'color 0.2s' }} onMouseEnter={e => e.target.style.color = 'var(--text-main)'} onMouseLeave={e => e.target.style.color = 'var(--text-muted)'}>Contact Support</a>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
            <span>&copy; {new Date().getFullYear()} Private Toolkit.</span>
            <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--text-dim)' }}></span>
            <span>Made with <span style={{ color: '#ec4899' }}>♥</span> for developers.</span>
        </div>
    </footer>
)

export default function Home() {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
            <SEO title="Home" />

            {/* Hero Section */}
            <div style={{
                textAlign: 'center',
                padding: 'var(--space-2xl) 0',
                position: 'relative'
            }}>
                {/* Background Glow */}
                <div style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: '600px',
                    height: '600px',
                    background: 'radial-gradient(circle at center, rgba(139, 92, 246, 0.15) 0%, transparent 70%)',
                    zIndex: -1,
                    pointerEvents: 'none'
                }}></div>

                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '6px 16px',
                    borderRadius: '100px',
                    background: 'rgba(139, 92, 246, 0.1)',
                    border: '1px solid rgba(139, 92, 246, 0.2)',
                    color: 'var(--primary)',
                    fontSize: '0.9rem',
                    fontWeight: 500,
                    marginBottom: '24px'
                }}>
                    <Zap size={16} />
                    <span>Updated with 40+ Tools</span>
                </div>

                <h1 style={{
                    fontSize: 'clamp(2.5rem, 5vw + 1rem, 4.5rem)',
                    marginBottom: '24px',
                    letterSpacing: '-0.03em',
                    lineHeight: 1.1,
                    fontWeight: 800
                }}>
                    The <span className="text-gradient">Ultimate</span><br />
                    Private Toolkit
                </h1>

                <p style={{
                    fontSize: '1.2rem',
                    color: 'var(--text-muted)',
                    maxWidth: '640px',
                    margin: '0 auto 40px',
                    lineHeight: 1.6
                }}>
                    A privacy-first collection of utilities designed for modern developers. <br className="hidden md:block" /> No ads, no tracking, just pure utility.
                </p>

                {/* Ctrl + K Visual Cue */}
                <div style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '12px',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    padding: '12px 24px',
                    borderRadius: '16px',
                    color: 'var(--text-main)',
                    fontSize: '1rem',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                    cursor: 'pointer',
                    transition: 'transform 0.2s'
                }}
                    onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                >
                    <Search size={20} className="text-muted" />
                    <span style={{ color: 'var(--text-muted)' }}>Press</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <kbd style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '0.85rem',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            minWidth: '24px',
                            textAlign: 'center'
                        }}>Ctrl</kbd>
                        <kbd style={{
                            background: 'var(--bg-card)',
                            border: '1px solid var(--border)',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '0.85rem',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 600,
                            minWidth: '24px',
                            textAlign: 'center'
                        }}>K</kbd>
                    </div>
                </div>
            </div>

            {/* Features Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: '24px',
                maxWidth: '1200px',
                margin: '0 auto 60px',
                width: '100%',
                padding: '0 20px'
            }}>
                <FeatureItem
                    icon={Shield}
                    title="Privacy First"
                    description="All processing happens locally in your browser. No data is ever sent to our servers."
                />
                <FeatureItem
                    icon={Globe}
                    title="Works Offline"
                    description="Install as a PWA and use all tools without an internet connection."
                />
                <FeatureItem
                    icon={Zap}
                    title="Blazing Fast"
                    description="Built with Vite and React for instant load times and smooth interactions."
                />
            </div>

            {/* Promotion / Spread the Word */}
            <div style={{
                maxWidth: '1200px',
                margin: '0 auto 60px',
                width: '100%',
                padding: '0 20px'
            }}>
                <div className="glass-panel" style={{
                    padding: '32px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '24px',
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05) 0%, rgba(59, 130, 246, 0.05) 100%)',
                    border: '1px solid rgba(139, 92, 246, 0.2)'
                }}>
                    <div style={{ flex: '1 1 300px' }}>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span role="img" aria-label="rocket">🚀</span> Spread the Word
                        </h2>
                        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                            Enjoying the Vibe Toolbelt? Help us grow by sharing it with your developer friends or starring us on GitHub!
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <button
                            onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent('Check out Vibe Toolbelt! A privacy-first developer toolkit. 🛠️✨')}&url=${encodeURIComponent(window.location.href)}`, '_blank')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 20px',
                                background: 'rgba(0, 0, 0, 0.5)',
                                color: '#ffffff',
                                border: '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 500,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.7)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)'}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231h0.001Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
                            </svg> Post
                        </button>
                        <button
                            onClick={() => window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.href)}`, '_blank')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 20px',
                                background: 'rgba(10, 102, 194, 0.1)',
                                color: '#0a66c2',
                                border: '1px solid rgba(10, 102, 194, 0.2)',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 500,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(10, 102, 194, 0.2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(10, 102, 194, 0.1)'}
                        >
                            <Linkedin size={18} /> Share
                        </button>
                        <button
                            onClick={() => window.open('https://github.com/adriandrei/vibe-toolbelt', '_blank')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 20px',
                                background: 'rgba(36, 41, 46, 0.1)',
                                color: '#24292e',
                                border: '1px solid rgba(36, 41, 46, 0.2)',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 500,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(36, 41, 46, 0.2)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(36, 41, 46, 0.1)'}
                        >
                            <Github size={18} /> Star on GitHub
                        </button>
                        <button
                            onClick={() => {
                                navigator.clipboard.writeText(window.location.href)
                                const btn = document.getElementById('copy-link-btn')
                                if (btn) {
                                    const originalText = btn.innerHTML
                                    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> Copied!'
                                    setTimeout(() => btn.innerHTML = originalText, 2000)
                                }
                            }}
                            id="copy-link-btn"
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 20px',
                                background: 'var(--bg-app)',
                                color: 'var(--text-main)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: 500,
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--text-muted)'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                        >
                            <Share2 size={18} /> Copy Link
                        </button>
                    </div>
                </div>
            </div>

            {/* All Tools Grid by Category */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '48px', maxWidth: '1200px', margin: '0 auto', width: '100%', padding: '0 20px' }}>
                {TOOL_CATEGORIES.map((category) => (
                    <div key={category.name} className="fade-in">
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            marginBottom: '24px',
                            color: 'var(--text-main)',
                            fontSize: '1.2rem',
                            fontWeight: 700,
                            letterSpacing: '-0.01em'
                        }}>
                            <div style={{
                                width: '32px', height: '32px',
                                background: 'var(--bg-panel)',
                                borderRadius: '8px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid var(--border)'
                            }}>
                                <category.icon size={18} color="var(--primary)" />
                            </div>
                            {category.name}
                            <div style={{
                                height: '1px', flex: 1,
                                background: 'linear-gradient(to right, var(--border), transparent)',
                                marginLeft: '16px'
                            }}></div>
                        </div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                            gap: '20px'
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
