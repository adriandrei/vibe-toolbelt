import React, { createContext, useContext, useState } from 'react'

const PipelineContext = createContext()

export const usePipeline = () => useContext(PipelineContext)

export const PipelineProvider = ({ children }) => {
    // Shared bus for moving data between tools without polluting system clipboard
    const [pipelineData, setPipelineData] = useState(null)
    
    // Global layout pin state for split pane
    const [pinnedToolRoute, setPinnedToolRoute] = useState(null)

    return (
        <PipelineContext.Provider value={{ pipelineData, setPipelineData, pinnedToolRoute, setPinnedToolRoute }}>
            {children}
        </PipelineContext.Provider>
    )
}
