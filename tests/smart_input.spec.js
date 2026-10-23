import { test, expect } from '@playwright/test';
import { SAMPLE_JWT } from './helpers.js';

const palette = (page) => page.getByRole('dialog', { name: 'Search tools' });
const paletteInput = (page) => palette(page).getByRole('combobox');

test.describe('Command palette', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('main h1').first()).toBeVisible();
    });

    test('Ctrl+K opens it with the input focused, so typing right away works', async ({ page }) => {
        await page.keyboard.press('Control+k');
        await page.keyboard.type('base');
        await expect(paletteInput(page)).toHaveValue('base');
    });

    test('The header search button opens it', async ({ page }) => {
        await page.getByRole('button', { name: 'Search tools' }).click();
        await expect(palette(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(palette(page)).toHaveCount(0);
    });

    test('Picking a tool by name does not paste the search text into it', async ({ page }) => {
        await page.keyboard.press('Control+k');
        await page.keyboard.type('jwt');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/jwt');
        const field = page.locator('main textarea').first();
        await expect(field).toHaveValue('');
    });

    test('Results are ranked: "hash" opens Hash Generator first', async ({ page }) => {
        await page.keyboard.press('Control+k');
        await page.keyboard.type('hash');
        await expect(palette(page).getByRole('option').first()).toContainText('Hash Generator');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/hash');
    });

    test('A pasted JWT offers to open it in the JWT decoder', async ({ page }) => {
        await page.keyboard.press('Control+k');
        await paletteInput(page).fill(SAMPLE_JWT);
        await expect(palette(page).getByRole('option').first()).toContainText('Open as JSON Web Token');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/jwt');
        await expect(page.locator('main')).toContainText('John Doe');
    });

    test('Arrow keys keep the highlighted option in view', async ({ page }) => {
        await page.keyboard.press('Control+k');
        for (let i = 0; i < 25; i++) await page.keyboard.press('ArrowDown');
        const selected = palette(page).locator('[role="option"][aria-selected="true"]');
        await expect(selected).toBeInViewport();
    });

    test('No results shows a message instead of breaking navigation', async ({ page }) => {
        await page.keyboard.press('Control+k');
        await page.keyboard.type('zzzzzz');
        await expect(palette(page)).toContainText('No tools match');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL('/');
    });
});
