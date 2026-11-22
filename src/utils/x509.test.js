import { describe, it, expect } from 'vitest'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import {
    SUPPORTED_PEM_LABELS,
    analyzeChain,
    certificateTitle,
    compareNames,
    decodeExtension,
    ecdsaDerToRaw,
    findExtension,
    fingerprints,
    formatIp,
    formatName,
    inspect,
    oidLabel,
    oidName,
    publicKeyToJwk,
    spkiPin,
    startOfUtcDay,
    validityStatus,
    verifySignature,
} from './x509.js'

// Every expected value below was copied from OpenSSL 3.2 output for the
// fixtures (`openssl x509 -noout -text -fingerprint -sha256 -serial -subject
// -issuer -dates -nameopt utf8,sep_comma_plus_space`, `openssl req -text`,
// `openssl pkey -pubin -text`), see tests/fixtures/certs/generate.sh.

const fixture = (name) => readFileSync(new URL(`../../tests/fixtures/certs/${name}`, import.meta.url))
const text = (name) => fixture(name).toString('utf8')
const hex = (openssl) => openssl.replace(/[^0-9a-f]/gi, '').toLowerCase()
const toHex = (bytes) => Buffer.from(bytes).toString('hex')
const b64url = (hexText) => Buffer.from(hexText, 'hex').toString('base64url')
const iso = (time) => new Date(time.ms).toISOString()

function decode(input) {
    const result = inspect(input)
    expect(result.errors).toEqual([])
    return result.items
}
const certs = (name) => decode(text(name)).filter(i => i.kind === 'certificate').map(i => i.certificate)
const cert = (name) => certs(name)[0]
const ext = (item, oid) => findExtension(item, oid)
const rows = (e) => e.parsed.rows.map(r => (r.label ? `${r.label}: ${r.value}` : r.value))
const subject = (c) => formatName(c.subject, { style: 'openssl' })
const issuer = (c) => formatName(c.issuer, { style: 'openssl' })
const verifyBy = (c, signer) => verifySignature({ data: c.tbsDer, signature: c.signature, algorithm: c.signatureAlgorithm, publicKey: signer.publicKey })

// Our display forms, converted back to OpenSSL's text notation for comparison
const OPENSSL_KEY_USAGE = {
    'Digital signature': 'Digital Signature',
    'Non-repudiation': 'Non Repudiation',
    'Key encipherment': 'Key Encipherment',
    'Data encipherment': 'Data Encipherment',
    'Key agreement': 'Key Agreement',
    'Certificate signing': 'Certificate Sign',
    'CRL signing': 'CRL Sign',
}
const opensslKeyUsage = (c) => ext(c, '2.5.29.15').parsed.flags.map(f => OPENSSL_KEY_USAGE[f]).join(', ')

function opensslIpv6(value) {
    const [head, tail] = value.split('::')
    const h = head ? head.split(':') : []
    const t = tail ? tail.split(':') : []
    const groups = value.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h
    return groups.map(g => parseInt(g, 16).toString(16).toUpperCase()).join(':')
}
function opensslIp(value) {
    const [address, prefix] = value.split('/')
    const v6 = address.includes(':')
    const text = v6 ? opensslIpv6(address) : address
    if (prefix === undefined) return text
    const bits = Number(prefix)
    const mask = Array.from({ length: v6 ? 16 : 4 }, (_, i) => (0xff << (8 - Math.max(0, Math.min(8, bits - i * 8)))) & 0xff)
    if (!v6) return `${text}/${mask.join('.')}`
    const groups = []
    for (let i = 0; i < 16; i += 2) groups.push(((mask[i] << 8) | mask[i + 1]).toString(16).toUpperCase())
    return `${text}/${groups.join(':')}`
}
function opensslName(n) {
    switch (n.type) {
        case 'DNS': return `DNS:${n.value}`
        case 'IP': return `IP Address:${opensslIp(n.value)}`
        case 'email': return `email:${n.value}`
        case 'URI': return `URI:${n.value}`
        case 'otherName': return `othername: ${n.label}::${n.value}`
        case 'dirName': return `DirName:/${n.name.rdns.map(r => r.map(a => `${a.short}=${a.value}`).join('+')).join('/')}`
        case 'RID': return `Registered ID:${n.value}`
        default: return `${n.type}:${n.value}`
    }
}
const opensslSan = (item) => ext(item, '2.5.29.17').parsed.names.map(opensslName).join(', ')

// Walks an object and collects every byte array in it
function byteArraysIn(value, seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return []
    seen.add(value)
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return [value]
    return Object.values(value).flatMap(v => byteArraysIn(v, seen))
}

function lengthBytes(n) {
    if (n < 0x80) return [n]
    const out = []
    for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff)
    return [0x80 | out.length, ...out]
}
const tlv = (tag, ...parts) => {
    const content = parts.flat()
    return [tag, ...lengthBytes(content.length), ...content]
}
const utf8 = (s) => [...Buffer.from(s, 'utf8')]

describe('RSA-2048 certificate with every kind of SAN (rsa-san.pem)', () => {
    const c = cert('rsa-san.pem')

    it('matches the OpenSSL basics', () => {
        expect(c.version).toBe(3)
        expect(c.serial.hex).toBe('F1E2D3C4B5A69788796A5B4C3D2E1F00112233') // serial=
        expect(c.serial.colon).toBe('f1:e2:d3:c4:b5:a6:97:88:79:6a:5b:4c:3d:2e:1f:00:11:22:33'.toUpperCase())
        expect(c.serial.negative).toBe(false)
        expect(c.signatureAlgorithm.name).toBe('sha256WithRSAEncryption')
        expect(c.signatureAlgorithm.oid).toBe('1.2.840.113549.1.1.11')
        expect(c.signatureAlgorithm.label).toBe('SHA-256 with RSA')
        const dn = 'C=RO, ST=București, L=Cluj-Napoca, O=Toolbelt Test Ünïcödé SRL, OU=QA + UID=qa-team, CN=www.example.test, emailAddress=admin@example.test'
        expect(subject(c)).toBe(dn)
        expect(issuer(c)).toBe(dn)
        expect(iso(c.notBefore)).toBe('2026-11-21T18:25:09.000Z') // Nov 21 18:25:09 2026 GMT
        expect(iso(c.notAfter)).toBe('2029-02-23T18:25:09.000Z') // Feb 23 18:25:09 2029 GMT
        expect([c.notBefore.type, c.notAfter.type]).toEqual(['UTCTime', 'UTCTime'])
        expect(c.selfIssued).toBe(true)
        expect(c.commonName).toBe('www.example.test')
        expect(certificateTitle(c)).toBe('www.example.test')
        expect(c.warnings).toEqual([])
    })

    it('decodes each name attribute with its string type', () => {
        const attrs = c.subject.rdns.map(rdn => rdn.map(a => `${a.short}|${a.label}|${a.type}|${a.value}`))
        expect(attrs).toEqual([
            ['C|Country|PrintableString|RO'],
            ['ST|State or province|UTF8String|București'],
            ['L|Locality|UTF8String|Cluj-Napoca'],
            ['O|Organization|UTF8String|Toolbelt Test Ünïcödé SRL'],
            ['OU|Organizational unit|UTF8String|QA', 'UID|User ID|UTF8String|qa-team'],
            ['CN|Common name|UTF8String|www.example.test'],
            ['emailAddress|Email address|IA5String|admin@example.test'],
        ])
        expect(formatName(c.subject)).toBe('emailAddress=admin@example.test,CN=www.example.test,OU=QA+UID=qa-team,O=Toolbelt Test Ünïcödé SRL,L=Cluj-Napoca,ST=București,C=RO')
    })

    it('reads the RSA public key', () => {
        const key = c.publicKey
        expect(key.type).toBe('RSA')
        expect(key.bits).toBe(2048) // Public-Key: (2048 bit)
        expect(key.rsa.e).toBe(65537n) // Exponent: 65537 (0x10001)
        expect(key.summary).toBe('RSA 2048-bit')
        expect(toHex(key.rsa.n)).toBe(hex(`
            ba:1f:b3:93:81:27:0f:17:4a:68:d5:34:b8:ff:
            32:b4:c8:1e:9c:e6:b2:53:3a:bb:55:44:33:a6:51:
            c7:ce:7e:7d:1f:d6:9e:b6:5b:98:a0:72:29:b9:bc:
            e0:5d:d4:e2:3f:bd:48:64:de:99:ef:45:58:f7:06:
            ef:91:3b:d1:37:bb:7e:31:46:0b:16:16:2b:f0:a2:
            db:1c:8b:b8:df:01:aa:4d:c1:5c:a5:48:44:e9:2a:
            ac:28:5b:b1:0f:b2:28:3c:20:f4:c0:3d:39:ff:d8:
            00:23:60:79:f4:b3:e9:2c:2e:5b:68:0d:cc:f4:e0:
            f8:4f:0a:a8:61:a7:d3:92:28:d0:94:2d:c8:8f:4b:
            d1:b7:f5:5a:75:44:76:d7:39:70:d6:d7:dc:e8:48:
            db:5e:c0:a0:62:3b:10:7d:72:48:4f:21:4a:6c:04:
            75:90:b4:12:fc:f8:59:9d:15:e6:87:db:e5:35:14:
            c4:24:9b:9d:80:86:65:fe:17:1f:ec:6a:b5:c8:d7:
            02:71:b9:30:a5:47:61:a5:9c:3f:02:42:0d:86:91:
            fe:bf:0a:b9:d1:62:98:91:50:81:c1:84:1a:94:d4:
            f1:76:7e:b2:70:9f:34:e6:14:3c:13:fc:ff:ef:41:
            9c:87:5f:c2:1f:9a:97:ac:e4:ef:ea:55:1a:22:d7:
            82:47`))
    })

    it('decodes the extensions like openssl x509 -text', () => {
        expect(c.extensions.map(e => [e.name, e.critical])).toEqual([
            ['basicConstraints', true],
            ['keyUsage', true],
            ['extendedKeyUsage', false],
            ['subjectKeyIdentifier', false],
            ['subjectAltName', false],
        ])
        expect(c.isCa).toBe(false) // CA:FALSE
        expect(opensslKeyUsage(c)).toBe('Digital Signature, Key Encipherment')
        expect(ext(c, '2.5.29.37').parsed.usages).toEqual([{ oid: '1.3.6.1.5.5.7.3.1', label: 'TLS server authentication' }])
        expect(c.subjectKeyId).toBe('AF:E1:85:51:B7:50:8A:DD:73:3E:E6:FC:71:E5:B5:7E:6A:E3:C0:88')
        expect(opensslSan(c)).toBe('DNS:www.example.test, DNS:*.example.test, IP Address:192.0.2.10, IP Address:2001:DB8:0:0:0:0:0:10, email:admin@example.test, URI:https://example.test/path?q=1, othername: UPN::user@example.test, DirName:/C=RO/O=Directory Org/CN=Directory Name, Registered ID:1.2.3.4')
        // Our display form: compressed IPv6 (RFC 5952) and RFC 4514 directory names
        expect(rows(ext(c, '2.5.29.17'))).toEqual([
            'DNS: www.example.test',
            'DNS: *.example.test',
            'IP address: 192.0.2.10',
            'IP address: 2001:db8::10',
            'Email: admin@example.test',
            'URI: https://example.test/path?q=1',
            'UPN: user@example.test',
            'Directory name: CN=Directory Name,O=Directory Org,C=RO',
            'Registered ID: 1.2.3.4',
        ])
    })

    it('computes the fingerprints and SPKI pin', async () => {
        expect(await fingerprints(c.der)).toEqual({
            sha256: '3B:6D:23:D3:49:A5:D1:CA:D1:FD:0D:66:3F:F2:0A:19:EB:F2:71:86:85:84:F0:72:59:9F:62:64:C8:AE:F5:F3',
            sha1: '03:35:F1:31:1B:31:BA:B2:2B:0E:76:AA:E6:62:5D:ED:98:15:60:F0',
        })
        expect(await spkiPin(c.publicKey.der)).toBe('FvMiI2xaPgMhOtgflWueBDgrOAyMvde0ZXfTKPLk4YU=')
    })

    it('verifies its self-signature, and rejects tampered data', async () => {
        expect(await verifyBy(c, c)).toEqual({ status: 'valid' })
        const tampered = c.tbsDer.slice()
        tampered[tampered.length - 10] ^= 1
        expect(await verifySignature({ data: tampered, signature: c.signature, algorithm: c.signatureAlgorithm, publicKey: c.publicKey })).toEqual({ status: 'invalid', reason: 'The signature doesn’t match.' })
    })

    it('reads the same certificate from DER, bare Base64 and hex', () => {
        const der = new Uint8Array(fixture('rsa-san.der'))
        const fromFile = decode(der)
        expect(fromFile).toHaveLength(1)
        expect(fromFile[0].source).toBe('DER file')
        expect(subject(fromFile[0].certificate)).toBe(subject(c))
        const base64 = text('rsa-san.pem').replace(/-----[^-]+-----/g, '').trim()
        const fromBase64 = decode(base64)
        expect(fromBase64[0].source).toBe('Base64 DER')
        expect(fromBase64[0].certificate.serial.hex).toBe(c.serial.hex)
        const hexText = Buffer.from(der).toString('hex').match(/../g).join(':')
        const fromHex = decode(hexText)
        expect(fromHex[0].source).toBe('hex DER')
        expect(toHex(fromHex[0].certificate.der)).toBe(toHex(der))
    })
})

describe('three-level chain (chain.pem)', () => {
    const [leaf, intermediate, root] = certs('chain.pem')

    it('decodes the root CA', async () => {
        expect(root.serial.hex).toBe('1001')
        expect(root.serial.decimal).toBe('4097') // Serial Number: 4097 (0x1001)
        expect(root.signatureAlgorithm.name).toBe('sha512WithRSAEncryption')
        expect(subject(root)).toBe('C=RO, O=Toolbelt Test PKI, OU=Test only, CN=Toolbelt Test Root CA')
        expect(issuer(root)).toBe(subject(root))
        expect(iso(root.notBefore)).toBe('2026-11-21T18:25:10.000Z')
        expect(iso(root.notAfter)).toBe('2036-11-18T18:25:10.000Z')
        expect(root.publicKey.summary).toBe('RSA 3072-bit')
        expect(root.isCa).toBe(true)
        expect(root.pathLen).toBe(null)
        expect(opensslKeyUsage(root)).toBe('Certificate Sign, CRL Sign')
        expect(root.subjectKeyId).toBe('66:B5:C7:B1:95:2E:27:99:4C:64:23:BC:5D:B2:72:AC:79:D5:A3:3B')
        expect(await fingerprints(root.der)).toEqual({
            sha256: 'D3:2D:5D:48:F6:3F:35:14:8A:EE:F1:89:0C:FE:65:26:68:B1:D9:66:00:A6:B4:1C:7B:CE:67:84:79:CC:4D:29',
            sha1: 'F4:D2:65:EC:25:9E:E2:59:11:8E:F2:D4:BB:8A:06:11:74:69:10:46',
        })
        expect(await spkiPin(root.publicKey.der)).toBe('0nN7Tj+/gKb7pNmqqYsONM70GPhRBiFRuvQ5QbPCfMI=')
    })

    it('decodes the intermediate CA, including its name constraints', async () => {
        expect(intermediate.serial.decimal).toBe('8194') // Serial Number: 8194 (0x2002)
        expect(intermediate.signatureAlgorithm.name).toBe('sha384WithRSAEncryption')
        expect(subject(intermediate)).toBe('C=RO, O=Toolbelt Test PKI, CN=Toolbelt Test Intermediate CA')
        expect(issuer(intermediate)).toBe('C=RO, O=Toolbelt Test PKI, OU=Test only, CN=Toolbelt Test Root CA')
        expect(iso(intermediate.notAfter)).toBe('2031-11-20T18:25:11.000Z')
        expect(intermediate.publicKey.summary).toBe('EC P-384')
        expect(intermediate.publicKey.curve.aliases).toBe('secp384r1')
        expect(intermediate.isCa).toBe(true)
        expect(intermediate.pathLen).toBe(0) // CA:TRUE, pathlen:0
        expect(opensslKeyUsage(intermediate)).toBe('Digital Signature, Certificate Sign, CRL Sign')
        expect(intermediate.subjectKeyId).toBe('3F:69:AB:9A:74:16:B6:2B:56:B0:25:FB:57:20:74:A9:4D:B4:8C:AF')
        expect(intermediate.authorityKeyId).toBe(root.subjectKeyId)
        const nc = ext(intermediate, '2.5.29.30')
        expect(nc.critical).toBe(true)
        expect(nc.parsed.permitted.map(opensslName)).toEqual(['DNS:example.test', 'email:example.test'])
        expect(nc.parsed.excluded.map(n => `IP:${opensslIp(n.value)}`)).toEqual(['IP:192.168.0.0/255.255.0.0', 'IP:FD00:0:0:0:0:0:0:0/FF00:0:0:0:0:0:0:0'])
        expect(nc.parsed.excluded.map(n => n.value)).toEqual(['192.168.0.0/16', 'fd00::/8'])
        expect(rows(ext(intermediate, '2.5.29.32'))).toEqual(['Policy: Any policy'])
        expect(rows(ext(intermediate, '2.5.29.31'))).toEqual(['URI: http://crl.example.test/root.crl'])
        expect(rows(ext(intermediate, '1.3.6.1.5.5.7.1.1'))).toEqual(['CA issuers: http://ca.example.test/root.crt'])
        expect((await fingerprints(intermediate.der)).sha256).toBe('D7:B9:2A:3E:93:F7:A9:1B:26:EB:5C:ED:EB:B5:21:CB:D4:57:9B:56:87:97:D7:4A:D2:9F:C1:19:6A:97:3D:13')
        expect(await spkiPin(intermediate.publicKey.der)).toBe('Nv6PgfUT9h8ovPR+ZVKl0Hrk0hGWkyYh4HUnKBcnd00=')
    })

    it('decodes the EC P-256 leaf and all its extensions', async () => {
        expect(leaf.serial.hex).toBe('5EAF00D5EAF00D5EAF00D5EAF00D')
        expect(leaf.signatureAlgorithm.name).toBe('ecdsa-with-SHA384')
        expect(subject(leaf)).toBe('C=RO, O=Toolbelt Test PKI, CN=leaf.example.test')
        expect(issuer(leaf)).toBe('C=RO, O=Toolbelt Test PKI, CN=Toolbelt Test Intermediate CA')
        expect(iso(leaf.notBefore)).toBe('2026-11-21T18:25:11.000Z')
        expect(iso(leaf.notAfter)).toBe('2027-12-23T18:25:11.000Z')
        expect(leaf.publicKey.summary).toBe('EC P-256')
        expect(toHex(leaf.publicKey.ec.point)).toBe(hex(`04:7e:ef:51:dc:7e:46:4a:91:f3:6e:f6:45:4f:fa:fe:69:89:f6:d2:82:48:6b:ba:91:5b:95:a0:20:9b:
            c3:66:a2:f3:e5:77:75:a4:ff:89:5c:16:9d:b9:70:00:fc:c0:a0:bb:5f:51:5c:b6:2f:fd:01:6e:3c:38:44:6a:f4:20:37`))
        expect(leaf.isCa).toBe(false)
        expect(opensslKeyUsage(leaf)).toBe('Digital Signature')
        expect(ext(leaf, '2.5.29.37').parsed.usages.map(u => u.label)).toEqual(['TLS server authentication', 'TLS client authentication'])
        expect(leaf.subjectKeyId).toBe('13:69:4B:A9:AC:72:BD:BD:96:6D:FB:A0:D3:58:F9:A7:59:0F:97:41')
        expect(leaf.authorityKeyId).toBe(intermediate.subjectKeyId)
        expect(opensslSan(leaf)).toBe('DNS:leaf.example.test, DNS:api.example.test')
        expect(rows(ext(leaf, '2.5.29.31'))).toEqual(['URI: http://crl.example.test/intermediate.crl'])
        expect(rows(ext(leaf, '1.3.6.1.5.5.7.1.1'))).toEqual(['OCSP: http://ocsp.example.test', 'CA issuers: http://ca.example.test/intermediate.crt'])
        expect(rows(ext(leaf, '2.5.29.32'))).toEqual([
            'Policy: Domain Validated (DV)',
            'Policy: 1.3.6.1.4.1.55555.1.1',
            'CPS: https://example.test/cps',
            'User notice: Test certificate, do not trust',
        ])
        expect(ext(leaf, '1.3.6.1.5.5.7.1.24').parsed.features).toEqual(['status_request (OCSP Must-Staple)'])
        expect(ext(leaf, '1.3.6.1.4.1.11129.2.4.2').parsed.count).toBe(2) // two "Signed Certificate Timestamp" entries
        expect(await fingerprints(leaf.der)).toEqual({
            sha256: '13:FA:D9:81:13:75:39:10:13:0C:57:04:7A:1B:ED:F5:D8:B1:3E:9F:B5:C3:93:59:F2:5E:96:05:87:14:E0:16',
            sha1: 'DB:B7:D4:AE:43:57:98:5C:6F:C3:A4:EB:28:09:6B:51:BA:3F:37:C5',
        })
        expect(await spkiPin(leaf.publicKey.der)).toBe('jIAc51Kr1ap79QZoTJSWTXfVxllBDonkifcaFKF5nEU=')
    })

    it('converts the ECDSA signature to raw r‖s', () => {
        const signature = hex(`30:66:02:31:00:ad:39:81:77:7a:4e:02:9d:63:f9:f5:ac:64:
            0b:1e:7a:fb:8b:cf:19:44:6d:93:f2:49:9b:25:f6:0b:4f:7e:89:81:49:5b:62:87:4c:51:27:0e:7d:b4:db:38:e1:a7:3f:02:
            31:00:e4:e6:97:9d:8d:3b:66:e8:c4:f1:48:84:b5:5f:94:71:0d:f0:fa:b4:c7:07:d2:50:b1:09:37:aa:1b:c1:f7:b8:65:a5:
            60:c2:53:e4:1d:cc:48:db:5d:42:11:eb:d9:ba`)
        expect(toHex(leaf.signature)).toBe(signature)
        const raw = ecdsaDerToRaw(leaf.signature, 48)
        expect(raw).toHaveLength(96)
        expect(toHex(raw)).toBe(signature.slice(10, 106) + signature.slice(-96))
        // Short values are left-padded with zeros
        expect(toHex(ecdsaDerToRaw(Uint8Array.of(0x30, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07), 4))).toBe('0000000500000007')
        expect(() => ecdsaDerToRaw(Uint8Array.of(0x30, 0x06, 0x02, 0x01, 0x05, 0x02, 0x01, 0xff), 4)).toThrow(/positive/)
        expect(() => ecdsaDerToRaw(Uint8Array.of(0x30, 0x07, 0x02, 0x02, 0x01, 0x05, 0x02, 0x01, 0x07), 1)).toThrow(/too long/)
    })

    it('verifies every signature with the issuer’s key', async () => {
        expect(await verifyBy(leaf, intermediate)).toEqual({ status: 'valid' }) // ECDSA P-384, SHA-384
        expect(await verifyBy(intermediate, root)).toEqual({ status: 'valid' }) // RSA, SHA-384
        expect(await verifyBy(root, root)).toEqual({ status: 'valid' }) // RSA, SHA-512
        expect(await verifyBy(leaf, root)).toEqual({ status: 'invalid', reason: 'The signature is ECDSA, but the issuer’s key is RSA 3072-bit.' })
        expect((await verifyBy(intermediate, cert('rsa-san.pem'))).status).toBe('invalid')
    })

    it('reports a complete chain', () => {
        const chain = analyzeChain([leaf, intermediate, root])
        expect(chain.roles).toEqual(['leaf', 'intermediate', 'root'])
        expect(chain.links).toEqual([{ names: 'exact', keyIds: true, ok: true }, { names: 'exact', keyIds: true, ok: true }])
        expect(chain.issues).toEqual([])
        expect(chain.related).toBe(true)
        expect(chain.linked).toBe(2)
        expect(chain.endsAtRoot).toBe(true)
        expect(chain.suggestedOrder).toBe(null)
        const partial = analyzeChain([leaf, intermediate])
        expect(partial.roles).toEqual(['leaf', 'intermediate'])
        expect(partial.endsAtRoot).toBe(false)
        expect(partial.issues).toEqual([])
    })

    it('flags breaks and finds the right order', () => {
        const reversed = analyzeChain([root, intermediate, leaf])
        expect(reversed.links.map(l => l.ok)).toEqual([false, false])
        expect(reversed.suggestedOrder).toEqual([2, 1, 0])
        expect(reversed.issues).toEqual([
            'Certificate 1 is self-signed, so a chain ends there: certificate 2 isn’t its issuer.',
            'Break between certificate 2 and certificate 3: the issuer of certificate 2 (CN=Toolbelt Test Root CA,OU=Test only,O=Toolbelt Test PKI,C=RO) isn’t the subject of certificate 3 (CN=leaf.example.test,O=Toolbelt Test PKI,C=RO).',
        ])
        const shuffled = analyzeChain([intermediate, leaf, root])
        expect(shuffled.suggestedOrder).toEqual([1, 0, 2])
        expect(shuffled.issues[0]).toBe('Break between certificate 1 and certificate 2: the issuer of certificate 1 (CN=Toolbelt Test Root CA,OU=Test only,O=Toolbelt Test PKI,C=RO) isn’t the subject of certificate 2 (CN=leaf.example.test,O=Toolbelt Test PKI,C=RO).')
        // Out of order, the leaf below the pathlen-0 intermediate isn't counted as an extra CA
        const rootFirst = analyzeChain([root, leaf, intermediate])
        expect(rootFirst.suggestedOrder).toEqual([1, 2, 0])
        expect(rootFirst.issues).toEqual(['Certificate 1 is self-signed, so a chain ends there: certificate 2 isn’t its issuer.'])
        // Two self-signed roots with the same name (as in real CA bundles) don't link up
        const twin = { ...root, authorityKeyId: null, subjectKeyId: null }
        const twins = analyzeChain([twin, root])
        expect(twins.links[0]).toEqual({ names: 'exact', keyIds: null, ok: false, selfSigned: true })
        expect(twins.related).toBe(false)
        const unrelated = analyzeChain([leaf, cert('rsa-san.pem')])
        expect(unrelated.related).toBe(false)
        expect(unrelated.roles).toEqual([null, null])
        expect(unrelated.suggestedOrder).toBe(null)
        expect(analyzeChain([cert('rsa-san.pem')]).roles).toEqual(['self-signed'])
    })

    it('flags key ID mismatches, non-CA issuers and path length violations', () => {
        const san = cert('rsa-san.pem')
        const wrongKeyId = analyzeChain([{ ...leaf, authorityKeyId: 'AA:BB' }, intermediate])
        expect(wrongKeyId.links[0]).toEqual({ names: 'exact', keyIds: false, ok: false })
        expect(wrongKeyId.issues).toEqual(['Break between certificate 1 and certificate 2: the authority key ID of certificate 1 doesn’t match the subject key ID of certificate 2.'])
        const nonCa = analyzeChain([{ ...leaf, issuer: san.subject, authorityKeyId: san.subjectKeyId }, san])
        expect(nonCa.issues).toEqual([
            'Certificate 2 isn’t a CA certificate (basic constraints), so it can’t issue certificate 1.',
            'Certificate 2’s key usage doesn’t include certificate signing.',
        ])
        // leaf ← extra intermediate ← intermediate (pathlen 0) ← root
        const otherName = cert('ed25519.pem').subject
        const extra = { ...intermediate, subject: otherName, subjectKeyId: '01:02', issuer: intermediate.subject, authorityKeyId: intermediate.subjectKeyId, pathLen: null }
        const tooLong = analyzeChain([{ ...leaf, issuer: otherName, authorityKeyId: '01:02' }, extra, intermediate, root])
        expect(tooLong.links.every(l => l.ok)).toBe(true)
        expect(tooLong.issues).toEqual(['Certificate 3 allows 0 intermediate CAs below it (path length 0), but this chain has 1.'])
    })

    it('reads the same chain from PKCS#7 bundles (DER and PEM)', async () => {
        for (const input of [new Uint8Array(fixture('chain.p7b')), text('chain-pkcs7.pem')]) {
            const items = decode(input)
            expect(items[0]).toMatchObject({ kind: 'bundle', message: 'PKCS#7 bundle with 3 certificates.' })
            const bundled = items.filter(i => i.kind === 'certificate')
            expect(bundled.map(i => i.source.replace(/^.* · /, ''))).toEqual(['certificate 1 of 3', 'certificate 2 of 3', 'certificate 3 of 3'])
            expect(bundled.map(i => toHex(i.certificate.der))).toEqual([leaf, intermediate, root].map(c => toHex(c.der)))
        }
    })
})

describe('Ed25519 version 1 certificate (ed25519.pem)', () => {
    const c = cert('ed25519.pem')

    it('has no version field and no extensions', () => {
        expect(c.version).toBe(1) // Version: 1 (0x0)
        expect(c.extensions).toEqual([])
        expect(c.serial.decimal).toBe('16388') // 16388 (0x4004)
        expect(c.signatureAlgorithm.name).toBe('ED25519')
        expect(subject(c)).toBe('O=Toolbelt Test, CN=ed25519.example.test')
        expect(c.selfIssued).toBe(true)
        expect(c.isCa).toBe(null)
        expect(c.warnings).toEqual([])
    })

    it('reads the key, the JWK and the fingerprints', async () => {
        const pub = hex('82:52:9e:be:cc:39:7a:03:75:d8:ac:7a:b9:34:f4:3f:fc:11:5a:73:ea:d1:0f:58:f9:8c:07:4d:32:0b:73:08')
        expect(c.publicKey.type).toBe('Ed25519')
        expect(toHex(c.publicKey.okp.x)).toBe(pub)
        expect(publicKeyToJwk(c.publicKey)).toEqual({ jwk: { kty: 'OKP', crv: 'Ed25519', x: b64url(pub) } })
        expect((await fingerprints(c.der)).sha256).toBe('B6:0C:47:08:C1:E8:8B:AD:A1:C1:47:DA:E8:F9:FF:ED:6C:F8:0A:31:89:94:81:5E:6B:3E:55:38:EF:0E:20:0A')
        expect(await spkiPin(c.publicKey.der)).toBe('Ln668qLYj9smZ84xCTSBJy167y422Qx34/VtXJvuwKI=')
        expect(await verifyBy(c, c)).toEqual({ status: 'valid' })
    })
})

describe('RSA-PSS certificate valid from 1999 to 2051 (rsa-dates.pem)', () => {
    const c = cert('rsa-dates.pem')

    it('maps the UTCTime year 99 to 1999 and keeps the 2051 GeneralizedTime', () => {
        expect(c.notBefore).toMatchObject({ type: 'UTCTime', text: '990101000000Z', rfc5280: true })
        expect(iso(c.notBefore)).toBe('1999-01-01T00:00:00.000Z') // Not Before: Jan  1 00:00:00 1999 GMT
        expect(c.notAfter).toMatchObject({ type: 'GeneralizedTime', text: '20510101000000Z', rfc5280: true })
        expect(iso(c.notAfter)).toBe('2051-01-01T00:00:00.000Z') // Not After : Jan  1 00:00:00 2051 GMT
        expect(c.warnings).toEqual([])
    })

    it('decodes BMPString and TeletexString names', () => {
        expect(subject(c)).toBe('C=RO, L=Iași, O=Ünïcödé Test, CN=dates.example.test')
        expect(c.subject.rdns.map(([a]) => a.type)).toEqual(['PrintableString', 'BMPString', 'TeletexString', 'PrintableString'])
    })

    it('reads the RSA-PSS parameters and verifies the signature', async () => {
        expect(c.serial).toMatchObject({ hex: '7F', decimal: '127' })
        expect(c.signatureAlgorithm.name).toBe('rsassaPss')
        expect(c.signatureAlgorithm.pss).toEqual({ hash: 'SHA-256', mgfHash: 'SHA-256', saltLength: 32, trailerField: 1 }) // Salt Length: 0x20
        expect(c.signatureAlgorithm.label).toBe('RSASSA-PSS (SHA-256, MGF1 with SHA-256, 32 bytes of salt)')
        expect(c.subjectKeyId).toBe('48:CB:C4:76:01:7B:C6:EF:63:08:48:6B:7A:86:1F:F3:AE:F4:79:33')
        expect((await fingerprints(c.der)).sha1).toBe('0B:F3:EF:CC:AE:5F:7A:EE:93:85:24:21:38:14:44:CA:CC:02:60:B1')
        expect(await spkiPin(c.publicKey.der)).toBe('o2IlODBrF2TlbAEiD8pcu43dSDVinu3VI2nS2L0nMrU=')
        expect(await verifyBy(c, c)).toEqual({ status: 'valid' })
        const otherSaltLength = { ...c.signatureAlgorithm, pss: { ...c.signatureAlgorithm.pss, saltLength: 20 } }
        expect((await verifySignature({ data: c.tbsDer, signature: c.signature, algorithm: otherSaltLength, publicKey: c.publicKey })).status).toBe('invalid')
        const mixedHashes = { ...c.signatureAlgorithm, pss: { ...c.signatureAlgorithm.pss, mgfHash: 'SHA-1' } }
        expect((await verifySignature({ data: c.tbsDer, signature: c.signature, algorithm: mixedHashes, publicKey: c.publicKey })).status).toBe('unsupported')
    })
})

describe('certificate requests', () => {
    it('decodes csr-ec.csr like openssl req -text and verifies it', async () => {
        const [item] = decode(text('csr-ec.csr'))
        expect(item.kind).toBe('csr')
        const { csr } = item
        expect(csr.version).toBe(1)
        expect(formatName(csr.subject, { style: 'openssl' })).toBe('C=RO, O=Toolbelt Test, CN=csr.example.test')
        expect(csr.publicKey.summary).toBe('EC P-256')
        expect(csr.signatureAlgorithm.name).toBe('ecdsa-with-SHA256')
        expect(csr.extensions.map(e => [e.name, e.critical])).toEqual([
            ['basicConstraints', false],
            ['keyUsage', true],
            ['extendedKeyUsage', false],
            ['subjectAltName', false],
        ])
        expect(opensslSan(csr)).toBe('DNS:csr.example.test, DNS:www.csr.example.test, IP Address:198.51.100.7, email:csr@example.test')
        expect(csr.attributes).toEqual([
            { oid: '1.2.840.113549.1.9.2', label: 'Unstructured name', value: 'Toolbelt test request' },
            { oid: '1.2.840.113549.1.9.7', label: 'Challenge password', value: 'Set (not shown)' },
        ])
        expect(JSON.stringify(item)).not.toContain('test-challenge-password')
        expect(toHex(csr.signature)).toBe(hex(`30:46:02:21:00:db:21:10:18:15:42:32:d8:e5:e0:eb:32:f2:a1:6b:c9:00:43:f6:3e:d8:35:02:9a:96:6e:f0:41:11:69:22:
            fc:02:21:00:d8:49:08:de:98:5f:06:10:b3:d2:bf:0f:da:03:6d:d0:4f:f0:b9:2c:ca:aa:92:e8:2e:53:0a:b3:de:b2:53:36`))
        expect(await verifySignature({ data: csr.infoDer, signature: csr.signature, algorithm: csr.signatureAlgorithm, publicKey: csr.publicKey })).toEqual({ status: 'valid' }) // "self-signature verify OK"
        expect(await spkiPin(csr.publicKey.der)).toBe('+m0Qq6QQ43hX3m0NaOO1sWkILSBJy8qTzPOz7NzSGl0=')
    })

    it('accepts the NEW CERTIFICATE REQUEST label and unlabelled DER', () => {
        const pem = text('csr-ec.csr')
        expect(decode(pem.replace(/CERTIFICATE REQUEST/g, 'NEW CERTIFICATE REQUEST'))[0].kind).toBe('csr')
        expect(decode(pem.replace(/-----[^-]+-----/g, ''))[0].kind).toBe('csr')
    })

    it('decodes less common extensions as openssl req -text does (csr-extensions.csr)', () => {
        const { csr } = decode(text('csr-extensions.csr'))[0]
        const byName = (name) => csr.extensions.find(e => e.name === name)
        expect(rows(byName('crlDistributionPoints'))).toEqual([
            'URI: http://crl.example.test/a.crl',
            'Reasons: Key compromise, CA compromise', // Key Compromise, CA Compromise
            'CRL issuer Directory name: CN=CRL Issuer,C=RO', // DirName:C = RO, CN = CRL Issuer
            'Relative name: CN=Relative CRL',
        ])
        expect(rows(byName('freshestCRL'))).toEqual(['URI: http://crl.example.test/delta.crl'])
        expect(rows(byName('issuerAltName'))).toEqual(['Email: ca@example.test', 'URI: https://ca.example.test'])
        expect(rows(byName('subjectInfoAccess'))).toEqual(['CA repository: http://repo.example.test/'])
        expect(rows(byName('policyConstraints'))).toEqual(['Require explicit policy: after 1 certificate', 'Inhibit policy mapping: after 2 certificates'])
        expect(rows(byName('inhibitAnyPolicy'))).toEqual(['After 3 certificates'])
        expect(rows(byName('policyMappings'))).toEqual(['1.3.6.1.4.1.55555.1.1 → 1.3.6.1.4.1.55555.1.2'])
        expect(rows(byName('nsCertType'))).toEqual(['SSL client, SSL server'])
        expect(rows(byName('nsComment'))).toEqual(['Generated by the test suite'])
        expect(byName('noCheck').parsed.kind).toBe('text')
        const unknownCritical = csr.extensions.find(e => e.oid === '1.3.6.1.4.1.55555.9.1')
        expect(unknownCritical).toMatchObject({ critical: true, known: false, parsed: null, label: 'Unknown extension' })
        expect(toHex(unknownCritical.value)).toBe('0403010203')
        expect(rows(csr.extensions.find(e => e.oid === '1.3.6.1.4.1.55555.9.2'))).toEqual(['Custom text value'])
        expect(csr.warnings).toEqual(['Unknown critical extension 1.3.6.1.4.1.55555.9.1: software that doesn’t understand it must reject the certificate.'])
    })
})

describe('public keys', () => {
    const san = cert('rsa-san.pem')

    async function roundTrip(jwk, algorithm) {
        const key = await crypto.subtle.importKey('jwk', jwk, algorithm, true, ['verify'])
        return new Uint8Array(await crypto.subtle.exportKey('spki', key))
    }

    it('reads SPKI and PKCS#1 RSA keys (pub-rsa.pem, pub-rsa-pkcs1.pem)', async () => {
        for (const [name, format] of [['pub-rsa.pem', 'SubjectPublicKeyInfo'], ['pub-rsa-pkcs1.pem', 'PKCS#1']]) {
            const [item] = decode(text(name))
            expect(item).toMatchObject({ kind: 'publicKey', format })
            expect(item.publicKey.summary).toBe('RSA 2048-bit')
            expect(toHex(item.publicKey.rsa.n)).toBe(toHex(san.publicKey.rsa.n))
            expect(await spkiPin(item.publicKey.der)).toBe('FvMiI2xaPgMhOtgflWueBDgrOAyMvde0ZXfTKPLk4YU=') // same pin as the certificate
            const { jwk } = publicKeyToJwk(item.publicKey)
            expect(jwk.e).toBe('AQAB')
            expect(jwk.n).toBe(Buffer.from(san.publicKey.rsa.n).toString('base64url'))
            expect(toHex(await roundTrip(jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }))).toBe(toHex(item.publicKey.der))
        }
    })

    it('reads an EC P-256 key and exports a JWK that WebCrypto accepts (pub-ec.pem)', async () => {
        const [item] = decode(text('pub-ec.pem'))
        const point = hex(`04:7e:ef:51:dc:7e:46:4a:91:f3:6e:f6:45:4f:fa:fe:69:89:f6:d2:82:48:6b:ba:91:5b:95:a0:20:9b:
            c3:66:a2:f3:e5:77:75:a4:ff:89:5c:16:9d:b9:70:00:fc:c0:a0:bb:5f:51:5c:b6:2f:fd:01:6e:3c:38:44:6a:f4:20:37`)
        expect(item.publicKey.curve.name).toBe('P-256') // ASN1 OID: prime256v1, NIST CURVE: P-256
        const { jwk } = publicKeyToJwk(item.publicKey)
        expect(jwk).toEqual({ kty: 'EC', crv: 'P-256', x: b64url(point.slice(2, 66)), y: b64url(point.slice(66)) })
        expect(toHex(await roundTrip(jwk, { name: 'ECDSA', namedCurve: 'P-256' }))).toBe(toHex(item.publicKey.der))
        expect(await spkiPin(item.publicKey.der)).toBe('jIAc51Kr1ap79QZoTJSWTXfVxllBDonkifcaFKF5nEU=')
    })

    it('reads an Ed25519 key (pub-ed25519.pem)', async () => {
        const [item] = decode(text('pub-ed25519.pem'))
        const { jwk } = publicKeyToJwk(item.publicKey)
        expect(jwk).toEqual({ kty: 'OKP', crv: 'Ed25519', x: b64url(hex('82:52:9e:be:cc:39:7a:03:75:d8:ac:7a:b9:34:f4:3f:fc:11:5a:73:ea:d1:0f:58:f9:8c:07:4d:32:0b:73:08')) })
        expect(toHex(await roundTrip(jwk, { name: 'Ed25519' }))).toBe(toHex(item.publicKey.der))
    })

    it('explains when a JWK can’t be made', () => {
        const ecKey = decode(text('pub-ec.pem'))[0].publicKey
        expect(publicKeyToJwk({ ...ecKey, ec: { ...ecKey.ec, compressed: true } }).reason).toMatch(/compressed point/)
        expect(publicKeyToJwk({ ...ecKey, curve: { name: 'brainpoolP256r1' } }).reason).toBe('JWK has no name for the brainpoolP256r1 curve.')
        expect(publicKeyToJwk({ type: 'unknown' }).reason).toBe('JWK export isn’t available for this key type.')
    })
})

describe('private keys are described, never exposed', () => {
    const describe1 = (name) => {
        const items = decode(text(name))
        expect(items).toHaveLength(1)
        expect(items[0].kind).toBe('privateKey')
        // No key bytes anywhere in the result, and nothing that looks like encoded key material
        expect(byteArraysIn(items[0])).toEqual([])
        expect(JSON.stringify(items[0])).not.toMatch(/[A-Za-z0-9+/]{40}/)
        return items[0].privateKey
    }

    it('PKCS#1 RSA (test-key-rsa-pkcs1.key)', () => {
        expect(describe1('test-key-rsa-pkcs1.key')).toMatchObject({ type: 'RSA', bits: 2048, primes: 2, encrypted: false, formatLabel: 'PKCS#1 (traditional RSA)' }) // (2048 bit, 2 primes)
    })

    it('SEC 1 EC (test-key-ec-sec1.key)', () => {
        const key = describe1('test-key-ec-sec1.key')
        expect(key).toMatchObject({ type: 'EC', bits: 256, encrypted: false }) // Private-Key: (256 bit)
        expect(key.curve.name).toBe('P-256') // ASN1 OID: prime256v1
    })

    it('PKCS#8 Ed25519 (test-key-ed25519-pkcs8.key)', () => {
        expect(describe1('test-key-ed25519-pkcs8.key')).toMatchObject({ type: 'Ed25519', format: 'pkcs8', encrypted: false })
    })

    it('encrypted PKCS#8 (test-key-encrypted-pkcs8.key)', () => {
        const key = describe1('test-key-encrypted-pkcs8.key')
        expect(key.encrypted).toBe(true)
        expect(key.type).toBe('unknown')
        // PBES2 / PBKDF2 / INTEGER :0186A0 / hmacWithSHA256 / aes-256-cbc
        expect(key.encryption).toEqual({ scheme: 'PBES2', kdf: 'PBKDF2 with HMAC-SHA-256, 100,000 iterations', cipher: 'AES-256-CBC', iterations: 100000, summary: 'PBES2: PBKDF2 with HMAC-SHA-256, 100,000 iterations, AES-256-CBC' })
    })

    it('legacy encrypted PEM (test-key-rsa-legacy-encrypted.key)', () => {
        const key = describe1('test-key-rsa-legacy-encrypted.key')
        expect(key).toMatchObject({ type: 'RSA', encrypted: true, bits: null })
        expect(key.encryption.summary).toBe('Legacy OpenSSL PEM encryption (AES-256-CBC)') // DEK-Info: AES-256-CBC,…
    })

    it('unlabelled DER and unreadable blocks are still treated as secrets', () => {
        const body = text('test-key-rsa-pkcs1.key').split('-----')[2]
        const unlabelled = decode(body)
        expect(unlabelled[0].privateKey).toMatchObject({ type: 'RSA', bits: 2048 })
        const broken = inspect('-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\n-----END PRIVATE KEY-----')
        expect(broken.errors).toEqual([])
        expect(broken.items[0].kind).toBe('privateKey')
        expect(broken.items[0].privateKey.unsupported).toMatch(/Truncated data/)
        const ssh = inspect('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----').items[0]
        expect(ssh.kind).toBe('privateKey')
        expect(ssh.privateKey.unsupported).toMatch(/OpenSSH private keys/)
    })
})

describe('other containers', () => {
    it('reads OpenSSL TRUSTED CERTIFICATE trust settings (root-trusted.pem)', async () => {
        const [item] = decode(text('root-trusted.pem'))
        // Trusted Uses: TLS Web Server Authentication; Rejected Uses: E-mail Protection; Alias: Toolbelt Test Root
        expect(item.trust).toEqual({ trusted: ['TLS server authentication'], rejected: ['Email protection (S/MIME)'], alias: 'Toolbelt Test Root', keyId: null })
        // The fingerprint covers the certificate only, not the trust settings
        expect((await fingerprints(item.certificate.der)).sha256).toBe('D3:2D:5D:48:F6:3F:35:14:8A:EE:F1:89:0C:FE:65:26:68:B1:D9:66:00:A6:B4:1C:7B:CE:67:84:79:CC:4D:29')
    })

    it('reads DER certificates written one after another', () => {
        const der = (name) => Buffer.from(text(name).replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64')
        const items = decode(new Uint8Array(Buffer.concat([der('chain-leaf.pem'), der('chain-root.pem')])))
        expect(items.map(i => [i.source, i.certificate.commonName])).toEqual([
            ['DER file · element 1 of 2', 'leaf.example.test'],
            ['DER file · element 2 of 2', 'Toolbelt Test Root CA'],
        ])
    })

    it('reads EC PARAMETERS blocks', () => {
        const [item] = decode('-----BEGIN EC PARAMETERS-----\nBggqhkjOPQMBBw==\n-----END EC PARAMETERS-----')
        expect(item.kind).toBe('ecParameters')
        expect(item.curve.name).toBe('P-256')
    })
})

describe('input handling', () => {
    it('ignores text around blocks and handles CRLF line endings', () => {
        const pem = `Server certificate for www:\r\n${text('chain.pem').replace(/\r?\n/g, '\r\n')}\r\nThat was the chain.`
        const items = decode(pem)
        expect(items.map(i => i.certificate.commonName)).toEqual(['leaf.example.test', 'Toolbelt Test Intermediate CA', 'Toolbelt Test Root CA'])
        expect(items.map(i => i.source)).toEqual(['CERTIFICATE on line 2', 'CERTIFICATE on line 27', 'CERTIFICATE on line 52'])
    })

    it('reads a block pasted on a single line', () => {
        const oneLine = text('chain-leaf.pem').replace(/\r?\n/g, ' ')
        expect(decode(oneLine)[0].certificate.commonName).toBe('leaf.example.test')
    })

    it('explains broken blocks without stopping the others', () => {
        const leaf = text('chain-leaf.pem')
        const cut = leaf.slice(0, leaf.indexOf('-----END'))
        const result = inspect(`${cut}\n${text('chain-root.pem')}`)
        expect(result.errors).toEqual([{ source: 'Line 1', label: 'CERTIFICATE', message: 'The CERTIFICATE block on line 1 has no END line: the text looks cut off. Paste the whole block, from BEGIN to END.' }])
        expect(result.items.map(i => i.certificate.commonName)).toEqual(['Toolbelt Test Root CA'])
    })

    it('rejects mismatched END lines, bad Base64 and truncated data', () => {
        const leaf = text('chain-leaf.pem')
        expect(inspect(leaf.replace('END CERTIFICATE', 'END PUBLIC KEY')).errors[0].message).toBe('“BEGIN CERTIFICATE” on line 1 is closed by “END PUBLIC KEY”.')
        expect(inspect(leaf.replace(/\n(M)/, '\n#$1')).errors[0].message).toMatch(/^The CERTIFICATE block isn’t valid Base64: “#” isn't a Base64 character/)
        const lines = leaf.trim().split(/\r?\n/)
        // 7 Base64 lines = 336 bytes; the certificate is 4 + 1055 bytes (asn1parse: hl=4 l=1055)
        const truncated = [...lines.slice(0, 8), lines[lines.length - 1]].join('\n')
        expect(inspect(truncated).errors[0].message).toBe('Truncated data: an element needs 1055 bytes but the data has only 332 left (at byte 0)')
        expect(inspect('-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----').errors[0].message).toBe('The CERTIFICATE block is empty.')
    })

    it('says when a label doesn’t match the content', () => {
        const relabelled = text('pub-ec.pem').replace(/PUBLIC KEY/g, 'CERTIFICATE')
        expect(inspect(relabelled).errors[0].message).toBe('The CERTIFICATE block holds a public key, not a certificate. Check the BEGIN/END lines.')
    })

    it('names unsupported formats', () => {
        expect(inspect('-----BEGIN X509 CRL-----\nMAA=\n-----END X509 CRL-----').items[0]).toMatchObject({ kind: 'unsupported', message: 'Certificate revocation lists (CRLs) aren’t supported.' })
        expect(inspect('-----BEGIN FOO BAR-----\nMAA=\n-----END FOO BAR-----').items[0].message).toMatch(/^“FOO BAR” blocks aren’t supported/)
        expect(inspect('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl user@host').errors[0].message).toMatch(/OpenSSH public key/)
    })

    it('explains input that isn’t a certificate or key at all', () => {
        expect(inspect('hello world, no certificate here!').errors[0].message).toMatch(/^No certificate or key found/)
        expect(inspect('SGVsbG8gd29ybGQ=').errors[0].message).toMatch(/^The input looks like Base64 but doesn’t decode to a certificate or key/)
        expect(inspect('')).toEqual({ items: [], errors: [] })
        expect(inspect('   \n  ')).toEqual({ items: [], errors: [] })
        const png = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13)
        expect(inspect(png).errors[0].message).toBe('This file isn’t PEM text or DER data.')
        expect(inspect(new Uint8Array(0)).errors[0].message).toBe('The file is empty.')
        expect(inspect(Uint8Array.of(0x30, 0x03, 0x02, 0x01, 0x05)).errors[0].message).toBe('This DER data isn’t a certificate, certificate request, key or PKCS#7 bundle.')
    })

    it('never throws on corrupted certificates', () => {
        const der = new Uint8Array(fixture('rsa-san.der'))
        const started = Date.now()
        for (let i = 0; i < der.length; i += 3) {
            for (const value of [0x00, 0xff, der[i] ^ 0x01]) {
                const copy = der.slice()
                copy[i] = value
                const result = inspect(copy)
                expect(result.items.length + result.errors.length).toBeGreaterThan(0)
            }
        }
        expect(Date.now() - started).toBeLessThan(15_000)
    })

    it('lists the PEM labels it supports', () => {
        expect(SUPPORTED_PEM_LABELS).toEqual(expect.arrayContaining([
            'CERTIFICATE', 'TRUSTED CERTIFICATE', 'CERTIFICATE REQUEST', 'NEW CERTIFICATE REQUEST', 'PUBLIC KEY', 'RSA PUBLIC KEY',
            'PRIVATE KEY', 'ENCRYPTED PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY', 'PKCS7',
        ]))
    })
})

describe('names, IP addresses and OIDs', () => {
    it('escapes RFC 4514 special characters', () => {
        const name = { rdns: [[{ short: 'CN', value: ' a,b+c"d\\e<f>g;h ', hex: false }], [{ short: 'O', value: '#hash', hex: false }], [{ short: '1.2.3', value: '#0403010203', hex: true }]], der: new Uint8Array() }
        expect(formatName(name)).toBe('1.2.3=#0403010203,O=\\#hash,CN=\\ a\\,b\\+c\\"d\\\\e\\<f\\>g\\;h\\ ')
    })

    it('compares names exactly or after normalisation', () => {
        const name = (value, der) => ({ rdns: [[{ oid: '2.5.4.3', value, hex: false }]], der: Uint8Array.of(der) })
        expect(compareNames(name('Example  CA', 1), name('Example  CA', 1))).toBe('exact')
        expect(compareNames(name('Example  CA', 1), name(' example ca', 2))).toBe('equivalent')
        expect(compareNames(name('Example CA', 1), name('Other CA', 2))).toBe('different')
    })

    it('formats IP addresses as RFC 5952 recommends', () => {
        expect(formatIp(Uint8Array.of(192, 0, 2, 1))).toBe('192.0.2.1')
        expect(formatIp(new Uint8Array(16))).toBe('::')
        expect(formatIp(Uint8Array.of(0, 1, ...new Uint8Array(14)))).toBe('1::')
        expect(formatIp(Uint8Array.of(...new Uint8Array(15), 1))).toBe('::1')
        expect(formatIp(Uint8Array.of(0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0))).toBe('1:0:2:0:3:0:4:0') // single zero groups stay
        expect(formatIp(Uint8Array.of(0, 1, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 3, 0, 4))).toBe('1::2:0:0:3:4') // first of two equal runs
        expect(formatIp(Uint8Array.of(...new Uint8Array(10), 0xff, 0xff, 192, 0, 2, 1))).toBe('::ffff:192.0.2.1')
        expect(formatIp(Uint8Array.of(10, 0, 0, 0, 255, 0, 255, 0))).toBe('10.0.0.0/255.0.255.0') // non-contiguous mask
        expect(formatIp(Uint8Array.of(1, 2, 3))).toBe('invalid (3 bytes: 01:02:03)')
    })

    it('names OIDs', () => {
        expect(oidName('1.2.840.113549.1.1.11')).toBe('sha256WithRSAEncryption')
        expect(oidLabel('2.23.140.1.1')).toBe('Extended Validation (EV)')
        expect(oidLabel('2.23.140.1.2.2')).toBe('Organization Validated (OV)')
        expect(oidLabel('1.2.3.4.5')).toBe('1.2.3.4.5')
    })
})

describe('extension edge cases', () => {
    it('decodes an authority key identifier with issuer and serial', () => {
        const cn = tlv(0x30, tlv(0x31, tlv(0x30, [0x06, 0x03, 0x55, 0x04, 0x03], tlv(0x0c, utf8('Issuer')))))
        const value = Uint8Array.from(tlv(0x30, tlv(0x80, [0xab, 0xcd]), tlv(0xa1, tlv(0xa4, cn)), tlv(0x82, [0x10, 0x01])))
        const e = decodeExtension('2.5.29.35', value)
        expect(e.error).toBe(null)
        expect(rows(e)).toEqual(['Key ID: AB:CD', 'Issuer Directory name: CN=Issuer', 'Issuer serial: 10:01'])
    })

    it('keeps malformed values as errors instead of throwing', () => {
        expect(decodeExtension('2.5.29.17', Uint8Array.of(0x30, 0x03, 0x82, 0x05, 0x61)).error).toMatch(/^Truncated data/)
        expect(decodeExtension('2.5.29.17', Uint8Array.from(tlv(0x30, tlv(0x89, [1])))).error).toMatch(/^Unknown name type \[9\]/)
        expect(decodeExtension('2.5.29.19', Uint8Array.of(0x04, 0x00)).error).toMatch(/^Basic constraints: expected SEQUENCE, found OCTET STRING/)
        expect(decodeExtension('1.3.6.1.4.1.11129.2.4.2', Uint8Array.from(tlv(0x04, [0x00, 0x05, 0x00, 0x03, 0x01]))).error).toMatch(/SCT list/)
        const unknown = decodeExtension('1.2.3.4', Uint8Array.of(0xde, 0xad))
        expect(unknown).toMatchObject({ error: null, parsed: null, known: false, label: 'Unknown extension' })
    })
})

describe('validityStatus', () => {
    const notBefore = Date.parse('2026-11-21T18:25:11Z')
    const notAfter = Date.parse('2027-12-23T18:25:11Z') // the leaf certificate
    const at = (when) => validityStatus(notBefore, notAfter, Date.parse(when), { startOfDay: startOfUtcDay })

    it('counts calendar days to expiry', () => {
        expect(at('2027-03-01T12:00:00Z')).toEqual({ state: 'valid', days: 297, tone: 'success', text: 'Valid · expires in 297 days' })
        expect(at('2027-11-23T00:00:00Z')).toMatchObject({ days: 30, tone: 'warning' })
        expect(at('2027-11-22T23:59:59Z')).toMatchObject({ days: 31, tone: 'success' })
        expect(at('2027-12-22T23:59:00Z').text).toBe('Valid · expires in 1 day')
        expect(at('2027-12-23T01:00:00Z')).toMatchObject({ state: 'valid', text: 'Valid · expires today', tone: 'warning' })
        expect(at('2027-12-23T18:25:11Z').state).toBe('valid') // notAfter itself is still valid
    })

    it('counts days since expiry and until the start', () => {
        expect(at('2027-12-23T18:25:12Z')).toEqual({ state: 'expired', days: 0, tone: 'danger', text: 'Expired today' })
        expect(at('2027-12-24T00:00:00Z').text).toBe('Expired 1 day ago')
        expect(at('2028-01-02T09:00:00Z').text).toBe('Expired 10 days ago')
        expect(at('2026-11-01T00:00:00Z')).toEqual({ state: 'not-yet-valid', days: 20, tone: 'warning', text: 'Not yet valid · starts in 20 days' })
        expect(at('2026-11-21T08:00:00Z').text).toBe('Not yet valid · starts today')
    })

    it('uses local days by default', () => {
        expect(validityStatus(notBefore, notAfter, Date.parse('2027-03-01T12:00:00Z')).state).toBe('valid')
    })
})

describe('signature checks that can’t be done', () => {
    const san = cert('rsa-san.pem')
    const check = (algorithm, publicKey = san.publicKey, signature = san.signature) => verifySignature({ data: san.tbsDer, signature, algorithm, publicKey })

    it('reports unsupported algorithms and keys instead of failing', async () => {
        expect(await check({ ...san.signatureAlgorithm, hash: 'MD5' })).toEqual({ status: 'unsupported', reason: 'WebCrypto can’t check MD5 signatures.' })
        expect(await check({ family: null, label: 'ML-DSA-65' })).toEqual({ status: 'unsupported', reason: 'ML-DSA-65 signatures can’t be checked in the browser.' })
        const brainpool = { ...cert('chain-leaf.pem').publicKey, curve: { name: 'brainpoolP256r1' } }
        expect(await check({ family: 'ecdsa', hash: 'SHA-256', label: 'ECDSA with SHA-256' }, brainpool)).toEqual({ status: 'unsupported', reason: 'WebCrypto doesn’t support the brainpoolP256r1 curve.' })
    })

    it('reports malformed ECDSA signatures as invalid', async () => {
        const leaf = cert('chain-leaf.pem')
        const result = await verifySignature({ data: leaf.tbsDer, signature: Uint8Array.of(1, 2, 3), algorithm: leaf.signatureAlgorithm, publicKey: cert('chain-intermediate.pem').publicKey })
        expect(result.status).toBe('invalid')
        expect(result.reason).toMatch(/^The ECDSA signature is malformed/)
    })
})
