// Worker-side half of src/utils/workerClient.js: answers { id, type, payload }
// requests with the matching async handler.
//
//   serveWorker({ digest: async (payload, { progress }) => result })
export function serveWorker(handlers) {
    self.onmessage = async (event) => {
        const { id, type, payload } = event.data || {}
        const handler = handlers[type]
        if (!handler) {
            self.postMessage({ id, ok: false, error: { message: `Unknown request: ${type}` } })
            return
        }
        try {
            const result = await handler(payload, { progress: (value) => self.postMessage({ id, progress: value }) })
            self.postMessage({ id, ok: true, result })
        } catch (error) {
            self.postMessage({ id, ok: false, error: { message: error?.message || String(error), name: error?.name } })
        }
    }
}
