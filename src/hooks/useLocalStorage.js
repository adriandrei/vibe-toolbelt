import { useCallback, useEffect, useId, useState } from 'react'

const SYNC_EVENT = 'pt-local-storage'

function read(key, initialValue) {
    try {
        const item = window.localStorage.getItem(key)
        return item !== null ? JSON.parse(item) : initialValue
    } catch {
        return initialValue
    }
}

/**
 * useState backed by localStorage. Every instance using the same key stays in
 * sync (in this tab and across tabs), and functional updates always see the
 * latest value.
 */
export function useLocalStorage(key, initialValue) {
    const instanceId = useId()
    const [value, setValue] = useState(() => read(key, initialValue))

    useEffect(() => {
        const onChange = (event) => {
            if (event.type === 'storage' && event.key !== key) return
            if (event.type === SYNC_EVENT && (event.detail?.key !== key || event.detail?.source === instanceId)) return
            setValue(read(key, initialValue))
        }
        window.addEventListener('storage', onChange)
        window.addEventListener(SYNC_EVENT, onChange)
        return () => {
            window.removeEventListener('storage', onChange)
            window.removeEventListener(SYNC_EVENT, onChange)
        }
        // initialValue is only a fallback for missing data
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, instanceId])

    const update = useCallback((next) => {
        setValue(prev => {
            const resolved = typeof next === 'function' ? next(prev) : next
            try {
                if (resolved === undefined) window.localStorage.removeItem(key)
                else window.localStorage.setItem(key, JSON.stringify(resolved))
                // Notify other instances once this update has been applied
                queueMicrotask(() => window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: { key, source: instanceId } })))
            } catch {
                // storage full or blocked: keep the in-memory value
            }
            return resolved
        })
    }, [key, instanceId])

    return [value, update]
}
