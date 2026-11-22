import { test, expect } from '@playwright/test';

// Saturday 21 November 2026, 14:30 UTC, in a browser set to London (GMT)
const NOW = new Date('2026-11-21T14:30:00Z');
test.use({ timezoneId: 'Europe/London', locale: 'en-GB' });

const row = (page, zone) => page.locator(`li[data-zone="${zone}"]`);
const dateTime = (page) => page.getByLabel('Date and time');
const sourcePicker = (page) => page.getByRole('combobox', { name: 'Time zone', exact: true });
const addPicker = (page) => page.getByRole('combobox', { name: 'Add a time zone' });
const clipboard = (page) => page.evaluate(() => navigator.clipboard.readText());
// The zones listed, in order (polled: evaluateAll doesn't wait for rendering)
const expectZones = (page, zones) => expect.poll(() => page.locator('li[data-zone]').evaluateAll(els => els.map(e => e.dataset.zone))).toEqual(zones);

async function chooseSource(page, query) {
    await sourcePicker(page).click();
    await page.keyboard.type(query);
    await expect(sourcePicker(page)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
}

async function addZone(page, query, zone) {
    await addPicker(page).click();
    await page.keyboard.type(query);
    await expect(page.getByRole('option').first()).toContainText(zone);
    await page.keyboard.press('Enter');
    await expect(row(page, zone)).toBeVisible();
}

async function expectRow(page, zone, { time, date, offset, abbr, dayDiff, change }) {
    const r = row(page, zone);
    if (time) await expect(r.getByTestId('tz-time')).toHaveText(time);
    if (date) await expect(r.getByTestId('tz-date')).toHaveText(date);
    if (offset) await expect(r.getByTestId('tz-offset')).toHaveText(offset);
    if (abbr === null) await expect(r.getByTestId('tz-abbr')).toHaveCount(0);
    else if (abbr) await expect(r.getByTestId('tz-abbr')).toHaveText(abbr);
    if (dayDiff === null) await expect(r.getByTestId('tz-daydiff')).toHaveCount(0);
    else if (dayDiff) await expect(r.getByTestId('tz-daydiff')).toHaveText(dayDiff);
    if (change) await expect(r.getByTestId('tz-change')).toHaveText(change);
}

test.describe('Time Zone Converter', () => {
    test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
    });

    test('starts at the current time in the browser zone, compared with the default zones', async ({ page }) => {
        await page.goto('/timezones');
        await expect(dateTime(page)).toHaveValue('2026-11-21T14:30');
        await expect(sourcePicker(page)).toHaveValue('Europe/London');
        await expectZones(page, ['UTC', 'Europe/London', 'America/New_York', 'Asia/Tokyo', 'Asia/Kolkata']);

        await expectRow(page, 'UTC', { time: '14:30', date: 'Sat, 21 Nov 2026', offset: 'UTC+00:00', change: 'No clock changes in the next 12 months.' });
        await expectRow(page, 'Europe/London', { time: '14:30', offset: 'UTC+00:00', abbr: null, dayDiff: null, change: 'Clocks go forward 1 h on 28 Mar 2027, 01:00 → 02:00' });
        await expect(row(page, 'Europe/London')).toContainText('Input');
        await expectRow(page, 'America/New_York', { time: '09:30', date: 'Sat, 21 Nov 2026', offset: 'UTC−05:00', abbr: 'EST', change: 'Clocks go forward 1 h on 14 Mar 2027, 02:00 → 03:00' });
        await expectRow(page, 'Asia/Tokyo', { time: '23:30', offset: 'UTC+09:00', dayDiff: null, change: 'No clock changes in the next 12 months.' });
        await expectRow(page, 'Asia/Kolkata', { time: '20:00', offset: 'UTC+05:30', abbr: 'IST' });
        await expect(page.getByTestId('tz-source-summary')).toContainText('In UTC: 2026-11-21T14:30:00Z');
    });

    test('shows day differences against the input date', async ({ page }) => {
        await page.goto('/timezones');
        await dateTime(page).fill('2026-11-21T20:00');
        await expectRow(page, 'Asia/Tokyo', { time: '05:00', date: 'Sun, 22 Nov 2026', dayDiff: '+1 day' });
        await expectRow(page, 'America/New_York', { time: '15:00', dayDiff: null });

        // Read the same instant from Tokyo: New York is now a day behind
        await row(page, 'Asia/Tokyo').getByRole('button', { name: 'Use as input' }).click();
        await expect(sourcePicker(page)).toHaveValue('Asia/Tokyo');
        await expect(dateTime(page)).toHaveValue('2026-11-22T05:00');
        await expectRow(page, 'America/New_York', { time: '15:00', dayDiff: '−1 day' });
        await expectRow(page, 'Asia/Tokyo', { dayDiff: null });
    });

    test('a time in the spring-forward gap is shifted and explained', async ({ page }) => {
        await page.goto('/timezones');
        await chooseSource(page, 'new york');
        await expect(sourcePicker(page)).toHaveValue('America/New_York');
        await dateTime(page).fill('2026-03-08T02:30');
        const banner = page.getByRole('status').filter({ hasText: 'doesn’t exist' });
        await expect(banner).toContainText('02:30 doesn’t exist in New York on 8 Mar 2026');
        await expect(banner).toContainText('Clocks go forward 1 h at 02:00, straight to 03:00. Showing 03:30 EDT (UTC−04:00) instead.');
        await expectRow(page, 'America/New_York', { time: '03:30', abbr: 'EDT', offset: 'UTC−04:00' });
        await expectRow(page, 'UTC', { time: '07:30', date: 'Sun, 8 Mar 2026' });
        await expect(page.getByTestId('tz-source-summary')).toContainText('In UTC: 2026-03-08T07:30:00Z');
    });

    test('a time in the fall-back overlap can be read either way', async ({ page }) => {
        await page.goto('/timezones');
        await dateTime(page).fill('2026-10-25T01:30');
        const banner = page.getByRole('status').filter({ hasText: 'happens twice' });
        await expect(banner).toContainText('01:30 happens twice in London on 25 Oct 2026');
        await expect(banner).toContainText('Clocks go back 1 h at 02:00, to 01:00.');
        const earlier = banner.getByRole('button', { name: 'Earlier, BST' });
        const later = banner.getByRole('button', { name: 'Later, UTC+00:00' });
        await expect(earlier).toHaveAttribute('aria-pressed', 'true');
        await expectRow(page, 'UTC', { time: '00:30' });
        await expectRow(page, 'Europe/London', { abbr: 'BST', offset: 'UTC+01:00' });

        await later.click();
        await expect(later).toHaveAttribute('aria-pressed', 'true');
        await expectRow(page, 'UTC', { time: '01:30' });
        await expectRow(page, 'Europe/London', { time: '01:30', offset: 'UTC+00:00' });
    });

    test('handles 45-minute offsets and 30-minute DST', async ({ page }) => {
        await page.goto('/timezones');
        await addZone(page, '+5:45', 'Asia/Kathmandu');
        await expectRow(page, 'Asia/Kathmandu', { time: '20:15', offset: 'UTC+05:45', dayDiff: null, change: 'No clock changes in the next 12 months.' });

        await addZone(page, 'chatham', 'Pacific/Chatham');
        await expectRow(page, 'Pacific/Chatham', {
            time: '04:15', date: 'Sun, 22 Nov 2026', offset: 'UTC+13:45', abbr: 'CHADT', dayDiff: '+1 day',
            change: 'Clocks go back 1 h on 4 Apr 2027, 03:45 → 02:45',
        });

        await addZone(page, 'lord howe', 'Australia/Lord_Howe');
        await expectRow(page, 'Australia/Lord_Howe', {
            time: '01:30', offset: 'UTC+11:00', abbr: 'LHDT', dayDiff: '+1 day',
            change: 'Clocks go back 30 min on 4 Apr 2027, 02:00 → 01:30',
        });
    });

    test('keeps the zone list across visits and validates it', async ({ page }) => {
        await page.goto('/timezones');
        await addZone(page, 'kathmandu', 'Asia/Kathmandu');
        await page.getByRole('button', { name: 'Remove Tokyo' }).click();
        await page.getByRole('button', { name: 'Move Kathmandu up' }).click();
        const order = ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kathmandu', 'Asia/Kolkata'];
        expect(JSON.parse(await page.evaluate(() => localStorage.getItem('tz-zones')))).toEqual(order);

        await page.reload();
        await expectZones(page, order);

        await page.getByRole('button', { name: 'Restore the default zones' }).click();
        await expect(page.locator('li[data-zone]')).toHaveCount(5);
        expect(await page.evaluate(() => localStorage.getItem('tz-zones'))).toBeNull();
    });

    test('ignores unknown and duplicate zones in saved data', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('tz-zones', JSON.stringify(['Nope/Zone', 'Asia/Calcutta', 'asia/tokyo', 'Asia/Tokyo', 7])));
        await page.goto('/timezones');
        await expectZones(page, ['Asia/Kolkata', 'Asia/Tokyo']);
    });

    test('falls back to the defaults when the saved list is damaged', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('tz-zones', '"not a list"'));
        await page.goto('/timezones');
        await expect(page.locator('li[data-zone]')).toHaveCount(5);
    });

    test('the meeting planner finds shared working hours and sets the time', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('tz-zones', JSON.stringify(['Europe/London', 'America/New_York'])));
        await page.goto('/timezones');
        await dateTime(page).fill('2026-01-15T12:00');
        await expect(page.getByText('Everyone is in working hours 14:00–17:00 (London time).')).toBeVisible();
        const overlap = page.locator('.tz-slot.is-overlap');
        expect(await overlap.evaluateAll(els => els.map(e => Number(e.dataset.hour)))).toEqual([14, 15, 16]);
        await expect(page.locator('.tz-slot')).toHaveCount(24);
        await expect(page.locator('.tz-slot.is-selected')).toHaveAttribute('data-hour', '12');
        await expect(page.locator('.tz-slot button[aria-pressed="true"]')).toHaveCount(1);

        // Each hour is a button named by the hour shown, then every zone's time
        const hour15 = page.getByRole('button', { name: '15:00 in London: London 15:00, New York 10:00. Everyone is in working hours.' });
        await hour15.click();
        await expect(dateTime(page)).toHaveValue('2026-01-15T15:00');
        await expectRow(page, 'America/New_York', { time: '10:00' });
        await expect(hour15).toHaveAttribute('aria-pressed', 'true');

        // Clicking lower in the column (the New York cell) picks that hour too
        await page.getByRole('region', { name: 'Hours of the day in each zone' }).scrollIntoViewIfNeeded();
        const box = await page.locator('.tz-slot[data-hour="16"]').boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
        await expect(dateTime(page)).toHaveValue('2026-01-15T16:00');
        await expectRow(page, 'America/New_York', { time: '11:00' });

        // A DST day has 23 hours
        await dateTime(page).fill('2026-03-29T12:00');
        await expect(page.locator('.tz-slot')).toHaveCount(23);
    });

    test('switches to a 12-hour clock and remembers it', async ({ page }) => {
        await page.goto('/timezones');
        await page.getByRole('button', { name: '12-hour' }).click();
        await expectRow(page, 'Europe/London', { time: '2:30 PM' });
        await expectRow(page, 'Asia/Tokyo', { time: '11:30 PM' });
        expect(await page.evaluate(() => localStorage.getItem('tz-hour-cycle'))).toBe('"h12"');
        await page.reload();
        await expectRow(page, 'America/New_York', { time: '9:30 AM' });
    });

    test('copies a zone’s time as ISO 8601 and as a sentence', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/timezones');
        await row(page, 'Asia/Kolkata').getByRole('button', { name: 'ISO 8601' }).click();
        await expect.poll(() => clipboard(page)).toBe('2026-11-21T20:00:00+05:30');
        await row(page, 'America/New_York').getByRole('button', { name: 'Sentence' }).click();
        await expect.poll(() => clipboard(page)).toBe('09:30 on Saturday, 21 November 2026 in New York (EST, UTC−05:00)');
        await row(page, 'UTC').getByRole('button', { name: 'ISO 8601' }).click();
        await expect.poll(() => clipboard(page)).toBe('2026-11-21T14:30:00Z');
    });

    test('Now returns to the current time', async ({ page }) => {
        await page.goto('/timezones');
        await dateTime(page).fill('2020-01-01T08:00');
        await expectRow(page, 'UTC', { time: '08:00' });
        await page.getByRole('button', { name: 'Now' }).click();
        await expect(dateTime(page)).toHaveValue('2026-11-21T14:30');
        await expectRow(page, 'UTC', { time: '14:30' });
    });

    test('a shared link reopens the time, zone and zone list', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto('/timezones');
        await chooseSource(page, 'new york');
        await dateTime(page).fill('2026-03-08T02:30');
        await page.getByRole('button', { name: 'Remove Tokyo' }).click();
        await page.evaluate(() => navigator.clipboard.writeText(''));
        await page.getByRole('button', { name: 'Share link' }).click();
        await expect.poll(() => clipboard(page)).toMatch(/\/timezones#s=[A-Za-z0-9_-]+$/);
        const url = await clipboard(page);
        // Back to the default list, so the shared one differs from what's saved
        await page.getByRole('button', { name: 'Restore the default zones' }).click();
        expect(await page.evaluate(() => localStorage.getItem('tz-zones'))).toBeNull();

        const other = await context.newPage();
        await other.clock.setFixedTime(NOW);
        await other.goto(url);
        await expect(sourcePicker(other)).toHaveValue('America/New_York');
        await expect(dateTime(other)).toHaveValue('2026-03-08T02:30');
        await expect(other.getByRole('status').filter({ hasText: 'doesn’t exist' })).toBeVisible();
        await expectZones(other, ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata']);
        await expect(other.getByText('These zones came with a shared link.')).toBeVisible();
        // Shared zones don't replace the saved list until they're edited
        expect(await other.evaluate(() => localStorage.getItem('tz-zones'))).toBeNull();
        await other.getByRole('button', { name: 'Remove UTC' }).click();
        expect(JSON.parse(await other.evaluate(() => localStorage.getItem('tz-zones')))).toEqual(['Europe/London', 'America/New_York', 'Asia/Kolkata']);
    });

    test('the planner scrolls inside its own box on a phone', async ({ page }) => {
        await page.setViewportSize({ width: 375, height: 740 });
        await page.goto('/timezones');
        const strip = page.getByRole('region', { name: 'Hours of the day in each zone' });
        const box = await strip.evaluate(el => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft }));
        expect(box.scrollWidth).toBeGreaterThan(box.clientWidth);
        expect(box.scrollLeft).toBeGreaterThan(0);
        // The chosen hour is scrolled into the visible part of the strip, clear of the zone names
        const placement = await strip.evaluate((el) => {
            const area = el.getBoundingClientRect();
            const names = el.querySelector('.tz-planner-labels').getBoundingClientRect();
            const chosen = el.querySelector('[aria-pressed="true"]').getBoundingClientRect();
            return { left: chosen.left - names.right, right: area.right - chosen.right };
        });
        expect(placement.left).toBeGreaterThanOrEqual(0);
        expect(placement.right).toBeGreaterThanOrEqual(0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });
});
