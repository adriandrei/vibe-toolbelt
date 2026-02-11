export const generateCode = (req, lang) => {
    const { method, url, headers, body } = req

    // Filter out empty headers/params
    const validHeaders = headers.filter(h => h.key && h.value)

    if (lang === 'curl') {
        let cmd = `curl -X ${method} "${url}"`
        validHeaders.forEach(h => {
            cmd += ` \\\n  -H "${h.key}: ${h.value}"`
        })
        if (body && method !== 'GET' && method !== 'HEAD') {
            // Escape quotes for shell
            const escapedBody = body.replace(/"/g, '\\"')
            cmd += ` \\\n  -d "${escapedBody}"`
        }
        return cmd
    }

    if (lang === 'fetch') {
        const options = {
            method,
            headers: validHeaders.reduce((acc, h) => ({ ...acc, [h.key]: h.value }), {}),
            body: (body && method !== 'GET' && method !== 'HEAD') ? body : undefined
        }

        // Remove undefined body from JSON string if needed, but JSON.stringify handles it
        const optionsStr = JSON.stringify(options, null, 2)
        return `fetch("${url}", ${optionsStr})
  .then(response => response.json())
  .then(data => console.log(data))
  .catch(error => console.error('Error:', error))`
    }

    if (lang === 'python') {
        let code = `import requests\n\nurl = "${url}"\n`

        if (validHeaders.length > 0) {
            code += `headers = {\n`
            validHeaders.forEach(h => {
                code += `    "${h.key}": "${h.value}",\n`
            })
            code += `}\n`
        } else {
            code += `headers = {}\n`
        }

        if (body && method !== 'GET' && method !== 'HEAD') {
            // Try to see if body is JSON to use json parameter
            try {
                JSON.parse(body)
                code += `payload = ${body}\n`
            } catch {
                code += `payload = """${body}"""\n`
            }
        }

        code += `\nresponse = requests.request("${method}", url, headers=headers`
        if (body && method !== 'GET' && method !== 'HEAD') {
            try {
                JSON.parse(body)
                code += `, json=payload`
            } catch {
                code += `, data=payload`
            }
        }
        code += `)\n\nprint(response.text)`
        return code
    }

    return ''
}
