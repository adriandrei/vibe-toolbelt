import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { useToast } from '../components/ToastProvider'
import { getTool } from '../config/tools'
import { useLocalStorage } from '../hooks/useLocalStorage'

const PipelineContext = createContext(null)

const TEXT_KEY = 'pt-pipeline'

function readText() {
    try {
        const raw = sessionStorage.getItem(TEXT_KEY)
        const parsed = raw ? JSON.parse(raw) : null
        return parsed && parsed.kind === 'text' && typeof parsed.value === 'string' ? parsed : null
    } catch {
        return null
    }
}

/**
 * The pipeline moves data between tools without touching the system clipboard.
 *
 * Text payloads ({ kind: 'text', value, source, label, ts }) are what
 * <PipelineSend>/<PipelineRead> exchange. They survive reloads for the rest of
 * the browser session and show up in the header's pipeline indicator.
 *
 * Media (e.g. a screen recording handed to the Video Studio) travels through
 * a separate slot: sendMedia(file, { target }) / takeMedia(target). Only the
 * main pane takes media, and only when it's the intended target.
 *
 * The provider also holds the pinned (split view) tool route.
 */
export function PipelineProvider({ children }) {
    const toast = useToast()
    const [payload, setPayload] = useState(readText)
    const mediaRef = useRef(null)
    const [media, setMedia] = useState(null)
    const [pinnedToolRoute, setPinnedToolRoute] = useLocalStorage('pt-pinned-tool', null)

    const sendText = useCallback((value, { source = null, label } = {}) => {
        if (typeof value !== 'string' || value === '') return false
        const next = { kind: 'text', value, source, label: label ?? getTool(source)?.label ?? null, ts: Date.now() }
        setPayload(next)
        try {
            sessionStorage.setItem(TEXT_KEY, JSON.stringify(next))
        } catch {
            // too large for session storage: keep it in memory only
        }
        toast.success(`Sent to the pipeline (${value.length.toLocaleString()} chars). Open another tool and choose “Use pipeline”.`)
        return true
    }, [toast])

    const clearText = useCallback(() => {
        setPayload(null)
        try {
            sessionStorage.removeItem(TEXT_KEY)
        } catch {
            // ignore
        }
    }, [])

    const sendMedia = useCallback((file, { source = null, target = null, kind = 'video' } = {}) => {
        const next = { kind, file, source, target, ts: Date.now() }
        mediaRef.current = next
        setMedia(next)
    }, [])

    const takeMedia = useCallback((target) => {
        const current = mediaRef.current
        if (!current || (current.target && current.target !== target)) return null
        mediaRef.current = null
        setMedia(null)
        return current
    }, [])

    const value = useMemo(() => ({
        payload,
        // Backwards-compatible accessors for text consumers
        pipelineData: payload?.value ?? null,
        setPipelineData: (v) => (typeof v === 'string' ? sendText(v) : clearText()),
        sendText,
        clearText,
        sendMedia,
        takeMedia,
        hasMedia: media !== null,
        pinnedToolRoute,
        setPinnedToolRoute,
    }), [payload, sendText, clearText, sendMedia, takeMedia, media, pinnedToolRoute, setPinnedToolRoute])

    return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>
}

export function usePipeline() {
    const ctx = useContext(PipelineContext)
    if (!ctx) throw new Error('usePipeline must be used within PipelineProvider')
    return ctx
}
