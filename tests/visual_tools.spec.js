import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Visual Tools', () => {

    test('Triangle Generator updates CSS', async ({ page }) => {
        await page.goto('/triangle');

        const cssOutput = page.locator('pre');

        // Default check (direction top, color #10b981)
        await expect(cssOutput).toContainText('border-bottom: 100px solid #10b981');

        // Change Direction to Bottom
        await page.getByRole('button', { name: 'bottom' }).click();
        await expect(cssOutput).toContainText('border-top: 100px solid #10b981');

        // Change Color
        // Target specifically the text input inside main content to avoid sidebar/search inputs
        const colorInput = page.getByRole('main').locator('input[type="text"]');

        // Check initial value
        await expect(colorInput).toHaveValue('#10b981');

        // Clear and type explicitly
        await colorInput.clear();
        await colorInput.pressSequentially('#ff0000', { delay: 100 });

        // Verify input actually took the value
        await expect(colorInput).toHaveValue('#ff0000');

        // Verify output matches
        await expect(cssOutput).toContainText('#ff0000');
    });

    test('Color Blindness Simulator loads and switches filters', async ({ page }) => {
        await page.goto('/color-blindness');

        // Check title
        await expect(page.getByRole('heading', { name: 'Color Blindness Simulator' })).toBeVisible();

        // Check filter buttons exist
        const filters = ['normal', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'];
        for (const f of filters) {
            await expect(page.getByRole('button', { name: f })).toBeVisible();
        }

        await page.getByRole('button', { name: 'protanopia' }).click();
    });

    test('SVG Compressor compresses input', async ({ page }) => {
        await page.goto('/svg');

        const rawSvg = `
        <svg width="100" height="100">
            <!-- Comment -->
            <rect x="10" y="10" width="30" height="30"/>
        </svg>
        `;

        await page.getByPlaceholder('Paste your <svg> code here...').fill(rawSvg);

        // Click Compress
        await page.getByRole('button', { name: 'Compress' }).click();

        const output = page.locator('textarea[readonly]');
        await expect(output).not.toBeEmpty();

        const val = await output.inputValue();
        // Should not have newlines or comments
        expect(val).not.toContain('\n');
        expect(val).not.toContain('<!-- Comment -->');
        expect(val).toContain('<rect x="10"');

        // Check for stats
        await expect(page.getByText(/Saved/)).toBeVisible();
    });

});
