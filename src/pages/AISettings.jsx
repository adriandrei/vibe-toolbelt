import { useEffect, useId, useReducer, useRef, useState } from 'react'
import {
    CheckCircle2, Cpu, Download, ExternalLink, HardDrive, Loader2, MessageSquare, Monitor, Moon,
    Palette, Power, ShieldCheck, Sparkles, Sun, Trash2, X,
} from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import SliderField from '../components/ui/SliderField'
import StatusBanner from '../components/ui/StatusBanner'
import Modal from '../components/ui/Modal'
import { useTheme, COLOR_PRESETS } from '../components/ThemeProvider'
import { useToast } from '../components/ToastProvider'
import { useAI } from '../contexts/AIContext'
import { LoadProgress } from '../components/ai/Progress'
import { WEBGPU_BROWSERS, formatSize } from '../services/ai/webllmService'
import '../components/ai/ai.css'
import '../components/ai/settings.css'

const THEME_OPTIONS = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
]

function SpinningLoader(props) {
    return <Loader2 {...props} className="spin" />
}

export default function AISettings() {
    return (
        <div className="page page-medium">
            <ToolHeader />
            <AppearanceSection />
            <AISection />
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
