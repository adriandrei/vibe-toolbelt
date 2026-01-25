import { test, expect } from '@playwright/test';

test.describe('Visual Tools', () => {

    test('Color Blindness Simulator loads', async ({ page }) => {
        await page.goto('/color-blindness');
        // Check for key elements since upload is hard to test
        await expect(page.getByText('Protanopia')).toBeVisible();
        await expect(page.getByText('Deuteranopia')).toBeVisible();
        await expect(page.locator('input[type="file"]')).toBeAttached();
    });

    test('Triangle Generator generates CSS', async ({ page }) => {
        await page.goto('/triangle');

        // Should show CSS output code immediately or after interaction
        const code = page.locator('pre');
        await expect(code).toContainText('border-left');
        await expect(code).toContainText('border-right');
        await expect(code).toContainText('border-bottom');
    });

    test('SVG Compressor loads', async ({ page }) => {
        await page.goto('/svg');
        await expect(page.getByText('Input SVG')).toBeVisible();
        // Basic interaction
        await page.getByPlaceholder(/Paste your/).fill('<svg><rect /></svg>');
        await page.getByRole('button', { name: 'Compress' }).click();
        // Expect stats to appear
        await expect(page.getByText(/Saved/)).toBeVisible();
    });

});
