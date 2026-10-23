// bcrypt hashing and verification off the main thread (Bcrypt page).
// Progress (0..1) is reported roughly every 100 ms.
import bcrypt from 'bcryptjs'
import { serveWorker } from './serve.js'

serveWorker({
    async hash({ password, cost }, { progress }) {
        const started = performance.now()
        const hash = await bcrypt.hash(password, cost, undefined, progress)
        return { hash, ms: performance.now() - started }
    },
    async compare({ password, hash }, { progress }) {
        const started = performance.now()
        const match = await bcrypt.compare(password, hash, undefined, progress)
        return { match, ms: performance.now() - started }
    },
})
