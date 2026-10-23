import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bot, Loader2, Sparkles } from 'lucide-react'
import { useAI } from '../contexts/AIContext'
import { ProgressRing } from './ai/Progress'
import { AI_PANEL_ID, SETTINGS_PATH } from './ai/constants'

/**
 * AI status in the app header. Compact (icon only) on narrow screens, with the
 * full status in its accessible name.
 *
 * idle → starts loading · loading → shows the progress dialog · ready/thinking →
 * toggles the assistant · error → shows what went wrong · unsupported → opens
 * Settings, which explains why.
 */
export default function AIStatusBadge() {
    const {
        aiStatus, loadProgress, loadPhase, loadingModel, aiPanelOpen, toggleAIPanel, loadModel, showLoadDialog,
        selectedModel, getModel, webGPUInfo,
    } = useAI()
    const navigate = useNavigate()
    const model = getModel(selectedModel)
    const modelName = model?.name ?? 'the AI model'

    let cfg
    switch (aiStatus) {
        case 'checking':
            cfg = {
                className: '',
                icon: <Loader2 size={12} className="spin" aria-hidden="true" />,
                label: 'AI',
                aria: 'Checking whether this browser can run the AI',
                disabled: true,
            }
            break
        case 'unsupported':
            cfg = {
                className: '',
                icon: <AlertTriangle size={12} aria-hidden="true" />,
                label: 'AI unavailable',
                aria: 'AI unavailable: open Settings to see why',
                title: webGPUInfo?.message || 'This browser cannot run the on-device AI',
                onClick: () => navigate(SETTINGS_PATH),
            }
            break
        case 'loading': {
            const starting = !loadPhase || loadPhase === 'prepare'
            const loadingName = getModel(loadingModel)?.name ?? modelName
            cfg = {
                className: 'badge-warning',
                icon: starting ? <Loader2 size={12} className="spin" aria-hidden="true" /> : <ProgressRing value={loadProgress} size={13} />,
                label: starting ? 'AI…' : `AI ${loadProgress}%`,
                aria: starting ? `AI…: starting to load ${loadingName}, show progress` : `AI ${loadProgress}%: loading ${loadingName}, show progress`,
                onClick: showLoadDialog,
            }
            break
        }
        case 'error':
            cfg = {
                className: 'badge-danger',
                icon: <AlertTriangle size={12} aria-hidden="true" />,
                label: 'AI error',
                aria: `AI error: ${modelName} failed to load, show details`,
                onClick: showLoadDialog,
            }
            break
        case 'thinking':
            cfg = {
                className: 'badge-primary',
                icon: <Sparkles size={12} aria-hidden="true" style={{ animation: 'pulse 1s ease-in-out infinite' }} />,
                label: 'Thinking…',
                aria: `Thinking…: ${aiPanelOpen ? 'close' : 'open'} the AI assistant`,
                onClick: toggleAIPanel,
                expanded: aiPanelOpen,
            }
            break
        case 'ready':
            cfg = {
                className: aiPanelOpen ? 'badge-primary' : 'badge-success',
                icon: <Bot size={12} aria-hidden="true" />,
                label: 'AI ready',
                aria: `AI ready: ${aiPanelOpen ? 'close' : 'open'} the AI assistant`,
                onClick: toggleAIPanel,
                expanded: aiPanelOpen,
            }
            break
        default:
            cfg = {
                className: '',
                icon: <Sparkles size={12} aria-hidden="true" />,
                label: 'Load AI',
                aria: `Load AI: start ${modelName} (${model?.size ?? ''} download on first use)`,
                title: `Load ${modelName}. The first time, this downloads ${model?.size ?? 'about 1 GB'}; after that it loads from this device.`,
                onClick: () => loadModel(),
            }
            break
    }

    const isPanelToggle = cfg.expanded !== undefined

    return (
        <button
            type="button"
            className={`badge ${cfg.className}`}
            onClick={cfg.onClick}
            disabled={cfg.disabled}
            aria-label={cfg.aria}
            title={cfg.title ?? cfg.aria}
            aria-expanded={isPanelToggle ? cfg.expanded : undefined}
            aria-controls={isPanelToggle && cfg.expanded ? AI_PANEL_ID : undefined}
            style={{ cursor: cfg.disabled ? 'default' : 'pointer', flexShrink: 0 }}
        >
            {cfg.icon}
            <span className="hide-sm">{cfg.label}</span>
        </button>
    )
}
