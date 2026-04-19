import React, { useState, useEffect } from 'react'
import { Menu, Search } from 'lucide-react'
import Sidebar from './Sidebar'
import SmartPaste from './SmartPaste'
import CommandPalette from './CommandPalette'
import PrivacyBadge from './PrivacyBadge'
import AIStatusBadge from './AIStatusBadge'
import AIAssistant from './AIAssistant'
import { usePipeline } from '../contexts/PipelineContext'
import { useAI } from '../contexts/AIContext'
import { ROUTE_MAP } from '../routes'
import { X } from 'lucide-react'
import { Suspense } from 'react'


export default function Layout({ children }) {
    const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth > 1024)
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const [isDesktop, setIsDesktop] = useState(window.innerWidth > 1024)

    const { pinnedToolRoute, setPinnedToolRoute } = usePipeline()
    const { aiPanelOpen } = useAI()
    
    // Derived pinned component
    const PinnedComponent = pinnedToolRoute && ROUTE_MAP[pinnedToolRoute] ? ROUTE_MAP[pinnedToolRoute] : null
    const showSplitPane = isDesktop && PinnedComponent !== null


    useEffect(() => {
        const handleResize = () => {
            const desktop = window.innerWidth > 1024
            if (desktop) {
                setIsSidebarOpen(true)
            } else {
                setIsSidebarOpen(false)
            }
            setIsDesktop(desktop)
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
            <SmartPaste />
            {/* Global AI Assistant Panel */}
            <AIAssistant />

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
                {/* Header Row */}
                <div
                    style={{
                        padding: 'var(--space-md) var(--space-lg)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        borderBottom: '1px solid var(--border)',
                        background: 'rgba(9, 9, 11, 0.4)',
                        backdropFilter: 'blur(10px)',
                        position: 'sticky',
                        top: 0,
                        zIndex: 40,
                        height: '60px'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', width: '100%' }}>
                        <button
                            className="tablet-down"
                            onClick={() => setIsSidebarOpen(true)}
                            aria-label="Open menu"
                            style={{
                                padding: '8px',
                                color: 'var(--text-main)',
                                cursor: 'pointer',
                                display: 'flex',
                                border: 'none',
                                background: 'none'
                            }}
                        >
                            <Menu size={20} />
                        </button>
                        
                        <div className="tablet-down" style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                             <span className="text-gradient">Private Toolkit</span>
                        </div>
                        
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <AIStatusBadge />
                            <div style={{ height: '16px', width: '1px', background: 'var(--border)' }}></div>
                            <PrivacyBadge />
                        </div>
                    </div>
                </div>

                {/* Desktop History Button */}


                <main style={{ 
                    padding: showSplitPane ? '0' : 'var(--space-md) var(--space-md) var(--space-xl)', 
                    width: '100%', 
                    maxWidth: showSplitPane ? '100%' : '1600px', 
                    margin: '0 auto', 
                    display: showSplitPane ? 'flex' : 'block', 
                    flex: 1,
                    overflow: 'hidden' 
                }}>
                    
                    {/* Left Pane: Current Route */}
                    <div style={{ flex: 1, minWidth: 0, padding: showSplitPane ? 'var(--space-md) var(--space-md) var(--space-xl)' : 0, overflowY: showSplitPane ? 'auto' : 'visible' }}>
                        {children}
                    </div>

                    {/* Right Pane: Pinned Tool */}
                    {showSplitPane && (
                        <div style={{ flex: 1, minWidth: 0, borderLeft: '1px solid var(--border)', background: 'var(--bg-panel)', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>PINNED TOOL</span>
                                <button 
                                    onClick={() => setPinnedToolRoute(null)}
                                    style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-md) var(--space-md) var(--space-xl)' }}>
                                <Suspense fallback={<div>Loading Pinned Tool...</div>}>
                                    <PinnedComponent />
                                </Suspense>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    )
}
