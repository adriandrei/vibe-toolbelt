// Copies text to the clipboard. Uses the async Clipboard API when available
// (secure contexts) and falls back to a hidden textarea + execCommand for
// plain-http origins such as a dev server on a LAN IP. Resolves to true on success.
export async function copyText(text) {
    const value = String(text)
    try {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(value)
            return true
        }
    } catch {
        // fall through to the legacy path
    }
    try {
        const el = document.createElement('textarea')
        el.value = value
        el.setAttribute('readonly', '')
        el.style.position = 'fixed'
        el.style.top = '-1000px'
        el.style.opacity = '0'
        document.body.appendChild(el)
        el.select()
        el.setSelectionRange(0, value.length)
        const ok = document.execCommand('copy')
        el.remove()
        return ok
    } catch {
        return false
    }
}
