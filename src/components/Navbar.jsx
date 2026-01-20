import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Code, Key, User, Home, Wand2, ShieldCheck, FileDiff, Fingerprint, Braces, Palette } from 'lucide-react'

const NavItem = ({ to, icon: Icon, label }) => {
    const location = useLocation()
    const isActive = location.pathname === to

    return (
        <Link
            to={to}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-sm)',
                padding: 'var(--space-sm) var(--space-md)',
                borderRadius: 'var(--radius-md)',
                background: isActive ? 'var(--primary-glow)' : 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                transition: 'all 0.2s ease',
                fontWeight: isActive ? 500 : 400,
            }}
            className="nav-item"
        >
            <Icon size={18} />
            <span>{label}</span>
        </Link>
    )
}

export default function Navbar() {
    return (
        <nav className="glass-panel" style={{
            marginBottom: 'var(--space-xl)',
            padding: 'var(--space-sm)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 'var(--space-md)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
                <Link to="/" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    padding: 'var(--space-sm)',
                    fontWeight: 'bold',
                    fontSize: '1.2rem',
                    color: 'var(--text-main)'
                }}>
                    <Wand2 size={24} color="var(--primary)" />
                    <span className="text-gradient">DevTools</span>
                </Link>

                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-xs)',
                    padding: 'var(--space-xs) var(--space-sm)',
                    background: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid rgba(16, 185, 129, 0.2)',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '0.8rem',
                    color: '#10b981',
                    fontWeight: 600
                }}>
                    <ShieldCheck size={14} />
                    <span>Offline & Secure</span>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                <NavItem to="/" icon={Home} label="Home" />
                <NavItem to="/diff" icon={FileDiff} label="Diff" />
                <NavItem to="/uuid" icon={Fingerprint} label="UUID" />
                <NavItem to="/formatters" icon={Braces} label="Format" />
                <NavItem to="/css" icon={Palette} label="Glass" />
                <NavItem to="/base64" icon={Code} label="Base64" />
                <NavItem to="/jwt" icon={Key} label="JWT" />
                <NavItem to="/username" icon={User} label="User" />
            </div>
        </nav>
    )
}
