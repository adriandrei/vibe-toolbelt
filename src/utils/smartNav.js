// Opening a tool with data ("smart input").
//
// Producers (smart paste, the command palette's detected-content suggestion,
// the Inspector's "Open in tool" links) navigate with a state object marked
// `smart: true`. Pages read it with useSmartInput(). Plain navigation never
// carries input, so picking a tool by name never overwrites what's in it.
export function smartState({ input, mode, ...extra } = {}) {
    return { smart: true, input, mode, ...extra }
}

export function openInTool(navigate, path, payload = {}) {
    navigate(path, { state: smartState(payload) })
}
