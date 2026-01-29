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

    // Skipped: Formatters tests need updating after JMESPath migration
    test.skip('Formatters formats JSON', async ({ page }) => {
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
        // Text is generated on mount - find the output div with pre-wrap styling
        const output = page.locator('div[style*="pre-wrap"]');
        const text = await output.textContent();
        expect(text.length).toBeGreaterThan(10);
    });

    test('Cron Parser shows schedule', async ({ page }) => {
        await page.goto('/cron');
        // Default is '*/5 * * * *' which shows human description
        await expect(page.getByText(/Every 5 minutes/i)).toBeVisible();
    });

    // Skipped: Formatters tests need updating after JMESPath migration
    test.skip('Formatters handles SQL formatting', async ({ page }) => {
        await page.goto('/formatters');

        // Switch to SQL mode
        await page.getByRole('button', { name: 'SQL' }).click();

        const messySQL = 'select * from users where id=1';
        await page.locator('textarea').first().fill(messySQL);
        await page.getByRole('button', { name: 'Format SQL' }).click();

        const formatted = await page.locator('textarea[readonly]').inputValue();
        expect(formatted).toContain('SELECT'); // Should uppercase keywords
        expect(formatted).toContain('\n'); // Should have line breaks
    });

    // Skipped: Formatters tests need updating after JMESPath migration
    test.skip('Formatters switches between modes', async ({ page }) => {
        await page.goto('/formatters');

        // Start with JSON
        await expect(page.getByPlaceholder(/JSON/i)).toBeVisible();

        // Switch to SQL
        await page.getByRole('button', { name: 'SQL' }).click();
        await expect(page.getByPlaceholder(/SQL/i)).toBeVisible();

        // Switch back to JSON
        await page.getByRole('button', { name: 'JSON' }).click();
        await expect(page.getByPlaceholder(/JSON/i)).toBeVisible();
    });

    test('Markdown renders code blocks', async ({ page }) => {
        await page.goto('/markdown');

        const md = '```javascript\nconst x = 1;\n```';
        await page.locator('textarea').fill(md);

        const preview = page.locator('.markdown-body');
        await expect(preview.locator('pre')).toBeVisible();
        await expect(preview.locator('code')).toContainText('const x = 1');
    });

    test('Markdown renders lists and links', async ({ page }) => {
        await page.goto('/markdown');

        const md = '- Item 1\n- Item 2\n\n[Link](https://example.com)';
        await page.locator('textarea').fill(md);

        const preview = page.locator('.markdown-body');
        await expect(preview.locator('li')).toHaveCount(2);
        await expect(preview.locator('a')).toHaveAttribute('href', 'https://example.com');
    });

});
