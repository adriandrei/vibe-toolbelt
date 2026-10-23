// PEM armour and the few DER conversions needed for RSA keys:
// PKCS#8 ⇄ PKCS#1 private keys and SPKI ⇄ PKCS#1 public keys.
import { base64ToBytes, bytesToBase64, concatBytes } from './encoding.js'

export function pemEncode(label, der) {
    const lines = bytesToBase64(der).match(/.{1,64}/g) || []
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

/**
 * Finds PEM blocks in text (surrounding text and whitespace are ignored).
 * @returns {{ label: string, der: Uint8Array, pem: string }[]}
 */
export function findPemBlocks(text) {
    const blocks = []
    const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g
    let m
    while ((m = re.exec(String(text ?? '')))) {
        const body = m[2].replace(/^[A-Za-z-]+:.*$/gm, '') // drop RFC 1421 headers (Proc-Type, …)
        const der = base64ToBytes(body)
        blocks.push({ label: m[1], der, pem: pemEncode(m[1], der) })
    }
    return blocks
}

// ---- minimal DER ----
function readTlv(bytes, pos) {
    const tag = bytes[pos]
    let len = bytes[pos + 1]
    let offset = pos + 2
    if (tag === undefined || len === undefined) throw new Error('Truncated DER data')
    if (len & 0x80) {
        const n = len & 0x7f
        if (n === 0 || n > 4) throw new Error('Unsupported DER length')
        len = 0
        for (let i = 0; i < n; i++) len = len * 256 + bytes[offset + i]
        offset += n
    }
    const end = offset + len
    if (end > bytes.length) throw new Error('Truncated DER data')
    return { tag, start: offset, end }
}

function encodeLength(len) {
    if (len < 0x80) return Uint8Array.of(len)
    const out = []
    for (let n = len; n > 0; n = Math.floor(n / 256)) out.unshift(n & 0xff)
    return Uint8Array.of(0x80 | out.length, ...out)
}

function tlv(tag, content) {
    return concatBytes(Uint8Array.of(tag), encodeLength(content.length), content)
}

// AlgorithmIdentifier { rsaEncryption, NULL }
const RSA_ALGORITHM_ID = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00)
const RSA_OID = RSA_ALGORITHM_ID.subarray(4, 13)

function isRsaAlgorithm(bytes, algId) {
    if (algId.tag !== 0x30 || bytes[algId.start] !== 0x06) return false
    const oid = readTlv(bytes, algId.start)
    const value = bytes.subarray(oid.start, oid.end)
    return value.length === RSA_OID.length && value.every((b, i) => b === RSA_OID[i])
}

// PrivateKeyInfo → RSAPrivateKey
export function pkcs8ToPkcs1(der) {
    const seq = readTlv(der, 0)
    if (seq.tag !== 0x30) throw new Error('Not a PKCS#8 key')
    const version = readTlv(der, seq.start)
    const algId = readTlv(der, version.end)
    if (!isRsaAlgorithm(der, algId)) throw new Error('Not an RSA key')
    const key = readTlv(der, algId.end)
    if (key.tag !== 0x04) throw new Error('Not a PKCS#8 key')
    return der.slice(key.start, key.end)
}

// RSAPrivateKey → PrivateKeyInfo
export function pkcs1ToPkcs8(der) {
    return tlv(0x30, concatBytes(Uint8Array.of(0x02, 0x01, 0x00), RSA_ALGORITHM_ID, tlv(0x04, der)))
}

// SubjectPublicKeyInfo → RSAPublicKey
export function spkiToPkcs1(der) {
    const seq = readTlv(der, 0)
    if (seq.tag !== 0x30) throw new Error('Not an SPKI key')
    const algId = readTlv(der, seq.start)
    if (!isRsaAlgorithm(der, algId)) throw new Error('Not an RSA key')
    const bits = readTlv(der, algId.end)
    if (bits.tag !== 0x03 || der[bits.start] !== 0) throw new Error('Not an SPKI key')
    return der.slice(bits.start + 1, bits.end)
}

// RSAPublicKey → SubjectPublicKeyInfo
export function pkcs1ToSpki(der) {
    return tlv(0x30, concatBytes(RSA_ALGORITHM_ID, tlv(0x03, concatBytes(Uint8Array.of(0), der))))
}

// Modulus size in bits of an RSAPublicKey (PKCS#1).
export function rsaModulusBits(pkcs1Public) {
    const seq = readTlv(pkcs1Public, 0)
    const n = readTlv(pkcs1Public, seq.start)
    let start = n.start
    while (start < n.end && pkcs1Public[start] === 0) start++
    if (start === n.end) return 0
    return (n.end - start - 1) * 8 + (32 - Math.clz32(pkcs1Public[start]))
}

const KEY_OIDS = [
    { oid: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01], type: 'RSA' },
    { oid: [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0a], type: 'RSA-PSS' },
    { oid: [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01], type: 'EC' },
    { oid: [0x2b, 0x65, 0x70], type: 'Ed25519' },
    { oid: [0x2b, 0x65, 0x71], type: 'Ed448' },
    { oid: [0x2b, 0x65, 0x6e], type: 'X25519' },
]
const CURVE_OIDS = [
    { oid: [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07], name: 'P-256' },
    { oid: [0x2b, 0x81, 0x04, 0x00, 0x22], name: 'P-384' },
    { oid: [0x2b, 0x81, 0x04, 0x00, 0x23], name: 'P-521' },
    { oid: [0x2b, 0x81, 0x04, 0x00, 0x0a], name: 'secp256k1' },
]
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * Key type of a SubjectPublicKeyInfo (or of the AlgorithmIdentifier inside a
 * PKCS#8 key when `pkcs8` is true): { type: 'RSA' | 'EC' | 'Ed25519' | …, curve? }.
 */
export function keyAlgorithm(der, { pkcs8 = false } = {}) {
    try {
        const seq = readTlv(der, 0)
        let pos = seq.start
        if (pkcs8) pos = readTlv(der, pos).end // skip version
        const algId = readTlv(der, pos)
        const oid = readTlv(der, algId.start)
        if (der[algId.start] !== 0x06) return { type: 'unknown' }
        const value = Array.from(der.subarray(oid.start, oid.end))
        const match = KEY_OIDS.find(k => sameBytes(k.oid, value))
        if (!match) return { type: 'unknown' }
        if (match.type !== 'EC') return { type: match.type }
        const param = readTlv(der, oid.end)
        const curveOid = Array.from(der.subarray(param.start, param.end))
        return { type: 'EC', curve: CURVE_OIDS.find(c => sameBytes(c.oid, curveOid))?.name || 'unknown curve' }
    } catch {
        return { type: 'unknown' }
    }
}
