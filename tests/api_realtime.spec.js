import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { findLowContrast, useTheme } from './helpers.js';

// API Tester: the WebSocket and server-sent events clients (src/components/api/).
// WebSocket servers are mocked with page.routeWebSocket and event streams with
// page.route, so nothing leaves the machine.

const WS_URL = 'wss://echo.example.test/socket';
const SSE_ORIGIN = 'https://stream.example.test';
const SSE_URL = `${SSE_ORIGIN}/events`;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, last-event-id' };
const EVENT_STREAM = { ...CORS, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' };
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

// Comments, a default and a named event, ids that carry over, multi-line data,
// a retry field and JSON with a number too big for a double
const STREAM = [
    ': welcome to the stream',
    '',
    'id: 1',
    'data: first',
    '',
    'event: update',
    'id: 2',
    'data: {"price":12.5,"id":12345678901234567890}',
    '',
    'data: line one',
    'data: line two',
    '',
    ': keep-alive',
    'retry: 5000',
    'event: done',
    'data: bye',
    '',
    '',
].join('\n');

const TIME = String.raw`\d{2}:\d{2}:\d{2}\.\d{3}`;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A log entry's button is named "<direction> <time> <badges, size and preview>"
const rowName = (direction, rest) => new RegExp(`^${direction} ${TIME} ${escapeRe(rest)}$`);
const row = (log, direction, rest) => log.getByRole('button', { name: rowName(direction, rest) });
// The whole entry (list item) with that button, including its opened content.
// A `has` locator is matched inside each item, so it starts from the page.
const entry = (log, direction, rest) => log.getByRole('listitem').filter({ has: log.page().getByRole('button', { name: rowName(direction, rest) }) });
// Exact text of the code shown for an opened entry, whitespace included
const codeText = (item) => item.locator('pre').evaluate((el) => el.textContent);
// The connection status line comes first; banners below it are statuses too
const statusLine = (form) => form.getByRole('status').first();

function describeViolations(violations) {
    return violations.map((v) => `${v.id}: ${v.help}\n${v.nodes.slice(0, 5).map((n) => `    ${n.target.join(' ')}`).join('\n')}`).join('\n');
}

// Opens the API Tester with a protocol already chosen (remembered in localStorage)
async function openTester(page, protocol, storage = {}) {
    await page.addInitScript(({ protocol, storage }) => {
        localStorage.setItem('api-protocol', JSON.stringify(protocol));
        for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, JSON.stringify(value));
    }, { protocol, storage });
    await page.goto('/api-tester');
    await expect(page.locator('main h1').first()).toBeVisible();
}

const withVars = (vars) => ({ 'api-envs': [{ id: 'default', name: 'Default', vars: Object.entries(vars).map(([key, value], i) => ({ id: `v${i}`, key, value })) }] });

// An echo server: replies with every message, and records what it saw
async function mockEchoServer(page) {
    const server = { ws: null, url: null, protocols: null, received: [], closed: null };
    await page.routeWebSocket(/^wss:\/\/echo\.example\.test\//, (ws) => {
        server.ws = ws;
        server.url = ws.url();
        server.protocols = ws.protocols();
        ws.onMessage((message) => {
            server.received.push(message);
            ws.send(message);
        });
        ws.onClose((code, reason) => {
            server.closed = { code, reason };
            ws.close({ code, reason });
        });
    });
    return server;
}

function wsPage(page) {
    const connection = page.getByRole('form', { name: 'WebSocket connection' });
    return {
        connection,
        status: statusLine(connection),
        url: connection.getByLabel('WebSocket URL'),
        protocols: connection.getByLabel('Subprotocols (optional)'),
        connect: connection.getByRole('button', { name: 'Connect' }),
        disconnect: connection.getByRole('button', { name: 'Disconnect' }),
        composer: page.getByRole('textbox', { name: 'Message', exact: true }),
        send: page.getByRole('button', { name: 'Send', exact: true }),
        log: page.getByRole('region', { name: 'Messages' }),
    };
}

function ssePage(page) {
    const connection = page.getByRole('form', { name: 'Event stream connection' });
    return {
        connection,
        status: statusLine(connection),
        url: connection.getByLabel('Event stream URL'),
        connect: connection.getByRole('button', { name: 'Connect' }),
        events: page.getByRole('region', { name: 'Events' }),
    };
}

async function addHeader(page, name, value) {
    await page.getByRole('button', { name: 'Add header' }).click();
    // Name fields suggest common headers (a datalist), which makes them comboboxes
    const count = await page.getByLabel(/^Header \d+ name$/).count();
    await page.getByLabel(`Header ${count} name`).fill(name);
    await page.getByLabel(`Header ${count} value`).fill(value);
}

test.describe('API Tester: WebSocket', () => {
    test('echoes text and JSON, shows server messages, binary data and a close from the server', async ({ page }) => {
        const server = await mockEchoServer(page);
        await openTester(page, 'ws');
        const ws = wsPage(page);

        // https:// is converted to wss://, as the WebSocket constructor does
        await ws.url.fill('https://echo.example.test/socket?room=1');
        await expect(ws.connection.getByText(/^Connects to/)).toContainText('wss://echo.example.test/socket?room=1');
        await ws.protocols.fill('chat.v2, json');
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');
        await expect(ws.status).toContainText('Subprotocol chat.v2');
        expect(server.url).toBe('wss://echo.example.test/socket?room=1');
        expect(server.protocols).toEqual(['chat.v2', 'json']);
        await expect(ws.log.getByRole('listitem').filter({ hasText: 'Connected, subprotocol chat.v2' })).toBeVisible();

        // Text, sent with the button; the first incoming message is announced
        await ws.composer.fill('hello');
        await ws.send.click();
        await expect(row(ws.log, 'Sent', '5 B hello')).toBeVisible();
        await expect(row(ws.log, 'Received', '5 B hello')).toBeVisible();
        await expect(ws.log.locator('[aria-live="polite"][aria-atomic="true"]')).toHaveText('Received: hello');

        // JSON, sent with Ctrl+Enter: the pretty view keeps the big number exact
        const json = '{"type":"ping","id":12345678901234567890}';
        await ws.composer.fill(json);
        await ws.composer.press('Control+Enter');
        const jsonRow = `JSON ${Buffer.byteLength(json)} B ${json}`;
        await expect(row(ws.log, 'Sent', jsonRow)).toBeVisible();
        const echoed = row(ws.log, 'Received', jsonRow);
        await echoed.click();
        await expect(echoed).toHaveAttribute('aria-expanded', 'true');
        const echoedEntry = entry(ws.log, 'Received', jsonRow);
        await expect.poll(() => codeText(echoedEntry)).toBe('{\n  "type": "ping",\n  "id": 12345678901234567890\n}');
        await echoedEntry.getByRole('button', { name: 'Raw' }).click();
        await expect.poll(() => codeText(echoedEntry)).toBe(json);
        expect(server.received).toEqual(['hello', json]);

        // A message the server sends on its own
        server.ws.send('{"event":"tick","seq":1}');
        await expect(row(ws.log, 'Received', 'JSON 24 B {"event":"tick","seq":1}')).toBeVisible();

        // Binary data arrives as bytes: a hex dump, and Base64
        const bytes = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x41]);
        server.ws.send(bytes);
        await row(ws.log, 'Received', 'Binary 6 B de ad be ef 00 41').click();
        const binaryEntry = entry(ws.log, 'Received', 'Binary 6 B de ad be ef 00 41');
        await expect.poll(() => codeText(binaryEntry)).toBe(`00000000  de ad be ef 00 41${' '.repeat(33)}|.....A|`);
        await binaryEntry.getByRole('button', { name: 'Base64' }).click();
        await expect.poll(() => codeText(binaryEntry)).toBe(bytes.toString('base64'));

        // The server closes with an application code and a reason
        await server.ws.close({ code: 4001, reason: 'Bye for now' });
        await expect(ws.status).toContainText('Closed');
        await expect(ws.status).toContainText('4001 Application code');
        await expect(ws.status).toContainText('“Bye for now”');
        await expect(ws.log.getByText('Closed by the server with 4001 Application code: “Bye for now”')).toBeVisible();
        await expect(ws.send).toBeDisabled();
        await expect(ws.connect).toBeEnabled();
        await expect(ws.log.getByRole('heading', { name: 'Messages 6' })).toBeVisible();
    });

    test('formats JSON, filters, copies and clears, and sums up bursts for screen readers', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        const server = await mockEchoServer(page);
        await openTester(page, 'ws');
        const ws = wsPage(page);
        await ws.url.fill(WS_URL);
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');

        // Format JSON indents a valid object, and is unavailable for other text
        const formatJson = page.getByRole('button', { name: 'Format JSON' });
        await ws.composer.fill('not json');
        await expect(formatJson).toBeDisabled();
        await ws.composer.fill('{"a":[1,2],"b":{"c":true}}');
        await formatJson.click();
        await expect(ws.composer).toHaveValue('{\n  "a": [\n    1,\n    2\n  ],\n  "b": {\n    "c": true\n  }\n}');
        await ws.composer.fill('{"a": }');
        await expect(page.getByText(/^Not valid JSON \(.+\)\. It’s sent as written\.$/)).toBeVisible();

        await ws.composer.fill('ping');
        await ws.send.click();
        const live = ws.log.locator('[aria-live="polite"][aria-atomic="true"]');
        await expect(live).toHaveText('Received: ping');
        // A burst is summed up once, not read out message by message
        for (let i = 1; i <= 5; i++) server.ws.send(`update ${i}`);
        await expect(row(ws.log, 'Received', '8 B update 5')).toBeVisible();
        await expect(live).toHaveText('5 new messages. Received: update 5', { timeout: 6000 });

        const items = ws.log.getByRole('list', { name: 'Messages log' }).getByRole('listitem');
        const filter = ws.log.getByRole('searchbox', { name: 'Filter messages' });
        await filter.fill('UPDATE 3');
        await expect(items).toHaveCount(1);
        await expect(row(ws.log, 'Received', '8 B update 3')).toBeVisible();
        await filter.fill('nothing like this');
        await expect(ws.log.getByText('No messages match the filter.')).toBeVisible();
        await filter.fill('');
        const direction = ws.log.getByRole('group', { name: 'Direction' });
        await direction.getByRole('button', { name: 'Sent' }).click();
        await expect(items).toHaveCount(1);
        await direction.getByRole('button', { name: 'Received' }).click();
        await expect(items).toHaveCount(6);
        await direction.getByRole('button', { name: 'All' }).click();

        await entry(ws.log, 'Received', '8 B update 2').getByRole('button', { name: /^Copy message from / }).click();
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('update 2');

        await ws.log.getByRole('button', { name: 'Clear' }).click();
        await expect(ws.log.getByRole('list')).toHaveCount(0);
        await expect(ws.log.getByText('No messages yet')).toBeVisible();
        await expect(ws.log.getByRole('heading', { name: 'Messages 0' })).toBeVisible();
    });

    test('follows new messages until you scroll up, then offers a jump to the latest', async ({ page }) => {
        const server = await mockEchoServer(page);
        await openTester(page, 'ws');
        const ws = wsPage(page);
        await ws.url.fill(WS_URL);
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');

        const list = ws.log.getByRole('list', { name: 'Messages log' });
        const distanceFromBottom = () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
        for (let i = 1; i <= 40; i++) server.ws.send(`message number ${i}`);
        await expect(row(ws.log, 'Received', '17 B message number 40')).toBeAttached();
        await expect.poll(distanceFromBottom).toBeLessThan(2);

        // Scrolled up: new messages don't move the view, and are counted
        await list.evaluate((el) => { el.scrollTop = 0; });
        await expect(ws.log.getByRole('button', { name: 'Latest' })).toBeVisible();
        server.ws.send('late one');
        server.ws.send('late two');
        const jump = ws.log.getByRole('button', { name: '2 new messages' });
        await expect(jump).toBeVisible();
        expect(await list.evaluate((el) => el.scrollTop)).toBe(0);

        // Jumping follows again
        await jump.click();
        await expect.poll(distanceFromBottom).toBeLessThan(2);
        await expect(ws.log.getByRole('button', { name: /^(Latest|\d+ new messages?)$/ })).toHaveCount(0);
        server.ws.send('later still');
        await expect(row(ws.log, 'Received', '11 B later still')).toBeAttached();
        await expect.poll(distanceFromBottom).toBeLessThan(2);
    });

    test('Disconnect closes with 1000 Normal closure', async ({ page }) => {
        const server = await mockEchoServer(page);
        await openTester(page, 'ws');
        const ws = wsPage(page);
        await ws.url.fill(WS_URL);
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');
        await expect(page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'WebSocket (connected)' })).toBeVisible();

        await ws.disconnect.click();
        await expect(ws.status).toContainText('Disconnected');
        await expect(ws.status).toContainText('1000 Normal closure');
        expect(server.closed?.code).toBe(1000);
        await expect(ws.log.getByText('Disconnected (1000 Normal closure)')).toBeVisible();
        await expect(page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'WebSocket', exact: true })).toBeVisible();
    });

    test('explains invalid URLs and subprotocols, undefined variables and failed handshakes', async ({ page }) => {
        // A server that refuses the handshake: the page never sees "open"
        await page.routeWebSocket(/^wss:\/\/refuse\.example\.test\//, async (ws) => {
            await ws.close({ code: 1006 });
        });
        await openTester(page, 'ws');
        const ws = wsPage(page);
        const alert = ws.connection.getByRole('alert');

        await ws.url.fill('echo.example.test/socket');
        await ws.connect.click();
        await expect(alert).toContainText('The URL has no scheme');
        await ws.connection.getByRole('button', { name: 'Use wss://' }).click();
        await expect(ws.url).toHaveValue('wss://echo.example.test/socket');

        await ws.url.fill('ftp://echo.example.test/socket');
        await ws.connect.click();
        await expect(alert).toContainText('not ftp://');

        await ws.url.fill(WS_URL);
        await ws.protocols.fill('Bearer abc');
        await ws.connect.click();
        await expect(alert).toContainText('“Bearer abc” can’t be a subprotocol');
        await ws.protocols.fill('');

        await ws.url.fill('{{ws_host}}/socket');
        await expect(ws.connection.getByRole('status').filter({ hasText: 'Undefined variables' })).toContainText('{{ws_host}} isn’t set in “Default”.');
        await ws.connect.click();
        await expect(alert).toContainText('Can’t connect: the URL uses undefined variables');
        await expect(alert).toContainText('{{ws_host}} isn’t defined in the “Default” environment.');

        await ws.url.fill('wss://refuse.example.test/socket');
        await ws.connect.click();
        await expect(ws.status).toContainText('Couldn’t connect');
        await expect(alert).toContainText('it only reports close code 1006');
        await expect(alert).toContainText('No WebSocket server at this URL');
        await expect(alert).toContainText('Browsers can’t send an Authorization header with a WebSocket');
        await expect(ws.log.getByText('Couldn’t connect (1006 Abnormal closure)')).toBeVisible();
    });

    test('explains a real failed connection (a blocked port, no server needed)', async ({ page }) => {
        await openTester(page, 'ws');
        const ws = wsPage(page);
        // Browsers never connect to port 1: the real WebSocket fails with close code 1006
        await ws.url.fill('ws://127.0.0.1:1/');
        await ws.connect.click();
        await expect(ws.status).toContainText('Couldn’t connect');
        const alert = ws.connection.getByRole('alert');
        await expect(alert).toContainText('it only reports close code 1006');
        await expect(alert).toContainText('No WebSocket server at this URL');
        // Only the causes that can apply: no subprotocols were asked for, and ws:// has no certificate
        await expect(alert).not.toContainText('No subprotocol was accepted');
        await expect(alert).not.toContainText('certificate');
        await expect(ws.log.getByText('Couldn’t connect (1006 Abnormal closure)')).toBeVisible();
        await expect(ws.connect).toBeEnabled();
    });

    test('shows the reason when the browser refuses to create the WebSocket', async ({ page }) => {
        // What browsers throw for an insecure ws:// URL on an https:// page
        await page.addInitScript(() => {
            window.WebSocket = class {
                constructor() {
                    throw new DOMException('Failed to construct \'WebSocket\': An insecure WebSocket connection may not be initiated from a page loaded over HTTPS.', 'SecurityError');
                }
            };
        });
        await openTester(page, 'ws');
        const ws = wsPage(page);
        await ws.url.fill('ws://echo.example.test/socket');
        await ws.connect.click();
        const alert = ws.connection.getByRole('alert');
        await expect(alert).toContainText('The browser refused to open this connection');
        await expect(alert).toContainText('An insecure WebSocket connection may not be initiated');
        await expect(ws.status).toContainText('Not connected');
        await expect(page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'WebSocket', exact: true })).toBeVisible();
    });

    test('fills in {{variables}} and remembers the URL without its secrets', async ({ page }) => {
        const server = await mockEchoServer(page);
        await openTester(page, 'ws', withVars({ ws_host: 'wss://echo.example.test', token: 'env-secret-123' }));
        const ws = wsPage(page);

        await ws.url.fill('{{ws_host}}/socket?token={{token}}&room=7');
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');
        expect(server.url).toBe('wss://echo.example.test/socket?token=env-secret-123&room=7');
        await ws.composer.fill('{"auth":"{{token}}"}');
        await ws.send.click();
        await expect.poll(() => server.received).toEqual(['{"auth":"env-secret-123"}']);
        // Kept as written: references hold no secret
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem('api-ws-url')))).toBe('{{ws_host}}/socket?token={{token}}&room=7');

        await ws.disconnect.click();
        await expect(ws.status).toContainText('Disconnected');
        await ws.url.fill('wss://echo.example.test/socket?token=literal-secret-456&room=7');
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');
        await ws.composer.fill('private message');
        await ws.send.click();
        await expect(row(ws.log, 'Received', '15 B private message')).toBeVisible();

        const stored = await page.evaluate(() => ({ ...localStorage }));
        expect(JSON.parse(stored['api-ws-url'])).toBe('wss://echo.example.test/socket?token=&room=7');
        const rest = Object.entries(stored).filter(([key]) => key !== 'api-envs').map(([, value]) => value).join('\n');
        for (const secret of ['literal-secret-456', 'env-secret-123', 'private message', 'auth']) expect(rest).not.toContain(secret);

        await page.reload();
        await expect(ws.url).toHaveValue('wss://echo.example.test/socket?token=&room=7');
    });
});

test.describe('API Tester: server-sent events', () => {
    test('shows the events of a mocked stream and sends custom headers', async ({ page }) => {
        const requests = [];
        await page.route(`${SSE_ORIGIN}/**`, async (route) => {
            const request = route.request();
            if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
            requests.push({ url: request.url(), headers: await request.allHeaders() });
            return route.fulfill({ status: 200, headers: EVENT_STREAM, body: STREAM });
        });
        await openTester(page, 'sse', withVars({ token: 'test-token' }));
        const sse = ssePage(page);

        await sse.url.fill(`${SSE_URL}?topic=prices&access_token=url-secret`);
        await addHeader(page, 'Authorization', 'Bearer {{token}}');
        await sse.connect.click();
        await expect(sse.status).toContainText('Stream ended');
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe(`${SSE_URL}?topic=prices&access_token=url-secret`);
        expect(requests[0].headers.authorization).toBe('Bearer test-token');
        expect(requests[0].headers.accept).toBe('text/event-stream');

        // Default and named types, ids that carry over to later events, multi-line data
        await expect(sse.events.getByRole('heading', { name: 'Events 4' })).toBeVisible();
        await expect(row(sse.events, 'Received', 'message id 1 5 B first')).toBeVisible();
        const updateName = 'update id 2 JSON 40 B {"price":12.5,"id":12345678901234567890}';
        const update = row(sse.events, 'Received', updateName);
        await expect(update).toBeVisible();
        const linesName = 'message id 2 17 B line one line two';
        const lines = row(sse.events, 'Received', linesName);
        await expect(lines).toBeVisible();
        await expect(row(sse.events, 'Received', 'done id 2 3 B bye')).toBeVisible();

        // Comments only on request
        await expect(sse.events.getByText('welcome to the stream')).toHaveCount(0);
        await sse.events.getByLabel('Show comments (2)').check();
        await expect(row(sse.events, 'Comment', 'welcome to the stream')).toBeVisible();
        await expect(row(sse.events, 'Comment', 'keep-alive')).toBeVisible();

        // retry, and the end of the stream, are explained
        await expect(sse.events.getByText('The server set the reconnection time to 5 s (retry: 5000)')).toBeVisible();
        await expect(sse.connection.getByRole('status').filter({ hasText: 'The server ended the stream' }))
            .toContainText('EventSource would reconnect after 5 s and send Last-Event-ID: 2.');

        // JSON keeps its big number; multi-line data keeps its line break
        await update.click();
        await expect.poll(() => codeText(entry(sse.events, 'Received', updateName))).toBe('{\n  "price": 12.5,\n  "id": 12345678901234567890\n}');
        await lines.click();
        await expect.poll(() => codeText(entry(sse.events, 'Received', linesName))).toBe('line one\nline two');

        // Only the URL is remembered, without the token; headers and events aren't kept
        const stored = await page.evaluate(() => ({ ...localStorage }));
        expect(JSON.parse(stored['api-sse-url'])).toBe(`${SSE_URL}?topic=prices&access_token=`);
        const rest = Object.entries(stored).filter(([key]) => key !== 'api-envs').map(([, value]) => value).join('\n');
        for (const secret of ['url-secret', 'test-token', 'Bearer', 'line one']) expect(rest).not.toContain(secret);
    });

    test('reconnects like EventSource: after the retry time, with Last-Event-ID, until a 204', async ({ page }) => {
        const lastEventIds = [];
        await page.route(`${SSE_ORIGIN}/**`, async (route) => {
            const request = route.request();
            if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
            lastEventIds.push((await request.allHeaders())['last-event-id'] ?? null);
            if (lastEventIds.length === 1) return route.fulfill({ status: 200, headers: EVENT_STREAM, body: 'retry: 300\nid: 7\ndata: one\n\n' });
            if (lastEventIds.length === 2) return route.fulfill({ status: 200, headers: EVENT_STREAM, body: 'id: 8\ndata: two\n\n' });
            return route.fulfill({ status: 204, headers: CORS });
        });
        await openTester(page, 'sse');
        const sse = ssePage(page);
        await sse.url.fill(SSE_URL);
        await page.getByLabel('Reconnect automatically').check();
        await sse.connect.click();

        const alert = sse.connection.getByRole('alert');
        await expect(alert).toContainText('The server answered 204 No Content');
        await expect(alert).toContainText('204 No Content is how a server tells clients to stop reconnecting.');
        await expect(sse.status).toContainText('Failed');
        expect(lastEventIds).toEqual([null, '7', '8']);
        await expect(row(sse.events, 'Received', 'message id 7 3 B one')).toBeVisible();
        await expect(row(sse.events, 'Received', 'message id 8 3 B two')).toBeVisible();
        await expect(sse.events.getByText('Reconnecting in 300 ms')).toHaveCount(2);
        await expect(sse.events.getByText(`Reconnecting to ${SSE_URL} with Last-Event-ID: 8`)).toBeVisible();
    });

    test('explains HTTP errors, wrong content types and blocked requests', async ({ page }) => {
        let mode = 'unauthorized';
        await page.route(`${SSE_ORIGIN}/**`, async (route) => {
            const request = route.request();
            // A request blocked by CORS fails like any network error ("Failed to fetch"):
            // pages can't tell the difference. (Fulfilled routes skip CORS checks, so abort.)
            if (mode === 'blocked') return route.abort('failed');
            if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
            if (mode === 'unauthorized') return route.fulfill({ status: 401, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"error":"invalid_token"}' });
            return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: '{"ok":true}' });
        });
        await openTester(page, 'sse');
        const sse = ssePage(page);
        const alert = sse.connection.getByRole('alert');
        await sse.url.fill(SSE_URL);
        await addHeader(page, 'Authorization', 'Bearer nope');

        await sse.connect.click();
        await expect(alert).toContainText('The server answered 401 Unauthorized');
        await expect(alert).toContainText('Check the Authorization header or the cookies.');
        await expect(alert).toContainText('{"error":"invalid_token"}');

        mode = 'json';
        await sse.connect.click();
        await expect(alert).toContainText('The response isn’t an event stream');
        await expect(alert).toContainText('It’s application/json, but event streams must be text/event-stream.');

        mode = 'blocked';
        await sse.connect.click();
        await expect(alert).toContainText('No response: the request was blocked or the server couldn’t be reached');
        await expect(alert).toContainText(`the server has to allow requests from ${new URL(test.info().project.use.baseURL).origin}`);
        await expect(alert).toContainText('Because of Authorization, the browser first sends a preflight (OPTIONS) request');
        await expect(alert).not.toContainText('Send cookies');
        await expect(sse.status).toContainText('Failed');
        await expect(sse.events.getByText('No response: the request was blocked or the server couldn’t be reached')).toBeVisible();
    });
});

test.describe('API Tester: protocol switch', () => {
    test('keeps a live WebSocket and its log across a trip to HTTP, which works as before', async ({ page }) => {
        const server = await mockEchoServer(page);
        let placeholderRequests = 0;
        await page.route('https://jsonplaceholder.typicode.com/**', (route) => {
            placeholderRequests++;
            return route.abort();
        });
        await page.route('https://api.example.test/**', (route) => route.fulfill({
            status: 200,
            headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
            body: '{"ok":true}',
        }));
        await page.goto('/api-tester');
        const protocol = page.getByRole('group', { name: 'Protocol' });
        const httpUrl = page.getByLabel('URL', { exact: true });
        await expect(protocol.getByRole('button', { name: 'HTTP' })).toHaveAttribute('aria-pressed', 'true');
        await httpUrl.fill('https://api.example.test/items');

        await protocol.getByRole('button', { name: 'WebSocket' }).click();
        const ws = wsPage(page);
        await ws.url.fill(WS_URL);
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');
        await ws.composer.fill('via keyboard');
        // Ctrl+Enter sends the message, not the HTTP request
        await ws.composer.press('Control+Enter');
        await expect(row(ws.log, 'Received', '12 B via keyboard')).toBeVisible();

        await protocol.getByRole('button', { name: 'HTTP' }).click();
        await expect(protocol.getByRole('button', { name: 'WebSocket (connected)' })).toBeVisible();
        await expect(httpUrl).toHaveValue('https://api.example.test/items');
        server.ws.send('while away');
        await page.getByRole('button', { name: 'Send', exact: true }).click();
        await expect(page.getByRole('region', { name: 'Response' }).getByText('200 OK')).toBeVisible();

        await protocol.getByRole('button', { name: 'WebSocket (connected)' }).click();
        await expect(ws.status).toContainText('Connected');
        await expect(row(ws.log, 'Sent', '12 B via keyboard')).toBeVisible();
        await expect(row(ws.log, 'Received', '10 B while away')).toBeVisible();
        expect(placeholderRequests).toBe(0);

        // The choice is remembered
        await page.reload();
        await expect(page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'WebSocket' })).toHaveAttribute('aria-pressed', 'true');
    });

    test('a request opened from the cURL tool shows on the HTTP side', async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem('api-protocol', JSON.stringify('sse')));
        await page.goto('/curl');
        await page.getByLabel('cURL command').fill("curl 'https://api.example.test/items?page=2' -H 'Accept: application/json'");
        await page.getByRole('button', { name: 'Open in API Tester' }).click();
        await expect(page).toHaveURL(/\/api-tester$/);
        await expect(page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: 'HTTP' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://api.example.test/items?page=2');
    });
});

test.describe('API Tester: realtime panels are readable and accessible', () => {
    // Both clients with content: messages, an opened JSON message and a hex dump, events and comments
    async function fillBoth(page) {
        const server = await mockEchoServer(page);
        await page.route(`${SSE_ORIGIN}/**`, (route) => (route.request().method() === 'OPTIONS'
            ? route.fulfill({ status: 204, headers: CORS })
            : route.fulfill({ status: 200, headers: EVENT_STREAM, body: STREAM })));
        await openTester(page, 'ws');
        const ws = wsPage(page);
        await ws.url.fill(`${WS_URL}?token=abc`);
        await ws.connect.click();
        await expect(ws.status).toContainText('Connected');
        await ws.composer.fill('{"type":"subscribe","channel":"prices"}');
        await ws.send.click();
        server.ws.send(`unbroken-${'x'.repeat(400)}`);
        server.ws.send(Buffer.from('binary payload with a long line'));
        await row(ws.log, 'Received', 'JSON 39 B {"type":"subscribe","channel":"prices"}').click();
        await row(ws.log, 'Received', 'Binary 31 B 62 69 6e 61 72 79 20 70 61 79 6c 6f 61 64 20 77 69 74 68 20 61 20 6c 6f …').click();
        await ws.composer.fill('{"broken": }');
        return { ws, server };
    }

    async function openSse(page) {
        await page.getByRole('group', { name: 'Protocol' }).getByRole('button', { name: /^SSE/ }).click();
        const sse = ssePage(page);
        await sse.url.fill(SSE_URL);
        await addHeader(page, 'Authorization', 'Bearer {{missing}}');
        await sse.connect.click();
        await expect(sse.status).toContainText('Stream ended');
        await sse.events.getByLabel(/^Show comments/).check();
        await row(sse.events, 'Received', 'update id 2 JSON 40 B {"price":12.5,"id":12345678901234567890}').click();
        return sse;
    }

    // The default accent, and the hardest accent hues for contrast (as in a11y.spec.js)
    for (const [theme, hue] of [['light'], ['dark'], ['light', 60], ['dark', 200]]) {
        test(`axe and text contrast, ${theme} theme${hue ? `, accent hue ${hue}` : ''}`, async ({ page }) => {
            await useTheme(page, theme, hue);
            await fillBoth(page);
            await page.waitForTimeout(300);
            let { violations } = await new AxeBuilder({ page }).include('main').withTags(AXE_TAGS).analyze();
            expect(violations, describeViolations(violations)).toEqual([]);
            let low = await page.evaluate(findLowContrast, 3);
            expect(low, low.join('\n')).toEqual([]);

            await openSse(page);
            await page.waitForTimeout(300);
            ({ violations } = await new AxeBuilder({ page }).include('main').withTags(AXE_TAGS).analyze());
            expect(violations, describeViolations(violations)).toEqual([]);
            low = await page.evaluate(findLowContrast, 3);
            expect(low, low.join('\n')).toEqual([]);
        });
    }

    test.describe('at 375px', () => {
        test.use({ viewport: { width: 375, height: 740 } });
        test('fits without horizontal scrolling', async ({ page }) => {
            const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            await fillBoth(page);
            await page.waitForTimeout(200);
            expect(await overflow()).toBeLessThanOrEqual(0);
            await openSse(page);
            await page.waitForTimeout(200);
            expect(await overflow()).toBeLessThanOrEqual(0);
        });
    });
});
