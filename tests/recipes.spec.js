import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import crypto from 'node:crypto';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { useTheme } from './helpers.js';

// Recipes: chained operations on text or bytes, run in a Web Worker.
// Expected values are worked out here with Node (zlib, crypto, Buffer), not by the page.

const inputBox = (page) => page.getByLabel('Input', { exact: true });
// The output text, or the hex view for binary output
const output = (page) => page.getByLabel('Output', { exact: true });
const step = (page, n, name) => page.getByRole('listitem', { name: `Step ${n}: ${name}` });
const allSteps = (page) => page.getByRole('listitem', { name: /^Step \d+: / });
const addOp = (page, name) => page.getByRole('button', { name: `Add ${name}`, exact: true }).click();
const recipeCard = (page) => page.getByRole('region', { name: /^Recipe/ });
const catalogTab = (page, name) => page.getByRole('group', { name: 'Show' }).getByRole('button', { name: new RegExp(`^${name}`) });
const loadExample = (page, name) => page.getByRole('button', { name: `Load example: ${name}` }).click();
const stepError = (page, n, name) => page.getByRole('alert').filter({ hasText: `Step ${n} · ${name}:` });

const b64 = (text) => Buffer.from(text).toString('base64');
const reverse = (text) => [...text].reverse().join('');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

// A link as the Share button makes it (#s= deflate-raw + Base64url of { v, t, d })
const shareLink = (data) => `/recipes#s=${zlib.deflateRawSync(Buffer.from(JSON.stringify({ v: 1, t: '/recipes', d: data }))).toString('base64url')}`;
const readLink = (url) => JSON.parse(zlib.inflateRawSync(Buffer.from(url.slice(url.indexOf('#s=') + 3), 'base64url')).toString());

test.describe('Recipes', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/recipes');
        await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
    });

    test('builds a recipe from the library, then reorders, skips and removes steps', async ({ page }) => {
        await inputBox(page).fill('Hello World');

        // Search, then Enter adds the first match
        const search = page.getByRole('searchbox', { name: 'Search operations' });
        await search.fill('upper');
        await search.press('Enter');
        await search.press('Escape');
        await expect(search).toHaveValue('');
        await addOp(page, 'Reverse');
        await addOp(page, 'Base64 encode');

        await expect(output(page)).toHaveText(b64(reverse('HELLO WORLD')));
        // The trail: kind and size after each step
        await expect(step(page, 1, 'Upper case')).toContainText('Text · 11 chars');
        await expect(step(page, 3, 'Base64 encode')).toContainText('Text · 16 chars');

        // Skipping a step passes its input through
        const skip = page.getByRole('button', { name: 'Skip step 2' });
        await skip.click();
        await expect(skip).toHaveAttribute('aria-pressed', 'true');
        await expect(step(page, 2, 'Reverse')).toContainText('Skipped');
        await expect(output(page)).toHaveText(b64('HELLO WORLD'));

        // Moving a step keeps keyboard focus on it
        await page.getByRole('button', { name: 'Move step 3 up' }).click();
        await expect(step(page, 2, 'Base64 encode')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Move step 2 up' })).toBeFocused();
        await page.getByRole('button', { name: 'Skip step 3' }).click();
        await expect(output(page)).toHaveText(reverse(b64('HELLO WORLD')));

        await page.getByRole('button', { name: 'Remove step 1' }).click();
        await expect(allSteps(page)).toHaveCount(2);
        await expect(output(page)).toHaveText(reverse(b64('Hello World')));
        // Focus moved to the step that took its place
        await expect(page.getByRole('button', { name: 'Remove step 1' })).toBeFocused();
    });

    test('step options apply as they change', async ({ page }) => {
        // ">>>?" is 3e 3e 3e 3f: Base64 "Pj4+Pw==" uses "+" and needs padding
        await inputBox(page).fill('>>>?');
        await addOp(page, 'Base64 encode');
        await expect(output(page)).toHaveText(Buffer.from('>>>?').toString('base64'));
        const card = step(page, 1, 'Base64 encode');
        await card.getByLabel('Alphabet').selectOption('url');
        await expect(output(page)).toHaveText(Buffer.from('>>>?').toString('base64').replace(/\+/g, '-'));
        await card.getByLabel('Padding (=)').uncheck();
        await expect(output(page)).toHaveText(Buffer.from('>>>?').toString('base64url'));

        // Options that only matter for some choices appear with them
        await addOp(page, 'HTML entity encode');
        const html = step(page, 2, 'HTML entity encode');
        await expect(html.getByLabel('Entities')).toHaveCount(0);
        await html.getByLabel('Encode').selectOption('all');
        await expect(html.getByLabel('Entities')).toBeVisible();
    });

    test('runs the built-in examples on their samples and on real input', async ({ page }) => {
        await catalogTab(page, 'Examples').click();

        // With an empty input, an example brings its own sample
        await loadExample(page, 'Decode a JWT');
        await expect(output(page)).toContainText('"name": "Ada Lovelace"');
        // An untouched sample is swapped for the next example's sample
        await loadExample(page, 'URL-decode → pretty JSON');
        await expect(output(page)).toContainText('"q": "café & crème"');

        // A real token, signed here; its big number must survive exactly
        const header = { alg: 'HS256', typ: 'JWT' };
        const payloadText = '{"sub":"user-7","name":"Zoë","admin":true,"id":12345678901234567890,"roles":["read","write"]}';
        const signingInput = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(payloadText).toString('base64url')}`;
        const token = `${signingInput}.${crypto.createHmac('sha256', 'test-secret').update(signingInput).digest('base64url')}`;
        await loadExample(page, 'Decode a JWT');
        await inputBox(page).fill(token);
        const expectedJwt = JSON.stringify({ header, payload: { sub: 'user-7', name: 'Zoë', admin: true, id: '@id@', roles: ['read', 'write'] } }, null, 2)
            .replace('"@id@"', '12345678901234567890');
        await expect(output(page)).toHaveText(expectedJwt);

        // The user's own input stays when another example is loaded
        const event = { service: 'billing', ok: true, attempts: [1, 2, 3], note: { msg: 'héllo wörld' } };
        await loadExample(page, 'Base64 → gunzip → pretty JSON');
        await expect(inputBox(page)).toHaveValue(token);
        await inputBox(page).fill(zlib.gzipSync(JSON.stringify(event)).toString('base64'));
        await expect(output(page)).toHaveText(JSON.stringify(event, null, 2));
        await expect(step(page, 2, 'Gunzip')).toContainText('UTF-8');

        const query = { q: 'a b & c/d?', page: 3, filters: { tags: ['x', 'y'], on: false } };
        await loadExample(page, 'URL-decode → pretty JSON');
        await inputBox(page).fill(encodeURIComponent(JSON.stringify(query)));
        await expect(output(page)).toHaveText(JSON.stringify(query, null, 2));

        // A binary file is hashed byte for byte
        await loadExample(page, 'Hash a file (SHA-256)');
        const bytes = crypto.randomBytes(300_000);
        bytes[0] = 0xff;
        await page.locator('input[type="file"]').setInputFiles({ name: 'data.bin', mimeType: 'application/octet-stream', buffer: bytes });
        await expect(page.getByText('data.bin', { exact: true })).toBeVisible();
        await expect(output(page)).toHaveText(sha256(bytes));
    });

    test('files are used as exact bytes and can be edited as text', async ({ page }) => {
        await addOp(page, 'Hex encode');
        // A byte order mark and CRLF line endings are part of the file
        await page.locator('input[type="file"]').setInputFiles({ name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('﻿hi\r\n') });
        await expect(page.getByText('note.txt', { exact: true })).toBeVisible();
        await expect(output(page)).toHaveText('efbbbf68690d0a');
        await page.getByRole('button', { name: 'Edit as text' }).click();
        await expect(inputBox(page)).toHaveValue('hi\n');
        await expect(output(page)).toHaveText('68690a');
    });

    test('saves, loads and deletes recipes, never storing the input', async ({ page }) => {
        const secret = 'top-secret-%7B%22a%22%3A1%7D';
        await inputBox(page).fill(secret);
        await addOp(page, 'URL decode');
        await addOp(page, 'JSON prettify');
        await step(page, 2, 'JSON prettify').getByLabel('Indent').selectOption('4');

        await recipeCard(page).getByRole('button', { name: 'Save', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Save recipe' });
        await expect(dialog.getByLabel('Name')).toBeFocused();
        await dialog.getByLabel('Name').fill('  Query   JSON ');
        await dialog.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(page.getByText('Saved “Query JSON”.')).toBeVisible();

        // Storage has the recipe, not the input
        const stored = await page.evaluate(() => ({ saved: localStorage.getItem('recipes-saved'), current: localStorage.getItem('recipes-current') }));
        expect(JSON.parse(stored.saved)).toEqual([
            { id: expect.any(String), name: 'Query JSON', steps: [{ op: 'url-decode' }, { op: 'json-prettify', options: { indent: '4' } }], savedAt: expect.any(Number) },
        ]);
        expect(stored.saved).not.toContain('top-secret');
        expect(stored.current).not.toContain('top-secret');

        await recipeCard(page).getByRole('button', { name: 'Clear', exact: true }).click();
        await expect(allSteps(page)).toHaveCount(0);
        await catalogTab(page, 'Saved').click();
        await page.getByRole('button', { name: 'Load Query JSON' }).click();
        await expect(allSteps(page)).toHaveCount(2);
        await expect(step(page, 2, 'JSON prettify').getByLabel('Indent')).toHaveValue('4');

        // After a reload: the recipe and the saved list are back, the input isn't
        await page.reload();
        await expect(step(page, 1, 'URL decode')).toBeVisible();
        await expect(inputBox(page)).toHaveValue('');

        // Saving under an existing name replaces it
        await recipeCard(page).getByRole('button', { name: 'Save', exact: true }).click();
        await expect(dialog.getByLabel('Name')).toHaveValue('Query JSON');
        await expect(dialog.getByRole('button', { name: 'Replace' })).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();

        // Delete, undo, delete again
        await catalogTab(page, 'Saved').click();
        await page.getByRole('button', { name: 'Delete Query JSON' }).click();
        await expect(page.getByText('No saved recipes')).toBeVisible();
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(page.getByRole('button', { name: 'Load Query JSON' })).toBeVisible();
        await page.getByRole('button', { name: 'Delete Query JSON' }).click();
        await expect(page.getByText('No saved recipes')).toBeVisible();
        expect(await page.evaluate(() => localStorage.getItem('recipes-saved'))).toBe('[]');
    });

    test('damaged storage is ignored', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.setItem('recipes-current', JSON.stringify({ steps: [{ op: 'upper-case', options: { nope: 1 } }, { op: 'gone' }, 'x'] }));
            localStorage.setItem('recipes-saved', JSON.stringify([{ name: 'Good', steps: [{ op: 'reverse' }] }, { name: 7 }, null, { name: 'Unknown only', steps: [{ op: 'gone' }] }]));
        });
        await page.reload();
        await expect(allSteps(page)).toHaveCount(1);
        await expect(step(page, 1, 'Upper case')).toBeVisible();
        await expect(catalogTab(page, 'Saved')).toHaveText('Saved (1)');
        await catalogTab(page, 'Saved').click();
        await expect(page.getByRole('button', { name: 'Load Good' })).toBeVisible();

        await page.evaluate(() => {
            localStorage.setItem('recipes-current', '"not a recipe"');
            localStorage.setItem('recipes-saved', '{"broken":');
        });
        await page.reload();
        await expect(page.getByText('No steps yet')).toBeVisible();
        await inputBox(page).fill('still works');
        await addOp(page, 'Upper case');
        await expect(output(page)).toHaveText('STILL WORKS');
    });

    test('a failing step stops the recipe and is pointed out', async ({ page }) => {
        await inputBox(page).fill(b64('hello'));
        await addOp(page, 'Base64 decode');
        await addOp(page, 'Gunzip');
        await addOp(page, 'JSON prettify');

        const banner = stepError(page, 2, 'Gunzip');
        await expect(banner).toContainText('Step 2 · Gunzip: the input isn’t gzip data');
        await expect(step(page, 1, 'Base64 decode')).toContainText('Bytes · 5 B');
        await expect(step(page, 2, 'Gunzip')).toContainText('Failed');
        await expect(step(page, 2, 'Gunzip')).toContainText('the input isn’t gzip data');
        await expect(step(page, 3, 'JSON prettify')).toContainText('Not run');
        // No stale or partial output next to the error
        await expect(output(page)).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeDisabled();
        await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();

        await banner.getByRole('button', { name: 'Show step' }).click();
        await expect(step(page, 2, 'Gunzip')).toBeFocused();

        // Fixing the input clears the error
        await inputBox(page).fill(zlib.gzipSync('{"fixed":true}').toString('base64'));
        await expect(output(page)).toHaveText('{\n  "fixed": true\n}');
        await expect(page.getByRole('alert').filter({ hasText: 'Step 2' })).toHaveCount(0);
    });

    test('an invalid regular expression is explained on its step', async ({ page }) => {
        await inputBox(page).fill('abcabc');
        await addOp(page, 'Find & replace');
        const card = step(page, 1, 'Find & replace');
        await card.getByLabel('Regex', { exact: true }).check();
        await card.getByLabel('Find', { exact: true }).fill('(a');
        await expect(stepError(page, 1, 'Find & replace')).toContainText('the pattern isn’t a valid regular expression: Unterminated group');
        await card.getByLabel('Find', { exact: true }).fill('(a)(b)');
        await card.getByLabel('Replace with', { exact: true }).fill('$2$1');
        await expect(output(page)).toHaveText('bacbac');
        await expect(card).toContainText('Replaced 2 matches');
        await card.getByLabel('Flags', { exact: true }).fill('gq');
        await expect(stepError(page, 1, 'Find & replace')).toContainText('“q” isn’t a regular expression flag');
    });

    test('binary output is shown as hex and downloads as a file', async ({ page }) => {
        await inputBox(page).fill('hello hello hello');
        await addOp(page, 'Gzip');
        await expect(page.getByText('Binary data: gzip data')).toBeVisible();
        await expect(output(page)).toContainText('00000000  1f 8b 08');
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            page.getByRole('button', { name: 'Download .gz' }).click(),
        ]);
        expect(download.suggestedFilename()).toBe('recipe-output.gz');
        expect(zlib.gunzipSync(fs.readFileSync(await download.path())).toString()).toBe('hello hello hello');

        // One click adds a step that turns the bytes into text
        await page.getByRole('button', { name: 'Hex encode', exact: true }).click();
        await expect(step(page, 2, 'Hex encode')).toBeVisible();
        await expect(output(page)).toHaveText(/^1f8b08/);
        await addOp(page, 'Hex decode');
        await addOp(page, 'Gunzip');
        await expect(output(page)).toHaveText('hello hello hello');
    });

    test('a runaway step can be stopped, and the page stays responsive', async ({ page }) => {
        await inputBox(page).fill(`${'a'.repeat(40)}b`);
        await addOp(page, 'Find & replace');
        const card = step(page, 1, 'Find & replace');
        await card.getByLabel('Regex', { exact: true }).check();
        // Catastrophic backtracking: never finishes on this input
        await card.getByLabel('Find', { exact: true }).fill('(a+)+$');
        const stop = page.getByRole('button', { name: 'Stop' });
        await expect(stop).toBeVisible();
        // The worker is stuck, the page isn't
        await inputBox(page).press('Control+End');
        await page.keyboard.type('!');
        await expect(inputBox(page)).toHaveValue(`${'a'.repeat(40)}b!`);
        await stop.click();
        await expect(page.getByText('The recipe was stopped before it finished.')).toBeVisible();
        await card.getByLabel('Find', { exact: true }).fill('a+');
        await expect(output(page)).toHaveText('b!');
    });

    test('a 12 MB paste stays out of the textarea and is hashed off the main thread', async ({ page }) => {
        await addOp(page, 'SHA-256');
        const line = 'The quick brown fox jumps over the lazy dog 0123456789\n';
        const count = 230_000;
        await inputBox(page).fill('start:');
        // A real paste event, at the end of what's already there
        await inputBox(page).evaluate((el, [text, n]) => {
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
            const data = new DataTransfer();
            data.setData('text/plain', text.repeat(n));
            el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, [line, count]);
        await expect(page.getByText('Large text', { exact: true })).toBeVisible();
        await expect(page.locator('main textarea')).toHaveCount(0);
        await expect(page.getByLabel('Start of the input')).toContainText('start:The quick brown fox');

        // Typing elsewhere stays quick while the worker hashes 12 MB
        const search = page.getByRole('searchbox', { name: 'Search operations' });
        await search.click();
        const started = Date.now();
        await page.keyboard.type('sha-256');
        expect(Date.now() - started).toBeLessThan(1500);
        await expect(search).toHaveValue('sha-256');

        await expect(output(page)).toHaveText(sha256(`start:${line.repeat(count)}`), { timeout: 20_000 });
        // 12,650,006 bytes = 12.06 MiB, shown without decimals from 10 MB up
        await expect(page.getByText('Text · 12,650,006 chars · 12 MB', { exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Edit as text' })).toBeVisible();
    });

    test('steps can also be reordered by dragging', async ({ page }) => {
        await inputBox(page).fill('  Abc  ');
        await addOp(page, 'Upper case');
        await addOp(page, 'Reverse');
        await addOp(page, 'Trim');
        await step(page, 3, 'Trim').locator('.rcp-grip').dragTo(step(page, 1, 'Upper case'), { targetPosition: { x: 60, y: 3 } });
        await expect(step(page, 1, 'Trim')).toBeVisible();
        await expect(step(page, 2, 'Upper case')).toBeVisible();
        await expect(output(page)).toHaveText('CBA');
    });

    test('has no accessibility problems with a recipe, notes and an error showing', async ({ page }) => {
        await catalogTab(page, 'Examples').click();
        await loadExample(page, 'Base64 → gunzip → pretty JSON');
        await catalogTab(page, 'Operations').click();
        await addOp(page, 'Unique lines');
        await addOp(page, 'Gunzip');
        await expect(stepError(page, 5, 'Gunzip')).toBeVisible();
        for (const theme of ['dark', 'light']) {
            // Switch theme, then let colour transitions (fields fade for 0.2 s) finish before measuring
            await page.evaluate(async (t) => {
                document.documentElement.setAttribute('data-theme', t);
                await new Promise((r) => requestAnimationFrame(r));
                await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
            }, theme);
            const { violations } = await new AxeBuilder({ page })
                .include('main')
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
                .analyze();
            expect(violations.map((v) => `${theme}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
        }
    });
});

test.describe('Recipes: shared links', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

    // Keep what the app copies, so parallel tests never read each other's clipboard
    test.beforeEach(async ({ context }) => {
        await context.addInitScript(() => {
            const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
            if (!write) return;
            navigator.clipboard.writeText = (text) => {
                window.__copied = text;
                return write(text);
            };
        });
    });

    test('a copied link reopens the recipe and, when asked, the input', async ({ page }) => {
        await page.goto('/recipes');
        await inputBox(page).fill(b64('hello world'));
        await addOp(page, 'Base64 decode');
        await addOp(page, 'Upper case');
        await addOp(page, 'Reverse');
        await page.getByRole('button', { name: 'Skip step 3' }).click();
        await expect(output(page)).toHaveText('HELLO WORLD');

        // Without "Include the input", the link has only the recipe
        await page.getByRole('button', { name: 'Share link' }).click();
        await expect(page.getByText(/^Link copied\./)).toBeVisible();
        const recipeOnly = await page.evaluate(() => window.__copied);
        expect(readLink(recipeOnly)).toEqual({ v: 1, t: '/recipes', d: { steps: [{ op: 'base64-decode' }, { op: 'upper-case' }, { op: 'reverse', enabled: false }] } });

        await page.getByLabel('Include the input in shared links').check();
        await page.getByRole('button', { name: 'Share link' }).click();
        await expect.poll(() => page.evaluate(() => window.__copied)).not.toBe(recipeOnly);
        const link = await page.evaluate(() => window.__copied);
        expect(link.startsWith(`${new URL(test.info().project.use.baseURL).origin}/recipes#s=`)).toBe(true);
        expect(link).toMatch(/\/recipes#s=[A-Za-z0-9_-]+$/);
        expect(readLink(link).d.input).toBe(b64('hello world'));

        // Start over, then open the link in the same page
        await recipeCard(page).getByRole('button', { name: 'Clear', exact: true }).click();
        await inputBox(page).fill('');
        await expect(allSteps(page)).toHaveCount(0);
        await page.goto('/');
        await page.goto(link);
        await expect(page.getByText('Opened a shared link.')).toBeVisible();
        await expect(page).toHaveURL(/\/recipes$/);
        await expect(step(page, 1, 'Base64 decode')).toBeVisible();
        await expect(step(page, 2, 'Upper case')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Skip step 3' })).toHaveAttribute('aria-pressed', 'true');
        await expect(inputBox(page)).toHaveValue(b64('hello world'));
        await expect(output(page)).toHaveText('HELLO WORLD');
    });

    test('links are checked: unknown operations are skipped with a warning', async ({ page }) => {
        await page.goto(shareLink({ steps: [{ op: 'upper-case' }, { op: 'teleport' }, { op: 'reverse', options: { by: 'sideways' } }], input: 'abc' }));
        await expect(page.getByText('Skipped a step with an unknown operation (“teleport”); reset an invalid option to the default.')).toBeVisible();
        await expect(allSteps(page)).toHaveCount(2);
        await expect(step(page, 2, 'Reverse').getByLabel('By')).toHaveValue('characters');
        await expect(output(page)).toHaveText('CBA');
    });

    test('opening a link over the recipe being edited can be undone', async ({ page }) => {
        await page.goto('/recipes');
        await addOp(page, 'Reverse');
        await page.goto('/');
        await page.goto(shareLink({ steps: [{ op: 'upper-case' }, { op: 'trim' }] }));
        await expect(step(page, 1, 'Upper case')).toBeVisible();
        await expect(page.getByText('The shared recipe replaced the one you were editing.')).toBeVisible();
        await page.getByRole('button', { name: 'Undo' }).click();
        await expect(step(page, 1, 'Reverse')).toBeVisible();
        await expect(allSteps(page)).toHaveCount(1);
    });

    test('a link that isn’t a recipe is refused', async ({ page }) => {
        await page.goto(shareLink({ pattern: 'x' }));
        await expect(page.getByText('Couldn’t open the shared link. This link doesn’t contain a recipe.')).toBeVisible();
        await expect(page.getByText('No steps yet')).toBeVisible();
    });
});

test('other tools can open text in Recipes (smart input)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main h1').first()).toBeVisible();
    // What openInTool() does: navigate with { smart: true, input } as the history state
    await page.evaluate(() => {
        window.history.pushState({ usr: { smart: true, input: '  aGk=  ' }, key: 'smart-input', idx: 1 }, '', '/recipes');
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }));
    });
    await expect(inputBox(page)).toHaveValue('aGk=');
    await addOp(page, 'Base64 decode');
    await expect(output(page)).toHaveText('hi');
});

test.describe('Recipes on a phone', () => {
    test.use({ viewport: { width: 375, height: 740 } });

    test('a full recipe fits without sideways scrolling', async ({ page }) => {
        await useTheme(page, 'light');
        await page.goto('/recipes');
        await catalogTab(page, 'Examples').click();
        await loadExample(page, 'Base64 → gunzip → pretty JSON');
        await catalogTab(page, 'Operations').click();
        await addOp(page, 'Find & replace');
        await addOp(page, 'Hex encode');
        await step(page, 4, 'Find & replace').getByLabel('Find', { exact: true }).fill('"');
        await expect(output(page)).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await catalogTab(page, 'Saved').click();
        await expect(page.getByText('No saved recipes')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
});
