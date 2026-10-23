// Opens the command palette from anywhere (Layout listens for this event).
export const OPEN_PALETTE_EVENT = 'pt:open-palette'

export function openCommandPalette() {
    window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))
}

export const isMacPlatform = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
