import { useEffect, useState } from 'react'

/**
 * Promise-based requests to a module Web Worker.
 *
 *   const client = createWorkerClient(() =>
 *       new Worker(new URL('../workers/crypto.worker.js', import.meta.url), { type: 'module' }))
 *   const result = await client.request('digest', payload, { onProgress })
 *
 * - The worker starts on the first request, not when the client is created.
 * - `replace: true` cancels whatever is still running first: the worker is
 *   terminated (so a long job stops using CPU) and restarted on demand.
 * - Cancelled requests reject with an error whose `cancelled` is true; callers
 *   should ignore those.
 *
 * Worker protocol: requests are { id, type, payload }; the worker answers
 * { id, ok: true, result }, { id, ok: false, error: { message, name } } or
 * { id, progress } (0..1) while working.
 */
export function createWorkerClient(factory) {
    let worker = null
    let seq = 0
    const pending = new Map()

    const failAll = (error) => {
        for (const entry of pending.values()) entry.reject(error)
        pending.clear()
    }

    const start = () => {
        if (worker) return worker
        worker = factory()
        worker.onmessage = (event) => {
            const { id, ok, result, error, progress } = event.data || {}
            const entry = pending.get(id)
            if (!entry) return
            if (progress !== undefined) {
                entry.onProgress?.(progress)
                return
            }
            pending.delete(id)
            if (ok) entry.resolve(result)
            else entry.reject(Object.assign(new Error(error?.message || 'The operation failed'), { name: error?.name || 'Error' }))
        }
        worker.onerror = (event) => {
            event.preventDefault?.()
            const error = new Error(event.message ? `Worker error: ${event.message}` : 'The background worker could not be loaded. Check your connection and reload the page.')
            error.workerFailed = true
            worker?.terminate()
            worker = null
            failAll(error)
        }
        return worker
    }

    const cancel = () => {
        if (!pending.size) return
        worker?.terminate()
        worker = null
        failAll(Object.assign(new Error('Cancelled'), { cancelled: true }))
    }

    return {
        request(type, payload, { onProgress, transfer, replace = false } = {}) {
            if (replace) cancel()
            const id = ++seq
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject, onProgress })
                try {
                    start().postMessage({ id, type, payload }, transfer || [])
                } catch (error) {
                    pending.delete(id)
                    reject(error)
                }
            })
        },
        get busy() {
            return pending.size > 0
        },
        cancel,
        terminate() {
            worker?.terminate()
            worker = null
            failAll(Object.assign(new Error('Cancelled'), { cancelled: true }))
        },
    }
}

// A worker client that lives as long as the component (terminated on unmount).
export function useWorkerClient(factory) {
    const [client] = useState(() => createWorkerClient(factory))
    useEffect(() => () => client.terminate(), [client])
    return client
}
