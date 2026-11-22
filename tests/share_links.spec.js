import { Buffer } from 'node:buffer';
import { deflateRawSync } from 'node:zlib';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { useTheme } from './helpers.js';

// Shareable links (#s=… in the URL) for the Regex Tester, Cron Parser, Text Diff
// and Data Converter, and the Text Diff's "Compare as JSON" option.

// The server the tests run against (the dev server, or a preview of a build)
const origin = () => new URL(test.info().project.use.baseURL).origin;
const DEFAULT_PATTERN = String.raw`([A-Z])\w+`;
const DEFAULT_TEXT = 'Hello World, this is a Vibe Check.';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

// Keep a copy of what the app writes to the clipboard, so each test reads its own link
test.beforeEach(async ({ context }) => {
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

async function copyShareLink(page, route) {
    await page.getByRole('button', { name: 'Share link' }).click();
    await expect(page.getByText(/^Link copied\./)).toBeVisible();
    const url = await page.evaluate(() => window.__copied);
    expect(url).toMatch(new RegExp(`^${origin()}${route}#s=[A-Za-z0-9_-]+$`));
    return url;
}

// A new browser context: nothing carries over from the page that made the link
async function openFresh(browser, url) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(url);
    await expect(page.getByText('Opened a shared link.')).toBeVisible();
    // The fragment is dropped once applied, so later edits aren't mistaken for the shared version
    await expect(page).toHaveURL(url.slice(0, url.indexOf('#')));
    return { context, page, errors };
}

// A link for `route` with arbitrary data (as if edited by hand), encoded here
// the way src/utils/share.js does it: JSON { v, t, d }, raw deflate, Base64url.
// Built in the test, so it works against a production build too.
function makeLink(_page, route, data) {
    const packed = deflateRawSync(Buffer.from(JSON.stringify({ v: 1, t: route, d: data })));
    return `${origin()}${route}#s=${packed.toString('base64url')}`;
}

test.describe('Shared links', () => {
    test('Regex Tester: pattern, flags, test text, mode and replacement come back exactly', async ({ page, browser }) => {
        await page.goto('/regex');
        const pattern = String.raw`(?<word>\p{Lu}\p{Ll}+)\s*`;
        const flags = 'gu';
        const text = 'Ünïcode Text\twith tabs, emoji 😀 and\nNew lines  \nTrailing';
        const replacement = '[$<word>] ';
        // Worked out here, not by the page
        const expected = text.replace(new RegExp(pattern, flags), replacement);

        await page.getByLabel('Regular expression').fill(pattern);
        await page.getByRole('textbox', { name: 'Flags' }).fill(flags);
        await page.getByLabel('Test text').fill(text);
        await page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Replace' }).click();
        await page.getByLabel('Replace with').fill(replacement);
        const result = page.getByRole('region', { name: 'Replace result' }).locator('.code-well');
        await expect.poll(() => result.textContent()).toBe(expected);

        const url = await copyShareLink(page, '/regex');
        // The real clipboard holds the same link
        await page.bringToFront();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

        const fresh = await openFresh(browser, url);
        const p = fresh.page;
        await expect(p.getByLabel('Regular expression')).toHaveValue(pattern);
        await expect(p.getByRole('textbox', { name: 'Flags' })).toHaveValue(flags);
        await expect(p.getByLabel('Test text')).toHaveValue(text);
        await expect(p.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Replace' })).toHaveAttribute('aria-pressed', 'true');
        await expect(p.getByLabel('Replace with')).toHaveValue(replacement);
        await expect.poll(() => p.getByRole('region', { name: 'Replace result' }).locator('.code-well').textContent()).toBe(expected);
        expect(fresh.errors).toEqual([]);
        await fresh.context.close();
    });

    test('Regex Tester: match mode shows the same matches', async ({ page, browser }) => {
        await page.goto('/regex');
        const pattern = String.raw`\b\d{3}-\d{4}\b`;
        const text = 'Call 555-1234 or 555-9876, not 5555-12345.';
        const count = text.match(new RegExp(pattern, 'g')).length;
        await page.getByLabel('Regular expression').fill(pattern);
        await page.getByLabel('Test text').fill(text);
        await expect(page.getByRole('heading', { name: `Match Details (${count})` })).toBeVisible();
        const details = await page.getByRole('region', { name: 'Match details' }).innerText();

        const fresh = await openFresh(browser, await copyShareLink(page, '/regex'));
        await expect(fresh.page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Match' })).toHaveAttribute('aria-pressed', 'true');
        await expect(fresh.page.getByRole('heading', { name: `Match Details (${count})` })).toBeVisible();
        expect(await fresh.page.getByRole('region', { name: 'Match details' }).innerText()).toBe(details);
        await fresh.context.close();
    });

    test('Cron Parser: expression, time zone, clock and number of runs come back', async ({ page, browser }) => {
        await page.goto('/cron');
        await page.getByLabel('Cron expression').fill('30 2 * * 0');
        await page.getByRole('button', { name: 'UTC', exact: true }).click();
        const clock = page.getByLabel('24-hour clock');
        // Flip whatever this locale starts with
        await clock.setChecked(!(await clock.isChecked()));
        const use24Hour = await clock.isChecked();
        await page.getByLabel('Number of runs to show').selectOption('25');
        const runs = page.getByRole('region', { name: 'Next runs' }).locator('time');
        const readTimes = () => runs.evaluateAll((els) => els.map((el) => el.getAttribute('datetime')));
        // 25 Sundays at 02:30 UTC, a week apart
        await expect.poll(async () => {
            const list = await readTimes();
            return list.length === 25 && list.every((iso) => /T02:30:00\.000Z$/.test(iso));
        }).toBe(true);
        const times = await readTimes();
        for (const [i, iso] of times.entries()) {
            expect(new Date(iso).getUTCDay()).toBe(0);
            if (i) expect(Date.parse(iso) - Date.parse(times[i - 1])).toBe(7 * 24 * 3600 * 1000);
        }
        const description = await page.getByRole('region', { name: 'Description' }).locator('p').innerText();

        const fresh = await openFresh(browser, await copyShareLink(page, '/cron'));
        const p = fresh.page;
        await expect(p.getByLabel('Cron expression')).toHaveValue('30 2 * * 0');
        await expect(p.getByRole('button', { name: 'UTC', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(p.getByLabel('24-hour clock')).toBeChecked({ checked: use24Hour });
        await expect(p.getByLabel('Number of runs to show')).toHaveValue('25');
        // The page renders the old expression's runs for a moment (useDeferredValue), so wait for the values
        const freshRuns = p.getByRole('region', { name: 'Next runs' }).locator('time');
        await expect.poll(() => freshRuns.evaluateAll((els) => els.map((el) => el.getAttribute('datetime')))).toEqual(times);
        await expect(p.getByRole('region', { name: 'Description' }).locator('p')).toHaveText(description);
        expect(fresh.errors).toEqual([]);
        await fresh.context.close();
    });

    test('Text Diff: both texts and every option come back, including Compare as JSON', async ({ page, browser }) => {
        await page.goto('/diff');
        const oldText = '{\n\t"b": [1, 2],\n\t"a": "x"   \n}\n';
        const newText = '{"a": "y", "b": [1, 2], "c": null}';
        await page.getByLabel('Original', { exact: true }).fill(oldText);
        await page.getByLabel('Changed', { exact: true }).fill(newText);
        await page.getByRole('button', { name: 'Side by side' }).click();
        await page.getByLabel('Ignore whitespace').check();
        await page.getByLabel('Ignore line endings').uncheck();
        await page.getByLabel('Ignore final newline').uncheck();
        await page.getByLabel('Compare as JSON (ignore key order and formatting)').check();
        const result = page.getByRole('region', { name: 'Result' });
        // "a" changed and "c" was added: two lines removed, three added in the formatted JSON
        await expect(result.getByText('+3 added')).toBeVisible();
        await expect(result.getByText('−2 removed')).toBeVisible();
        const view = await result.innerText();

        const fresh = await openFresh(browser, await copyShareLink(page, '/diff'));
        const p = fresh.page;
        await expect(p.getByLabel('Original', { exact: true })).toHaveValue(oldText);
        await expect(p.getByLabel('Changed', { exact: true })).toHaveValue(newText);
        await expect(p.getByRole('button', { name: 'Side by side' })).toHaveAttribute('aria-pressed', 'true');
        await expect(p.getByLabel('Ignore whitespace')).toBeChecked();
        await expect(p.getByLabel('Ignore line endings')).not.toBeChecked();
        await expect(p.getByLabel('Ignore final newline')).not.toBeChecked();
        await expect(p.getByLabel('Compare as JSON (ignore key order and formatting)')).toBeChecked();
        await expect(p.getByRole('region', { name: 'Result' }).getByText('+3 added')).toBeVisible();
        expect(await p.getByRole('region', { name: 'Result' }).innerText()).toBe(view);
        expect(fresh.errors).toEqual([]);
        await fresh.context.close();
    });

    test('Data Converter: input, formats and options come back', async ({ page, browser }) => {
        await page.goto('/converter');
        const input = '<config>\n  <port>8080</port>\n  <debug>true</debug>\n  <name>svc &amp; co</name>\n</config>';
        await page.getByLabel('From', { exact: true }).selectOption('xml');
        await page.getByLabel('To', { exact: true }).selectOption('yaml');
        await page.getByRole('combobox', { name: /Indent/ }).selectOption('4');
        await page.getByLabel('Detect numbers and booleans').uncheck();
        await page.getByLabel('XML input').fill(input);
        const output = page.getByRole('region', { name: 'Output' }).locator('pre');
        // Without detection, 8080 and true stay strings; 4-space indent
        await expect(output).toHaveText("config:\n    port: '8080'\n    debug: 'true'\n    name: svc & co", { useInnerText: true });

        const fresh = await openFresh(browser, await copyShareLink(page, '/converter'));
        const p = fresh.page;
        await expect(p.getByLabel('From', { exact: true })).toHaveValue('xml');
        await expect(p.getByLabel('To', { exact: true })).toHaveValue('yaml');
        await expect(p.getByRole('combobox', { name: /Indent/ })).toHaveValue('4');
        await expect(p.getByLabel('Detect numbers and booleans')).not.toBeChecked();
        await expect(p.getByLabel('XML input')).toHaveValue(input);
        await expect(p.getByRole('region', { name: 'Output' }).locator('pre')).toHaveText("config:\n    port: '8080'\n    debug: 'true'\n    name: svc & co", { useInnerText: true });
        expect(fresh.errors).toEqual([]);
        await fresh.context.close();
    });

    test('A damaged link shows an error and leaves the tool usable', async ({ page }) => {
        await page.goto('/regex');
        await page.getByLabel('Regular expression').fill('abc');
        const url = await copyShareLink(page, '/regex');

        for (const broken of [url.slice(0, -6), `${origin()}/regex#s=AAAAthis-is-not-a-real-link`]) {
            await page.goto('about:blank');
            await page.goto(broken);
            await expect(page.getByText('Couldn’t open the shared link. This link is damaged or incomplete.')).toBeVisible();
            await expect(page).toHaveURL(`${origin()}/regex`);
            await expect(page.getByLabel('Regular expression')).toHaveValue(DEFAULT_PATTERN);
            await expect(page.getByLabel('Test text')).toHaveValue(DEFAULT_TEXT);
        }
        // Still works
        await page.getByLabel('Regular expression').fill('is');
        await expect(page.getByRole('heading', { name: 'Match Details (2)' })).toBeVisible();
    });

    test('A link made for another tool is refused', async ({ page }) => {
        await page.goto('/cron');
        await page.getByLabel('Cron expression').fill('0 0 * * *');
        const url = await copyShareLink(page, '/cron');
        await page.goto('about:blank');
        await page.goto(`/regex${url.slice(url.indexOf('#'))}`);
        await expect(page.getByText('Couldn’t open the shared link. This link was made for a different tool.')).toBeVisible();
        await expect(page).toHaveURL(`${origin()}/regex`);
        await expect(page.getByLabel('Regular expression')).toHaveValue(DEFAULT_PATTERN);
        await expect(page.getByLabel('Test text')).toHaveValue(DEFAULT_TEXT);
    });

    test('Hand-edited links: invalid values are skipped, and a link with nothing usable is refused', async ({ page }) => {
        await page.goto('/regex');
        const partial = await makeLink(page, '/regex', { pattern: 'o+', flags: 'g i', text: ['not', 'text'], mode: 'sideways', replacement: 42, extra: true });
        await page.goto('about:blank');
        await page.goto(partial);
        await expect(page.getByText('Some values in the link weren’t valid, so they were left as they were: flags, text, mode, replacement.')).toBeVisible();
        await expect(page.getByLabel('Regular expression')).toHaveValue('o+');
        await expect(page.getByRole('textbox', { name: 'Flags' })).toHaveValue('g');
        await expect(page.getByLabel('Test text')).toHaveValue(DEFAULT_TEXT);
        await expect(page.getByRole('group', { name: 'Mode' }).getByRole('button', { name: 'Match' })).toHaveAttribute('aria-pressed', 'true');
        // "Hello World, this is a Vibe Check." has o, o: two runs of o
        await expect(page.getByRole('heading', { name: 'Match Details (2)' })).toBeVisible();

        const useless = await makeLink(page, '/regex', { mode: 'nope', unknown: 'x' });
        await page.goto('about:blank');
        await page.goto(useless);
        await expect(page.getByText('Couldn’t open the shared link. It doesn’t contain anything this tool can use.')).toBeVisible();
        await expect(page.getByText('Opened a shared link.')).toHaveCount(0);
        await expect(page.getByLabel('Regular expression')).toHaveValue(DEFAULT_PATTERN);
    });

    test('The Share button is disabled when there is nothing to share', async ({ page }) => {
        await page.goto('/diff');
        await expect(page.getByRole('button', { name: 'Share link' })).toBeDisabled();
        await page.goto('/converter');
        await expect(page.getByRole('button', { name: 'Share link' })).toBeDisabled();
        await page.goto('/cron');
        await page.getByLabel('Cron expression').fill('');
        await expect(page.getByRole('button', { name: 'Share link' })).toBeDisabled();
    });
});

test.describe('Text Diff: Compare as JSON', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/diff');
    });

    test('ignores key order and formatting, but not values, array order or how numbers are written', async ({ page }) => {
        const original = page.getByLabel('Original', { exact: true });
        const changed = page.getByLabel('Changed', { exact: true });
        const result = page.getByRole('region', { name: 'Result' });
        const lines = result.getByRole('region', { name: /^Differences:/ });

        await original.fill('{"name":"svc","tags":["a","b"],"limits":{"cpu":1.0,"mem":512},"id":12345678901234567890}');
        await changed.fill('{\n  "id": 12345678901234567890,\n  "limits": { "mem": 512, "cpu": 1.0 },\n  "tags": [ "a", "b" ],\n  "name": "svc"\n}');
        // As plain text, everything differs
        await expect(result.getByText(/^\+\d+ added$/)).toBeVisible();

        await page.getByLabel('Compare as JSON (ignore key order and formatting)').check();
        await expect(result.getByText('No differences')).toBeVisible();
        await expect(result.getByText('Both sides hold the same JSON once key order and formatting are ignored.')).toBeVisible();
        await expect(result.getByText(/added$/)).toHaveCount(0);

        // Integers above 2^53 are compared as written: one digit is one changed line
        await changed.fill('{"id": 12345678901234567891, "limits": {"mem": 512, "cpu": 1.0}, "tags": ["a", "b"], "name": "svc"}');
        await expect(result.getByText('+1 added')).toBeVisible();
        await expect(result.getByText('−1 removed')).toBeVisible();
        await expect(lines).toContainText('"id": 12345678901234567890,');
        await expect(lines).toContainText('"id": 12345678901234567891,');
        await expect(result.getByText(/Line numbers refer to this formatted JSON/)).toBeVisible();

        // 1.0 and 1 are written differently, so they differ
        await changed.fill('{"id": 12345678901234567890, "limits": {"mem": 512, "cpu": 1}, "tags": ["a", "b"], "name": "svc"}');
        await expect(result.getByText('+1 added')).toBeVisible();
        await expect(lines).toContainText('"cpu": 1.0,');
        await expect(lines).toContainText('"cpu": 1,');

        // Array order counts
        await changed.fill('{"id": 12345678901234567890, "limits": {"mem": 512, "cpu": 1.0}, "tags": ["b", "a"], "name": "svc"}');
        await expect(result.getByText(/^\+\d+ added$/)).toBeVisible();
        await expect(result.getByText('No differences')).toHaveCount(0);

        // Download .patch uses the formatted JSON too
        const download = page.waitForEvent('download');
        await result.getByRole('button', { name: 'Download .patch' }).click();
        const patch = await (await download).createReadStream();
        let text = '';
        for await (const chunk of patch) text += chunk;
        expect(text).toContain('-    "a",\n');
        expect(text).toContain('+    "b",\n');
    });

    test('says which side isn’t valid JSON and where, then falls back to a plain diff', async ({ page }) => {
        const result = page.getByRole('region', { name: 'Result' });
        await page.getByLabel('Compare as JSON (ignore key order and formatting)').check();
        await page.getByLabel('Original', { exact: true }).fill('{"id": 1, "name": "svc"}');
        await expect(result.getByText('Paste JSON into both sides to compare it as JSON.')).toBeVisible();

        await page.getByLabel('Changed', { exact: true }).fill('{\n  "id": 1,\n  "name": "svc"\n  "tags": []\n}');
        await expect(result.getByText('The changed text isn’t valid JSON')).toBeVisible();
        await expect(result.getByText('Changed, line 4, column 3: Expected “,” or “}” but found “"”.')).toBeVisible();
        await expect(result.getByText('Showing a plain text comparison instead.')).toBeVisible();
        // The plain diff: the original's single line against the changed text's five
        await expect(result.getByText('+5 added')).toBeVisible();
        await expect(result.getByText('−1 removed')).toBeVisible();

        await page.getByLabel('Original', { exact: true }).fill("{'id': 1}");
        await expect(result.getByText('Neither side is valid JSON')).toBeVisible();
        await expect(result.getByText('Original, line 1, column 2: Property names must be in double quotes, not single quotes.')).toBeVisible();

        // Fixing both sides switches back to the JSON comparison
        await page.getByLabel('Original', { exact: true }).fill('{"id": 1, "name": "svc", "tags": []}');
        await page.getByLabel('Changed', { exact: true }).fill('{\n  "tags": [],\n  "id": 1,\n  "name": "svc"\n}');
        await expect(result.getByText('No differences')).toBeVisible();
        await expect(result.getByText(/isn’t valid JSON/)).toHaveCount(0);
    });

    for (const theme of ['light', 'dark']) {
        test(`the JSON messages pass axe checks (${theme})`, async ({ page }) => {
            await useTheme(page, theme);
            await page.reload();
            const result = page.getByRole('region', { name: 'Result' });
            const check = async () => {
                const { violations } = await new AxeBuilder({ page })
                    .include('main')
                    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
                    .analyze();
                expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
            };
            await page.getByLabel('Compare as JSON (ignore key order and formatting)').check();
            await page.getByLabel('Original', { exact: true }).fill('{"a": 1, "a": 2, "b": [1, 2]}');
            await page.getByLabel('Changed', { exact: true }).fill('{"b": [2, 1], "a": 2}');
            await expect(result.getByText('Repeated keys')).toBeVisible();
            await expect(result.getByText(/Line numbers refer to this formatted JSON/)).toBeVisible();
            await check();
            await page.getByLabel('Changed', { exact: true }).fill('{"b": [2, 1], "a": 2,}');
            await expect(result.getByText('The changed text isn’t valid JSON')).toBeVisible();
            await check();
        });
    }

    test('warns about repeated keys, which JSON can only keep once', async ({ page }) => {
        const result = page.getByRole('region', { name: 'Result' });
        await page.getByLabel('Compare as JSON (ignore key order and formatting)').check();
        await page.getByLabel('Original', { exact: true }).fill('{"a": 1, "b": 2}');
        await page.getByLabel('Changed', { exact: true }).fill('{"a": 9,\n "b": 2, "a": 1}');
        // The last "a" wins, so the documents compare equal, and the page says why
        await expect(result.getByText('No differences')).toBeVisible();
        await expect(result.getByText('Repeated keys')).toBeVisible();
        // ' "b": 2, "a": 1}': the second "a" starts in column 10
        await expect(result.getByText('Changed: “a” (line 2, column 10).')).toBeVisible();
    });
});
