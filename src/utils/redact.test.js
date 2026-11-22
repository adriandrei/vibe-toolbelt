import { describe, expect, it } from 'vitest'
import { SENSITIVE_NAME, redactRequest, redactUrl } from './redact'

const scrub = () => ''

describe('SENSITIVE_NAME', () => {
    it.each(['password', 'X-Api-Key', 'api_key', 'apikey', 'access-token', 'Authorization', 'Set-Cookie', 'client_secret', 'sessionId', 'private_key', 'key', 'sig', 'code', 'jwt', 'auth'])(
        'flags %s', (name) => expect(SENSITIVE_NAME.test(name)).toBe(true))

    it.each(['username', 'page', 'Content-Type', 'Accept', 'monkey', 'keyboard', 'author'])(
        'does not flag %s', (name) => expect(SENSITIVE_NAME.test(name)).toBe(false))
})

describe('redactUrl', () => {
    it('strips the password from userinfo but keeps the user', () => {
        expect(redactUrl('https://bob:hunter2@example.com/a', scrub)).toBe('https://bob@example.com/a')
    })
    it('leaves userinfo without a password alone', () => {
        expect(redactUrl('https://bob@example.com/a', scrub)).toBe('https://bob@example.com/a')
    })
    it('scrubs sensitive query values only, keeping hash and encoded names', () => {
        expect(redactUrl('https://x.test/p?a=1&api_key=abc&tok%65n=zzz&b=2#frag', scrub))
            .toBe('https://x.test/p?a=1&api_key=&tok%65n=&b=2#frag')
    })
    it('does not mistake a "?" in the hash for a query', () => {
        expect(redactUrl('https://x.test/p#a?token=1', scrub)).toBe('https://x.test/p#a?token=1')
    })
    it('passes non-strings through', () => {
        expect(redactUrl(undefined, scrub)).toBeUndefined()
    })
})

describe('redactRequest', () => {
    const base = {
        url: 'https://u:pw@api.test/x?token=abc&q=1',
        headers: [
            { key: 'Authorization', value: 'Bearer abc' },
            { key: 'Accept', value: 'application/json' },
            { key: 'X-Api-Key', value: '{{apiKey}}' },
        ],
        form: [{ key: 'password', value: 'p' }, { key: 'name', value: 'n' }],
        auth: { type: 'bearer', token: 'tkn', password: 'pw2', username: 'me' },
        bodyType: 'json',
        body: '{"user":"bob","password":"hunter2","nested":{"api_key":"k\\"q"},"id":{{id}}}',
    }

    it('removes secrets everywhere and reports it', () => {
        const { request, redacted } = redactRequest(base)
        expect(redacted).toBe(true)
        expect(request.url).toBe('https://u@api.test/x?token=&q=1')
        expect(request.headers).toEqual([
            { key: 'Authorization', value: '' },
            { key: 'Accept', value: 'application/json' },
            { key: 'X-Api-Key', value: '{{apiKey}}' },
        ])
        expect(request.form).toEqual([{ key: 'password', value: '' }, { key: 'name', value: 'n' }])
        expect(request.auth).toEqual({ type: 'bearer', token: '', password: '', username: 'me' })
        expect(request.body).toBe('{"user":"bob","password":"","nested":{"api_key":""},"id":{{id}}}')
    })

    it('keeps {{variable}} references and reports nothing when there is nothing to remove', () => {
        const stored = { url: 'https://a.test/?token={{t}}', headers: [{ key: 'Authorization', value: '{{auth}}' }], auth: { token: '{{t}}' }, bodyType: 'none', body: '' }
        const { request, redacted } = redactRequest(stored)
        expect(redacted).toBe(false)
        expect(request).toEqual(stored)
    })

    it('redacts form-encoded bodies and leaves raw bodies alone', () => {
        expect(redactRequest({ bodyType: 'form', body: 'a=1&secret=2&c=3', auth: {} }).request.body).toBe('a=1&secret=&c=3')
        expect(redactRequest({ bodyType: 'text', body: 'password=abc', auth: {} }).request.body).toBe('password=abc')
    })

    it('does not mutate its input', () => {
        const copy = JSON.parse(JSON.stringify(base))
        redactRequest(base)
        expect(base).toEqual(copy)
    })
})
