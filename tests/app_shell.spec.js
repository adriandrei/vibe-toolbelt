import { test, expect } from '@playwright/test';
import { useTheme } from './helpers.js';

// Replaces a page module with one that throws while rendering.
async function makePageCrash(page, file) {
    await page.route(`**/src/pages/${file}.jsx*`, (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: 'export default function Broken() { throw new Error("Simulated crash") }',
        })
    );
}

test.describe('Error isolation', () => {
    test('A crashing page does not follow you to the next page', async ({ page }) => {
        await makePageCrash(page, 'Lorem');
        await page.goto('/lorem');
        await expect(page.getByText('Something went wrong')).toBeVisible();
        await page.getByRole('complementary', { name: 'Tools' }).getByRole('link', { name: 'UUID', exact: true }).click();
        await expect(page).toHaveURL('/uuid');
        await expect(page.getByText('Something went wrong')).toHaveCount(0);
        await expect(page.locator('main h1').first()).toBeVisible();
    });

    test('A crash in the pinned pane stays in the pinned pane', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await makePageCrash(page, 'Lorem');
        await page.addInitScript(() => localStorage.setItem('pt-pinned-tool', JSON.stringify('/lorem')));
        await page.goto('/uuid');
        const pinned = page.getByRole('complementary', { name: /Pinned tool/ });
        await expect(pinned).toContainText('Something went wrong');
        await expect(page.locator('.pane-main h1').first()).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Tools' })).toBeVisible();
    });
});

test.describe('Theme', () => {
    test('Follows the system theme until the user picks one, then remembers it', async ({ browser }) => {
        const context = await browser.newContext({ colorScheme: 'light' });
        const page = await context.newPage();
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

        await page.getByRole('button', { name: /Switch to dark mode/ }).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await page.reload();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
        await context.close();
    });

    test('The saved theme is applied before the app renders (no flash)', async ({ page }) => {
        await useTheme(page, 'light');
        await page.goto('/', { waitUntil: 'commit' });
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    });

    // The six presets plus the hues hardest to make readable (any hue can be picked)
    for (const hue of [250, 145, 35, 340, 200, 280, 21, 208, 231, 274]) {
        for (const theme of ['dark', 'light']) {
            test(`Text on accent buttons is readable (hue ${hue}, ${theme})`, async ({ page }) => {
                await useTheme(page, theme, hue);
                await page.goto('/');
                const ratio = await page.evaluate(() => {
                    const probe = (v) => {
                        const el = document.createElement('span');
                        el.style.color = `var(${v})`;
                        document.body.appendChild(el);
                        const c = getComputedStyle(el).color.match(/\d+(\.\d+)?/g).map(Number);
                        el.remove();
                        return c;
                    };
                    const lum = ([r, g, b]) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
                    const pair = (a, b) => { const x = lum(probe(a)); const y = lum(probe(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
                    return { onPrimary: pair('--on-primary', '--primary'), accentText: pair('--primary-text', '--bg-panel') };
                });
                expect(ratio.onPrimary).toBeGreaterThanOrEqual(4.5);
                expect(ratio.accentText).toBeGreaterThanOrEqual(4.5);
            });
        }
    }
});

test.describe('Pipeline and split view', () => {
    test('Text sent to the pipeline can be used by another tool', async ({ page }) => {
        await page.goto('/base64');
        await page.locator('main textarea').first().fill('hello');
        await page.getByRole('button', { name: /Send to pipeline/i }).click();
        await expect(page.getByRole('button', { name: /Pipeline/ })).toBeVisible();

        await page.getByRole('complementary', { name: 'Tools' }).getByRole('link', { name: 'Hash Generator' }).click();
        await page.getByRole('button', { name: /Use pipeline/i }).click();
        await expect(page.locator('main textarea').first()).toHaveValue('aGVsbG8=');
    });

    test('A pinned tool opens beside the page without taking over its title, and stays pinned after reload', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/base64');
        await expect(page.locator('main h1').first()).toBeVisible();
        await expect(page).toHaveTitle(/Base64/);
        const title = await page.title();
        const sidebar = page.getByRole('complementary', { name: 'Tools' });
        await sidebar.getByRole('link', { name: 'JWT Decoder' }).hover();
        await sidebar.getByRole('button', { name: 'Pin JWT Decoder to split view' }).click();

        const pinned = page.getByRole('complementary', { name: /Pinned tool: JWT Decoder/ });
        await expect(pinned).toBeVisible();
        await expect(pinned.locator('h1')).toBeVisible();
        await expect(page).toHaveTitle(title);

        await page.reload();
        await expect(page.getByRole('complementary', { name: /Pinned tool: JWT Decoder/ })).toBeVisible();
        await page.getByRole('button', { name: 'Unpin tool' }).click();
        await expect(page.getByRole('complementary', { name: /Pinned tool/ })).toHaveCount(0);
    });
});

test.describe('Favorites', () => {
    test('Starring a tool adds it to the sidebar favorites and keeps it after reload', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto('/');
        const sidebar = page.getByRole('complementary', { name: 'Tools' });
        await sidebar.getByRole('link', { name: 'UUID', exact: true }).hover();
        await sidebar.getByRole('button', { name: 'Add UUID to favorites' }).click();
        await expect(sidebar.getByText('Favorites')).toBeVisible();
        await page.reload();
        await expect(page.getByRole('complementary', { name: 'Tools' }).getByText('Favorites')).toBeVisible();
    });
});

test.describe('Mobile shell', () => {
    test.use({ viewport: { width: 375, height: 740 } });

    test('Menu opens and closes the sidebar; the header fits the screen', async ({ page }) => {
        await page.goto('/');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
        await page.getByRole('button', { name: 'Open menu' }).click();
        const close = page.getByRole('button', { name: 'Close menu' });
        await expect(close).toBeVisible();
        await close.click();
        await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
    });
});
