import { Download, Upload } from 'lucide-react'
import { usePipeline } from '../contexts/PipelineContext'
import { usePane } from '../contexts/pane'

/**
 * "Use pipeline" button: loads the text currently in the pipeline into this
 * tool. Hidden when the pipeline is empty or the data came from this tool.
 *
 *   <PipelineRead onRead={(text) => { setInput(text); run(text) }} />
 */
export const PipelineRead = ({ onRead, style, className = '' }) => {
    const { payload } = usePipeline()
    const { path } = usePane()

    if (!payload || payload.kind !== 'text' || (payload.source && payload.source === path)) return null

    const from = payload.label ? ` from ${payload.label}` : ''
    return (
        <button
            type="button"
            className={`btn btn-sm btn-outline ${className}`}
            onClick={() => onRead(payload.value)}
            title={`Load ${payload.value.length.toLocaleString()} characters${from} into this tool`}
            style={style}
        >
            <Download size={14} aria-hidden="true" /> Use pipeline{from && <span style={{ fontWeight: 400, opacity: 0.85 }}>{from}</span>}
        </button>
    )
}

/**
 * "Send to pipeline" button for a tool's output.
 *
 *   <PipelineSend dataToSend={output} disabled={!!error} />
 */
export const PipelineSend = ({ dataToSend, disabled = false, label = 'Send to pipeline', style, className = '' }) => {
    const { sendText } = usePipeline()
    const { path } = usePane()
    const isDisabled = disabled || typeof dataToSend !== 'string' || dataToSend === ''

    return (
        <button
            type="button"
            className={`btn btn-sm btn-ghost ${className}`}
            onClick={() => sendText(dataToSend, { source: path })}
            disabled={isDisabled}
            title="Make this output available to other tools via “Use pipeline”"
            style={style}
        >
            <Upload size={14} aria-hidden="true" /> {label}
        </button>
    )
}
