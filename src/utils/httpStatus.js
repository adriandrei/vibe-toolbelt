// HTTP status codes: the IANA registry with RFC 9110 names, plus 418.
// Used by the HTTP Status reference and the API Tester (HTTP/2 responses
// have no reason phrase, so the tester looks the text up here).

export const STATUS_CATEGORIES = [
    { id: '1xx', label: 'Informational', color: 'var(--primary-text)', bg: 'var(--primary-glow)', border: 'var(--primary-border)' },
    { id: '2xx', label: 'Success', color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
    { id: '3xx', label: 'Redirection', color: 'var(--info)', bg: 'var(--info-bg)', border: 'var(--info-border)' },
    { id: '4xx', label: 'Client error', color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
    { id: '5xx', label: 'Server error', color: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
]

// [code, reason phrase, description, specification]
const TABLE = [
    [100, 'Continue', 'The server got the request headers and the client should go ahead and send the body (used with Expect: 100-continue).', 'RFC 9110'],
    [101, 'Switching Protocols', 'The server is switching to the protocol the client asked for in the Upgrade header, for example WebSocket.', 'RFC 9110'],
    [102, 'Processing', 'WebDAV: the server is still working on a long request and no response is ready yet. Deprecated.', 'RFC 2518'],
    [103, 'Early Hints', 'Sent before the final response so the browser can start preloading resources listed in Link headers.', 'RFC 8297'],

    [200, 'OK', 'The request succeeded. The body depends on the method: the resource for GET, the result of the action for POST.', 'RFC 9110'],
    [201, 'Created', 'The request succeeded and created a new resource, usually identified by the Location header.', 'RFC 9110'],
    [202, 'Accepted', 'The request was accepted for processing, but processing has not finished (or may not happen at all).', 'RFC 9110'],
    [203, 'Non-Authoritative Information', 'The request succeeded, but a transforming proxy modified the response from the origin server.', 'RFC 9110'],
    [204, 'No Content', 'The request succeeded and there is no body to send. Common for DELETE and PUT.', 'RFC 9110'],
    [205, 'Reset Content', 'The request succeeded and the client should reset the document view, for example clear a form.', 'RFC 9110'],
    [206, 'Partial Content', 'The server is sending only the byte ranges requested with a Range header.', 'RFC 9110'],
    [207, 'Multi-Status', 'WebDAV: the body holds separate status codes for several resources or operations.', 'RFC 4918'],
    [208, 'Already Reported', 'WebDAV: members of a binding were already listed earlier in this response and aren\'t repeated.', 'RFC 5842'],
    [226, 'IM Used', 'The server applied instance manipulations (delta encoding) to the current instance of the resource.', 'RFC 3229'],

    [300, 'Multiple Choices', 'The resource has several representations and the client (or user) should pick one.', 'RFC 9110'],
    [301, 'Moved Permanently', 'The resource has a new permanent URL, given in Location. Clients may change POST to GET when following it.', 'RFC 9110'],
    [302, 'Found', 'The resource is temporarily at another URL, given in Location. Clients may change POST to GET when following it.', 'RFC 9110'],
    [303, 'See Other', 'The result is at another URL, which the client should fetch with GET. Common after a form POST.', 'RFC 9110'],
    [304, 'Not Modified', 'The cached copy is still valid (the conditional request matched), so no body is sent.', 'RFC 9110'],
    [305, 'Use Proxy', 'Deprecated: asked the client to repeat the request through a proxy. Not used for security reasons.', 'RFC 9110'],
    [306, '(Unused)', 'Reserved. It was used in an earlier draft of HTTP and is no longer used.', 'RFC 9110'],
    [307, 'Temporary Redirect', 'The resource is temporarily at another URL. Unlike 302, the client must keep the same method and body.', 'RFC 9110'],
    [308, 'Permanent Redirect', 'The resource has a new permanent URL. Unlike 301, the client must keep the same method and body.', 'RFC 9110'],

    [400, 'Bad Request', 'The server can\'t process the request because of a client error, such as malformed syntax or invalid framing.', 'RFC 9110'],
    [401, 'Unauthorized', 'Authentication is required or failed. The response includes a WWW-Authenticate header with the scheme to use.', 'RFC 9110'],
    [402, 'Payment Required', 'Reserved for future use. Some APIs use it for billing or quota problems.', 'RFC 9110'],
    [403, 'Forbidden', 'The server understood the request but refuses it. Unlike 401, authenticating again won\'t help.', 'RFC 9110'],
    [404, 'Not Found', 'The server has no resource at this URL, or won\'t say whether one exists.', 'RFC 9110'],
    [405, 'Method Not Allowed', 'The resource exists but doesn\'t support this method. The Allow header lists the methods it does support.', 'RFC 9110'],
    [406, 'Not Acceptable', 'The server can\'t produce a representation that matches the request\'s Accept headers.', 'RFC 9110'],
    [407, 'Proxy Authentication Required', 'Like 401, but the client must first authenticate with a proxy (Proxy-Authenticate header).', 'RFC 9110'],
    [408, 'Request Timeout', 'The server gave up waiting for the client to finish sending the request.', 'RFC 9110'],
    [409, 'Conflict', 'The request conflicts with the current state of the resource, for example an edit conflict.', 'RFC 9110'],
    [410, 'Gone', 'The resource used to exist and has been removed permanently, with no forwarding address.', 'RFC 9110'],
    [411, 'Length Required', 'The server requires a Content-Length header.', 'RFC 9110'],
    [412, 'Precondition Failed', 'A condition in the request headers (such as If-Match or If-Unmodified-Since) was false.', 'RFC 9110'],
    [413, 'Content Too Large', 'The request body is larger than the server is willing to process. Formerly "Payload Too Large".', 'RFC 9110'],
    [414, 'URI Too Long', 'The URL is longer than the server is willing to interpret, often because of a huge query string.', 'RFC 9110'],
    [415, 'Unsupported Media Type', 'The server doesn\'t support the body\'s format (Content-Type or Content-Encoding).', 'RFC 9110'],
    [416, 'Range Not Satisfiable', 'None of the byte ranges in the Range header overlap the resource.', 'RFC 9110'],
    [417, 'Expectation Failed', 'The server can\'t meet the requirement in the Expect header.', 'RFC 9110'],
    [418, "I'm a teapot", 'An April Fools\' joke from RFC 2324: the teapot refuses to brew coffee. RFC 9110 reserves 418 as "(Unused)".', 'RFC 2324'],
    [421, 'Misdirected Request', 'The request went to a server that can\'t produce a response for this URL, for example over a reused connection.', 'RFC 9110'],
    [422, 'Unprocessable Content', 'The body is well-formed but semantically invalid, such as failed validation. Formerly "Unprocessable Entity".', 'RFC 9110'],
    [423, 'Locked', 'WebDAV: the resource is locked.', 'RFC 4918'],
    [424, 'Failed Dependency', 'WebDAV: the action failed because another action it depended on failed.', 'RFC 4918'],
    [425, 'Too Early', 'The server won\'t process a request sent in TLS early data, because it might be replayed.', 'RFC 8470'],
    [426, 'Upgrade Required', 'The server refuses the request over the current protocol; the Upgrade header says which one to switch to.', 'RFC 9110'],
    [428, 'Precondition Required', 'The server requires a conditional request (for example with If-Match) to prevent lost updates.', 'RFC 6585'],
    [429, 'Too Many Requests', 'The client sent too many requests in a given time (rate limiting). Retry-After may say when to try again.', 'RFC 6585'],
    [431, 'Request Header Fields Too Large', 'One header, or all headers together, are too large. Often caused by large cookies.', 'RFC 6585'],
    [451, 'Unavailable For Legal Reasons', 'The resource can\'t be provided for legal reasons, such as a court order or government censorship.', 'RFC 7725'],

    [500, 'Internal Server Error', 'The server hit an unexpected condition. A generic error when nothing more specific fits.', 'RFC 9110'],
    [501, 'Not Implemented', 'The server doesn\'t support the functionality needed, such as an unknown method.', 'RFC 9110'],
    [502, 'Bad Gateway', 'A gateway or proxy got an invalid response from the upstream server.', 'RFC 9110'],
    [503, 'Service Unavailable', 'The server is temporarily unable to handle requests, for example overloaded or down for maintenance. See Retry-After.', 'RFC 9110'],
    [504, 'Gateway Timeout', 'A gateway or proxy didn\'t get a response from the upstream server in time.', 'RFC 9110'],
    [505, 'HTTP Version Not Supported', 'The server doesn\'t support the HTTP version used in the request.', 'RFC 9110'],
    [506, 'Variant Also Negotiates', 'Content negotiation is misconfigured: the chosen variant is itself set up to negotiate.', 'RFC 2295'],
    [507, 'Insufficient Storage', 'WebDAV: the server can\'t store what is needed to complete the request.', 'RFC 4918'],
    [508, 'Loop Detected', 'WebDAV: the server found an infinite loop while processing the request.', 'RFC 5842'],
    [510, 'Not Extended', 'The request doesn\'t meet the server\'s policy for accessing the resource. Historic (RFC 2774 is obsolete).', 'RFC 2774'],
    [511, 'Network Authentication Required', 'The client must authenticate to get network access, typically on a captive portal (hotel or airport Wi-Fi).', 'RFC 6585'],
]

export const STATUS_CODES = TABLE.map(([code, text, desc, spec]) => ({
    code,
    text,
    desc,
    spec,
    cat: `${String(code)[0]}xx`,
}))

const BY_CODE = new Map(STATUS_CODES.map(s => [s.code, s]))

export function getStatusInfo(code) {
    return BY_CODE.get(Number(code)) ?? null
}

/** Reason phrase for a status code ('' when unknown). */
export function getStatusText(code) {
    return BY_CODE.get(Number(code))?.text ?? ''
}

export function getStatusCategory(code) {
    const n = Number(code)
    if (!(n >= 100 && n < 600)) return null
    return STATUS_CATEGORIES.find(c => c.id === `${Math.floor(n / 100)}xx`) ?? null
}

export function specUrl(spec) {
    const m = /^RFC (\d+)$/.exec(spec || '')
    return m ? `https://www.rfc-editor.org/rfc/rfc${m[1]}.html` : null
}
