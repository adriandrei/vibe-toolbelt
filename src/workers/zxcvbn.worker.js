// zxcvbn password strength estimation off the main thread (Password page).
// zxcvbn's dictionaries are large (~800 KB), so they load here, not in the page.
import zxcvbn from 'zxcvbn'
import { serveWorker } from './serve.js'

const MATCH_FIELDS = ['pattern', 'token', 'dictionary_name', 'rank', 'l33t', 'reversed', 'sequence_name', 'regex_name', 'base_token', 'repeat_count', 'graph', 'turns', 'year', 'separator']

serveWorker({
    analyze({ password, userInputs = [] }) {
        const result = zxcvbn(password, userInputs)
        return {
            score: result.score,
            guesses: result.guesses,
            guessesLog10: result.guesses_log10,
            crackTimesSeconds: result.crack_times_seconds,
            crackTimesDisplay: result.crack_times_display,
            feedback: { warning: result.feedback.warning || '', suggestions: [...result.feedback.suggestions] },
            sequence: result.sequence.map((match) => {
                const out = {}
                for (const key of MATCH_FIELDS) {
                    if (match[key] !== undefined && typeof match[key] !== 'object') out[key] = match[key]
                }
                return out
            }),
            calcTime: result.calc_time,
        }
    },
})
