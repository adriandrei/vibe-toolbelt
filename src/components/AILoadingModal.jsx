import { useEffect, useRef } from 'react'
import { CheckCircle2, HardDrive, ShieldCheck } from 'lucide-react'
import { useAI } from '../contexts/AIContext'
import Modal from './ui/Modal'
import StatusBanner from './ui/StatusBanner'
import { LoadProgress } from './ai/Progress'
import './ai/ai.css'

const READY_AUTO_CLOSE_MS = 2500

/**
 * Progress / result dialog for loading the AI model. It never traps the user:
 * Escape, the overlay and "Continue in background" hide it while loading goes
 * on (progress stays in the header badge), and "Cancel download" stops it.
 * Failures show the error with Retry and Close.
 */
export default function AILoadingModal() {
    const {
        aiStatus, loadDialogOpen, hideLoadDialog, dismissLoadError,
        loadingModel, selectedModel, loadErrorModel, getModel, models,
        loadProgress, loadPhase, loadFromCache, loadText,
        loadError, loadErrorDetail, loadErrorCode,
        loadModel, cancelLoad, openAIPanel,
    } = useAI()
    const primaryRef = useRef(null)

    const view = aiStatus === 'loading' ? 'loading' : aiStatus === 'error' ? 'error' : aiStatus === 'ready' ? 'ready' : null
    const open = loadDialogOpen && view !== null

    // A finished load shows its result briefly, then gets out of the way
    useEffect(() => {
        if (!open || view !== 'ready') return undefined
        const timer = setTimeout(hideLoadDialog, READY_AUTO_CLOSE_MS)
        return () => clearTimeout(timer)
    }, [open, view, hideLoadDialog])

    // Keep focus on the main action as the dialog moves between states
    useEffect(() => {
        if (open) primaryRef.current?.focus()
    }, [open, view])

    if (!open) return null

    if (view === 'error') {
        const model = getModel(loadErrorModel) || getModel(selectedModel)
        const lighter = loadErrorCode === 'gpu-memory' ? models.find(m => m.id !== model?.id && m.tag === 'Lightweight') : null
        return (
            <Modal
                open
                onClose={dismissLoadError}
                title="Couldn't load the AI model"
                size="sm"
                initialFocusRef={primaryRef}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={dismissLoadError}>Close</button>
                        {lighter && (
                            <button type="button" className="btn btn-secondary" onClick={() => loadModel(lighter.id)}>
                                Use {lighter.name}
                            </button>
                        )}
                        <button ref={primaryRef} type="button" className="btn btn-primary" onClick={() => loadModel(model?.id)}>
                            Retry
                        </button>
                    </>
                )}
            >
                <div className="ai-load-dialog">
                    <StatusBanner tone="danger" title={model ? `${model.name} didn't load` : 'Loading failed'}>
                        {loadError}
                    </StatusBanner>
                    {loadErrorDetail && loadErrorDetail !== loadError && (
                        <details className="ai-details">
                            <summary>Technical details</summary>
                            <pre className="code-well">{loadErrorDetail}</pre>
                        </details>
                    )}
                </div>
            </Modal>
        )
    }

    if (view === 'ready') {
        const model = getModel(selectedModel)
        return (
            <Modal
                open
                onClose={hideLoadDialog}
                title="AI ready"
                size="sm"
                initialFocusRef={primaryRef}
                footer={(
                    <>
                        <button type="button" className="btn btn-secondary" onClick={hideLoadDialog}>Close</button>
                        <button
                            ref={primaryRef}
                            type="button"
                            className="btn btn-primary"
                            onClick={() => {
                                hideLoadDialog()
                                openAIPanel()
                            }}
                        >
                            Open assistant
                        </button>
                    </>
                )}
            >
                <StatusBanner tone="success" icon={CheckCircle2} title={`${model?.name ?? 'The model'} is loaded`}>
                    It runs on your GPU. Your prompts and data stay on this device.
                </StatusBanner>
            </Modal>
        )
    }

    const model = getModel(loadingModel)
    const downloading = loadFromCache === false
    const title = loadPhase === 'download' ? `Downloading ${model?.name ?? 'the AI model'}` : `Loading ${model?.name ?? 'the AI model'}`

    return (
        <Modal
            open
            onClose={hideLoadDialog}
            title={title}
            size="sm"
            initialFocusRef={primaryRef}
            footer={(
                <>
                    <button type="button" className="btn btn-secondary" onClick={cancelLoad}>
                        {downloading ? 'Cancel download' : 'Cancel'}
                    </button>
                    <button ref={primaryRef} type="button" className="btn btn-primary" onClick={hideLoadDialog}>
                        Continue in background
                    </button>
                </>
            )}
        >
            <div className="ai-load-dialog">
                <LoadProgress
                    text={loadText}
                    percent={loadProgress}
                    phase={loadPhase}
                    label={`Loading ${model?.name ?? 'the AI model'}`}
                />
                <div className="ai-load-note">
                    <HardDrive size={16} aria-hidden="true" />
                    <span>
                        {loadFromCache
                            ? 'Loading from this device. Nothing is downloaded.'
                            : `First use downloads about ${model?.size ?? '1 GB'} from huggingface.co. It's saved in this browser, so next time it loads from your device.`}
                    </span>
                </div>
                <div className="ai-load-note">
                    <ShieldCheck size={16} aria-hidden="true" />
                    <span>The model runs on your GPU. Your prompts and data never leave this device. You can keep working while it loads.</span>
                </div>
            </div>
        </Modal>
    )
}
