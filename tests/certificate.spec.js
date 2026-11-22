import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { X509Certificate, createHash, createPublicKey } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { useTheme } from './helpers.js';

// Certificate & Key Inspector. Expected values are computed here with Node's
// own X.509 and crypto code from the fixtures (tests/fixtures/certs, made by
// generate.sh), not taken from the page's parser.

const FIXTURES = new URL('./fixtures/certs/', import.meta.url);
const read = (name) => fs.readFileSync(new URL(name, FIXTURES));
const text = (name) => read(name).toString('utf8');
const pemBlocks = (name) => text(name).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
const chainCerts = () => pemBlocks('chain.pem').map((pem) => new X509Certificate(pem));

// The browser clock and time zone are pinned, so validity badges and local
// times are deterministic. Asia/Kolkata is UTC+5:30 with no daylight saving.
const NOW = new Date('2027-03-01T12:00:00Z');
const TIME_ZONE = 'Asia/Kolkata';
test.use({ timezoneId: TIME_ZONE, locale: 'en-US' });

const input = (page) => page.getByLabel('Certificate, request or key', { exact: true });
const card = (page, title) => page.locator('main section.card').filter({ has: page.getByRole('heading', { level: 2, name: title, exact: true }) });
const commonName = (x509) => x509.subject.split('\n').find((line) => line.startsWith('CN=')).slice(3);
const spkiPin = (x509) => createHash('sha256').update(x509.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
const colonSerial = (x509) => x509.serialNumber.toUpperCase().match(/../g).join(':');
const utcText = (date) => `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
const localText = (date) => date.toLocaleString('en-US', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'medium' });

// Whole calendar days between two instants in TIME_ZONE (what the badge counts)
function zoneDays(from, to) {
    const day = (date) => {
        const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date).split('-').map(Number);
        return Date.UTC(y, m - 1, d);
    };
    return Math.round((day(to) - day(from)) / 86_400_000);
}

async function dropFile(page, name, mimeType = 'application/octet-stream') {
    const dataTransfer = await page.evaluateHandle(({ bytes, fileName, type }) => {
        const data = new DataTransfer();
        data.items.add(new File([new Uint8Array(bytes)], fileName, { type }));
        return data;
    }, { bytes: [...read(name)], fileName: name, type: mimeType });
    await page.locator('main .drop-zone').dispatchEvent('drop', { dataTransfer });
}

test.describe('Certificate & Key Inspector', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await page.goto('/certificate');
        await expect(page.locator('main h1')).toHaveText('Certificate & Key Inspector');
    });

    test('decodes a pasted chain: subjects, SANs, dates, fingerprints and pins', async ({ page }) => {
        await input(page).fill(text('chain.pem'));
        await expect(page.locator('main')).toContainText('Found 3 certificates.');
        for (const x509 of chainCerts()) {
            const box = card(page, commonName(x509));
            await expect(box).toBeVisible();
            for (const attribute of x509.subject.split('\n')) await expect(box.locator('dd').first()).toContainText(attribute.split('=').slice(1).join('='));
            for (const attribute of x509.issuer.split('\n')) await expect(box.locator('dd').nth(1)).toContainText(attribute.split('=').slice(1).join('='));
            await expect(box).toContainText(colonSerial(x509));
            await expect(box).toContainText(utcText(new Date(x509.validFrom)));
            await expect(box).toContainText(utcText(new Date(x509.validTo)));
            await expect(box).toContainText(localText(new Date(x509.validTo)));
            await expect(box).toContainText(`Valid · expires in ${zoneDays(NOW, new Date(x509.validTo))} days`);
            await expect(box).toContainText(x509.fingerprint256);
            await expect(box).toContainText(x509.fingerprint);
            await expect(box).toContainText(spkiPin(x509));
        }
        // SANs of the leaf, as Node lists them ("DNS:leaf.example.test, DNS:api.example.test")
        const [leaf] = chainCerts();
        const san = card(page, 'leaf.example.test').locator('li', { hasText: 'Subject alternative names' });
        for (const name of leaf.subjectAltName.split(', ')) await expect(san).toContainText(name.replace(/^DNS:/, ''));
        const leafCard = card(page, 'leaf.example.test');
        await expect(leafCard.locator('li', { hasText: 'Extended key usage' })).toContainText('TLS server authentication');
        await expect(leafCard.locator('li', { hasText: 'Extended key usage' })).toContainText('TLS client authentication');
        await expect(leafCard.locator('li', { hasText: 'CRL distribution points' })).toContainText('http://crl.example.test/intermediate.crl');
        await expect(leafCard.locator('li', { hasText: 'Authority information access' })).toContainText('OCSPhttp://ocsp.example.test');
        await expect(leafCard.locator('li', { hasText: 'Certificate policies' })).toContainText('Domain Validated (DV)');
        await expect(leafCard.locator('li', { hasText: 'Signed certificate timestamps' })).toContainText('2 signed certificate timestamps');
        await expect(card(page, 'Toolbelt Test Intermediate CA').locator('li', { hasText: 'Basic constraints' })).toContainText('Path length0');
    });

    test('labels the chain and checks every link and signature', async ({ page }) => {
        const [leaf, intermediate, root] = chainCerts();
        // Node agrees the fixture chain is genuine
        expect(leaf.checkIssued(intermediate) && leaf.verify(intermediate.publicKey)).toBe(true);
        expect(intermediate.checkIssued(root) && intermediate.verify(root.publicKey)).toBe(true);
        expect(root.verify(root.publicKey)).toBe(true);

        await input(page).fill(text('chain.pem'));
        const chain = card(page, 'Chain');
        await expect(chain).toContainText('The chain links up to a self-signed root');
        const items = chain.getByRole('listitem');
        await expect(items).toHaveCount(3);
        await expect(items.nth(0).locator('.badge-primary')).toHaveText('Leaf');
        await expect(items.nth(1).locator('.badge-primary')).toHaveText('Intermediate');
        await expect(items.nth(2).locator('.badge-primary')).toHaveText('Root');
        await expect(chain.locator('.badge', { hasText: 'Signature valid' })).toHaveCount(3);
        await expect(chain.locator('.badge', { hasText: 'Issuer name matches' })).toHaveCount(2);
        await expect(chain.locator('.badge', { hasText: 'Key IDs match' })).toHaveCount(2);
        await expect(chain).toContainText('It isn’t a trust decision');
        await expect(card(page, 'leaf.example.test')).toContainText('Valid: signed by certificate 2');
        await expect(card(page, 'Toolbelt Test Root CA')).toContainText('Valid: it verifies with its own key');

        // The chain entries jump to their cards
        await items.nth(2).getByRole('button', { name: 'Toolbelt Test Root CA' }).click();
        await expect(card(page, 'Toolbelt Test Root CA')).toBeFocused();
    });

    test('flags certificates out of order and puts them in chain order', async ({ page }) => {
        const [leaf, intermediate, root] = pemBlocks('chain.pem');
        await input(page).fill([root, leaf, intermediate].join('\n'));
        const chain = card(page, 'Chain');
        await expect(chain).toContainText('Certificate 1 is self-signed, so a chain ends there: certificate 2 isn’t its issuer.');
        await expect(chain.locator('.badge', { hasText: 'Self-signed: a chain ends here' })).toBeVisible();
        await chain.getByRole('button', { name: 'Put in chain order' }).click();
        await expect(chain).toContainText('The chain links up to a self-signed root');
        await expect(page.locator('main section.card h2')).toHaveText(['Chain', 'leaf.example.test', 'Toolbelt Test Intermediate CA', 'Toolbelt Test Root CA']);
    });

    test('says when certificates are unrelated', async ({ page }) => {
        await input(page).fill(`${text('chain-leaf.pem')}\n${text('rsa-san.pem')}`);
        await expect(card(page, 'Chain')).toContainText('These certificates don’t form a chain');
        await expect(card(page, 'Chain').locator('.badge', { hasText: 'Issuer name doesn’t match' })).toBeVisible();
    });

    test('reads a dropped DER file', async ({ page }) => {
        const x509 = new X509Certificate(read('rsa-san.der'));
        await dropFile(page, 'rsa-san.der', 'application/x-x509-ca-cert');
        await expect(page.locator('main .cert-file')).toContainText('rsa-san.der');
        const box = card(page, 'www.example.test');
        await expect(box).toContainText('Certificate · DER file');
        await expect(box.locator('.badge', { hasText: 'Self-signed' })).toBeVisible();
        await expect(box).toContainText(x509.fingerprint256);
        await expect(box).toContainText(spkiPin(x509));
        // Every SAN type; IPv6 in RFC 5952 form (Node prints 2001:DB8:0:0:0:0:0:10)
        expect(x509.subjectAltName).toContain('IP Address:2001:DB8:0:0:0:0:0:10');
        const san = box.locator('li', { hasText: 'Subject alternative names' });
        for (const value of ['www.example.test', '*.example.test', '192.0.2.10', '2001:db8::10', 'admin@example.test', 'https://example.test/path?q=1', 'user@example.test', 'CN=Directory Name,O=Directory Org,C=RO', '1.2.3.4']) {
            await expect(san).toContainText(value);
        }
        for (const value of ['București', 'Toolbelt Test Ünïcödé SRL', 'qa-team']) await expect(box.locator('dd').first()).toContainText(value);
        await expect(box).toContainText('Valid: it verifies with its own key');
    });

    test('reads a PKCS#7 bundle picked with the file picker', async ({ page }) => {
        await page.locator('main input[type="file"]').setInputFiles(fileURLToPath(new URL('chain.p7b', FIXTURES)));
        await expect(page.locator('main')).toContainText('PKCS#7 bundle with 3 certificates.');
        for (const x509 of chainCerts()) await expect(card(page, commonName(x509))).toContainText(x509.fingerprint256);
        await expect(card(page, 'Chain')).toContainText('The chain links up to a self-signed root');
    });

    test('shows when certificates expired or aren’t valid yet', async ({ page }) => {
        const [leaf] = chainCerts();
        const later = new Date('2028-02-10T09:00:00Z');
        await page.clock.setFixedTime(later);
        await input(page).fill(text('chain-leaf.pem'));
        await expect(card(page, 'leaf.example.test').locator('.badge-danger')).toHaveText(`Expired ${zoneDays(new Date(leaf.validTo), later)} days ago`);

        const earlier = new Date('2026-11-01T00:00:00Z');
        await page.clock.setFixedTime(earlier);
        await input(page).fill('');
        await input(page).fill(text('chain-leaf.pem'));
        await expect(card(page, 'leaf.example.test').locator('.badge-warning').first()).toHaveText(`Not yet valid · starts in ${zoneDays(earlier, new Date(leaf.validFrom))} days`);
    });

    test('warns about a private key and never shows its contents', async ({ page }) => {
        const pem = text('test-key-rsa-pkcs1.key');
        await input(page).fill(pem);
        const box = card(page, 'RSA private key');
        await expect(box.getByRole('status').filter({ hasText: 'This is a secret key' })).toBeVisible();
        await expect(box).toContainText('nothing is uploaded or stored');
        await expect(box).toContainText('2048-bit');
        await expect(box).toContainText('PKCS#1 (traditional RSA)');
        await expect(box.getByText(/Raw ASN\.1/)).toHaveCount(0);
        await expect(box.getByRole('button', { name: /Copy|Download/ })).toHaveCount(0);
        // No piece of the key appears outside the input field
        const shown = (await page.locator('main section.card').filter({ hasNot: page.locator('textarea') }).allInnerTexts()).join('\n');
        const body = pem.split('-----')[2].replace(/\s+/g, '');
        for (let i = 0; i + 24 <= body.length; i += 24) expect(shown).not.toContain(body.slice(i, i + 24));
        await box.getByRole('button', { name: 'Clear input' }).click();
        await expect(input(page)).toHaveValue('');
        await expect(box).toHaveCount(0);
    });

    test('describes an encrypted private key without a password', async ({ page }) => {
        await input(page).fill(text('test-key-encrypted-pkcs8.key'));
        const box = card(page, 'Encrypted private key');
        await expect(box).toContainText('This is a secret key');
        await expect(box).toContainText('Unknown until it’s decrypted');
        await expect(box).toContainText('PBES2: PBKDF2 with HMAC-SHA-256, 100,000 iterations, AES-256-CBC');
    });

    test('shows a CSR with its requested names and a verified self-signature', async ({ page }) => {
        await input(page).fill(text('csr-ec.csr'));
        const box = card(page, 'csr.example.test');
        await expect(box).toContainText('Certificate request');
        await expect(box).toContainText('Valid: it verifies with its own key');
        await expect(box).toContainText('EC P-256');
        await expect(box).toContainText('ECDSA with SHA-256');
        // From `openssl req -text`: DNS:csr.example.test, DNS:www.csr.example.test, IP Address:198.51.100.7, email:csr@example.test
        const san = box.locator('li', { hasText: 'Subject alternative names' });
        for (const value of ['csr.example.test', 'www.csr.example.test', '198.51.100.7', 'csr@example.test']) await expect(san).toContainText(value);
        await expect(box).toContainText('Requested extensions · 4');
        await expect(box).toContainText('Set (not shown)');
        const shown = (await page.locator('main section.card').filter({ hasNot: page.locator('textarea') }).allInnerTexts()).join('\n');
        expect(shown).not.toContain('test-challenge-password');
        await expect(box).toContainText('+m0Qq6QQ43hX3m0NaOO1sWkILSBJy8qTzPOz7NzSGl0=');
    });

    test('exports public keys as JWKs that match the key', async ({ page }) => {
        for (const name of ['pub-ec.pem', 'pub-rsa.pem', 'pub-ed25519.pem']) {
            const spki = createPublicKey(text(name)).export({ type: 'spki', format: 'der' });
            await input(page).fill(text(name));
            const box = page.locator('main section.card').filter({ hasText: 'Public key · SubjectPublicKeyInfo' });
            await expect(box).toContainText(createHash('sha256').update(spki).digest('base64'));
            const jwk = JSON.parse(await box.locator('pre, code').filter({ hasText: '"kty"' }).first().innerText());
            expect(createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'der' }).equals(spki), name).toBe(true);
        }
        await input(page).fill(text('pub-rsa-pkcs1.pem'));
        await expect(page.locator('main section.card').filter({ hasText: 'Public key · PKCS#1' })).toContainText('RSA 2048-bit');
        await expect(page.getByRole('button', { name: 'Copy as PUBLIC KEY PEM' })).toBeVisible();
    });

    test('shows the raw ASN.1 tree', async ({ page }) => {
        await input(page).fill(text('chain-leaf.pem'));
        const box = card(page, 'leaf.example.test');
        await box.getByText(/^Raw ASN\.1 · 1059 bytes$/).click();
        const tree = box.locator('.cert-asn1');
        await expect(tree).toContainText('SEQUENCE3 elements · at 0');
        await expect(tree).toContainText('OBJECT IDENTIFIER1.2.840.10045.4.3.3 (ecdsa-with-SHA384)');
        await expect(tree).toContainText('UTCTime261121182511Z · 2026-11-21 18:25:11 UTC');
    });

    test('explains input it can’t read', async ({ page }) => {
        const alert = page.locator('main').getByRole('alert');
        const lines = text('chain-leaf.pem').trim().split(/\r?\n/);
        await input(page).fill([...lines.slice(0, 8), lines[lines.length - 1]].join('\n'));
        await expect(alert).toContainText('Truncated data: an element needs 1055 bytes but the data has only 332 left');
        await input(page).fill('hello, this is not a certificate');
        await expect(alert).toContainText('No certificate or key found');
        await input(page).fill(lines.slice(0, 8).join('\n'));
        await expect(alert).toContainText('has no END line');
        await expect(page.locator('main section.card h2')).toHaveCount(0);
    });

    test('opens PEM text sent from another tool (smart input)', async ({ page }) => {
        await page.evaluate((pem) => {
            window.history.pushState({ usr: { smart: true, input: pem }, key: 'smart-cert', idx: 1 }, '', '/certificate');
            window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
        }, text('chain-leaf.pem'));
        await expect(card(page, 'leaf.example.test')).toBeVisible();
        await expect(input(page)).toHaveValue(text('chain-leaf.pem').trim().replace(/\r\n/g, '\n'));
    });

    test('fits a 375px screen with every kind of item', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await input(page).fill([text('chain.pem'), text('rsa-san.pem'), text('rsa-dates.pem'), text('csr-ec.csr'), text('pub-ec.pem'), text('test-key-encrypted-pkcs8.key')].join('\n'));
        await expect(card(page, 'dates.example.test')).toContainText('RSASSA-PSS (SHA-256, MGF1 with SHA-256, 32 bytes of salt)');
        await card(page, 'www.example.test').getByText(/^Raw ASN\.1/).click();
        await expect(card(page, 'www.example.test').locator('.cert-asn1')).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    for (const theme of ['light', 'dark']) {
        test(`has no accessibility violations with results shown (${theme})`, async ({ page }) => {
            await useTheme(page, theme);
            await page.goto('/certificate');
            await input(page).fill([text('chain.pem'), text('csr-ec.csr'), text('pub-ec.pem'), text('test-key-ec-sec1.key')].join('\n'));
            await expect(card(page, 'Chain')).toContainText('Signature valid');
            await card(page, 'leaf.example.test').getByText(/^Raw ASN\.1/).click();
            const { violations } = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
            expect(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
        });
    }
});
