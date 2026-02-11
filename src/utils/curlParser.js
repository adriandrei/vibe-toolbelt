export const parseCurl = (curlStr) => {
    if (!curlStr.trim()) return null

    try {
        // 1. Clean up newlines and backslashes
        // Replace " \ " with space
        const clean = curlStr.replace(/\\\s*\n/g, ' ').replace(/\\\s*$/gm, ' ').replace(/\n/g, ' ').trim()

        // 2. Extract Method
        let method = 'GET'
        const methodMatch = clean.match(/-X\s+([A-Z]+)/) || clean.match(/--request\s+([A-Z]+)/)
        if (methodMatch) method = methodMatch[1]

        // 3. Extract Headers
        const headers = []
        // Regex for headers: -H "Key: Value" or -H 'Key: Value'
        const headerRegex = /(-H|--header)\s+(['"])(.*?)\2/g
        let match
        while ((match = headerRegex.exec(clean)) !== null) {
            const content = match[3]
            const parts = content.split(/:\s?/)
            if (parts.length >= 2) {
                headers.push({ key: parts[0], value: parts.slice(1).join(':') })
            }
        }

        // 4. Extract Body
        let body = ''
        // Regex for body: -d "dwad" or --data 'dawd'
        // Note: This regex is simple and might fail on nested quotes, but good enough for common usage
        const dataMatch = clean.match(/(-d|--data|--data-raw)\s+(['"])(.*?)\2/)
        if (dataMatch) {
            // Try to handle escaped quotes if wrapped in double quotes
            const quote = dataMatch[2]
            let rawBody = dataMatch[3]
            if (quote === '"') {
                rawBody = rawBody.replace(/\\"/g, '"')
            }
            body = rawBody

            if (method === 'GET') method = 'POST'
        }

        // 5. Extract URL
        // Look for http/https starting string that is likely the URL
        // We look for 'http...' or "http..." or just http...
        const urlMatch = clean.match(/['"](https?:\/\/[^'"]+)['"]/) || clean.match(/(https?:\/\/[^\s"']+)/)
        let url = ''
        if (urlMatch) url = urlMatch[1]

        return { method, url, headers, body }
    } catch (e) {
        console.error("Parse error", e)
        return null
    }
}
