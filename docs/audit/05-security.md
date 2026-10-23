# Audit — Security & generators

**Pages:** `/jwt` · `/hash` · `/hmac` · `/rsa` · `/bcrypt` · `/aes` · `/otp` · `/password` · `/nanoid` · `/uuid` · `/username` · `/chmod` · `/privacy-scanner`

Part of the [project audit](README.md). Each finding is labelled with **severity** (critical / high / medium / low) and **confidence**:
- *confirmed-by-running*: reproduced with the real code or libraries.
- *confirmed-by-reading*: the code path was traced in the source.
- *suspected*: needs a check in a real browser or device.

Line numbers refer to commit `a3c843b`.

**How it was verified:** Crypto output was checked against Node's `crypto` and RFC test vectors, using the installed jose, crypto-js, jsencrypt, bcryptjs, otpauth, zxcvbn and uuid.

---

**Biggest problems:**
- The ULID generator produces invalid 20-character IDs.
- The Privacy Scanner never reads PDF metadata. It does no text/PII scanning at all, although the README says it does, and it shows a green all-clear for every failure.
- RSA key generation freezes the tab (4096-bit takes about 12–14 s). About 37% of keys are one bit shorter than labelled, and the app's own JWT verifier rejects those 2047-bit keys.
- The JWT verifier says "Invalid Signature" for tokens whose signature is valid but are expired or not yet valid. For RSA/EC keys it reports the wrong error.
- Password Audit runs zxcvbn on every render with no length limit: 400 chars takes about 1.2 s, 1000 chars about 19 s.
- Bcrypt hashing and compare run on the main thread. The cost slider goes to 16 (about 3.2 s per hash), and compare runs on every keystroke.
- The AES page's "Secure… AES-256" claim is misleading (MD5-based key derivation, CBC with no authentication). A wrong key can "succeed" with garbage output. Its own interop target, OpenSSL's default multi-line output, fails to decrypt.

---

### /jwt — src/pages/Jwt.jsx (351 lines)
**What it does:**
- Splits the token on `.`, requires exactly 3 parts, decodes header and payload (atob + percent-decoding + `JSON.parse`), and shows header, payload and raw signature. base64url `-`/`_` and unpadded input decode correctly (confirmed-by-running).
- The Verify panel picks a branch from the header `alg` prefix, defaulting to HS256 if `alg` is missing:
  - `HS*` → `jwtVerify` with the UTF-8 secret.
  - `RS*`/`PS*`/`ES*` → `importSPKI`, falling back to `importJWK`.
  - Anything else → "Unsupported algorithm".
- Valid HS256, RS256 (PEM and JWK) and ES256 tokens verify correctly (confirmed-by-running).
- `exp`/`iat`/`nbf` appear only as raw numbers. There is no expiry badge, no copy buttons, and no JWE or nested-JWT support.

**Integrations:**
- **Smart input (L32):** injected tokens auto-decode, and there's no default sample to overwrite them. But injected text skips the `.trim()` at L159 (JWT-3). Picking JWT from the command palette injects the search text ("jwt", "security"), so the page opens on a red "Invalid JWT format".
- **Pipeline:** Read puts the data into the token field untrimmed (L155); Send sends the pretty-printed payload JSON (L303). The README's "JWT → JSON Formatter" flow works, but only by hand:
  1. Send gives no feedback.
  2. You navigate to the Formatter yourself.
  3. You click "Read Pipeline".
  4. You click Format, because Formatters doesn't re-format when its input changes.

  After sending, Jwt itself shows "Read Pipeline", which would load the payload JSON back in as a token.
- **AI context:** deps `[token, decoded]` match `getContext`, so there's no stale closure.
- **Pinned pane:**
  - It uses the same `useLocation()`, so a pinned Jwt also consumes smart-input navigation meant for the main pane and its token gets overwritten.
  - Its AI registration overrides the main page's, and unpinning runs `setToolContext(null)`, wiping the main page's AI context.
  - It has no ErrorBoundary, so JWT-4 takes down the whole app.

**Bugs (functional):**
- **JWT-1 (medium, confirmed-by-running) L93-95, L124-133, L265-267:** `jwtVerify` also checks claims. A correctly signed token with:
  - a past `exp` shows "Invalid Signature — Token has expired";
  - a future `nbf` shows "Invalid Signature — "nbf" claim timestamp check failed";
  - a string `iat` shows "Invalid Signature — "iat" claim must be a number".
- **JWT-2 (medium, confirmed-by-running) L99-118:** one `try` wraps both `importSPKI` and `jwtVerify`. Any verification failure falls into the JWK branch, whose catch prints the *first* error `e` (L115) and discards `jwkError`. Results:
  - RS256 + a well-formed PEM of the wrong key → "Key format error: signature verification failed".
  - Expired RS256 + the right key → "Key format error: "exp" claim timestamp check failed".
  - JWK of the wrong key → "Key format error: "spki" must be SPKI formatted string".
- **JWT-3 (medium, confirmed-by-running) L32/L155 vs L159:** SmartPaste passes the raw clipboard text (the analyzer trims only to detect). A token with a leading space or newline decodes fine, because atob ignores whitespace, but jose includes the whitespace in the signed input. A valid HS256 token then shows "Signature does not match". Trailing whitespace verifies fine.
- **JWT-4 (low, confirmed-by-running) L139-142, L192, L207, L211:** a crafted header crashes the render:
  - `{"alg":256}` → "alg.startsWith is not a function" (optional chaining doesn't guard non-strings).
  - `{"alg":{}}` → "Objects are not valid as a React child" at L192.

  In the pinned pane this hits React Router's root error screen, i.e. the whole app.
- **JWT-5 (low, confirmed-by-running) L9-19, L68-72:** a valid JWS whose payload is not a JSON object fails with "Failed to decode Base64Url components". This covers text payloads like "hello world", nested JWTs, and falsy JSON (`0`, `false`, `null`). The header is hidden as well.
- **JWT-6 (low, confirmed-by-running) L90-121:**
  - EdDSA gives "Unsupported algorithm: EdDSA", although jose supports it.
  - An X.509 `BEGIN CERTIFICATE` PEM or a JWKS `{"keys":[…]}` gives a key-format error.
  - There's no "secret is base64" option, so binary HMAC keys always say "Signature does not match".
  - jose rejects RSA keys under 2048 bits, shown as "Key format error: RS256 requires key modulusLength to be 2048 bits or larger". That includes keys from this app's own /rsa page (RSA-2).
- **JWT-7 (low, confirmed-by-reading) L236:** `className="spin"` does nothing. `.spin` is only defined in ApiTester.jsx's local `<style>` (ApiTester.jsx:620).

**UX issues:**
- No human-readable `exp`/`iat`/`nbf` and no expired / not-yet-valid indicator, even though "Is this token expired?" is one of the suggested AI prompts.
- The result banner always says "Invalid Signature", including for unsupported alg, bad key format and failed claims.
- `alg: none` shows "Invalid Signature — Unsupported algorithm: none" instead of "unsecured token, nothing to verify".
- A missing `alg` gives an empty hint and an "Unknown" badge, while verification silently assumes HS256.
- Errors use `--accent` (purple), not a danger colour.
- No copy buttons for header, payload or signature.
- On phones (suspected, CSS arithmetic): the result grid's `minmax(300px,1fr)` (L278) leaves about 279px inside a 32px-padded panel at 375px width, so the page scrolls sideways.

**Theming issues:**
- L180-181, L188, L328: hardcoded blue `rgba(59,130,246,…)` ignores the hue setting; the badge at L188 puts `var(--primary)` text on that blue tint. Use `color-mix(in srgb, var(--primary) 5–20%, transparent)`.
- L223: `#fff` on `var(--primary)` has dark-mode contrast of 1.40:1 (Emerald), 1.83:1 (Amber) and 2.03:1 (Cyber Blue).
- L253-266: `#22c55e` text is 2.06:1 on the light background. Add `--success`/`--danger` tokens with light-mode variants.
- L164-169: errors are coloured with `--accent`.

**Fix sketch:**
- JWT-1: check the signature with `jose.compactVerify`, then evaluate `exp`/`nbf`/`iat` separately ("Signature valid · expired 2h ago").
- JWT-2: separate key import from verification. Choose the importer by content (`BEGIN CERTIFICATE` → `importX509`, `{` → `importJWK`/JWKS, otherwise `importSPKI`) and report the error from the step that actually failed.
- JWT-3: normalize inside the decode effect (`token.replace(/\s+/g,'')`) and pass the normalized string to jose.
- JWT-4: `const alg = typeof h.alg === 'string' ? h.alg : undefined`, and render it with `String()`.
- JWT-5: decode each part to text first; show the raw text when JSON parsing fails; give header and payload separate errors.
- JWT-6: support EdDSA, `importX509`, JWKS lookup by `kid`, and a base64/hex secret toggle; explain jose's 2048-bit minimum.
- JWT-7: move `.spin` and `@keyframes spin` into global.css.

### /hash — src/pages/Hash.jsx (86 lines)
**What it does:**
- Computes MD5, SHA-1, SHA-256 and SHA-512 with crypto-js (UTF-8) in a `useEffect` on every keystroke. Each row has Send to Pipeline and Copy.
- Output matches Node `crypto` for "", "abc", a UTF-8 string with emoji and CJK, and 1000×"a" (confirmed-by-running). The UI never shows the "" digests, though.
- No SHA-384, SHA-3 or RIPEMD (all available in crypto-js), no file input, no compare field, no uppercase or base64 output.

**Integrations:**
- **Smart input (L14):** no analyzer routes to /hash. The only producer is the command palette, so the search text ("hash", "sha", "security") gets hashed. There's no default sample to overwrite it.
- **Pipeline:** Read loads into the input; Send exists per digest and is disabled when empty. Works.
- **AI context:** deps `[input, hashes]` are correct.
- **Pinned pane:** same smart-input overwrite and AI-context override as Jwt.

**Bugs (functional):**
- **HASH-1 (low, confirmed-by-reading) L28-31, L71:** an empty input short-circuits, so the empty-string digests (MD5 `d41d8cd98f00b204e9800998ecf8427e`) can't be produced. Copy stays enabled on empty rows and overwrites the clipboard with "".
- **HASH-2 (low) L32-37:** crypto-js throws `URIError: URI malformed` on unpaired surrogates (confirmed-by-running), and the effect has no try/catch. That sends the page to its ErrorBoundary, or crashes the whole app if pinned. The trigger needs text cut mid-emoji (trigger path suspected).
- **HASH-3 (low, confirmed-by-running) L27-38:** four synchronous digests run per keystroke; a 5.4 MB input takes about 575 ms per keystroke.

**UX issues:** Copy (L40-42) gives no feedback and doesn't handle errors. The page works differently from /hmac.

**Theming issues:** none; it uses tokens only.

**Fix sketch:**
- HASH-1: hash the empty string too, and disable Copy when there's no digest.
- HASH-2 and HASH-3: `useMemo` plus try/catch; debounce large inputs; use `crypto.subtle.digest` for the SHA family.

### /hmac — src/pages/Hmac.jsx (148 lines)
**What it does:** live HMAC-MD5/SHA1/SHA256/SHA512 with crypto-js. Key and message are UTF-8 text; output is hex only. It matches Node `createHmac` (including keys longer than the block size) and RFC 4231 test case 2 (confirmed-by-running).

**Integrations:** none (no smart input, pipeline or AI context), unlike Hash.

**Bugs (functional):**
- **HMAC-1 (low, confirmed-by-reading) L14-17:** an empty message or key produces no output, although an HMAC of an empty message is valid (needed to check webhooks with an empty body).
- **HMAC-2 (low, confirmed-by-reading) L29-31:** on an exception (the same unpaired-surrogate case as HASH-2) the page writes "Error generating HMAC" into the output, styled and copyable like a real result.

**UX issues:**
- No base64 output (needed for, e.g., Shopify webhook signatures).
- The key can only be text, not hex or base64.
- The key is shown in clear (`type="text"`, L66).
- No SHA-384 or SHA-3, and no "compare with expected signature" field.
- Copy (L127-141) is an unlabeled icon with no feedback.

**Theming issues:** L120 puts an emerald `rgba(16,185,129,0.05)` tint behind `var(--primary)` text, ignoring the hue.

**Fix sketch:** compute whenever the key is present (allow an empty message), show errors separately from the output, add hex/base64 key and output options, and merge into Hash (see group patterns).

### /rsa — src/pages/Rsa.jsx (152 lines)
**What it does:**
- Generates 1024/2048/4096-bit keys with JSEncrypt (e=65537) and shows an SPKI `BEGIN PUBLIC KEY` and a PKCS#1 `BEGIN RSA PRIVATE KEY`, with Copy buttons.
- The PEMs are valid (confirmed-by-running): 64-character lines; Node parses both; the public key derived from the private key matches; sign/verify round-trips.
- There is no encrypt, decrypt, sign or verify. The Lock/Unlock icons are only labels.

**Integrations:** none. Its freeze blocks the whole app, pinned or not.

**Bugs (functional):**
- **RSA-1 (high, confirmed-by-running) L15-21:** generation runs synchronously on the main thread after a 100 ms timeout. 2048-bit takes 0.4–0.8 s and 4096-bit takes 11.7–14.3 s over three runs, during which the tab is frozen. The spinner can't spin (no `.spin` rule, and the thread is blocked). The L20 comment is wrong: JSEncrypt offers `getKey(callback)`, which generates asynchronously.
- **RSA-2 (medium, confirmed-by-running):** JSEncrypt's generator never checks the modulus bit length, so keys are often one bit short:
  - 73 of 200 "1024-bit" keys were 1023-bit;
  - 11 of 30 "2048-bit" keys were 2047-bit;
  - 1 of 3 "4096-bit" keys was 4095-bit.

  jose, and so this app's /jwt verifier, rejects the 2047-bit keys for RS256/PS256.
- **RSA-3 (low, confirmed-by-reading of `node_modules/jsencrypt/lib/lib/jsbn/rng.js` and `prng4.js`):** the random source is an RC4 stream seeded once from 256 bytes of `getRandomValues`, never reseeded, and it falls back to `Math.random` if crypto is missing. Not a standard CSPRNG.
- **RSA-4 (medium) L57:** 1024-bit is offered without any warning, although NIST has disallowed it since 2013 and jose rejects it.
- **RSA-5 (low) L31, L93, L124:** errors go through `alert()`; Copy has no feedback or error handling.

**UX issues:**
- The PKCS#1 private key can't be imported by WebCrypto (`importKey('pkcs8')`) or jose's `importPKCS8` (confirmed-by-running).
- No `.pem` download and no PKCS#8 or OpenSSH formats.
- "4096 bit (Secure)" implies 2048 is not.
- The global `select { width:100% }` stretches the select across the control row; probably overflows at 375px (suspected).

**Theming issues:** L71 `#fff` on primary; L108 and L139 `rgba(0,0,0,0.2)` textareas turn into grey blocks in light mode (use `var(--bg-app)`); L89/L120 hardcoded label colours.

**Fix sketch:** generate with WebCrypto `generateKey` (exact modulus, native random, async), export SPKI/PKCS#8 PEM, and drop or flag 1024-bit. At minimum, use `getKey(cb)`.

### /bcrypt — src/pages/Bcrypt.jsx (198 lines)
**What it does:**
- Hashes automatically 500 ms after typing stops, using `hashSync` with a cost slider from 4 to 16 (produces `$2b$`).
- The verify section re-runs `compareSync` on every change.
- The salt comes from a secure source, and `$2a`/`$2b`/`$2y` hashes all verify (confirmed-by-running).

**Integrations:** none.

**Bugs (functional):**
- **BCRYPT-1 (medium, confirmed-by-running) L28-36, L101:** `hashSync` runs on the main thread. Cost 10 takes 56 ms, 12 takes 203 ms and 13 takes 399 ms, so 16 is about 3.2 s per run. It re-runs after every typing pause and every slider move. The inner timeout (L28) is never cleared by the cleanup at L39, so outdated hashes still run.
- **BCRYPT-2 (medium, confirmed-by-reading) L43-56:** verify has no debounce and no cleanup. Every keystroke queues a full compare at the pasted hash's cost: about 200 ms each at cost 12, 0.8 s at cost 14. Typing a 12-character password against a cost-12 hash adds up to about 2.4 s of blocking.
- **BCRYPT-3 (medium, confirmed-by-running) L30, L49:** no warning about bcrypt's 72-byte limit. Two different passwords sharing the same first 72 bytes show "Match! Password is correct." Eighteen emoji (72 bytes) already hit the limit. bcryptjs v3 provides `truncates()` for this.
- **BCRYPT-4 (low, confirmed-by-running) L49-53:** a malformed hash shows "No match." instead of "Invalid hash" — a 59-character hash returns false, and garbage throws "Invalid salt version", which is caught as a non-match.

**UX issues:**
- "Salt Rounds" is really the cost factor.
- The hint says "Browser limit ~12-14" but the slider goes to 16.
- Passwords are plain text (`type="text"` at L85 and L152) while `Eye`/`EyeOff` are imported and unused (L3).
- The Copy button is positioned over the hash text at narrow widths (L127-128).
- No progress indicator, and no "cost detected from this hash" display (`getRounds`).

**Theming issues:**
- L89, L115, L156, L167: `rgba(0,0,0,0.2/0.3)` backgrounds.
- L130: `#fff` on primary/accent.
- L174-188: `#22c55e` text is 2.06:1 on light.
- L98-105: the slider is caught by the global input rule (padding, background, border and focus ring).

**Fix sketch:** use the async `bcrypt.hash`/`compare` with a progress callback, or a Web Worker; debounce and ignore outdated results; warn using `truncates()`; validate the hash against `^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$`.

### /aes — src/pages/Aes.jsx (183 lines)
**What it does:**
- `CryptoJS.AES.encrypt(text, passphrase)` produces OpenSSL's "Salted__" format: random 8-byte salt, OpenSSL's MD5-based key derivation run once, AES-256-CBC with PKCS7, base64 output. Decrypt reverses it; both run 300 ms after each change.
- Confirmed-by-running: Node decrypts the output with that derivation; `openssl enc -d -aes-256-cbc -md md5 -a -A` works; OpenSSL's default `-md sha256` fails with "bad decrypt".
- There's no way to supply a raw key and IV.

**Integrations:** none.

**Bugs (functional):**
- **AES-1 (medium, confirmed-by-running) L24, L54:** the subtitle "Secure symmetric encryption using AES-256" is misleading. The key derivation is a single MD5 pass, so passphrase guessing is cheap, and CBC has no MAC, so ciphertext can be tampered with undetected. It only interoperates with `openssl … -md md5`.
- **AES-2 (medium, confirmed-by-running) L27-29:** crypto-js doesn't validate padding, so wrong-key detection relies on the output happening to be invalid UTF-8. Over 20,000 wrong passphrases on a short message:
  - 0.47% "succeeded" and showed garbage such as "Ds<";
  - 12% showed crypto-js's internal "Malformed UTF-8 data";
  - the rest showed "Invalid key or corrupted data".
- **AES-3 (medium, confirmed-by-running) L27:** whitespace isn't stripped. With the correct passphrase, a leading space fails, and so does OpenSSL's default `-a` output (wrapped at 64 columns), both as "Invalid key or corrupted data". Removing the whitespace fixes it.
- **AES-4 (low, confirmed-by-reading) L61, L72:** switching mode keeps the text, so plaintext is immediately "decrypted" and shows a red "Decryption Failed". There's no swap button.

**UX issues:**
- The label says "Passphrase" but the placeholder says "secret key".
- The error box is always titled "Decryption Failed".
- The ciphertext changes on every keystroke because a new salt is drawn each time.
- The show/hide toggle has no aria-label.
- No feedback on passphrase strength.

**Theming issues:** L99 and L130 use `rgba(0,0,0,0.2)`; L170's `rgba(0,0,0,0.4)` output box becomes a mid-grey block in light mode; L65, L76 and L145 put `#fff` on primary; L157-158 hardcode the error colours.

**Fix sketch:** use AES-GCM with PBKDF2-SHA256 (at least 600k iterations) via WebCrypto in a versioned format, and keep a "legacy OpenSSL/CryptoJS" mode labelled as such. Strip whitespace before decrypting (`replace(/\s+/g,'')`). With GCM a wrong key fails authentication every time.

### /otp — src/pages/Otp.jsx (156 lines)
**What it does:**
- Starts with a random 160-bit secret (from crypto).
- Takes a base32 secret input: uppercased, with anything outside A-Z/2-7 stripped.
- Has Account Name and Issuer fields.
- Every second it rebuilds a TOTP (SHA1, 6 digits, 30 s) and updates the token, the countdown bar and a QR code of the `otpauth://` URI.

Confirmed-by-running:
- TOTP output: six RFC 6238 SHA1 test vectors (T=59 through T=20000000000, secret `GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`) match the last six digits.
- URI: well-formed, with `:` in label or issuer percent-encoded.
- Interval cleanup: correct.
- Rendered twice (main and pinned): no conflict, but each pane gets its own random secret.

**Integrations:** none.

**Bugs (functional):**
- **OTP-1 (low, confirmed-by-reading and running) L30, L42-44, L89:**
  - Clearing the secret leaves the old token, URI and QR on screen, because each tick skips when the secret is empty.
  - A 1–7 character secret silently produces codes from a 0–4 byte key ("A" → 0 bytes).
  - The "Invalid Secret" branch can never trigger, since invalid characters are stripped first; pasted hex digits 0/1/8/9 are silently dropped.
- **OTP-2 (low, confirmed-by-reading) L25-48:**
  - There's no immediate tick, so the first token and QR appear after 1 s (the QR encodes "" until then).
  - The interval is rebuilt on every keystroke, so the countdown freezes while you type.
  - Ticks aren't aligned to whole seconds, so the token can lag a period change by up to about 1 s.
- **OTP-3 (low) L139-141:** `transition: width 1s` makes the bar animate backwards at each period change.

**UX issues:**
- Algorithm, digits and period are fixed; no HOTP despite the "OTP / TOTP" name.
- No way to check a code, and no import of an `otpauth://` URI.
- The clickable token div isn't keyboard-accessible (the Copy button below is).
- Default issuer is "PrivateToolkit" (branding mismatch with "Vibe Toolbelt").
- On phones (suspected): the `minmax(350px,1fr)` grid (L70) overflows at 375px and below.

**Theming issues:** L91, L100 and L109 use `rgba(0,0,0,0.2)`; L137's progress track `rgba(255,255,255,0.1)` is invisible in light mode (use `var(--border)`); L140 hardcodes `#ef4444`. L146's white QR background is correct.

**Fix sketch:** tick immediately and align to the next second with `setTimeout`; read the fields from refs so the interval isn't rebuilt; clear the token and QR and show a validation message when the secret is empty or shorter than 16 characters.

### /password — src/pages/Password.jsx (121 lines)
**What it does:** loads zxcvbn on first input and runs it during render. Shows a 5-segment meter, a label, online and "offline" crack times, a warning and suggestions. It only audits; it doesn't generate passwords, although the README lists "Passwords" under Generators.

**Integrations:** none.

**Bugs (functional):**
- **PW-1 (medium, confirmed-by-running) L23:** no length cap and no memoization. 200 characters takes about 200 ms, 400 about 1.2 s and 1000 about 19 s, and it re-runs on every render, including keystrokes and the show/hide toggle. Pasting a key or token freezes the tab.
- **PW-2 (low, confirmed-by-reading) L16-19:** the dynamic `import()` has no `.catch`. If the chunk fails to load (offline, or an old tab after a redeploy), the page shows "Analyzing..." forever.

**UX issues:**
- "Crack Time (Offline)" uses the slow-hashing scenario without saying so; for `Tr0ub4dour&3` it shows "32 minutes" against "less than a second" for fast hashing.
- The empty state "Enter Password" is red.
- Three different names: "Password Strength" (tab title), "Password Auditor" (heading), "Password Audit" (sidebar).
- The show/hide button has no aria-label.
- `type="password"` without an `autocomplete` attribute may make the browser offer to save the audited password (suspected).

**Theming issues:** L28-30 `#eab308` (1.73:1) and `#84cc16` (1.79:1) labels are unreadable in light mode; L79's empty segments (`--bg-app`) are barely visible there.

**Fix sketch:** `useMemo(() => zxcvbn(pw.slice(0,100)), …)` with a debounce or a worker, plus an error state on import failure.

### /nanoid — src/pages/NanoId.jsx (253 lines)
**What it does:** four generators (Nano ID, ULID, "CUID2-like", custom-alphabet Nano ID), quantity 1–100, length 4–64, alphabet presets, regenerates on every change, Copy All and a timing readout.

**Integrations:** none.

**Bugs (functional):**
- **ID-1 (high, confirmed-by-running) L27-32:** the ULID's random part has 10 characters (one per byte), though the comment says 16. Every ULID is 20 characters (e.g. `01M52ZZJ6ZX8BAAXEK0R`) with 50 random bits instead of 26 characters and 80 bits, so it's invalid for any ULID parser. The timestamp part itself is correct.
- **ID-2 (low, confirmed-by-running) L18-34:** IDs generated in the same millisecond aren't increasing, so a sorted batch doesn't come out in generation order.
- **ID-3 (medium, confirmed-by-running) L11:** `byte % alphabet.length` is biased whenever the length doesn't divide 256. Measured max/min character frequency:

  | Alphabet | Ratio |
  |---|---|
  | Alphanumeric (62) | 1.28 |
  | No look-alikes (51) | 1.20 |
  | Lowercase (26) | 1.13 |
  | Numbers (10) | 1.04 |

  The default 64-character alphabet and Hex are unbiased. With an alphabet over 256 characters, only the first 256 ever appear.
- **ID-4 (low, confirmed-by-running) L11, L213:** an empty custom alphabet produces "undefinedundefined…"; an emoji alphabet produces broken half-characters; duplicate characters are accepted silently.
- **ID-5 (medium, misleading; confirmed-by-running) L36-47, L71:** "CUID2-like" is not CUID2:
  - it exposes the creation timestamp to the millisecond (base36 right after the "c");
  - its "fingerprint" comes from `Math.random`;
  - its random tail is biased (`% 36`).

  Real CUID2 hashes its inputs precisely to avoid exposing the time, so the "collision-resistant" description is unfounded.

**UX issues:** the heading "ID Generator" doesn't match the sidebar's "Nano ID / ULID"; there's no UUID option (overlaps /uuid); no per-ID copy; no validation of the custom alphabet; quantity max is 100 here but 50 on /uuid.

**Theming issues:**
- L57, L66, L75, L84: per-type colours ignore the hue.
- L144, L204: `rgba(255,255,255,0.03)` is invisible in light mode.
- L160, L246: dark-only backgrounds.
- L233: `#fff` on the type colour (2.15–2.28:1 on green/amber).
- L167-170, L179-182: sliders are caught by the global input rule.

**Fix sketch:**
- ULID: 16 random bytes each `& 31`, plus a "same millisecond → increment" rule.
- Nano ID: rejection sampling, or import `nanoid`'s `customAlphabet`.
- Validate the alphabet (2–256 unique characters).
- Replace the CUID-like generator with `@paralleldrive/cuid2` or remove it.

### /uuid — src/pages/Uuid.jsx (117 lines)
**What it does:** bulk UUID v4 only (uuid@13, which uses `crypto.randomUUID` or `getRandomValues`, so it's secure), quantity 1–50, regenerate and Copy All.
- There's no validation or parsing, and no v1/v5/v7/nil, although uuid@13 ships them all and the README claims v1 and v4.

**Integrations:** none.

**Bugs (functional):** none beyond the missing features (confirmed-by-reading).

**UX issues:** the Copy All button sits over the first UUID line at narrow widths (L91-98); no formatting options (uppercase, no hyphens, braces); overlaps /nanoid.

**Theming issues:** L43 and L76 use `rgba(0,0,0,0.2/0.3)` (L76 overrides the glass background); L99 puts `#fff` on primary; L51-58's slider sets only `accentColor`, so the global input rule boxes it in.

**Fix sketch:** add v7 (time-ordered), a validator and format options, or merge into /nanoid.

### /username — src/pages/Username.jsx (149 lines)
**What it does:** generates 5 names per click. "Readable" mode is Adjective+Noun+0–998 (about 400k combinations); "Random" mode is alphanumeric, 4–24 characters. Both use `Math.random`.

**Integrations:** none.

**Bugs (functional):**
- **USER-1 (low, confirmed-by-reading) L13, L19:** the `count` state is never used; there are always 5 names.
- **USER-2 (low) L21-29:** `Math.random` is fine for usernames, but "Random" mode looks like a password generator.

Also, `setLength` stores a string (L91), which works only because of type coercion.

**UX issues:** numbers go up to 998, not 999; duplicates are possible within a batch; there are no options; it belongs under Generators, not Security.

**Theming issues:** L53 dark-only background; L67, L78 and L112 put `#fff` on primary or the gradient; L128's `rgba(255,255,255,0.03)` overrides the glass background, so cards look bare in light mode; L89-93's slider is caught by the global input rule.

**Fix sketch:** use or remove `count`; use `crypto.getRandomValues`; generate unique names per batch.

### /chmod — src/pages/Chmod.jsx (239 lines)
**What it does:** an octal input (3–4 digits, non-octal characters stripped), a 3×3 permission toggle grid, setuid/setgid/sticky toggles, octal and symbolic (s/S/t/T) output, the command line, and presets.
- Conversion is correct: for all 4096 modes, octal → grid → symbolic matches `ls`-style output and converts back to the same octal (confirmed-by-running).

**Integrations:** none.

**Bugs (functional):**
- **CHMOD-1 (low-medium, confirmed-by-reading) L55-76:** the special bits get out of sync:
  - Toggling setuid/setgid/sticky doesn't update the input box (it shows 755 while the results show 4755).
  - Toggling any rwx cell rewrites the box with 3 digits, dropping the special digit while the special state is kept.
  - Then any edit to that 3-digit box silently resets the special bits to 0.
- **CHMOD-2 (low, confirmed-by-reading) L68-75:** invalid or partial input is ignored silently: "789" does nothing with no error, and "7" leaves the grid on the previous mode, so the box and the grid disagree.

**UX issues:**
- No symbolic → octal parsing ("rwxr-x---", "u+x"), despite the "numeric ↔ symbolic" subtitle (L106).
- The preset highlight ignores special bits (L227).
- The toggles have no `aria-pressed` or labels, so screen readers announce "-".
- On phones (suspected): the grid needs about 345px but has about 295px at 375px width.

**Theming issues:** L99's group colours are hardcoded (`#f59e0b` text is 1.94:1 and `#22c55e` is 2.06:1 on light); L124 dark-only background; L163, L185 and L227 use `rgba(255,255,255,0.03)`.

**Fix sketch:** keep a single numeric mode as the source of truth and derive the input box from it; add a symbolic parser.

### /privacy-scanner — src/pages/PrivacyScanner.jsx (162 lines)
**What it actually does:** a file picker that shows name, size, type and modified date.
- For images, ExifReader checks for GPS, Model, Software, Lens, Artist, Copyright, owner and serial-number tags.
- For PDFs, it attempts to read the document info.
- It then shows either red warnings or a green "No obvious privacy risks found."

There is **no text/PII scanning at all**: no email, phone, credit card (Luhn), IBAN, API key or IP detection, and no redaction output. The README says "Scan text for PII" and the subtitle says "…and PII".

**Integrations:** none.

**Bugs (functional):**
- **SCAN-1 (high, confirmed-by-running) L64-69:** `pdfDoc.TITLE`, `.AUTHOR`, `.SUBJECT`, `.KEYWORDS`, `.CREATOR` and `.PRODUCER` don't exist in pdf-lib (it uses `getTitle()`, `getAuthor()` and so on). A PDF whose Author is "Jane Doe" gets the green all-clear.
- **SCAN-2 (medium, confirmed-by-running) L63:** `PDFDocument.load` defaults to `updateMetadata: true`, which overwrites Producer with "pdf-lib (https://github.com/Hopding/pdf-lib)" and resets ModDate. Even after fixing SCAN-1, the page would report pdf-lib's values, not the file's.
- **SCAN-3 (medium, confirmed-by-reading) L55-57, L80-82, L87-88:** every failure (encrypted PDF, corrupt or unsupported image, read error) is only logged to the console, and the user sees the green all-clear. Any file that isn't an image or PDF (txt, csv, docx) also gets the all-clear.
- **SCAN-4 (high, misleading claim) L99, L117, README L63:** PII scanning is advertised but missing, and "and more" isn't true.
- **SCAN-5 (low, confirmed-by-reading) L47-54:** substring tag matching reports the same finding twice (e.g. BodySerialNumber as both "Serial Number" and "BodySerialNumber").
- **SCAN-6 (low) L105-110:** the input is never reset, so re-selecting the same file does nothing. Overlapping scans could finish out of order and show the wrong file's results (suspected).
- **SCAN-7 (medium, accessibility, confirmed-by-reading) L105-111:** the input is `display:none` and its label isn't focusable, so keyboard users can't open the picker. There's no drag-and-drop either.

**UX issues:**
- GPS coordinates aren't shown.
- Capture date, Make, XMP/IPTC data and thumbnails aren't checked; the PDF dates, subject and keywords are read but never used (L66-71).
- Files with an empty MIME type are skipped.
- There's no "strip metadata" action and no scanning indicator.
- It overlaps /exif.

**Theming issues:** L135's warning text `#fca5a5` is 1.72:1 on light, effectively unreadable; L140-142's `#22c55e` is 2.06:1.

**Fix sketch:** use the getters with `{updateMetadata:false, ignoreEncryption:true}`; show an explicit "could not analyze (reason)" state instead of the green all-clear; either build the text-PII scanner (regexes with Luhn, IBAN mod-97, entropy checks for keys, plus redaction) or change the README and subtitle.

---

### Group-level patterns
- **Copy buttons:** each page writes its own.
  - Hash, Hmac and Rsa give no feedback.
  - The `copied` + `setTimeout` pattern is copied into 7 pages: Bcrypt, Aes, Otp, NanoId, Uuid, Username, Chmod.
  - None handle `navigator.clipboard` being undefined on plain-http origins (e.g. the dev server over a LAN IP), where they throw. None await `writeText`, so they show "Copied" even when it fails. None use `useToast`.

  A shared `<CopyButton>` / `useCopy()` that reports through toasts would cover all of them.
- **Slider rows:** five copies (Bcrypt, NanoId ×2, Uuid, Username) of a label + value + range input with different styles. All are caught by the global `input` rule. Fix with a `<RangeField>` component and exempt range, checkbox, radio, color and file inputs in global.css. The Rsa select is also stretched by the global `width:100%`.
- **Other components to share:**
  - `<StatusBanner tone>` with `--success`/`--danger`/`--warning` tokens (Jwt, Bcrypt, Aes, PrivacyScanner and Password all hardcode `#22c55e`/`#ef4444`).
  - `<SecretInput>` with an aria-labelled show/hide toggle and autocomplete off (Aes and Password have one; Bcrypt imports the icons but never uses them).
  - `<SegmentedControl>` (Aes mode, Username style, NanoId types).
  - `<StrengthMeter>` (Password's zxcvbn, which could also warn about weak AES passphrases, HMAC keys and Bcrypt inputs).
  - `<BulkOutput>` for quantity + regenerate + Copy All (Uuid, NanoId, Username).
- **Heavy work on the main thread:** RSA keygen (about 14 s), zxcvbn (about 19 s at 1000 chars), bcrypt (about 3.2 s at cost 16) and Hash on large input (575 ms at 5.4 MB). A shared Web Worker plus a common "busy" UI would fix these. `.spin` should live in global.css.
- **Theme tokens:**
  - `#fff` on `var(--primary)` (Jwt, Rsa, Aes, Bcrypt, Uuid, Username) fails with non-default accent presets: 1.40:1 Emerald, 1.83:1 Amber, 2.03:1 Cyber Blue in dark mode. Add an `--on-primary` token.
  - Dark-only `rgba(0,0,0,.2–.4)` and `rgba(255,255,255,.03)` backgrounds appear on nine pages. Define the missing `--bg-input` token and use it.
  - None of these 13 pages use the undefined CSS variables.
- **Cross-page inconsistencies:**
  - Hash and Hmac are separate pages with different layouts. Only Hash uses smart input, the pipeline and the AI context, and neither offers SHA-384/SHA-3, empty input or base64 output. Merge them into one "Hash / HMAC" page with an optional key.
  - Uuid and NanoId overlap. Merge into one ID generator: UUID v4/v7, a fixed ULID and NanoID.
  - /rsa produces keys that /jwt rejects (all 1024-bit keys and about 37% of "2048-bit" ones).
  - Page tab titles, headings and sidebar labels disagree (Password, NanoId, Uuid, Otp, Bcrypt, Jwt).
  - Only Jwt and Hash use the pipeline and AI context, though Hmac, Aes and Bcrypt are natural fits.
- **Sidebar "Security" category:**
  - Username, UUID Gen and Nano ID / ULID are generators (the README lists them under Generators).
  - Chmod Calc is a system utility (the README lists it under System).
  - Secure Diff is a text tool.
  - Meanwhile Privacy Scanner sits in a separate two-item "Privacy" group alongside EXIF Viewer, which overlaps it.
  - Icons repeat: Shield ×3, Lock ×2, Fingerprint ×2.
- **Security wording:** several claims are inaccurate:
  - AES "Secure… AES-256" (see AES-1);
  - RSA "4096 (Secure)" alongside an unflagged 1024-bit option;
  - "CUID2-like… collision-resistant";
  - Privacy Scanner "…and PII".
- **Pinned split-pane, for this group:**
  - A pinned Jwt or Hash also consumes every smart-input navigation meant for the main pane.
  - Its AI context overrides the main page's, and unpinning wipes it.
  - JWT-4 and HASH-2 crash the whole app there because the pinned pane has no ErrorBoundary.
  - `useDocumentTitle` restores the title captured when the pinned page mounted, so unpinning can show the wrong page title.
  - The freezes above lock both panes.
  - Otp runs fine rendered twice.
