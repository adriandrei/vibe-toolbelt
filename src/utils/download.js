// Triggers a browser download for in-memory data.

export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.rel = 'noopener'
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // Give the browser time to start the download before releasing the memory
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
    downloadBlob(new Blob([text], { type: mime }), filename)
}

export async function downloadDataURL(dataUrl, filename) {
    const blob = await (await fetch(dataUrl)).blob()
    downloadBlob(blob, filename)
}

// "photo.final.png" -> { base: "photo.final", ext: "png" }
export function splitFilename(name) {
    const i = name.lastIndexOf('.')
    if (i <= 0) return { base: name, ext: '' }
    return { base: name.slice(0, i), ext: name.slice(i + 1) }
}

export function formatBytes(bytes, decimals = 1) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1024
    let i = 0
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024
        i++
    }
    return `${value.toFixed(value < 10 ? decimals : 0)} ${units[i]}`
}
