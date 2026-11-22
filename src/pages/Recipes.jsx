import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
    AlertTriangle, ArrowDown, ArrowUp, CircleSlash, Download, Eraser, FileInput, FileOutput, FileText, FileUp, GripVertical,
    Info, Loader2, Paperclip, Pencil, Play, Plus, Save, Square, Trash2, Workflow, X,
} from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import CopyButton from '../components/ui/CopyButton'
import EmptyState from '../components/ui/EmptyState'
import Field from '../components/ui/Field'
import FileDropZone from '../components/ui/FileDropZone'
import Modal from '../components/ui/Modal'
import SegmentedControl from '../components/ui/SegmentedControl'
import ShareButton from '../components/ui/ShareButton'
import StatusBanner from '../components/ui/StatusBanner'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useToast } from '../components/ToastProvider'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { useObjectURL } from '../hooks/useObjectURL'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useSharedState } from '../hooks/useSharedState'
import { useSmartInput } from '../hooks/useSmartInput'
import { useWorkerClient } from '../utils/workerClient'
import { decodeUtf8, hexDump, looksBinaryText, sniffFileType } from '../utils/base64'
import { downloadBlob, downloadText, formatBytes } from '../utils/download'
import { GROUPS, OPERATIONS, defaultOptions, getOperation } from '../utils/recipes/operations'
import { EXAMPLES } from '../utils/recipes/examples'
import {
    MAX_NAME_LENGTH, MAX_SAVED, MAX_STEPS, cleanName, executeRecipe, newRecipeId, parseSavedRecipes,
    parseSharedState, parseSteps, serializeSaved, serializeSteps,
} from '../utils/recipes/runner'
import './Recipes.css'

// localStorage: the recipe being edited (never the input) and saved recipes
const DRAFT_KEY = 'recipes-current'
const SAVED_KEY = 'recipes-saved'

const MAX_FILE_MB = 256
// Huge outputs are shown truncated; Copy and Download use all of it
const DISPLAY_LIMIT = 100_000
const HEX_LIMIT = 4096
const EDIT_AS_TEXT_LIMIT = 5 * 1024 * 1024
const FILE_PREVIEW_BYTES = 64 * 1024
// Browsers re-lay out a textarea's whole text on every keystroke (about half
// a second per key at 12 MB), so longer text is kept out of the textarea and
// shown as a preview unless the user asks to edit it
const LARGE_TEXT = 1_000_000
const LARGE_PREVIEW_CHARS = 2000

const OPS_BY_GROUP = Object.fromEntries(GROUPS.map((g) => [g.id, OPERATIONS.filter((op) => op.group === g.id)]))
const GROUP_LABEL = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]))

// ---------------------------------------------------------------- helpers

// Step ids only live in this page (and the draft); made in event handlers
const newUid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const withUids = (steps) => steps.map((step) => ({ op: step.op, options: step.options, enabled: step.enabled, uid: newUid() }))

// The stored draft → { name, steps }. Pure: steps without a usable id get one from their position.
function recipeFromDraft(draft) {
    const source = draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : {}
    const { steps } = parseSteps(source.steps, { keepUid: true })
    const seen = new Set()
    return {
        name: cleanName(typeof source.name === 'string' ? source.name : ''),
        steps: steps.map((step, i) => {
            let uid = step.uid && !seen.has(step.uid) ? step.uid : `d${i}`
            while (seen.has(uid)) uid = `${uid}x`
            seen.add(uid)
            return { op: step.op, options: step.options, enabled: step.enabled, uid }
        }),
    }
}

const toDraft = ({ name, steps }) => ({
    v: 1,
    ...(name ? { name } : {}),
    steps: serializeSteps(steps).map((step, i) => ({ ...step, uid: steps[i].uid })),
})

const sameSteps = (a, b) => JSON.stringify(serializeSteps(a)) === JSON.stringify(serializeSteps(b))

const stepsSummary = (steps) => steps.map((s) => getOperation(s.op)?.name ?? s.op).join(' → ')

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

function valueLabel(info) {
    if (info.kind === 'text') return `Text · ${plural(info.chars, 'char')}`
    return `Bytes · ${formatBytes(info.bytes)}${info.utf8 ? ' · UTF-8' : ''}`
}

function formatMs(ms) {
    if (!Number.isFinite(ms)) return ''
    if (ms < 1) return '< 1 ms'
    if (ms < 1000) return `${Math.round(ms)} ms`
    return `${(ms / 1000).toFixed(1)} s`
}

// Typing in a big input waits a little longer before running again
function runDelay(length) {
    if (length < 100_000) return 150
    if (length < 1_000_000) return 300
    if (length < 10_000_000) return 600
    return 1000
}

// UTF-8 text of the start of a file, allowing a character cut off at the end
function decodeHead(bytes, cut) {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: cut })
    } catch {
        return null
    }
}

function searchOperations(query) {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return null
    const q = words.join(' ')
    return OPERATIONS
        .filter((op) => {
            const haystack = `${op.name} ${op.keywords ?? ''} ${op.description} ${GROUP_LABEL[op.group]}`.toLowerCase()
            return words.every((w) => haystack.includes(w))
        })
        .map((op) => {
            const name = op.name.toLowerCase()
            return { op, rank: name.startsWith(q) ? 0 : name.includes(q) ? 1 : 2 }
        })
        .sort((a, b) => a.rank - b.rank)
        .map((r) => r.op)
}

// Recipes run in a worker; this is the fallback when workers can't start
const runOnPage = (payload) => executeRecipe(payload)

// ---------------------------------------------------------------- catalog

function OperationLibrary({ onAdd, searchRef }) {
    const [query, setQuery] = useState('')
    const listId = useId()
    const hintId = useId()
    const results = useMemo(() => searchOperations(query), [query])

    const opButton = (op) => (
        <li key={op.id}>
            <button type="button" className="rcp-op" onClick={() => onAdd(op.id)} title={op.description} aria-label={`Add ${op.name}`}>
                <span>{op.name}</span>
                <Plus size={14} aria-hidden="true" />
            </button>
        </li>
    )

    return (
        <>
            <input
                ref={searchRef}
                type="search"
                className="rcp-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && results?.length) {
                        e.preventDefault()
                        onAdd(results[0].id)
                    } else if (e.key === 'Escape' && query) {
                        e.preventDefault()
                        e.stopPropagation()
                        setQuery('')
                    }
                }}
                placeholder="Search operations"
                aria-label="Search operations"
                aria-describedby={hintId}
                aria-controls={listId}
                autoComplete="off"
                spellCheck={false}
            />
            <span id={hintId} className="sr-only">Enter adds the first match to the recipe.</span>
            <div id={listId} className="rcp-lib-list" role="region" aria-label="Operations">
                {results ? (
                    results.length ? (
                        <ul className="rcp-lib-items">{results.map(opButton)}</ul>
                    ) : (
                        <p className="rcp-empty-search">No operation matches “{query.trim()}”.</p>
                    )
                ) : (
                    GROUPS.map((group) => (
                        <div key={group.id} className="rcp-lib-group" role="group" aria-labelledby={`${listId}-${group.id}`}>
                            <div id={`${listId}-${group.id}`} className="rcp-lib-group-title">{group.label}</div>
                            <ul className="rcp-lib-items">{OPS_BY_GROUP[group.id].map(opButton)}</ul>
                        </div>
                    ))
                )}
            </div>
        </>
    )
}

function ExampleList({ onLoad }) {
    return (
        <ul className="rcp-entry" aria-label="Examples">
            {EXAMPLES.map((example) => (
                <li key={example.id} className="rcp-entry-item">
                    <div className="rcp-entry-name">{example.name}</div>
                    <div className="rcp-entry-text">{example.description}</div>
                    <div className="rcp-entry-row">
                        <span className="rcp-entry-steps">{stepsSummary(example.steps)}</span>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onLoad(example)} aria-label={`Load example: ${example.name}`}>
                            Load
                        </button>
                    </div>
                </li>
            ))}
        </ul>
    )
}

function SavedList({ saved, onLoad, onDelete }) {
    if (!saved.length) {
        return (
            <EmptyState title="No saved recipes" style={{ padding: 'var(--space-md) var(--space-sm)' }}>
                Build a recipe and press Save. Recipes are kept in this browser, without their input.
            </EmptyState>
        )
    }
    const sorted = [...saved].sort((a, b) => b.savedAt - a.savedAt || a.name.localeCompare(b.name))
    return (
        <ul className="rcp-entry" aria-label="Saved recipes">
            {sorted.map((recipe) => (
                <li key={recipe.id} className="rcp-entry-item">
                    <div className="rcp-entry-name">{recipe.name}</div>
                    <div className="rcp-entry-steps">{stepsSummary(recipe.steps)}</div>
                    <div className="rcp-entry-row">
                        <span className="rcp-entry-steps">{recipe.savedAt ? new Date(recipe.savedAt).toLocaleDateString() : ''}</span>
                        <span className="rcp-actions">
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onLoad(recipe)} aria-label={`Load ${recipe.name}`}>
                                Load
                            </button>
                            <button type="button" className="icon-btn icon-btn-sm" onClick={() => onDelete(recipe)} aria-label={`Delete ${recipe.name}`} title="Delete">
                                <Trash2 size={14} aria-hidden="true" />
                            </button>
                        </span>
                    </div>
                </li>
            ))}
        </ul>
    )
}

// ---------------------------------------------------------------- recipe steps

function OptionControl({ spec, value, onChange }) {
    if (spec.type === 'boolean') {
        return (
            <label className="rcp-opt rcp-opt-check">
                <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked, true)} />
                {spec.label}
            </label>
        )
    }
    if (spec.type === 'select' || spec.type === 'number') {
        const choices = spec.type === 'number'
            ? Array.from({ length: spec.max - spec.min + 1 }, (_, i) => ({ value: spec.min + i, label: String(spec.min + i) }))
            : spec.choices
        return (
            <label className="rcp-opt">
                <span>{spec.label}</span>
                <select
                    value={String(value)}
                    onChange={(e) => onChange(spec.type === 'number' ? Number(e.target.value) : e.target.value, true)}
                >
                    {choices.map((c) => <option key={String(c.value)} value={String(c.value)}>{c.label}</option>)}
                </select>
            </label>
        )
    }
    return (
        <label className={`rcp-opt rcp-opt-text ${spec.size ? `is-${spec.size}` : ''}`}>
            <span>{spec.label}</span>
            <input
                type="text"
                className={spec.mono ? 'mono' : undefined}
                value={value}
                onChange={(e) => onChange(e.target.value, false)}
                placeholder={spec.placeholder}
                maxLength={spec.maxLength}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
            />
        </label>
    )
}

function TrailBadge({ info, stale }) {
    if (!info) return null
    if (info.status === 'skipped') return <span className="badge">Skipped</span>
    if (info.status === 'not-run') return <span className="badge">Not run</span>
    if (info.status === 'error') return <span className="badge badge-danger">Failed</span>
    const title = `${info.preview ? `${info.preview}\n` : ''}Took ${formatMs(info.ms)}`
    return (
        <span className={`badge rcp-trail ${stale ? 'rcp-stale' : ''}`} title={title}>
            <span className="sr-only">Result: </span>{valueLabel(info)}
        </span>
    )
}

function StepCard({ step, index, count, info, stale, failure, focusRequest, drag, onOption, onToggle, onMove, onRemove, onDragStart, onDragOver, onDrop, onDragEnd }) {
    const op = getOperation(step.op)
    const titleId = useId()
    const cardRef = useRef(null)
    const upRef = useRef(null)
    const downRef = useRef(null)
    const removeRef = useRef(null)
    const n = index + 1

    // Keyboard focus follows a step that was moved, or lands here after a removal
    useEffect(() => {
        if (!focusRequest || focusRequest.uid !== step.uid) return
        const usable = (el) => (el && !el.disabled ? el : null)
        let target = cardRef.current
        if (focusRequest.action === 'up') target = usable(upRef.current) ?? usable(downRef.current) ?? target
        else if (focusRequest.action === 'down') target = usable(downRef.current) ?? usable(upRef.current) ?? target
        else if (focusRequest.action === 'remove') target = removeRef.current ?? target
        target?.focus()
        if (focusRequest.action === 'card') target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
    }, [focusRequest, step.uid])

    if (!op) return null
    const visible = op.options.filter((spec) => !spec.when || spec.when(step.options))
    const notes = info?.notes ?? []
    const classes = [
        'rcp-step',
        step.enabled ? '' : 'is-off',
        failure ? 'is-error' : '',
        drag?.uid === step.uid ? 'is-dragging' : '',
        drag?.over === step.uid && drag.uid !== step.uid ? (drag.before ? 'is-drop-before' : 'is-drop-after') : '',
    ].filter(Boolean).join(' ')

    return (
        <li
            ref={cardRef}
            className={classes}
            aria-labelledby={titleId}
            tabIndex={-1}
            onDragOver={(e) => onDragOver(e, step.uid)}
            onDrop={(e) => onDrop(e, step.uid)}
        >
            <div className="rcp-step-head">
                <span
                    className="rcp-grip"
                    draggable
                    onDragStart={(e) => onDragStart(e, step.uid, cardRef.current)}
                    onDragEnd={onDragEnd}
                    title="Drag to reorder (or use the arrow buttons)"
                    aria-hidden="true"
                >
                    <GripVertical size={14} />
                </span>
                <span className="rcp-step-num" aria-hidden="true">{n}</span>
                <span className="rcp-step-name" id={titleId}>
                    <span className="sr-only">Step {n}: </span>{op.name}
                </span>
                <span className="rcp-step-actions">
                    <button
                        type="button"
                        className="icon-btn icon-btn-sm"
                        onClick={() => onToggle(step.uid)}
                        aria-pressed={!step.enabled}
                        aria-label={`Skip step ${n}`}
                        title={step.enabled ? 'Skip this step' : 'Run this step again'}
                    >
                        <CircleSlash size={14} aria-hidden="true" />
                    </button>
                    <button ref={upRef} type="button" className="icon-btn icon-btn-sm" onClick={() => onMove(step.uid, -1)} disabled={index === 0} aria-label={`Move step ${n} up`} title="Move up">
                        <ArrowUp size={14} aria-hidden="true" />
                    </button>
                    <button ref={downRef} type="button" className="icon-btn icon-btn-sm" onClick={() => onMove(step.uid, 1)} disabled={index === count - 1} aria-label={`Move step ${n} down`} title="Move down">
                        <ArrowDown size={14} aria-hidden="true" />
                    </button>
                    <button ref={removeRef} type="button" className="icon-btn icon-btn-sm" onClick={() => onRemove(step.uid)} aria-label={`Remove step ${n}`} title="Remove">
                        <X size={14} aria-hidden="true" />
                    </button>
                </span>
            </div>
            {(visible.length > 0 || info || failure) && (
                <div className="rcp-step-body">
                    {visible.length > 0 && (
                        <div className="rcp-opts" role="group" aria-label={`Step ${n} options`}>
                            {visible.map((spec) => (
                                <OptionControl
                                    key={spec.id}
                                    spec={spec}
                                    value={step.options[spec.id]}
                                    onChange={(value, immediate) => onOption(step.uid, spec.id, value, immediate)}
                                />
                            ))}
                        </div>
                    )}
                    {info && (
                        <div className="rcp-step-result">
                            <TrailBadge info={info} stale={stale} />
                        </div>
                    )}
                    {notes.length > 0 && (
                        <ul className={`rcp-notes ${stale ? 'rcp-stale' : ''}`}>
                            {notes.map((note, i) => (
                                <li key={i} className={`rcp-note ${note.tone === 'warning' ? 'is-warning' : ''}`}>
                                    {note.tone === 'warning' ? <AlertTriangle size={13} aria-hidden="true" /> : <Info size={13} aria-hidden="true" />}
                                    <span>{note.text}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                    {failure && <p className="rcp-step-error">{failure}</p>}
                </div>
            )}
        </li>
    )
}

// ---------------------------------------------------------------- page

export default function Recipes() {
    const toast = useToast()
    const inputId = useId()
    const outputTitleId = useId()
    const recipeTitleId = useId()
    const saveFormId = useId()
    const searchRef = useRef(null)
    const addButtonRef = useRef(null)
    const saveNameRef = useRef(null)
    // The next run starts without the typing delay (set by loads and step edits)
    const immediateRef = useRef(false)

    const [draft, setDraft] = useLocalStorage(DRAFT_KEY, null)
    const [recipe, setRecipe] = useState(() => recipeFromDraft(draft))
    const { steps, name: recipeName } = recipe
    const [savedRaw, setSavedRaw] = useLocalStorage(SAVED_KEY, [])
    const saved = useMemo(() => parseSavedRecipes(savedRaw), [savedRaw])

    const [inputText, setInputText] = useState('')
    // Text longer than LARGE_TEXT stays in a textarea only when the user asks
    const [editLarge, setEditLarge] = useState(false)
    const [file, setFile] = useState(null)
    const [sample, setSample] = useState(null)
    const [catalog, setCatalog] = useState('ops')
    const [includeInput, setIncludeInput] = useState(false)
    const [result, setResult] = useState(null)
    const [progress, setProgress] = useState(null)
    const [stopped, setStopped] = useState(null)
    const [rerun, setRerun] = useState(0)
    const [focusRequest, setFocusRequest] = useState(null)
    const [announcement, setAnnouncement] = useState('')
    const [saveOpen, setSaveOpen] = useState(false)
    const [saveName, setSaveName] = useState('')
    const [drag, setDrag] = useState(null)

    const client = useWorkerClient(() => new Worker(new URL('../workers/recipes.worker.js', import.meta.url), { type: 'module' }))

    const serialized = useMemo(() => steps.map(({ op, options, enabled }) => ({ op, options, enabled })), [steps])
    const hasInput = file !== null || inputText !== ''
    const source = file ?? inputText
    const largeText = file === null && inputText.length > LARGE_TEXT && !editLarge

    // ----- running

    useEffect(() => {
        if (!hasInput) {
            client.cancel()
            return undefined
        }
        const delay = immediateRef.current || file ? 0 : runDelay(inputText.length)
        immediateRef.current = false
        let cancelled = false
        let inFlight = false
        const timer = setTimeout(() => {
            const payload = { input: file ? { kind: 'file', file: file.file } : { kind: 'text', text: inputText }, steps: serialized }
            const started = performance.now()
            const finish = (data) => {
                inFlight = false
                if (!cancelled) setResult({ source, steps: serialized, data, ms: performance.now() - started })
            }
            const fail = (error) => finish({ fatal: error?.message || String(error) })
            inFlight = true
            client
                .request('run', payload, {
                    replace: true,
                    onProgress: (p) => {
                        if (!cancelled) setProgress({ source, steps: serialized, step: p?.step ?? 0 })
                    },
                })
                .then(finish, (error) => {
                    if (error?.cancelled) {
                        inFlight = false
                        return
                    }
                    // Workers unavailable (old browser, blocked): run here instead
                    if (error?.workerFailed) runOnPage(payload).then(finish, fail)
                    else fail(error)
                })
        }, delay)
        return () => {
            cancelled = true
            clearTimeout(timer)
            if (inFlight) client.cancel()
        }
    }, [hasInput, source, file, inputText, serialized, rerun, client])

    const shown = hasInput ? result : null
    const current = shown !== null && shown.source === source && shown.steps === serialized
    const isStopped = stopped !== null && stopped.source === source && stopped.steps === serialized
    const busy = hasInput && !current && !isStopped
    const data = isStopped ? null : shown?.data ?? null
    const trail = shown && shown.steps === serialized && !isStopped ? data?.trail ?? null : null
    const failure = data?.error ?? null
    const fatal = data?.fatal ?? null
    const output = data?.output ?? null
    // Text output, or bytes that are readable UTF-8 text
    const outputText = output?.text ?? null
    const binary = output?.kind === 'bytes' && output.text === null ? output : null
    const progressStep = busy && progress && progress.source === source && progress.steps === serialized ? progress.step : null

    const stop = () => {
        client.cancel()
        setStopped({ source, steps: serialized })
    }
    const runAgain = () => {
        immediateRef.current = true
        setStopped(null)
        setRerun((n) => n + 1)
    }

    // ----- recipe edits

    const commitRecipe = (next, { immediate = true } = {}) => {
        if (immediate) immediateRef.current = true
        setRecipe(next)
        setDraft(toDraft(next))
    }
    const updateSteps = (nextSteps, options) => commitRecipe({ ...recipe, steps: nextSteps }, options)

    const addStep = (opId) => {
        const op = getOperation(opId)
        if (!op) return
        if (steps.length >= MAX_STEPS) {
            toast.warning(`A recipe can have up to ${MAX_STEPS} steps.`)
            return
        }
        updateSteps([...steps, { uid: newUid(), op: op.id, options: defaultOptions(op), enabled: true }])
        setAnnouncement(`Added ${op.name} as step ${steps.length + 1}.`)
    }

    const setOption = (uid, optionId, value, immediate) => {
        updateSteps(steps.map((s) => (s.uid === uid ? { ...s, options: { ...s.options, [optionId]: value } } : s)), { immediate })
    }

    const toggleStep = (uid) => {
        const index = steps.findIndex((s) => s.uid === uid)
        if (index < 0) return
        updateSteps(steps.map((s) => (s.uid === uid ? { ...s, enabled: !s.enabled } : s)))
        setAnnouncement(`Step ${index + 1} ${steps[index].enabled ? 'skipped' : 'runs again'}.`)
    }

    const moveTo = (uid, to) => {
        const from = steps.findIndex((s) => s.uid === uid)
        if (from < 0 || to < 0 || to >= steps.length || to === from) return false
        const next = [...steps]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        updateSteps(next)
        setAnnouncement(`Moved ${getOperation(item.op)?.name ?? 'the step'} to step ${to + 1}.`)
        return true
    }

    const moveStep = (uid, delta) => {
        const from = steps.findIndex((s) => s.uid === uid)
        if (moveTo(uid, from + delta)) setFocusRequest({ uid, action: delta < 0 ? 'up' : 'down', key: newUid() })
    }

    const removeStep = (uid) => {
        const index = steps.findIndex((s) => s.uid === uid)
        if (index < 0) return
        const next = steps.filter((s) => s.uid !== uid)
        updateSteps(next)
        const neighbour = next[index] ?? next[index - 1]
        if (neighbour) setFocusRequest({ uid: neighbour.uid, action: 'remove', key: newUid() })
        else addButtonRef.current?.focus()
        setAnnouncement(`Removed step ${index + 1}, ${getOperation(steps[index].op)?.name ?? ''}.`)
    }

    const clearRecipe = () => {
        if (!steps.length) return
        const previous = recipe
        commitRecipe({ name: '', steps: [] })
        addButtonRef.current?.focus()
        toast.info('Cleared the recipe.', 6000, { label: 'Undo', onClick: () => commitRecipe(previous) })
    }

    // Replaces the whole recipe (example, saved recipe, shared link), with an undo
    const replaceRecipe = (nextSteps, name, message) => {
        const previous = recipe
        commitRecipe({ name: cleanName(name), steps: withUids(nextSteps) })
        const lost = previous.steps.length > 0 && !sameSteps(previous.steps, nextSteps)
        if (message) toast.success(message, lost ? 6000 : 3000, lost ? { label: 'Undo', onClick: () => commitRecipe(previous) } : undefined)
    }

    const focusSearch = () => {
        setCatalog('ops')
        requestAnimationFrame(() => {
            searchRef.current?.focus()
            searchRef.current?.scrollIntoView?.({ block: 'nearest' })
        })
    }

    const focusStep = (index) => {
        const step = steps[index]
        if (step) setFocusRequest({ uid: step.uid, action: 'card', key: newUid() })
    }

    // ----- drag and drop (the arrow buttons do the same from the keyboard)

    const onDragStart = (event, uid, card) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', getOperation(steps.find((s) => s.uid === uid)?.op)?.name ?? '')
        if (card) event.dataTransfer.setDragImage(card, 24, 18)
        setDrag({ uid, over: null, before: false })
    }
    const onDragOver = (event, uid) => {
        if (!drag) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        const rect = event.currentTarget.getBoundingClientRect()
        const before = event.clientY < rect.top + rect.height / 2
        if (drag.over !== uid || drag.before !== before) setDrag({ ...drag, over: uid, before })
    }
    const onDrop = (event, uid) => {
        if (!drag) return
        event.preventDefault()
        const from = steps.findIndex((s) => s.uid === drag.uid)
        let to = steps.findIndex((s) => s.uid === uid)
        if (from >= 0 && to >= 0 && drag.uid !== uid) {
            if (!drag.before) to += 1
            if (from < to) to -= 1
            moveTo(drag.uid, to)
        }
        setDrag(null)
    }
    const onDragEnd = () => setDrag(null)

    // ----- input

    // A textarea holds only LF line breaks, so text loaded into it is
    // normalized the same way: the recipe runs on exactly what's shown.
    // (Files keep their exact bytes.)
    const loadInputText = (text) => {
        immediateRef.current = true
        setFile(null)
        setInputText(text.replace(/\r\n?/g, '\n'))
        setEditLarge(false)
        setSample(null)
    }

    const clearInput = () => {
        setInputText('')
        setEditLarge(false)
        setFile(null)
        setSample(null)
    }

    const typeInput = (event) => {
        const value = event.target.value
        setInputText(value)
        // Text that grew past the limit while typing stays editable
        if (value.length > LARGE_TEXT) setEditLarge(true)
    }

    // A paste that makes the text very large never goes into the textarea:
    // the browser would take seconds to lay it out, and seconds per keystroke after
    const pasteInput = (event) => {
        const el = event.currentTarget
        const pasted = event.clipboardData?.getData('text/plain') ?? ''
        if (el.value.length - (el.selectionEnd - el.selectionStart) + pasted.length <= LARGE_TEXT) return
        event.preventDefault()
        loadInputText(el.value.slice(0, el.selectionStart) + pasted + el.value.slice(el.selectionEnd))
    }

    const openFile = async ([picked]) => {
        if (!picked) return
        try {
            const head = new Uint8Array(await picked.slice(0, FILE_PREVIEW_BYTES).arrayBuffer())
            const text = decodeHead(head, picked.size > head.length)
            const sniff = sniffFileType(head)
            const isText = text !== null && !sniff && !looksBinaryText(text)
            immediateRef.current = true
            setFile({
                file: picked,
                name: picked.name,
                size: picked.size,
                isText,
                sniff,
                preview: isText ? text.slice(0, 600) : hexDump(head, 128),
            })
            setSample(null)
        } catch {
            toast.error(`Couldn’t read ${picked.name}.`)
        }
    }

    const editFileAsText = async () => {
        if (!file) return
        try {
            const text = decodeUtf8(new Uint8Array(await file.file.arrayBuffer()))
            if (text === null) {
                toast.error('This file isn’t valid UTF-8 text, so it stays a file.')
                return
            }
            loadInputText(text)
        } catch {
            toast.error(`Couldn’t read ${file.name}.`)
        }
    }

    useSmartInput({
        input: (value) => {
            if (typeof value === 'string') loadInputText(value)
        },
    })

    // ----- examples, saved recipes, links

    const loadExample = (example) => {
        replaceRecipe(example.steps, '', `Loaded the example “${example.name}”.`)
        // Keep the user's own input; swap one example's sample for another's
        const untouchedSample = sample !== null && file === null && inputText === sample
        if (example.input !== null && ((file === null && inputText === '') || untouchedSample)) {
            immediateRef.current = true
            setInputText(example.input)
            setSample(example.input)
        } else if (example.input === null && untouchedSample) {
            setInputText('')
            setSample(null)
        }
    }

    const savedMatch = (name) => {
        const key = cleanName(name).toLocaleLowerCase()
        return key ? saved.find((r) => r.name.toLocaleLowerCase() === key) ?? null : null
    }

    const openSave = () => {
        setSaveName(recipeName)
        setSaveOpen(true)
    }

    const saveRecipe = (event) => {
        event.preventDefault()
        const name = cleanName(saveName)
        if (!name || !steps.length) return
        const existing = savedMatch(name)
        if (!existing && saved.length >= MAX_SAVED) {
            toast.error(`You can keep up to ${MAX_SAVED} saved recipes. Delete one first.`)
            return
        }
        const entry = { id: existing?.id ?? newRecipeId(), name, steps: serialized, savedAt: Date.now() }
        const next = existing ? saved.map((r) => (r.id === existing.id ? entry : r)) : [...saved, entry]
        setSavedRaw(next.map(serializeSaved))
        commitRecipe({ ...recipe, name }, { immediate: false })
        setSaveOpen(false)
        toast.success(existing ? `Updated “${name}”.` : `Saved “${name}”.`)
    }

    const loadSaved = (entry) => {
        replaceRecipe(entry.steps, entry.name, `Loaded “${entry.name}”.`)
        if (entry.unknown.length) {
            toast.warning(`Skipped ${plural(entry.unknown.length, 'step')} with an unknown operation (${entry.unknown.join(', ')}).`, 6000)
        }
    }

    const deleteSaved = (entry) => {
        const index = saved.findIndex((r) => r.id === entry.id)
        setSavedRaw(saved.filter((r) => r.id !== entry.id).map(serializeSaved))
        toast.info(`Deleted “${entry.name}”.`, 6000, {
            label: 'Undo',
            onClick: () => setSavedRaw((prev) => {
                const list = parseSavedRecipes(prev).filter((r) => r.id !== entry.id)
                list.splice(Math.max(0, Math.min(index, list.length)), 0, entry)
                return list.map(serializeSaved)
            }),
        })
    }

    const shareState = () => ({
        steps: serializeSteps(steps),
        ...(recipeName ? { name: recipeName } : {}),
        ...(includeInput && file === null && inputText ? { input: inputText } : {}),
    })

    useSharedState((shared) => {
        // Throws for anything that isn't a recipe; useSharedState shows the message
        const parsed = parseSharedState(shared)
        const previous = recipe
        replaceRecipe(parsed.steps, parsed.name, null)
        if (parsed.input !== null) loadInputText(parsed.input)
        if (parsed.problems) toast.warning(parsed.problems, 8000)
        if (previous.steps.length && !sameSteps(previous.steps, parsed.steps)) {
            toast.info('The shared recipe replaced the one you were editing.', 8000, { label: 'Undo', onClick: () => commitRecipe(previous) })
        }
    })

    useRegisterAIContext({
        tool: 'Recipes',
        getContext: () => ({
            input: `Recipe: ${stepsSummary(steps) || '(no steps)'}\n\nInput:\n${file ? `[file ${file.name}, ${formatBytes(file.size)}]` : inputText.slice(0, 4000)}`,
            output: (fatal || failure?.text || outputText || (binary ? `[binary data, ${formatBytes(binary.size)}${binary.sniff ? `, ${binary.sniff.label}` : ''}]` : '')).slice(0, 4000),
        }),
        suggestedPrompts: ['Which operations would decode this input?', 'Explain what this recipe does', 'Why does this step fail?'],
    })

    // ----- output helpers

    const lastOp = getOperation([...steps].reverse().find((s) => s.enabled)?.op)
    const ext = binary ? binary.sniff?.ext ?? 'bin' : lastOp?.ext ?? 'txt'
    const download = () => {
        if (!output) return
        const name = `recipe-output.${ext}`
        if (output.kind === 'bytes') downloadBlob(new Blob([output.bytes], { type: output.sniff?.mime || 'application/octet-stream' }), name)
        else downloadText(output.text, name)
    }

    const shownText = outputText !== null && outputText.length > DISPLAY_LIMIT ? outputText.slice(0, DISPLAY_LIMIT) : outputText
    const hex = useMemo(() => (binary ? hexDump(binary.bytes, HEX_LIMIT) : ''), [binary])
    const imageBlob = useMemo(
        () => (binary?.sniff?.mime?.startsWith('image/') ? new Blob([binary.bytes], { type: binary.sniff.mime }) : null),
        [binary]
    )
    const imageUrl = useObjectURL(imageBlob)

    let outputInfo = ''
    if (output?.kind === 'text') outputInfo = `Text · ${plural(output.chars, 'char')} · ${formatBytes(output.bytes)}`
    else if (output && binary) outputInfo = `Binary · ${binary.sniff?.label ?? 'not text'} · ${formatBytes(output.size)}`
    else if (output) outputInfo = `Bytes (UTF-8 text) · ${formatBytes(output.size)}`
    if (output && current) outputInfo += ` · ${formatMs(shown.ms)}`

    let inputInfo = ''
    if (file) inputInfo = `File · ${formatBytes(file.size)}${file.isText ? ' · text' : file.sniff ? ` · ${file.sniff.label}` : ' · binary'}`
    else if (current && data?.input) inputInfo = `Text · ${plural(data.input.chars, 'char')} · ${formatBytes(data.input.bytes)}`

    const nameTaken = savedMatch(saveName)

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="rcp-shell">
                <div className="rcp-layout">
                    <div className="rcp-build">
                        <section className="card card-compact rcp-card" aria-label="Operations, examples and saved recipes">
                            <SegmentedControl
                                size="sm"
                                block
                                className="rcp-tabs"
                                ariaLabel="Show"
                                value={catalog}
                                onChange={setCatalog}
                                options={[
                                    { value: 'ops', label: 'Operations' },
                                    { value: 'examples', label: 'Examples' },
                                    { value: 'saved', label: saved.length ? `Saved (${saved.length})` : 'Saved' },
                                ]}
                            />
                            {catalog === 'ops' && <OperationLibrary onAdd={addStep} searchRef={searchRef} />}
                            {catalog === 'examples' && <ExampleList onLoad={loadExample} />}
                            {catalog === 'saved' && <SavedList saved={saved} onLoad={loadSaved} onDelete={deleteSaved} />}
                        </section>

                        <section className="card card-compact rcp-card" aria-labelledby={recipeTitleId}>
                            <div className="rcp-card-head">
                                <div className="section-title" role="heading" aria-level={2} id={recipeTitleId}>
                                    <Workflow size={16} aria-hidden="true" /> Recipe
                                    {recipeName && <span className="rcp-muted">· {recipeName}</span>}
                                </div>
                                <div className="rcp-actions">
                                    <button ref={addButtonRef} type="button" className="btn btn-ghost btn-sm" onClick={focusSearch}>
                                        <Plus size={14} aria-hidden="true" /> Add step
                                    </button>
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={openSave} disabled={!steps.length}>
                                        <Save size={14} aria-hidden="true" /> Save
                                    </button>
                                    <ShareButton getState={shareState} disabled={!steps.length} className="btn btn-ghost btn-sm" />
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={clearRecipe} disabled={!steps.length}>
                                        <Eraser size={14} aria-hidden="true" /> Clear
                                    </button>
                                </div>
                            </div>

                            {steps.length > 0 ? (
                                <ol className="rcp-steps" aria-label="Steps">
                                    {steps.map((step, index) => (
                                        <StepCard
                                            key={step.uid}
                                            step={step}
                                            index={index}
                                            count={steps.length}
                                            info={trail?.[index] ?? null}
                                            stale={!current}
                                            failure={failure && trail && failure.index === index ? failure.message : null}
                                            focusRequest={focusRequest}
                                            drag={drag}
                                            onOption={setOption}
                                            onToggle={toggleStep}
                                            onMove={moveStep}
                                            onRemove={removeStep}
                                            onDragStart={onDragStart}
                                            onDragOver={onDragOver}
                                            onDrop={onDrop}
                                            onDragEnd={onDragEnd}
                                        />
                                    ))}
                                </ol>
                            ) : (
                                <EmptyState icon={Workflow} title="No steps yet" style={{ padding: 'var(--space-lg) var(--space-sm)' }}>
                                    Add operations from the list, or{' '}
                                    <button type="button" className="btn btn-outline btn-sm" onClick={() => setCatalog('examples')}>
                                        start from an example
                                    </button>
                                </EmptyState>
                            )}

                            {steps.length > 0 && (
                                <label className="rcp-opt-check" title={file ? 'A file can’t be put in a link' : 'Links contain the recipe; tick this to add the input text too'}>
                                    <input type="checkbox" checked={includeInput && file === null} disabled={file !== null} onChange={(e) => setIncludeInput(e.target.checked)} />
                                    Include the input in shared links
                                </label>
                            )}
                        </section>
                    </div>

                    <div className="rcp-io">
                        <section className="card card-compact rcp-card">
                            <div className="rcp-card-head">
                                {file || largeText ? (
                                    <div className="section-title" role="heading" aria-level={2}><FileInput size={16} aria-hidden="true" /> Input</div>
                                ) : (
                                    <label htmlFor={inputId} className="section-title"><FileInput size={16} aria-hidden="true" /> Input</label>
                                )}
                                <div className="rcp-actions">
                                    <PipelineRead onRead={loadInputText} />
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={clearInput} disabled={!hasInput}>
                                        <Trash2 size={14} aria-hidden="true" /> Clear
                                    </button>
                                </div>
                            </div>

                            {file ? (
                                <>
                                    <div className="code-well rcp-file">
                                        <Paperclip size={18} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                                        <div className="rcp-file-info">
                                            <div className="rcp-file-name">{file.name}</div>
                                            <div className="field-hint" style={{ marginTop: 0 }}>
                                                {formatBytes(file.size)} · {file.isText ? 'UTF-8 text' : file.sniff?.label ?? 'binary data'} · used as bytes, exactly as stored
                                            </div>
                                        </div>
                                        <div className="rcp-actions">
                                            {file.isText && file.size <= EDIT_AS_TEXT_LIMIT && (
                                                <button type="button" className="btn btn-ghost btn-sm" onClick={editFileAsText}>
                                                    <Pencil size={14} aria-hidden="true" /> Edit as text
                                                </button>
                                            )}
                                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFile(null)}>
                                                <X size={14} aria-hidden="true" /> Remove file
                                            </button>
                                        </div>
                                    </div>
                                    <pre className="code-well rcp-preview" tabIndex={0} aria-label={`Start of ${file.name}`}>{file.preview}</pre>
                                </>
                            ) : largeText ? (
                                <>
                                    <div className="code-well rcp-file">
                                        <FileText size={18} aria-hidden="true" style={{ color: 'var(--primary-text)', flexShrink: 0 }} />
                                        <div className="rcp-file-info">
                                            <div className="rcp-file-name">Large text</div>
                                            <div className="field-hint" style={{ marginTop: 0 }}>
                                                {plural(inputText.length, 'character')}. Shown as a preview so the page stays fast; the recipe uses all of it.
                                            </div>
                                        </div>
                                        <div className="rcp-actions">
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => setEditLarge(true)}
                                                title="Browsers are slow to edit text this long: each key can take a moment"
                                            >
                                                <Pencil size={14} aria-hidden="true" /> Edit as text
                                            </button>
                                        </div>
                                    </div>
                                    <pre className="code-well rcp-preview" tabIndex={0} aria-label="Start of the input">
                                        {inputText.slice(0, LARGE_PREVIEW_CHARS)}…
                                    </pre>
                                </>
                            ) : (
                                <textarea
                                    id={inputId}
                                    className="rcp-input"
                                    value={inputText}
                                    onChange={typeInput}
                                    onPaste={pasteInput}
                                    placeholder="Paste or type the input, or open a file"
                                    spellCheck={false}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                />
                            )}

                            <FileDropZone
                                compact
                                onFiles={openFile}
                                icon={FileUp}
                                label={file ? 'Open another file' : 'Open file'}
                                hint={`Or drop it here · up to ${MAX_FILE_MB} MB`}
                                maxSizeMB={MAX_FILE_MB}
                                className="rcp-dropzone"
                            />
                            {inputInfo && (
                                <div className="rcp-footer">
                                    <span className="field-hint">{inputInfo}</span>
                                </div>
                            )}
                        </section>

                        <section className="card card-compact rcp-card" aria-busy={busy}>
                            <div className="rcp-card-head">
                                <div className="section-title" role="heading" aria-level={2} id={outputTitleId}>
                                    <FileOutput size={16} aria-hidden="true" /> Output
                                </div>
                                <div className="rcp-actions">
                                    {busy && (
                                        <span className="rcp-busy">
                                            <Loader2 size={14} className="spin" aria-hidden="true" />
                                            {progressStep !== null && steps.length ? `Step ${Math.min(progressStep + 1, steps.length)} of ${steps.length}…` : 'Running…'}
                                            <button type="button" className="btn btn-ghost btn-sm" onClick={stop}>
                                                <Square size={12} aria-hidden="true" /> Stop
                                            </button>
                                        </span>
                                    )}
                                    <CopyButton text={outputText ?? ''} disabled={!outputText || !current} />
                                </div>
                            </div>

                            {isStopped && (
                                <StatusBanner
                                    tone="warning"
                                    title="Stopped"
                                    action={(
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={runAgain}>
                                            <Play size={14} aria-hidden="true" /> Run again
                                        </button>
                                    )}
                                >
                                    The recipe was stopped before it finished.
                                </StatusBanner>
                            )}

                            {fatal && (
                                <StatusBanner tone="danger" title="Couldn’t run the recipe">{fatal}</StatusBanner>
                            )}

                            {failure && (
                                <StatusBanner
                                    tone="danger"
                                    className={current ? '' : 'rcp-stale'}
                                    action={(
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => focusStep(failure.index)}>
                                            Show step
                                        </button>
                                    )}
                                >
                                    <strong>Step {failure.index + 1} · {failure.name}:</strong> {failure.message}
                                </StatusBanner>
                            )}

                            {binary && (
                                <StatusBanner
                                    tone="info"
                                    title={binary.sniff ? `Binary data: ${binary.sniff.label}` : 'Binary data (not text)'}
                                    className={current ? '' : 'rcp-stale'}
                                >
                                    <div>Shown as hex. Download it, or add a step that turns it into text:</div>
                                    <div className="rcp-actions" style={{ marginTop: 'var(--space-xs)' }}>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => addStep('hex-encode')}>Hex encode</button>
                                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => addStep('base64-encode')}>Base64 encode</button>
                                    </div>
                                </StatusBanner>
                            )}

                            {!hasInput ? (
                                <div className="code-well rcp-empty-output">
                                    <EmptyState title="Output appears here" style={{ margin: 'auto' }}>
                                        Type or paste the input, or open a file. The recipe runs as you type.
                                    </EmptyState>
                                </div>
                            ) : binary ? (
                                <>
                                    {imageUrl && (
                                        <div className="checkerboard rcp-image">
                                            <img src={imageUrl} alt="Preview of the output image" />
                                        </div>
                                    )}
                                    <pre className={`code-well rcp-hex ${current ? '' : 'rcp-stale'}`} tabIndex={0} aria-labelledby={outputTitleId}>{hex}</pre>
                                    {binary.size > HEX_LIMIT && (
                                        <div className="field-hint" style={{ marginTop: 0 }}>
                                            Showing the first {formatBytes(HEX_LIMIT)} of {formatBytes(binary.size)}. Download has all of it.
                                        </div>
                                    )}
                                </>
                            ) : shownText !== null ? (
                                <>
                                    <pre className={`code-well rcp-output ${current ? '' : 'rcp-stale'}`} tabIndex={0} aria-labelledby={outputTitleId}>{shownText}</pre>
                                    {shownText.length < outputText.length && (
                                        <div className="field-hint" style={{ marginTop: 0 }}>
                                            Showing the first {DISPLAY_LIMIT.toLocaleString()} of {outputText.length.toLocaleString()} characters. Copy and Download use all of it.
                                        </div>
                                    )}
                                    {!steps.length && current && (
                                        <div className="field-hint" style={{ marginTop: 0 }}>No steps yet, so the output is the input.</div>
                                    )}
                                </>
                            ) : !failure && !fatal && !isStopped ? (
                                <div className="code-well rcp-empty-output" aria-hidden="true" />
                            ) : null}

                            <div className="rcp-footer">
                                <span className="field-hint">{outputInfo}</span>
                                <div className="rcp-actions">
                                    <PipelineSend dataToSend={outputText ?? ''} disabled={!outputText || !current} />
                                    <button type="button" className="btn btn-ghost btn-sm" onClick={download} disabled={!output || !current}>
                                        <Download size={14} aria-hidden="true" /> {binary ? `Download .${ext}` : 'Download'}
                                    </button>
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </div>

            <Modal
                open={saveOpen}
                onClose={() => setSaveOpen(false)}
                title="Save recipe"
                size="sm"
                initialFocusRef={saveNameRef}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={() => setSaveOpen(false)}>Cancel</button>
                        <button type="submit" form={saveFormId} className="btn btn-primary" disabled={!cleanName(saveName)}>
                            {nameTaken ? 'Replace' : 'Save'}
                        </button>
                    </>
                )}
            >
                <form id={saveFormId} onSubmit={saveRecipe}>
                    <Field
                        label="Name"
                        hint={nameTaken
                            ? `There’s a saved recipe called “${nameTaken.name}”. Saving replaces it.`
                            : `${plural(steps.length, 'step')}. Saved in this browser only, without the input.`}
                    >
                        <input
                            ref={saveNameRef}
                            type="text"
                            value={saveName}
                            onChange={(e) => setSaveName(e.target.value)}
                            maxLength={MAX_NAME_LENGTH}
                            placeholder="For example: Read session cookie"
                            autoComplete="off"
                        />
                    </Field>
                </form>
            </Modal>

            <div className="sr-only" aria-live="polite">{announcement}</div>
        </div>
    )
}
