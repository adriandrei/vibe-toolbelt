// X.509 certificates, CSRs, public and private keys and PKCS#7 bundles, decoded
// locally on top of ./asn1.js. Nothing here touches the network; WebCrypto is
// only used for digests and signature checks.
//
//   inspect(textOrBytes)      → { items, errors }: every PEM block, Base64/hex
//                               DER or binary DER found in the input
//   analyzeChain(certs)       → how a list of certificates links together
//   validityStatus(...)       → "Valid · expires in 12 days" and friends
//   fingerprints(der), spkiPin(spki), verifySignature(...), publicKeyToJwk(key)
//
// Private keys are only ever described (type, size, curve, encryption): their
// secret numbers are never returned.
import {
    Asn1Error,
    Asn1Node,
    CLASS_CONTEXT,
    CLASS_UNIVERSAL,
    TAG,
    bitLength,
    bitStringFlags,
    integerBytes,
    isNonMinimalInteger,
    isStringNode,
    parseDer,
    parseDerAll,
    readBitString,
    readBoolean,
    readInteger,
    readNull,
    readOid,
    readSmallInteger,
    readString,
    readTime,
    tagName,
} from './asn1.js'
import { base64ToBytes, bytesToBase64, bytesToBase64Url, bytesToHex, hexToBytes } from './encoding.js'
import { pemEncode, pkcs1ToSpki } from './pem.js'
import { digestAll } from './digest.js'

export { pemEncode }

/** Largest input decoded (text or file). Certificates and keys are a few KB; big CA bundles a few hundred. */
export const MAX_INPUT_BYTES = 4 * 1024 * 1024

// ---------------------------------------------------------------------------
// Object identifiers: [short name as OpenSSL prints it, friendly label]
// ---------------------------------------------------------------------------

const OIDS = {
    // Signature algorithms
    '1.2.840.113549.1.1.2': ['md2WithRSAEncryption', 'MD2 with RSA'],
    '1.2.840.113549.1.1.4': ['md5WithRSAEncryption', 'MD5 with RSA'],
    '1.2.840.113549.1.1.5': ['sha1WithRSAEncryption', 'SHA-1 with RSA'],
    '1.2.840.113549.1.1.10': ['rsassaPss', 'RSASSA-PSS'],
    '1.2.840.113549.1.1.11': ['sha256WithRSAEncryption', 'SHA-256 with RSA'],
    '1.2.840.113549.1.1.12': ['sha384WithRSAEncryption', 'SHA-384 with RSA'],
    '1.2.840.113549.1.1.13': ['sha512WithRSAEncryption', 'SHA-512 with RSA'],
    '1.2.840.113549.1.1.14': ['sha224WithRSAEncryption', 'SHA-224 with RSA'],
    '1.2.840.113549.1.1.15': ['sha512-224WithRSAEncryption', 'SHA-512/224 with RSA'],
    '1.2.840.113549.1.1.16': ['sha512-256WithRSAEncryption', 'SHA-512/256 with RSA'],
    '1.2.840.113549.1.1.8': ['mgf1', 'MGF1'],
    '1.2.840.10045.4.1': ['ecdsa-with-SHA1', 'ECDSA with SHA-1'],
    '1.2.840.10045.4.3.1': ['ecdsa-with-SHA224', 'ECDSA with SHA-224'],
    '1.2.840.10045.4.3.2': ['ecdsa-with-SHA256', 'ECDSA with SHA-256'],
    '1.2.840.10045.4.3.3': ['ecdsa-with-SHA384', 'ECDSA with SHA-384'],
    '1.2.840.10045.4.3.4': ['ecdsa-with-SHA512', 'ECDSA with SHA-512'],
    '2.16.840.1.101.3.4.3.9': ['id-ecdsa-with-sha3-224', 'ECDSA with SHA3-224'],
    '2.16.840.1.101.3.4.3.10': ['id-ecdsa-with-sha3-256', 'ECDSA with SHA3-256'],
    '2.16.840.1.101.3.4.3.11': ['id-ecdsa-with-sha3-384', 'ECDSA with SHA3-384'],
    '2.16.840.1.101.3.4.3.12': ['id-ecdsa-with-sha3-512', 'ECDSA with SHA3-512'],
    '2.16.840.1.101.3.4.3.13': ['id-rsassa-pkcs1-v1_5-with-sha3-224', 'SHA3-224 with RSA'],
    '2.16.840.1.101.3.4.3.14': ['id-rsassa-pkcs1-v1_5-with-sha3-256', 'SHA3-256 with RSA'],
    '2.16.840.1.101.3.4.3.15': ['id-rsassa-pkcs1-v1_5-with-sha3-384', 'SHA3-384 with RSA'],
    '2.16.840.1.101.3.4.3.16': ['id-rsassa-pkcs1-v1_5-with-sha3-512', 'SHA3-512 with RSA'],
    '2.16.840.1.101.3.4.3.17': ['id-ml-dsa-44', 'ML-DSA-44'],
    '2.16.840.1.101.3.4.3.18': ['id-ml-dsa-65', 'ML-DSA-65'],
    '2.16.840.1.101.3.4.3.19': ['id-ml-dsa-87', 'ML-DSA-87'],
    '2.16.840.1.101.3.4.3.20': ['id-slh-dsa-sha2-128s', 'SLH-DSA-SHA2-128s'],
    '2.16.840.1.101.3.4.3.21': ['id-slh-dsa-sha2-128f', 'SLH-DSA-SHA2-128f'],
    '2.16.840.1.101.3.4.3.22': ['id-slh-dsa-sha2-192s', 'SLH-DSA-SHA2-192s'],
    '2.16.840.1.101.3.4.3.23': ['id-slh-dsa-sha2-192f', 'SLH-DSA-SHA2-192f'],
    '2.16.840.1.101.3.4.3.24': ['id-slh-dsa-sha2-256s', 'SLH-DSA-SHA2-256s'],
    '2.16.840.1.101.3.4.3.25': ['id-slh-dsa-sha2-256f', 'SLH-DSA-SHA2-256f'],
    '2.16.840.1.101.3.4.3.26': ['id-slh-dsa-shake-128s', 'SLH-DSA-SHAKE-128s'],
    '2.16.840.1.101.3.4.3.27': ['id-slh-dsa-shake-128f', 'SLH-DSA-SHAKE-128f'],
    '2.16.840.1.101.3.4.3.28': ['id-slh-dsa-shake-192s', 'SLH-DSA-SHAKE-192s'],
    '2.16.840.1.101.3.4.3.29': ['id-slh-dsa-shake-192f', 'SLH-DSA-SHAKE-192f'],
    '2.16.840.1.101.3.4.3.30': ['id-slh-dsa-shake-256s', 'SLH-DSA-SHAKE-256s'],
    '2.16.840.1.101.3.4.3.31': ['id-slh-dsa-shake-256f', 'SLH-DSA-SHAKE-256f'],
    '1.2.840.10040.4.3': ['dsaWithSHA1', 'DSA with SHA-1'],
    '2.16.840.1.101.3.4.3.1': ['dsa_with_SHA224', 'DSA with SHA-224'],
    '2.16.840.1.101.3.4.3.2': ['dsa_with_SHA256', 'DSA with SHA-256'],
    '1.2.156.10197.1.501': ['SM2-with-SM3', 'SM2 with SM3'],
    '1.3.101.112': ['ED25519', 'Ed25519'],
    '1.3.101.113': ['ED448', 'Ed448'],
    // Key algorithms
    '1.2.840.113549.1.1.1': ['rsaEncryption', 'RSA'],
    '1.2.840.10045.2.1': ['id-ecPublicKey', 'EC'],
    '1.3.132.1.12': ['id-ecDH', 'ECDH'],
    '1.3.101.110': ['X25519', 'X25519'],
    '1.3.101.111': ['X448', 'X448'],
    '1.2.840.10040.4.1': ['dsaEncryption', 'DSA'],
    '1.2.840.113549.1.3.1': ['dhKeyAgreement', 'DH'],
    '1.2.840.10046.2.1': ['dhpublicnumber', 'DH (X9.42)'],
    '2.16.840.1.101.3.4.4.1': ['id-alg-ml-kem-512', 'ML-KEM-512'],
    '2.16.840.1.101.3.4.4.2': ['id-alg-ml-kem-768', 'ML-KEM-768'],
    '2.16.840.1.101.3.4.4.3': ['id-alg-ml-kem-1024', 'ML-KEM-1024'],
    // Curves
    '1.2.840.10045.3.1.7': ['prime256v1', 'P-256'],
    '1.3.132.0.34': ['secp384r1', 'P-384'],
    '1.3.132.0.35': ['secp521r1', 'P-521'],
    '1.3.132.0.10': ['secp256k1', 'secp256k1'],
    '1.2.840.10045.3.1.1': ['prime192v1', 'P-192'],
    '1.3.132.0.33': ['secp224r1', 'P-224'],
    '1.3.36.3.3.2.8.1.1.7': ['brainpoolP256r1', 'brainpoolP256r1'],
    '1.3.36.3.3.2.8.1.1.11': ['brainpoolP384r1', 'brainpoolP384r1'],
    '1.3.36.3.3.2.8.1.1.13': ['brainpoolP512r1', 'brainpoolP512r1'],
    '1.2.156.10197.1.301': ['SM2', 'SM2'],
    // Hashes
    '1.2.840.113549.2.5': ['md5', 'MD5'],
    '1.3.14.3.2.26': ['sha1', 'SHA-1'],
    '2.16.840.1.101.3.4.2.1': ['sha256', 'SHA-256'],
    '2.16.840.1.101.3.4.2.2': ['sha384', 'SHA-384'],
    '2.16.840.1.101.3.4.2.3': ['sha512', 'SHA-512'],
    '2.16.840.1.101.3.4.2.4': ['sha224', 'SHA-224'],
    '2.16.840.1.101.3.4.2.7': ['sha3-224', 'SHA3-224'],
    '2.16.840.1.101.3.4.2.8': ['sha3-256', 'SHA3-256'],
    '2.16.840.1.101.3.4.2.9': ['sha3-384', 'SHA3-384'],
    '2.16.840.1.101.3.4.2.10': ['sha3-512', 'SHA3-512'],
    // Name attributes
    '2.5.4.3': ['commonName', 'Common name'],
    '2.5.4.4': ['surname', 'Surname'],
    '2.5.4.5': ['serialNumber', 'Serial number'],
    '2.5.4.6': ['countryName', 'Country'],
    '2.5.4.7': ['localityName', 'Locality'],
    '2.5.4.8': ['stateOrProvinceName', 'State or province'],
    '2.5.4.9': ['streetAddress', 'Street address'],
    '2.5.4.10': ['organizationName', 'Organization'],
    '2.5.4.11': ['organizationalUnitName', 'Organizational unit'],
    '2.5.4.12': ['title', 'Title'],
    '2.5.4.13': ['description', 'Description'],
    '2.5.4.15': ['businessCategory', 'Business category'],
    '2.5.4.17': ['postalCode', 'Postal code'],
    '2.5.4.18': ['postOfficeBox', 'PO box'],
    '2.5.4.20': ['telephoneNumber', 'Telephone number'],
    '2.5.4.41': ['name', 'Name'],
    '2.5.4.42': ['givenName', 'Given name'],
    '2.5.4.43': ['initials', 'Initials'],
    '2.5.4.44': ['generationQualifier', 'Generation qualifier'],
    '2.5.4.45': ['x500UniqueIdentifier', 'Unique identifier'],
    '2.5.4.46': ['dnQualifier', 'DN qualifier'],
    '2.5.4.65': ['pseudonym', 'Pseudonym'],
    '2.5.4.97': ['organizationIdentifier', 'Organization identifier'],
    '1.2.840.113549.1.9.1': ['emailAddress', 'Email address'],
    '0.9.2342.19200300.100.1.1': ['userId', 'User ID'],
    '0.9.2342.19200300.100.1.25': ['domainComponent', 'Domain component'],
    '1.3.6.1.4.1.311.60.2.1.1': ['jurisdictionLocalityName', 'Jurisdiction locality'],
    '1.3.6.1.4.1.311.60.2.1.2': ['jurisdictionStateOrProvinceName', 'Jurisdiction state or province'],
    '1.3.6.1.4.1.311.60.2.1.3': ['jurisdictionCountryName', 'Jurisdiction country'],
    // PKCS#9 attributes (CSRs)
    '1.2.840.113549.1.9.2': ['unstructuredName', 'Unstructured name'],
    '1.2.840.113549.1.9.7': ['challengePassword', 'Challenge password'],
    '1.2.840.113549.1.9.8': ['unstructuredAddress', 'Unstructured address'],
    '1.2.840.113549.1.9.14': ['extensionRequest', 'Requested extensions'],
    '1.3.6.1.4.1.311.2.1.14': ['msExtReq', 'Requested extensions (Microsoft)'],
    // Extensions
    '2.5.29.9': ['subjectDirectoryAttributes', 'Subject directory attributes'],
    '2.5.29.14': ['subjectKeyIdentifier', 'Subject key identifier'],
    '2.5.29.15': ['keyUsage', 'Key usage'],
    '2.5.29.16': ['privateKeyUsagePeriod', 'Private key usage period'],
    '2.5.29.17': ['subjectAltName', 'Subject alternative names'],
    '2.5.29.18': ['issuerAltName', 'Issuer alternative names'],
    '2.5.29.19': ['basicConstraints', 'Basic constraints'],
    '2.5.29.30': ['nameConstraints', 'Name constraints'],
    '2.5.29.31': ['crlDistributionPoints', 'CRL distribution points'],
    '2.5.29.32': ['certificatePolicies', 'Certificate policies'],
    '2.5.29.33': ['policyMappings', 'Policy mappings'],
    '2.5.29.35': ['authorityKeyIdentifier', 'Authority key identifier'],
    '2.5.29.36': ['policyConstraints', 'Policy constraints'],
    '2.5.29.37': ['extendedKeyUsage', 'Extended key usage'],
    '2.5.29.46': ['freshestCRL', 'Freshest CRL (delta CRLs)'],
    '2.5.29.54': ['inhibitAnyPolicy', 'Inhibit any policy'],
    '1.3.6.1.5.5.7.1.1': ['authorityInfoAccess', 'Authority information access'],
    '1.3.6.1.5.5.7.1.3': ['qcStatements', 'Qualified certificate statements'],
    '1.3.6.1.5.5.7.1.11': ['subjectInfoAccess', 'Subject information access'],
    '1.3.6.1.5.5.7.1.24': ['tlsfeature', 'TLS feature'],
    '1.3.6.1.5.5.7.48.1.5': ['noCheck', 'OCSP no check'],
    '1.3.6.1.4.1.11129.2.4.2': ['ct_precert_scts', 'Signed certificate timestamps'],
    '1.3.6.1.4.1.11129.2.4.3': ['ct_precert_poison', 'CT precertificate poison'],
    '2.16.840.1.113730.1.1': ['nsCertType', 'Netscape certificate type'],
    '2.16.840.1.113730.1.13': ['nsComment', 'Netscape comment'],
    '1.3.6.1.4.1.311.20.2': ['msCertificateTemplateName', 'Certificate template name (Microsoft)'],
    '1.3.6.1.4.1.311.21.1': ['msCaVersion', 'CA version (Microsoft)'],
    '1.3.6.1.4.1.311.21.7': ['msCertificateTemplate', 'Certificate template (Microsoft)'],
    '1.3.6.1.4.1.311.21.10': ['msApplicationPolicies', 'Application policies (Microsoft)'],
    // Extended key usages
    '1.3.6.1.5.5.7.3.1': ['serverAuth', 'TLS server authentication'],
    '1.3.6.1.5.5.7.3.2': ['clientAuth', 'TLS client authentication'],
    '1.3.6.1.5.5.7.3.3': ['codeSigning', 'Code signing'],
    '1.3.6.1.5.5.7.3.4': ['emailProtection', 'Email protection (S/MIME)'],
    '1.3.6.1.5.5.7.3.5': ['ipsecEndSystem', 'IPsec end system'],
    '1.3.6.1.5.5.7.3.6': ['ipsecTunnel', 'IPsec tunnel'],
    '1.3.6.1.5.5.7.3.7': ['ipsecUser', 'IPsec user'],
    '1.3.6.1.5.5.7.3.8': ['timeStamping', 'Time stamping'],
    '1.3.6.1.5.5.7.3.9': ['OCSPSigning', 'OCSP signing'],
    '1.3.6.1.5.5.7.3.17': ['ipsecIKE', 'IPsec IKE'],
    '1.3.6.1.5.5.7.3.21': ['secureShellClient', 'SSH client'],
    '1.3.6.1.5.5.7.3.22': ['secureShellServer', 'SSH server'],
    '1.3.6.1.5.5.7.3.36': ['documentSigning', 'Document signing'],
    '2.5.29.37.0': ['anyExtendedKeyUsage', 'Any extended key usage'],
    '1.3.6.1.4.1.311.20.2.2': ['msSmartcardLogin', 'Smart card logon (Microsoft)'],
    '1.3.6.1.4.1.311.10.3.3': ['msSGC', 'Server gated crypto (Microsoft)'],
    '1.3.6.1.4.1.311.10.3.4': ['msEFS', 'Encrypting file system (Microsoft)'],
    '1.3.6.1.4.1.311.10.3.12': ['msDocumentSigning', 'Document signing (Microsoft)'],
    '1.3.6.1.4.1.311.2.1.21': ['msCodeInd', 'Individual code signing (Microsoft)'],
    '1.3.6.1.4.1.311.2.1.22': ['msCodeCom', 'Commercial code signing (Microsoft)'],
    '2.16.840.1.113730.4.1': ['nsSGC', 'Server gated crypto (Netscape)'],
    '1.3.6.1.5.2.3.4': ['pkInitClientAuth', 'Kerberos PKINIT client'],
    '1.3.6.1.5.2.3.5': ['pkInitKDC', 'Kerberos PKINIT KDC'],
    '1.3.6.1.4.1.11129.2.4.4': ['ctPrecertSigning', 'CT precertificate signing'],
    // Access methods and policy qualifiers
    '1.3.6.1.5.5.7.48.1': ['OCSP', 'OCSP'],
    '1.3.6.1.5.5.7.48.2': ['caIssuers', 'CA issuers'],
    '1.3.6.1.5.5.7.48.3': ['ad_timestamping', 'Time stamping'],
    '1.3.6.1.5.5.7.48.5': ['caRepository', 'CA repository'],
    '1.3.6.1.5.5.7.2.1': ['id-qt-cps', 'CPS'],
    '1.3.6.1.5.5.7.2.2': ['id-qt-unotice', 'User notice'],
    // Certificate policies
    '2.5.29.32.0': ['anyPolicy', 'Any policy'],
    '2.23.140.1.1': ['ev-guidelines', 'Extended Validation (EV)'],
    '2.23.140.1.2.1': ['domain-validated', 'Domain Validated (DV)'],
    '2.23.140.1.2.2': ['organization-validated', 'Organization Validated (OV)'],
    '2.23.140.1.2.3': ['individual-validated', 'Individual Validated (IV)'],
    '2.23.140.1.3': ['ev-code-signing', 'EV code signing'],
    '2.23.140.1.4.1': ['code-signing', 'Code signing (CA/B Forum)'],
    '2.23.140.1.5.1.1': ['smime-mailbox-legacy', 'S/MIME mailbox-validated (legacy)'],
    '2.23.140.1.5.1.2': ['smime-mailbox-multipurpose', 'S/MIME mailbox-validated (multipurpose)'],
    '2.23.140.1.5.1.3': ['smime-mailbox-strict', 'S/MIME mailbox-validated (strict)'],
    '2.23.140.1.5.2.1': ['smime-organization-legacy', 'S/MIME organization-validated (legacy)'],
    '2.23.140.1.5.2.2': ['smime-organization-multipurpose', 'S/MIME organization-validated (multipurpose)'],
    '2.23.140.1.5.2.3': ['smime-organization-strict', 'S/MIME organization-validated (strict)'],
    '2.23.140.1.5.3.1': ['smime-sponsor-legacy', 'S/MIME sponsor-validated (legacy)'],
    '2.23.140.1.5.3.2': ['smime-sponsor-multipurpose', 'S/MIME sponsor-validated (multipurpose)'],
    '2.23.140.1.5.3.3': ['smime-sponsor-strict', 'S/MIME sponsor-validated (strict)'],
    '2.23.140.1.5.4.1': ['smime-individual-legacy', 'S/MIME individual-validated (legacy)'],
    '2.23.140.1.5.4.2': ['smime-individual-multipurpose', 'S/MIME individual-validated (multipurpose)'],
    '2.23.140.1.5.4.3': ['smime-individual-strict', 'S/MIME individual-validated (strict)'],
    '1.3.6.1.4.1.44947.1.1.1': ['isrg-domain-validated', 'ISRG Domain Validated'],
    // otherName types
    '1.3.6.1.4.1.311.20.2.3': ['msUPN', 'UPN'],
    '1.3.6.1.5.5.7.8.3': ['id-on-permanentIdentifier', 'Permanent identifier'],
    '1.3.6.1.5.5.7.8.4': ['id-on-hardwareModuleName', 'Hardware module name'],
    '1.3.6.1.5.5.7.8.9': ['id-on-SmtpUTF8Mailbox', 'SMTP UTF-8 mailbox'],
    '1.3.6.1.5.2.2': ['id-pkinit-san', 'Kerberos principal'],
    // PKCS#7 / CMS content types
    '1.2.840.113549.1.7.1': ['pkcs7-data', 'Data'],
    '1.2.840.113549.1.7.2': ['pkcs7-signedData', 'Signed data'],
    '1.2.840.113549.1.7.3': ['pkcs7-envelopedData', 'Enveloped data'],
    '1.2.840.113549.1.7.6': ['pkcs7-encryptedData', 'Encrypted data'],
    // Password-based encryption (encrypted private keys)
    '1.2.840.113549.1.5.13': ['PBES2', 'PBES2'],
    '1.2.840.113549.1.5.12': ['PBKDF2', 'PBKDF2'],
    '1.3.6.1.4.1.11591.4.11': ['id-scrypt', 'scrypt'],
    '1.2.840.113549.1.5.3': ['pbeWithMD5AndDES-CBC', 'PBES1 with MD5 and DES-CBC'],
    '1.2.840.113549.1.5.10': ['pbeWithSHA1AndDES-CBC', 'PBES1 with SHA-1 and DES-CBC'],
    '1.2.840.113549.1.12.1.3': ['pbeWithSHA1And3-KeyTripleDES-CBC', 'PKCS#12 PBE with SHA-1 and 3DES'],
    '1.2.840.113549.1.12.1.6': ['pbeWithSHA1And40BitRC2-CBC', 'PKCS#12 PBE with SHA-1 and 40-bit RC2'],
    '1.2.840.113549.2.7': ['hmacWithSHA1', 'HMAC-SHA-1'],
    '1.2.840.113549.2.8': ['hmacWithSHA224', 'HMAC-SHA-224'],
    '1.2.840.113549.2.9': ['hmacWithSHA256', 'HMAC-SHA-256'],
    '1.2.840.113549.2.10': ['hmacWithSHA384', 'HMAC-SHA-384'],
    '1.2.840.113549.2.11': ['hmacWithSHA512', 'HMAC-SHA-512'],
    '2.16.840.1.101.3.4.1.2': ['aes-128-cbc', 'AES-128-CBC'],
    '2.16.840.1.101.3.4.1.22': ['aes-192-cbc', 'AES-192-CBC'],
    '2.16.840.1.101.3.4.1.42': ['aes-256-cbc', 'AES-256-CBC'],
    '2.16.840.1.101.3.4.1.6': ['id-aes128-GCM', 'AES-128-GCM'],
    '2.16.840.1.101.3.4.1.46': ['id-aes256-GCM', 'AES-256-GCM'],
    '1.2.840.113549.3.7': ['des-ede3-cbc', '3DES (DES-EDE3-CBC)'],
    '1.3.14.3.2.7': ['des-cbc', 'DES-CBC'],
}

/** Short name of an OID as OpenSSL prints it ("sha256WithRSAEncryption"), or undefined. */
export const oidName = (oid) => OIDS[oid]?.[0]
/** Friendly label of an OID ("SHA-256 with RSA"), or the OID itself. */
export const oidLabel = (oid) => OIDS[oid]?.[1] ?? oid

// Name attribute types as OpenSSL abbreviates them in subjects
const ATTRIBUTE_SHORT = {
    '2.5.4.3': 'CN', '2.5.4.4': 'SN', '2.5.4.5': 'serialNumber', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST',
    '2.5.4.9': 'street', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.12': 'title', '2.5.4.13': 'description',
    '2.5.4.15': 'businessCategory', '2.5.4.17': 'postalCode', '2.5.4.18': 'postOfficeBox', '2.5.4.20': 'telephoneNumber',
    '2.5.4.41': 'name', '2.5.4.42': 'GN', '2.5.4.43': 'initials', '2.5.4.44': 'generationQualifier',
    '2.5.4.45': 'x500UniqueIdentifier', '2.5.4.46': 'dnQualifier', '2.5.4.65': 'pseudonym', '2.5.4.97': 'organizationIdentifier',
    '1.2.840.113549.1.9.1': 'emailAddress', '0.9.2342.19200300.100.1.1': 'UID', '0.9.2342.19200300.100.1.25': 'DC',
    '1.3.6.1.4.1.311.60.2.1.1': 'jurisdictionL', '1.3.6.1.4.1.311.60.2.1.2': 'jurisdictionST', '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
    '1.2.840.113549.1.9.2': 'unstructuredName',
}

const OID = {
    RSA: '1.2.840.113549.1.1.1',
    RSA_PSS: '1.2.840.113549.1.1.10',
    MGF1: '1.2.840.113549.1.1.8',
    EC: '1.2.840.10045.2.1',
    COMMON_NAME: '2.5.4.3',
    SKI: '2.5.29.14',
    KEY_USAGE: '2.5.29.15',
    SAN: '2.5.29.17',
    BASIC_CONSTRAINTS: '2.5.29.19',
    AKI: '2.5.29.35',
    EXTENSION_REQUEST: '1.2.840.113549.1.9.14',
    MS_EXTENSION_REQUEST: '1.3.6.1.4.1.311.2.1.14',
    CHALLENGE_PASSWORD: '1.2.840.113549.1.9.7',
    SIGNED_DATA: '1.2.840.113549.1.7.2',
    PBES2: '1.2.840.113549.1.5.13',
    PBKDF2: '1.2.840.113549.1.5.12',
    SCRYPT: '1.3.6.1.4.1.11591.4.11',
    HMAC_SHA1: '1.2.840.113549.2.7',
    CPS: '1.3.6.1.5.5.7.2.1',
    USER_NOTICE: '1.3.6.1.5.5.7.2.2',
}

const KEY_TYPES = {
    '1.2.840.113549.1.1.1': 'RSA',
    '1.2.840.113549.1.1.10': 'RSA-PSS',
    '1.2.840.10045.2.1': 'EC',
    '1.3.132.1.12': 'EC',
    '1.3.101.112': 'Ed25519',
    '1.3.101.113': 'Ed448',
    '1.3.101.110': 'X25519',
    '1.3.101.111': 'X448',
    '1.2.840.10040.4.1': 'DSA',
    '1.2.840.113549.1.3.1': 'DH',
    '1.2.840.10046.2.1': 'DH',
    '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
    '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
    '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
    '2.16.840.1.101.3.4.4.1': 'ML-KEM-512',
    '2.16.840.1.101.3.4.4.2': 'ML-KEM-768',
    '2.16.840.1.101.3.4.4.3': 'ML-KEM-1024',
}

// Raw public key sizes (bytes) of the curve-only algorithms
const OKP_SIZES = { Ed25519: 32, Ed448: 57, X25519: 32, X448: 56 }

const CURVES = {
    '1.2.840.10045.3.1.7': { name: 'P-256', aliases: 'prime256v1, secp256r1', bits: 256, size: 32, jwk: 'P-256', webcrypto: 'P-256' },
    '1.3.132.0.34': { name: 'P-384', aliases: 'secp384r1', bits: 384, size: 48, jwk: 'P-384', webcrypto: 'P-384' },
    '1.3.132.0.35': { name: 'P-521', aliases: 'secp521r1', bits: 521, size: 66, jwk: 'P-521', webcrypto: 'P-521' },
    '1.3.132.0.10': { name: 'secp256k1', aliases: '', bits: 256, size: 32, jwk: 'secp256k1' },
    '1.2.840.10045.3.1.1': { name: 'P-192', aliases: 'prime192v1, secp192r1', bits: 192, size: 24 },
    '1.3.132.0.33': { name: 'P-224', aliases: 'secp224r1', bits: 224, size: 28 },
    '1.3.36.3.3.2.8.1.1.7': { name: 'brainpoolP256r1', aliases: '', bits: 256, size: 32 },
    '1.3.36.3.3.2.8.1.1.11': { name: 'brainpoolP384r1', aliases: '', bits: 384, size: 48 },
    '1.3.36.3.3.2.8.1.1.13': { name: 'brainpoolP512r1', aliases: '', bits: 512, size: 64 },
    '1.2.156.10197.1.301': { name: 'SM2', aliases: '', bits: 256, size: 32 },
}

const HASHES = {
    '1.2.840.113549.2.5': 'MD5',
    '1.3.14.3.2.26': 'SHA-1',
    '2.16.840.1.101.3.4.2.1': 'SHA-256',
    '2.16.840.1.101.3.4.2.2': 'SHA-384',
    '2.16.840.1.101.3.4.2.3': 'SHA-512',
    '2.16.840.1.101.3.4.2.4': 'SHA-224',
}

// How each signature algorithm can be checked with WebCrypto
const SIGNATURE_SCHEMES = {
    '1.2.840.113549.1.1.2': { family: 'rsa', hash: 'MD2' },
    '1.2.840.113549.1.1.4': { family: 'rsa', hash: 'MD5' },
    '1.2.840.113549.1.1.5': { family: 'rsa', hash: 'SHA-1' },
    '1.2.840.113549.1.1.11': { family: 'rsa', hash: 'SHA-256' },
    '1.2.840.113549.1.1.12': { family: 'rsa', hash: 'SHA-384' },
    '1.2.840.113549.1.1.13': { family: 'rsa', hash: 'SHA-512' },
    '1.2.840.113549.1.1.14': { family: 'rsa', hash: 'SHA-224' },
    '1.2.840.113549.1.1.10': { family: 'rsa-pss' },
    '1.2.840.10045.4.1': { family: 'ecdsa', hash: 'SHA-1' },
    '1.2.840.10045.4.3.1': { family: 'ecdsa', hash: 'SHA-224' },
    '1.2.840.10045.4.3.2': { family: 'ecdsa', hash: 'SHA-256' },
    '1.2.840.10045.4.3.3': { family: 'ecdsa', hash: 'SHA-384' },
    '1.2.840.10045.4.3.4': { family: 'ecdsa', hash: 'SHA-512' },
    '1.3.101.112': { family: 'eddsa', curve: 'Ed25519' },
    '1.3.101.113': { family: 'eddsa', curve: 'Ed448' },
}
const WEBCRYPTO_HASHES = new Set(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'])
const BROKEN_HASHES = new Set(['MD2', 'MD5', 'SHA-1'])

const KEY_USAGE_BITS = [
    'Digital signature', 'Non-repudiation', 'Key encipherment', 'Data encipherment', 'Key agreement',
    'Certificate signing', 'CRL signing', 'Encipher only', 'Decipher only',
]
const NETSCAPE_CERT_TYPE_BITS = ['SSL client', 'SSL server', 'S/MIME', 'Object signing', 'Reserved', 'SSL CA', 'S/MIME CA', 'Object signing CA']
const CRL_REASON_BITS = [
    'Unused', 'Key compromise', 'CA compromise', 'Affiliation changed', 'Superseded', 'Cessation of operation',
    'Certificate hold', 'Privilege withdrawn', 'AA compromise',
]
const TLS_FEATURES = { 5: 'status_request (OCSP Must-Staple)', 17: 'status_request_v2' }

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "AB:CD:EF" (upper case), as OpenSSL and browsers print fingerprints and key IDs. */
export const colonHex = (bytes) => (bytes.length ? bytesToHex(bytes, true).match(/../g).join(':') : '')

const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])
const plural = (n, word, words = `${word}s`) => `${n} ${n === 1 ? word : words}`

function fail(message, node) {
    throw new Asn1Error(message, node?.offset)
}

function expectNode(node, tagNumber, what, { tagClass = CLASS_UNIVERSAL, constructed } = {}) {
    if (!node) fail(`${what} is missing`)
    if (node.tagClass !== tagClass || node.tagNumber !== tagNumber) {
        fail(`${what}: expected ${tagName(tagClass, tagNumber)}, found ${node.typeName}`, node)
    }
    if (constructed !== undefined && node.constructed !== constructed) {
        fail(`${what}: the ${node.typeName} is ${node.constructed ? 'constructed' : 'primitive'}, which isn’t valid here`, node)
    }
    return node
}
const expectSequence = (node, what) => expectNode(node, TAG.SEQUENCE, what, { constructed: true })
const expectSet = (node, what) => expectNode(node, TAG.SET, what, { constructed: true })
const isContext = (node, n) => node?.tagClass === CLASS_CONTEXT && node.tagNumber === n

function expectExplicit(node, what) {
    if (!node.constructed || node.children.length !== 1) fail(`${what}: the ${node.typeName} wrapper must hold exactly one element`, node)
    return node.children[0]
}

const stringOrHex = (node) => (isStringNode(node) && !node.constructed ? readString(node) : `#${bytesToHex(node.der, true)}`)

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

// The attributes of one RDN (a SET, or an IMPLICIT [1] in CRL distribution points)
function parseRdn(set, what) {
    if (!set.constructed || !set.children.length) fail(`${what}: a component (RDN) is empty`, set)
    return set.children.map((atv) => {
        expectSequence(atv, `${what} attribute`)
        if (atv.children.length !== 2) fail(`${what}: an attribute must have a type and a value`, atv)
        const oid = readOid(expectNode(atv.children[0], TAG.OID, `${what} attribute type`))
        const valueNode = atv.children[1]
        const isText = isStringNode(valueNode) && !valueNode.constructed
        return {
            oid,
            short: ATTRIBUTE_SHORT[oid] ?? oid,
            label: oidLabel(oid),
            value: isText ? readString(valueNode) : `#${bytesToHex(valueNode.der, true)}`,
            type: valueNode.typeName,
            hex: !isText,
        }
    })
}

/** Name (SEQUENCE OF RDN) → { rdns: [[{ oid, short, label, value, type, hex }]], der }. */
export function parseName(node, what = 'Name') {
    expectSequence(node, what)
    const rdns = node.children.map(set => parseRdn(expectSet(set, `${what} component`), what))
    return { rdns, der: node.der }
}

function escapeDnValue(value) {
    let out = value.replace(/[\\,+"<>;]/g, '\\$&').replace(/\0/g, '\\00')
    if (/^[ #]/.test(out)) out = `\\${out}`
    if (out.length > 1 && out.endsWith(' ') && !out.endsWith('\\ ')) out = `${out.slice(0, -1)}\\ `
    return out
}

/**
 * One-line distinguished name. 'rfc4514' (default): most specific first,
 * escaped ("CN=example.com,O=Example,C=US"). 'openssl': encoded order, as
 * `openssl x509 -subject -nameopt utf8,sep_comma_plus_space` prints it.
 */
export function formatName(name, { style = 'rfc4514' } = {}) {
    if (!name.rdns.length) return ''
    if (style === 'openssl') return name.rdns.map(rdn => rdn.map(a => `${a.short}=${a.value}`).join(' + ')).join(', ')
    return [...name.rdns].reverse().map(rdn => rdn.map(a => `${a.short}=${a.hex ? a.value : escapeDnValue(a.value)}`).join('+')).join(',')
}

/** Last value of an attribute (e.g. the most specific CN), or null. */
export function nameAttribute(name, oid) {
    const values = name.rdns.flat().filter(a => a.oid === oid)
    return values.length ? values[values.length - 1].value : null
}

const normalizeValue = (value) => value.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ')
const normalizedNames = new WeakMap() // big CA bundles compare every pair of names
function normalizeName(name) {
    let key = normalizedNames.get(name)
    if (key === undefined) {
        key = JSON.stringify(name.rdns.map(rdn => rdn.map(a => `${a.oid}=${a.hex ? a.value : normalizeValue(a.value)}`).sort()))
        normalizedNames.set(name, key)
    }
    return key
}

/**
 * 'exact' when the encodings are identical, 'equivalent' when they match
 * after RFC 5280-style normalisation (case, spaces, string type), else 'different'.
 */
export function compareNames(a, b) {
    if (equalBytes(a.der, b.der)) return 'exact'
    return normalizeName(a) === normalizeName(b) ? 'equivalent' : 'different'
}

// ---------------------------------------------------------------------------
// Algorithms
// ---------------------------------------------------------------------------

function parseAlgorithm(node, what) {
    expectSequence(node, what)
    if (!node.children.length || node.children.length > 2) fail(`${what} must have an identifier and at most one parameter`, node)
    const oid = readOid(expectNode(node.children[0], TAG.OID, `${what} identifier`))
    return { oid, name: oidName(oid) ?? null, label: oidLabel(oid), params: node.children[1] ?? null, der: node.der }
}

const hashLabel = (oid) => HASHES[oid] ?? oidLabel(oid)

function parsePssParams(node) {
    const pss = { hash: 'SHA-1', mgfHash: 'SHA-1', saltLength: 20, trailerField: 1 }
    if (!node || node.is(TAG.NULL)) return pss
    expectSequence(node, 'RSASSA-PSS parameters')
    for (const field of node.children) {
        if (field.tagClass !== CLASS_CONTEXT) fail('RSASSA-PSS parameters: unexpected field', field)
        const inner = expectExplicit(field, 'RSASSA-PSS parameter')
        if (field.tagNumber === 0) pss.hash = hashLabel(parseAlgorithm(inner, 'PSS hash algorithm').oid)
        else if (field.tagNumber === 1) {
            const mgf = parseAlgorithm(inner, 'PSS mask generation function')
            if (mgf.oid !== OID.MGF1) fail(`Unsupported PSS mask generation function ${mgf.oid}`, inner)
            pss.mgfHash = hashLabel(parseAlgorithm(mgf.params, 'MGF1 hash algorithm').oid)
        } else if (field.tagNumber === 2) pss.saltLength = readSmallInteger(inner, 65535)
        else if (field.tagNumber === 3) pss.trailerField = readSmallInteger(inner, 255)
        else fail(`RSASSA-PSS parameters: unknown field [${field.tagNumber}]`, field)
    }
    return pss
}

/** Signature AlgorithmIdentifier → { oid, name, label, family, hash, pss?, weak }. */
function describeSignatureAlgorithm(alg) {
    const scheme = SIGNATURE_SCHEMES[alg.oid]
    const out = { oid: alg.oid, name: alg.name, label: alg.label, family: scheme?.family ?? null, hash: scheme?.hash ?? null, curve: scheme?.curve ?? null, der: alg.der }
    if (alg.oid === OID.RSA_PSS) {
        const pss = parsePssParams(alg.params)
        out.pss = pss
        out.hash = pss.hash
        out.label = `RSASSA-PSS (${pss.hash}, MGF1 with ${pss.mgfHash}, ${plural(pss.saltLength, 'byte')} of salt)`
    }
    out.weak = BROKEN_HASHES.has(out.hash)
    return out
}

// ---------------------------------------------------------------------------
// Public keys
// ---------------------------------------------------------------------------

function parseRsaPublicKey(bytes, what = 'RSA public key') {
    const root = bytes instanceof Asn1Node ? bytes : parseDer(bytes)
    expectSequence(root, what)
    if (root.children.length !== 2) fail(`${what} must hold a modulus and an exponent`, root)
    const nNode = expectNode(root.children[0], TAG.INTEGER, 'RSA modulus')
    const eNode = expectNode(root.children[1], TAG.INTEGER, 'RSA public exponent')
    if (readInteger(nNode) <= 0n || readInteger(eNode) <= 0n) fail(`${what}: the modulus and exponent must be positive`, root)
    return { n: integerBytes(nNode), e: readInteger(eNode), eBytes: integerBytes(eNode), der: root.der }
}

function curveInfo(oid) {
    return { oid, ...(CURVES[oid] ?? { name: oid, aliases: '', bits: null, size: null }) }
}

/**
 * SubjectPublicKeyInfo → { der, oid, type, bits, curve, summary, rsa?, ec?, okp?, warnings }.
 * type: RSA, RSA-PSS, EC, Ed25519, Ed448, X25519, X448, DSA, DH, ML-DSA-…, ML-KEM-… or unknown.
 */
export function parsePublicKeyInfo(input) {
    const node = input instanceof Asn1Node ? input : parseDer(input)
    expectSequence(node, 'Public key info')
    if (node.children.length !== 2) fail('Public key info must hold an algorithm and a key', node)
    const algorithm = parseAlgorithm(node.children[0], 'Public key algorithm')
    const bitString = readBitString(expectNode(node.children[1], TAG.BIT_STRING, 'Public key'))
    const key = {
        der: node.der,
        oid: algorithm.oid,
        algorithm: algorithm.label,
        type: KEY_TYPES[algorithm.oid] ?? 'unknown',
        bits: null,
        curve: null,
        warnings: [],
    }
    if (bitString.unusedBits) key.warnings.push('The public key bit string has unused bits.')
    const raw = bitString.bytes
    switch (key.type) {
        case 'RSA':
        case 'RSA-PSS':
            key.rsa = parseRsaPublicKey(raw)
            key.bits = bitLength(key.rsa.n)
            if (key.type === 'RSA' && !(algorithm.params?.is(TAG.NULL))) key.warnings.push('RSA key parameters should be NULL.')
            break
        case 'EC': {
            const params = algorithm.params
            if (!params) fail('The EC public key has no curve', node)
            if (params.is(TAG.OID)) key.curve = curveInfo(readOid(params))
            else if (params.is(TAG.SEQUENCE)) key.curve = { oid: null, name: 'explicit curve parameters', bits: null, size: null }
            else if (params.is(TAG.NULL)) key.curve = { oid: null, name: 'inherited from the issuer', bits: null, size: null }
            else fail('The EC public key has invalid curve parameters', params)
            key.bits = key.curve.bits
            const compressed = raw[0] === 0x02 || raw[0] === 0x03
            key.ec = { point: raw, compressed }
            const size = key.curve.size
            if (size && raw.length !== (compressed ? 1 + size : 1 + 2 * size)) key.warnings.push(`The EC point has ${raw.length} bytes, which doesn’t fit ${key.curve.name}.`)
            break
        }
        case 'Ed25519':
        case 'Ed448':
        case 'X25519':
        case 'X448':
            if (raw.length !== OKP_SIZES[key.type]) key.warnings.push(`A ${key.type} public key has ${OKP_SIZES[key.type]} bytes, this one ${raw.length}.`)
            key.okp = { x: raw }
            break
        case 'DSA':
        case 'DH': {
            const params = algorithm.params
            if (params?.is(TAG.SEQUENCE) && params.children[0]?.is(TAG.INTEGER)) key.bits = bitLength(integerBytes(params.children[0]))
            break
        }
        default:
            break
    }
    key.summary = keySummary(key)
    return key
}

function keySummary(key) {
    switch (key.type) {
        case 'RSA':
        case 'RSA-PSS':
        case 'DSA':
        case 'DH':
            return key.bits ? `${key.type} ${key.bits}-bit` : key.type
        case 'EC':
            return `EC ${key.curve?.name ?? ''}`.trim()
        case 'unknown':
            return `Unknown algorithm (${key.oid})`
        default:
            return key.type
    }
}

/** JWK for a public key: { jwk } or { jwk: null, reason }. */
export function publicKeyToJwk(key) {
    const b64 = bytesToBase64Url
    switch (key.type) {
        case 'RSA':
        case 'RSA-PSS':
            return { jwk: { kty: 'RSA', n: b64(key.rsa.n), e: b64(key.rsa.eBytes) } }
        case 'EC': {
            const { curve, ec } = key
            if (!curve?.jwk) return { jwk: null, reason: `JWK has no name for the ${curve?.name ?? 'unknown'} curve.` }
            if (ec.compressed) return { jwk: null, reason: 'The key uses a compressed point; JWK needs both coordinates.' }
            if (ec.point[0] !== 0x04 || ec.point.length !== 1 + 2 * curve.size) return { jwk: null, reason: 'The EC point is malformed.' }
            return { jwk: { kty: 'EC', crv: curve.jwk, x: b64(ec.point.subarray(1, 1 + curve.size)), y: b64(ec.point.subarray(1 + curve.size)) } }
        }
        case 'Ed25519':
        case 'Ed448':
        case 'X25519':
        case 'X448':
            if (key.okp.x.length !== OKP_SIZES[key.type]) return { jwk: null, reason: 'The key has the wrong length.' }
            return { jwk: { kty: 'OKP', crv: key.type, x: b64(key.okp.x) } }
        default:
            return { jwk: null, reason: `JWK export isn’t available for ${key.type === 'unknown' ? 'this key type' : `${key.type} keys`}.` }
    }
}

// ---------------------------------------------------------------------------
// General names (SANs, AIA locations, name constraints…)
// ---------------------------------------------------------------------------

function ipv4(bytes) {
    return Array.from(bytes).join('.')
}

// RFC 5952: lower case, no leading zeros, the longest run of 2+ zero groups as "::"
function ipv6(bytes) {
    const groups = []
    for (let i = 0; i < 16; i += 2) groups.push((bytes[i] << 8) | bytes[i + 1])
    if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) return `::ffff:${ipv4(bytes.subarray(12))}`
    let bestStart = -1
    let bestLength = 1
    for (let i = 0; i < 8;) {
        if (groups[i] !== 0) {
            i++
            continue
        }
        let j = i
        while (j < 8 && groups[j] === 0) j++
        if (j - i > bestLength) {
            bestStart = i
            bestLength = j - i
        }
        i = j
    }
    const text = groups.map(g => g.toString(16))
    if (bestStart < 0) return text.join(':')
    return `${text.slice(0, bestStart).join(':')}::${text.slice(bestStart + bestLength).join(':')}`
}

function prefixLength(mask) {
    let bits = 0
    let ended = false
    for (const byte of mask) {
        for (let i = 7; i >= 0; i--) {
            const set = (byte >> i) & 1
            if (set && ended) return null
            if (set) bits++
            else ended = true
        }
    }
    return bits
}

/** IP address bytes: 4 or 16 (address), 8 or 32 (address and mask, in name constraints). */
export function formatIp(bytes) {
    if (bytes.length === 4) return ipv4(bytes)
    if (bytes.length === 16) return ipv6(bytes)
    if (bytes.length === 8 || bytes.length === 32) {
        const half = bytes.length / 2
        const format = half === 4 ? ipv4 : ipv6
        const mask = bytes.subarray(half)
        const prefix = prefixLength(mask)
        return `${format(bytes.subarray(0, half))}/${prefix === null ? format(mask) : prefix}`
    }
    return `invalid (${plural(bytes.length, 'byte')}: ${colonHex(bytes)})`
}

/** GeneralName → { type, label, value, oid? }. */
export function parseGeneralName(node) {
    if (node.tagClass !== CLASS_CONTEXT) fail(`Expected a name (GeneralName), found ${node.typeName}`, node)
    switch (node.tagNumber) {
        case 0: {
            if (!node.constructed || node.children.length !== 2) fail('Invalid otherName', node)
            const oid = readOid(expectNode(node.children[0], TAG.OID, 'otherName type'))
            const wrapper = node.children[1]
            if (!isContext(wrapper, 0)) fail('Invalid otherName value', wrapper)
            const value = expectExplicit(wrapper, 'otherName value')
            return { type: 'otherName', label: OIDS[oid] ? oidLabel(oid) : 'Other name', oid, value: OIDS[oid] ? stringOrHex(value) : `${oid}: ${stringOrHex(value)}` }
        }
        case 1:
            return { type: 'email', label: 'Email', value: readString(node, TAG.IA5_STRING) }
        case 2:
            return { type: 'DNS', label: 'DNS', value: readString(node, TAG.IA5_STRING) }
        case 3:
            return { type: 'x400', label: 'X.400 address', value: colonHex(node.content) }
        case 4: {
            const name = parseName(expectExplicit(node, 'Directory name'), 'Directory name')
            return { type: 'dirName', label: 'Directory name', value: formatName(name), name }
        }
        case 5:
            return { type: 'ediParty', label: 'EDI party name', value: colonHex(node.content) }
        case 6:
            return { type: 'URI', label: 'URI', value: readString(node, TAG.IA5_STRING) }
        case 7:
            if (node.constructed) fail('Invalid IP address name', node)
            return { type: 'IP', label: 'IP address', value: formatIp(node.content) }
        case 8: {
            const oid = readOid(node)
            return { type: 'RID', label: 'Registered ID', value: oid, oid }
        }
        default:
            return fail(`Unknown name type [${node.tagNumber}]`, node)
    }
}

function generalNames(node, what) {
    if (!node.constructed) fail(`${what} must be a list of names`, node)
    return node.children.map(parseGeneralName)
}

// ---------------------------------------------------------------------------
// Extensions. Each parser takes the decoded extension value and returns
// { kind, rows: [{ label?, value, detail?, mono? }], ...details }.
// ---------------------------------------------------------------------------

const nameRows = (names) => names.map(n => ({ label: n.label, value: n.value, mono: n.type !== 'dirName' }))

function parseNamesExtension(root) {
    const names = generalNames(expectSequence(root, 'Names'), 'Names')
    return { kind: 'names', names, rows: nameRows(names) }
}

function parseKeyUsage(root) {
    const bits = readBitString(expectNode(root, TAG.BIT_STRING, 'Key usage'))
    const set = bitStringFlags(bits)
    const flags = set.map(i => KEY_USAGE_BITS[i] ?? `Unknown bit ${i}`)
    return { kind: 'flags', flags, bits: set, rows: [{ value: flags.length ? flags.join(', ') : 'None' }] }
}

function parseOidList(root, what) {
    const usages = expectSequence(root, what).children.map((n) => {
        const oid = readOid(expectNode(n, TAG.OID, what))
        return { oid, label: oidLabel(oid) }
    })
    return { kind: 'oids', usages, rows: usages.map(u => ({ value: u.label, detail: u.label === u.oid ? null : u.oid })) }
}

function parseBasicConstraints(root) {
    expectSequence(root, 'Basic constraints')
    let ca = false
    let pathLen = null
    for (const field of root.children) {
        if (field.is(TAG.BOOLEAN)) ca = readBoolean(field)
        else if (field.is(TAG.INTEGER)) pathLen = readSmallInteger(field, 0x7fffffff)
        else fail('Basic constraints: unexpected field', field)
    }
    const rows = [{ label: 'Certificate authority', value: ca ? 'Yes' : 'No' }]
    if (ca) rows.push({ label: 'Path length', value: pathLen === null ? 'No limit' : `${pathLen} (at most ${plural(pathLen, 'intermediate CA')} below)` })
    return { kind: 'basicConstraints', ca, pathLen, rows }
}

function parseSubjectKeyId(root) {
    const keyId = colonHex(expectNode(root, TAG.OCTET_STRING, 'Key identifier', { constructed: false }).content)
    return { kind: 'keyId', keyId, rows: [{ value: keyId, mono: true }] }
}

function parseAuthorityKeyId(root) {
    expectSequence(root, 'Authority key identifier')
    const out = { kind: 'aki', keyId: null, issuer: null, serial: null, rows: [] }
    for (const field of root.children) {
        if (isContext(field, 0)) {
            if (field.constructed) fail('Invalid key identifier', field)
            out.keyId = colonHex(field.content)
            out.rows.push({ label: 'Key ID', value: out.keyId, mono: true })
        } else if (isContext(field, 1)) {
            out.issuer = generalNames(field, 'Authority issuer')
            out.rows.push(...out.issuer.map(n => ({ label: `Issuer ${n.label}`, value: n.value, mono: n.type !== 'dirName' })))
        } else if (isContext(field, 2)) {
            if (field.constructed) fail('Invalid issuer serial number', field)
            out.serial = colonHex(integerBytes(field))
            out.rows.push({ label: 'Issuer serial', value: out.serial, mono: true })
        } else fail('Authority key identifier: unexpected field', field)
    }
    return out
}

function parseDistributionPoints(root) {
    const points = expectSequence(root, 'CRL distribution points').children.map((dp) => {
        expectSequence(dp, 'Distribution point')
        const point = { names: [], relativeName: null, reasons: null, crlIssuer: null }
        for (const field of dp.children) {
            if (isContext(field, 0)) {
                const choice = expectExplicit(field, 'Distribution point name')
                if (isContext(choice, 0)) point.names = generalNames(choice, 'Distribution point')
                else if (isContext(choice, 1)) {
                    // nameRelativeToCRLIssuer: [1] IMPLICIT RelativeDistinguishedName
                    point.relativeName = formatName({ rdns: [parseRdn(choice, 'Relative name')], der: choice.der })
                } else fail('Invalid distribution point name', choice)
            } else if (isContext(field, 1)) {
                point.reasons = bitStringFlags(readBitString(field)).map(i => CRL_REASON_BITS[i] ?? `Unknown reason ${i}`)
            } else if (isContext(field, 2)) {
                point.crlIssuer = generalNames(field, 'CRL issuer')
            } else fail('Distribution point: unexpected field', field)
        }
        return point
    })
    const rows = points.flatMap(p => [
        ...nameRows(p.names),
        ...(p.relativeName ? [{ label: 'Relative name', value: p.relativeName }] : []),
        ...(p.reasons ? [{ label: 'Reasons', value: p.reasons.join(', ') }] : []),
        ...(p.crlIssuer ?? []).map(n => ({ label: `CRL issuer ${n.label}`, value: n.value, mono: n.type !== 'dirName' })),
    ])
    return { kind: 'crlDistributionPoints', points, rows }
}

function parseAccessDescriptions(root) {
    const items = expectSequence(root, 'Access descriptions').children.map((ad) => {
        expectSequence(ad, 'Access description')
        if (ad.children.length !== 2) fail('An access description needs a method and a location', ad)
        const oid = readOid(expectNode(ad.children[0], TAG.OID, 'Access method'))
        return { oid, method: oidLabel(oid), location: parseGeneralName(ad.children[1]) }
    })
    return { kind: 'access', items, rows: items.map(i => ({ label: i.method, value: i.location.value, mono: true })) }
}

function parseUserNotice(node) {
    expectSequence(node, 'User notice')
    const parts = []
    for (const child of node.children) {
        if (child.is(TAG.SEQUENCE)) {
            // noticeRef: { organization DisplayText, noticeNumbers SEQUENCE OF INTEGER }
            const [org, numbers] = child.children
            const numberList = numbers?.children?.map(n => String(readInteger(n))).join(', ')
            parts.push(`${org ? stringOrHex(org) : ''}${numberList ? ` (notice ${numberList})` : ''}`)
        } else parts.push(stringOrHex(child))
    }
    return parts.join(' · ')
}

function parsePolicies(root) {
    const policies = expectSequence(root, 'Certificate policies').children.map((pi) => {
        expectSequence(pi, 'Policy')
        const oid = readOid(expectNode(pi.children[0], TAG.OID, 'Policy identifier'))
        const qualifiers = []
        if (pi.children[1]) {
            for (const q of expectSequence(pi.children[1], 'Policy qualifiers').children) {
                expectSequence(q, 'Policy qualifier')
                const qid = readOid(expectNode(q.children[0], TAG.OID, 'Policy qualifier type'))
                const value = q.children[1]
                if (qid === OID.CPS) qualifiers.push({ type: 'CPS', value: value ? stringOrHex(value) : '' })
                else if (qid === OID.USER_NOTICE) qualifiers.push({ type: 'User notice', value: value ? parseUserNotice(value) : '' })
                else qualifiers.push({ type: oidLabel(qid), value: value ? stringOrHex(value) : '' })
            }
        }
        return { oid, label: OIDS[oid] ? oidLabel(oid) : null, qualifiers }
    })
    const rows = policies.flatMap(p => [
        { label: 'Policy', value: p.label ?? p.oid, detail: p.label ? p.oid : null },
        ...p.qualifiers.map(q => ({ label: q.type, value: q.value, mono: q.type === 'CPS' })),
    ])
    return { kind: 'policies', policies, rows }
}

function parseNameConstraints(root) {
    expectSequence(root, 'Name constraints')
    const out = { kind: 'nameConstraints', permitted: [], excluded: [] }
    for (const field of root.children) {
        if (!isContext(field, 0) && !isContext(field, 1)) fail('Name constraints: unexpected field', field)
        if (!field.constructed) fail('Name constraints: invalid subtree list', field)
        const list = field.tagNumber === 0 ? out.permitted : out.excluded
        for (const subtree of field.children) {
            expectSequence(subtree, 'Name constraint')
            list.push(parseGeneralName(subtree.children[0] ?? fail('Name constraint is empty', subtree)))
        }
    }
    out.rows = [
        ...out.permitted.map(n => ({ label: `Permitted ${n.label}`, value: n.value, mono: n.type !== 'dirName' })),
        ...out.excluded.map(n => ({ label: `Excluded ${n.label}`, value: n.value, mono: n.type !== 'dirName' })),
    ]
    return out
}

function parseSctList(root) {
    // The extension value is an OCTET STRING holding a TLS-encoded SignedCertificateTimestampList
    const data = expectNode(root, TAG.OCTET_STRING, 'SCT list', { constructed: false }).content
    if (data.length < 2 || ((data[0] << 8) | data[1]) !== data.length - 2) fail('The SCT list length doesn’t match its content', root)
    let count = 0
    for (let pos = 2; pos < data.length; count++) {
        if (pos + 2 > data.length) fail('The SCT list is truncated', root)
        const length = (data[pos] << 8) | data[pos + 1]
        if (!length) fail('The SCT list has an empty entry', root)
        pos += 2 + length
        if (pos > data.length) fail('The SCT list is truncated', root)
    }
    return { kind: 'sct', count, rows: [{ value: `${plural(count, 'signed certificate timestamp')} from Certificate Transparency logs` }] }
}

function parseTlsFeature(root) {
    const features = expectSequence(root, 'TLS feature').children.map((n) => {
        const id = readSmallInteger(n, 65535)
        return TLS_FEATURES[id] ?? `TLS extension ${id}`
    })
    return { kind: 'tlsFeature', features, rows: features.map(f => ({ value: f })) }
}

function parsePolicyConstraints(root) {
    expectSequence(root, 'Policy constraints')
    const rows = root.children.map((field) => {
        if (isContext(field, 0)) return { label: 'Require explicit policy', value: `after ${plural(readSmallInteger(field), 'certificate')}` }
        if (isContext(field, 1)) return { label: 'Inhibit policy mapping', value: `after ${plural(readSmallInteger(field), 'certificate')}` }
        return fail('Policy constraints: unexpected field', field)
    })
    return { kind: 'policyConstraints', rows }
}

function parsePolicyMappings(root) {
    const rows = expectSequence(root, 'Policy mappings').children.map((m) => {
        expectSequence(m, 'Policy mapping')
        const [from, to] = m.children.map(n => readOid(expectNode(n, TAG.OID, 'Policy')))
        return { value: `${from} → ${to}`, mono: true }
    })
    return { kind: 'policyMappings', rows }
}

function parseNull(text) {
    return (root) => {
        readNull(expectNode(root, TAG.NULL, 'Value'))
        return { kind: 'text', rows: [{ value: text }] }
    }
}

const EXTENSION_PARSERS = {
    '2.5.29.17': parseNamesExtension,
    '2.5.29.18': parseNamesExtension,
    '2.5.29.15': parseKeyUsage,
    '2.5.29.37': (root) => parseOidList(root, 'Extended key usage'),
    '2.5.29.19': parseBasicConstraints,
    '2.5.29.14': parseSubjectKeyId,
    '2.5.29.35': parseAuthorityKeyId,
    '2.5.29.31': parseDistributionPoints,
    '2.5.29.46': parseDistributionPoints,
    '1.3.6.1.5.5.7.1.1': parseAccessDescriptions,
    '1.3.6.1.5.5.7.1.11': parseAccessDescriptions,
    '2.5.29.32': parsePolicies,
    '2.5.29.30': parseNameConstraints,
    '2.5.29.36': parsePolicyConstraints,
    '2.5.29.33': parsePolicyMappings,
    '2.5.29.54': (root) => ({ kind: 'text', rows: [{ value: `After ${plural(readSmallInteger(root), 'certificate')}` }] }),
    '1.3.6.1.4.1.11129.2.4.2': parseSctList,
    '1.3.6.1.4.1.11129.2.4.3': parseNull('This is a Certificate Transparency precertificate, not a certificate for use.'),
    '1.3.6.1.5.5.7.48.1.5': parseNull('Present: clients don’t check this OCSP responder certificate for revocation.'),
    '1.3.6.1.5.5.7.1.24': parseTlsFeature,
    '2.16.840.1.113730.1.1': (root) => {
        const flags = bitStringFlags(readBitString(root)).map(i => NETSCAPE_CERT_TYPE_BITS[i] ?? `Unknown bit ${i}`)
        return { kind: 'flags', flags, rows: [{ value: flags.join(', ') || 'None' }] }
    },
    '1.3.6.1.4.1.311.21.10': (root) => {
        // SEQUENCE OF PolicyInformation-like SEQUENCE { OID }
        const usages = expectSequence(root, 'Application policies').children.map((p) => {
            const oid = readOid(expectNode(expectSequence(p, 'Application policy').children[0], TAG.OID, 'Application policy'))
            return { oid, label: oidLabel(oid) }
        })
        return { kind: 'oids', usages, rows: usages.map(u => ({ value: u.label, detail: u.label === u.oid ? null : u.oid })) }
    },
}

function parseExtension(node) {
    expectSequence(node, 'Extension')
    const [idNode, second, third] = node.children
    const oid = readOid(expectNode(idNode, TAG.OID, 'Extension identifier'))
    let critical = false
    let valueNode = second
    const warnings = []
    if (second?.is(TAG.BOOLEAN)) {
        critical = readBoolean(second)
        if (!critical) warnings.push('“critical: false” is written out, which DER omits.')
        valueNode = third
    }
    expectNode(valueNode, TAG.OCTET_STRING, `Value of extension ${oid}`, { constructed: false })
    if (node.children.length > (second?.is(TAG.BOOLEAN) ? 3 : 2)) fail(`Extension ${oid} has unexpected extra fields`, node)
    return decodeExtension(oid, valueNode.content, critical, warnings)
}

/**
 * Decodes one extension value (the bytes inside extnValue). Never throws:
 * a value that can't be decoded sets `error` and is shown as hex.
 */
export function decodeExtension(oid, value, critical = false, warnings = []) {
    const ext = { oid, name: oidName(oid) ?? null, label: OIDS[oid] ? oidLabel(oid) : 'Unknown extension', critical, value, known: !!EXTENSION_PARSERS[oid], parsed: null, error: null, warnings }
    try {
        const parser = EXTENSION_PARSERS[oid]
        if (parser) ext.parsed = parser(parseDer(value))
        else {
            // Unknown extensions holding a single string are shown as text (comments, template names…)
            const inner = tryParseDer(value)
            if (inner && isStringNode(inner) && !inner.constructed) ext.parsed = { kind: 'text', rows: [{ value: readString(inner) }] }
        }
    } catch (error) {
        ext.error = error.message
    }
    return ext
}

function parseExtensions(node) {
    return expectSequence(node, 'Extensions').children.map(parseExtension)
}

function checkExtensions(extensions, warnings) {
    const seen = new Set()
    for (const ext of extensions) {
        if (seen.has(ext.oid)) warnings.push(`The ${ext.label} extension (${ext.oid}) appears more than once.`)
        seen.add(ext.oid)
        if (ext.critical && !ext.known) warnings.push(`Unknown critical extension ${ext.oid}: software that doesn’t understand it must reject the certificate.`)
        warnings.push(...ext.warnings.map(w => `${ext.label}: ${w}`))
    }
}

export const findExtension = (item, oid) => item.extensions.find(e => e.oid === oid) ?? null

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------

function checkTime(time, which, warnings) {
    const year = new Date(time.ms).getUTCFullYear()
    if (!time.rfc5280) warnings.push(`${which} “${time.text}” isn’t in the form RFC 5280 requires (seconds and “Z”).`)
    if (time.type === 'GeneralizedTime' && year >= 1950 && year < 2050) warnings.push(`${which} uses GeneralizedTime for a year before 2050, where RFC 5280 requires UTCTime.`)
    if (time.localTime) warnings.push(`${which} has no time zone; it was read as UTC.`)
}

/** DER certificate (bytes or a decoded node) → certificate details. Throws Asn1Error. */
export function parseCertificate(input) {
    const root = input instanceof Asn1Node ? input : parseDer(input)
    expectSequence(root, 'Certificate')
    if (root.children.length !== 3) fail(`A certificate has 3 parts (data, signature algorithm, signature); this has ${root.children.length}`, root)
    const [tbs, sigAlgNode, sigNode] = root.children
    expectSequence(tbs, 'Certificate data')
    const warnings = (root.warnings ?? []).map(w => `Not strict DER: ${w.message} (at byte ${w.offset}).`)
    const f = tbs.children
    let i = 0
    let version = 1
    if (isContext(f[0], 0)) {
        const n = readSmallInteger(expectNode(expectExplicit(f[0], 'Version'), TAG.INTEGER, 'Version'), 255)
        version = n + 1
        if (n === 0) warnings.push('The version is written out as v1, which DER omits (it’s the default).')
        if (n > 2) warnings.push(`Unknown certificate version ${version}.`)
        i++
    }
    const serialNode = expectNode(f[i++], TAG.INTEGER, 'Serial number', { constructed: false })
    const innerSignatureAlgorithm = parseAlgorithm(f[i++] ?? fail('Signature algorithm is missing', tbs), 'Signature algorithm')
    const issuer = parseName(f[i++] ?? fail('Issuer is missing', tbs), 'Issuer')
    const validity = expectSequence(f[i++], 'Validity')
    if (validity.children.length !== 2) fail('Validity must hold two dates', validity)
    const notBefore = readTime(validity.children[0])
    const notAfter = readTime(validity.children[1])
    const subject = parseName(f[i++] ?? fail('Subject is missing', tbs), 'Subject')
    const publicKey = parsePublicKeyInfo(f[i++] ?? fail('Public key is missing', tbs))
    let extensions = []
    let hasExtensionsField = false
    let hasUniqueIds = false
    for (; i < f.length; i++) {
        const field = f[i]
        if (isContext(field, 1) || isContext(field, 2)) {
            readBitString(field)
            hasUniqueIds = true
        } else if (isContext(field, 3)) {
            extensions = parseExtensions(expectExplicit(field, 'Extensions'))
            hasExtensionsField = true
        } else fail(`Unexpected ${field.typeName} in the certificate data`, field)
    }
    const signatureAlgorithm = describeSignatureAlgorithm(parseAlgorithm(sigAlgNode, 'Signature algorithm'))
    const signature = readBitString(expectNode(sigNode, TAG.BIT_STRING, 'Signature')).bytes

    const serialValue = readInteger(serialNode)
    const magnitude = serialValue < 0n ? -serialValue : serialValue
    let serialHex = magnitude.toString(16).toUpperCase()
    if (serialHex.length % 2) serialHex = `0${serialHex}`
    const serial = {
        hex: `${serialValue < 0n ? '-' : ''}${serialHex}`,
        colon: `${serialValue < 0n ? '-' : ''}${serialHex.match(/../g).join(':')}`,
        decimal: serialValue.toString(),
        negative: serialValue < 0n,
    }
    if (serialValue <= 0n) warnings.push('The serial number isn’t positive (RFC 5280 requires a positive number).')
    if (serialNode.length > 20) warnings.push(`The serial number is ${serialNode.length} bytes long; RFC 5280 allows at most 20.`)
    if (isNonMinimalInteger(serialNode)) warnings.push('The serial number has extra leading bytes (not DER).')
    if (!equalBytes(innerSignatureAlgorithm.der, signatureAlgorithm.der)) warnings.push('The signature algorithm inside the certificate data differs from the outer one; RFC 5280 requires them to match.')
    if (hasExtensionsField && version !== 3) warnings.push(`Extensions are only allowed in version 3 certificates; this is version ${version}.`)
    if (hasUniqueIds && version === 1) warnings.push('Unique identifiers aren’t allowed in version 1 certificates.')
    checkTime(notBefore, 'Not before', warnings)
    checkTime(notAfter, 'Not after', warnings)
    if (notAfter.ms < notBefore.ms) warnings.push('“Not after” is earlier than “not before”, so the certificate is never valid.')
    checkExtensions(extensions, warnings)
    if (signatureAlgorithm.weak) warnings.push(`Signed with ${signatureAlgorithm.hash}, which is broken for signatures; browsers reject such certificates.`)
    if (publicKey.type === 'RSA' && publicKey.bits && publicKey.bits < 2048) warnings.push(`The ${publicKey.bits}-bit RSA key is too short; 2048 bits is the minimum today.`)
    warnings.push(...publicKey.warnings)

    const san = findExtension({ extensions }, OID.SAN)?.parsed?.names ?? []
    const basic = findExtension({ extensions }, OID.BASIC_CONSTRAINTS)?.parsed ?? null
    const keyUsage = findExtension({ extensions }, OID.KEY_USAGE)?.parsed ?? null
    return {
        der: root.der,
        tbsDer: tbs.der,
        version,
        serial,
        signatureAlgorithm,
        signature,
        issuer,
        subject,
        notBefore,
        notAfter,
        publicKey,
        extensions,
        warnings,
        selfIssued: compareNames(subject, issuer) !== 'different',
        commonName: nameAttribute(subject, OID.COMMON_NAME),
        sanNames: san,
        isCa: basic ? basic.ca : null,
        pathLen: basic?.ca ? basic.pathLen : null,
        keyUsage: keyUsage?.flags ?? null,
        subjectKeyId: findExtension({ extensions }, OID.SKI)?.parsed?.keyId ?? null,
        authorityKeyId: findExtension({ extensions }, OID.AKI)?.parsed?.keyId ?? null,
    }
}

/** A short title: the most specific CN, else the first SAN, else the whole name. */
export function certificateTitle(cert) {
    return cert.commonName || cert.sanNames?.[0]?.value || formatName(cert.subject) || '(empty subject)'
}

// ---------------------------------------------------------------------------
// Certificate requests (PKCS#10)
// ---------------------------------------------------------------------------

export function parseCsr(input) {
    const root = input instanceof Asn1Node ? input : parseDer(input)
    expectSequence(root, 'Certificate request')
    if (root.children.length !== 3) fail(`A certificate request has 3 parts (data, signature algorithm, signature); this has ${root.children.length}`, root)
    const [info, sigAlgNode, sigNode] = root.children
    expectSequence(info, 'Request data')
    const [versionNode, subjectNode, keyNode, attributesNode, ...extra] = info.children
    if (extra.length) fail('The request data has unexpected extra fields', extra[0])
    const version = readSmallInteger(expectNode(versionNode, TAG.INTEGER, 'Version'), 255) + 1
    const subject = parseName(subjectNode ?? fail('Subject is missing', info), 'Subject')
    const publicKey = parsePublicKeyInfo(keyNode ?? fail('Public key is missing', info))
    const warnings = (root.warnings ?? []).map(w => `Not strict DER: ${w.message} (at byte ${w.offset}).`)
    const attributes = []
    const extensions = []
    if (attributesNode) {
        if (!isContext(attributesNode, 0) || !attributesNode.constructed) fail('Invalid attributes field', attributesNode)
        for (const attr of attributesNode.children) {
            expectSequence(attr, 'Attribute')
            const oid = readOid(expectNode(attr.children[0], TAG.OID, 'Attribute type'))
            const values = expectSet(attr.children[1], 'Attribute values').children
            if (oid === OID.EXTENSION_REQUEST || oid === OID.MS_EXTENSION_REQUEST) {
                for (const value of values) extensions.push(...parseExtensions(value))
            } else if (oid === OID.CHALLENGE_PASSWORD) {
                attributes.push({ oid, label: oidLabel(oid), value: 'Set (not shown)' })
            } else {
                attributes.push({ oid, label: oidLabel(oid), value: values.map(stringOrHex).join(', ') })
            }
        }
    } else {
        warnings.push('The request has no attributes field; PKCS#10 requires one, even if it’s empty.')
    }
    if (version !== 1) warnings.push(`Unknown request version ${version}.`)
    checkExtensions(extensions, warnings)
    const signatureAlgorithm = describeSignatureAlgorithm(parseAlgorithm(sigAlgNode, 'Signature algorithm'))
    const signature = readBitString(expectNode(sigNode, TAG.BIT_STRING, 'Signature')).bytes
    if (signatureAlgorithm.weak) warnings.push(`Signed with ${signatureAlgorithm.hash}, which CAs no longer accept.`)
    warnings.push(...publicKey.warnings)
    return {
        der: root.der,
        infoDer: info.der,
        version,
        subject,
        publicKey,
        attributes,
        extensions,
        signatureAlgorithm,
        signature,
        warnings,
        commonName: nameAttribute(subject, OID.COMMON_NAME),
        sanNames: findExtension({ extensions }, OID.SAN)?.parsed?.names ?? [],
    }
}

// ---------------------------------------------------------------------------
// Private keys: described, never exposed
// ---------------------------------------------------------------------------

const PRIVATE_FORMATS = {
    pkcs8: 'PKCS#8',
    'pkcs1-private': 'PKCS#1 (traditional RSA)',
    sec1: 'SEC 1 (traditional EC)',
    'dsa-private': 'Traditional DSA',
    'encrypted-pkcs8': 'Encrypted PKCS#8',
}

function rsaPrivateBits(root) {
    expectSequence(root, 'RSA private key')
    if (root.children.length < 9 || !root.children.slice(0, 9).every(n => n.is(TAG.INTEGER))) fail('An RSA private key holds 9 numbers', root)
    const extraPrimes = root.children[9]?.children?.length ?? 0
    return { bits: bitLength(integerBytes(root.children[1])), primes: 2 + extraPrimes }
}

function ecPrivateDetails(root) {
    expectSequence(root, 'EC private key')
    if (readSmallInteger(expectNode(root.children[0], TAG.INTEGER, 'EC private key version'), 255) !== 1) fail('Unsupported EC private key version', root)
    const secret = expectNode(root.children[1], TAG.OCTET_STRING, 'EC private key')
    const params = root.children.find(n => isContext(n, 0))
    const curveOid = params?.constructed && params.children[0]?.is(TAG.OID) ? readOid(params.children[0]) : null
    return { curve: curveOid ? curveInfo(curveOid) : null, secretBits: secret.length * 8, hasPublicKey: root.children.some(n => isContext(n, 1)) }
}

function describeEncryption(algNode) {
    const alg = parseAlgorithm(algNode, 'Encryption algorithm')
    if (alg.oid !== OID.PBES2) return { scheme: alg.label, summary: alg.label }
    const params = expectSequence(alg.params, 'PBES2 parameters')
    const kdf = parseAlgorithm(params.children[0], 'Key derivation function')
    const cipher = parseAlgorithm(params.children[1], 'Encryption scheme')
    let kdfText = kdf.label
    let iterations = null
    if (kdf.oid === OID.PBKDF2) {
        const p = expectSequence(kdf.params, 'PBKDF2 parameters').children
        iterations = readSmallInteger(expectNode(p[1], TAG.INTEGER, 'PBKDF2 iteration count'))
        const prfNode = p.slice(2).find(n => n.is(TAG.SEQUENCE))
        const prf = prfNode ? parseAlgorithm(prfNode, 'PBKDF2 function').label : oidLabel(OID.HMAC_SHA1)
        kdfText = `PBKDF2 with ${prf}, ${iterations.toLocaleString('en-US')} iterations`
    } else if (kdf.oid === OID.SCRYPT) {
        const p = expectSequence(kdf.params, 'scrypt parameters').children
        kdfText = `scrypt (N=${readInteger(p[1])}, r=${readInteger(p[2])}, p=${readInteger(p[3])})`
    }
    return { scheme: 'PBES2', kdf: kdfText, cipher: cipher.label, iterations, summary: `PBES2: ${kdfText}, ${cipher.label}` }
}

/**
 * Describes a private key without returning any secret material:
 * { format, formatLabel, type, bits, curve, encrypted, encryption }.
 */
export function describePrivateKey(der, kind, { headers = {}, labelType = null } = {}) {
    const out = { format: kind, formatLabel: PRIVATE_FORMATS[kind] ?? kind, type: labelType ?? 'unknown', bits: null, curve: null, encrypted: false, encryption: null }
    if (/ENCRYPTED/i.test(headers['Proc-Type'] ?? '')) {
        // Legacy OpenSSL PEM encryption: the DER is ciphertext
        out.encrypted = true
        out.formatLabel = `${out.formatLabel}, encrypted`
        const cipher = (headers['DEK-Info'] ?? '').split(',')[0].trim()
        out.encryption = { scheme: 'Legacy PEM encryption', summary: `Legacy OpenSSL PEM encryption${cipher ? ` (${cipher})` : ''}` }
        return out
    }
    const root = parseDer(der)
    switch (kind) {
        case 'pkcs8': {
            expectSequence(root, 'Private key')
            const [versionNode, algNode, keyNode] = root.children
            const version = readSmallInteger(expectNode(versionNode, TAG.INTEGER, 'Private key version'), 255)
            if (version > 1) fail(`Unknown private key version ${version}`, versionNode)
            const alg = parseAlgorithm(algNode, 'Private key algorithm')
            const secret = expectNode(keyNode, TAG.OCTET_STRING, 'Private key', { constructed: false })
            out.type = KEY_TYPES[alg.oid] ?? 'unknown'
            out.algorithmOid = alg.oid
            if (out.type === 'RSA' || out.type === 'RSA-PSS') Object.assign(out, rsaPrivateBits(parseDer(secret.content)))
            else if (out.type === 'EC') {
                const inner = ecPrivateDetails(parseDer(secret.content))
                out.curve = alg.params?.is(TAG.OID) ? curveInfo(readOid(alg.params)) : inner.curve
                out.bits = out.curve?.bits ?? inner.secretBits
            } else if (out.type === 'DSA' && alg.params?.is(TAG.SEQUENCE)) {
                out.bits = bitLength(integerBytes(alg.params.children[0]))
            }
            break
        }
        case 'pkcs1-private':
            out.type = 'RSA'
            Object.assign(out, rsaPrivateBits(root))
            break
        case 'sec1': {
            out.type = 'EC'
            const inner = ecPrivateDetails(root)
            out.curve = inner.curve
            out.bits = inner.curve?.bits ?? inner.secretBits
            break
        }
        case 'dsa-private':
            expectSequence(root, 'DSA private key')
            if (root.children.length !== 6) fail('A DSA private key holds 6 numbers', root)
            out.type = 'DSA'
            out.bits = bitLength(integerBytes(expectNode(root.children[1], TAG.INTEGER, 'DSA prime')))
            break
        case 'encrypted-pkcs8':
            expectSequence(root, 'Encrypted private key')
            if (root.children.length !== 2) fail('An encrypted private key holds an algorithm and the encrypted data', root)
            expectNode(root.children[1], TAG.OCTET_STRING, 'Encrypted data')
            out.encrypted = true
            out.encryption = describeEncryption(root.children[0])
            break
        default:
            fail(`Unsupported private key format ${kind}`)
    }
    if (out.type === 'unknown' && out.algorithmOid) out.type = `Unknown (${out.algorithmOid})`
    return out
}

// ---------------------------------------------------------------------------
// PKCS#7 bundles and OpenSSL trust settings
// ---------------------------------------------------------------------------

/** PKCS#7 / CMS SignedData → { certificates: Asn1Node[], skipped, crlCount, signerCount }. */
export function parsePkcs7(root) {
    expectSequence(root, 'PKCS#7 content')
    const contentType = readOid(expectNode(root.children[0], TAG.OID, 'PKCS#7 content type'))
    if (contentType !== OID.SIGNED_DATA) fail(`This PKCS#7 file holds ${oidLabel(contentType)}; only signed data (certificate bundles) can be read`, root)
    const wrapper = root.children[1]
    if (!isContext(wrapper, 0)) fail('The PKCS#7 file has no content', root)
    const signedData = expectSequence(expectExplicit(wrapper, 'PKCS#7 content'), 'Signed data')
    const certificates = []
    let skipped = 0
    let crlCount = 0
    let signerCount = 0
    for (const field of signedData.children.slice(3)) {
        if (isContext(field, 0)) {
            for (const choice of field.children ?? []) {
                if (choice.is(TAG.SEQUENCE)) certificates.push(choice)
                else skipped++
            }
        } else if (isContext(field, 1)) {
            crlCount += field.children?.length ?? 0
        } else if (field.is(TAG.SET)) {
            signerCount = field.children.length
        }
    }
    return { certificates, skipped, crlCount, signerCount }
}

function parseTrustSettings(bytes) {
    const root = parseDer(bytes)
    expectSequence(root, 'Trust settings')
    const trust = { trusted: [], rejected: [], alias: null, keyId: null }
    const usages = (node) => node.children.map(n => oidLabel(readOid(expectNode(n, TAG.OID, 'Trust purpose'))))
    for (const field of root.children) {
        if (field.is(TAG.SEQUENCE)) trust.trusted = usages(field)
        else if (isContext(field, 0) && field.constructed) trust.rejected = usages(field)
        else if (field.is(TAG.UTF8_STRING)) trust.alias = readString(field)
        else if (field.is(TAG.OCTET_STRING)) trust.keyId = colonHex(field.content)
    }
    return trust
}

// ---------------------------------------------------------------------------
// Input: PEM blocks, Base64 or hex DER, binary DER
// ---------------------------------------------------------------------------

const LABEL_KINDS = {
    'CERTIFICATE': 'certificate',
    'X509 CERTIFICATE': 'certificate',
    'X.509 CERTIFICATE': 'certificate',
    'TRUSTED CERTIFICATE': 'trusted-certificate',
    'CERTIFICATE REQUEST': 'csr',
    'NEW CERTIFICATE REQUEST': 'csr',
    'PUBLIC KEY': 'spki',
    'RSA PUBLIC KEY': 'pkcs1-public',
    'PRIVATE KEY': 'pkcs8',
    'ENCRYPTED PRIVATE KEY': 'encrypted-pkcs8',
    'RSA PRIVATE KEY': 'pkcs1-private',
    'EC PRIVATE KEY': 'sec1',
    'DSA PRIVATE KEY': 'dsa-private',
    'PKCS7': 'pkcs7',
    'PKCS #7 SIGNED DATA': 'pkcs7',
    'CMS': 'pkcs7',
    'EC PARAMETERS': 'ec-parameters',
}

/** PEM labels this tool decodes (for content detection elsewhere in the app). */
export const SUPPORTED_PEM_LABELS = Object.keys(LABEL_KINDS)

const UNSUPPORTED_LABELS = {
    'X509 CRL': 'Certificate revocation lists (CRLs) aren’t supported.',
    'OPENSSH PRIVATE KEY': 'OpenSSH private keys use their own format, which this tool doesn’t decode.',
    'DH PARAMETERS': 'Diffie-Hellman parameters aren’t supported.',
    'X9.42 DH PARAMETERS': 'Diffie-Hellman parameters aren’t supported.',
    'PGP PUBLIC KEY BLOCK': 'OpenPGP keys aren’t X.509 and can’t be decoded here.',
    'PGP PRIVATE KEY BLOCK': 'OpenPGP keys aren’t X.509 and can’t be decoded here.',
    'PGP MESSAGE': 'OpenPGP data isn’t X.509 and can’t be decoded here.',
}

const PRIVATE_KINDS = new Set(['pkcs8', 'encrypted-pkcs8', 'pkcs1-private', 'sec1', 'dsa-private'])
const LABEL_KEY_TYPES = { 'RSA PRIVATE KEY': 'RSA', 'EC PRIVATE KEY': 'EC', 'DSA PRIVATE KEY': 'DSA' }

const lineAt = (text, index) => {
    let line = 1
    for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line++
    return line
}

/** Finds PEM blocks: { blocks: [{ label, body, headers, line }], problems: [{ label, line, message }] }. */
export function scanPem(text) {
    const blocks = []
    const problems = []
    const begin = /-----BEGIN ([^\r\n-][^\r\n]*?)-----/g
    let m
    while ((m = begin.exec(text))) {
        const label = m[1].trim()
        const line = lineAt(text, m.index)
        const bodyStart = m.index + m[0].length
        const end = /-----END ([^\r\n]*?)-----/g
        end.lastIndex = bodyStart
        const e = end.exec(text)
        const nextBegin = text.indexOf('-----BEGIN ', bodyStart)
        if (!e || (nextBegin !== -1 && nextBegin < e.index)) {
            problems.push({ label, line, message: `The ${label} block on line ${line} has no END line: the text looks cut off. Paste the whole block, from BEGIN to END.` })
            continue
        }
        begin.lastIndex = e.index + e[0].length
        const endLabel = e[1].trim()
        if (endLabel !== label) {
            problems.push({ label, line, message: `“BEGIN ${label}” on line ${line} is closed by “END ${endLabel}”.` })
            continue
        }
        // RFC 1421 headers (Proc-Type, DEK-Info…) come first, separated by a blank line
        const headers = {}
        let body = text.slice(bodyStart, e.index)
        const headerBlock = /^\s*((?:[A-Za-z][A-Za-z0-9-]*:[^\r\n]*\r?\n(?:[ \t][^\r\n]*\r?\n)*)+)\s*\r?\n/.exec(body)
        if (headerBlock) {
            for (const h of headerBlock[1].replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
                const i = h.indexOf(':')
                if (i > 0) headers[h.slice(0, i).trim()] = h.slice(i + 1).trim()
            }
            body = body.slice(headerBlock[0].length)
        }
        blocks.push({ label, body, headers, line })
    }
    return { blocks, problems }
}

function decodeBase64Body(body, label) {
    const compact = body.replace(/\s+/g, '')
    if (!compact) throw new Error(`The ${label} block is empty.`)
    try {
        return base64ToBytes(compact)
    } catch (error) {
        throw new Error(`The ${label} block isn’t valid Base64: ${error.message}.`, { cause: error })
    }
}

function tryParseDer(bytes, options) {
    try {
        return parseDer(bytes, options)
    } catch {
        return null
    }
}

/** Guesses what a DER structure is from its shape (for unlabelled input). */
export function identifyDer(root) {
    if (root.is(TAG.OID)) return 'ec-parameters'
    if (!root.is(TAG.SEQUENCE) || !root.constructed) return null
    const c = root.children
    const isSeq = (n) => n?.is(TAG.SEQUENCE) && n.constructed
    const isInt = (n) => n?.is(TAG.INTEGER)
    if (c.length === 3 && isSeq(c[0]) && isSeq(c[1]) && c[2].is(TAG.BIT_STRING)) {
        const t = c[0].children
        const time = (n) => n?.is(TAG.UTC_TIME) || n?.is(TAG.GENERALIZED_TIME)
        if (time(t[2]) || time(t[3])) return 'crl' // TBSCertList: [version,] algorithm, issuer, thisUpdate
        if (t.length <= 4 && isInt(t[0]) && isSeq(t[1]) && isSeq(t[2])) return 'csr' // version, subject, key, [attributes]
        return 'certificate'
    }
    if (c.length === 2 && c[0].is(TAG.OID) && isContext(c[1], 0)) return 'pkcs7'
    if (c.length === 2 && isSeq(c[0]) && c[0].children[0]?.is(TAG.OID)) {
        if (c[1].is(TAG.BIT_STRING)) return 'spki'
        if (c[1].is(TAG.OCTET_STRING)) return 'encrypted-pkcs8'
    }
    if (c.length >= 3 && isInt(c[0]) && isSeq(c[1]) && c[2].is(TAG.OCTET_STRING)) return 'pkcs8'
    if (c.length >= 2 && isInt(c[0]) && c[1].is(TAG.OCTET_STRING)) return 'sec1'
    if (c.length >= 9 && c.slice(0, 9).every(isInt)) return 'pkcs1-private'
    if (c.length === 6 && c.every(isInt)) return 'dsa-private'
    if (c.length === 2 && c.every(isInt)) return 'pkcs1-public'
    return null
}

const KIND_NAMES = {
    certificate: 'a certificate',
    'trusted-certificate': 'a certificate',
    csr: 'a certificate request',
    spki: 'a public key',
    'pkcs1-public': 'an RSA public key',
    pkcs8: 'a private key',
    'encrypted-pkcs8': 'an encrypted private key',
    'pkcs1-private': 'an RSA private key',
    sec1: 'an EC private key',
    'dsa-private': 'a DSA private key',
    pkcs7: 'a PKCS#7 bundle',
    'ec-parameters': 'EC parameters',
    crl: 'a certificate revocation list',
}

function decodeAs(kind, der, context) {
    const { headers = {}, label = null } = context
    if (PRIVATE_KINDS.has(kind)) {
        return [{ kind: 'privateKey', privateKey: describePrivateKey(der, kind, { headers, labelType: LABEL_KEY_TYPES[label] ?? null }) }]
    }
    switch (kind) {
        case 'certificate':
            return [{ kind: 'certificate', certificate: parseCertificate(der) }]
        case 'trusted-certificate': {
            const root = parseDer(der, { allowTrailing: true })
            const item = { kind: 'certificate', certificate: parseCertificate(root) }
            if (root.end < der.length) item.trust = parseTrustSettings(der.subarray(root.end))
            return [item]
        }
        case 'csr':
            return [{ kind: 'csr', csr: parseCsr(der) }]
        case 'spki':
            return [{ kind: 'publicKey', format: 'SubjectPublicKeyInfo', publicKey: parsePublicKeyInfo(der) }]
        case 'pkcs1-public':
            parseRsaPublicKey(der)
            return [{ kind: 'publicKey', format: 'PKCS#1', publicKey: parsePublicKeyInfo(pkcs1ToSpki(der)) }]
        case 'ec-parameters': {
            const root = parseDer(der)
            if (!root.is(TAG.OID)) return [{ kind: 'unsupported', message: 'Only named-curve EC parameters can be read.' }]
            return [{ kind: 'ecParameters', curve: curveInfo(readOid(root)) }]
        }
        case 'pkcs7': {
            let root
            try {
                root = parseDer(der)
            } catch (error) {
                if (!/Indefinite length/.test(error.message)) throw error
                root = parseDer(der, { ber: true }) // some tools write PKCS#7 in BER
            }
            const bundle = parsePkcs7(root)
            const notes = [`PKCS#7 bundle with ${plural(bundle.certificates.length, 'certificate')}`]
            if (bundle.crlCount) notes.push(`${plural(bundle.crlCount, 'CRL')} (not shown)`)
            if (bundle.skipped) notes.push(`${plural(bundle.skipped, 'other certificate type')} (not shown)`)
            const items = [{ kind: 'bundle', message: `${notes.join(', ')}.` }]
            bundle.certificates.forEach((node, i) => {
                try {
                    items.push({ kind: 'certificate', certificate: parseCertificate(node.der), part: `certificate ${i + 1} of ${bundle.certificates.length}` })
                } catch (error) {
                    items.push({ kind: 'error', message: `Certificate ${i + 1} in the bundle can’t be read: ${error.message}`, part: `certificate ${i + 1}` })
                }
            })
            return items
        }
        case 'crl':
            return [{ kind: 'unsupported', message: UNSUPPORTED_LABELS['X509 CRL'] }]
        default:
            throw new Error('Unrecognised data.')
    }
}

// Decodes DER whose kind comes from a PEM label; if it doesn't parse as that,
// says what it really looks like.
function decodeLabelled(kind, der, context) {
    try {
        return decodeAs(kind, der, context)
    } catch (error) {
        const root = tryParseDer(der, { allowTrailing: true })
        const actual = root ? identifyDer(root) : null
        if (actual && actual !== kind && KIND_NAMES[actual] !== KIND_NAMES[kind]) {
            throw new Error(`The ${context.label} block holds ${KIND_NAMES[actual]}, not ${KIND_NAMES[kind]}. Check the BEGIN/END lines.`, { cause: error })
        }
        throw error
    }
}

function decodeUnlabelled(der) {
    let root
    try {
        root = parseDer(der, { allowTrailing: true })
    } catch (error) {
        if (/Indefinite length/.test(error.message)) {
            root = parseDer(der, { ber: true, allowTrailing: true })
            if (identifyDer(root) === 'pkcs7') return decodeAs('pkcs7', der.subarray(0, root.end), {})
        }
        throw error
    }
    if (root.end < der.length) {
        // Several DER elements one after another (e.g. concatenated certificates)
        const nodes = parseDerAll(der)
        return nodes.flatMap((node, i) => {
            const kind = identifyDer(node)
            if (!kind) throw new Error(`Element ${i + 1} isn’t a certificate, request, key or bundle.`)
            return decodeAs(kind, node.der, {}).map(item => ({ ...item, part: `element ${i + 1} of ${nodes.length}` }))
        })
    }
    const kind = identifyDer(root)
    if (!kind) throw new Error('This DER data isn’t a certificate, certificate request, key or PKCS#7 bundle.')
    return decodeAs(kind, der, {})
}

const HEX_INPUT = /^(?:0x)?[0-9a-fA-F]{2}(?:[\s:]*[0-9a-fA-F]{2})*$/
const BASE64_INPUT = /^[A-Za-z0-9+/\-_=\s]+$/
const OPENSSH_PUBLIC = /^(ssh-(rsa|dss|ed25519|ed448)|ecdsa-sha2-nistp\d+|sk-[a-z0-9@.-]+) AAAA/

/**
 * Decodes everything in the input (a string, or the bytes of a file).
 * @returns {{ items: object[], errors: { source, label, message }[] }}
 *   Items: { kind: 'certificate' | 'csr' | 'publicKey' | 'privateKey' |
 *   'ecParameters' | 'bundle' | 'unsupported' | 'error', source, label, … }.
 *   Problems that stop a whole block from being read are in `errors`.
 */
export function inspect(input) {
    const items = []
    const errors = []
    if (input === null || input === undefined) return { items, errors }
    if (typeof input !== 'string') {
        const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
        const fileError = (message) => ({ items, errors: [{ source: 'File', label: null, message }] })
        if (!bytes.length) return fileError('The file is empty.')
        if (bytes.length > MAX_INPUT_BYTES) return fileError(`The file is too large (the limit is ${MAX_INPUT_BYTES / 1024 / 1024} MB).`)
        // PEM, Base64 or hex text files are decoded as text; DER starts with a SEQUENCE (or an OID for EC parameters)
        const head = new TextDecoder().decode(bytes.subarray(0, 65536))
        const isDer = bytes[0] === 0x30 || bytes[0] === 0x06
        if (head.includes('-----BEGIN ') || (!isDer && BASE64_INPUT.test(head))) return inspect(new TextDecoder().decode(bytes))
        if (!isDer) return fileError('This file isn’t PEM text or DER data.')
        try {
            items.push(...decodeUnlabelled(bytes).map(item => ({ ...item, source: item.part ? `DER file · ${item.part}` : 'DER file', label: null })))
        } catch (error) {
            errors.push({ source: 'DER file', label: null, message: error.message })
        }
        return { items, errors }
    }

    const text = input
    if (text.length > MAX_INPUT_BYTES) return { items, errors: [{ source: 'Input', label: null, message: `The text is too long (the limit is ${MAX_INPUT_BYTES / 1024 / 1024} MB).` }] }
    const { blocks, problems } = scanPem(text)
    for (const p of problems) errors.push({ source: `Line ${p.line}`, label: p.label, message: p.message })
    const many = blocks.length > 1
    for (const block of blocks) {
        const source = many ? `${block.label} on line ${block.line}` : block.label
        const kind = LABEL_KINDS[block.label]
        const secret = PRIVATE_KINDS.has(kind) || /PRIVATE/.test(block.label)
        if (!kind) {
            const message = UNSUPPORTED_LABELS[block.label] ?? `“${block.label}” blocks aren’t supported. This tool reads certificates, certificate requests, public and private keys, and PKCS#7 bundles.`
            items.push(secret
                ? { kind: 'privateKey', source, label: block.label, privateKey: { format: block.label, formatLabel: block.label, type: 'unknown', bits: null, curve: null, encrypted: null, encryption: null, unsupported: message } }
                : { kind: 'unsupported', source, label: block.label, message })
            continue
        }
        try {
            const der = decodeBase64Body(block.body, block.label)
            const decoded = decodeLabelled(kind, der, { headers: block.headers, label: block.label })
            items.push(...decoded.map(item => ({ ...item, source: item.part ? `${source} · ${item.part}` : source, label: block.label })))
        } catch (error) {
            // A private key that can't be read is still a secret: say so instead of a plain error
            if (secret) {
                items.push({ kind: 'privateKey', source, label: block.label, privateKey: { format: kind, formatLabel: PRIVATE_FORMATS[kind] ?? block.label, type: LABEL_KEY_TYPES[block.label] ?? 'unknown', bits: null, curve: null, encrypted: null, encryption: null, unsupported: error.message } })
            } else {
                errors.push({ source, label: block.label, message: error.message })
            }
        }
    }
    if (blocks.length || problems.length) return { items, errors }

    // No PEM armour: bare Base64 or hex DER
    const trimmed = text.trim()
    if (!trimmed) return { items, errors }
    if (OPENSSH_PUBLIC.test(trimmed)) {
        errors.push({ source: 'Input', label: null, message: 'This is an OpenSSH public key, which isn’t X.509. Convert it to PEM first, e.g. ssh-keygen -e -m PKCS8 -f key.pub' })
        return { items, errors }
    }
    const attempts = []
    if (HEX_INPUT.test(trimmed)) attempts.push(['hex', () => hexToBytes(trimmed.replace(/^0x/i, ''))])
    if (BASE64_INPUT.test(trimmed)) attempts.push(['Base64', () => base64ToBytes(trimmed.replace(/\s+/g, ''))])
    if (!attempts.length) {
        errors.push({ source: 'Input', label: null, message: 'No certificate or key found. Paste PEM text (“-----BEGIN CERTIFICATE-----” …), or Base64 or hex DER.' })
        return { items, errors }
    }
    let firstError = null
    for (const [encoding, decode] of attempts) {
        try {
            const der = decode()
            const decoded = decodeUnlabelled(der)
            items.push(...decoded.map(item => ({ ...item, source: item.part ? `${encoding} DER · ${item.part}` : `${encoding} DER`, label: null })))
            return { items, errors }
        } catch (error) {
            firstError ??= `The input looks like ${encoding} but doesn’t decode to a certificate or key: ${error.message}`
        }
    }
    errors.push({ source: 'Input', label: null, message: firstError })
    return { items, errors }
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

function linkBetween(child, parent) {
    const names = compareNames(child.issuer, parent.subject)
    const keyIds = child.authorityKeyId && parent.subjectKeyId ? child.authorityKeyId === parent.subjectKeyId : null
    return { names, keyIds, ok: names !== 'different' && keyIds !== false }
}

/** Issuer and subject match, and so do the key IDs when both are present. */
export const isSelfSigned = (cert) => cert.selfIssued && (!cert.authorityKeyId || !cert.subjectKeyId || cert.authorityKeyId === cert.subjectKeyId)

/**
 * Index of the certificate in `certs` that issued certs[index] (matching names
 * and key IDs), `index` itself for a self-signed certificate, or -1.
 */
export function findIssuerIndex(certs, index) {
    const cert = certs[index]
    if (isSelfSigned(cert)) return index
    return certs.findIndex((candidate, i) => i !== index && linkBetween(cert, candidate).ok)
}

// Leaf-first order of all certificates when they form one chain, else null
function chainOrder(certs) {
    const n = certs.length
    const issuerOf = certs.map((c, i) => certs.findIndex((p, j) => j !== i && !isSelfSigned(c) && linkBetween(c, p).ok))
    const isIssuer = new Set(issuerOf.filter(j => j >= 0))
    const leaves = certs.map((_, i) => i).filter(i => !isIssuer.has(i))
    if (leaves.length !== 1) return null
    const order = [leaves[0]]
    while (order.length < n) {
        const next = issuerOf[order[order.length - 1]]
        if (next < 0 || order.includes(next)) return null
        order.push(next)
    }
    return order
}

/**
 * How certificates (in the given order, leaf first) link up. Checks names,
 * key identifiers, CA flags, key usage and path length constraints; signature
 * checks are separate (verifySignature). This isn't path validation: no trust
 * store, revocation or policy checks.
 * @returns {{ links, roles, issues: string[], related: boolean, linked: number, suggestedOrder: number[] | null, endsAtRoot: boolean }}
 *   related: at least one certificate issued the next one; linked: how many did.
 */
export function analyzeChain(certs) {
    const n = certs.length
    const links = []
    for (let i = 0; i + 1 < n; i++) {
        const link = linkBetween(certs[i], certs[i + 1])
        // A path ends at a self-signed certificate, whatever follows it
        links.push(isSelfSigned(certs[i]) ? { ...link, ok: false, selfSigned: true } : link)
    }
    const related = links.some(l => l.ok)
    let suggestedOrder = null
    if (links.some(l => !l.ok)) {
        const order = chainOrder(certs)
        if (order && order.some((v, i) => v !== i)) suggestedOrder = order
    }
    const roles = certs.map((cert, i) => {
        if (n < 2) return isSelfSigned(cert) ? 'self-signed' : null
        if (!related) return null
        if (isSelfSigned(cert)) return 'root'
        return i === 0 ? 'leaf' : 'intermediate'
    })
    const issues = []
    const label = (i) => `certificate ${i + 1}`
    links.forEach((link, i) => {
        if (link.selfSigned) issues.push(`Certificate ${i + 1} is self-signed, so a chain ends there: certificate ${i + 2} isn’t its issuer.`)
        else if (link.names === 'different') issues.push(`Break between ${label(i)} and ${label(i + 1)}: the issuer of ${label(i)} (${formatName(certs[i].issuer)}) isn’t the subject of ${label(i + 1)} (${formatName(certs[i + 1].subject)}).`)
        else if (link.keyIds === false) issues.push(`Break between ${label(i)} and ${label(i + 1)}: the authority key ID of ${label(i)} doesn’t match the subject key ID of ${label(i + 1)}.`)
    })
    // Issuer checks, for each certificate that really issued the one before it
    certs.forEach((cert, i) => {
        if (i === 0 || !links[i - 1].ok) return
        const name = `Certificate ${i + 1}`
        if (cert.isCa === false || (cert.isCa === null && cert.version === 3)) issues.push(`${name} isn’t a CA certificate (basic constraints), so it can’t issue certificate ${i}.`)
        if (cert.keyUsage && !cert.keyUsage.includes('Certificate signing')) issues.push(`${name}’s key usage doesn’t include certificate signing.`)
        // pathLen counts the intermediate CAs between this certificate and the bottom of its
        // linked run (the leaf, in a well-ordered chain); self-issued ones don't count
        let start = i
        while (start > 0 && links[start - 1].ok) start--
        const below = certs.slice(start + 1, i).filter(c => !c.selfIssued).length
        if (cert.pathLen !== null && below > cert.pathLen) {
            issues.push(`${name} allows ${plural(cert.pathLen, 'intermediate CA')} below it (path length ${cert.pathLen}), but this chain has ${below}.`)
        }
    })
    return { links, roles, issues, related, linked: links.filter(l => l.ok).length, suggestedOrder, endsAtRoot: n > 0 && isSelfSigned(certs[n - 1]) }
}

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000

export function startOfLocalDay(ms) {
    const d = new Date(ms)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
}

export const startOfUtcDay = (ms) => Math.floor(ms / DAY_MS) * DAY_MS

const days = (n) => plural(n, 'day')

/**
 * Validity at `now` in whole calendar days (local by default):
 * { state: 'valid' | 'expired' | 'not-yet-valid', days, tone, text }.
 * notBefore and notAfter are inclusive, as in RFC 5280.
 */
export function validityStatus(notBefore, notAfter, now, { startOfDay = startOfLocalDay } = {}) {
    const between = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY_MS)
    if (now < notBefore) {
        const d = between(now, notBefore)
        return { state: 'not-yet-valid', days: d, tone: 'warning', text: d === 0 ? 'Not yet valid · starts today' : `Not yet valid · starts in ${days(d)}` }
    }
    if (now > notAfter) {
        const d = between(notAfter, now)
        return { state: 'expired', days: d, tone: 'danger', text: d === 0 ? 'Expired today' : `Expired ${days(d)} ago` }
    }
    const d = between(now, notAfter)
    return { state: 'valid', days: d, tone: d <= 30 ? 'warning' : 'success', text: d === 0 ? 'Valid · expires today' : `Valid · expires in ${days(d)}` }
}

// ---------------------------------------------------------------------------
// Digests and signatures (async, WebCrypto)
// ---------------------------------------------------------------------------

/** SHA-256 and SHA-1 fingerprints of DER bytes, as "AB:CD:…". */
export async function fingerprints(der) {
    const digests = await digestAll(der, ['SHA-256', 'SHA-1'])
    return { sha256: colonHex(digests['SHA-256']), sha1: colonHex(digests['SHA-1']) }
}

/** Base64 SHA-256 of a SubjectPublicKeyInfo (HPKP / curl --pinnedpubkey pin). */
export async function spkiPin(spkiDer) {
    const digests = await digestAll(spkiDer, ['SHA-256'])
    return bytesToBase64(digests['SHA-256'])
}

/** ECDSA signature: DER SEQUENCE { r, s } → raw r‖s, each padded to `size` bytes. */
export function ecdsaDerToRaw(der, size) {
    const root = parseDer(der)
    expectSequence(root, 'ECDSA signature')
    if (root.children.length !== 2) fail('An ECDSA signature holds two numbers', root)
    const out = new Uint8Array(size * 2)
    root.children.forEach((node, i) => {
        if (readInteger(expectNode(node, TAG.INTEGER, 'ECDSA signature value')) <= 0n) fail('ECDSA signature values must be positive', node)
        const bytes = integerBytes(node)
        if (bytes.length > size) fail('An ECDSA signature value is too long for the curve', node)
        out.set(bytes, i * size + size - bytes.length)
    })
    return out
}

function verificationPlan(algorithm, key, signature) {
    const { family, hash } = algorithm
    const mismatch = (expected) => ({ result: { status: 'invalid', reason: `The signature is ${expected}, but the issuer’s key is ${key.summary}.` } })
    if (!family) return { result: { status: 'unsupported', reason: `${algorithm.label} signatures can’t be checked in the browser.` } }
    switch (family) {
        case 'rsa':
        case 'rsa-pss': {
            if (key.type !== 'RSA' && key.type !== 'RSA-PSS') return mismatch('RSA')
            if (!WEBCRYPTO_HASHES.has(hash)) return { result: { status: 'unsupported', reason: `WebCrypto can’t check ${hash} signatures.` } }
            const keyData = pkcs1ToSpki(key.rsa.der)
            if (family === 'rsa') return { importAlg: { name: 'RSASSA-PKCS1-v1_5', hash }, verifyAlg: { name: 'RSASSA-PKCS1-v1_5' }, keyData, signature }
            const { pss } = algorithm
            if (pss.mgfHash !== pss.hash) return { result: { status: 'unsupported', reason: 'WebCrypto needs the same hash for PSS and MGF1.' } }
            if (pss.trailerField !== 1) return { result: { status: 'unsupported', reason: 'Unsupported PSS trailer field.' } }
            return { importAlg: { name: 'RSA-PSS', hash }, verifyAlg: { name: 'RSA-PSS', saltLength: pss.saltLength }, keyData, signature }
        }
        case 'ecdsa': {
            if (key.type !== 'EC') return mismatch('ECDSA')
            if (!WEBCRYPTO_HASHES.has(hash)) return { result: { status: 'unsupported', reason: `WebCrypto can’t check ${hash} signatures.` } }
            if (!key.curve?.webcrypto) return { result: { status: 'unsupported', reason: `WebCrypto doesn’t support the ${key.curve?.name ?? 'unknown'} curve.` } }
            let raw
            try {
                raw = ecdsaDerToRaw(signature, key.curve.size)
            } catch (error) {
                return { result: { status: 'invalid', reason: `The ECDSA signature is malformed: ${error.message}.` } }
            }
            return { importAlg: { name: 'ECDSA', namedCurve: key.curve.webcrypto }, verifyAlg: { name: 'ECDSA', hash }, keyData: key.der, signature: raw }
        }
        case 'eddsa':
            if (key.type !== algorithm.curve) return mismatch(algorithm.curve)
            return { importAlg: { name: key.type }, verifyAlg: { name: key.type }, keyData: key.der, signature }
        default:
            return { result: { status: 'unsupported', reason: `${algorithm.label} signatures can’t be checked in the browser.` } }
    }
}

/**
 * Checks a signature with WebCrypto.
 * @param {{ data: Uint8Array, signature: Uint8Array, algorithm: object, publicKey: object }} args
 *   data: the signed bytes (TBSCertificate or CertificationRequestInfo DER);
 *   algorithm: a parsed signatureAlgorithm; publicKey: the signer's parsed key.
 * @returns {Promise<{ status: 'valid' | 'invalid' | 'unsupported', reason?: string }>}
 */
export async function verifySignature({ data, signature, algorithm, publicKey }) {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return { status: 'unsupported', reason: 'WebCrypto isn’t available on this page (it needs HTTPS or localhost).' }
    const plan = verificationPlan(algorithm, publicKey, signature)
    if (plan.result) return plan.result
    let key
    try {
        key = await subtle.importKey('spki', plan.keyData, plan.importAlg, false, ['verify'])
    } catch (error) {
        return { status: 'unsupported', reason: `This browser can’t use the ${publicKey.summary} key for ${plan.importAlg.name} (${error?.message || error?.name || 'not supported'}).` }
    }
    try {
        const ok = await subtle.verify(plan.verifyAlg, key, plan.signature, data)
        return ok ? { status: 'valid' } : { status: 'invalid', reason: 'The signature doesn’t match.' }
    } catch (error) {
        return { status: 'unsupported', reason: `The browser couldn’t check the signature (${error?.message || error?.name}).` }
    }
}
