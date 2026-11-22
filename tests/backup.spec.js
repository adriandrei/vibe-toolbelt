import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { useTheme } from './helpers.js';

// Settings → Your data: back up, restore and clear what the app keeps in this browser.

const SETTINGS = '/ai-settings';

const request = (token) => ({ method: 'GET', url: 'https://api.example.com/me', headers: [], bodyType: 'json', body: '', form: [], auth: { type: 'bearer', token }, options: {} });
const API_DATA = {
    'api-history': JSON.stringify([{ id: 'h-1', at: 1, status: 200, time: 5, request: request('history-token') }]),
    'api-collections': JSON.stringify([{ id: 'c-1', name: 'Me', at: 1, request: request('saved-token') }]),
    'api-envs': JSON.stringify([{ id: 'default', name: 'Default', vars: [{ key: 'token', value: 'env-token' }] }]),
    'api-active-env': JSON.stringify('default'),
};
const SENSITIVE = ['api-history', 'api-collections', 'api-envs'];

const pad = (n) => String(n).padStart(2, '0');
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const backupFile = (entries, extra = {}) => ({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'vibe-toolbelt', version: 1, exportedAt: '2026-11-01T10:00:00.000Z', entries, ...extra })),
});

function seed(page, entries) {
    return page.evaluate((e) => {
        for (const [key, value] of Object.entries(e)) localStorage.setItem(key, value);
    }, entries);
}

function stored(page) {
    return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])));
}

// Saved under its suggested name, as a browser would
async function downloadBackup(page) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download backup' }).click();
    const download = await pending;
    const name = download.suggestedFilename();
    const path = test.info().outputPath(`${Date.now()}`, name);
    await download.saveAs(path);
    return { name, path, json: JSON.parse(fs.readFileSync(path, 'utf8')) };
}

async function chooseBackup(page, file) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Choose a backup file/ }).click();
    await (await chooser).setFiles(file);
}

// Clicks a button that reloads the page and waits for the new page
async function clickAndReload(page, button) {
    await Promise.all([page.waitForEvent('load'), button.click()]);
}

async function clearAllData(page, { deleteModels = false } = {}) {
    await page.getByRole('button', { name: 'Clear all data…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clear all data?' });
    if (deleteModels) {
        const box = dialog.getByLabel('Also delete downloaded AI models');
        await expect(box).toBeEnabled();
        await box.check();
    }
    await dialog.getByLabel('To confirm, type “delete”').fill('delete');
    await clickAndReload(page, dialog.getByRole('button', { name: 'Delete all data' }));
}

test.describe('Your data', () => {
    test('a backup survives clearing everything: favourites, recents and the theme come back', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/');
        const sidebar = page.getByRole('complementary', { name: 'Tools' });
        // Use the app: star a tool, open two tools, pick a theme and an accent
        await sidebar.getByRole('link', { name: 'UUID', exact: true }).hover();
        await sidebar.getByRole('button', { name: 'Add UUID to favorites' }).click();
        for (const [path, title] of [['/regex', 'Regex Tester'], ['/cron', 'Cron Expression Parser']]) {
            await page.goto(path);
            await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
        }
        await page.goto(SETTINGS);
        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
        await page.getByRole('button', { name: 'Emerald Mint' }).click();
        // Data from tools this page has never heard of is backed up too
        await seed(page, { ...API_DATA, 'tz-zones': '["Europe/Paris","Asia/Tokyo"]', 'some-future-key': 'kept as is' });

        const before = await stored(page);
        expect(before['pt-theme']).toBe('dark');
        expect(before['pt-hue']).toBe('145');
        expect(JSON.parse(before['vibe-tools-favorites'])).toEqual(['/uuid']);
        expect(JSON.parse(before['vibe-tools-recents'])).toEqual(['/cron', '/regex']);

        const backup = await downloadBackup(page);
        expect(backup.name).toBe(`vibe-toolbelt-backup-${today()}.json`);
        expect(backup.json.app).toBe('vibe-toolbelt');
        expect(backup.json.version).toBe(1);
        expect(Math.abs(Date.parse(backup.json.exportedAt) - Date.now())).toBeLessThan(60_000);
        // Every key with its exact stored string, except the API Tester data that can hold tokens
        const expected = Object.fromEntries(Object.entries(before).filter(([key]) => !SENSITIVE.includes(key)));
        expect(backup.json.entries).toEqual(expected);
        expect(Object.keys(backup.json).sort()).toEqual(['app', 'entries', 'exportedAt', 'version']);
        const count = Object.keys(expected).length;
        await expect(page.getByText(`Backup downloaded with ${count} items. Left out: API Tester history, saved requests and environments.`)).toBeVisible();

        // Clear: the dialog lists what goes, and needs the word typed
        await page.getByRole('button', { name: 'Clear all data…' }).click();
        const dialog = page.getByRole('dialog', { name: 'Clear all data?' });
        await expect(dialog.getByRole('group', { name: 'Appearance' })).toContainText('Theme');
        await expect(dialog.getByRole('group', { name: 'Appearance' })).toContainText('Accent colour');
        await expect(dialog.getByRole('group', { name: 'Favourites & recents' })).toContainText('Favourite tools');
        await expect(dialog.getByRole('group', { name: 'API Tester' })).toContainText('Saved requests');
        await expect(dialog.getByRole('group', { name: 'Other tools' })).toContainText('Time Zones list');
        await expect(dialog.getByRole('group', { name: 'Other', exact: true })).toContainText('some-future-key');
        const remove = dialog.getByRole('button', { name: 'Delete all data' });
        const confirm = dialog.getByLabel('To confirm, type “delete”');
        await expect(remove).toBeDisabled();
        await confirm.fill('dele');
        await expect(remove).toBeDisabled();
        await confirm.fill(' DELETE ');
        await expect(remove).toBeEnabled();
        await clickAndReload(page, remove);

        await expect(page.getByText('All data was cleared from this browser.')).toBeVisible();
        expect(await stored(page)).toEqual({});
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light'); // the system theme here
        await expect(page.getByRole('complementary', { name: 'Tools' }).getByText('Favorites')).toHaveCount(0);

        // Restore the file
        await chooseBackup(page, backup.path);
        const preview = page.getByRole('dialog', { name: 'Restore this backup?' });
        await expect(preview).toContainText(`holds ${count} items`);
        await expect(preview.getByRole('radio', { name: 'Merge' })).toBeChecked();
        await expect(preview.getByText(`What changes: ${count} added`)).toBeVisible();
        await expect(preview.getByRole('group', { name: 'Favourites & recents' })).toContainText('Recently used tools');
        await expect(preview.getByRole('group', { name: 'API Tester' })).not.toContainText('Saved requests');
        await clickAndReload(page, preview.getByRole('button', { name: 'Restore', exact: true }));

        await expect(page.getByText(`Backup restored: ${count} items added.`)).toBeVisible();
        expect(await stored(page)).toEqual(expected);
        expect(await page.evaluate(() => sessionStorage.getItem('pt-data-notice'))).toBeNull();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--hue'))).toBe('145');
        await expect(page.getByRole('group', { name: 'Accent colour' }).getByRole('button', { name: 'Emerald Mint' })).toHaveAttribute('aria-pressed', 'true');
        await expect(sidebar.getByText('Favorites')).toBeVisible();
        // Listed under Favorites and in its category, starred in both
        await expect(sidebar.getByRole('button', { name: 'Remove UUID from favorites' }).first()).toBeAttached();

        // The message shows once
        await page.reload();
        await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
        await expect(page.getByText(/Backup restored/)).toHaveCount(0);

        await page.goto('/');
        const recents = page.getByRole('region', { name: 'Recently used' });
        await expect(recents).toContainText('Cron');
        await expect(recents).toContainText('Regex');
    });

    test('API Tester history, saved requests and environments are only backed up when asked', async ({ page }) => {
        await page.goto(SETTINGS);
        await seed(page, { ...API_DATA, 'pt-theme': 'dark' });
        await page.reload();

        const include = page.getByLabel('Include API Tester history, saved requests and environments (may contain tokens)');
        await expect(include).not.toBeChecked();
        await expect(page.getByText('Left out of the backup: API Tester history, saved requests and environments.')).toBeVisible();
        const plain = await downloadBackup(page);
        expect(plain.json.entries).toEqual({ 'api-active-env': '"default"', 'pt-theme': 'dark' });
        expect(JSON.stringify(plain.json)).not.toMatch(/history-token|saved-token|env-token/);
        await expect(page.getByText('Backup downloaded with 2 items. Left out: API Tester history, saved requests and environments.')).toBeVisible();

        await include.check();
        await expect(page.getByText(/^Keep the file private/)).toBeVisible();
        const full = await downloadBackup(page);
        expect(full.json.entries).toEqual({ ...API_DATA, 'pt-theme': 'dark' });
        await expect(page.getByText('Backup downloaded with 5 items.', { exact: true })).toBeVisible();
    });

    test('Merge keeps everything else; Replace all removes what the backup doesn’t have', async ({ page }) => {
        await page.goto(SETTINGS);
        await seed(page, { 'pt-theme': 'light', 'curl-target': '"python"', 'vt-formatters-prefs': '{"indent":"4"}' });
        await page.reload();
        const file = backupFile({ 'pt-theme': 'dark', 'vibe-tools-favorites': '["/uuid"]', 'curl-target': '"python"' });
        const preview = page.getByRole('dialog', { name: 'Restore this backup?' });
        const row = (key) => preview.getByRole('listitem').filter({ hasText: key });

        await chooseBackup(page, file);
        await expect(preview.getByText('What changes: 1 added · 1 replaced', { exact: true })).toBeVisible();
        await expect(row('pt-theme')).toContainText('Replaced');
        await expect(row('vibe-tools-favorites')).toContainText('Added');
        await expect(preview.getByText('1 item is already the same.')).toBeVisible();

        await preview.getByRole('radio', { name: 'Replace all' }).check();
        await expect(preview.getByText('What changes: 1 added · 1 replaced · 1 removed', { exact: true })).toBeVisible();
        await expect(row('vt-formatters-prefs')).toContainText('Removed');
        await expect(preview.getByRole('button', { name: 'Replace all data' })).toBeVisible();

        // Cancel changes nothing
        await preview.getByRole('button', { name: 'Cancel' }).click();
        await expect(preview).toHaveCount(0);
        expect(await stored(page)).toEqual({ 'pt-theme': 'light', 'curl-target': '"python"', 'vt-formatters-prefs': '{"indent":"4"}' });

        // Merge
        await chooseBackup(page, file);
        await expect(preview.getByRole('radio', { name: 'Merge' })).toBeChecked();
        await clickAndReload(page, preview.getByRole('button', { name: 'Restore', exact: true }));
        await expect(page.getByText('Backup restored: 1 item added, 1 replaced.')).toBeVisible();
        expect(await stored(page)).toEqual({ 'pt-theme': 'dark', 'vibe-tools-favorites': '["/uuid"]', 'curl-target': '"python"', 'vt-formatters-prefs': '{"indent":"4"}' });

        // Replace all
        await chooseBackup(page, file);
        await preview.getByRole('radio', { name: 'Replace all' }).check();
        await expect(preview.getByText('What changes: 1 removed', { exact: true })).toBeVisible();
        await clickAndReload(page, preview.getByRole('button', { name: 'Replace all data' }));
        await expect(page.getByText('Backup restored: 1 item removed.')).toBeVisible();
        expect(await stored(page)).toEqual({ 'pt-theme': 'dark', 'vibe-tools-favorites': '["/uuid"]', 'curl-target': '"python"' });

        // Nothing left to change
        await chooseBackup(page, file);
        await expect(preview.getByText('Nothing to change')).toBeVisible();
        await expect(preview.getByRole('button', { name: 'Restore', exact: true })).toBeDisabled();
    });

    test('files that aren’t valid backups are refused with the reason, and nothing changes', async ({ page }) => {
        await page.goto(SETTINGS);
        await seed(page, { 'pt-theme': 'light' });
        const valid = { app: 'vibe-toolbelt', version: 1, exportedAt: '2026-11-01T10:00:00.000Z', entries: {} };
        const cases = [
            ['notes.json', 'just some notes', 'The file isn’t valid JSON, so it isn’t a backup made by this app.'],
            ['empty.json', '', 'The file is empty.'],
            ['other.json', JSON.stringify({ ...valid, app: 'some-other-app' }), 'This isn’t a Vibe Toolbelt backup: it doesn’t say app: "vibe-toolbelt".'],
            ['future.json', JSON.stringify({ ...valid, version: 2 }), 'The backup was made by a newer version of the app (format 2; this one reads format 1). Reload the app to update it, then try again.'],
            ['numbers.json', JSON.stringify({ ...valid, entries: { 'pt-theme': 'dark', 'pt-hue': 145 } }), 'Every value in a backup is text, but “pt-hue” isn’t.'],
            ['foreign.json', JSON.stringify({ ...valid, entries: { 'redux-persist:root': '{}' } }), 'The backup has keys that this app doesn’t use: “redux-persist:root”.'],
            ['undated.json', JSON.stringify({ ...valid, exportedAt: 'last week' }), 'The backup’s date (exportedAt) is missing or invalid.'],
        ];
        for (const [name, content, message] of cases) {
            await chooseBackup(page, { name, mimeType: 'application/json', buffer: Buffer.from(content) });
            const alert = page.getByRole('alert').filter({ hasText: `Couldn’t restore “${name}”` });
            await expect(alert).toContainText(message);
            await expect(page.getByRole('dialog')).toHaveCount(0);
        }
        // Size is checked before the file is read
        await chooseBackup(page, { name: 'huge.json', mimeType: 'application/json', buffer: Buffer.alloc(20 * 1024 * 1024 + 1, 32) });
        await expect(page.getByRole('alert').filter({ hasText: 'Couldn’t restore “huge.json”' })).toContainText('The file is too large to be a backup (over 20 MB).');
        // A good file clears the error
        await chooseBackup(page, backupFile({ 'pt-theme': 'dark' }));
        await expect(page.getByRole('dialog', { name: 'Restore this backup?' })).toBeVisible();
        await expect(page.getByText(/Couldn’t restore/)).toHaveCount(0);
        await page.getByRole('button', { name: 'Cancel' }).click();
        expect(await stored(page)).toEqual({ 'pt-theme': 'light' });
    });

    test('clearing deletes downloaded AI models only when asked, and keeps the app’s offline files', async ({ page }) => {
        await page.goto(SETTINGS);
        const WEIGHTS = 'https://huggingface.co/mlc-ai/test-model-MLC/resolve/main/params_shard_0.bin';
        const LIBRARY = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/test-webgpu.wasm';
        const OFFLINE = `${new URL(page.url()).origin}/offline-check`;
        await page.evaluate(async ([weights, library, offline]) => {
            await (await caches.open('webllm/model')).put(weights, new Response('weights'));
            await (await caches.open('webllm/wasm')).put(library, new Response('library'));
            await (await caches.open('vt-test-offline')).put(offline, new Response('keep me'));
        }, [WEIGHTS, LIBRARY, OFFLINE]);
        const cached = (url) => page.evaluate(async (u) => (await caches.match(u))?.text() ?? null, url);

        // Left unticked, the model files stay
        await seed(page, { 'pt-theme': 'dark' });
        await clearAllData(page);
        await expect(page.getByText('All data was cleared from this browser.', { exact: true })).toBeVisible();
        expect(await stored(page)).toEqual({});
        expect(await cached(WEIGHTS)).toBe('weights');

        // Ticked, they go; other caches stay
        await seed(page, { 'pt-theme': 'dark' });
        await clearAllData(page, { deleteModels: true });
        await expect(page.getByText('All data was cleared from this browser, including the downloaded AI models.')).toBeVisible();
        expect(await stored(page)).toEqual({});
        expect(await cached(WEIGHTS)).toBeNull();
        expect(await cached(LIBRARY)).toBeNull();
        expect(await cached(OFFLINE)).toBe('keep me');

        // With nothing downloaded, the option is shown but can't be ticked
        await page.getByRole('button', { name: 'Clear all data…' }).click();
        const dialog = page.getByRole('dialog', { name: 'Clear all data?' });
        await expect(dialog.getByText('No AI model files are downloaded in this browser.')).toBeVisible();
        await expect(dialog.getByLabel('Also delete downloaded AI models')).toBeDisabled();
        await expect(dialog.getByText('Nothing is saved in this browser right now.')).toBeVisible();
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await page.evaluate(() => caches.delete('vt-test-offline'));
    });

    for (const theme of ['light', 'dark']) {
        test(`the restore and clear dialogs pass axe checks (${theme})`, async ({ page }) => {
            // Default accent, as in a11y.spec.js
            await useTheme(page, theme);
            await page.goto(SETTINGS);
            await seed(page, { ...API_DATA, 'vibe-tools-favorites': '["/uuid"]', 'mystery-key': 'x' });
            await page.reload();
            const check = async () => {
                // Wait for the dialog's fade-in: axe would measure text at partial opacity
                await page.evaluate(() => Promise.all(document.getAnimations()
                    .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
                    .map((a) => a.finished.catch(() => {}))));
                const { violations } = await new AxeBuilder({ page })
                    .include('[role="dialog"]')
                    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'])
                    .analyze();
                expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
            };

            await chooseBackup(page, backupFile({ 'pt-theme': theme === 'light' ? 'dark' : 'light', 'tz-zones': '[]' }));
            const preview = page.getByRole('dialog', { name: 'Restore this backup?' });
            await preview.getByRole('radio', { name: 'Replace all' }).check();
            await expect(preview.getByText(/removed$/)).toBeVisible();
            await check();
            await preview.getByRole('button', { name: 'Cancel' }).click();

            await page.getByRole('button', { name: 'Clear all data…' }).click();
            await expect(page.getByRole('dialog', { name: 'Clear all data?' }).getByText('No AI model files are downloaded in this browser.')).toBeVisible();
            await check();
        });
    }

    test('the summary lists what is saved, by group', async ({ page }) => {
        await page.goto(SETTINGS);
        await expect(page.getByText('Nothing yet. Settings you change and data you save in the tools show up here.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Download backup' })).toBeDisabled();
        await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
        const summary = page.getByRole('list', { name: 'Saved data by group' });
        await expect(summary).toHaveText('Appearance · 1');
        await seed(page, { ...API_DATA, 'curl-target': '"fetch"', 'zzz-unknown': '1' });
        // Picked up when the window regains focus or storage changes elsewhere
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(summary.getByRole('listitem')).toHaveText(['Appearance · 1', 'API Tester · 4', 'Other tools · 1', 'Other · 1']);
        await expect(page.getByText(/^7 items, [\d.]+ (B|KB) in all\.$/)).toBeVisible();
    });
});
