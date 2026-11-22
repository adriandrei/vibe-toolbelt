import { test, expect } from '@playwright/test';
import { SAMPLE_JWT } from './helpers.js';

// Drops files on an element the way a browser does (dragenter, dragover, drop).
// `files` are { name, type, text } or { name, type, png: true } for a small PNG.
async function dropFiles(page, selector, files) {
    await page.evaluate(async ({ selector, files }) => {
        const dt = new DataTransfer();
        for (const f of files) {
            let body = f.text ?? '';
            if (f.png) {
                const canvas = new OffscreenCanvas(4, 3);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#c33';
                ctx.fillRect(0, 0, 4, 3);
                body = await canvas.convertToBlob({ type: 'image/png' });
            }
            if (f.bytes) body = new Uint8Array(f.bytes);
            dt.items.add(new File([body], f.name, { type: f.type }));
        }
        const target = document.querySelector(selector);
        for (const type of ['dragenter', 'dragover', 'drop']) {
            target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
        }
    }, { selector, files });
}

const chooser = (page) => page.getByRole('dialog');

test.describe('Smart Drop', () => {
    test('a JSON file dropped on any page offers JSON tools and opens it in the chosen one', async ({ page }) => {
        await page.goto('/uuid');
        await expect(page.locator('main h1')).toBeVisible();
        await dropFiles(page, 'main h1', [{ name: 'config.yaml', type: '', text: 'name: demo\nitems:\n  - 1\n  - 2\n' }]);

        const dialog = chooser(page);
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole('heading')).toHaveText('Open “config.yaml” in…');
        const options = dialog.getByRole('listitem');
        await expect(options.first()).toContainText('Data Converter');
        await expect(options.first()).toContainText('Best match');
        await expect(options.first().getByRole('button')).toBeFocused();

        await options.first().getByRole('button').click();
        await expect(page).toHaveURL(/\/converter$/);
        await expect(dialog).toBeHidden();
        await expect(page.locator('main')).toContainText('"name": "demo"');
    });

    test('a text file holding a JWT goes to the JWT decoder first', async ({ page }) => {
        await page.goto('/');
        await dropFiles(page, 'main', [{ name: 'token.txt', type: 'text/plain', text: `${SAMPLE_JWT}\n` }]);
        const first = chooser(page).getByRole('listitem').first();
        await expect(first).toContainText('JWT Decoder');
        await first.getByRole('button').click();
        await expect(page).toHaveURL(/\/jwt$/);
        await expect(page.locator('main')).toContainText('John Doe');
    });

    test('images are handed to the Image Converter as files', async ({ page }) => {
        await page.goto('/');
        await dropFiles(page, 'main', [
            { name: 'dot.png', type: 'image/png', png: true },
            { name: 'second.png', type: 'image/png', png: true },
            { name: 'notes.pdf', type: 'application/pdf', text: '%PDF-1.4' },
        ]);
        const dialog = chooser(page);
        await expect(dialog.getByRole('heading')).toHaveText('Open 2 images in…');
        await expect(dialog).toContainText('1 file is of another type and won’t be opened.');
        await dialog.getByRole('button', { name: /Image Converter/ }).click();
        await expect(page).toHaveURL(/\/image$/);
        await expect(page.locator('main')).toContainText('dot.png');
        await expect(page.locator('main')).toContainText('second.png');
    });

    test('binary files go to the Hex Viewer, and Escape closes the chooser', async ({ page }) => {
        await page.goto('/');
        await dropFiles(page, 'main', [{ name: 'blob.bin', type: 'application/octet-stream', bytes: [0, 1, 2, 3, 0xde, 0xad, 0xbe, 0xef] }]);
        await expect(chooser(page).getByRole('listitem').first()).toContainText('Hex Viewer');
        // The dialog is ready for keys once it has moved focus to the best match
        await expect(chooser(page).getByRole('listitem').first().getByRole('button')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(chooser(page)).toBeHidden();

        await dropFiles(page, 'main', [{ name: 'blob.bin', type: 'application/octet-stream', bytes: [0, 1, 2, 3, 0xde, 0xad, 0xbe, 0xef] }]);
        await chooser(page).getByRole('button', { name: /Hex Viewer/ }).click();
        await expect(page).toHaveURL(/\/hex$/);
        await expect(page.locator('main')).toContainText('blob.bin');
        await expect(page.locator('main')).toContainText(/de\s*ad\s*be\s*ef/i);
    });

    test('drops on a page’s own drop zone are left to the page', async ({ page }) => {
        await page.goto('/hash');
        await page.getByRole('button', { name: 'File', exact: true }).click();
        await expect(page.locator('.drop-zone')).toBeVisible();
        await dropFiles(page, '.drop-zone', [{ name: 'abc.txt', type: 'text/plain', text: 'abc' }]);
        await expect(chooser(page)).toHaveCount(0);
        // SHA-256 of "abc"
        await expect(page.locator('main')).toContainText('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });
});

test.describe('Installed app', () => {
    test('“Open with” (launchQueue) offers the tools for the opened file', async ({ page }) => {
        // Chromium has a real (read-only) launchQueue; replace it with a fake one
        await page.addInitScript(() => {
            Object.defineProperty(window, 'launchQueue', {
                configurable: true,
                value: { setConsumer(consumer) { window.__launchConsumer = consumer; } },
            });
        });
        await page.goto('/');
        await expect(page.locator('main h1')).toBeVisible();
        await page.waitForFunction(() => typeof window.__launchConsumer === 'function');
        await page.evaluate(async () => {
            const file = new File(['name,qty\npen,2\n'], 'order.csv', { type: 'text/csv' });
            await window.__launchConsumer({ files: [{ getFile: async () => file }] });
        });
        const first = chooser(page).getByRole('listitem').first();
        await expect(first).toContainText('CSV ↔ JSON');
        await first.getByRole('button').click();
        await expect(page).toHaveURL(/\/csv-json$/);
        await expect(page.locator('main')).toContainText('"qty"');
    });

    test('files shared to the app are picked up from the share-target cache', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(async () => {
            const cache = await caches.open('share-target');
            await cache.put('/share-target/file-0', new Response('{"shared": true}', { headers: { 'content-type': 'application/json' } }));
            await cache.put('/share-target/manifest.json', new Response(JSON.stringify({
                title: '', text: '', url: '',
                files: [{ key: '/share-target/file-0', name: 'shared.json', type: 'application/json' }],
            })));
        });
        await page.goto('/?share-target=1');
        await expect(chooser(page).getByRole('heading')).toHaveText('Open “shared.json” in…');
        await expect(page).toHaveURL(/\/$/);
        expect(await page.evaluate(() => caches.has('share-target'))).toBe(false);
    });

    test('shared text is offered to the tool that recognises it', async ({ page }) => {
        await page.goto('/');
        await page.evaluate(async (jwt) => {
            const cache = await caches.open('share-target');
            await cache.put('/share-target/manifest.json', new Response(JSON.stringify({ title: '', text: jwt, url: '', files: [] })));
        }, SAMPLE_JWT);
        await page.goto('/?share-target=1');
        const dialog = chooser(page);
        await expect(dialog.getByRole('heading')).toHaveText('Open the shared text in…');
        await expect(dialog.getByRole('listitem').first()).toContainText('JWT Decoder');
        await dialog.getByRole('listitem').first().getByRole('button').click();
        await expect(page).toHaveURL(/\/jwt$/);
        await expect(page.locator('main')).toContainText('John Doe');
    });
});
