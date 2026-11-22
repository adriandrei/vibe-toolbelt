import { test, expect } from '@playwright/test';

test.describe('Primary buttons', () => {
    // Reads a CSS colour token as sRGB and returns the WCAG contrast of two of them
    const contrastOf = (page, a, b) => page.evaluate(([x, y]) => {
        const rgb = (name) => {
            const probe = document.createElement('span');
            probe.style.color = `var(${name})`;
            document.body.appendChild(probe);
            const [r, g, bl] = getComputedStyle(probe).color.match(/[\d.]+/g).map(Number);
            probe.remove();
            return [r, g, bl];
        };
        const lum = (c) => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
            .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
        const [l1, l2] = [lum(rgb(x)), lum(rgb(y))];
        return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }, [a, b]);

    for (const theme of ['dark', 'light']) {
        test(`stay readable at rest and on hover for every accent hue (${theme})`, async ({ page }) => {
            for (const hue of [0, 30, 60, 120, 180, 220, 250, 300]) {
                await page.addInitScript(([t, h]) => {
                    localStorage.setItem('pt-theme', t);
                    localStorage.setItem('pt-hue', String(h));
                }, [theme, hue]);
                await page.goto('/uuid');
                await expect(page.locator('main h1')).toBeVisible();
                expect(await contrastOf(page, '--on-primary', '--primary'), `rest, hue ${hue}`).toBeGreaterThanOrEqual(4.5);
                expect(await contrastOf(page, '--on-primary', '--primary-hover'), `hover, hue ${hue}`).toBeGreaterThanOrEqual(4.5);
            }
        });
    }
});

test.describe('SliderField number box', () => {
    test('typing a value digit by digit is not clamped half-way', async ({ page }) => {
        await page.goto('/password-generator');
        const length = page.getByLabel('Length value');
        await length.click();
        await length.press('Control+a');
        // "3" alone is below the minimum (8); it must not be rewritten while typing "32"
        await length.pressSequentially('32');
        await expect(length).toHaveValue('32');
        await expect(page.getByLabel('Length', { exact: true })).toHaveValue('32');
    });

    test('an out-of-range value is clamped when the box loses focus', async ({ page }) => {
        await page.goto('/password-generator');
        const length = page.getByLabel('Length value');
        await length.click();
        await length.press('Control+a');
        await length.pressSequentially('3');
        await expect(length).toHaveValue('3');
        await length.blur();
        await expect(length).toHaveValue('8');
        await expect(page.getByLabel('Length', { exact: true })).toHaveValue('8');
    });
});
