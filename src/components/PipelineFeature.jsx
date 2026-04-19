import React from 'react'
import { Download, Upload } from 'lucide-react'
import { usePipeline } from '../contexts/PipelineContext'

export const PipelineRead = ({ onRead, style = {} }) => {
    const { pipelineData } = usePipeline()

    if (!pipelineData) return null

    return (
        <button
            onClick={() => onRead(pipelineData)}
            title="Read data from Pipeline Context"
            style={{
                color: 'var(--primary)',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                ...style
            }}
        >
            <Download size={14} /> Read Pipeline
        </button>
    )
}

export const PipelineSend = ({ dataToSend, disabled = false, style = {} }) => {
    const { setPipelineData } = usePipeline()
    const isDisabled = disabled || !dataToSend

    return (
        <button
            onClick={() => setPipelineData(dataToSend)}
            disabled={isDisabled}
            title="Send output string to Pipeline Context"
            style={{
                color: 'var(--primary)',
                fontSize: '0.8rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                background: 'transparent',
                border: isDisabled ? '1px solid var(--border)' : '1px solid var(--primary)',
                padding: '2px 8px',
                borderRadius: '4px',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled ? 0.5 : 1,
                ...style
            }}
        >
            <Upload size={14} /> Send to Pipeline
        </button>
    )
}
