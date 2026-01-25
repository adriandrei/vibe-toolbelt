import { test, expect } from '@playwright/test';

test.describe('Text Tools', () => {

    test('Secure Diff comparison', async ({ page }) => {
        await page.goto('/diff');

        const oldText = 'foo';
        const newText = 'bar';

        await page.locator('textarea').first().fill(oldText);
        await page.locator('textarea').nth(1).fill(newText);

        const result = page.locator('pre');
        await expect(result).toBeVisible();
        await expect(result).toContainText('foo');
        await expect(result).toContainText('bar');
    });

    test('Markdown Editor renders preview', async ({ page }) => {
        await page.goto('/markdown');

        const md = '# Heading 1\n**Bold Text**';
        await page.locator('textarea').fill(md);

        // Preview is in .markdown-body
        const preview = page.locator('.markdown-body');
        await expect(preview.locator('h1')).toHaveText('Heading 1');
        await expect(preview.locator('strong')).toHaveText('Bold Text');
    });

    test('Formatters formats JSON', async ({ page }) => {
        await page.goto('/formatters');

        const uglyJson = '{"foo":"bar"}';
        await page.locator('textarea').first().fill(uglyJson);
        await page.getByRole('button', { name: 'Format JSON' }).click();

        const output = page.locator('textarea[readonly]');
        const val = await output.inputValue();
        expect(val).toContain('"foo": "bar"');
        expect(val).toContain('\n'); // Should be multi-line
    });

    test('Lorem Ipsum generates text', async ({ page }) => {
        await page.goto('/lorem');
        // Text is generated on mount, check that output div has content
        const output = page.locator('.glass-panel').last().locator('div').first();
        const text = await output.textContent();
        expect(text.length).toBeGreaterThan(10);
    });

    test('Cron Parser shows schedule', async ({ page }) => {
        await page.goto('/cron');
        // Default is '*/5 * * * *' which shows human description
        await expect(page.getByText(/Every 5 minutes/i)).toBeVisible();
    });

});
