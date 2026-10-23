import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePane } from '../contexts/pane'

/**
 * useSmartInput — prefills a page from "smart" navigation state
 * (see utils/smartNav.js).
 *
 *   useSmartInput({ input: setInput, mode: setMode }, { onInject })
 *
 * - Each key in `setters` is looked up in the navigation state; non-empty
 *   values are passed to the setter (strings are trimmed).
 * - `onInject(values)` runs after injection, e.g. to switch a mode or run the
 *   conversion straight away.
 * - Only the main pane consumes the state; a tool pinned in the split view
 *   never takes input meant for the page beside it.
 * - The state is cleared afterwards (search and hash are kept), so a refresh
 *   doesn't re-apply it.
 */
export function useSmartInput(setters, { onInject } = {}) {
    const location = useLocation()
    const navigate = useNavigate()
    const { kind } = usePane()
    const settersRef = useRef(setters)
    const onInjectRef = useRef(onInject)

    useEffect(() => {
        settersRef.current = setters
        onInjectRef.current = onInject
    })

    useEffect(() => {
        if (kind !== 'main') return
        const state = location.state
        if (!state || state.smart !== true) return

        const injected = {}
        for (const key of Object.keys(settersRef.current || {})) {
            let value = state[key]
            if (value === undefined || value === null) continue
            if (typeof value === 'string') {
                value = value.trim()
                if (!value) continue
            }
            settersRef.current[key](value)
            injected[key] = value
        }

        // Clear the consumed state, keeping the rest of the URL
        navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })

        if (Object.keys(injected).length > 0) onInjectRef.current?.(injected)
        // Run once per navigation entry
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.key, kind])
}
