import { useEffect } from 'react'
import { useAI } from '../contexts/AIContext'

/**
 * Call this hook inside any tool page to register its AI context.
 * The global AIAssistant panel reads this to show relevant prompts and data.
 *
 * @param {object} context
 * @param {string} context.tool - Tool name shown in the AI panel header
 * @param {() => { input?: string, output?: string }} context.getContext - Returns current input/output
 * @param {string[]} context.suggestedPrompts - Chips shown when chat is empty
 * @param {any[]} deps - Dependencies that should trigger re-registration (like [input, output])
 */
export function useRegisterAIContext({ tool, getContext, suggestedPrompts }, deps = []) {
    const { setToolContext } = useAI()

    useEffect(() => {
        setToolContext({ tool, getContext, suggestedPrompts })
        return () => setToolContext(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
}
