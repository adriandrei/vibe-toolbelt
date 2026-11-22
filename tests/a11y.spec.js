import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { routePaths, useTheme } from './helpers.js';

// Automated WCAG 2.2 A/AA checks (axe-core) on every page, in both themes.
// They catch missing labels and names, bad ARIA, contrast and structure
// problems; they can't judge everything, so keyboard and screen reader checks
// by hand still matter.
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
// Previews of the user's own content (e.g. the Contrast Checker showing a
// failing colour pair on purpose) are left out, as in findLowContrast.
const USER_CONTENT = '[data-user-content]';

function describe(violations) {
    return violations
        .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 5).map((n) => `    ${n.target.join(' ')} — ${n.failureSummary?.split('\n').slice(1, 2).join(' ').trim()}`).join('\n')}`)
        .join('\n');
}

// Accent colours change many text and surface colours. Yellow (hue 60) is the
// hardest case for contrast in the light theme, green-blue in the dark one.
const ACCENT_ROUTES = ['/', '/password-generator', '/formatters', '/ai-settings', '/api-tester'];
for (const [theme, hue] of [['light', 60], ['dark', 200]]) {
    test.describe(`Contrast with accent hue ${hue} (${theme})`, () => {
        for (const path of ACCENT_ROUTES) {
            test(`${path}`, async ({ page }) => {
                await useTheme(page, theme, hue);
                await page.goto(path);
                await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15000 });
                await page.waitForTimeout(300);
                const { violations } = await new AxeBuilder({ page }).exclude(USER_CONTENT).withRules(['color-contrast']).analyze();
                expect(violations, describe(violations)).toEqual([]);
            });
        }
    });
}

for (const theme of ['light', 'dark']) {
    test.describe(`Accessibility (${theme})`, () => {
        for (const path of routePaths()) {
            test(`${path}`, async ({ page }) => {
                await useTheme(page, theme);
                await page.goto(path);
                // Pages with big editors take longer to load while other tests run
                await expect(page.locator('main h1').first()).toBeVisible({ timeout: 15000 });
                // Let lazy content and entrance animations settle
                await page.waitForTimeout(300);
                const { violations } = await new AxeBuilder({ page }).exclude(USER_CONTENT).withTags(TAGS).analyze();
                expect(violations, describe(violations)).toEqual([]);
            });
        }
    });
}
