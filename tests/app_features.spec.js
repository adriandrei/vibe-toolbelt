import { test, expect } from '@playwright/test';

test.describe('Recently used tools', () => {
    test('Home and the palette list the tools you opened, newest first', async ({ page }) => {
        await page.goto('/jwt');
        await expect(page.locator('main h1').first()).toBeVisible();
        await page.goto('/hash');
        await expect(page.locator('main h1').first()).toBeVisible();

        await page.goto('/');
        const recent = page.getByRole('region', { name: 'Recently used' });
        await expect(recent.getByRole('link')).toHaveCount(2);
        await expect(recent.getByRole('link').first()).toContainText('Hash');
        await expect(recent.getByRole('link').nth(1)).toContainText('JWT');

        await page.keyboard.press('Control+k');
        const first = page.getByRole('dialog', { name: 'Search tools' }).getByRole('option').first();
        await expect(first).toContainText('Hash');
        await expect(first).toContainText('Recent');
    });
});

test.describe('API Tester history', () => {
    const SECRET_KEY = 'supersecret123';
    const TOKEN = 'tok_live_abc123';

    test.beforeEach(async ({ page }) => {
        await page.route('https://api.example.test/**', (route) => {
            const cors = {
                'access-control-allow-origin': '*',
                'access-control-allow-headers': 'authorization, content-type',
                'access-control-allow-methods': 'GET, POST, OPTIONS',
            };
            if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
            return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: '{"ok":true}' });
        });
        await page.goto('/api-tester');
        await expect(page.locator('main h1').first()).toBeVisible();
    });

    async function sendWithSecrets(page) {
        await page.getByLabel('URL', { exact: true }).fill(`https://api.example.test/items?api_key=${SECRET_KEY}&lang=en`);
        await page.getByRole('group', { name: 'Request section' }).getByRole('button', { name: /^Auth/ }).click();
        await page.getByRole('group', { name: 'Authorization type' }).getByRole('button', { name: 'Bearer token' }).click();
        await page.getByLabel('Token').fill(TOKEN);
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.getByRole('button', { name: /^History \(1\)/ })).toBeVisible();
    }

    const storedHistory = (page) => page.evaluate(() => localStorage.getItem('api-history') || '');

    test('Leaves tokens and API keys out of history by default', async ({ page }) => {
        await sendWithSecrets(page);
        const stored = await storedHistory(page);
        expect(stored).toContain('lang=en');
        expect(stored).toContain('api_key=');
        expect(stored).not.toContain(SECRET_KEY);
        expect(stored).not.toContain(TOKEN);

        await page.getByTitle(/^Load GET https:\/\/api\.example\.test/).click();
        await expect(page.getByText('Tokens, passwords and keys aren’t kept in history')).toBeVisible();
    });

    test('Keeps them when "Keep secrets in history" is ticked', async ({ page }) => {
        await page.getByLabel('Keep secrets in history').check();
        await sendWithSecrets(page);
        const stored = await storedHistory(page);
        expect(stored).toContain(SECRET_KEY);
        expect(stored).toContain(TOKEN);
    });
});

test.describe('Large JSON integers stay exact', () => {
    const BIG = '12345678901234567890';

    test('Formatters keeps them (and every number as written)', async ({ page }) => {
        await page.goto('/formatters');
        await page.waitForSelector('.monaco-editor');
        await page.evaluate((val) => window.monaco?.editor?.getModels()?.[0]?.setValue(val), `{"id":${BIG},"price":1.0}`);
        await page.getByRole('button', { name: 'Format', exact: true }).click();
        await expect.poll(() => page.evaluate(() => window.monaco?.editor?.getModels()?.[1]?.getValue()))
            .toBe(`{\n  "id": ${BIG},\n  "price": 1.0\n}`);
    });

    test('Data Converter keeps them from JSON to YAML', async ({ page }) => {
        await page.goto('/converter');
        await page.getByPlaceholder('Paste JSON here...').fill(`{"id": ${BIG}}`);
        await expect(page.locator('main pre').first()).toContainText(`id: ${BIG}`);
    });
});
