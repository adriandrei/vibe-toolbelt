import { useEffect, useRef } from 'react'

// Calls the latest `onEscape` when Escape is pressed. Pass `enabled = false`
// to turn the listener off (e.g. while a modal is closed).
export function useEscape(onEscape, enabled = true) {
    const ref = useRef(onEscape)

    useEffect(() => {
        ref.current = onEscape
    })

    useEffect(() => {
        if (!enabled) return undefined
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') ref.current?.(event)
        }
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [enabled])
}
