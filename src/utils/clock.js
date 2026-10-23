import { useSyncExternalStore } from 'react'

// A shared clock that ticks on whole-second boundaries while something is
// subscribed, and catches up as soon as a hidden tab becomes visible again.
function createSecondClock() {
    const listeners = new Set()
    let timer = null
    let current = Math.floor(Date.now() / 1000) * 1000

    const notify = () => {
        const next = Math.floor(Date.now() / 1000) * 1000
        if (next === current) return
        current = next
        listeners.forEach(listener => listener())
    }
    const schedule = () => {
        timer = setTimeout(() => {
            notify()
            schedule()
        }, 1000 - (Date.now() % 1000) + 5)
    }
    const onVisible = () => {
        if (document.visibilityState === 'visible') notify()
    }

    return {
        subscribe(listener) {
            listeners.add(listener)
            if (listeners.size === 1) {
                current = Math.floor(Date.now() / 1000) * 1000
                schedule()
                document.addEventListener('visibilitychange', onVisible)
            }
            return () => {
                listeners.delete(listener)
                if (!listeners.size) {
                    clearTimeout(timer)
                    timer = null
                    document.removeEventListener('visibilitychange', onVisible)
                }
            }
        },
        getSnapshot() {
            // Fresh when idle (first render), cached while ticking
            if (!timer) current = Math.floor(Date.now() / 1000) * 1000
            return current
        },
    }
}

const secondClock = createSecondClock()

// Current time in ms, rounded down to the second; re-renders every second.
export function useNow() {
    return useSyncExternalStore(secondClock.subscribe, secondClock.getSnapshot)
}

// "45 s", "12 min", "1 h 30 min", "5 h", "3 days", "2.4 years" (rounded)
export function formatDuration(seconds) {
    const abs = Math.abs(seconds)
    if (abs < 60) return `${Math.floor(abs)} s`
    if (abs < 3600) return `${Math.min(59, Math.round(abs / 60))} min`
    if (abs < 86400 * 2) {
        const totalMinutes = Math.round(abs / 60)
        const hours = Math.floor(totalMinutes / 60)
        const minutes = totalMinutes % 60
        return hours < 10 && minutes ? `${hours} h ${minutes} min` : `${Math.round(abs / 3600)} h`
    }
    if (abs < 86400 * 365) {
        const days = Math.round(abs / 86400)
        return `${days} day${days === 1 ? '' : 's'}`
    }
    const years = abs / (86400 * 365.25)
    return `${years < 10 ? years.toFixed(1) : Math.round(years).toLocaleString()} years`
}

// "in 5 min" / "3 days ago" / "now"
export function formatRelative(deltaSeconds) {
    if (Math.abs(deltaSeconds) < 1) return 'now'
    const text = formatDuration(deltaSeconds)
    return deltaSeconds > 0 ? `in ${text}` : `${text} ago`
}
