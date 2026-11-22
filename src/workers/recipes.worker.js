// Runs Recipes off the main thread, so typing stays responsive with large
// inputs and a slow step (a huge file, a runaway regex) can be stopped by
// terminating the worker. Speaks the protocol of src/utils/workerClient.js
// (like serve.js), and transfers binary output instead of copying it.
import { executeRecipe } from '../utils/recipes/runner.js'

self.onmessage = async (event) => {
    const { id, type, payload } = event.data || {}
    if (type !== 'run') {
        self.postMessage({ id, ok: false, error: { message: `Unknown request: ${type}` } })
        return
    }
    try {
        const result = await executeRecipe(payload, {
            onStep: (step) => self.postMessage({ id, progress: { step } }),
        })
        const bytes = result.output?.kind === 'bytes' ? result.output.bytes : null
        self.postMessage({ id, ok: true, result }, bytes?.byteLength ? [bytes.buffer] : [])
    } catch (error) {
        self.postMessage({ id, ok: false, error: { message: error?.message || String(error), name: error?.name } })
    }
}
