import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { TOOL_CATEGORIES } from '../components/Sidebar'
import SEO from '../components/SEO'
import { Search, ArrowRight, Github, Shield, Zap, Globe } from 'lucide-react'

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
            <span>&copy; {new Date().getFullYear()} Vibe Toolbelt.</span>
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
                    Developer Toolkit
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
