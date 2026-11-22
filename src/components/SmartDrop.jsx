import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, FileUp } from 'lucide-react'
import Modal from './ui/Modal'
import { useToast } from './ToastProvider'
import { usePipeline } from '../contexts/PipelineContext'
import { FALLBACK_ICON, getTool } from '../config/tools'
import { analyzeContent } from '../utils/detect'
import { openInTool } from '../utils/smartNav'
import { formatBytes } from '../utils/download'
import { KIND_NOUNS, MAX_TEXT_HANDOFF, fileKind, looksLikeHar, pickGroup, routesFor, sniffKind } from '../utils/fileRouting'
import './SmartDrop.css'

const SNIFF_BYTES = 64 * 1024
// The service worker (src/sw.js) keeps shared files and text here for the page.
const SHARE_CACHE = 'share-target'
const SHARE_PARAM = 'share-target'

const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')
// Drops on a FileDropZone (or anything marked data-drop-target) belong to that page.
const inDropTarget = (event) => event.target instanceof Element && !!event.target.closest('.drop-zone, [data-drop-target]')

async function classify(file) {
    let kind = fileKind(file)
    let detected = null
    if (!kind || kind === 'json' || kind === 'text') {
        const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer())
        if (!kind) kind = sniffKind(head)
        if (kind === 'json' && looksLikeHar(new TextDecoder().decode(head))) kind = 'har'
        // Whole small text files are checked like a paste (a JWT, a cURL command…)
        if (kind === 'text' && file.size <= SNIFF_BYTES) {
            const result = analyzeContent(new TextDecoder().decode(head).trim())
            if (result) detected = { tool: result.tool, mode: result.mode, label: result.label }
        }
    }
    return { file, kind, detected }
}

async function takeSharedItems() {
    if (!('caches' in window)) return null
    const cache = await caches.open(SHARE_CACHE)
    const manifest = await cache.match('/share-target/manifest.json')
    if (!manifest) return null
    const data = await manifest.json()
    const files = []
    for (const entry of Array.isArray(data.files) ? data.files : []) {
        const response = await cache.match(entry.key)
        if (response) files.push(new File([await response.blob()], entry.name || 'shared-file', { type: entry.type || '' }))
    }
    await caches.delete(SHARE_CACHE)
    const text = [data.title, data.text, data.url].filter(v => typeof v === 'string' && v.trim()).join('\n').trim()
    return { files, text }
}

/**
 * Smart Drop: a file dropped anywhere outside a drop zone offers the tools
 * that can open it. The same chooser handles files opened with the installed
 * app ("Open with", via the File Handling API's launchQueue) and files or text
 * shared to it from other apps (Web Share Target, see src/sw.js).
 *
 * Without this, a file dropped on the page would replace the app with the
 * file, so drops with files are always intercepted.
 */
export default function SmartDrop() {
    const navigate = useNavigate()
    const location = useLocation()
    const toast = useToast()
    const { sendMedia } = usePipeline()
    const [offer, setOffer] = useState(null)
    const [dragging, setDragging] = useState(false)
    const [overZone, setOverZone] = useState(false)
    const firstRef = useRef(null)
    const pathRef = useRef(location.pathname)

    useEffect(() => {
        pathRef.current = location.pathname
    }, [location.pathname])

    const offerFiles = useCallback(async (files) => {
        try {
            const entries = await Promise.all(files.map(classify))
            const group = pickGroup(entries)
            if (!group) return
            const first = entries.find(e => e.file === group.files[0])
            const routes = routesFor(group.kind, { size: group.files[0].size, detected: first?.detected })
            setOffer({ id: Date.now(), ...group, routes, detected: first?.detected ?? null })
        } catch {
            toast.error('Couldn’t read the dropped file.')
        }
    }, [toast])

    const offerText = useCallback((text) => {
        const result = analyzeContent(text)
        const detected = result ? { tool: result.tool, mode: result.mode, label: result.label } : null
        const routes = routesFor('text', { size: text.length, detected }).filter(r => r.how === 'text')
        setOffer({ id: Date.now(), kind: 'text', files: [], text, skipped: 0, routes, detected })
    }, [])

    const offerFilesRef = useRef(offerFiles)
    const offerTextRef = useRef(offerText)
    useEffect(() => {
        offerFilesRef.current = offerFiles
        offerTextRef.current = offerText
    })

    // Drag and drop anywhere on the page
    useEffect(() => {
        let depth = 0
        const onDragEnter = (event) => {
            if (!hasFiles(event)) return
            depth += 1
            setDragging(true)
        }
        const onDragLeave = (event) => {
            if (!hasFiles(event)) return
            depth = Math.max(0, depth - 1)
            if (depth === 0) setDragging(false)
        }
        const onDragOver = (event) => {
            if (!hasFiles(event)) return
            event.preventDefault()
            setOverZone(inDropTarget(event))
            if (!inDropTarget(event) && event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
        }
        const onDrop = (event) => {
            if (!hasFiles(event)) return
            depth = 0
            setDragging(false)
            event.preventDefault()
            if (inDropTarget(event)) return
            const files = Array.from(event.dataTransfer?.files || [])
            if (files.length) offerFilesRef.current(files)
        }
        window.addEventListener('dragenter', onDragEnter)
        window.addEventListener('dragleave', onDragLeave)
        window.addEventListener('dragover', onDragOver)
        window.addEventListener('drop', onDrop)
        return () => {
            window.removeEventListener('dragenter', onDragEnter)
            window.removeEventListener('dragleave', onDragLeave)
            window.removeEventListener('dragover', onDragOver)
            window.removeEventListener('drop', onDrop)
        }
    }, [])

    // "Open with" on the installed app (manifest file_handlers)
    useEffect(() => {
        if (!('launchQueue' in window) || typeof window.launchQueue?.setConsumer !== 'function') return
        window.launchQueue.setConsumer(async (params) => {
            if (!params?.files?.length) return
            const files = (await Promise.all(params.files.map(handle => handle.getFile().catch(() => null)))).filter(Boolean)
            if (files.length) offerFilesRef.current(files)
        })
    }, [])

    // Files or text shared to the installed app (manifest share_target)
    useEffect(() => {
        const params = new URLSearchParams(location.search)
        if (!params.has(SHARE_PARAM)) return
        params.delete(SHARE_PARAM)
        const rest = params.toString()
        navigate(`${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`, { replace: true })
        takeSharedItems()
            .then((shared) => {
                if (!shared) return
                if (shared.files.length) offerFilesRef.current(shared.files)
                else if (shared.text) offerTextRef.current(shared.text)
            })
            .catch(() => toast.error('Couldn’t open what was shared.'))
        // On load only
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const choose = async (route) => {
        const current = offer
        setOffer(null)
        if (!current) return
        if (route.how === 'file') {
            sendMedia(current.files[0], { source: 'smart-drop', target: route.tool, kind: 'file', files: current.files })
            if (pathRef.current !== route.tool) navigate(route.tool)
            return
        }
        try {
            const text = current.text ?? (await current.files[0].text())
            openInTool(navigate, route.tool, { input: text, ...(route.mode ? { mode: route.mode } : {}) })
        } catch {
            toast.error('Couldn’t read the file as text.')
        }
    }

    const count = offer ? (offer.files.length || 1) : 0
    const noun = offer ? (KIND_NOUNS[offer.kind] || KIND_NOUNS.binary)[count === 1 ? 0 : 1] : ''
    const title = !offer ? '' : offer.text !== undefined && !offer.files.length
        ? 'Open the shared text in…'
        : count === 1 ? `Open “${offer.files[0].name}” in…` : `Open ${count} ${noun} in…`
    const detail = !offer ? '' : offer.files.length
        ? `${count === 1 ? `${formatBytes(offer.files[0].size)} · ${offer.detected?.label ?? noun}` : formatBytes(offer.files.reduce((sum, f) => sum + f.size, 0))}`
        : `${offer.text.length.toLocaleString()} characters${offer.detected ? ` · ${offer.detected.label}` : ''}`

    return (
        <>
            {dragging && !overZone && (
                <div className="smart-drop-hint" aria-hidden="true">
                    <FileUp size={18} />
                    Drop to pick a tool for it
                </div>
            )}
            <Modal
                open={!!offer}
                onClose={() => setOffer(null)}
                title={title}
                size="sm"
                initialFocusRef={firstRef}
            >
                {offer && (
                    <div className="smart-drop">
                        <p className="smart-drop-detail">
                            {detail}. It stays on this device.
                            {offer.skipped > 0 && ` ${offer.skipped} file${offer.skipped === 1 ? ' is' : 's are'} of another type and won’t be opened.`}
                            {offer.files.length > 1 && offer.routes.some(r => r.how === 'text') && ' Text tools open only the first file.'}
                            {offer.files.length === 1 && offer.files[0].size > MAX_TEXT_HANDOFF && offer.kind !== 'binary' && ' It’s too big to open as text, so only tools that take the file itself are listed.'}
                        </p>
                        <ul className="smart-drop-list">
                            {offer.routes.map((route, index) => {
                                const tool = getTool(route.tool)
                                if (!tool) return null
                                const Icon = tool.icon || FALLBACK_ICON
                                return (
                                    <li key={`${route.tool}-${route.mode ?? ''}`}>
                                        <button
                                            ref={index === 0 ? firstRef : undefined}
                                            type="button"
                                            className="smart-drop-option"
                                            onClick={() => choose(route)}
                                        >
                                            <Icon size={18} aria-hidden="true" className="smart-drop-option-icon" />
                                            <span className="smart-drop-option-text">
                                                <span className="smart-drop-option-title">
                                                    {tool.title}
                                                    {index === 0 && <span className="badge smart-drop-best">Best match</span>}
                                                </span>
                                                <span className="smart-drop-option-desc">{tool.description}</span>
                                            </span>
                                            <ArrowRight size={16} aria-hidden="true" className="smart-drop-option-go" />
                                        </button>
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                )}
            </Modal>
        </>
    )
}
