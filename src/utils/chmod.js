// Unix permission modes for the Chmod page. A mode is a number 0..0o7777:
// special bits (setuid 4000, setgid 2000, sticky 1000) + owner/group/other rwx.

export const SETUID = 0o4000
export const SETGID = 0o2000
export const STICKY = 0o1000
export const CLASSES = [
    { key: 'u', name: 'Owner', shift: 6, special: SETUID },
    { key: 'g', name: 'Group', shift: 3, special: SETGID },
    { key: 'o', name: 'Others', shift: 0, special: STICKY },
]

// "755", or "4755" when a special bit is set
export function formatOctal(mode) {
    const special = mode >> 9
    const base = (mode & 0o777).toString(8).padStart(3, '0')
    return special ? `${special}${base}` : base
}

// "rwxr-xr-x" with s/S and t/T for the special bits
export function formatSymbolic(mode) {
    return CLASSES.map(({ shift, special, key }) => {
        const r = mode & (4 << shift) ? 'r' : '-'
        const w = mode & (2 << shift) ? 'w' : '-'
        const exec = mode & (1 << shift)
        let x = exec ? 'x' : '-'
        if (mode & special) {
            const letter = key === 'o' ? 't' : 's'
            x = exec ? letter : letter.toUpperCase()
        }
        return r + w + x
    }).join('')
}

// "u=rwx,g=rx,o=rx" (with s/t for special bits)
export function formatChmodExpression(mode) {
    return CLASSES.map(({ key, shift, special }) => {
        let perms = ''
        if (mode & (4 << shift)) perms += 'r'
        if (mode & (2 << shift)) perms += 'w'
        if (mode & (1 << shift)) perms += 'x'
        if (mode & special) perms += key === 'o' ? 't' : 's'
        return `${key}=${perms}`
    }).join(',')
}

const SYMBOLIC_RE = /^([-dlbcps])?([r-][w-][xsS-][r-][w-][xsS-][r-][w-][xtT-])$/

function parseSymbolicString(str) {
    const m = str.match(SYMBOLIC_RE)
    if (!m) return null
    const s = m[2]
    let mode = 0
    CLASSES.forEach(({ shift, special }, i) => {
        const [r, w, x] = s.slice(i * 3, i * 3 + 3)
        if (r === 'r') mode |= 4 << shift
        if (w === 'w') mode |= 2 << shift
        if (x === 'x' || x === 's' || x === 't') mode |= 1 << shift
        if (x === 's' || x === 'S' || x === 't' || x === 'T') mode |= special
    })
    return { mode, type: m[1] }
}

const CLAUSE_RE = /^([ugoa]*)((?:[+\-=](?:[ugo]|[rwxXst]*))+)$/

/**
 * Applies a chmod symbolic expression ("u+x", "go-w", "a=rX", "u=rwx,g=rx,o=",
 * "g=u") to `mode` with GNU chmod's rules (e.g. "o+t" sets the sticky bit;
 * BSD/macOS chmod ignores it). There's no umask: no "who" means "a".
 * Returns the new mode or throws an Error with a readable message.
 */
export function applySymbolic(mode, expression, { isDirectory = false } = {}) {
    let result = mode
    for (const clause of expression.split(',')) {
        const m = clause.match(CLAUSE_RE)
        if (!m) throw new Error(`“${clause || '(empty)'}” isn’t a valid chmod clause (e.g. u+x, go-w, a=r).`)
        const who = !m[1] || m[1].includes('a') ? 'ugo' : m[1]
        const classes = CLASSES.filter(c => who.includes(c.key))
        for (const [, op, perms] of m[2].matchAll(/([+\-=])([ugo]|[rwxXst]*)/g)) {
            const before = result
            let bits = 0
            let affected = 0
            for (const c of classes) {
                affected |= (7 << c.shift) | c.special
                if (/^[ugo]$/.test(perms)) {
                    const from = CLASSES.find(s => s.key === perms)
                    bits |= ((before >> from.shift) & 7) << c.shift
                    continue
                }
                if (perms.includes('r')) bits |= 4 << c.shift
                if (perms.includes('w')) bits |= 2 << c.shift
                if (perms.includes('x')) bits |= 1 << c.shift
                if (perms.includes('X') && (isDirectory || (before & 0o111))) bits |= 1 << c.shift
                if (perms.includes('s') && c.key !== 'o') bits |= c.special
                if (perms.includes('t') && c.key === 'o') bits |= STICKY
            }
            if (op === '+') result |= bits
            else if (op === '-') result &= ~bits
            else {
                // GNU chmod keeps a directory's setuid/setgid unless they're named explicitly
                const keep = isDirectory && !perms.includes('s') ? (SETUID | SETGID) & affected : 0
                result = (result & ~(affected & ~keep)) | bits
            }
        }
    }
    return result & 0o7777
}

/**
 * Reads what the user typed: octal ("755", "0644", "4755"), an ls-style
 * string ("rwxr-xr-x", "drwxr-xr-x"), or a relative expression ("u+x").
 * @returns {{ kind: 'octal' | 'symbolic' | 'relative', mode: number, type?: string } | { error: string } | null}
 */
export function parseModeInput(text, currentMode, options) {
    const value = String(text ?? '').trim()
    if (!value) return null
    if (/^\d+$/.test(value)) {
        const bad = value.match(/[89]/)
        if (bad) return { error: `Octal digits are 0–7, so “${bad[0]}” can’t appear in a mode.` }
        if (value.length > 4) return { error: 'An octal mode has at most 4 digits (e.g. 4755).' }
        return { kind: 'octal', mode: parseInt(value, 8) }
    }
    const symbolic = parseSymbolicString(value)
    if (symbolic) return { kind: 'symbolic', ...symbolic }
    if (/^[ugoa]*[+\-=]/.test(value)) {
        try {
            return { kind: 'relative', mode: applySymbolic(currentMode, value, options) }
        } catch (error) {
            return { error: error.message }
        }
    }
    if (/^[-dlbcps]?[rwxsStT-]+$/.test(value)) {
        return { error: `A symbolic mode has 9 characters, like rwxr-xr-x (this has ${value.replace(/^[dlbcps-](?=.{9})/, '').length}).` }
    }
    return { error: 'Use octal (755), a symbolic mode (rwxr-xr-x) or a change such as u+x or go-w.' }
}
