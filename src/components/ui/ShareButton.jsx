import { useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { useToast } from '../ToastProvider'
import { usePane } from '../../contexts/pane'
import { copyText } from '../../utils/clipboard'
import { MAX_SHARE_LENGTH, buildShareUrl } from '../../utils/share'

/**
 * Copies a link that reopens this tool with the given state.
 *
 *   <ShareButton getState={() => ({ pattern, flags, text })} />
 *
 * The page reads the link back with useSharedState(). The state rides in the
 * URL fragment, so it isn't uploaded anywhere, but anyone with the link can
 * read it: don't offer this for secrets (keys, tokens, passwords).
 */
export default function ShareButton({ getState, disabled = false, label = 'Share link', className = 'btn btn-secondary btn-sm' }) {
    const toast = useToast()
    const { path } = usePane()
    const [busy, setBusy] = useState(false)

    const share = async () => {
        setBusy(true)
        try {
            const url = await buildShareUrl(path, getState())
            if (url.length > MAX_SHARE_LENGTH) {
                toast.error(`That’s too much to fit in a link (${Math.ceil(url.length / 1000)}k characters, the limit is ${MAX_SHARE_LENGTH / 1000}k). Try a shorter input.`, 6000)
                return
            }
            if (await copyText(url)) {
                toast.success('Link copied. It contains what you entered, so anyone with the link can see it. Nothing was uploaded.', 6000)
            } else {
                toast.error('Couldn’t copy the link to the clipboard.')
            }
        } catch {
            toast.error('Couldn’t create the link.')
        } finally {
            setBusy(false)
        }
    }

    return (
        <button
            type="button"
            className={className}
            onClick={share}
            disabled={disabled || busy}
            title="Copy a link that reopens this tool with what you entered"
        >
            {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
            {label}
        </button>
    )
}
