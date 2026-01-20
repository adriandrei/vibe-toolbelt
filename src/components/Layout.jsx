import React, { useState, useEffect } from 'react'
import { Menu, Search } from 'lucide-react'
import Sidebar from './Sidebar'
import CommandPalette from './CommandPalette'

export default function Layout({ children }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024)
    const [isSearchOpen, setIsSearchOpen] = useState(false)

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

            <div
                className={isSidebarOpen ? 'desktop-sidebar-open' : ''}
                style={{
                    flex: 1,
                    marginLeft: 0, // Handled by CSS class .desktop-sidebar-open
                    transition: 'margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    width: '100%'
                }}
            >
                {/* Mobile Menu Trigger (Only visible on small screens VIA CSS) */}
                <div
                    className="mobile-only"
                    style={{
                        padding: 'var(--space-md)',
                        display: 'flex' // CSS will override this to none on desktop
                    }}
                >
                    <button
                        onClick={() => setIsSidebarOpen(true)}
                        style={{
                            padding: '8px',
                            color: 'var(--text-main)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        <Menu size={24} />
                    </button>
                </div>

                <main style={{ padding: 'var(--space-xl)', maxWidth: '1400px', width: '100%', margin: '0 auto' }}>
                    {children}
                </main>
            </div>
        </div>
    )
}
