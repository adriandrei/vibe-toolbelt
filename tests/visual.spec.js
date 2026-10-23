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
        // Optimizes live as you type
        await page.getByPlaceholder(/Paste your/).fill('<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>');
        await expect(page.getByLabel('Optimized')).not.toHaveValue('');
    });

    test('SVG Compressor reduces size', async ({ page }) => {
        await page.goto('/svg');

        const verboseSVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <rect\n    width="100"\n    height="100" />\n  <!-- comment -->\n</svg>';
        await page.getByPlaceholder(/Paste your/).fill(verboseSVG);

        const output = page.getByLabel('Optimized');
        await expect(output).not.toHaveValue('');
        const value = await output.inputValue();
        expect(value.length).toBeLessThan(verboseSVG.length);
        expect(value).not.toContain('comment');
        expect(value).toContain('viewBox="0 0 100 100"');
        // Still a valid SVG (attributes not glued together)
        expect(value).toMatch(/<rect width="100" height="100"\s*\/>/);
    });

});
