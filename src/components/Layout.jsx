import React, { useState, useEffect } from 'react'
import { Menu, Search, History } from 'lucide-react'
import Sidebar from './Sidebar'
import SmartPaste from './SmartPaste'
import CommandPalette from './CommandPalette'
import HistoryPanel from './HistoryPanel'

export default function Layout({ children }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024)
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [isHistoryOpen, setIsHistoryOpen] = useState(false)

    // Handle Resize
    useEffect(() => {
        const handleResize = () => {
            if (window.innerWidth > 1024) {
                setIsSidebarOpen(true)
            } else {
                setIsSidebarOpen(false)
            }
        }
        window.addEventListener('resize', handleResize)
        return () => window.removeEventListener('resize', handleResize)
    }, [])

    // Global Search Shortcut (Ctrl+K or Cmd+K)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault()
                setIsSearchOpen(true)
            }
            // Ctrl+H for history
            if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
                e.preventDefault()
                setIsHistoryOpen(prev => !prev)
            }
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    return (
        <div style={{ minHeight: '100vh', display: 'flex' }}>
            <Sidebar
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
                onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
            />

            <CommandPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
            <SmartPaste />
            <HistoryPanel isOpen={isHistoryOpen} onClose={() => setIsHistoryOpen(false)} />

            <div
                className={isSidebarOpen ? 'desktop-sidebar-open' : ''}
                style={{
                    flex: 1,
                    marginLeft: 0,
                    transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%',
                    minWidth: 0 // Prevent flex child overflow issues
                }}
            >
                {/* Mobile Menu Trigger & Header */}
                <div
                    className="tablet-down"
                    style={{
                        padding: 'var(--space-md)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid var(--border)',
                        background: 'rgba(9, 9, 11, 0.8)',
                        backdropFilter: 'blur(10px)',
                        position: 'sticky',
                        top: 0,
                        zIndex: 40
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                        <button
                            onClick={() => setIsSidebarOpen(true)}
                            aria-label="Open menu"
                            style={{
                                padding: '8px',
                                color: 'var(--text-main)',
                                cursor: 'pointer',
                                display: 'flex'
                            }}
                        >
                            <Menu size={24} />
                        </button>
                        <span style={{ fontWeight: 600, fontSize: '1.1rem' }} className="text-gradient">Vibe Tools</span>
                    </div>
                    <button
                        onClick={() => setIsHistoryOpen(true)}
                        aria-label="Open history"
                        style={{
                            padding: '8px',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            display: 'flex'
                        }}
                    >
                        <History size={20} />
                    </button>
                </div>

                {/* Desktop History Button */}
                <button
                    onClick={() => setIsHistoryOpen(true)}
                    className="desktop-only"
                    aria-label="Open history (Ctrl+H)"
                    title="Recent Operations (Ctrl+H)"
                    style={{
                        position: 'fixed',
                        top: 'var(--space-md)',
                        right: 'var(--space-md)',
                        padding: '10px 14px',
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        zIndex: 50,
                        fontSize: '0.85rem'
                    }}
                >
                    <History size={16} /> History
                </button>

                <main style={{ padding: 'var(--space-md) var(--space-md) var(--space-xl)', width: '100%', maxWidth: '1600px', margin: '0 auto' }}>
                    {children}
                </main>
            </div>
        </div>
    )
}
