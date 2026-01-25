import { useEffect } from 'react'

export function useDocumentTitle(title) {
    useEffect(() => {
        const prevTitle = document.title
        document.title = `${title} | Vibe Toolbelt`
        return () => {
            document.title = prevTitle
        }
    }, [title])
}
