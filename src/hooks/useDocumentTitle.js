import { useEffect } from 'react'
import { pageTitle } from '../config/brand'
import { usePane } from '../contexts/pane'

// Sets the tab title for the page in the main pane. A tool rendered in the
// pinned pane never touches the title.
export function useDocumentTitle(title) {
    const { kind } = usePane()

    useEffect(() => {
        if (kind !== 'main') return
        document.title = pageTitle(title)
    }, [title, kind])
}
