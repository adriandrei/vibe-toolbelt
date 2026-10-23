import fs from 'node:fs';

// All routes registered in src/routes.js (ROUTE_MAP keys).
export function routePaths() {
    const src = fs.readFileSync(new URL('../src/routes.js', import.meta.url), 'utf8');
    return [...src.matchAll(/'(\/[^']*)':/g)].map((m) => m[1]);
}

// Simulates pasting text outside any input (what Smart Paste listens for).
export async function pasteOnPage(page, text) {
    await page.evaluate((value) => {
        const data = new DataTransfer();
        data.setData('text/plain', value);
        document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, text);
}

// Starts the app with a given theme preference (light | dark) and optional accent hue.
export async function useTheme(page, theme, hue) {
    await page.addInitScript(([t, h]) => {
        localStorage.setItem('pt-theme', t);
        if (h !== undefined && h !== null) localStorage.setItem('pt-hue', String(h));
    }, [theme, hue ?? null]);
}

export const SAMPLE_JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// Runs in the page: returns text elements whose contrast against their
// effective background is below `min`.
export function findLowContrast(min) {
    const parse = (s) => {
        const m = s && s.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const blend = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const hidden = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return true;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.6) return true;
            if (n.matches(':disabled, [aria-disabled="true"], [aria-hidden="true"], .checkerboard, .stage, [data-user-content]')) return true;
        }
        return false;
    };
    const effectiveBg = (el) => {
        const layers = [];
        let image = false;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.backgroundImage !== 'none' && n !== document.body && n !== document.documentElement) image = true;
            const bg = parse(cs.backgroundColor);
            if (bg && bg.a > 0) layers.push(bg);
            if (bg && bg.a >= 0.99) break;
        }
        let base = { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
        return { bg: base, image };
    };
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
        if (['SCRIPT', 'STYLE', 'svg', 'path', 'OPTION', 'CANVAS', 'VIDEO', 'IMG'].includes(el.tagName)) continue;
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
        if (!own || hidden(el)) continue;
        const cs = getComputedStyle(el);
        if ((cs.webkitTextFillColor || '').includes('rgba(0, 0, 0, 0)')) continue;
        const fg = parse(cs.color);
        if (!fg) continue;
        const { bg, image } = effectiveBg(el);
        if (image) continue; // text over gradients/images can't be measured reliably
        const ratio = contrast(fg.a < 1 ? blend(fg, bg) : fg, bg);
        if (ratio < min) out.push(`${el.tagName.toLowerCase()} "${own.slice(0, 40)}" ${cs.color} on rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0}) = ${ratio.toFixed(2)}`);
    }
    return out;
}
