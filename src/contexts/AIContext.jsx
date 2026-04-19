import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import { webllmService, DEFAULT_MODEL, MODELS } from '../services/ai/webllmService'

const AIContext = createContext(null)

export function AIProvider({ children }) {
    const [aiStatus, setAiStatus] = useState('idle')
    const [loadProgress, setLoadProgress] = useState(0)
    const [loadText, setLoadText] = useState('')
    const [selectedModel, setSelectedModel] = useState(
        () => localStorage.getItem('ai_model') || DEFAULT_MODEL
    )
    const [aiPanelOpen, setAiPanelOpen] = useState(false)
    const [webGPUSupported, setWebGPUSupported] = useState(null)
    const [toolContext, setToolContext] = useState(null)
    const currentChatId = useRef(null)

    // Check WebGPU support on mount
    useEffect(() => {
        webllmService.checkWebGPUSupport().then((supported) => {
            setWebGPUSupported(supported)
            if (!supported) setAiStatus('unsupported')
        })
    }, [])

    const loadModel = useCallback(async (modelId = selectedModel) => {
        if (aiStatus === 'loading') return
        if (!webGPUSupported) return

        setAiStatus('loading')
        setLoadProgress(0)
        setLoadText('Initializing…')

        try {
            await webllmService.loadModel(modelId, {
                onProgress: (progress, text) => {
                    setLoadProgress(Math.round(progress * 100))
                    setLoadText(text || '')
                }
            })
            setAiStatus('ready')
            setLoadProgress(100)
        } catch (err) {
            console.error('[AIContext] Failed to load model:', err)
            setAiStatus('idle')
        }
    }, [aiStatus, selectedModel, webGPUSupported])

    const chat = useCallback(async (messages, { onToken, onDone, onAbort } = {}) => {
        if (aiStatus !== 'ready') return

        setAiStatus('thinking')
        const { id, promise } = webllmService.chat(messages, {
            onToken,
            onDone: () => {
                setAiStatus('ready')
                onDone?.()
            },
            onAbort: () => {
                setAiStatus('ready')
                onAbort?.()
            },
        })
        currentChatId.current = id
        await promise
    }, [aiStatus])

    const abortChat = useCallback(() => {
        if (currentChatId.current) {
            webllmService.abort(currentChatId.current)
            currentChatId.current = null
        }
    }, [])

    const changeModel = useCallback((modelId) => {
        setSelectedModel(modelId)
        localStorage.setItem('ai_model', modelId)
        setAiStatus('idle') // Force reload on next use
    }, [])

    return (
        <AIContext.Provider value={{
            aiStatus,
            loadProgress,
            loadText,
            selectedModel,
            webGPUSupported,
            aiPanelOpen,
            setAiPanelOpen,
            toolContext,
            setToolContext,
            loadModel,
            chat,
            abortChat,
            changeModel,
            models: MODELS,
        }}>
            {children}
        </AIContext.Provider>
    )
}

export function useAI() {
    const ctx = useContext(AIContext)
    if (!ctx) throw new Error('useAI must be used within AIProvider')
    return ctx
}
