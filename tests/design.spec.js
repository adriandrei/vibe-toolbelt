import { test, expect } from '@playwright/test';

test.describe('Design Tools', () => {

    test('Glass Generator generates CSS', async ({ page }) => {
        await page.goto('/css');

        // Check defaults
        const codeBlock = page.locator('pre');
        await expect(codeBlock).toContainText('backdrop-filter: blur(12px)');
        await expect(codeBlock).toContainText('rgba(255, 255, 255, 0.2)');

        // Change Blur
        // range input is tricky to label, but we can try locator by type and proximity
        const blurInput = page.locator('input[type="range"]').first();
        await blurInput.fill('20');

        await expect(codeBlock).toContainText('backdrop-filter: blur(20px)');
    });

    test('Gradient Generator creates gradient string', async ({ page }) => {
        await page.goto('/gradient');

        const codeBlock = page.locator('code');
        await expect(codeBlock).toContainText('linear-gradient(45deg, #6366f1, #a855f7)');

        // Change angle
        await page.getByText('Angle').locator('..').locator('input').fill('90');
        await expect(codeBlock).toContainText('linear-gradient(90deg');
    });

    test('Box Shadow Generator updates shadow', async ({ page }) => {
        await page.goto('/box-shadow');

        const codeBlock = page.locator('code');
        // Default shadow
        await expect(codeBlock).toContainText('0px 10px 15px -3px rgba(0, 0, 0, 0.1)');

        // Add Layer
        await page.getByText('+ Add Layer').click();

        // Should now have two layers (comma separated)
        const text = await codeBlock.textContent();
        expect(text.split(',').length).toBeGreaterThan(1);
    });

});
