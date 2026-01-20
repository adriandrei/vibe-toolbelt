import { useEffect } from 'react'

export function useDocumentTitle(title) {
    useEffect(() => {
        const prevTitle = document.title
        document.title = `${title} | DevTools`
        return () => {
            document.title = prevTitle
        }
    }, [title])
}
