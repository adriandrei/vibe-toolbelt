/**
 * Runs WebLLM off the main thread. Talks to src/services/ai/webllmService.js.
 *
 * Requests ({ type, id, ... }):
 *   LOAD { modelId }                 → LOAD_PROGRESS*, then DONE { modelId, fromCache } or ERROR
 *   CHAT { messages, options }       → CHAT_TOKEN*, then DONE { text, aborted, finishReason } or ERROR
 *   ABORT                            → stops the CHAT with the same id (it then finishes with aborted: true)
 *   CACHE_INFO { modelIds }          → DONE { [modelId]: { status, bytes, totalBytes } }
 *   CACHE_DELETE { modelId }         → DONE { removed, bytes } or ERROR
 *
 * One MLCEngine is reused for the worker's lifetime and loads go through a
 * queue, so two models are never resident at once (engine.reload() unloads the
 * previous model first). Cancelling a download or unloading the model is done
 * by terminating the worker from the main thread, which stops network requests
 * and frees GPU memory immediately.
 */
import {
    MLCEngine,
    prebuiltAppConfig,
    hasModelInCache,
    deleteChatConfigInCache,
    deleteModelWasmInCache,
} from '@mlc-ai/web-llm'

// Cache Storage scope where WebLLM keeps weights, tensor-cache.json and tokenizer files
const MODEL_CACHE = 'webllm/model'

let engine = null
let loadedModelId = null
let loadingModelId = null
let loadQueue = Promise.resolve()
let activeChat = null

function post(message) {
    self.postMessage(message)
}

function serializeError(error) {
    if (typeof error === 'string') return { name: 'Error', message: error }
    return { name: error?.name || 'Error', message: error?.message || String(error) }
}

function namedError(name, message) {
    const error = new Error(message)
    error.name = name
    return error
}

function reply(id, task) {
    task.then(
        (result) => post({ type: 'DONE', id, result }),
        (error) => post({ type: 'ERROR', id, error: serializeError(error) }),
    )
}

function getRecord(modelId) {
    const record = prebuiltAppConfig.model_list.find(m => m.model_id === modelId)
    if (!record) throw namedError('ModelNotFoundError', `Unknown model "${modelId}"`)
    return record
}

// Same normalisation WebLLM applies to ModelRecord.model before caching files under it
function modelBaseUrl(record) {
    let url = record.model
    if (!url.endsWith('/')) url += '/'
    if (!/.+\/resolve\/.+\//.test(url)) url += 'resolve/main/'
    return new URL(url).href
}

// ---------- Loading ----------

/**
 * WebLLM reports up to three passes, each from 0 to 1: downloading the weights
 * (skipped when they're cached), copying them into GPU memory and compiling the
 * GPU shaders. They're mapped onto one steadily increasing value.
 */
function progressReporter(id, fromCache) {
    const ranges = fromCache
        ? { download: [0, 0], load: [0, 0.8], compile: [0.8, 1] }
        : { download: [0, 0.85], load: [0.85, 0.95], compile: [0.95, 1] }
    let value = 0
    let lastPhase = null
    let lastPost = 0

    return (report) => {
        const text = report?.text || ''
        const fraction = Number.isFinite(report?.progress) ? Math.min(1, Math.max(0, report.progress)) : 0
        let phase = 'prepare'
        if (/^Loading model from cache/.test(text)) phase = 'load'
        else if (/^Loading GPU shader/.test(text)) phase = 'compile'
        else if (/^Finish loading/.test(text)) phase = 'finish'
        else if (/^(Fetching param cache|Start to fetch params)/.test(text)) phase = fromCache ? 'load' : 'download'

        const range = ranges[phase]
        const next = phase === 'finish' ? 1 : range ? range[0] + (range[1] - range[0]) * fraction : value
        value = Math.max(value, next)

        const now = Date.now()
        if (phase === lastPhase && now - lastPost < 150 && fraction < 1) return
        lastPhase = phase
        lastPost = now

        const fetchedMB = phase === 'download' ? Number(/(\d+)MB fetched/.exec(text)?.[1]) : NaN
        post({
            type: 'LOAD_PROGRESS',
            id,
            progress: {
                value,
                phase,
                fromCache,
                // WebLLM counts MB as 2^20 bytes
                downloadedBytes: Number.isFinite(fetchedMB) ? fetchedMB * 1024 * 1024 : null,
            },
        })
    }
}

async function load(id, modelId) {
    if (engine && loadedModelId === modelId) return { modelId, fromCache: true, alreadyLoaded: true }
    getRecord(modelId)

    // Let an answer that is still streaming wind down before its weights go away
    if (activeChat) {
        activeChat.aborted = true
        await engine?.interruptGenerate()
        await activeChat.finished
    }

    const fromCache = await hasModelInCache(modelId).catch(() => false)
    if (!engine) engine = new MLCEngine()
    engine.setInitProgressCallback(progressReporter(id, fromCache))
    loadedModelId = null
    loadingModelId = modelId
    try {
        // Unloads the previous model first, so only one is ever in GPU memory
        await engine.reload(modelId)
        // reload() returns quietly when it was interrupted; make sure the model is really there
        await engine.getMessage(modelId)
    } catch (error) {
        await engine.unload().catch(() => {})
        throw error
    } finally {
        loadingModelId = null
    }
    loadedModelId = modelId
    return { modelId, fromCache }
}

function enqueueLoad(id, modelId) {
    const run = () => load(id, modelId)
    const task = loadQueue.then(run, run)
    loadQueue = task.catch(() => {})
    return task
}

// ---------- Chat ----------

function clamp(value, min, max, fallback) {
    const n = Number(value)
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

async function chat(id, messages, options = {}) {
    if (!engine || !loadedModelId) throw namedError('ModelNotLoadedError', 'The AI model is not loaded')
    if (activeChat) throw namedError('BusyError', 'The AI is busy with another response')
    if (!Array.isArray(messages) || messages.length === 0) throw namedError('TypeError', 'No messages to send')

    let finish
    const state = { id, aborted: false, finished: new Promise((resolve) => { finish = resolve }) }
    activeChat = state
    let text = ''
    let finishReason = null
    try {
        const stream = await engine.chat.completions.create({
            model: loadedModelId,
            messages,
            stream: true,
            temperature: clamp(options.temperature, 0, 2, 0.7),
            max_tokens: Math.round(clamp(options.maxTokens, 16, 2048, 1024)),
        })
        for await (const chunk of stream) {
            const choice = chunk.choices?.[0]
            if (choice?.finish_reason) finishReason = choice.finish_reason
            if (state.aborted) {
                // Keep reading until the stream ends: leaving the loop early would
                // never release WebLLM's per-model lock and the next request would
                // wait forever. Interrupting again also covers an abort that arrived
                // before generation started (WebLLM resets the flag at the start).
                await engine.interruptGenerate()
                continue
            }
            const token = choice?.delta?.content
            if (token) {
                text += token
                post({ type: 'CHAT_TOKEN', id, token })
            }
        }
    } finally {
        activeChat = null
        finish()
    }
    return { text, aborted: state.aborted, finishReason: state.aborted ? 'abort' : finishReason }
}

function abort(id) {
    if (!activeChat || activeChat.id !== id) return
    activeChat.aborted = true
    engine?.interruptGenerate()
}

// ---------- Cache (downloaded model files) ----------

async function cacheInfo(modelId) {
    const record = getRecord(modelId)
    if (typeof caches === 'undefined') return { status: 'unknown', bytes: null, totalBytes: null }
    const base = modelBaseUrl(record)
    const cache = await caches.open(MODEL_CACHE)
    const keys = new Set((await cache.keys()).map(request => request.url))
    const manifest = await cache.match(new URL('tensor-cache.json', base).href)
    if (!manifest) {
        const any = [...keys].some(url => url.startsWith(base))
        return { status: any ? 'partial' : 'none', bytes: 0, totalBytes: null }
    }
    const shards = (await manifest.json())?.records || []
    let totalBytes = 0
    let bytes = 0
    for (const shard of shards) {
        totalBytes += shard.nbytes || 0
        if (keys.has(new URL(shard.dataPath, base).href)) bytes += shard.nbytes || 0
    }
    const complete = await hasModelInCache(modelId)
    return { status: complete ? 'cached' : bytes > 0 ? 'partial' : 'none', bytes, totalBytes }
}

async function getCacheInfo(modelIds = []) {
    const result = {}
    for (const modelId of modelIds) {
        try {
            result[modelId] = await cacheInfo(modelId)
        } catch (error) {
            result[modelId] = { status: 'unknown', bytes: null, totalBytes: null, error: serializeError(error).message }
        }
    }
    return result
}

/**
 * Removes one model's files. The weights, tensor-cache.json and tokenizer all
 * live under the model's URL in the "webllm/model" cache and are deleted here
 * directly: WebLLM's deleteModelInCache() doesn't wait for its weight deletion
 * and downloads tensor-cache.json again when it's missing. The model config and
 * GPU library are removed with WebLLM's own helpers, and hasModelInCache()
 * confirms the result.
 */
async function deleteModelFiles(modelId) {
    const record = getRecord(modelId)
    if (loadingModelId === modelId) throw namedError('BusyError', 'This model is loading. Cancel the download first.')
    if (typeof caches === 'undefined') throw namedError('NotSupportedError', 'This browser has no Cache Storage')
    const base = modelBaseUrl(record)
    const before = await cacheInfo(modelId).catch(() => null)
    const cache = await caches.open(MODEL_CACHE)
    const entries = (await cache.keys()).filter(request => request.url.startsWith(base))
    const results = await Promise.all(entries.map(request => cache.delete(request)))
    await deleteChatConfigInCache(modelId)
    await deleteModelWasmInCache(modelId)

    const leftover = (await cache.keys()).some(request => request.url.startsWith(base))
    if (leftover || await hasModelInCache(modelId)) {
        throw namedError('Error', 'Some model files could not be removed')
    }
    return { removed: results.filter(Boolean).length, bytes: before?.bytes || 0 }
}

// ---------- Messages ----------

self.onmessage = (event) => {
    const data = event.data || {}
    const { type, id } = data
    switch (type) {
        case 'LOAD':
            reply(id, enqueueLoad(id, data.modelId))
            break
        case 'CHAT':
            reply(id, chat(id, data.messages, data.options))
            break
        case 'ABORT':
            abort(id)
            break
        case 'CACHE_INFO':
            reply(id, getCacheInfo(data.modelIds))
            break
        case 'CACHE_DELETE':
            reply(id, deleteModelFiles(data.modelId))
            break
        default:
            break
    }
}

// WebLLM starts some background work without awaiting it (e.g. its GPU
// device-lost handler). Report those failures instead of letting them surface
// as uncaught errors.
self.addEventListener('unhandledrejection', (event) => {
    event.preventDefault()
    console.warn('[llm.worker] Background task failed:', event.reason)
})
