import { createContext, useContext } from 'react'

// Which pane a page is rendered in, and how wide that pane is.
//
// kind: 'main' follows the URL; 'pinned' is the second tool in the desktop
//   split view. Page-level side effects that must only happen once (document
//   title, AI context, consuming smart-input navigation state) check this.
// path: the route shown in this pane.
// size: 'sm' (< 640px), 'md' (< 1000px) or 'lg', measured on the pane itself,
//   so layouts adapt to a half-width pinned pane as well as to phones.
// reportBusy: used by useLeaveGuard to protect unsaved work.
export const PaneContext = createContext({ kind: 'main', path: null, size: 'lg', reportBusy: null })

export function usePane() {
    return useContext(PaneContext)
}

export function useIsPinnedPane() {
    return useContext(PaneContext).kind === 'pinned'
}
