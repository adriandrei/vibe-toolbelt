import { useEffect, useState } from 'react'

// Creates an object URL for a Blob/File and revokes it when the blob changes
// or the component unmounts. Returns null when there is no blob.
export function useObjectURL(blob) {
    const [url, setUrl] = useState(null)

    useEffect(() => {
        if (!blob) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with the external object-URL lifecycle
            setUrl(null)
            return undefined
        }
        const next = URL.createObjectURL(blob)
        setUrl(next)
        return () => URL.revokeObjectURL(next)
    }, [blob])

    return url
}
