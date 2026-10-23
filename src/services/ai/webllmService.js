/**
 * On-device AI service.
 *
 * Owns the Web Worker that runs WebLLM (src/workers/llm.worker.js) and gives the
 * rest of the app promise-based calls. React code should use `useAI()` from
 * src/contexts/AIContext.jsx, which builds the app-wide state on top of this.
 *
 *   checkWebGPU()                         → { supported, reason, message, adapterName }
 *   load(modelId, { onProgress })         → resolves { modelId, fromCache }
 *   chat(messages, { onToken, … })        → { id, promise } (resolves { text, aborted, finishReason })
 *   abort(chatId)
 *   terminate()                           → stops everything: cancels a download, unloads the model
 *   getCacheInfo(ids) / deleteModelFiles(id)
 *
 * Failures are AIError instances: a message that can be shown to the user, a
 * `code`, the original error text in `detail`, and `fatal` when the model is no
 * longer usable.
 */

export const MODELS = [
    {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        name: 'Phi-3.5 Mini',
        label: 'Phi-3.5 Mini',
        tag: 'Recommended',
        size: '2.2 GB',
        vram: '3.7 GB',
        description: 'Best answers for developer tasks: JSON, SQL, regular expressions and code.',
    },
    {
        id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
        name: 'Qwen 2.5 1.5B',
        label: 'Qwen 2.5 1.5B',
        tag: 'Lightweight',
        size: '0.9 GB',
        vram: '1.6 GB',
        description: 'Smaller download and less GPU memory. Good for quick explanations on modest hardware.',
    },
]

export const DEFAULT_MODEL = MODELS[0].id

export function getModel(id) {
    return MODELS.find(m => m.id === id) || null
}

export function isKnownModel(id) {
    return typeof id === 'string' && MODELS.some(m => m.id === id)
}

// Decimal units, like the model sizes above and Hugging Face's listings.
export function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '—'
    if (bytes < 1000) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB']
    let value = bytes / 1000
    let i = 0
    while (value >= 1000 && i < units.length - 1) {
        value /= 1000
        i++
    }
    return `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ${units[i]}`
}

export class AIError extends Error {
    constructor(message, { code = 'error', detail = null, fatal = false } = {}) {
        super(message)
        this.name = 'AIError'
        this.code = code
        this.detail = detail
        this.fatal = fatal
    }
}

// ---------- WebGPU detection ----------

export const WEBGPU_BROWSERS = 'recent versions of Chrome and Edge, Safari 26 or later, and Firefox 141 or later on Windows'

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), ms)),
    ])
}

async function detectWebGPU() {
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
        return {
            supported: false,
            reason: 'insecure',
            message: 'WebGPU only works on secure pages. Open this app over https:// (or from localhost).',
        }
    }
    if (typeof navigator === 'undefined' || !navigator.gpu) {
        return {
            supported: false,
            reason: 'no-webgpu',
            message: `This browser doesn't support WebGPU, or it's turned off. WebGPU works in ${WEBGPU_BROWSERS}.`,
        }
    }
    try {
        const adapter = await withTimeout(navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }), 8000)
        if (!adapter) {
            return {
                supported: false,
                reason: 'no-adapter',
                message: "This browser supports WebGPU but couldn't access your GPU. The GPU or its driver may be blocklisted by the browser, or hardware acceleration may be turned off in the browser's settings.",
            }
        }
        const info = adapter.info || {}
        const adapterName = (info.description || [info.vendor, info.architecture].filter(Boolean).join(' ')).trim()
        return { supported: true, reason: null, message: null, adapterName: adapterName || null }
    } catch (err) {
        return {
            supported: false,
            reason: 'error',
            message: `WebGPU failed to start (${err?.message || 'unknown error'}). Try reloading the page, or update your browser and graphics driver.`,
        }
    }
}

// ---------- Error messages ----------

function rawText(error) {
    if (!error) return ''
    return [error.name, error.message].filter(Boolean).join(': ')
}

function loadError(error = {}) {
    const name = error.name || ''
    const message = error.message || ''
    const detail = rawText(error)
    if (name === 'DeviceLostError' || /device was lost|out of memory|\bOOM\b/i.test(message)) {
        return new AIError('The GPU ran out of memory while loading the model. Close other GPU-heavy tabs or apps, or choose the lighter Qwen model, then try again.', { code: 'gpu-memory', detail })
    }
    if (name === 'QuotaExceededError' || /quota/i.test(message)) {
        return new AIError("There isn't enough free storage to save the model. Free up disk space or delete other downloaded models, then try again.", { code: 'storage', detail })
    }
    if (/failed to fetch|networkerror|network error|load failed|cannot fetch|err_internet|err_network/i.test(message)) {
        return new AIError("The model files couldn't be downloaded. Check your internet connection (they come from huggingface.co and raw.githubusercontent.com) and try again.", { code: 'network', detail })
    }
    if (/maxBufferSize|maxStorageBufferBindingSize|maxComputeWorkgroupStorageSize|maxStorageBuffersPerShaderStage/.test(message)) {
        return new AIError("Your GPU doesn't meet this model's requirements. Try the lighter Qwen model.", { code: 'webgpu', detail })
    }
    if (name === 'FeatureSupportError' || name === 'ShaderF16SupportError') {
        return new AIError('Your GPU or browser lacks a WebGPU feature this model needs. Try the other model, or a recent version of Chrome or Edge.', { code: 'webgpu', detail })
    }
    if (/compatible GPU/i.test(message)) {
        return new AIError("The browser couldn't find a compatible GPU for the model. The GPU or its driver may be blocklisted, or hardware acceleration may be turned off.", { code: 'webgpu', detail })
    }
    if (name === 'WebGPUNotAvailableError' || name === 'WebGPUNotFoundError' || /WebGPU is not supported|find WebGPU/i.test(message)) {
        return new AIError("WebGPU isn't available to the background worker that runs the model. Try a recent version of Chrome or Edge.", { code: 'webgpu', detail })
    }
    return new AIError(`The model couldn't be loaded: ${message || name || 'unknown error'}`, { code: 'load-failed', detail })
}

function chatError(error = {}) {
    const name = error.name || ''
    const message = error.message || ''
    const detail = rawText(error)
    if (name === 'BusyError') return new AIError('The AI is busy with another response', { code: 'busy', detail })
    if (name === 'ContextWindowSizeExceededError' || /context window/i.test(message)) {
        return new AIError('The conversation and tool data are too long for the model (about 4,000 tokens). Start a new chat or use a shorter input.', { code: 'too-long', detail })
    }
    if (name === 'DeviceLostError' || /device was lost|device lost/i.test(message)) {
        return new AIError('The GPU was reset and the model was unloaded. Load it again to continue.', { code: 'gpu-lost', detail, fatal: true })
    }
    if (name === 'ModelNotLoadedError' || /not loaded/i.test(message)) {
        return new AIError('The AI model is not loaded', { code: 'not-loaded', detail, fatal: true })
    }
    return new AIError(`The AI couldn't finish the answer: ${message || name || 'unknown error'}`, { code: 'chat-failed', detail })
}

function plainError(error = {}) {
    return new AIError(error.message || 'Unknown error', { detail: rawText(error) })
}

// If an interrupted answer hasn't wound down after this long, the worker is
// considered stuck and is shut down, so the app never stays "thinking".
const ABORT_WATCHDOG_MS = 30000

class WebLLMService {
    constructor() {
        this.worker = null
        this.pending = new Map()
        this.counter = 0
        this.crashListeners = new Set()
        this.webgpu = null
    }

    /** WebGPU support, detected once per page load. */
    checkWebGPU() {
        if (!this.webgpu) this.webgpu = detectWebGPU()
        return this.webgpu
    }

    async checkWebGPUSupport() {
        return (await this.checkWebGPU()).supported
    }

    /** Called when the worker dies unexpectedly (not on terminate()). */
    onCrash(listener) {
        this.crashListeners.add(listener)
        return () => this.crashListeners.delete(listener)
    }

    _ensureWorker() {
        if (this.worker) return this.worker
        const worker = new Worker(new URL('../../workers/llm.worker.js', import.meta.url), { type: 'module' })
        worker.onmessage = (event) => this._onMessage(event.data)
        worker.onerror = (event) => {
            event.preventDefault?.()
            this._crash(new AIError('The AI engine stopped unexpectedly. Load the model again to continue.', {
                code: 'worker-crashed',
                detail: event.message || null,
                fatal: true,
            }))
        }
        worker.onmessageerror = () => {
            this._crash(new AIError('The AI engine sent an unreadable message and was stopped.', { code: 'worker-crashed', fatal: true }))
        }
        this.worker = worker
        return worker
    }

    _teardown(error) {
        if (this.worker) {
            this.worker.terminate()
            this.worker = null
        }
        const pending = [...this.pending.values()]
        this.pending.clear()
        for (const entry of pending) {
            clearTimeout(entry.watchdog)
            entry.reject(error)
        }
    }

    _crash(error) {
        const hadWork = this.pending.size > 0
        this._teardown(error)
        for (const listener of this.crashListeners) listener(error, { hadWork })
    }

    /**
     * Stops the worker: cancels a download in progress and frees the GPU memory
     * of a loaded model. Pending calls reject with code 'cancelled'.
     */
    terminate(reason = 'cancelled') {
        if (!this.worker && this.pending.size === 0) return
        const message = reason === 'unloaded' ? 'The model was unloaded.' : 'Cancelled.'
        this._teardown(new AIError(message, { code: 'cancelled' }))
    }

    _request(type, payload, handlers = {}) {
        const worker = this._ensureWorker()
        const id = `${type.toLowerCase()}-${++this.counter}`
        const promise = new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, watchdog: null, ...handlers })
        })
        worker.postMessage({ type, id, ...payload })
        return { id, promise }
    }

    _onMessage(message) {
        const entry = message && this.pending.get(message.id)
        if (!entry) return
        switch (message.type) {
            case 'LOAD_PROGRESS':
                entry.onProgress?.(message.progress)
                break
            case 'CHAT_TOKEN':
                entry.onToken?.(message.token)
                break
            case 'DONE':
                this.pending.delete(message.id)
                clearTimeout(entry.watchdog)
                entry.resolve(message.result)
                break
            case 'ERROR':
                this.pending.delete(message.id)
                clearTimeout(entry.watchdog)
                entry.reject((entry.mapError || plainError)(message.error))
                break
            default:
                break
        }
    }

    /** Loads a model (downloading it on first use). Only one model is ever resident. */
    load(modelId, { onProgress } = {}) {
        if (!isKnownModel(modelId)) {
            return Promise.reject(new AIError(`Unknown model "${modelId}"`, { code: 'unknown-model' }))
        }
        return this._request('LOAD', { modelId }, { onProgress, mapError: loadError }).promise
    }

    /** Streams a chat completion. Resolves { text, aborted, finishReason }. */
    chat(messages, { onToken, temperature, maxTokens } = {}) {
        return this._request('CHAT', { messages, options: { temperature, maxTokens } }, { onToken, mapError: chatError })
    }

    /** Stops a running chat; its promise resolves with aborted: true. */
    abort(id) {
        const entry = this.pending.get(id)
        if (!entry || !this.worker) return
        this.worker.postMessage({ type: 'ABORT', id })
        if (!entry.watchdog) {
            entry.watchdog = setTimeout(() => {
                if (!this.pending.has(id)) return
                this._crash(new AIError('The AI stopped responding and was unloaded. Load it again to continue.', { code: 'unresponsive', fatal: true }))
            }, ABORT_WATCHDOG_MS)
        }
    }

    /**
     * Download status of each model in this browser:
     * { [id]: { status: 'cached' | 'partial' | 'none' | 'unknown', bytes, totalBytes } }
     */
    getCacheInfo(modelIds = MODELS.map(m => m.id)) {
        return this._request('CACHE_INFO', { modelIds }).promise
    }

    /** Deletes one model's downloaded files. Resolves { removed, bytes }. */
    deleteModelFiles(modelId) {
        if (!isKnownModel(modelId)) {
            return Promise.reject(new AIError(`Unknown model "${modelId}"`, { code: 'unknown-model' }))
        }
        return this._request('CACHE_DELETE', { modelId }).promise
    }
}

// Singleton
export const webllmService = new WebLLMService()
