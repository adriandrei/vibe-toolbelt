import React, { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
    Home,
    Wand2,
    ChevronRight,
    ChevronDown,
    Menu,
    X,
    Code, Key, User, FileDiff, Fingerprint, Braces, Palette,
    ShieldCheck, ArrowRightLeft, FileText, Hash, Shield, Layers, Eye, Link2, Globe, Database, Type,
    Search, Star, Clock, Image, Lock, Monitor, Terminal, Pipette, Triangle, Network, Regex, QrCode, CaseSensitive, FileImage, Camera, FileStack, Video, Aperture, Zap, Keyboard,
    Binary, ListOrdered, Server, ShieldAlert, Paintbrush, AlignLeft, FileCode,
    Sun, Moon, Film, Pin,
    Brain, Settings, Sparkles, Bot
} from 'lucide-react'
import { useFavorites } from '../hooks/useFavorites'
import { useTheme } from './ThemeProvider'
import PrivacyBadge from './PrivacyBadge'
import { usePipeline } from '../contexts/PipelineContext'

// Map of categories and tools
export const TOOL_CATEGORIES = [
    {
        name: 'Core',
        icon: Wand2,
        items: [
            { to: '/', icon: Home, label: 'Home' },
            { to: '/recorder', icon: Video, label: 'Screen Recorder' },
            { to: '/video', icon: Film, label: 'Video Studio' },
            { to: '/inspect', icon: Search, label: 'Inspector' },
            { to: '/api', icon: Zap, label: 'API Tester' },
            { to: '/image', icon: FileImage, label: 'Image Converter' },
        ]
    },
    {
        name: 'AI & Intelligence',
        icon: Sparkles,
        items: [
            { to: '/ai-settings', icon: Settings, label: 'AI Settings' },
            /* future ai tools here */
        ]
    },
    {
        name: 'Converters',
        icon: Code,
        items: [
            { to: '/base64', icon: Code, label: 'Base64' },
            { to: '/csv-json', icon: ArrowRightLeft, label: 'CSV <> JSON' },
            { to: '/hex', icon: FileCode, label: 'Hex Viewer' },
            { to: '/formatters', icon: Braces, label: 'Formatters' },
            { to: '/converter', icon: ArrowRightLeft, label: 'JSON <> YAML' },
            { to: '/type-converter', icon: FileCode, label: 'JSON to Type' },
            { to: '/markdown', icon: FileText, label: 'Markdown' },
            { to: '/cron', icon: Clock, label: 'Cron Parser' },
            { to: '/unix', icon: Clock, label: 'Unix Timestamp' },
            { to: '/qrcode', icon: QrCode, label: 'QR Code' },
            { to: '/pdf', icon: FileStack, label: 'PDF Tools' },
            { to: '/image-base64', icon: Image, label: 'Base64 Image' },
            { to: '/favicon', icon: Layers, label: 'Favicon Generator' },
            { to: '/keycode', icon: Keyboard, label: 'Keycode' },
            { to: '/svg', icon: Image, label: 'SVG Compressor' },
            { to: '/urlencode', icon: Link2, label: 'URL Encode' },
            { to: '/html-entity', icon: Code, label: 'HTML Entity' },
            { to: '/number-base', icon: Binary, label: 'Number Base' },
        ]
    },
    {
        name: 'Security',
        icon: ShieldCheck,
        items: [
            { to: '/bcrypt', icon: Shield, label: 'Bcrypt Hash' },
            { to: '/aes', icon: Lock, label: 'AES Encrypt' },
            { to: '/otp', icon: Clock, label: 'OTP / TOTP' },
            { to: '/jwt', icon: Key, label: 'JWT Decoder' },
            { to: '/diff', icon: FileDiff, label: 'Secure Diff' },
            { to: '/uuid', icon: Fingerprint, label: 'UUID Gen' },
            { to: '/username', icon: User, label: 'Username' },
            { to: '/hash', icon: Hash, label: 'Hash Gen' },
            { to: '/hmac', icon: Shield, label: 'HMAC Gen' },
            { to: '/rsa', icon: Lock, label: 'RSA Key Gen' },
            { to: '/password', icon: Shield, label: 'Password Audit' },
            { to: '/nanoid', icon: Fingerprint, label: 'Nano ID / ULID' },
            { to: '/chmod', icon: ShieldAlert, label: 'Chmod Calc' },
        ]
    },
    {
        name: 'Web',
        icon: Globe,
        items: [
            { to: '/url', icon: Link2, label: 'URL Parser' },
            { to: '/ua', icon: Monitor, label: 'User Agent' },
            { to: '/curl', icon: Terminal, label: 'Curl to Fetch' },
            { to: '/cidr', icon: Network, label: 'IP / CIDR' },
            { to: '/meta', icon: Globe, label: 'Meta Tags' },
            { to: '/http-status', icon: Server, label: 'HTTP Status' },
        ]
    },
    {
        name: 'Text',
        icon: AlignLeft,
        items: [
            { to: '/text-stats', icon: AlignLeft, label: 'Text Stats' },
            { to: '/list', icon: ListOrdered, label: 'List Sorter' },
            { to: '/case', icon: CaseSensitive, label: 'Case Converter' },
            { to: '/regex', icon: Regex, label: 'Regex Tester' },
            { to: '/lorem', icon: Type, label: 'Lorem Ipsum' },
        ]
    },
    {
        name: 'Privacy',
        icon: Eye,
        items: [
            { to: '/privacy-scanner', icon: ShieldAlert, label: 'Privacy Scanner' },
            { to: '/exif', icon: Aperture, label: 'EXIF Viewer' },
        ]
    },
    {
        name: 'Faker',
        icon: Database,
        items: [
            { to: '/faker', icon: Database, label: 'Data Gen' },
        ]
    },
    {
        name: 'Design',
        icon: Palette,
        items: [
            { to: '/css', icon: Palette, label: 'Glassmorphism' },
            { to: '/gradient', icon: Pipette, label: 'Gradient' },
            { to: '/triangle', icon: Triangle, label: 'Triangle' },
            { to: '/color-blindness', icon: Eye, label: 'Color Blindness' },
            { to: '/box-shadow', icon: Layers, label: 'Box Shadow' },
            { to: '/snippets', icon: Camera, label: 'Code Snippets' },
            { to: '/color', icon: Paintbrush, label: 'Color Converter' },
        ]
    }
]

const NavItem = ({ item, onClick, isFav, onToggleFav }) => {
    const location = useLocation()
    const isActive = location.pathname === item.to
    const { setPinnedToolRoute, pinnedToolRoute } = usePipeline()
    const isPinned = pinnedToolRoute === item.to

    return (
        <div
            className="nav-item-wrapper"
            style={{ position: 'relative' }}
        >
            <Link
                to={item.to}
                onClick={onClick}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    padding: '12px', /* Increased from 8px 12px for touch target */
                    margin: '2px 0',
                    borderRadius: 'var(--radius-md)',
                    background: isActive ? 'var(--primary-glow)' : 'transparent',
                    color: isActive ? 'var(--primary)' : 'var(--text-muted)',
                    textDecoration: 'none',
                    fontSize: '0.9rem',
                    fontWeight: isActive ? 500 : 400,
                    transition: 'all 0.2s',
                    paddingRight: '60px', // Space for star and pin
                    minHeight: '44px' /* Ensure min touch target height */
                }}
            >
                <item.icon size={16} />
                <span>{item.label}</span>
            </Link>

            <div style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
                <button
                    className={`fav-btn ${isPinned ? 'active' : ''}`}
                    title={isPinned ? "Unpin tool" : "Pin tool to split view"}
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setPinnedToolRoute(isPinned ? null : item.to)
                    }}
                    style={{
                        border: 'none',
                        background: 'none',
                        color: isPinned ? 'var(--primary)' : 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: '4px 6px',
                        opacity: isPinned ? 1 : 0, // Relies on fav-btn hover logic in CSS
                        transition: 'opacity 0.2s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    <Pin size={14} fill={isPinned ? 'currentColor' : 'none'} />
                </button>

                <button
                    className={`fav-btn ${isFav ? 'active' : ''}`}
                    aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        onToggleFav(item.to)
                    }}
                    style={{
                        border: 'none',
                        background: 'none',
                        color: isFav ? '#eab308' : 'var(--text-dim)',
                        cursor: 'pointer',
                        padding: '4px 6px',
                        opacity: isFav ? 1 : 0,
                        transition: 'opacity 0.2s',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    <Star size={14} fill={isFav ? 'currentColor' : 'none'} />
                </button>
            </div>
        </div>
    )
}

const CategoryGroup = ({ category, onMobileClick, favorites, toggleFavorite }) => {
    const [isOpen, setIsOpen] = useState(true)

    return (
        <div style={{ marginBottom: 'var(--space-md)' }}>
            <button
                aria-label={isOpen ? `Collapse ${category.name} category` : `Expand ${category.name} category`}
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    width: '100%',
                    padding: '8px',
                    color: 'var(--text-dim)',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                    border: 'none',
                    background: 'none',
                    minHeight: '44px' /* Accessible height */
                }}
            >
                <category.icon size={14} />
                {category.name}
                <div style={{ marginLeft: 'auto' }}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
            </button>

            {isOpen && (
                <div style={{ paddingLeft: '8px' }}>
                    {category.items.map(item => (
                        <NavItem
                            key={item.to}
                            item={item}
                            onClick={onMobileClick}
                            isFav={favorites.includes(item.to)}
                            onToggleFav={toggleFavorite}
                        />
                    ))}
                </div>
            )}
        </div>
    )
}

const ThemeToggle = () => {
    const { theme, toggle } = useTheme()
    const isDark = theme === 'dark'

    return (
        <button
            onClick={toggle}
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                cursor: 'pointer',
                color: 'var(--text-muted)',
                fontSize: '0.8rem',
                transition: 'all 0.3s ease',
                width: '100%',
                justifyContent: 'center'
            }}
        >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            {isDark ? 'Light Mode' : 'Dark Mode'}
        </button>
    )
}

export default function Sidebar({ isOpen, onClose }) {
    const [query, setQuery] = useState('')
    const { favorites, toggleFavorite } = useFavorites()

    // Flatten logic for search
    const allItems = TOOL_CATEGORIES.flatMap(cat => cat.items)
    const favItems = allItems.filter(item => favorites.includes(item.to))

    // Search filtering
    const searchResults = query
        ? allItems.filter(item => item.label.toLowerCase().includes(query.toLowerCase()))
        : null

    return (
        <>
            {/* Mobile Backdrop */}
            <div
                className="tablet-down"
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.5)',
                    backdropFilter: 'blur(4px)',
                    opacity: isOpen ? 1 : 0,
                    pointerEvents: isOpen ? 'auto' : 'none',
                    transition: 'opacity 0.3s',
                    zIndex: 40
                }}
                onClick={onClose}
            />

            <aside
                className="glass-panel sidebar-fixed"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: 'var(--sidebar-width)',
                    zIndex: 50,
                    borderRight: '1px solid var(--border)',
                    borderTop: 'none',
                    borderBottom: 'none',
                    borderLeft: 'none',
                    borderRadius: 0,
                    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg-panel)',
                    backdropFilter: 'blur(20px)'
                }}
            >
                {/* Header & Search */}
                <div style={{
                    padding: 'var(--space-md)',
                    borderBottom: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-md)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Link to="/" onClick={() => { setQuery(''); window.innerWidth <= 1024 && onClose(); }} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', textDecoration: 'none' }}>
                            <Wand2 size={24} color="var(--primary)" />
                            <span className="text-gradient" style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>Private Toolkit</span>
                        </Link>
                        <button
                            aria-label="Close sidebar"
                            className="mobile-only"
                            onClick={onClose}
                            style={{
                                color: 'var(--text-muted)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '8px', /* Better touch target */
                                minWidth: '44px',
                                minHeight: '44px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                        >
                            <X size={20} />
                        </button>
                    </div>


                    {/* Integrated Search */}
                    <div style={{ position: 'relative' }}>
                        <Search size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
                        <input
                            type="text"
                            placeholder="Search tools..."
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '8px 34px 8px 34px',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                background: 'var(--bg-app)',
                                color: 'var(--text-main)',
                                fontSize: '0.9rem'
                            }}
                            autoComplete="off"
                            name="app-search-tool-query"
                        />
                        {query && (
                            <button
                                onClick={() => setQuery('')}
                                aria-label="Clear search"
                                style={{
                                    position: 'absolute',
                                    right: 8,
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    transition: 'background 0.2s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-panel)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Scrollable Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-md)' }}>

                    {/* Search Results Mode */}
                    {searchResults ? (
                        <>
                            <div style={{
                                fontSize: '0.8rem',
                                fontWeight: 700,
                                color: 'var(--text-muted)',
                                marginBottom: 8,
                                textTransform: 'uppercase'
                            }}>
                                Search Results
                            </div>
                            {searchResults.length === 0 ? (
                                <div style={{ color: 'var(--text-dim)', fontStyle: 'italic', fontSize: '0.9rem' }}>No tools found.</div>
                            ) : (
                                searchResults.map(item => (
                                    <NavItem
                                        key={item.to}
                                        item={item}
                                        onClick={() => window.innerWidth <= 1024 && onClose()}
                                        isFav={favorites.includes(item.to)}
                                        onToggleFav={toggleFavorite}
                                    />
                                ))
                            )}
                        </>
                    ) : (
                        <>
                            {/* Favorites Section */}
                            {favItems.length > 0 && (
                                <div style={{ marginBottom: 'var(--space-lg)' }}>
                                    <div style={{
                                        fontSize: '0.75rem',
                                        fontWeight: 700,
                                        color: '#eab308',
                                        marginBottom: 8,
                                        textTransform: 'uppercase',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6
                                    }}>
                                        <Star size={12} fill="currentColor" /> Favorites
                                    </div>
                                    {favItems.map(item => (
                                        <NavItem
                                            key={item.to}
                                            item={item}
                                            onClick={() => window.innerWidth <= 1024 && onClose()}
                                            isFav={true}
                                            onToggleFav={toggleFavorite}
                                        />
                                    ))}
                                    <div style={{ height: 1, background: 'var(--border)', margin: '12px 0' }} />
                                </div>
                            )}

                            {/* Standard Categories */}
                            {TOOL_CATEGORIES.map(category => (
                                <CategoryGroup
                                    key={category.name}
                                    category={category}
                                    onMobileClick={() => window.innerWidth <= 1024 && onClose()}
                                    favorites={favorites}
                                    toggleFavorite={toggleFavorite}
                                />
                            ))}
                        </>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: 'var(--space-md)',
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-sm)'
                }}>
                    <ThemeToggle />
                    <PrivacyBadge />
                </div>
            </aside>
        </>
    )
}
