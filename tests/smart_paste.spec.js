import { test, expect } from '@playwright/test';
import { pasteOnPage, SAMPLE_JWT } from './helpers.js';

test.describe('Smart Paste', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('main h1').first()).toBeVisible();
    });

    test('Base64 opens the decoder with the decoded text', async ({ page }) => {
        await pasteOnPage(page, 'SGVsbG8gV29ybGQ=');
        const toast = page.locator('.smart-toast');
        await expect(toast).toBeVisible();
        await expect(toast).toContainText(/Base64/);
        await toast.getByRole('button', { name: /Open/ }).click();
        await expect(page).toHaveURL('/base64');
        await expect(page.locator('main')).toContainText('Hello World');
    });

    test('JSON suggests the formatter', async ({ page }) => {
        await pasteOnPage(page, '{"foo":"bar"}');
        const toast = page.locator('.smart-toast');
        await expect(toast).toContainText(/JSON/);
        await toast.getByRole('button', { name: /Open/ }).click();
        await expect(page).toHaveURL('/formatters');
    });

    test('JWT opens the decoder and decodes it', async ({ page }) => {
        await pasteOnPage(page, SAMPLE_JWT);
        const toast = page.locator('.smart-toast');
        await expect(toast).toContainText(/JSON Web Token/);
        await toast.getByRole('button', { name: /Open/ }).click();
        await expect(page).toHaveURL('/jwt');
        await expect(page.locator('main')).toContainText('John Doe');
    });

    test('A 10-digit Unix timestamp goes to the timestamp converter, not Base64', async ({ page }) => {
        await pasteOnPage(page, '1700000000');
        const toast = page.locator('.smart-toast');
        await expect(toast).toContainText(/Unix timestamp/);
        await toast.getByRole('button', { name: /Open/ }).click();
        await expect(page).toHaveURL('/unix');
        await expect(page.locator('main')).toContainText('2023-11-14');
    });

    test('Ordinary words are not intercepted', async ({ page }) => {
        await pasteOnPage(page, 'password123');
        await page.waitForTimeout(400);
        await expect(page.locator('.smart-toast')).toHaveCount(0);
    });

    test('Pasting into a text field is left alone', async ({ page }) => {
        const search = page.getByRole('searchbox', { name: 'Search tools' });
        await search.focus();
        await page.evaluate((jwt) => {
            const data = new DataTransfer();
            data.setData('text/plain', jwt);
            document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, SAMPLE_JWT);
        await page.waitForTimeout(400);
        await expect(page.locator('.smart-toast')).toHaveCount(0);
    });

    test('Escape dismisses the suggestion', async ({ page }) => {
        await pasteOnPage(page, '{"a":1}');
        await expect(page.locator('.smart-toast')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('.smart-toast')).toHaveCount(0);
    });
});
