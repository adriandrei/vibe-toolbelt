import { useState } from 'react'
import SseClient from './SseClient'
import WebSocketClient from './WebSocketClient'
import './realtime.css'

/**
 * The API Tester's WebSocket and server-sent events clients. Each one is
 * mounted the first time its protocol is chosen, then kept (hidden while
 * another protocol is shown), so an open connection and its log survive a
 * trip to the HTTP side and back.
 *
 *   <RealtimeClient
 *     protocol="ws"                          // http | ws | sse
 *     envs={envs} activeEnvId={id} onSelectEnv={setId} onManageEnvs={open}
 *     resolveVars={(text, unresolvedSet) => filledText}   // {{variables}}
 *     onLiveChange={(protocol, live) => …}   // a connection opened or ended
 *   />
 */
export default function RealtimeClient({ protocol, onLiveChange, ...shared }) {
    const [mounted, setMounted] = useState(() => ({ ws: protocol === 'ws', sse: protocol === 'sse' }))
    if ((protocol === 'ws' || protocol === 'sse') && !mounted[protocol]) setMounted({ ...mounted, [protocol]: true })

    return (
        <>
            {mounted.ws && <WebSocketClient hidden={protocol !== 'ws'} onLiveChange={live => onLiveChange?.('ws', live)} {...shared} />}
            {mounted.sse && <SseClient hidden={protocol !== 'sse'} onLiveChange={live => onLiveChange?.('sse', live)} {...shared} />}
        </>
    )
}
