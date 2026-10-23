import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Outlet, useBlocker, useLocation } from 'react-router-dom'
import { MotionConfig } from 'framer-motion'
import { Loader2, Maximize2, Menu, PinOff, Search, Wand2 } from 'lucide-react'
import Sidebar from './Sidebar'
import SmartPaste from './SmartPaste'
import CommandPalette from './CommandPalette'
import PrivacyBadge from './PrivacyBadge'
import AIStatusBadge from './AIStatusBadge'
import AIAssistant from './AIAssistant'
import ErrorBoundary from './ErrorBoundary'
import PipelineIndicator from './PipelineIndicator'
import { usePipeline } from '../contexts/PipelineContext'
import { PaneContext } from '../contexts/pane'
import { ROUTE_MAP } from '../routes'
import { getTool } from '../config/tools'
import { BRAND } from '../config/brand'
import { OPEN_PALETTE_EVENT, isMacPlatform as isMac } from '../utils/palette'

const DESKTOP_QUERY = '(min-width: 1025px)'

function PageLoader() {
    return (
        <div className="page-loader" role="status">
            <Loader2 size={18} className="spin" aria-hidden="true" /> Loading…
        </div>
    )
}

// Width class of an element: sm (< 640px), md (< 1000px) or lg.
function usePaneSize(ref, active = true) {
    const [size, setSize] = useState('lg')
    useEffect(() => {
        const el = ref.current
        if (!active) return undefined
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(([entry]) => {
            const w = entry.contentRect.width
            setSize(w < 640 ? 'sm' : w < 1000 ? 'md' : 'lg')
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [ref, active])
    return size
}

function useMediaQuery(query) {
    const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
    useEffect(() => {
        const mq = window.matchMedia(query)
        const onChange = (e) => setMatches(e.matches)
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
    }, [query])
    return matches
}

export default function Layout() {
    const location = useLocation()
    const isDesktop = useMediaQuery(DESKTOP_QUERY)
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
    const [isSearchOpen, setIsSearchOpen] = useState(false)
    const { pinnedToolRoute, setPinnedToolRoute } = usePipeline()

    const isSidebarOpen = isDesktop || mobileSidebarOpen

    // Unsaved-work guards (see useLeaveGuard): one router blocker for the app
    const mainBusy = useRef(null)
    const pinnedBusy = useRef(null)
    const reportMainBusy = useCallback((message) => { mainBusy.current = message }, [])
    const reportPinnedBusy = useCallback((message) => { pinnedBusy.current = message }, [])

    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        Boolean(mainBusy.current) && currentLocation.pathname !== nextLocation.pathname
    )

    useEffect(() => {
        if (blocker.state !== 'blocked') return
        if (window.confirm(mainBusy.current || 'Leave this page? Unsaved work will be lost.')) {
            mainBusy.current = null
            blocker.proceed()
        } else {
            blocker.reset()
        }
    }, [blocker])

    // Ctrl/Cmd+K opens the command palette from anywhere
    useEffect(() => {
        const onKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
                e.preventDefault()
                setIsSearchOpen(open => !open)
            }
        }
        // Any component can open the palette: window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
        const onOpenRequest = () => setIsSearchOpen(true)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener(OPEN_PALETTE_EVENT, onOpenRequest)
        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener(OPEN_PALETTE_EVENT, onOpenRequest)
        }
    }, [])

    // Pinned (split view) tool: never the same as the main page
    const PinnedComponent = pinnedToolRoute && pinnedToolRoute !== location.pathname ? ROUTE_MAP[pinnedToolRoute] : null
    const pinnedTool = PinnedComponent ? getTool(pinnedToolRoute) : null
    const showSplit = isDesktop && Boolean(PinnedComponent)

    const unpin = useCallback(() => {
        if (pinnedBusy.current && !window.confirm(pinnedBusy.current)) return
        pinnedBusy.current = null
        setPinnedToolRoute(null)
    }, [setPinnedToolRoute])

    const mainRef = useRef(null)
    const pinnedRef = useRef(null)
    const mainSize = usePaneSize(mainRef)
    const pinnedSize = usePaneSize(pinnedRef, Boolean(PinnedComponent))

    const mainPane = useMemo(
        () => ({ kind: 'main', path: location.pathname, size: mainSize, reportBusy: reportMainBusy }),
        [location.pathname, mainSize, reportMainBusy]
    )
    const pinnedPane = useMemo(
        () => ({ kind: 'pinned', path: pinnedToolRoute, size: pinnedSize, reportBusy: reportPinnedBusy }),
        [pinnedToolRoute, pinnedSize, reportPinnedBusy]
    )

    const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), [])

    return (
        <MotionConfig reducedMotion="user">
            <div className="app-shell">
                <a href="#main-content" className="skip-link">Skip to content</a>

                <Sidebar
                    isOpen={isSidebarOpen}
                    isDesktop={isDesktop}
                    onClose={closeMobileSidebar}
                    onOpenSearch={() => setIsSearchOpen(true)}
                />

                <CommandPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
                <SmartPaste />
                <AIAssistant />

                <div className={`app-main-column ${isDesktop ? 'desktop-sidebar-open' : ''}`}>
                    <header className="app-header">
                        {!isDesktop && (
                            <>
                                <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={() => setMobileSidebarOpen(true)}
                                    aria-label="Open menu"
                                    aria-expanded={mobileSidebarOpen}
                                >
                                    <Menu size={20} aria-hidden="true" />
                                </button>
                                <Link to="/" className="app-header-brand" aria-label={`${BRAND.name} home`}>
                                    <Wand2 size={20} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                                    <span className="text-gradient hide-sm">{BRAND.name}</span>
                                </Link>
                            </>
                        )}

                        <div className="app-header-actions">
                            <button
                                type="button"
                                className="header-search"
                                onClick={() => setIsSearchOpen(true)}
                                aria-label="Search tools"
                                aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
                            >
                                <Search size={14} aria-hidden="true" />
                                <span className="hide-sm">Search tools</span>
                                <span className="kbd hide-sm">{isMac ? '⌘K' : 'Ctrl K'}</span>
                            </button>
                            <PipelineIndicator />
                            <AIStatusBadge />
                            <div className="header-divider hide-sm" />
                            <PrivacyBadge compactOnMobile />
                        </div>
                    </header>

                    <main id="main-content" className={`app-main ${showSplit ? 'is-split' : ''}`}>
                        <div ref={mainRef} className="pane pane-main" data-pane-size={mainSize}>
                            <PaneContext.Provider value={mainPane}>
                                <ErrorBoundary resetKey={location.pathname}>
                                    <Suspense fallback={<PageLoader />}>
                                        <Outlet />
                                    </Suspense>
                                </ErrorBoundary>
                            </PaneContext.Provider>
                        </div>

                        {PinnedComponent && (
                            // Stays mounted (hidden) on small screens so pinned work isn't lost
                            <aside
                                className="pane pane-pinned"
                                aria-label={`Pinned tool: ${pinnedTool?.label ?? pinnedToolRoute}`}
                                style={showSplit ? undefined : { display: 'none' }}
                            >
                                <div className="pane-pinned-header">
                                    <span className="pane-pinned-title">
                                        {pinnedTool?.icon && <pinnedTool.icon size={14} aria-hidden="true" />}
                                        Pinned · {pinnedTool?.label ?? pinnedToolRoute}
                                    </span>
                                    <div style={{ display: 'flex', gap: 2 }}>
                                        <Link to={pinnedToolRoute} className="icon-btn icon-btn-sm" title="Open in the main view" aria-label="Open pinned tool in the main view">
                                            <Maximize2 size={14} aria-hidden="true" />
                                        </Link>
                                        <button type="button" className="icon-btn icon-btn-sm" onClick={unpin} title="Unpin" aria-label="Unpin tool">
                                            <PinOff size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                                <div ref={pinnedRef} className="pane-pinned-body" data-pane-size={pinnedSize}>
                                    <PaneContext.Provider value={pinnedPane}>
                                        <ErrorBoundary resetKey={pinnedToolRoute} compact onGoHome={false}>
                                            <Suspense fallback={<PageLoader />}>
                                                <PinnedComponent />
                                            </Suspense>
                                        </ErrorBoundary>
                                    </PaneContext.Provider>
                                </div>
                            </aside>
                        )}
                    </main>
                </div>
            </div>
        </MotionConfig>
    )
}
