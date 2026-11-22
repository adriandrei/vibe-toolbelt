#!/usr/bin/env bash
# Regenerates the X.509 and key fixtures used by src/utils/asn1.test.js,
# src/utils/x509.test.js and tests/certificate.spec.js.
#
# Every key in this folder is a throwaway TEST key made only for this test
# suite. It protects nothing: never use any of them for anything real.
#
# Needs OpenSSL 3.x (made with 3.2.1). Run from anywhere:
#   bash tests/fixtures/certs/generate.sh
# Regenerating makes new keys, serial numbers and dates, so the expected values
# hard-coded in the tests (copied from `openssl x509 -noout -text ...` output)
# must be updated afterwards.
set -euo pipefail
cd "$(dirname "$0")"
# Scratch files (CA keys, CSRs, configs) go in a relative folder that is removed
# at the end: relative paths work for native Windows OpenSSL builds too.
work=".work"
rm -rf "$work"
mkdir "$work"
trap 'rm -rf "$work"' EXIT

# ---------------------------------------------------------------------------
# 1. RSA-2048 self-signed certificate with every kind of subjectAltName and a
#    UTF-8 subject that includes a multi-valued RDN.
# ---------------------------------------------------------------------------
cat > "$work/rsa-san.cnf" <<'EOF'
[req]
prompt = no
utf8 = yes
string_mask = utf8only
distinguished_name = dn
x509_extensions = ext

[dn]
C = RO
ST = București
L = Cluj-Napoca
O = Toolbelt Test Ünïcödé SRL
OU = QA
+UID = qa-team
CN = www.example.test
emailAddress = admin@example.test

[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
subjectAltName = @san

[san]
DNS.1 = www.example.test
DNS.2 = *.example.test
IP.1 = 192.0.2.10
IP.2 = 2001:db8::10
email.1 = admin@example.test
URI.1 = https://example.test/path?q=1
otherName.1 = 1.3.6.1.4.1.311.20.2.3;UTF8:user@example.test
dirName.1 = san_dir
RID.1 = 1.2.3.4

[san_dir]
C = RO
O = Directory Org
CN = Directory Name
EOF
openssl req -x509 -new -newkey rsa:2048 -noenc -keyout "$work/rsa-san.key" -config "$work/rsa-san.cnf" \
    -sha256 -days 825 -set_serial 0xF1E2D3C4B5A69788796A5B4C3D2E1F00112233 -out rsa-san.pem
openssl x509 -in rsa-san.pem -outform DER -out rsa-san.der

# ---------------------------------------------------------------------------
# 2. Three-level chain: RSA-3072 root -> EC P-384 intermediate (pathlen 0,
#    name constraints) -> EC P-256 leaf (serverAuth + clientAuth, CRL DP, AIA,
#    policies, OCSP must-staple and a fake two-entry SCT list).
# ---------------------------------------------------------------------------
cat > "$work/root.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
x509_extensions = ext

[dn]
C = RO
O = Toolbelt Test PKI
OU = Test only
CN = Toolbelt Test Root CA

[ext]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
openssl req -x509 -new -newkey rsa:3072 -noenc -keyout "$work/root.key" -config "$work/root.cnf" \
    -sha512 -days 3650 -set_serial 0x1001 -out chain-root.pem

cat > "$work/int.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn

[dn]
C = RO
O = Toolbelt Test PKI
CN = Toolbelt Test Intermediate CA

[ext]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, digitalSignature, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
nameConstraints = critical, permitted;DNS:example.test, permitted;email:example.test, excluded;IP:192.168.0.0/255.255.0.0, excluded;IP:fd00:0:0:0:0:0:0:0/ff00:0:0:0:0:0:0:0
certificatePolicies = 2.5.29.32.0
crlDistributionPoints = URI:http://crl.example.test/root.crl
authorityInfoAccess = caIssuers;URI:http://ca.example.test/root.crt
EOF
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-384 -noenc -keyout "$work/int.key" \
    -config "$work/int.cnf" -out "$work/int.csr"
openssl x509 -req -in "$work/int.csr" -CA chain-root.pem -CAkey "$work/root.key" -sha384 -days 1825 \
    -set_serial 0x2002 -extfile "$work/int.cnf" -extensions ext -out chain-intermediate.pem

# SignedCertificateTimestampList (RFC 6962) with two fake SCTs: only the count
# is shown, so the log IDs and signatures are dummies.
sct() { # $1 = log ID byte, $2 = 64-bit timestamp (hex)
    printf '0037'                      # SCT length: 55 bytes
    printf '00'                        # version v1
    printf "$1%.0s" $(seq 1 32)        # log ID
    printf '%s' "$2"                   # timestamp
    printf '0000'                      # no extensions
    printf '0403'                      # sha256 / ecdsa
    printf '0008'                      # signature length
    printf '3006020101020101'          # dummy DER signature
}
scts="0072$(sct 11 0000019a12345678)$(sct 22 0000019a12345679)"
sct_der="04$(printf '%02x' $((${#scts} / 2)))${scts}"

cat > "$work/leaf.cnf" <<EOF
[req]
prompt = no
distinguished_name = dn

[dn]
C = RO
O = Toolbelt Test PKI
CN = leaf.example.test

[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth, clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
subjectAltName = DNS:leaf.example.test, DNS:api.example.test
crlDistributionPoints = URI:http://crl.example.test/intermediate.crl
authorityInfoAccess = OCSP;URI:http://ocsp.example.test, caIssuers;URI:http://ca.example.test/intermediate.crt
certificatePolicies = 2.23.140.1.2.1, @cps
tlsfeature = status_request
1.3.6.1.4.1.11129.2.4.2 = DER:${sct_der}

[cps]
policyIdentifier = 1.3.6.1.4.1.55555.1.1
CPS.1 = "https://example.test/cps"
userNotice.1 = @notice

[notice]
explicitText = "Test certificate, do not trust"
EOF
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -keyout "$work/leaf.key" \
    -config "$work/leaf.cnf" -out "$work/leaf.csr"
openssl x509 -req -in "$work/leaf.csr" -CA chain-intermediate.pem -CAkey "$work/int.key" -sha384 -days 397 \
    -set_serial 0x5EAF00D5EAF00D5EAF00D5EAF00D -extfile "$work/leaf.cnf" -extensions ext -out chain-leaf.pem

cat chain-leaf.pem chain-intermediate.pem chain-root.pem > chain.pem
openssl crl2pkcs7 -nocrl -certfile chain.pem -outform DER -out chain.p7b
openssl crl2pkcs7 -nocrl -certfile chain.pem -out chain-pkcs7.pem
openssl x509 -in chain-root.pem -addtrust serverAuth -addreject emailProtection -setalias "Toolbelt Test Root" \
    -trustout -out root-trusted.pem

# ---------------------------------------------------------------------------
# 3. Ed25519 self-signed certificate, X.509 version 1 (no version field and
#    no extensions).
# ---------------------------------------------------------------------------
cat > "$work/ed25519.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn

[dn]
O = Toolbelt Test
CN = ed25519.example.test
EOF
openssl genpkey -algorithm ED25519 -out "$work/ed25519.key"
openssl req -x509 -x509v1 -new -key "$work/ed25519.key" -config "$work/ed25519.cnf" -days 365 \
    -set_serial 0x4004 -out ed25519.pem

# ---------------------------------------------------------------------------
# 4. RSA certificate signed with RSA-PSS, valid from 1999 (UTCTime, where "99"
#    means 1999) to 2051 (GeneralizedTime), with T61String and BMPString names
#    (string_mask = default picks them for non-ASCII text).
# ---------------------------------------------------------------------------
mkdir -p "$work/ca"
touch "$work/ca/index.txt"
echo 7F > "$work/ca/serial"
cat > "$work/dates.cnf" <<EOF
[req]
prompt = no
utf8 = yes
string_mask = default
distinguished_name = dn

[dn]
C = RO
L = Iași
O = Ünïcödé Test
CN = dates.example.test

[ca]
default_ca = test_ca

[test_ca]
dir = $work/ca
database = $work/ca/index.txt
serial = $work/ca/serial
new_certs_dir = $work/ca
default_md = sha256
policy = policy_any
unique_subject = no
copy_extensions = none

[policy_any]
countryName = optional
localityName = optional
organizationName = optional
commonName = supplied
EOF
openssl req -new -newkey rsa:2048 -noenc -keyout "$work/dates.key" -config "$work/dates.cnf" -out "$work/dates.csr"
openssl ca -batch -selfsign -preserveDN -config "$work/dates.cnf" -keyfile "$work/dates.key" -in "$work/dates.csr" \
    -startdate 19990101000000Z -enddate 20510101000000Z -md sha256 \
    -sigopt rsa_padding_mode:pss -sigopt rsa_pss_saltlen:32 -sigopt rsa_mgf1_md:sha256 -notext -out rsa-dates.pem

# ---------------------------------------------------------------------------
# 5. CSR (EC P-256) with SANs, key usages and attributes.
# ---------------------------------------------------------------------------
cat > "$work/csr.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
req_extensions = ext
attributes = attrs

[dn]
C = RO
O = Toolbelt Test
CN = csr.example.test

[attrs]
challengePassword = test-challenge-password
unstructuredName = Toolbelt test request

[ext]
basicConstraints = CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = DNS:csr.example.test, DNS:www.csr.example.test, IP:198.51.100.7, email:csr@example.test
EOF
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -keyout "$work/csr.key" \
    -config "$work/csr.cnf" -sha256 -out csr-ec.csr

# A CSR carrying less common extensions, so their decoders are tested against
# OpenSSL's own encoding (and `openssl req -text` output).
cat > "$work/csr-extensions.cnf" <<'EOF'
[req]
prompt = no
distinguished_name = dn
req_extensions = ext

[dn]
CN = extensions.example.test

[ext]
crlDistributionPoints = crldp1, crldp2
freshestCRL = URI:http://crl.example.test/delta.crl
issuerAltName = email:ca@example.test, URI:https://ca.example.test
subjectInfoAccess = caRepository;URI:http://repo.example.test/
policyConstraints = requireExplicitPolicy:1, inhibitPolicyMapping:2
inhibitAnyPolicy = 3
policyMappings = 1.3.6.1.4.1.55555.1.1:1.3.6.1.4.1.55555.1.2
nsCertType = server, client
nsComment = "Generated by the test suite"
noCheck = ignored
1.3.6.1.4.1.55555.9.1 = critical, DER:04:03:01:02:03
1.3.6.1.4.1.55555.9.2 = ASN1:UTF8String:Custom text value

[crldp1]
fullname = URI:http://crl.example.test/a.crl
reasons = keyCompromise, CACompromise
CRLissuer = dirName:crl_issuer

[crldp2]
relativename = rel

[rel]
CN = Relative CRL

[crl_issuer]
C = RO
CN = CRL Issuer
EOF
openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:P-256 -noenc -keyout "$work/csr-extensions.key" \
    -config "$work/csr-extensions.cnf" -out csr-extensions.csr

# ---------------------------------------------------------------------------
# 6. Public keys (they match the certificates above).
# ---------------------------------------------------------------------------
openssl pkey -in "$work/rsa-san.key" -pubout -out pub-rsa.pem
openssl rsa -in "$work/rsa-san.key" -RSAPublicKey_out -out pub-rsa-pkcs1.pem
openssl pkey -in "$work/leaf.key" -pubout -out pub-ec.pem
openssl pkey -in "$work/ed25519.key" -pubout -out pub-ed25519.pem

# ---------------------------------------------------------------------------
# 7. Throwaway TEST private keys (labelled as such in the files).
# ---------------------------------------------------------------------------
note='Throwaway TEST key for the test suite. It protects nothing: never use it.'
openssl genrsa -traditional -out "$work/test-rsa.key" 2048
openssl ecparam -name prime256v1 -genkey -noout -out "$work/test-ec.key"
openssl genpkey -algorithm ED25519 -out "$work/test-ed25519.key"
openssl rsa -in "$work/test-rsa.key" -traditional -aes256 -passout pass:test-only -out "$work/test-rsa-enc.key"
openssl pkcs8 -topk8 -in "$work/test-rsa.key" -v2 aes-256-cbc -v2prf hmacWithSHA256 -iter 100000 \
    -passout pass:test-only -out "$work/test-pkcs8-enc.key"
{ echo "$note"; cat "$work/test-rsa.key"; } > test-key-rsa-pkcs1.key
{ echo "$note"; cat "$work/test-rsa-enc.key"; } > test-key-rsa-legacy-encrypted.key
{ echo "$note (Password: test-only)"; cat "$work/test-pkcs8-enc.key"; } > test-key-encrypted-pkcs8.key
{ echo "$note"; cat "$work/test-ec.key"; } > test-key-ec-sec1.key
{ echo "$note"; cat "$work/test-ed25519.key"; } > test-key-ed25519-pkcs8.key

# ---------------------------------------------------------------------------
# 8. OpenSSL's element listings (offset, depth, header and content lengths),
#    which the ASN.1 parser tests compare against element by element.
# ---------------------------------------------------------------------------
openssl asn1parse -inform DER -in rsa-san.der > rsa-san.asn1parse.txt
openssl asn1parse -in chain-leaf.pem > chain-leaf.asn1parse.txt
openssl asn1parse -inform DER -in chain.p7b > chain.p7b.asn1parse.txt

echo "Fixtures written to $(pwd)"
