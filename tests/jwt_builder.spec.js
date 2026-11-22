import { test, expect } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';
import * as jose from 'jose';
import { SAMPLE_JWT } from './helpers.js';

// JWT Builder & Signer: header/payload editors, HMAC secrets and private
// keys, generated key pairs, and tokens checked independently with jose.

const JWT_IO_HEADER = '{"alg":"HS256","typ":"JWT"}';
const JWT_IO_PAYLOAD = '{"sub":"1234567890","name":"John Doe","iat":1516239022}';
const LONG_SECRET = 'a-secret-that-is-at-least-32-bytes-long';
const JWS = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

const algorithm = (page) => page.getByLabel('Algorithm', { exact: true });
const header = (page) => page.getByLabel('Header', { exact: true });
const payload = (page) => page.getByLabel('Payload', { exact: true });
const secret = (page) => page.getByLabel('Secret', { exact: true });
const privateKey = (page) => page.getByLabel('Private key', { exact: true });
const token = (page) => page.getByRole('textbox', { name: 'Signed token' });
const publicPem = (page) => page.getByRole('textbox', { name: 'Public key PEM' });
const publicJwk = (page) => page.getByRole('textbox', { name: 'Public key JWK' });
const readJson = async (locator) => JSON.parse(await locator.inputValue());

async function signedToken(page) {
    await expect(token(page)).toHaveText(JWS);
    await expect(token(page)).not.toHaveAttribute('aria-busy', 'true');
    return (await token(page).textContent()).trim();
}

const nodeKeys = (type, options, privateKeyEncoding) => generateKeyPairSync(type, {
    ...options,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { format: 'pem', ...privateKeyEncoding },
});

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.beforeEach(async ({ context }) => {
    // Remember what the app copies, without racing other tests for the real clipboard
    await context.addInitScript(() => {
        const clipboard = navigator.clipboard;
        if (!clipboard?.writeText) return;
        const write = clipboard.writeText.bind(clipboard);
        clipboard.writeText = (text) => {
            window.__copied = text;
            return write(text);
        };
    });
});

test.describe('JWT Builder', () => {
    test('reproduces the jwt.io HS256 token exactly', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        await page.goto('/jwt-builder');
        await expect(algorithm(page)).toHaveValue('HS256');
        await expect(page.getByText('Enter the secret to sign with.')).toBeVisible();
        await expect(token(page)).toHaveCount(0);

        await header(page).fill(JWT_IO_HEADER);
        await payload(page).fill(JWT_IO_PAYLOAD);
        await secret(page).fill('your-256-bit-secret');
        await expect(token(page)).toHaveText(SAMPLE_JWT);
        expect(await signedToken(page)).toBe(SAMPLE_JWT);

        // Parts are shown separately, like the decoder colours them
        const [h, p, s] = SAMPLE_JWT.split('.');
        await expect(token(page).locator('.jwtb-part-header')).toHaveText(h);
        await expect(token(page).locator('.jwtb-part-payload')).toHaveText(p);
        await expect(token(page).locator('.jwtb-part-signature')).toHaveText(s);

        // RFC 7518 §3.2: the 19-byte secret is too short for HS256
        await expect(page.getByText(/This secret is 152 bits; HS256 needs at least 256 bits \(32 bytes\)/)).toBeVisible();

        await page.getByRole('button', { name: 'Copy token' }).click();
        await expect.poll(() => page.evaluate(() => window.__copied)).toBe(SAMPLE_JWT);

        // The same secret as Base64url gives the same token
        await page.getByLabel('Secret is Base64- or Base64url-encoded').check();
        await secret(page).fill(Buffer.from('your-256-bit-secret').toString('base64url'));
        await expect(token(page)).toHaveText(SAMPLE_JWT);

        // Pretty-printed JSON signs the same compact JSON
        await payload(page).fill(JSON.stringify(JSON.parse(JWT_IO_PAYLOAD), null, 4));
        await expect(token(page)).toHaveText(SAMPLE_JWT);

        await page.getByRole('button', { name: 'Open in JWT Decoder' }).click();
        await expect(page).toHaveURL(/\/jwt$/);
        await expect(page.getByPlaceholder('Paste a JWT (eyJh...)')).toHaveValue(SAMPLE_JWT);
        await expect(page.getByText('"John Doe"')).toBeVisible();
        expect(errors).toEqual([]);
    });

    test('signs with a generated ES256 key pair that verifies with the public key shown', async ({ page }) => {
        await page.goto('/jwt-builder');
        await algorithm(page).selectOption('ES256');
        expect(await readJson(header(page))).toEqual({ alg: 'ES256', typ: 'JWT' });
        await expect(page.getByText('Paste a private key or generate a key pair to sign with.')).toBeVisible();

        await page.getByRole('button', { name: 'Generate ES256 key pair' }).click();
        await expect(privateKey(page)).toHaveValue(/^-----BEGIN PRIVATE KEY-----\n[A-Za-z0-9+/=\n]+-----END PRIVATE KEY-----\n?$/);
        await expect(page.getByText(/Generated on this device and never stored or sent/)).toBeVisible();
        await expect(page.getByText('EC P-256').first()).toBeVisible();

        const signed = await signedToken(page);
        const pem = (await publicPem(page).textContent()).trim();
        expect(pem).toMatch(/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/=\n]+\n-----END PUBLIC KEY-----$/);
        const verified = await jose.compactVerify(signed, await jose.importSPKI(pem, 'ES256'), { algorithms: ['ES256'] });
        expect(verified.protectedHeader).toEqual({ alg: 'ES256', typ: 'JWT' });
        expect(JSON.parse(new TextDecoder().decode(verified.payload))).toEqual(await readJson(payload(page)));
        expect(signed.split('.')[2]).toHaveLength(86); // 64-byte P-256 signature

        // The JWK is the same key, and its kid is the RFC 7638 thumbprint
        const jwk = JSON.parse(await publicJwk(page).textContent());
        expect(jwk).toMatchObject({ kty: 'EC', crv: 'P-256', use: 'sig', alg: 'ES256' });
        expect(jwk).not.toHaveProperty('d');
        await jose.compactVerify(signed, await jose.importJWK(jwk, 'ES256'));
        expect(await jose.calculateJwkThumbprint({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y })).toBe(jwk.kid);

        // The private key in the editor is the pair of the public key shown
        const fromPrivate = await jose.importPKCS8(await privateKey(page).inputValue(), 'ES256', { extractable: true });
        const derived = await jose.exportJWK(fromPrivate);
        expect([derived.x, derived.y]).toEqual([jwk.x, jwk.y]);

        // "Use as kid" adds it to the header and re-signs
        await page.getByRole('button', { name: 'Use as kid' }).click();
        expect((await readJson(header(page))).kid).toBe(jwk.kid);
        await expect(token(page)).not.toHaveText(signed);
        const withKid = await signedToken(page);
        const again = await jose.compactVerify(withKid, await jose.importSPKI(pem, 'ES256'));
        expect(again.protectedHeader).toEqual({ alg: 'ES256', typ: 'JWT', kid: jwk.kid });

        // The decoder opens with the public key and checks the signature
        await page.getByRole('button', { name: 'Open in JWT Decoder' }).click();
        await expect(page).toHaveURL(/\/jwt$/);
        await expect(page.getByPlaceholder('Paste a JWT (eyJh...)')).toHaveValue(withKid);
        await expect(page.getByText(/^Signature valid/)).toBeVisible({ timeout: 10000 });
    });

    test('generated RSA and Ed25519 keys sign tokens that verify', async ({ page }) => {
        await page.goto('/jwt-builder');
        for (const alg of ['PS256', 'EdDSA']) {
            await algorithm(page).selectOption(alg);
            await page.getByRole('button', { name: `Generate ${alg} key pair` }).click();
            await expect(page.getByText(`New ${alg} key pair`)).toBeVisible();
            await expect(page.getByText(alg === 'EdDSA' ? 'Ed25519' : 'RSA 2048-bit', { exact: true }).first()).toBeVisible();
            const signed = await signedToken(page);
            const pem = (await publicPem(page).textContent()).trim();
            const { protectedHeader } = await jose.compactVerify(signed, await jose.importSPKI(pem, alg), { algorithms: [alg] });
            expect(protectedHeader.alg).toBe(alg);
        }
    });

    test('converts pasted PKCS#1 and SEC1 private keys', async ({ page }) => {
        await page.goto('/jwt-builder');

        const rsa = nodeKeys('rsa', { modulusLength: 2048 }, { type: 'pkcs1' });
        await algorithm(page).selectOption('RS256');
        await privateKey(page).fill(rsa.privateKey);
        await expect(page.getByText('Converted from PKCS#1 (“BEGIN RSA PRIVATE KEY”) to PKCS#8.')).toBeVisible();
        const rsaToken = await signedToken(page);
        await jose.compactVerify(rsaToken, await jose.importSPKI(rsa.publicKey, 'RS256'), { algorithms: ['RS256'] });
        expect((await publicPem(page).textContent()).replace(/\s+/g, '')).toBe(rsa.publicKey.replace(/\s+/g, ''));

        const ec = nodeKeys('ec', { namedCurve: 'P-384' }, { type: 'sec1' });
        await algorithm(page).selectOption('ES384');
        await privateKey(page).fill(ec.privateKey);
        await expect(page.getByText('Converted from SEC1 (“BEGIN EC PRIVATE KEY”) to PKCS#8.')).toBeVisible();
        const ecToken = await signedToken(page);
        await jose.compactVerify(ecToken, await jose.importSPKI(ec.publicKey, 'ES384'), { algorithms: ['ES384'] });
    });

    test('shows why it can’t sign, and never leaves an old token on screen', async ({ page }) => {
        await page.goto('/jwt-builder');
        await secret(page).fill(LONG_SECRET);
        await signedToken(page);
        await expect(page.getByText(/This secret is \d+ bits/)).toHaveCount(0);

        // Bad payload JSON
        await payload(page).fill('{"sub": "x",}');
        await expect(page.locator('.field-error', { hasText: 'The payload isn’t valid JSON' })).toBeVisible();
        await expect(token(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Copy token' })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Open in JWT Decoder' })).toBeDisabled();

        await payload(page).fill('[1, 2]');
        await expect(page.getByText('The payload must be a JSON object, not an array.', { exact: true })).toBeVisible();
        await expect(token(page)).toHaveCount(0);

        await payload(page).fill('{"sub":"x"}');
        const valid = await signedToken(page);
        expect(valid.split('.')[1]).toBe(Buffer.from('{"sub":"x"}').toString('base64url'));

        // Bad header JSON, then an unsigned "alg"
        await header(page).fill('{"alg": "HS256"');
        await expect(page.locator('.field-error', { hasText: 'The header isn’t valid JSON' })).toBeVisible();
        await expect(token(page)).toHaveCount(0);
        await header(page).fill('{"alg":"none","typ":"JWT"}');
        await expect(page.getByText(/Unsigned tokens \("alg": "none"\) aren’t made here/).first()).toBeVisible();
        await expect(token(page)).toHaveCount(0);
        await page.getByRole('button', { name: 'Set "alg" to HS256' }).click();
        expect(await readJson(header(page))).toEqual({ alg: 'HS256', typ: 'JWT' });
        expect(await signedToken(page)).toBe(valid);

        // No secret, then a secret that isn't Base64
        await secret(page).fill('');
        await expect(page.getByText('Enter the secret to sign with.')).toBeVisible();
        await expect(token(page)).toHaveCount(0);
        await page.getByLabel('Secret is Base64- or Base64url-encoded').check();
        await secret(page).fill('not base64!');
        await expect(page.locator('.field-error', { hasText: 'isn’t valid Base64 or Base64url' })).toBeVisible();
        await expect(token(page)).toHaveCount(0);

        // A claim with the wrong type is a warning, not a blocker
        await page.getByLabel('Secret is Base64- or Base64url-encoded').uncheck();
        await secret(page).fill(LONG_SECRET);
        await payload(page).fill('{"exp":"tomorrow"}');
        await expect(page.getByText('Verifiers may reject these claims')).toBeVisible();
        await expect(page.getByText(/"exp" should be a NumericDate/)).toBeVisible();
        await signedToken(page);
    });

    test('explains a missing key and keys of the wrong type', async ({ page }) => {
        await page.goto('/jwt-builder');
        await algorithm(page).selectOption('RS256');
        await expect(page.getByText('Paste a private key or generate a key pair to sign with.')).toBeVisible();
        await expect(token(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Copy token' })).toBeDisabled();

        // An EC key can't sign RS256
        await algorithm(page).selectOption('ES256');
        await page.getByRole('button', { name: 'Generate ES256 key pair' }).click();
        await signedToken(page);
        await algorithm(page).selectOption('RS256');
        await expect(page.getByText('This is an EC P-256 key, but RS256 needs an RSA key.', { exact: true })).toBeVisible();
        await expect(token(page)).toHaveCount(0);
        await expect(publicPem(page)).toHaveCount(0);

        // Nor can a P-256 key sign ES512
        await algorithm(page).selectOption('ES512');
        await expect(page.getByText('This is an EC P-256 key, but ES512 needs an EC P-521 key.', { exact: true })).toBeVisible();
        await expect(token(page)).toHaveCount(0);

        // A public key, an RSA key under 2048 bits, and text that isn't a key
        await algorithm(page).selectOption('RS256');
        await privateKey(page).fill(nodeKeys('rsa', { modulusLength: 2048 }, { type: 'pkcs8' }).publicKey);
        await expect(page.getByText(/^This is a public key\. Signing needs the private key/)).toBeVisible();
        await privateKey(page).fill(nodeKeys('rsa', { modulusLength: 1024 }, { type: 'pkcs8' }).privateKey);
        await expect(page.getByText(/RS256 needs an RSA key of at least 2048 bits .*this one has 1024/).first()).toBeVisible();
        await expect(token(page)).toHaveCount(0);
        await privateKey(page).fill('not a key');
        await expect(page.getByText(/^Paste a PEM private key/)).toBeVisible();

        // A private JWK of the wrong curve
        const jwk = await jose.exportJWK((await jose.generateKeyPair('ES384', { extractable: true })).privateKey);
        await algorithm(page).selectOption('ES256');
        await privateKey(page).fill(JSON.stringify(jwk));
        await expect(page.getByText('This JWK is on curve "P-384", but ES256 needs P-256.', { exact: true })).toBeVisible();
        await algorithm(page).selectOption('ES384');
        await signedToken(page);
    });

    test('keeps "alg" in the header and the algorithm in sync both ways', async ({ page }) => {
        await page.goto('/jwt-builder');
        await algorithm(page).selectOption('RS384');
        expect(await readJson(header(page))).toEqual({ alg: 'RS384', typ: 'JWT' });

        await header(page).fill('{"alg":"PS512","typ":"JWT","kid":"k1"}');
        await expect(algorithm(page)).toHaveValue('PS512');
        await expect(page.getByRole('button', { name: 'Generate PS512 key pair' })).toBeVisible();

        await algorithm(page).selectOption('EdDSA');
        expect(await readJson(header(page))).toEqual({ alg: 'EdDSA', typ: 'JWT', kid: 'k1' });

        // A header without "typ" gets one when the algorithm changes; a custom one is kept
        await header(page).fill('{"alg":"EdDSA"}');
        await algorithm(page).selectOption('HS512');
        expect(await readJson(header(page))).toEqual({ alg: 'HS512', typ: 'JWT' });
        await header(page).fill('{"typ":"at+jwt","alg":"HS512"}');
        await algorithm(page).selectOption('HS384');
        expect(await readJson(header(page))).toEqual({ typ: 'at+jwt', alg: 'HS384' });
    });

    test('claim helpers set registered claims and show readable dates', async ({ page }) => {
        await page.goto('/jwt-builder');
        await payload(page).fill('{"name":"Jane"}');
        const now = () => Math.floor(Date.now() / 1000);

        let before = now();
        await page.getByRole('button', { name: 'Expire in 1 h' }).click();
        let claims = await readJson(payload(page));
        expect(claims.exp).toBeGreaterThanOrEqual(before + 3600);
        expect(claims.exp).toBeLessThanOrEqual(now() + 3600);
        const expRow = page.getByRole('list', { name: 'Date claims' }).getByRole('listitem').filter({ hasText: 'exp' });
        await expect(expRow).toContainText(new Date(claims.exp * 1000).getFullYear().toString());
        await expect(expRow).toContainText(/in (1 h|59 min)/);
        await expect(page.getByText(/^Not expired: expires in/)).toBeVisible();

        before = now();
        await page.getByRole('button', { name: 'Set iat' }).click();
        await page.getByRole('button', { name: 'Set nbf' }).click();
        await page.getByRole('button', { name: 'New jti' }).click();
        claims = await readJson(payload(page));
        expect(claims.iat).toBeGreaterThanOrEqual(before);
        expect(claims.iat).toBeLessThanOrEqual(now());
        expect(claims.nbf).toBeGreaterThanOrEqual(before);
        expect(claims.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

        // Custom expiry: 2 days
        await page.getByLabel('Custom expiry amount').fill('2');
        await page.getByLabel('Custom expiry unit').selectOption({ label: 'days' });
        before = now();
        await page.getByRole('button', { name: 'Set exp' }).click();
        claims = await readJson(payload(page));
        expect(claims.exp).toBeGreaterThanOrEqual(before + 2 * 86400);
        expect(claims.exp).toBeLessThanOrEqual(now() + 2 * 86400);
        await expect(expRow).toContainText(/in (2 days|48 h)/); // 48 h once a second has passed

        // Quick fields edit the JSON; several audiences become an array
        await page.getByLabel('Issuer (iss)').fill('https://issuer.example');
        await page.getByLabel('Subject (sub)').fill('user-42');
        await page.getByLabel('Audience (aud)').fill('api, web');
        claims = await readJson(payload(page));
        expect(claims).toMatchObject({ name: 'Jane', iss: 'https://issuer.example', sub: 'user-42', aud: ['api', 'web'] });
        await expect(page.getByLabel('Audience (aud)')).toHaveValue('api, web');
        await page.getByLabel('Subject (sub)').fill('');
        expect(await readJson(payload(page))).not.toHaveProperty('sub');

        // Removing a date claim
        await page.getByRole('button', { name: 'Remove nbf' }).click();
        expect(await readJson(payload(page))).not.toHaveProperty('nbf');

        // The token carries exactly the payload shown
        await page.getByLabel('Secret', { exact: true }).fill(LONG_SECRET);
        const signed = await signedToken(page);
        const { payload: signedPayload } = await jose.compactVerify(signed, new TextEncoder().encode(LONG_SECRET));
        expect(JSON.parse(new TextDecoder().decode(signedPayload))).toEqual(await readJson(payload(page)));
    });

    test('remembers only the algorithm', async ({ page }) => {
        await page.goto('/jwt-builder');
        await secret(page).fill('my-very-private-hmac-secret-value-123');
        await payload(page).fill('{"marker":"payload-not-stored"}');
        const hsToken = await signedToken(page);
        await algorithm(page).selectOption('ES384');
        await page.getByRole('button', { name: 'Generate ES384 key pair' }).click();
        const esToken = await signedToken(page);

        const stored = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
        expect(JSON.parse(stored.local['jwt-builder-alg'])).toBe('ES384');
        expect(Object.keys(stored.local).filter((key) => key.startsWith('jwt-builder'))).toEqual(['jwt-builder-alg']);
        const dump = JSON.stringify(stored);
        for (const leaked of ['my-very-private-hmac-secret-value-123', 'payload-not-stored', 'PRIVATE KEY', hsToken, esToken]) {
            expect(dump).not.toContain(leaked);
        }

        await page.reload();
        await expect(algorithm(page)).toHaveValue('ES384');
        expect(await readJson(header(page))).toEqual({ alg: 'ES384', typ: 'JWT' });
        await expect(privateKey(page)).toHaveValue('');
        expect(await readJson(payload(page))).not.toHaveProperty('marker');
    });

    test('ignores a stored algorithm it doesn’t support', async ({ page, context }) => {
        await context.addInitScript(() => localStorage.setItem('jwt-builder-alg', JSON.stringify('none')));
        await page.goto('/jwt-builder');
        await expect(algorithm(page)).toHaveValue('HS256');
        expect(await readJson(header(page))).toEqual({ alg: 'HS256', typ: 'JWT' });
    });

    test('opens a JWT sent to it to edit and re-sign', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('main h1').first()).toBeVisible();
        // What openInTool(navigate, '/jwt-builder', { input }) does
        await page.evaluate((jwt) => {
            window.history.pushState({ usr: { smart: true, input: `Bearer ${jwt}` }, key: 'smart-test', idx: 1 }, '', '/jwt-builder');
            window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
        }, SAMPLE_JWT);
        await expect(page).toHaveURL(/\/jwt-builder$/);
        await expect(payload(page)).toHaveValue(JSON.stringify(JSON.parse(JWT_IO_PAYLOAD), null, 2));
        expect(await readJson(header(page))).toEqual(JSON.parse(JWT_IO_HEADER));
        await secret(page).fill('your-256-bit-secret');
        await expect(token(page)).toHaveText(SAMPLE_JWT);
    });

    test('fits a 375px screen with long keys and tokens', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await page.goto('/jwt-builder');
        await algorithm(page).selectOption('RS512');
        await page.getByRole('button', { name: 'Generate RS512 key pair' }).click();
        await signedToken(page);
        await expect(publicJwk(page)).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
