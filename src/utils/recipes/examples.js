// Built-in example recipes, each with a sample input (or none, when the
// example is meant for the user's own file).
import { parseSteps } from './runner.js'

const SAMPLE_JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsInJvbGVzIjpbImFkbWluIiwiZGV2Il0sImlhdCI6MTcwMDAwMDAwMCwiZXhwIjo0MTAyNDQ0ODAwfQ.6a5EJ68KcMsKh8sdJZoKJ0kClOE-V5E62uDziO9oD6U'

// gzip of {"event":"deploy","service":"billing-api","version":"2.4.1","ok":true,"durationMs":5321,"tags":["prod","eu-west-1"]}
const SAMPLE_GZIP_BASE64 =
    'H4sIAAAAAAACCgXBQQ4CIQwF0Lv8dZmEUTe9gycwLlCaSSOhhALGGO/ue1/IkjrAyNKKfUBw6UufAsZDS9F6hNQUhCXd1SoY+3beIgj2Ao8+hZBnT0OtXh18Oe2RMNLh4BtatwyCzPAWHyHi/vsD+H6CTXQAAAA='

// encodeURIComponent of {"q":"café & crème","page":2,"filters":{"in_stock":true,"tags":["a b","c/d"]}}
const SAMPLE_URL_JSON =
    '%7B%22q%22%3A%22caf%C3%A9%20%26%20cr%C3%A8me%22%2C%22page%22%3A2%2C%22filters%22%3A%7B%22in_stock%22%3Atrue%2C%22tags%22%3A%5B%22a%20b%22%2C%22c%2Fd%22%5D%7D%7D'

const DEFINITIONS = [
    {
        id: 'jwt',
        name: 'Decode a JWT',
        description: 'Shows a token’s header and payload as JSON.',
        steps: [{ op: 'jwt-decode' }],
        input: SAMPLE_JWT,
    },
    {
        id: 'base64-gunzip-json',
        name: 'Base64 → gunzip → pretty JSON',
        description: 'Reads compressed, Base64-encoded JSON, as found in logs, cookies and message queues.',
        steps: [{ op: 'base64-decode' }, { op: 'gunzip' }, { op: 'json-prettify' }],
        input: SAMPLE_GZIP_BASE64,
    },
    {
        id: 'url-json',
        name: 'URL-decode → pretty JSON',
        description: 'Reads JSON passed in a URL query parameter.',
        steps: [{ op: 'url-decode' }, { op: 'json-prettify' }],
        input: SAMPLE_URL_JSON,
    },
    {
        id: 'sha256-file',
        name: 'Hash a file (SHA-256)',
        description: 'Open a file to get its SHA-256 checksum, as sha256sum prints it.',
        steps: [{ op: 'sha256' }],
        input: null,
    },
]

export const EXAMPLES = DEFINITIONS.map((example) => ({ ...example, steps: parseSteps(example.steps).steps }))
