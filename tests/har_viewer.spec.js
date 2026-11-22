import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { findLowContrast, useTheme } from './helpers.js';
import { parseHar, sanitizeHar, serializeHar, DEFAULT_SANITIZE_OPTIONS } from '../src/utils/har.js';

// tests/fixtures/har/sample.har: a Chrome-style export of a small shop session
// (redirect, document, script, cached CSS, image, XHR with JSON bodies, form
// POST, 404, 500, failed request, font, multipart upload, beacon, WebSocket,
// media) with a distinctive SECRET-… string planted wherever a secret can hide.
const FIXTURE_PATH = fileURLToPath(new URL('./fixtures/har/sample.har', import.meta.url));
const FIXTURE_TEXT = fs.readFileSync(FIXTURE_PATH, 'utf8');
const HAR = JSON.parse(FIXTURE_TEXT);
const ENTRIES = HAR.log.entries;

const PLANTED = [
    'SECRET-COOKIE-SID-41d2', 'SECRET-REDIRECT-TOKEN-5d1f', 'SECRET-FRAGMENT-TOKEN-9a9a', 'SECRET-SETCOOKIE-CSRF-88aa',
    'SECRET-APIKEY-QUERY-55b1', 'SECRET-BEARER-7f3a9c', 'SECRET-XAPIKEY-HEADER-0f0f', 'SECRET-JSON-CARDTOKEN-c3d4',
    'SECRET-NESTED-PW-1a2b', 'SECRET-RESPONSE-TOKEN-77ef', 'SECRET-PASSWORD-FORM-9e0c', 'SECRET-CSRF-HEADER-3c3c',
    'SECRET-JWT-SIG-0a0a', 'SECRET-MULTIPART-TOKEN-6e6e', 'SECRET-URL-PW-8c8c', 'SECRET-BEACON-SESSION-1d1d',
    'SECRET-WS-TOKEN-2e2e', 'SECRET-WS-SEND-TOKEN-4f4f',
    'amFuZTpTRUNSRVQtQkFTSUMtUFctNmI2Yg==', // Basic jane:SECRET-BASIC-PW-6b6b
];

async function openFixture(page) {
    await page.goto('/har');
    await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_PATH);
    await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible();
}

// Data rows of the requests table as { index (aria-rowindex), url, cells }, in table order
async function tableRows(page) {
    return page.getByRole('grid').evaluate((grid) => [...grid.querySelectorAll('[role="row"]')]
        .map((row) => ({
            index: Number(row.getAttribute('aria-rowindex')),
            url: row.getAttribute('title'),
            selected: row.getAttribute('aria-selected'),
            cells: [...row.querySelectorAll('[role="gridcell"]')].map((cell) => cell.innerText.trim()),
        }))
        .filter((row) => row.index > 1)
        .sort((a, b) => a.index - b.index));
}

const urls = (rows) => rows.map((row) => row.url);
const order = (compare) => ENTRIES.map((e, i) => ({ e, i })).sort((a, b) => compare(a.e, b.e) || a.i - b.i).map(({ e }) => e.request.url);
const rowFor = (page, text) => page.getByRole('grid').getByRole('row').filter({ hasText: text }).first();
const details = (page) => page.getByRole('region', { name: /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|—) / });
const shown = (page) => page.locator('main').getByText(/^(Showing \d+ of [\d,]+ requests|[\d,]+ requests?)$/);

async function downloadSanitized(page) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name: /^Download .+\.sanitized\.har$/ }).click(),
    ]);
    return { name: download.suggestedFilename(), text: fs.readFileSync(await download.path(), 'utf8') };
}

test.describe('HAR Viewer & Sanitizer', () => {
    test('opens a HAR file and summarizes it', async ({ page }) => {
        await openFixture(page);
        const main = page.locator('main');
        await expect(main.getByText('sample.har', { exact: true })).toBeVisible();
        await expect(main.getByText(/15 requests · exported by WebInspector 537\.36 · HAR 1\.2/)).toBeVisible();

        const stat = (label) => page.locator('dl.har-stats > div').filter({ has: page.locator('dt', { hasText: new RegExp(`^${label}`) }) }).locator('dd');
        await expect(stat('Requests')).toHaveText('15');
        await expect(stat('Failed')).toHaveText('1');
        await expect(stat('4xx errors')).toHaveText('1');
        await expect(stat('5xx errors')).toHaveText('1');
        await expect(stat('Domains')).toHaveText('5');
        // Page onLoad (812.25 ms), not the first-to-last span (1,240 ms)
        await expect(stat('Total time')).toHaveText('812 ms');
        const transferred = ENTRIES.reduce((sum, e) => sum + e.response._transferSize, 0);
        await expect(stat('Transferred')).toHaveText(`${(transferred / 1024 / 1024).toFixed(1)} MB`);

        const byType = page.getByRole('table', { name: 'Requests by type' });
        const typeRow = (name) => byType.getByRole('row').filter({ has: page.getByRole('rowheader', { name, exact: true }) });
        for (const [name, count] of [['Document', 2], ['XHR/Fetch', 5], ['JS', 1], ['CSS', 1], ['Image', 2], ['Font', 1], ['Media', 1], ['WebSocket', 1], ['Other', 1]]) {
            await expect(typeRow(name).getByRole('cell').first()).toHaveText(String(count));
        }
        await expect(typeRow('Media').getByRole('cell').nth(1)).toHaveText('1.0 MB');
        const byDomain = page.getByRole('table', { name: 'Requests by domain' });
        await expect(byDomain.getByRole('rowheader')).toHaveText(['api.example.test', 'cdn.example.test', 'shop.example.test', 'telemetry.example.test', 'tracker.example.test']);

        await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '16');
        expect(urls(await tableRows(page))).toEqual(ENTRIES.map((e) => e.request.url));
    });

    test('reports the secrets it finds, by name only', async ({ page }) => {
        await openFixture(page);
        const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Secrets found' }) });
        await expect(card.getByText('34 secrets in this file')).toBeVisible();
        const items = card.getByRole('list', { name: 'Secrets by kind' }).getByRole('listitem');
        const expected = [
            ['Authorization headers', 2, 'authorization ×2'],
            ['Bearer tokens', 1, null],
            ['Basic credentials', 1, null],
            ['API key, token and session headers', 3, 'x-api-key, x-client-context, x-csrf-token'],
            ['Cookie headers', 3, 'theme ×3, sid ×2'],
            ['Set-Cookie headers', 2, 'csrftoken, prefs'],
            ['Cookies in cookie lists', 7, 'theme ×3, sid ×2, csrftoken, prefs'],
            ['Sensitive query parameters', 8, 'token ×5, access_token, api_key, token_type'],
            ['Passwords in URLs', 1, 'collector'],
            ['Sensitive request body fields', 7, 'password ×2, card_token, credentials, session, token, upload_token'],
            ['Sensitive response body fields', 1, 'access_token'],
        ];
        await expect(items).toHaveCount(expected.length);
        for (const [k, [label, count, names]] of expected.entries()) {
            await expect(items.nth(k).locator('.har-secret-label')).toHaveText(label);
            await expect(items.nth(k).locator('.har-secret-count')).toHaveText(String(count));
            if (names) await expect(items.nth(k).locator('.har-secret-names')).toHaveText(names);
        }
        await expect(card.getByText('The file also holds 5 request bodies and 11 response bodies')).toBeVisible();
        const text = await card.innerText();
        for (const secret of PLANTED) expect(text).not.toContain(secret);
    });

    test('sanitizes and downloads a copy without any planted secret', async ({ page }) => {
        await openFixture(page);
        await expect(page.getByRole('button', { name: /^Download / })).toHaveCount(0);
        await page.getByRole('button', { name: 'Sanitize', exact: true }).click();
        await expect(page.getByText('Removed 34 secrets')).toBeVisible();
        await expect(page.getByText('The copy was scanned again: no secrets are left in it.')).toBeVisible();

        const table = page.getByRole('table', { name: 'Before and after sanitizing' });
        const compare = async (label) => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).getByRole('cell').allInnerTexts();
        expect(await compare('Authorization headers')).toEqual(['2', '0']);
        expect(await compare('Sensitive query parameters')).toEqual(['8', '0']);
        expect(await compare('Cookies in cookie lists')).toEqual(['7', '0']);
        expect(await compare('Request bodies')).toEqual(['5', '5']); // kept by default
        expect(await compare('Response bodies')).toEqual(['11', '0']);

        const { name, text } = await downloadSanitized(page);
        expect(name).toBe('sample.sanitized.har');
        for (const secret of PLANTED) expect(text, secret).not.toContain(secret);
        expect(text).not.toMatch(/SECRET/);
        expect(text).not.toContain('jane.doe@example.com');
        const parsed = JSON.parse(text);
        expect(parsed.log.entries).toHaveLength(ENTRIES.length);
        expect(parsed.log.entries.map((e) => e.request.method)).toEqual(ENTRIES.map((e) => e.request.method));
        expect(parsed.log.entries.map((e) => e.response.status)).toEqual(ENTRIES.map((e) => e.response.status));
        // Exactly what the shared implementation produces: same layout as the input, only sensitive values changed
        const { har, format } = parseHar(FIXTURE_TEXT);
        expect(text).toBe(serializeHar(sanitizeHar(har, DEFAULT_SANITIZE_OPTIONS).har, format));
        expect(text.startsWith('{\n  "log": {\n    "version": "1.2",')).toBe(true);
        expect(parsed.log.entries[5].request.headers.find((h) => h.name === 'authorization').value).toBe('Bearer [REDACTED]');
        expect(parsed.log.entries[5].response.content).toEqual({ size: ENTRIES[5].response.content.size, mimeType: 'application/json' });
    });

    test('sanitize options change what is removed', async ({ page }) => {
        await openFixture(page);
        const option = (name) => page.getByRole('checkbox', { name });

        // Keep response bodies: they stay, but their sensitive JSON fields are redacted
        await option(/^Drop response bodies/).uncheck();
        await page.getByRole('button', { name: 'Sanitize', exact: true }).click();
        await expect(page.getByText('Removed 34 secrets')).toBeVisible();
        let result = await downloadSanitized(page);
        let parsed = JSON.parse(result.text);
        expect(JSON.parse(parsed.log.entries[5].response.content.text)).toMatchObject({ access_token: '[REDACTED]', customer: { email: 'jane.doe@example.com' } });
        expect(parsed.log.entries[4].response.content).toEqual(ENTRIES[4].response.content);
        expect(result.text).not.toMatch(/SECRET/);

        // Changing an option clears the previous result
        await option(/^Remove cookies/).uncheck();
        await expect(page.getByRole('button', { name: /^Download / })).toHaveCount(0);
        await page.getByRole('button', { name: 'Sanitize', exact: true }).click();
        await expect(page.getByText('12 secrets left in the copy')).toBeVisible();
        await expect(page.getByText(/Removed 22\. The rest stay because their options are off\./)).toBeVisible();
        result = await downloadSanitized(page);
        expect(result.text).toContain('SECRET-COOKIE-SID-41d2');
        expect(result.text).not.toContain('SECRET-BEARER-7f3a9c');

        // Dropping request bodies empties them but keeps their MIME type
        await option(/^Remove cookies/).check();
        await option(/^Drop request bodies/).check();
        await page.getByRole('button', { name: 'Sanitize', exact: true }).click();
        await expect(page.getByText('Removed 34 secrets')).toBeVisible();
        result = await downloadSanitized(page);
        parsed = JSON.parse(result.text);
        expect(parsed.log.entries[6].request.postData).toEqual({ mimeType: 'application/x-www-form-urlencoded', text: '', params: [] });
        expect(parsed.log.entries[13]._webSocketMessages[0].data).toBe('');
    });

    test('filters by URL text, type and status', async ({ page }) => {
        await openFixture(page);
        const search = page.getByRole('searchbox', { name: 'Filter by URL' });
        const typeChip = (name) => page.getByRole('group', { name: 'Filter by type' }).getByRole('button', { name: new RegExp(`^${name.replace('/', '\\/')} \\d`) });
        const statusChip = (name) => page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: new RegExp(`^${name} \\d`) });

        await search.fill('V1/ORDERS');
        await expect(shown(page)).toHaveText('Showing 1 of 15 requests');
        expect(urls(await tableRows(page))).toEqual([ENTRIES[5].request.url]);

        await search.fill('nothing-matches-this');
        await expect(page.getByText('No requests match these filters')).toBeVisible();
        await page.getByRole('button', { name: 'Clear filters' }).first().click();
        await expect(search).toHaveValue('');
        await expect(shown(page)).toHaveText('15 requests');

        await typeChip('XHR/Fetch').click();
        await expect(typeChip('XHR/Fetch')).toHaveAttribute('aria-pressed', 'true');
        expect(urls(await tableRows(page))).toEqual([5, 6, 7, 8, 11].map((i) => ENTRIES[i].request.url));
        await typeChip('Image').click();
        await expect(shown(page)).toHaveText('Showing 7 of 15 requests');

        await statusChip('5xx').click();
        expect(urls(await tableRows(page))).toEqual([ENTRIES[8].request.url]);
        await typeChip('XHR/Fetch').click();
        await typeChip('Image').click();
        await statusChip('4xx').click();
        await statusChip('Failed').click();
        expect(urls(await tableRows(page))).toEqual([7, 8, 9].map((i) => ENTRIES[i].request.url));
        const failed = (await tableRows(page)).find((row) => row.url.includes('pixel.gif'));
        expect(failed.cells[1]).toBe('Failed');

        await expect(page.getByRole('group', { name: /^Filter by/ }).getByRole('button', { pressed: true })).toHaveCount(3);
        await page.getByRole('button', { name: 'Clear filters' }).click();
        await expect(shown(page)).toHaveText('15 requests');
        await expect(page.getByRole('group', { name: /^Filter by/ }).getByRole('button', { pressed: true })).toHaveCount(0);
    });

    test('sorts by any column, ascending, descending, then file order', async ({ page }) => {
        await openFixture(page);
        const header = (name) => page.getByRole('grid').getByRole('columnheader', { name });

        await header('Size').getByRole('button').click();
        await expect(header('Size')).toHaveAttribute('aria-sort', 'ascending');
        expect(urls(await tableRows(page))).toEqual(order((a, b) => a.response._transferSize - b.response._transferSize));
        await header('Size').getByRole('button').click();
        await expect(header('Size')).toHaveAttribute('aria-sort', 'descending');
        expect(urls(await tableRows(page))).toEqual(order((a, b) => b.response._transferSize - a.response._transferSize));
        await header('Size').getByRole('button').click();
        await expect(header('Size')).toHaveAttribute('aria-sort', 'none');
        expect(urls(await tableRows(page))).toEqual(ENTRIES.map((e) => e.request.url));

        await header('Status').getByRole('button').click();
        expect(urls(await tableRows(page))).toEqual(order((a, b) => a.response.status - b.response.status));
        expect((await tableRows(page))[0].cells[1]).toBe('Failed');

        await header('Time').getByRole('button').click();
        await header('Time').getByRole('button').click();
        await expect(header('Status')).toHaveAttribute('aria-sort', 'none');
        const rows = await tableRows(page);
        expect(urls(rows)).toEqual(order((a, b) => b.time - a.time));
        expect(rows[0].cells.at(-2)).toBe('360 ms');

        await header('URL').getByRole('button').click();
        const byUrl = order((a, b) => {
            const split = (u) => /^[a-z]+:\/\/(?:[^/@]*@)?([^/?#]*)(.*)$/i.exec(u).slice(1);
            const [ha, pa] = split(a.request.url);
            const [hb, pb] = split(b.request.url);
            return ha < hb ? -1 : ha > hb ? 1 : pa < pb ? -1 : pa > pb ? 1 : 0;
        });
        expect(urls(await tableRows(page))).toEqual(byUrl);
    });

    test('shows request details in tabs', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await openFixture(page);
        await rowFor(page, '/v1/orders').click();
        const panel = details(page);
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('heading', { level: 3 })).toHaveText(`POST 201 ${ENTRIES[5].request.url}`);
        await expect(rowFor(page, '/v1/orders')).toHaveAttribute('aria-selected', 'true');

        const field = (name) => panel.locator('.har-kv-row').filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}`) }) }).locator('dd');
        await expect(field('Status')).toHaveText('201');
        await expect(field('HTTP version')).toHaveText('http/2.0');
        await expect(field('Remote address')).toHaveText('203.0.113.20:443');
        await expect(field('Server IP address')).toHaveText('203.0.113.20');
        await expect(field('Connection')).toHaveText('41240');
        await expect(field('Type')).toHaveText('XHR/Fetch (xhr)');
        await expect(field('Initiator')).toHaveText('script: https://cdn.example.test/assets/app.js');

        const tab = (name) => panel.getByRole('group', { name: 'Request details' }).getByRole('button', { name });
        await tab(/^Request headers \(10\)$/).click();
        await expect(tab(/^Request headers/)).toHaveAttribute('aria-pressed', 'true');
        await expect(field('authorization')).toHaveText('Bearer SECRET-BEARER-7f3a9c');
        await expect(panel.locator('.har-kv-row').filter({ hasText: 'authorization' }).getByText('secret', { exact: true })).toBeVisible();
        await expect(field(':path')).toHaveText('/v1/orders?api_key=SECRET-APIKEY-QUERY-55b1&page=1');

        await tab(/^Query \(2\)$/).click();
        await expect(field('api_key')).toHaveText('SECRET-APIKEY-QUERY-55b1');
        await expect(field('page')).toHaveText('1');

        await tab('Request body').click();
        const code = panel.locator('pre').first();
        await expect(code).toContainText('"card_token": "SECRET-JSON-CARDTOKEN-c3d4"');
        await panel.getByRole('button', { name: 'Raw' }).click();
        await expect(code).toHaveText(ENTRIES[5].request.postData.text);

        await tab('Response body').click();
        await expect(panel.getByText('application/json · 135 B')).toBeVisible();
        await expect(panel.locator('pre').first()).toContainText('"access_token": "SECRET-RESPONSE-TOKEN-77ef"');

        await tab('Timings').click();
        const timings = panel.getByRole('table', { name: 'Timing phases' });
        const phase = (name) => timings.getByRole('row').filter({ has: page.getByRole('rowheader', { name }) }).getByRole('cell');
        await expect(phase(/^Waiting for server/)).toHaveText('118 ms');
        await expect(phase(/^Initial connection \(includes SSL\/TLS\)/)).toHaveText('28 ms');
        await expect(phase(/^SSL\/TLS/)).toHaveText('16 ms');
        await expect(phase(/^Total/)).toHaveText('157 ms');

        await panel.getByRole('button', { name: 'Copy as cURL' }).click();
        const curl = await page.evaluate(() => navigator.clipboard.readText());
        expect(curl.startsWith(`curl '${ENTRIES[5].request.url}'`)).toBe(true);
        expect(curl).toContain("-H 'authorization: Bearer SECRET-BEARER-7f3a9c'");
        expect(curl).toContain(`--data-raw '${ENTRIES[5].request.postData.text}'`);
        expect(curl).not.toContain(':authority');

        // The tab stays when another request is selected
        await rowFor(page, '/img/logo.png').click();
        await expect(details(page).getByRole('heading', { level: 3 })).toHaveText(`GET 200 ${ENTRIES[4].request.url}`);
        await expect(tab('Timings')).toHaveAttribute('aria-pressed', 'true');

        await panel.getByRole('button', { name: 'Close details' }).click();
        await expect(details(page)).toHaveCount(0);
    });

    test('shows images, binary and missing bodies, failures, redirects and cookies', async ({ page }) => {
        await openFixture(page);
        const tab = (name) => details(page).getByRole('group', { name: 'Request details' }).getByRole('button', { name });

        await rowFor(page, '/img/logo.png').click();
        await tab('Response body').click();
        const image = details(page).getByRole('img', { name: /^Response image \(image\/png, \d+ B\)$/ });
        await expect(image).toBeVisible();
        expect(await image.evaluate((img) => [img.naturalWidth, img.naturalHeight, img.src.slice(0, 22)])).toEqual([16, 16, 'data:image/png;base64,']);
        await expect(details(page).getByText('16 × 16 px')).toBeVisible();

        await rowFor(page, '/fonts/inter.woff2').click();
        await expect(details(page).getByText('Binary content (font/woff2, 64 B) isn’t shown.')).toBeVisible();

        await rowFor(page, '/media/intro.mp4').click();
        await expect(details(page).getByText(/^No response body in the file\./)).toBeVisible();

        await rowFor(page, 'pixel.gif').click();
        await tab('General').click();
        const field = (name) => details(page).locator('.har-kv-row').filter({ has: page.locator('dt', { hasText: new RegExp(`^${name}$`) }) }).locator('dd');
        await expect(field('Status')).toHaveText('Failed: net::ERR_BLOCKED_BY_CLIENT');

        await rowFor(page, '/start').click();
        await expect(field('Status')).toHaveText('302 Found');
        await expect(field('Redirect URL')).toHaveText(ENTRIES[0].response.redirectURL);

        await rowFor(page, '/account?token').click();
        await tab(/^Cookies \(4\)$/).click();
        const cookies = details(page).locator('.har-kv-row');
        await expect(cookies).toHaveCount(4);
        await expect(cookies.nth(0)).toContainText('sid');
        await expect(cookies.nth(0)).toContainText('SECRET-COOKIE-SID-41d2');
        await expect(cookies.nth(0)).toContainText('Domain shop.example.test · Path / · Expires 2026-12-20T09:15:02.000Z · HttpOnly · Secure · SameSite Lax');
        await expect(cookies.nth(2)).toContainText('csrftoken');
    });

    test('rows are keyboard accessible and selection follows the arrow keys', async ({ page }) => {
        await openFixture(page);
        const row = (index) => page.locator(`[role="row"][aria-rowindex="${index}"]`);
        await row(2).focus();
        await page.keyboard.press('ArrowDown');
        await expect(row(3)).toBeFocused();
        await expect(details(page)).toHaveCount(0);
        await page.keyboard.press('Enter');
        await expect(details(page).getByRole('heading', { level: 3 })).toHaveText(`GET 200 ${ENTRIES[1].request.url}`);
        await expect(row(3)).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('ArrowDown');
        await expect(row(4)).toBeFocused();
        await expect(details(page).getByRole('heading', { level: 3 })).toHaveText(`GET 200 ${ENTRIES[2].request.url}`);
        await page.keyboard.press('End');
        await expect(row(16)).toBeFocused();
        await expect(details(page).getByRole('heading', { level: 3 })).toHaveText(`GET 206 ${ENTRIES[14].request.url}`);
        await page.keyboard.press('Home');
        await expect(row(2)).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(details(page)).toHaveCount(0);
        await expect(row(2)).toBeFocused();
        // Closing with the button gives the focus back to the table
        await page.keyboard.press(' ');
        await details(page).getByRole('button', { name: 'Close details' }).click();
        await expect(row(2)).toBeFocused();
    });

    test('opens pasted JSON and explains what is wrong with bad input', async ({ page }) => {
        await page.goto('/har');
        await expect(page.getByText('The file is processed on this device. Nothing is uploaded.')).toBeVisible();
        const paste = page.getByRole('textbox', { name: 'Or paste HAR JSON' });
        const open = page.getByRole('button', { name: 'Open pasted JSON' });
        await expect(open).toBeDisabled();

        await paste.fill('{"log": {"entries": [');
        await open.click();
        await expect(page.getByRole('alert')).toContainText('This isn’t complete JSON: the text ends too early.');
        await expect(paste).toHaveValue('{"log": {"entries": ['); // kept, so it can be fixed

        await paste.fill('{"version": "1.2", "requests": []}');
        await open.click();
        await expect(page.getByRole('alert')).toContainText('This is JSON but not a HAR file: it has no log.entries.');

        await page.locator('input[type="file"]').first().setInputFiles({ name: 'list.json', mimeType: 'application/json', buffer: Buffer.from('[1, 2, 3]') });
        await expect(page.getByRole('alert')).toContainText('This is JSON but not a HAR file: it’s a list');

        const one = { log: { version: '1.2', creator: { name: 'test', version: '1' }, entries: [ENTRIES[7]] } };
        await paste.fill(JSON.stringify(one));
        await open.click();
        await expect(page.getByText('pasted.har', { exact: true })).toBeVisible();
        await expect(shown(page)).toHaveText('1 request');
        await expect(page.getByRole('alert')).toHaveCount(0);

        await page.getByRole('button', { name: 'Close', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Open pasted JSON' })).toBeVisible();
    });

    test('big files load in the background and only visible rows are rendered', async ({ page }) => {
        test.setTimeout(90_000);
        const count = 12_000;
        const t0 = Date.parse(ENTRIES[0].startedDateTime);
        const entries = Array.from({ length: count }, (_, i) => {
            const e = structuredClone(ENTRIES[i % ENTRIES.length]);
            e.request.url = `https://big${i % 7}.example.test/item/${i}?n=${i}`;
            e.startedDateTime = new Date(t0 + i * 5).toISOString();
            return e;
        });
        // Laid out like a DevTools export (2-space indentation). A file on disk, not an
        // in-memory buffer: Playwright builds buffers inside the page, which blocks it.
        const bigPath = test.info().outputPath('big.har');
        fs.writeFileSync(bigPath, JSON.stringify({ log: { ...HAR.log, entries } }, null, 2));
        expect(fs.statSync(bigPath).size).toBeGreaterThan(25 * 1024 * 1024);

        await page.goto('/har');
        await page.evaluate(() => {
            window.harLongTasks = [];
            window.harChangeAt = Infinity;
            document.addEventListener('change', () => { window.harChangeAt = performance.now(); }, true);
            new PerformanceObserver((list) => window.harLongTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, ms: e.duration })))).observe({ type: 'longtask' });
            window.harSawLoading = false;
            new MutationObserver(() => {
                const busy = document.querySelector('main [aria-busy="true"]');
                if (busy && /(Reading|Parsing|Indexing)/.test(busy.textContent)) window.harSawLoading = true;
            }).observe(document.body, { childList: true, subtree: true, characterData: true });
        });
        await page.locator('input[type="file"]').first().setInputFiles(bigPath);
        await expect(page.getByRole('heading', { name: 'Summary' })).toBeVisible({ timeout: 60_000 });
        expect(await page.evaluate(() => window.harSawLoading)).toBe(true);
        // Reading, parsing and indexing happen in a worker: from the moment the
        // file is picked, the page never blocks for long
        const longTasks = await page.evaluate(() => window.harLongTasks.filter((t) => t.start >= window.harChangeAt).map((t) => Math.round(t.ms)));
        expect(Math.max(0, ...longTasks), `long tasks: ${longTasks.join(', ')} ms`).toBeLessThan(250);

        const grid = page.getByRole('grid');
        await expect(grid).toHaveAttribute('aria-rowcount', String(count + 1));
        const rendered = await grid.getByRole('row').count();
        expect(rendered).toBeLessThan(60);

        await page.locator('.har-grid-body').evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const last = page.locator(`[role="row"][aria-rowindex="${count + 1}"]`);
        await expect(last).toBeVisible();
        await expect(last).toHaveAttribute('title', `https://big${(count - 1) % 7}.example.test/item/${count - 1}?n=${count - 1}`);
        expect(await grid.getByRole('row').count()).toBeLessThan(60);

        await last.focus();
        await page.keyboard.press('Home');
        await expect(page.locator('[role="row"][aria-rowindex="2"]')).toBeFocused();
        await page.keyboard.press('PageDown');
        await page.keyboard.press('End');
        await expect(last).toBeFocused();

        await page.getByRole('searchbox', { name: 'Filter by URL' }).fill('/item/11999?');
        await expect(shown(page)).toHaveText('Showing 1 of 12,000 requests');
        await page.getByRole('searchbox', { name: 'Filter by URL' }).fill('');
        await page.getByRole('columnheader', { name: 'Time' }).getByRole('button').click();
        await expect(page.locator('[role="row"][aria-rowindex="2"]')).toBeVisible();
    });

    test('details open below the table on a phone, without sideways scrolling', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await openFixture(page);
        const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(await overflow()).toBeLessThanOrEqual(0);
        // Phones: no Method column; the method leads the URL cell, which shows the path
        const row = rowFor(page, '/v1/orders');
        await expect(page.getByRole('columnheader', { name: 'Method' })).toBeHidden();
        await expect(row.getByRole('gridcell').nth(1)).toHaveText('POST/v1/orders?api_key=SECRET-APIKEY-QUERY-55b1&page=1', { useInnerText: true });
        await row.click();
        const panel = details(page);
        await expect(panel).toBeVisible();
        const tableBox = await page.getByRole('grid').boundingBox();
        const panelBox = await panel.boundingBox();
        expect(panelBox.y).toBeGreaterThanOrEqual(tableBox.y + tableBox.height);
        expect(await overflow()).toBeLessThanOrEqual(0);
        await panel.getByRole('button', { name: 'Response body' }).click();
        expect(await overflow()).toBeLessThanOrEqual(0);
    });

    test('details open beside the table on a wide screen', async ({ page }) => {
        await page.setViewportSize({ width: 1600, height: 900 });
        await openFixture(page);
        const header = (name) => page.getByRole('grid').locator('[role="columnheader"]').filter({ hasText: new RegExp(`^${name}$`) });
        await expect(header('Waterfall')).toBeVisible();
        await expect(header('Type')).toBeVisible();
        await rowFor(page, '/v1/orders').click();
        const tableBox = await page.getByRole('grid').boundingBox();
        const panelBox = await details(page).boundingBox();
        expect(panelBox.x).toBeGreaterThan(tableBox.x + tableBox.width - 1);
        expect(Math.abs(panelBox.y - tableBox.y)).toBeLessThan(200);
        // Type and Waterfall make room for the details
        await expect(header('Waterfall')).toBeHidden();
        await expect(header('Type')).toBeHidden();
    });

    for (const theme of ['light', 'dark']) {
        test(`text stays readable with a file open (${theme})`, async ({ page }) => {
            await useTheme(page, theme);
            await openFixture(page);
            await rowFor(page, '/v1/orders').click();
            await page.getByRole('button', { name: 'Sanitize', exact: true }).click();
            await expect(page.getByRole('button', { name: /^Download / })).toBeVisible();
            await page.getByRole('group', { name: 'Filter by status' }).getByRole('button', { name: /^4xx/ }).click();
            await rowFor(page, '/v1/profile').click();
            await page.waitForTimeout(150);
            const low = await page.evaluate(findLowContrast, 4.5);
            expect(low, low.join('\n')).toEqual([]);
        });
    }

    test('has no accessibility violations with a file open', async ({ page }) => {
        await openFixture(page);
        await rowFor(page, '/v1/orders').click();
        await details(page).getByRole('button', { name: 'Response body' }).click();
        await page.getByRole('button', { name: 'Sanitize', exact: true }).click();
        await expect(page.getByRole('button', { name: /^Download / })).toBeVisible();
        const results = await new AxeBuilder({ page }).include('main').analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`)).toEqual([]);
    });
});
