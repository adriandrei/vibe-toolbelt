import { test, expect } from '@playwright/test';

// Independent WCAG 2.x maths to check the page against
const channel = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const rgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

const textColour = (page) => page.getByLabel('Text colour', { exact: true });
const background = (page) => page.getByLabel('Background', { exact: true });
const shownRatio = (page) => page.getByTestId('contrast-ratio');
const row = (page, id) => page.locator(`tr[data-criterion="${id}"]`);
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());

async function expectResults(page, results) {
    for (const [id, verdict] of Object.entries(results)) {
        await expect(row(page, id)).toContainText(verdict);
    }
}

test.describe('Contrast Checker', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/contrast');
        await expect(page.locator('main h1')).toHaveText('Contrast Checker');
    });

    test('checks the default pair against every WCAG level', async ({ page }) => {
        const expected = ratio(rgb('#6366f1'), [255, 255, 255]);
        expect(expected.toFixed(2)).toBe('4.47');
        await expect(shownRatio(page)).toHaveText('4.47:1');
        await expectResults(page, { 'normal-aa': 'Fail', 'normal-aaa': 'Fail', 'large-aa': 'Pass', 'large-aaa': 'Fail', ui: 'Pass' });
        await expect(page.getByText('Large text and UI only')).toBeVisible();
    });

    test('#777 on white fails AA at 4.48 and #767676 passes at 4.54', async ({ page }) => {
        await textColour(page).fill('#777');
        await expect(shownRatio(page)).toHaveText(`${ratio([119, 119, 119], [255, 255, 255]).toFixed(2)}:1`);
        await expect(shownRatio(page)).toHaveText('4.48:1');
        await expectResults(page, { 'normal-aa': 'Fail', 'large-aa': 'Pass', ui: 'Pass' });

        await textColour(page).fill('#767676');
        await expect(shownRatio(page)).toHaveText('4.54:1');
        await expectResults(page, { 'normal-aa': 'Pass', 'normal-aaa': 'Fail', 'large-aaa': 'Pass' });
        await expect(page.getByText('Passes AA for all text')).toBeVisible();
    });

    test('black on white is 21:1, also after swapping, with APCA for information', async ({ page }) => {
        await textColour(page).fill('black');
        await expect(shownRatio(page)).toHaveText('21.00:1');
        await expectResults(page, { 'normal-aa': 'Pass', 'normal-aaa': 'Pass', 'large-aa': 'Pass', 'large-aaa': 'Pass', ui: 'Pass' });
        await expect(page.getByTestId('apca')).toHaveText('Lc 106.0');
        await expect(page.getByText('Passes AAA for all text')).toBeVisible();

        await page.getByRole('button', { name: 'Swap text and background colours' }).click();
        await expect(textColour(page)).toHaveValue('#ffffff');
        await expect(background(page)).toHaveValue('#000000');
        await expect(shownRatio(page)).toHaveText('21.00:1');
        await expect(page.getByTestId('apca')).toHaveText('Lc −107.9');
    });

    test('accepts modern CSS colour syntaxes', async ({ page }) => {
        await textColour(page).fill('rebeccapurple');
        await expect(shownRatio(page)).toHaveText(`${ratio([102, 51, 153], [255, 255, 255]).toFixed(2)}:1`);
        await textColour(page).fill('oklch(0% 0 0)');
        await expect(shownRatio(page)).toHaveText('21.00:1');
        await background(page).fill('hsl(0 0% 50%)');
        await expect(shownRatio(page)).toHaveText(`${ratio([0, 0, 0], [128, 128, 128]).toFixed(2)}:1`);

        await textColour(page).fill('not a colour');
        await expect(page.getByText('Not a valid colour')).toBeVisible();
        await expect(shownRatio(page)).toHaveText(`${ratio([0, 0, 0], [128, 128, 128]).toFixed(2)}:1`);
    });

    test('composites translucent text over the background', async ({ page }) => {
        await textColour(page).fill('rgba(0, 0, 0, 0.5)');
        // Stored as #00000080 (alpha 128/255), drawn on white: 255 × (1 − 128/255) = 127
        const seen = Math.round(255 * (1 - 128 / 255));
        await expect(shownRatio(page)).toHaveText(`${ratio([seen, seen, seen], [255, 255, 255]).toFixed(2)}:1`);
        await expect(page.getByText(`measured as #${seen.toString(16).repeat(3)}, as drawn on the background`)).toBeVisible();
    });

    test('puts a translucent background on white or black', async ({ page }) => {
        await textColour(page).fill('#ffffff');
        await background(page).fill('rgba(0, 0, 0, 0.5)');
        const seen = Math.round(255 * (1 - 128 / 255));
        const overWhite = ratio([255, 255, 255], [seen, seen, seen]).toFixed(2);
        const banner = page.getByRole('status').filter({ hasText: 'The background is see-through' });
        await expect(banner).toContainText('On black the ratio would be 21.00:1.');
        await expect(shownRatio(page)).toHaveText(`${overWhite}:1`);

        await banner.getByRole('button', { name: 'Black' }).click();
        await expect(shownRatio(page)).toHaveText('21.00:1');
        await expect(banner).toContainText(`On white the ratio would be ${overWhite}:1.`);
    });

    test('suggestions keep the hue and really pass', async ({ page }) => {
        const card = page.locator('.contrast-suggestion').filter({ hasText: 'Text colour for AAA (7:1)' });
        const use = card.getByRole('button', { name: /^Use #[0-9a-f]{6} as the text colour$/ });
        const label = await use.getAttribute('aria-label');
        const suggested = label.match(/#[0-9a-f]{6}/)[0];
        await use.click();
        await expect(textColour(page)).toHaveValue(suggested);
        const achieved = ratio(rgb(suggested), [255, 255, 255]);
        expect(achieved).toBeGreaterThanOrEqual(7);
        expect(achieved).toBeLessThan(7.3);
        await expect(shownRatio(page)).toHaveText(`${achieved.toFixed(2)}:1`);
        await expectResults(page, { 'normal-aaa': 'Pass' });
        // Still a blue-violet: blue stays the strongest channel
        const [r, g, b] = rgb(suggested);
        expect(b).toBeGreaterThan(r);
        expect(b).toBeGreaterThan(g);
        await expect(card).toContainText('Already passes.');
    });

    test('says when no background can reach a level', async ({ page }) => {
        await textColour(page).fill('#808080');
        const card = page.locator('.contrast-suggestion').filter({ hasText: 'Background for AAA (7:1)' });
        await expect(card).toContainText('No background reaches 7:1 here.');
        await expect(card).toContainText('#000000');
        await expect(card).toContainText(`${ratio([128, 128, 128], [0, 0, 0]).toFixed(2)}:1`);
    });

    test('the preview uses the colours', async ({ page }) => {
        await textColour(page).fill('#112233');
        await background(page).fill('#ffeedd');
        const sample = page.getByText('Large text at 24px', { exact: true });
        await expect(sample).toHaveCSS('color', 'rgb(17, 34, 51)');
        await expect(sample).toHaveCSS('font-size', '24px');
        await expect(page.getByText('Large bold text at 18.66px')).toHaveCSS('font-weight', '700');
        await expect(page.locator('.contrast-preview')).toHaveCSS('background-color', 'rgb(255, 238, 221)');
    });

    test('a shared link reopens both colours', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await textColour(page).fill('#336699');
        await background(page).fill('#fafafa');
        await expect(shownRatio(page)).toHaveText(`${ratio(rgb('#336699'), rgb('#fafafa')).toFixed(2)}:1`);
        await page.evaluate(() => navigator.clipboard.writeText(''));
        await page.getByRole('button', { name: 'Share link' }).click();
        await expect.poll(() => clipboard(page)).toMatch(/\/contrast#s=[A-Za-z0-9_-]+$/);

        const other = await context.newPage();
        await other.goto(await clipboard(page));
        await expect(textColour(other)).toHaveValue('#336699');
        await expect(background(other)).toHaveValue('#fafafa');
        await expect(shownRatio(other)).toHaveText(`${ratio(rgb('#336699'), rgb('#fafafa')).toFixed(2)}:1`);
    });

    test('fits a phone screen', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await background(page).fill('rgba(0, 0, 0, 0.5)');
        await expect(page.getByText('The background is see-through')).toBeVisible();
        // The layout follows the measured pane width, so allow a frame after the resize
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });
});
