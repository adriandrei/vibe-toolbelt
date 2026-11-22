import { useCallback, useEffect, useId, useMemo, useReducer, useRef, useState } from 'react'
import {
    CheckCircle2, Cpu, Database, Download, ExternalLink, FileUp, HardDrive, Loader2, MessageSquare, Monitor, Moon,
    Palette, Power, ShieldCheck, Sparkles, Sun, Trash2, X,
} from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import SliderField from '../components/ui/SliderField'
import StatusBanner from '../components/ui/StatusBanner'
import FileDropZone from '../components/ui/FileDropZone'
import Field from '../components/ui/Field'
import Modal from '../components/ui/Modal'
import { useTheme, COLOR_PRESETS } from '../components/ThemeProvider'
import { useToast } from '../components/ToastProvider'
import { useAI } from '../contexts/AIContext'
import { usePane } from '../contexts/pane'
import { LoadProgress } from '../components/ai/Progress'
import { WEBGPU_BROWSERS, formatSize, webllmService } from '../services/ai/webllmService'
import { downloadText } from '../utils/download'
import {
    DATA_NOTICE_KEY, MAX_BACKUP_FILE_BYTES, SENSITIVE_KEYS, applyRestore, backupFileName, buildBackup,
    describeDataNotice, entriesSize, groupKeys, isModelCache, labelOf, parseBackup, planRestore, readEntries,
    serializeBackup, takeDataNotice,
} from '../utils/backup'
import { SYNC_EVENT } from '../hooks/useLocalStorage'
import '../components/ai/ai.css'
import '../components/ai/settings.css'
import './AISettings.css'

const THEME_OPTIONS = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
]

function SpinningLoader(props) {
    return <Loader2 {...props} className="spin" />
}

export default function AISettings() {
    const toast = useToast()

    // Restoring a backup or clearing data reloads the page: say how it went
    useEffect(() => {
        const notice = takeDataNotice(sessionStore())
        if (!notice) return
        const { tone, message } = describeDataNotice(notice)
        toast[tone](message, 6000)
    }, [toast])

    return (
        <div className="page page-medium">
            <ToolHeader />
            <AppearanceSection />
            <AISection />
            <DataSection />
        </div>
    )
}

// ---------- Appearance ----------

function AppearanceSection() {
    const { theme, preference, setPreference, hue, setHue } = useTheme()
    const headingId = useId()
    const accentId = useId()
    const activePreset = COLOR_PRESETS.find(p => p.hue === hue)

    return (
        <section className="card settings-card" aria-labelledby={headingId}>
            <div className="settings-card-header">
                <h2 id={headingId} className="section-title">
                    <Palette size={18} aria-hidden="true" /> Appearance
                </h2>
                <p className="settings-card-desc">Saved in this browser and applied to every tool.</p>
            </div>

            <div className="settings-row">
                <div className="settings-row-text">
                    <span className="settings-label">Theme</span>
                    <div className="field-hint">
                        {preference === 'system'
                            ? `Follows your device setting (${theme} right now).`
                            : `Always ${preference}, whatever your device uses.`}
                    </div>
                </div>
                <SegmentedControl ariaLabel="Theme" options={THEME_OPTIONS} value={preference} onChange={setPreference} />
            </div>

            <div className="settings-block">
                <span className="settings-label" id={accentId}>Accent colour</span>
                <div className="settings-presets" role="group" aria-labelledby={accentId}>
                    {COLOR_PRESETS.map(preset => {
                        const active = preset.hue === hue
                        return (
                            <button
                                key={preset.name}
                                type="button"
                                className={`chip ${active ? 'is-active' : ''}`}
                                aria-pressed={active}
                                onClick={() => setHue(preset.hue)}
                            >
                                <span className="settings-swatch" style={{ background: preset.color }} aria-hidden="true" />
                                {preset.name}
                            </button>
                        )
                    })}
                </div>
                <div className="settings-hue">
                    <SliderField
                        label="Custom hue"
                        value={hue}
                        onChange={setHue}
                        min={0}
                        max={359}
                        format={(value) => `${value}°${activePreset ? ` · ${activePreset.name}` : ''}`}
                    />
                    <div className="settings-hue-scale" aria-hidden="true" />
                </div>
            </div>

            <div className="settings-preview">
                <span className="settings-label">Preview</span>
                <div className="settings-preview-box" aria-hidden="true">
                    <div className="settings-preview-head">
                        <span>Sample card</span>
                        <span className="badge badge-primary">Badge</span>
                    </div>
                    <p>
                        Body text with <span className="settings-preview-accent">accent-coloured text</span> and{' '}
                        <span style={{ color: 'var(--text-muted)' }}>muted details</span>.
                    </p>
                    <div className="settings-preview-actions">
                        <span className="btn btn-primary btn-sm">Primary</span>
                        <span className="btn btn-outline btn-sm">Outline</span>
                        <span className="chip is-active">Selected</span>
                    </div>
                </div>
            </div>
        </section>
    )
}

// ---------- On-device AI ----------

function AISection() {
    const ai = useAI()
    const toast = useToast()
    const headingId = useId()
    const radioName = useId()
    const cancelRef = useRef(null)
    const [cache, setCache] = useState(null)
    const [cacheError, setCacheError] = useState(null)
    const [storage, setStorage] = useState(null)
    const [refreshKey, refresh] = useReducer(n => n + 1, 0)
    const [confirmId, setConfirmId] = useState(null)
    const [deleting, setDeleting] = useState(false)

    const { aiStatus, loadedModel, getCacheInfo } = ai
    const settled = aiStatus !== 'loading'
    const busy = aiStatus === 'loading' || aiStatus === 'thinking'

    // Download status of each model, refreshed after loads, unloads and deletions
    useEffect(() => {
        if (!settled) return undefined
        let cancelled = false
        getCacheInfo().then(
            (info) => {
                if (cancelled) return
                setCache(info)
                setCacheError(null)
            },
            (error) => {
                if (!cancelled && error?.code !== 'cancelled') setCacheError(error?.message || 'Unknown error')
            },
        )
        navigator.storage?.estimate?.().then(
            (estimate) => {
                if (!cancelled) setStorage(estimate)
            },
            () => {},
        )
        return () => {
            cancelled = true
        }
    }, [settled, loadedModel, refreshKey, getCacheInfo])

    const confirmModel = confirmId ? ai.getModel(confirmId) : null
    const confirmInfo = confirmId ? cache?.[confirmId] : null

    const deleteFiles = async () => {
        const model = confirmModel
        if (!model) return
        setDeleting(true)
        try {
            const result = await ai.deleteModelFiles(model.id)
            toast.success(`Deleted the downloaded files for ${model.name}${result?.bytes ? ` (${formatSize(result.bytes)} freed)` : ''}.`)
        } catch (error) {
            toast.error(`Couldn't delete the files for ${model.name}: ${error?.message || 'unknown error'}`)
        } finally {
            setDeleting(false)
            setConfirmId(null)
            refresh()
        }
    }

    return (
        <section className="card settings-card" aria-labelledby={headingId}>
            <div className="settings-card-header">
                <h2 id={headingId} className="section-title">
                    <Sparkles size={18} aria-hidden="true" /> On-device AI
                </h2>
                <p className="settings-card-desc">
                    A language model running on your GPU powers the AI assistant and the AI actions in some tools.
                </p>
            </div>

            <WebGPUStatus info={ai.webGPUInfo} />

            <fieldset className="settings-models" disabled={busy}>
                <legend className="settings-label">Model</legend>
                {busy && (
                    <p className="field-hint" style={{ marginTop: 0 }}>
                        {aiStatus === 'loading' ? 'You can change the model once loading finishes or is cancelled.' : 'You can change the model once the current answer is finished.'}
                    </p>
                )}
                {ai.models.map(model => (
                    <ModelOption
                        key={model.id}
                        model={model}
                        name={radioName}
                        selected={ai.selectedModel === model.id}
                        loaded={ai.loadedModel === model.id}
                        loading={ai.loadingModel === model.id}
                        cache={cache?.[model.id]}
                        cacheUnavailable={Boolean(cacheError)}
                        onSelect={ai.changeModel}
                        onDelete={setConfirmId}
                    />
                ))}
            </fieldset>

            <ModelControls ai={ai} cacheInfo={cache?.[ai.selectedModel]} />

            <StorageInfo storage={storage} persisted={ai.storagePersisted} onRequest={ai.requestPersistentStorage} cacheError={cacheError} />

            <StatusBanner tone="info" icon={ShieldCheck} title="Private by design">
                Model files are downloaded once, from huggingface.co (the model) and raw.githubusercontent.com (its GPU code), and kept in this browser. Your prompts and tool data are processed on your device and never leave it.
            </StatusBanner>

            <Modal
                open={Boolean(confirmModel)}
                onClose={() => {
                    if (!deleting) setConfirmId(null)
                }}
                title={`Delete ${confirmModel?.name ?? 'model'} download?`}
                size="sm"
                initialFocusRef={cancelRef}
                footer={(
                    <>
                        <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={() => setConfirmId(null)} disabled={deleting}>
                            Cancel
                        </button>
                        <button type="button" className="btn btn-danger" onClick={deleteFiles} disabled={deleting}>
                            {deleting ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                            {deleting ? 'Deleting…' : 'Delete'}
                        </button>
                    </>
                )}
            >
                <div className="settings-block">
                    <p>
                        This removes {confirmInfo?.bytes ? `${formatSize(confirmInfo.bytes)} of` : 'the'} downloaded files for {confirmModel?.name} from this browser.
                        Using it again means downloading {confirmModel?.size} again.
                    </p>
                    {confirmId && ai.loadedModel === confirmId && (
                        <p className="field-hint">The model stays loaded until you unload it or reload the page.</p>
                    )}
                </div>
            </Modal>
        </section>
    )
}

function WebGPUStatus({ info }) {
    if (!info) {
        return (
            <StatusBanner tone="info" icon={SpinningLoader} title="Checking WebGPU support…">
                The model runs on your GPU through WebGPU.
            </StatusBanner>
        )
    }
    if (info.supported) {
        return (
            <StatusBanner tone="success" icon={CheckCircle2} title="WebGPU is available">
                {info.adapterName ? `This browser can run the model on your GPU (${info.adapterName}).` : 'This browser can run the model on your GPU.'}
            </StatusBanner>
        )
    }
    return (
        <StatusBanner tone="warning" title="On-device AI isn't available in this browser">
            {info.message}
            {info.reason !== 'no-webgpu' && info.reason !== 'insecure' && ` WebGPU works in ${WEBGPU_BROWSERS}, on https:// pages.`}
            {' '}
            <a className="settings-link" href="https://webgpureport.org/" target="_blank" rel="noopener noreferrer">
                Check this browser&apos;s WebGPU support
                <ExternalLink size={13} aria-hidden="true" />
                <span className="sr-only"> (opens in a new tab)</span>
            </a>
        </StatusBanner>
    )
}

function CacheBadge({ info, unavailable }) {
    if (!info) return <span className="badge">{unavailable ? 'Download status unknown' : 'Checking download…'}</span>
    switch (info.status) {
        case 'cached':
            return (
                <span className="badge badge-success">
                    <CheckCircle2 size={12} aria-hidden="true" /> Downloaded{info.bytes ? ` · ${formatSize(info.bytes)}` : ''}
                </span>
            )
        case 'partial': {
            const percent = info.totalBytes ? Math.floor((info.bytes / info.totalBytes) * 100) : null
            return <span className="badge badge-warning">Partly downloaded{percent !== null ? ` · ${percent}%` : ''}</span>
        }
        case 'none':
            return <span className="badge">Not downloaded</span>
        default:
            return <span className="badge">Download status unknown</span>
    }
}

function ModelOption({ model, name, selected, loaded, loading, cache, cacheUnavailable, onSelect, onDelete }) {
    const id = useId()
    const canDelete = (cache?.status === 'cached' || cache?.status === 'partial') && !loading
    return (
        <div className={`settings-model ${selected ? 'is-selected' : ''}`}>
            <label className="settings-model-main">
                <input
                    type="radio"
                    name={name}
                    value={model.id}
                    checked={selected}
                    onChange={() => onSelect(model.id)}
                    aria-labelledby={`${id}-name ${id}-tag`}
                    aria-describedby={`${id}-desc ${id}-meta ${id}-status`}
                />
                <span className="settings-model-body">
                    <span className="settings-model-title">
                        <span id={`${id}-name`} className="settings-model-name">{model.name}</span>
                        <span id={`${id}-tag`} className="badge">{model.tag}</span>
                        {loaded && <span className="badge badge-success">Loaded</span>}
                        {loading && <span className="badge badge-warning">Loading</span>}
                    </span>
                    <span id={`${id}-desc`} className="settings-model-desc">{model.description}</span>
                    <span id={`${id}-meta`} className="settings-model-meta">
                        <span><HardDrive size={13} aria-hidden="true" /> {model.size} download</span>
                        <span><Cpu size={13} aria-hidden="true" /> About {model.vram} of GPU memory</span>
                    </span>
                </span>
            </label>
            <div className="settings-model-footer">
                <span id={`${id}-status`}><CacheBadge info={cache} unavailable={cacheUnavailable} /></span>
                {canDelete && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(model.id)} aria-label={`Delete the ${model.name} download`}>
                        <Trash2 size={14} aria-hidden="true" /> Delete download
                    </button>
                )}
            </div>
        </div>
    )
}

function ModelControls({ ai, cacheInfo }) {
    const model = ai.getModel(ai.selectedModel)
    const name = model?.name ?? 'the model'
    const load = () => ai.loadModel(undefined, { background: true })

    if (ai.aiStatus === 'loading') {
        const loading = ai.getModel(ai.loadingModel)
        return (
            <div className="settings-load">
                <LoadProgress
                    text={ai.loadText}
                    percent={ai.loadProgress}
                    phase={ai.loadPhase}
                    label={`Loading ${loading?.name ?? name}`}
                />
                <div className="settings-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={ai.cancelLoad}>
                        <X size={14} aria-hidden="true" /> {ai.loadFromCache === false ? 'Cancel download' : 'Cancel'}
                    </button>
                    <span className="field-hint">Loading continues in the background if you leave this page.</span>
                </div>
            </div>
        )
    }

    if (ai.isLoaded) {
        return (
            <div className="settings-load">
                <StatusBanner tone="success" icon={CheckCircle2} title={`${name} is loaded`}>
                    {ai.aiStatus === 'thinking' ? "It's answering a request right now." : 'Open the assistant here or from the AI badge in the header.'}
                </StatusBanner>
                <div className="settings-actions">
                    <button type="button" className="btn btn-primary" onClick={ai.openAIPanel}>
                        <MessageSquare size={16} aria-hidden="true" /> Open assistant
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={ai.unloadModel}>
                        <Power size={16} aria-hidden="true" /> Unload
                    </button>
                    <span className="field-hint">Unloading frees about {model?.vram} of GPU memory.</span>
                </div>
            </div>
        )
    }

    if (ai.aiStatus === 'error') {
        return (
            <StatusBanner
                tone="danger"
                title={`${name} didn't load`}
                action={<button type="button" className="btn btn-sm btn-secondary" onClick={load}>Retry</button>}
            >
                {ai.loadError}
                {ai.loadErrorDetail && ai.loadErrorDetail !== ai.loadError && (
                    <details className="ai-details">
                        <summary>Technical details</summary>
                        <pre className="code-well">{ai.loadErrorDetail}</pre>
                    </details>
                )}
            </StatusBanner>
        )
    }

    const other = ai.loadedModel && ai.loadedModel !== ai.selectedModel ? ai.getModel(ai.loadedModel) : null
    let hint = `Downloads ${model?.size ?? 'about 1 GB'} the first time, then loads from this device.`
    if (ai.aiStatus === 'checking') hint = 'Checking WebGPU support…'
    else if (ai.aiStatus === 'unsupported') hint = 'Loading needs WebGPU (see above).'
    else if (cacheInfo?.status === 'cached') hint = 'Already downloaded: loads from this device.'
    else if (cacheInfo?.status === 'partial') hint = 'Partly downloaded: loading continues the download.'

    return (
        <div className="settings-load">
            {other && (
                <StatusBanner
                    tone="info"
                    title={`${other.name} is still loaded`}
                    action={<button type="button" className="btn btn-sm btn-secondary" onClick={ai.unloadModel}>Unload</button>}
                >
                    Loading {name} replaces it. Select {other.name} again to keep using it.
                </StatusBanner>
            )}
            <div className="settings-actions">
                <button type="button" className="btn btn-primary" onClick={load} disabled={ai.aiStatus !== 'idle'}>
                    <Download size={16} aria-hidden="true" /> Load {name}
                </button>
                <span className="field-hint">{hint}</span>
            </div>
        </div>
    )
}

function StorageInfo({ storage, persisted, onRequest, cacheError }) {
    const toast = useToast()
    const canPersist = typeof navigator !== 'undefined' && Boolean(navigator.storage?.persist)

    const requestPersist = async () => {
        const granted = await onRequest()
        if (granted) toast.success('Downloaded models are now protected from automatic clean-up.')
        else toast.info("The browser didn't grant persistent storage. It may allow it later, for example after you install the app.")
    }

    return (
        <div className="settings-block">
            <span className="settings-label">Storage</span>
            {Number.isFinite(storage?.usage) && (
                <span className="field-hint">
                    This site is using {formatSize(storage.usage)}
                    {Number.isFinite(storage.quota) && storage.quota > 0 ? ` of the ${formatSize(storage.quota)} the browser allows it` : ''}.
                </span>
            )}
            <div className="settings-actions">
                <span className="field-hint">
                    {persisted
                        ? 'Downloads are protected from automatic clean-up.'
                        : 'The browser may delete downloaded models if the disk runs low on space.'}
                </span>
                {!persisted && canPersist && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={requestPersist}>Keep downloads</button>
                )}
            </div>
            {cacheError && <span className="field-error" style={{ marginTop: 0 }}>Couldn&apos;t check the downloaded models: {cacheError}</span>}
        </div>
    )
}

// ---------- Your data ----------

// useLocalStorage announces same-tab writes with this event (src/hooks/useLocalStorage.js)
const LOCAL_STORAGE_SYNC_EVENT = SYNC_EVENT
const CONFIRM_WORD = 'delete'

const SENSITIVE_NAMES = { 'api-history': 'history', 'api-collections': 'saved requests', 'api-envs': 'environments' }
const SESSION_LABELS = { 'pt-pipeline': 'Text in the pipeline', 'pt-chunk-reload': 'Reload-after-update flag' }
const CHANGE = {
    added: { label: 'Added', badge: 'badge-success' },
    replaced: { label: 'Replaced', badge: 'badge-warning' },
    removed: { label: 'Removed', badge: 'badge-danger' },
}

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`

function joinList(items) {
    return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// Storage access can throw when the browser blocks it for the site
function localStore() {
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function sessionStore() {
    try {
        return window.sessionStorage
    } catch {
        return null
    }
}

function readLocal() {
    try {
        return readEntries(localStore())
    } catch {
        return Object.create(null)
    }
}

function readSessionKeys() {
    try {
        return Object.keys(readEntries(sessionStore())).filter(key => key !== DATA_NOTICE_KEY).sort()
    } catch {
        return []
    }
}

function writeNotice(notice) {
    try {
        sessionStore()?.setItem(DATA_NOTICE_KEY, JSON.stringify(notice))
    } catch {
        // the page still reloads, only without the message
    }
}

// WebLLM's model caches and how many files they hold; null without Cache Storage
async function findModelCaches() {
    if (typeof caches === 'undefined') return null
    try {
        const names = (await caches.keys()).filter(isModelCache)
        let files = 0
        for (const name of names) files += (await (await caches.open(name)).keys()).length
        return { names, files }
    } catch {
        return null
    }
}

function ItemName({ name, label = labelOf(name) }) {
    return (
        <span className="settings-data-item">
            {label}
            {label !== name && <code className="mono">{name}</code>}
        </span>
    )
}

// Long lists scroll in their own box, so what follows stays in view
function GroupedItems({ groups, badge, label }) {
    return (
        <div className="settings-data-groups settings-data-scroll" role="region" aria-label={label} tabIndex={0}>
            {groups.map(group => (
                <div key={group.id} role="group" aria-label={group.label}>
                    <div className="settings-data-group-title" aria-hidden="true">{group.label}</div>
                    <ul className="settings-data-list">
                        {group.keys.map(key => (
                            <li key={key}>
                                <ItemName name={key} label={group.labels?.[key]} />
                                {badge?.(key)}
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    )
}

function DataSection() {
    const toast = useToast()
    const { preference, hue } = useTheme()
    const { selectedModel } = useAI()
    const { size } = usePane()
    const headingId = useId()
    const sensitiveHintId = useId()
    const [entries, setEntries] = useState(readLocal)
    const [includeSensitive, setIncludeSensitive] = useState(false)
    const [restoreError, setRestoreError] = useState(null)
    const [restore, setRestore] = useState(null)
    const [clearOpen, setClearOpen] = useState(false)

    const refresh = useCallback(() => setEntries(readLocal()), [])

    // Keep the summary current: changes from other tabs and from a tool open in the split view…
    useEffect(() => {
        const events = ['storage', LOCAL_STORAGE_SYNC_EVENT, 'focus']
        for (const name of events) window.addEventListener(name, refresh)
        return () => {
            for (const name of events) window.removeEventListener(name, refresh)
        }
    }, [refresh])

    // …and from the settings above, which write to storage directly
    useEffect(() => {
        const frame = requestAnimationFrame(refresh)
        return () => cancelAnimationFrame(frame)
    }, [preference, hue, selectedModel, refresh])

    const keys = Object.keys(entries)
    const groups = groupKeys(keys)

    const exportBackup = () => {
        const now = new Date()
        const { backup, omitted } = buildBackup(readLocal(), { includeSensitive, date: now })
        const count = Object.keys(backup.entries).length
        // Named in the checkbox's order: history, saved requests and environments
        const leftOut = omitted.length ? `API Tester ${joinList(SENSITIVE_KEYS.filter(key => omitted.includes(key)).map(key => SENSITIVE_NAMES[key]))}` : ''
        if (!count) {
            toast.info(leftOut ? `Only ${leftOut} are saved, and they’re left out. Tick “Include API Tester…” to back them up.` : 'There’s nothing to back up yet.', 6000)
            return
        }
        downloadText(serializeBackup(backup), backupFileName(now), 'application/json')
        toast.success(`Backup downloaded with ${plural(count, 'item')}.${leftOut ? ` Left out: ${leftOut}.` : ''}`, leftOut ? 6000 : undefined)
    }

    const openFile = async ([file]) => {
        setRestoreError(null)
        if (!file) return
        const fail = (message) => setRestoreError({ file: file.name, message })
        if (file.size > MAX_BACKUP_FILE_BYTES) {
            fail('The file is too large to be a backup (over 20 MB).')
            return
        }
        let text
        try {
            text = await file.text()
        } catch {
            fail('The file couldn’t be read.')
            return
        }
        const result = parseBackup(text)
        if (!result.ok) {
            fail(result.error)
            return
        }
        setRestore({ id: Date.now(), fileName: file.name, backup: result.backup, current: readLocal() })
    }

    return (
        <section className="card settings-card" aria-labelledby={headingId}>
            <div className="settings-card-header">
                <h2 id={headingId} className="section-title">
                    <Database size={18} aria-hidden="true" /> Your data
                </h2>
                <p className="settings-card-desc">
                    Settings, favourites and tool data are saved in this browser only. Back them up to move them to another browser, or clear them.
                </p>
            </div>

            <div className="settings-block">
                <span className="settings-label">Saved in this browser</span>
                {keys.length > 0 ? (
                    <>
                        <ul className="settings-data-summary" aria-label="Saved data by group">
                            {groups.map(group => (
                                <li key={group.id} className="badge">{group.label} · {group.keys.length}</li>
                            ))}
                        </ul>
                        <span className="field-hint">{plural(keys.length, 'item')}, {formatSize(entriesSize(entries))} in all.</span>
                    </>
                ) : (
                    <span className="field-hint">Nothing yet. Settings you change and data you save in the tools show up here.</span>
                )}
            </div>

            <div className="settings-block">
                <span className="settings-label">Back up</span>
                <label className="settings-data-check">
                    <input
                        type="checkbox"
                        checked={includeSensitive}
                        onChange={(e) => setIncludeSensitive(e.target.checked)}
                        aria-describedby={sensitiveHintId}
                    />
                    <span>Include API Tester history, saved requests and environments (may contain tokens)</span>
                </label>
                <span id={sensitiveHintId} className="field-hint">
                    {includeSensitive
                        ? 'Keep the file private: anyone who has it can read the tokens, passwords and API keys in that data.'
                        : 'Left out of the backup: API Tester history, saved requests and environments.'}
                </span>
                <div className="settings-actions">
                    <button type="button" className="btn btn-secondary" onClick={exportBackup} disabled={keys.length === 0}>
                        <Download size={16} aria-hidden="true" /> Download backup
                    </button>
                </div>
            </div>

            <div className="settings-block">
                <span className="settings-label">Restore</span>
                <FileDropZone
                    compact={size !== 'sm'}
                    accept=".json,application/json"
                    icon={FileUp}
                    onFiles={openFile}
                    label="Choose a backup file or drop it here"
                    hint="You’ll see what changes before anything is replaced."
                />
                {restoreError && (
                    <StatusBanner tone="danger" title={`Couldn’t restore “${restoreError.file}”`}>{restoreError.message}</StatusBanner>
                )}
            </div>

            <div className="settings-block">
                <span className="settings-label">Clear</span>
                <div className="settings-actions">
                    <button type="button" className="btn btn-danger" onClick={() => setClearOpen(true)}>
                        <Trash2 size={16} aria-hidden="true" /> Clear all data…
                    </button>
                    <span className="field-hint">Removes settings, favourites and tool data from this browser.</span>
                </div>
            </div>

            {restore && <RestoreDialog key={restore.id} restore={restore} onClose={() => setRestore(null)} />}
            {clearOpen && <ClearDialog onClose={() => setClearOpen(false)} onBackup={exportBackup} />}
        </section>
    )
}

function ModeOption({ name, value, checked, onChange, title, children }) {
    const id = useId()
    return (
        <label className={`settings-data-mode ${checked ? 'is-selected' : ''}`}>
            <input
                type="radio"
                name={name}
                value={value}
                checked={checked}
                onChange={() => onChange(value)}
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-desc`}
            />
            <span>
                <span id={`${id}-title`} className="settings-data-mode-title">{title}</span>
                <span id={`${id}-desc`} className="settings-data-mode-desc">{children}</span>
            </span>
        </label>
    )
}

function RestoreDialog({ restore, onClose }) {
    const radioName = useId()
    const [mode, setMode] = useState('merge')
    const [error, setError] = useState(null)
    const { fileName, backup, current } = restore
    const plan = useMemo(() => planRestore(current, backup.entries, mode), [current, backup, mode])

    const change = new Map([
        ...plan.added.map(key => [key, 'added']),
        ...plan.replaced.map(key => [key, 'replaced']),
        ...plan.removed.map(key => [key, 'removed']),
    ])
    const summary = [
        plan.added.length && `${plan.added.length} added`,
        plan.replaced.length && `${plan.replaced.length} replaced`,
        plan.removed.length && `${plan.removed.length} removed`,
    ].filter(Boolean).join(' · ')
    const total = Object.keys(backup.entries).length
    const made = new Date(backup.exportedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

    const apply = () => {
        const storage = localStore()
        if (!storage) {
            setError('This browser doesn’t let the site store data, so nothing can be restored.')
            return
        }
        try {
            // Planned again against what's stored now, in case another tab changed something
            const result = applyRestore(storage, backup.entries, planRestore(readLocal(), backup.entries, mode))
            writeNotice({ type: 'restored', ...result })
            window.location.reload()
        } catch (e) {
            setError(e?.message || 'The backup couldn’t be restored.')
        }
    }

    return (
        <Modal
            open
            onClose={onClose}
            title="Restore this backup?"
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
                    <button type="button" className={`btn ${plan.removed.length ? 'btn-danger' : 'btn-primary'}`} onClick={apply} disabled={plan.changes === 0}>
                        {mode === 'replace' ? 'Replace all data' : 'Restore'}
                    </button>
                </>
            )}
        >
            <div className="settings-block">
                <p>
                    <strong style={{ overflowWrap: 'anywhere' }}>{fileName}</strong> was made on {made} and holds {plural(total, 'item')}.
                </p>
                <fieldset className="settings-data-modes">
                    <legend className="settings-label">How to restore</legend>
                    <ModeOption name={radioName} value="merge" checked={mode === 'merge'} onChange={setMode} title="Merge">
                        Add and update the items in the backup. Everything else stays as it is.
                    </ModeOption>
                    <ModeOption name={radioName} value="replace" checked={mode === 'replace'} onChange={setMode} title="Replace all">
                        Make this browser match the backup: saved items that aren’t in it are deleted.
                    </ModeOption>
                </fieldset>
                {plan.changes === 0 ? (
                    <StatusBanner tone="info" title="Nothing to change">
                        This browser already has everything in the backup{mode === 'replace' ? ', and nothing else' : ''}.
                    </StatusBanner>
                ) : (
                    <div className="settings-block" aria-live="polite">
                        <span className="settings-label">What changes: {summary}</span>
                        <GroupedItems
                            label="Changes"
                            groups={groupKeys([...change.keys()])}
                            badge={(key) => <span className={`badge ${CHANGE[change.get(key)].badge}`}>{CHANGE[change.get(key)].label}</span>}
                        />
                    </div>
                )}
                {plan.unchanged.length > 0 && (
                    <span className="settings-data-note">{plural(plan.unchanged.length, 'item')} {plan.unchanged.length === 1 ? 'is' : 'are'} already the same.</span>
                )}
                <span className="settings-data-note">The page reloads afterwards so every tool picks up the restored data. If the app is open in other tabs, reload them too.</span>
                {error && <StatusBanner tone="danger" title="Couldn’t restore the backup">{error}</StatusBanner>}
            </div>
        </Modal>
    )
}

function ClearDialog({ onClose, onBackup }) {
    const { getCacheInfo } = useAI()
    const modelsHintId = useId()
    const [snapshot] = useState(() => ({ local: readLocal(), session: readSessionKeys() }))
    const [models, setModels] = useState(undefined) // undefined while checking, null without Cache Storage
    const [modelBytes, setModelBytes] = useState(0)
    const [deleteModels, setDeleteModels] = useState(false)
    const [confirmText, setConfirmText] = useState('')
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        let cancelled = false
        findModelCaches().then((found) => {
            if (!cancelled) setModels(found)
        })
        getCacheInfo().then(
            (info) => {
                if (cancelled) return
                const bytes = Object.values(info || {}).reduce((sum, model) => sum + (model?.status === 'cached' || model?.status === 'partial' ? model.bytes || 0 : 0), 0)
                setModelBytes(bytes)
            },
            () => {},
        )
        return () => {
            cancelled = true
        }
    }, [getCacheInfo])

    const groups = groupKeys(Object.keys(snapshot.local))
    if (snapshot.session.length) {
        groups.push({
            id: 'session',
            label: 'This tab’s session',
            keys: snapshot.session,
            labels: Object.fromEntries(snapshot.session.map(key => [key, SESSION_LABELS[key] ?? key])),
        })
    }
    const hasModels = Boolean(models?.files)
    const confirmed = confirmText.trim().toLowerCase() === CONFIRM_WORD

    const clear = async () => {
        if (!confirmed || busy) return
        setBusy(true)
        let modelResult = null
        if (deleteModels && hasModels) {
            try {
                // Stop a download in progress and free the GPU before the files go
                webllmService.terminate('unloaded')
                const names = (await caches.keys()).filter(isModelCache)
                await Promise.all(names.map(name => caches.delete(name)))
                modelResult = { status: 'deleted' }
            } catch (error) {
                modelResult = { status: 'failed', message: error?.message || 'unknown error' }
            }
        }
        try {
            localStore()?.clear()
        } catch {
            // nothing stored, nothing to clear
        }
        try {
            sessionStore()?.clear()
        } catch {
            // same
        }
        writeNotice({ type: 'cleared', models: modelResult })
        window.location.reload()
    }

    return (
        <Modal
            open
            onClose={() => {
                if (!busy) onClose()
            }}
            title="Clear all data?"
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
                    <button type="button" className="btn btn-danger" onClick={clear} disabled={!confirmed || busy}>
                        {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                        {busy ? 'Deleting…' : 'Delete all data'}
                    </button>
                </>
            )}
        >
            <div className="settings-block">
                {groups.length > 0 ? (
                    <>
                        <p>This permanently removes what the app has saved in this browser:</p>
                        <GroupedItems label="Data to delete" groups={groups} />
                    </>
                ) : (
                    <p>Nothing is saved in this browser right now.</p>
                )}

                {models !== null && (
                    <div className="settings-block">
                        <label className="settings-data-check">
                            <input
                                type="checkbox"
                                checked={deleteModels && hasModels}
                                disabled={!hasModels || busy}
                                onChange={(e) => setDeleteModels(e.target.checked)}
                                aria-describedby={modelsHintId}
                            />
                            <span>Also delete downloaded AI models{hasModels && modelBytes > 0 ? ` (${formatSize(modelBytes)})` : ''}</span>
                        </label>
                        <span id={modelsHintId} className="settings-data-note">
                            {models === undefined
                                ? 'Checking for downloaded models…'
                                : hasModels
                                    ? 'Kept unless you tick this. Using the AI assistant again means downloading a model again.'
                                    : 'No AI model files are downloaded in this browser.'}
                        </span>
                    </div>
                )}

                <span className="settings-data-note">The app’s offline files are kept, so it still works offline. If the app is open in other tabs, reload them afterwards.</span>

                <div className="settings-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={onBackup} disabled={busy}>
                        <Download size={14} aria-hidden="true" /> Download a backup first
                    </button>
                </div>

                <Field label={`To confirm, type “${CONFIRM_WORD}”`}>
                    <input
                        type="text"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        autoComplete="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        disabled={busy}
                    />
                </Field>
            </div>
        </Modal>
    )
}
