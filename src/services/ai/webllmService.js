/**
 * WebLLM Service
 * Manages the llm.worker.js instance and provides a clean async API
 * with streaming token callbacks.
 */

export const MODELS = [
    {
        id: 'Phi-3.5-mini-instruct-q4f16_1-MLC',
        label: 'Phi-3.5 Mini (Recommended)',
        size: '2.2 GB',
        vram: '3.5 GB',
        description: 'Best quality for developer tasks. Great at JSON, SQL, regex reasoning.',
    },
    {
        id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
        label: 'Qwen 2.5 1.5B (Lightweight)',
        size: '0.9 GB',
        vram: '1.5 GB',
        description: 'Fast load, lower VRAM. Good for quick explanations on modest hardware.',
    },
]

export const DEFAULT_MODEL = MODELS[0].id

class WebLLMService {
    constructor() {
        this.worker = null
        this.pendingCallbacks = new Map()
        this.messageCounter = 0
        this._webGPUSupported = null
    }

    async checkWebGPUSupport() {
        if (this._webGPUSupported !== null) return this._webGPUSupported
        this._webGPUSupported = 'gpu' in navigator && !!(await navigator.gpu?.requestAdapter?.())
        return this._webGPUSupported
    }

    _ensureWorker() {
        if (!this.worker) {
            this.worker = new Worker(
                new URL('../../workers/llm.worker.js', import.meta.url),
                { type: 'module' }
            )
            this.worker.onmessage = (event) => {
                const { type, id, payload } = event.data
                const cbs = this.pendingCallbacks.get(id)
                if (!cbs) return

                if (type === 'LOAD_PROGRESS') {
                    cbs.onProgress?.(payload.progress, payload.text)
                } else if (type === 'LOAD_DONE') {
                    cbs.resolve?.()
                    this.pendingCallbacks.delete(id)
                } else if (type === 'CHAT_TOKEN') {
                    cbs.onToken?.(payload.token)
                } else if (type === 'CHAT_DONE') {
                    cbs.onDone?.()
                    this.pendingCallbacks.delete(id)
                } else if (type === 'CHAT_ABORTED') {
                    cbs.onAbort?.()
                    this.pendingCallbacks.delete(id)
                } else if (type === 'ERROR') {
                    cbs.reject?.(new Error(payload.message))
                    this.pendingCallbacks.delete(id)
                }
            }
            this.worker.onerror = (err) => {
                console.error('[WebLLM Worker Error]', err)
            }
        }
        return this.worker
    }

    _nextId() {
        return `msg_${++this.messageCounter}`
    }

    /**
     * Load a model. Fires onProgress(0-1, statusText) during download.
     * @returns {Promise<void>}
     */
    loadModel(modelId, { onProgress } = {}) {
        const worker = this._ensureWorker()
        const id = this._nextId()

        return new Promise((resolve, reject) => {
            this.pendingCallbacks.set(id, { resolve, reject, onProgress })
            worker.postMessage({ type: 'LOAD', id, payload: { modelId } })
        })
    }

    /**
     * Stream a chat completion.
     * @param {Array<{role, content}>} messages
     * @param {(token: string) => void} onToken
     * @param {() => void} onDone
     * @returns {string} id for aborting
     */
    chat(messages, { onToken, onDone, onAbort } = {}) {
        const worker = this._ensureWorker()
        const id = this._nextId()

        const promise = new Promise((resolve, reject) => {
            this.pendingCallbacks.set(id, {
                onToken,
                onDone: () => { onDone?.(); resolve() },
                onAbort: () => { onAbort?.(); resolve() },
                reject,
            })
        })

        worker.postMessage({ type: 'CHAT', id, payload: { messages } })
        return { id, promise }
    }

    /**
     * Abort the current generation for a given message id.
     */
    abort(id) {
        if (!this.worker) return
        this.worker.postMessage({ type: 'ABORT', id, payload: {} })
    }
}

// Singleton
export const webllmService = new WebLLMService()
