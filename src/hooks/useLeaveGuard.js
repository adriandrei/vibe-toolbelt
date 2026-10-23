import { useEffect } from 'react'
import { usePane } from '../contexts/pane'

/**
 * Warns before the user loses unsaved work (an active recording, an unsaved
 * result, a running export).
 *
 * - Closing or reloading the tab: the browser's native "Leave site?" prompt.
 * - Navigating away in the app (main pane) or unpinning the tool (pinned
 *   pane): the layout asks with confirm(message). The layout owns the single
 *   router blocker, so several guarded pages never conflict.
 */
export function useLeaveGuard(active, message = 'You have unsaved work on this page. Leave anyway?') {
    const { reportBusy } = usePane()

    useEffect(() => {
        if (!active) return undefined
        const onBeforeUnload = (event) => {
            event.preventDefault()
            event.returnValue = ''
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [active])

    useEffect(() => {
        if (!reportBusy) return undefined
        reportBusy(active ? message : null)
        return () => reportBusy(null)
    }, [reportBusy, active, message])
}
