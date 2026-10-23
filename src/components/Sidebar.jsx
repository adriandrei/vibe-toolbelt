import { useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Moon, Pin, Search, Star, Sun, Wand2, X } from 'lucide-react'
import { useFavorites } from '../hooks/useFavorites'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useTheme } from './ThemeProvider'
import { usePipeline } from '../contexts/PipelineContext'
import { ALL_TOOLS, SETTINGS_TOOL, TOOL_CATEGORIES, searchTools } from '../config/tools'
import { BRAND } from '../config/brand'

const navItemStyle = (isActive) => ({
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-sm)',
    padding: '10px 12px',
    paddingRight: 64,
    margin: '1px 0',
    borderRadius: 'var(--radius-md)',
    background: isActive ? 'var(--primary-glow)' : 'transparent',
    color: isActive ? 'var(--primary-text)' : 'var(--text-muted)',
    fontSize: '0.9rem',
    fontWeight: isActive ? 600 : 400,
    minHeight: 40,
    transition: 'background-color 0.15s ease, color 0.15s ease',
})

function NavItem({ item, onNavigate, isFav, onToggleFav, showPin }) {
    const { setPinnedToolRoute, pinnedToolRoute } = usePipeline()
    const isPinned = pinnedToolRoute === item.path

    return (
        <div className="nav-item-wrapper" style={{ position: 'relative' }}>
            <NavLink
                to={item.path}
                end
                onClick={onNavigate}
                className="sidebar-link"
                style={({ isActive }) => navItemStyle(isActive)}
            >
                <item.icon size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
            </NavLink>

            <div style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
                {showPin && item.path !== '/' && (
                    <button
                        type="button"
                        className={`fav-btn icon-btn icon-btn-sm ${isPinned ? 'active' : ''}`}
                        title={isPinned ? 'Unpin from split view' : 'Pin to split view'}
                        aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label} to split view`}
                        aria-pressed={isPinned}
                        onClick={() => setPinnedToolRoute(isPinned ? null : item.path)}
                        style={{ color: isPinned ? 'var(--primary-text)' : undefined }}
                    >
                        <Pin size={14} fill={isPinned ? 'currentColor' : 'none'} aria-hidden="true" />
                    </button>
                )}
                <button
                    type="button"
                    className={`fav-btn icon-btn icon-btn-sm ${isFav ? 'active' : ''}`}
                    aria-label={isFav ? `Remove ${item.label} from favorites` : `Add ${item.label} to favorites`}
                    aria-pressed={isFav}
                    title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    onClick={() => onToggleFav(item.path)}
                    style={{ color: isFav ? 'var(--warning)' : undefined }}
                >
                    <Star size={14} fill={isFav ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
            </div>
        </div>
    )
}

function CategoryGroup({ category, collapsed, onToggle, children }) {
    const listId = `nav-${category.id}`
    return (
        <div style={{ marginBottom: 'var(--space-sm)' }}>
            <button
                type="button"
                aria-expanded={!collapsed}
                aria-controls={listId}
                onClick={onToggle}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-sm)',
                    width: '100%',
                    padding: '8px',
                    color: 'var(--text-dim)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    minHeight: 36,
                }}
            >
                <category.icon size={14} aria-hidden="true" />
                {category.name}
                <span style={{ marginLeft: 'auto', display: 'flex' }}>
                    {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                </span>
            </button>
            {!collapsed && <div id={listId} style={{ paddingLeft: 6 }}>{children}</div>}
        </div>
    )
}

function ThemeToggle() {
    const { theme, toggle } = useTheme()
    const isDark = theme === 'dark'
    return (
        <button
            type="button"
            onClick={toggle}
            className="btn btn-secondary btn-sm"
            aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            style={{ flex: 1 }}
        >
            {isDark ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
            {isDark ? 'Light mode' : 'Dark mode'}
        </button>
    )
}

export default function Sidebar({ isOpen, isDesktop, onClose, onOpenSearch }) {
    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const { favorites, toggleFavorite } = useFavorites()
    const [collapsed, setCollapsed] = useLocalStorage('pt-sidebar-collapsed', [])
    const navigate = useNavigate()
    const searchRef = useRef(null)

    const searchResults = query.trim() ? searchTools(query) : null
    const favItems = favorites.map(path => ALL_TOOLS.find(t => t.path === path)).filter(Boolean)
    const collapsedList = Array.isArray(collapsed) ? collapsed : []

    const afterNavigate = () => {
        if (!isDesktop) onClose()
    }

    const goTo = (path) => {
        setQuery('')
        navigate(path)
        afterNavigate()
    }

    const renderItem = (item) => (
        <NavItem
            key={item.path}
            item={item}
            onNavigate={afterNavigate}
            isFav={favorites.includes(item.path)}
            onToggleFav={toggleFavorite}
            showPin={isDesktop}
        />
    )

    return (
        <>
            {!isDesktop && (
                <div
                    aria-hidden="true"
                    onClick={onClose}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'var(--overlay)',
                        backdropFilter: 'blur(4px)',
                        opacity: isOpen ? 1 : 0,
                        pointerEvents: isOpen ? 'auto' : 'none',
                        transition: 'opacity 0.3s',
                        zIndex: 45,
                    }}
                />
            )}

            <aside
                className="sidebar-fixed"
                aria-label="Tools"
                // Off-screen on small screens: keep it out of the tab order
                inert={!isOpen ? '' : undefined}
                onKeyDown={(e) => {
                    if (e.key === 'Escape' && !isDesktop) onClose()
                }}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: 'var(--sidebar-width)',
                    maxWidth: '85vw',
                    zIndex: 50,
                    borderRight: '1px solid var(--border)',
                    transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg-panel)',
                }}
            >
                <div style={{ padding: 'var(--space-md)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <Link to="/" onClick={() => { setQuery(''); afterNavigate() }} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                            <Wand2 size={24} aria-hidden="true" style={{ color: 'var(--primary-text)' }} />
                            <span className="text-gradient" style={{ fontWeight: 700, fontSize: '1.15rem' }}>{BRAND.name}</span>
                        </Link>
                        {!isDesktop && (
                            <button type="button" className="icon-btn" aria-label="Close menu" onClick={onClose}>
                                <X size={20} aria-hidden="true" />
                            </button>
                        )}
                    </div>

                    <div style={{ position: 'relative' }}>
                        <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }} />
                        <input
                            ref={searchRef}
                            type="search"
                            placeholder="Search tools…"
                            aria-label="Search tools"
                            value={query}
                            onChange={e => {
                                setQuery(e.target.value)
                                setActiveIndex(0)
                            }}
                            onKeyDown={e => {
                                if (!searchResults?.length) return
                                if (e.key === 'ArrowDown') {
                                    e.preventDefault()
                                    setActiveIndex(i => Math.min(i + 1, searchResults.length - 1))
                                } else if (e.key === 'ArrowUp') {
                                    e.preventDefault()
                                    setActiveIndex(i => Math.max(i - 1, 0))
                                } else if (e.key === 'Enter') {
                                    e.preventDefault()
                                    goTo(searchResults[Math.min(activeIndex, searchResults.length - 1)].path)
                                } else if (e.key === 'Escape') {
                                    setQuery('')
                                }
                            }}
                            autoComplete="off"
                            style={{ padding: '8px 34px', fontSize: '0.9rem', borderRadius: 'var(--radius-sm)' }}
                        />
                        {query && (
                            <button
                                type="button"
                                className="icon-btn icon-btn-sm"
                                onClick={() => { setQuery(''); searchRef.current?.focus() }}
                                aria-label="Clear search"
                                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)' }}
                            >
                                <X size={14} aria-hidden="true" />
                            </button>
                        )}
                    </div>
                </div>

                <nav aria-label="Tool categories" style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-sm) var(--space-md) var(--space-md)' }}>
                    {searchResults ? (
                        <>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-dim)', margin: '8px 0', textTransform: 'uppercase', letterSpacing: '0.05em' }} aria-live="polite">
                                {searchResults.length ? `${searchResults.length} result${searchResults.length === 1 ? '' : 's'}` : 'No tools found'}
                            </div>
                            {searchResults.length === 0 && (
                                <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSearch}>
                                    Try the command palette
                                </button>
                            )}
                            {searchResults.map((item, i) => (
                                <div key={item.path} style={{ outline: i === activeIndex ? '1px solid var(--primary-border)' : 'none', borderRadius: 'var(--radius-md)' }}>
                                    {renderItem(item)}
                                </div>
                            ))}
                        </>
                    ) : (
                        <>
                            {favItems.length > 0 && (
                                <div style={{ marginBottom: 'var(--space-md)' }}>
                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--warning)', margin: '8px 0', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, letterSpacing: '0.05em' }}>
                                        <Star size={12} fill="currentColor" aria-hidden="true" /> Favorites
                                    </div>
                                    {favItems.map(renderItem)}
                                    <div style={{ height: 1, background: 'var(--border)', margin: '12px 0 4px' }} />
                                </div>
                            )}
                            {TOOL_CATEGORIES.map(category => (
                                <CategoryGroup
                                    key={category.id}
                                    category={category}
                                    collapsed={collapsedList.includes(category.id)}
                                    onToggle={() => setCollapsed(prev => {
                                        const list = Array.isArray(prev) ? prev : []
                                        return list.includes(category.id) ? list.filter(id => id !== category.id) : [...list, category.id]
                                    })}
                                >
                                    {category.items.map(renderItem)}
                                </CategoryGroup>
                            ))}
                        </>
                    )}
                </nav>

                <div style={{ padding: 'var(--space-md)', borderTop: '1px solid var(--border)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                    <ThemeToggle />
                    <NavLink
                        to={SETTINGS_TOOL.path}
                        onClick={afterNavigate}
                        className="btn btn-secondary btn-sm"
                        aria-label="Settings"
                        title="Settings: appearance and AI"
                    >
                        <SETTINGS_TOOL.icon size={14} aria-hidden="true" />
                        <span>Settings</span>
                    </NavLink>
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: 'var(--space-md)', fontSize: '0.75rem' }}>
                        <Link to="/privacy" onClick={afterNavigate} style={{ color: 'var(--text-dim)' }}>Privacy</Link>
                        <Link to="/terms" onClick={afterNavigate} style={{ color: 'var(--text-dim)' }}>Terms</Link>
                    </div>
                </div>
            </aside>
        </>
    )
}
