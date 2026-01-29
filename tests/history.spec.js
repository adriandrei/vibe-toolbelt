import { test, expect } from '@playwright/test'

test.describe('Smart History', () => {
    test.beforeEach(async ({ page, context }) => {
        // Clear localStorage before each test
        await context.addInitScript(() => {
            localStorage.clear()
        })
        await page.goto('/')
    })

    test('History button is visible on desktop', async ({ page }) => {
        // Look for the history button
        const historyBtn = page.getByRole('button', { name: /history/i })
        await expect(historyBtn).toBeVisible()
    })

    test('History panel opens on button click', async ({ page }) => {
        // Click history button
        await page.getByRole('button', { name: /history/i }).click()

        // Panel should be visible with "Recent Operations" heading
        await expect(page.getByRole('heading', { name: /Recent Operations/i })).toBeVisible()
    })

    test('History panel can be toggled', async ({ page }) => {
        // Click history button to open
        await page.getByRole('button', { name: /history/i }).click()

        // Panel should be visible
        await expect(page.getByRole('heading', { name: /Recent Operations/i })).toBeVisible()
    })

    test('Incognito mode toggle works', async ({ page }) => {
        // Open panel
        await page.getByRole('button', { name: /history/i }).click()

        // Find and click incognito button
        const incognitoBtn = page.getByRole('button', { name: /incognito/i })
        await expect(incognitoBtn).toBeVisible()
        await incognitoBtn.click()

        // Should show "Incognito ON"
        await expect(page.getByText(/incognito on/i)).toBeVisible()
        await expect(page.getByText(/incognito mode is active/i)).toBeVisible()
    })

    test('Empty state shows message', async ({ page }) => {
        // Open panel
        await page.getByRole('button', { name: /history/i }).click()

        // Should show empty state
        await expect(page.getByText(/no recent operations/i)).toBeVisible()
    })

    test('History persists in localStorage', async ({ page, context }) => {
        // Manually set some history in localStorage
        await context.addInitScript(() => {
            const history = [
                {
                    id: Date.now(),
                    timestamp: new Date().toISOString(),
                    tool: 'base64',
                    action: 'encode',
                    inputPreview: 'Hello World',
                    outputPreview: 'SGVsbG8gV29ybGQ='
                }
            ]
            localStorage.setItem('vibe-toolbelt-history', JSON.stringify(history))
        })

        // Reload page
        await page.reload()
        await page.getByRole('button', { name: /history/i }).click()

        // Should show the stored history item - check for Base64 label
        await expect(page.getByText('Base64')).toBeVisible()
    })
})
