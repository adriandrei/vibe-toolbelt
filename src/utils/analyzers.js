import cronstrue from 'cronstrue';

/**
 * Analyzes text and returns a tool recommendation if confidence is high.
 * @param {string} text - The pasted text
 * @returns {object|null} - { tool: '/path', label: 'Tool Name', confidence: 0-1 }
 */
export const analyzeContent = (text) => {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();

    // 1. JWT Detection
    // Header.Payload.Signature (simple regex check)
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(trimmed)) {
        // Additional sanity check: must start with eyJ (Base64 for {"...)
        if (trimmed.startsWith('eyJ')) {
            return { tool: '/jwt', label: 'JWT Decoder', confidence: 0.99 };
        }
    }

    // 2. Cron Detection
    // Must have 5 or 6 parts, and be parsable by cronstrue
    if (trimmed.split(' ').length >= 5 && trimmed.split(' ').length <= 7) {
        try {
            cronstrue.toString(trimmed);
            return { tool: '/cron', label: 'Cron Parser', confidence: 0.9 };
        } catch (e) {
            // Not a cron
        }
    }

    // 3. JSON Detection
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
            JSON.parse(trimmed);
            return { tool: '/formatters', label: 'JSON Formatter', confidence: 0.95 };
        } catch (e) {
            // Not valid JSON
        }
    }

    // 4. URL Detection
    try {
        const url = new URL(trimmed);
        if (url.protocol === 'http:' || url.protocol === 'https:') {
            return { tool: '/url', label: 'URL Parser', confidence: 0.8 };
        }
    } catch (e) {
        // Not a URL
    }

    // 5. User Agent Detection
    // Identify common UA tokens
    if (trimmed.includes('Mozilla/') || trimmed.includes('Chrome/') || trimmed.includes('Safari/')) {
        return { tool: '/ua', label: 'User Agent Parser', confidence: 0.85 };
    }

    // 6. Base64 Detection
    // Must look like base64 and decode to something readable-ish or JSON
    // Regex for Base64 (alphanumeric + +/ + =)
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 8) {
        try {
            const decoded = atob(trimmed);
            // If it decodes to JSON, maybe it's Base64 encoded JSON
            if (decoded.trim().startsWith('{')) {
                return { tool: '/base64', label: 'Base64 Decoder', confidence: 0.9 };
            }
            // General Base64 check: if it decodes without error and is somewhat long
            return { tool: '/base64', label: 'Base64 Decoder', confidence: 0.6 };
        } catch (e) {
            // Not valid Base64
        }
    }

    // 7. Unix Timestamp Detection
    // 10 digits (seconds) or 13 digits (ms)
    // Starts with 1 (until 2033) like 17xxxxxxxxx or 16xxxxxxxxx
    if (/^\d+$/.test(trimmed)) {
        const ts = parseInt(trimmed, 10);
        // Valid range: roughly 2000 to 2100 (seconds or ms)
        // Seconds: 946684800 (year 2000) -> 4102444800 (year 2100)
        // Ms: 946684800000 -> 4102444800000

        // Seconds Check
        if (ts > 946684800 && ts < 4102444800) {
            return { tool: '/unix', label: 'Unix Timestamp', confidence: 0.95 };
        }
        // Ms Check
        if (ts > 946684800000 && ts < 4102444800000) {
            return { tool: '/unix', label: 'Unix Timestamp', confidence: 0.95 };
        }
    }

    return null;
};
