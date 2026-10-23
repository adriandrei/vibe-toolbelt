import { useEffect, useRef } from 'react'
import { useAI } from '../contexts/AIContext'
import { usePane } from '../contexts/pane'

/**
 * Registers the current page with the global AI assistant.
 *
 * @param {object} context
 * @param {string} context.tool - Tool name shown in the AI panel header
 * @param {() => { input?: string, output?: string }} context.getContext - Returns the current input/output
 * @param {string[]} context.suggestedPrompts - Chips shown when the chat is empty
 *
 * getContext is read through a ref, so it always sees the latest page state
 * without re-registering on every keystroke. Only the main pane registers; a
 * tool pinned in the split view never replaces (or clears) the main page's
 * context.
 */
export function useRegisterAIContext({ tool, getContext, suggestedPrompts }) {
    const { setToolContext } = useAI()
    const { kind } = usePane()
    const getContextRef = useRef(getContext)
    const promptsKey = (suggestedPrompts || []).join('\u0000')

    useEffect(() => {
        getContextRef.current = getContext
    })

    useEffect(() => {
        if (kind !== 'main') return undefined
        setToolContext({
            tool,
            getContext: () => getContextRef.current?.() ?? {},
            suggestedPrompts: suggestedPrompts || [],
        })
        return () => setToolContext(null)
        // suggestedPrompts is tracked through promptsKey
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tool, promptsKey, kind, setToolContext])
}
