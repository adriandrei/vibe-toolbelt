// Runs the PII/secret scanner off the main thread for large inputs.
// Message in: { id, text }. Message out: { id, result } or { id, error }.
import { scanText } from '../utils/pii.js'

self.onmessage = (event) => {
    const { id, text } = event.data || {}
    try {
        self.postMessage({ id, result: scanText(text) })
    } catch (err) {
        self.postMessage({ id, error: err?.message || String(err) })
    }
}
