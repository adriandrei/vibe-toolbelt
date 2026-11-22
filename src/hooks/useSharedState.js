import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePane } from '../contexts/pane'
import { useToast } from '../components/ToastProvider'
import { decodeShareState, readShareFragment } from '../utils/share'

/**
 * useSharedState(apply) opens a shared link (see utils/share.js and
 * <ShareButton>): when the page loads with "#s=…" in the URL, the decoded
 * state is passed to apply(data) once. The fragment is then removed, so later
 * edits aren't mistaken for the shared version and a refresh doesn't reapply it.
 *
 *   useSharedState((data) => { setPattern(data.pattern); setFlags(data.flags) })
 *
 * `apply` should check what it gets: a link can be edited by hand. It may
 * throw (e.g. a ShareError) to refuse a link with nothing usable in it; the
 * user then sees the error instead of "Opened a shared link." Only the main
 * pane reads links; a tool pinned in the split view never does.
 */
export function useSharedState(apply) {
    const location = useLocation()
    const navigate = useNavigate()
    const { kind } = usePane()
    const toast = useToast()
    const applyRef = useRef(apply)

    useEffect(() => {
        applyRef.current = apply
    })

    useEffect(() => {
        if (kind !== 'main') return undefined
        const encoded = readShareFragment(location.hash)
        if (!encoded) return undefined
        let cancelled = false
        const { pathname, search, state } = location
        decodeShareState(encoded, pathname)
            .then((data) => {
                if (cancelled) return
                applyRef.current(data)
                toast.info('Opened a shared link.')
            })
            .catch((error) => {
                if (!cancelled) toast.error(`Couldn’t open the shared link. ${error.message}`)
            })
            .finally(() => {
                if (!cancelled) navigate(`${pathname}${search}`, { replace: true, state })
            })
        return () => {
            cancelled = true
        }
        // Once per navigation entry
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key, kind])
}
