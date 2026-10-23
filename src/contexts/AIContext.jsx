import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useToast } from '../components/ToastProvider'
import {
    AIError,
    DEFAULT_MODEL,
    MODELS,
    formatSize,
    getModel,
    isKnownModel,
    webllmService,
} from '../services/ai/webllmService'

const AIContext = createContext(null)

const MODEL_KEY = 'ai_model'

function readSavedModel() {
    try {
        const saved = localStorage.getItem(MODEL_KEY)
        return isKnownModel(saved) ? saved : DEFAULT_MODEL
    } catch {
        return DEFAULT_MODEL
    }
}

function saveModel(id) {
    try {
        localStorage.setItem(MODEL_KEY, id)
    } catch {
        // storage unavailable (private mode): the choice lasts for this visit
    }
}

// Asks the browser not to evict the downloaded model when storage runs low.
async function requestPersistence() {
    try {
        if (!navigator.storage?.persist) return null
        if (await navigator.storage.persisted()) return true
        return await navigator.storage.persist()
    } catch {
        return null
    }
}

function progressText(loading) {
    if (!loading) return ''
    const model = getModel(loading.modelId)
    switch (loading.phase) {
        case 'download':
            return loading.downloadedBytes
                ? `Downloading model files: ${formatSize(loading.downloadedBytes)} of ${model?.size ?? 'about 1 GB'}`
                : 'Downloading model files…'
        case 'load':
            return loading.fromCache ? 'Loading the model from this device into GPU memory…' : 'Loading the model into GPU memory…'
        case 'compile':
            return 'Preparing the GPU…'
        case 'finish':
            return 'Finishing up…'
        default:
            return 'Getting ready…'
    }
}

// Only re-render when something visible changed
function mergeProgress(prev, next) {
    if (!prev || !next) return prev
    const percent = Math.min(100, Math.max(0, Math.round((next.value ?? 0) * 100)))
    const downloadedBytes = next.downloadedBytes ?? prev.downloadedBytes
    if (percent === prev.percent && next.phase === prev.phase && downloadedBytes === prev.downloadedBytes && next.fromCache === prev.fromCache) return prev
    return { ...prev, percent, phase: next.phase || prev.phase, downloadedBytes, fromCache: next.fromCache ?? prev.fromCache }
}

function callSafely(fn, ...args) {
    if (typeof fn !== 'function') return
    try {
        fn(...args)
    } catch (error) {
        console.error('[AI] callback failed', error)
    }
}

/**
 * App-wide on-device AI state. See useAI() for the API.
 *
 * Status is derived, never stored, so it can't drift:
 *   checking → unsupported | idle → loading → ready ⇄ thinking, or error.
 * "ready" always means the *selected* model is the one in GPU memory.
 */
export function AIProvider({ children }) {
    const toast = useToast()
    const [support, setSupport] = useState(null)
    const [selectedModel, setSelectedModel] = useState(readSavedModel)
    const [loadedModel, setLoadedModel] = useState(null)
    const [loading, setLoading] = useState(null)
    const [loadErrorState, setLoadErrorState] = useState(null)
    const [thinking, setThinking] = useState(false)
    const [loadDialogOpen, setLoadDialogOpen] = useState(false)
    const [aiPanelOpen, setAiPanelOpen] = useState(false)
    const [toolContext, setToolContext] = useState(null)
    const [storagePersisted, setStoragePersisted] = useState(null)

    // Synchronous view of the state for callbacks (written in handlers, never during render)
    const live = useRef({ supported: null, selected: selectedModel, loaded: null, load: null, chat: null, dialog: false, panel: false, errorToast: null })

    useLayoutEffect(() => {
        live.current.dialog = loadDialogOpen
        live.current.panel = aiPanelOpen
    }, [loadDialogOpen, aiPanelOpen])

    useEffect(() => {
        let cancelled = false
        webllmService.checkWebGPU().then((info) => {
            if (cancelled) return
            live.current.supported = info.supported
            setSupport(info)
        })
        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        navigator.storage?.persisted?.().then((value) => {
            if (!cancelled) setStoragePersisted(value)
        }, () => {})
        return () => {
            cancelled = true
        }
    }, [])

    // The worker died on its own (crash or stuck generation)
    useEffect(() => webllmService.onCrash((error) => {
        const state = live.current
        const affected = state.load || state.loaded || state.chat
        const modelId = state.load?.modelId ?? state.loaded
        state.load = null
        state.loaded = null
        state.chat = null
        setLoading(null)
        setLoadedModel(null)
        setThinking(false)
        if (!affected) return
        setLoadErrorState({ modelId, message: error.message, detail: error.detail, code: error.code })
        if (!state.dialog) state.errorToast = toast.error(error.message)
    }), [toast])

    // Clears the load error and the toast that announced it
    const clearLoadError = useCallback(() => {
        setLoadErrorState(null)
        const toastId = live.current.errorToast
        if (toastId) {
            live.current.errorToast = null
            toast.dismiss(toastId)
        }
    }, [toast])

    const showLoadDialog = useCallback(() => setLoadDialogOpen(true), [])
    const hideLoadDialog = useCallback(() => setLoadDialogOpen(false), [])
    const dismissLoadError = useCallback(() => {
        clearLoadError()
        setLoadDialogOpen(false)
    }, [clearLoadError])

    const openAIPanel = useCallback(() => setAiPanelOpen(true), [])
    const closeAIPanel = useCallback(() => setAiPanelOpen(false), [])
    const toggleAIPanel = useCallback(() => setAiPanelOpen(open => !open), [])

    // Stops a load in progress (terminates the worker). Returns whether one was running.
    const stopLoad = useCallback(() => {
        const state = live.current
        if (!state.load) return false
        state.load = null
        state.loaded = null
        state.chat = null
        webllmService.terminate('cancelled')
        setLoading(null)
        setLoadedModel(null)
        setThinking(false)
        return true
    }, [])

    const changeModel = useCallback((modelId) => {
        const state = live.current
        if (!isKnownModel(modelId)) return false
        if (modelId === state.selected) return true
        // A download of the previous choice is no longer wanted
        if (state.load && state.load.modelId !== modelId) {
            stopLoad()
            setLoadDialogOpen(false)
        }
        // Never let the old model keep answering while the UI shows the new one
        if (state.chat && state.loaded !== modelId) webllmService.abort(state.chat.id)
        state.selected = modelId
        setSelectedModel(modelId)
        saveModel(modelId)
        clearLoadError()
        return true
    }, [stopLoad, clearLoadError])

    /**
     * Loads `modelId` (default: the selected model; a different id also selects
     * it). Resolves true when it's ready. `{ background: true }` skips the
     * progress dialog, for places that show progress themselves.
     */
    const loadModel = useCallback((modelId, { background = false } = {}) => {
        const state = live.current
        const id = isKnownModel(modelId) ? modelId : state.selected
        if (state.supported !== true) return Promise.resolve(false)

        if (state.load) {
            if (state.load.modelId === id) {
                if (!background) setLoadDialogOpen(true)
                return state.load.promise
            }
            stopLoad()
        }
        if (id !== state.selected) changeModel(id)
        clearLoadError()
        if (state.loaded === id) return Promise.resolve(true)

        // The worker lets a running answer wind down before swapping the weights
        if (state.chat) webllmService.abort(state.chat.id)

        const token = {}
        const name = getModel(id)?.name ?? 'The model'
        state.loaded = null
        setLoadedModel(null)
        setLoading({ modelId: id, percent: 0, phase: 'prepare', downloadedBytes: null, fromCache: null })
        setLoadDialogOpen(!background)
        requestPersistence().then((value) => {
            if (value !== null) setStoragePersisted(value)
        })

        const promise = webllmService.load(id, {
            onProgress: (progress) => {
                if (state.load?.token === token) setLoading(prev => (prev?.modelId === id ? mergeProgress(prev, progress) : prev))
            },
        }).then(
            () => {
                if (state.load?.token !== token) return false
                state.load = null
                state.loaded = id
                setLoading(null)
                setLoadedModel(id)
                if (!state.dialog && !state.panel) {
                    toast.success(`${name} is loaded and ready.`, undefined, { label: 'Open assistant', onClick: () => setAiPanelOpen(true) })
                }
                return true
            },
            (error) => {
                if (state.load?.token !== token) return false
                state.load = null
                setLoading(null)
                if (error?.code === 'cancelled') return false
                setLoadErrorState({ modelId: id, message: error?.message || 'Unknown error', detail: error?.detail || null, code: error?.code || null })
                if (!state.dialog) {
                    state.errorToast = toast.error(`Couldn't load ${name}. ${error?.message || ''}`.trim(), undefined, { label: 'Details', onClick: () => setLoadDialogOpen(true) })
                }
                return false
            },
        )
        state.load = { token, modelId: id, promise }
        return promise
    }, [changeModel, stopLoad, clearLoadError, toast])

    const cancelLoad = useCallback(() => {
        if (!stopLoad()) return
        setLoadDialogOpen(false)
        toast.info('Download cancelled. Files already downloaded are kept, so loading again continues where it stopped.')
    }, [stopLoad, toast])

    /** Frees the GPU memory used by the loaded model (or cancels a load). */
    const unloadModel = useCallback(() => {
        const state = live.current
        if (state.load) {
            cancelLoad()
            return
        }
        if (!state.loaded && !state.chat) return
        const name = getModel(state.loaded)?.name ?? 'The model'
        state.loaded = null
        state.chat = null
        webllmService.terminate('unloaded')
        setLoadedModel(null)
        setThinking(false)
        clearLoadError()
        toast.info(`${name} was unloaded and its GPU memory freed.`)
    }, [cancelLoad, clearLoadError, toast])

    /**
     * Streams an answer. Resolves { text, aborted, finishReason }; rejects (and
     * calls onError) when the model isn't loaded, is busy, or generation fails.
     * The status always returns to ready (or idle/error) afterwards.
     */
    const chat = useCallback((messages, { onToken, onDone, onAbort, onError, temperature, maxTokens } = {}) => {
        const state = live.current
        const fail = (error) => {
            callSafely(onError, error)
            return Promise.reject(error)
        }
        if (state.supported !== true || state.load || !state.loaded || state.loaded !== state.selected) {
            return fail(new AIError('The AI model is not loaded', { code: 'not-loaded' }))
        }
        if (state.chat) return fail(new AIError('The AI is busy with another response', { code: 'busy' }))
        if (!Array.isArray(messages) || messages.length === 0) {
            return fail(new AIError('There is nothing to send to the AI', { code: 'invalid' }))
        }

        let text = ''
        const modelId = state.loaded
        const { id, promise } = webllmService.chat(messages, {
            temperature,
            maxTokens,
            onToken: (token) => {
                text += token
                callSafely(onToken, token, text)
            },
        })
        state.chat = { id }
        setThinking(true)

        const finish = () => {
            if (state.chat?.id !== id) return
            state.chat = null
            setThinking(false)
        }

        return promise.then(
            (result) => {
                finish()
                const out = { text: result?.text ?? text, aborted: Boolean(result?.aborted), finishReason: result?.finishReason ?? null }
                if (out.aborted) onAbort?.(out.text)
                else onDone?.(out.text)
                return out
            },
            (error) => {
                finish()
                // Unloaded or cancelled while answering: treat like a stop
                if (error?.code === 'cancelled') {
                    onAbort?.(text)
                    return { text, aborted: true, finishReason: 'abort' }
                }
                if (error?.fatal && state.loaded === modelId) {
                    state.loaded = null
                    setLoadedModel(null)
                    setLoadErrorState({ modelId, message: error.message, detail: error.detail, code: error.code })
                }
                callSafely(onError, error)
                throw error
            },
        )
    }, [])

    const abortChat = useCallback(() => {
        const current = live.current.chat
        if (current) webllmService.abort(current.id)
    }, [])

    const getCacheInfo = useCallback(() => webllmService.getCacheInfo(MODELS.map(m => m.id)), [])

    const deleteModelFiles = useCallback((modelId) => {
        if (live.current.load?.modelId === modelId) {
            return Promise.reject(new AIError('This model is loading. Cancel the download first.', { code: 'busy' }))
        }
        return webllmService.deleteModelFiles(modelId)
    }, [])

    const requestPersistentStorage = useCallback(async () => {
        const value = await requestPersistence()
        if (value !== null) setStoragePersisted(value)
        return value
    }, [])

    const value = useMemo(() => {
        const webGPUSupported = support ? support.supported : null
        let aiStatus
        if (webGPUSupported === null) aiStatus = 'checking'
        else if (!webGPUSupported) aiStatus = 'unsupported'
        else if (loading) aiStatus = 'loading'
        else if (loadErrorState) aiStatus = 'error'
        else if (loadedModel && loadedModel === selectedModel) aiStatus = thinking ? 'thinking' : 'ready'
        else aiStatus = 'idle'

        return {
            aiStatus,
            isLoaded: aiStatus === 'ready' || aiStatus === 'thinking',
            webGPUSupported,
            webGPUInfo: support,
            models: MODELS,
            getModel,
            selectedModel,
            loadedModel,
            loadingModel: loading?.modelId ?? null,
            loadProgress: loading?.percent ?? (loadedModel ? 100 : 0),
            loadPhase: loading?.phase ?? null,
            loadFromCache: loading?.fromCache ?? null,
            loadText: progressText(loading),
            loadError: loadErrorState?.message ?? null,
            loadErrorDetail: loadErrorState?.detail ?? null,
            loadErrorCode: loadErrorState?.code ?? null,
            loadErrorModel: loadErrorState?.modelId ?? null,
            loadModel,
            cancelLoad,
            unloadModel,
            changeModel,
            dismissLoadError,
            loadDialogOpen,
            showLoadDialog,
            hideLoadDialog,
            chat,
            abortChat,
            toolContext,
            setToolContext,
            aiPanelOpen,
            setAiPanelOpen,
            openAIPanel,
            closeAIPanel,
            toggleAIPanel,
            storagePersisted,
            requestPersistentStorage,
            getCacheInfo,
            deleteModelFiles,
        }
    }, [
        support, loading, loadErrorState, loadedModel, selectedModel, thinking, loadDialogOpen, toolContext, aiPanelOpen, storagePersisted,
        loadModel, cancelLoad, unloadModel, changeModel, dismissLoadError, showLoadDialog, hideLoadDialog, chat, abortChat,
        openAIPanel, closeAIPanel, toggleAIPanel, requestPersistentStorage, getCacheInfo, deleteModelFiles,
    ])

    return <AIContext.Provider value={value}>{children}</AIContext.Provider>
}

/**
 * On-device AI API:
 *
 * - aiStatus: 'checking' | 'unsupported' | 'idle' | 'loading' | 'ready' | 'thinking' | 'error'
 * - isLoaded: the selected model is in GPU memory (ready or thinking)
 * - webGPUSupported: null while checking, then boolean (webGPUInfo has the reason)
 * - selectedModel, loadedModel, loadProgress (0–100), loadText, loadError, models
 * - loadModel(modelId?, { background }) → Promise<boolean>, cancelLoad(), unloadModel(), changeModel(id)
 * - chat(messages, { onToken, onDone, onAbort, onError, temperature, maxTokens }) → Promise<{ text, aborted }>
 * - abortChat(), toolContext, setToolContext, aiPanelOpen, setAiPanelOpen, openAIPanel()
 */
export function useAI() {
    const ctx = useContext(AIContext)
    if (!ctx) throw new Error('useAI must be used within AIProvider')
    return ctx
}
