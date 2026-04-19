import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { TOOL_CATEGORIES } from '../components/Sidebar'
import SEO from '../components/SEO'
import { Search, ArrowRight, Github, Shield, Zap, Globe, Share2, Linkedin } from 'lucide-react'
import { motion } from 'framer-motion'

const containerVariants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: { staggerChildren: 0.05 }
    }
}

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
}

const ToolCard = ({ to, icon: Icon, label }) => (
    <motion.div variants={itemVariants}>
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
            overflow: 'hidden',
            height: '100%'
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
                background: 'rgba(var(--primary-rgb), 0.1)',
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
    </motion.div>
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
                {/* Animated Background Glow */}
                <motion.div 
                    animate={{ 
                        scale: [1, 1.2, 1],
                        opacity: [0.3, 0.5, 0.3],
                    }}
                    transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                    style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '60vw',
                        height: '60vw',
                        maxWidth: '800px',
                        maxHeight: '800px',
                        background: 'radial-gradient(circle at center, hsla(var(--hue), 90%, 65%, 0.15) 0%, transparent 70%)',
                        zIndex: -1,
                        pointerEvents: 'none',
                        borderRadius: '50%'
                    }}
                ></motion.div>

                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                >
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
                        fontSize: 'clamp(3rem, 6vw + 1rem, 5.5rem)',
                        marginBottom: '24px',
                        letterSpacing: '-0.04em',
                        lineHeight: 1.1,
                        fontWeight: 900
                    }}>
                        The <span className="text-gradient">Ultimate</span><br />
                        Private Toolkit
                    </h1>

                    <p style={{
                        fontSize: '1.25rem',
                        color: 'var(--text-muted)',
                        maxWidth: '640px',
                        margin: '0 auto 40px',
                        lineHeight: 1.6
                    }}>
                        A privacy-first collection of utilities designed for modern developers. <br className="hidden md:block" /> No ads, no tracking, just pure utility.
                    </p>

                    {/* Ctrl + K Visual Cue */}
                    <motion.div
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '12px',
                            background: 'var(--bg-panel)',
                            border: '1px solid var(--border)',
                            padding: '16px 32px',
                            borderRadius: '24px',
                            color: 'var(--text-main)',
                            fontSize: '1.1rem',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
                            cursor: 'pointer',
                            zIndex: 10
                        }}
                        onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
                    >
                        <Search size={22} className="text-muted" />
                        <span style={{ color: 'var(--text-muted)' }}>Quick Search</span>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            <kbd style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '4px 10px',
                                fontSize: '0.9rem',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 600
                            }}>Ctrl</kbd>
                            <kbd style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border)',
                                borderRadius: '8px',
                                padding: '4px 10px',
                                fontSize: '0.9rem',
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 600
                            }}>K</kbd>
                        </div>
                    </motion.div>
                </motion.div>
            </div>

            {/* Bento Grid Features */}
            <motion.div 
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.2 }}
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gridAutoRows: 'auto',
                    gap: '24px',
                    maxWidth: '1200px',
                    margin: '0 auto 80px',
                    width: '100%',
                    padding: '0 20px'
                }}
            >
                {/* Feature 1 - Large spanning across 2 columns if space allows */}
                <div className="glass-panel" style={{
                    gridColumn: '1 / -1',
                    padding: '40px',
                    borderRadius: '24px',
                    background: 'linear-gradient(145deg, var(--bg-panel) 0%, rgba(139,92,246,0.05) 100%)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                    position: 'relative',
                    overflow: 'hidden'
                }}>
                    <div style={{
                        position: 'absolute', top: '-20%', right: '-5%', width: '300px', height: '300px',
                        background: 'radial-gradient(circle, hsla(var(--hue), 90%, 65%, 0.1) 0%, transparent 70%)',
                        borderRadius: '50%', pointerEvents: 'none'
                    }} />
                    <Shield size={32} color="var(--primary)" />
                    <h3 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Absolute Privacy Guarantee</h3>
                    <p style={{ fontSize: '1.1rem', color: 'var(--text-muted)', margin: 0, maxWidth: '600px', lineHeight: 1.6 }}>
                        Every single tool processes your data locally within your browser. There are no external API calls, no analytics tracking, and absolutely no telemetry. What happens on your machine stays on your machine.
                    </p>
                </div>
                
                {/* Feature 2 */}
                <div className="glass-panel" style={{
                    padding: '32px',
                    borderRadius: '24px',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.1)', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>
                        <Globe size={24} color="#3b82f6" />
                    </div>
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>Offline PWA</h3>
                    <p style={{ fontSize: '1rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                        Install the toolbelt as a Progressive Web App (PWA). It heavily caches assets allowing you to perform encoding, decoding, formatting, and cryptography entirely offline without an internet connection.
                    </p>
                </div>

                {/* Feature 3 */}
                <div className="glass-panel" style={{
                    padding: '32px',
                    borderRadius: '24px',
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px'
                }}>
                    <div style={{ background: 'rgba(236, 72, 153, 0.1)', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '12px' }}>
                        <Zap size={24} color="#ec4899" />
                    </div>
                    <h3 style={{ fontSize: '1.3rem', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>Blazing Fast</h3>
                    <p style={{ fontSize: '1rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
                        Architected with React and Vite. Tools load instantly due to aggressive route-based code splitting, avoiding bloated monolithic initial payloads. Instant UI feedback.
                    </p>
                </div>
            </motion.div>

            {/* All Tools Grid by Category */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '64px', maxWidth: '1200px', margin: '0 auto 60px', width: '100%', padding: '0 20px' }}>
                {TOOL_CATEGORIES.map((category, idx) => (
                    <motion.div 
                        key={category.name} 
                        initial="hidden"
                        whileInView="show"
                        viewport={{ once: true, margin: "-50px" }}
                        variants={containerVariants}
                    >
                        <motion.div variants={itemVariants} style={{
                            display: 'flex', alignItems: 'center', gap: 12,
                            marginBottom: '32px',
                            color: 'var(--text-main)',
                            fontSize: '1.4rem',
                            fontWeight: 800,
                            letterSpacing: '-0.01em'
                        }}>
                            <div style={{
                                width: '40px', height: '40px',
                                background: 'var(--bg-panel)',
                                borderRadius: '12px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                border: '1px solid var(--border)',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                            }}>
                                <category.icon size={20} color="var(--primary)" />
                            </div>
                            {category.name}
                            <div style={{
                                height: '1px', flex: 1,
                                background: 'linear-gradient(to right, var(--border), transparent)',
                                marginLeft: '24px'
                            }}></div>
                        </motion.div>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
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
                    </motion.div>
                ))}
            </div>
            
            {/* Promotion / Spread the Word (Bottom Bento) */}
            <motion.div 
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                style={{
                    maxWidth: '1200px',
                    margin: '0 auto 60px',
                    width: '100%',
                    padding: '0 20px'
                }}
            >
                <div className="glass-panel" style={{
                    padding: '40px',
                    borderRadius: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '32px',
                    background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)',
                    border: '1px solid rgba(139, 92, 246, 0.3)'
                }}>
                    <div style={{ flex: '1 1 300px' }}>
                        <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: 12 }}>
                            <span role="img" aria-label="rocket">🚀</span> Spread the Word
                        </h2>
                        <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', lineHeight: 1.6, margin: 0 }}>
                            Enjoying the Vibe Toolbelt? Help us grow by sharing it with your developer friends or starring us on GitHub!
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                        <button
                            onClick={() => window.open('https://github.com/adriandrei/vibe-toolbelt', '_blank')}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '12px 24px',
                                background: 'var(--text-main)',
                                color: 'var(--bg-app)',
                                border: 'none',
                                borderRadius: '12px',
                                cursor: 'pointer',
                                fontWeight: 600,
                                fontSize: '1rem',
                                transition: 'all 0.2s',
                                boxShadow: '0 8px 16px rgba(0,0,0,0.1)'
                            }}
                            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'}
                            onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
                        >
                            <Github size={20} /> Star on GitHub
                        </button>
                    </div>
                </div>
            </motion.div>

            <Footer />
        </div>
    )
}
