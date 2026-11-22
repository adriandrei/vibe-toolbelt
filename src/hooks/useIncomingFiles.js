import { useEffect, useRef } from 'react'
import { usePipeline } from '../contexts/PipelineContext'
import { usePane } from '../contexts/pane'

/**
 * useIncomingFiles(path, onFiles) receives files handed to this tool by
 * Smart Drop, "Open with" on the installed app or the share sheet. They come
 * through the pipeline's media slot (sendMedia(file, { target: path, files })),
 * also when the page is already open. onFiles(files) gets an array of File
 * objects, once per hand-over. Only the main pane takes them.
 *
 *   useIncomingFiles('/hex', ([file]) => open(file))
 */
export function useIncomingFiles(path, onFiles) {
    const { takeMedia, hasMedia } = usePipeline()
    const { kind } = usePane()
    const onFilesRef = useRef(onFiles)

    useEffect(() => {
        onFilesRef.current = onFiles
    })

    useEffect(() => {
        if (kind !== 'main' || !hasMedia) return
        const media = takeMedia(path)
        if (!media) return
        const files = media.files?.length ? media.files : media.file ? [media.file] : []
        if (files.length) onFilesRef.current(files)
    }, [kind, hasMedia, takeMedia, path])
}
