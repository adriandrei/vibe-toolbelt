import { useId, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, BookOpen, ChevronDown, Trash2 } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import SegmentedControl from '../components/ui/SegmentedControl'
import CopyButton from '../components/ui/CopyButton'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useSmartInput } from '../hooks/useSmartInput'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'

// HTML 4 named entities (all valid in HTML5), plus a few common HTML5 ones.
// &lang;/&rang; are left out: HTML5 maps them to different characters.
const LATIN1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'
const GREEK_UPPER = 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - Sigma Tau Upsilon Phi Chi Psi Omega'
const GREEK_LOWER = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega'
const OTHERS = 'quot:34 amp:38 lt:60 gt:62 OElig:338 oelig:339 Scaron:352 scaron:353 Yuml:376 fnof:402 circ:710 tilde:732 thetasym:977 upsih:978 piv:982 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 ndash:8211 mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 alefsym:8501 larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660 forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 infin:8734 ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901 lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830 starf:9733 star:9734 check:10003 cross:10007'

const NAMED = new Map()
LATIN1.split(' ').forEach((name, i) => NAMED.set(160 + i, name))
GREEK_UPPER.split(' ').forEach((name, i) => name !== '-' && NAMED.set(913 + i, name))
GREEK_LOWER.split(' ').forEach((name, i) => NAMED.set(945 + i, name))
OTHERS.split(' ').forEach((pair) => {
    const [name, cp] = pair.split(':')
    NAMED.set(Number(cp), name)
})

const SPECIALS = { 38: '&amp;', 60: '&lt;', 62: '&gt;', 34: '&quot;', 39: '&#39;' }

/**
 * scope: 'special' escapes only & < > " ', 'all' also every non-ASCII and
 * control character (by code point, so emoji become one entity).
 */
function htmlEncode(text, { scope, named, numeric }) {
    let out = ''
    for (const ch of text) {
        const cp = ch.codePointAt(0)
        if (SPECIALS[cp]) {
            out += SPECIALS[cp]
            continue
        }
        const control = cp < 32 && cp !== 9 && cp !== 10 && cp !== 13
        if (scope === 'all' && (cp > 126 || control)) {
            const name = named ? NAMED.get(cp) : null
            out += name ? `&${name};` : numeric === 'hex' ? `&#x${cp.toString(16).toUpperCase()};` : `&#${cp};`
        } else {
            out += ch
        }
    }
    return out
}

// A detached <textarea> decodes every HTML5 entity without running any markup
function htmlDecode(text) {
    const el = document.createElement('textarea')
    el.innerHTML = text
    return el.value
}

const REFERENCE = [
    { char: '&', name: 'Ampersand' },
    { char: '<', name: 'Less than' },
    { char: '>', name: 'Greater than' },
    { char: '"', name: 'Double quote' },
    { char: "'", name: 'Apostrophe' },
    { char: '\u00A0', name: 'Non-breaking space', show: '␣' },
    { char: '©', name: 'Copyright' },
    { char: '®', name: 'Registered' },
    { char: '™', name: 'Trademark' },
    { char: '€', name: 'Euro' },
    { char: '£', name: 'Pound' },
    { char: '¥', name: 'Yen' },
    { char: '…', name: 'Ellipsis' },
    { char: '—', name: 'Em dash' },
    { char: '–', name: 'En dash' },
    { char: '←', name: 'Left arrow' },
    { char: '→', name: 'Right arrow' },
    { char: '↑', name: 'Up arrow' },
    { char: '↓', name: 'Down arrow' },
    { char: '♥', name: 'Heart' },
    { char: '★', name: 'Star' },
    { char: '✓', name: 'Check mark' },
    { char: '✗', name: 'Cross mark' },
    { char: '°', name: 'Degree' },
    { char: '±', name: 'Plus-minus' },
].map((e) => {
    const cp = e.char.codePointAt(0)
    return { ...e, entity: SPECIALS[cp] ?? (NAMED.has(cp) ? `&${NAMED.get(cp)};` : `&#${cp};`), numeric: `&#${cp};` }
})

const MODES = [
    { value: 'encode', label: 'Encode' },
    { value: 'decode', label: 'Decode' },
]

const SCOPES = [
    { value: 'special', label: 'HTML characters only', title: 'Escape & < > " \' and leave everything else as is' },
    { value: 'all', label: 'Also non-ASCII', title: 'Also turn accented letters, symbols and emoji into entities' },
]

export default function HtmlEntity() {
    const inputId = useId()
    const outputId = useId()
    const refId = useId()
    const inputRef = useRef(null)
    const [input, setInput] = useState('')
    const [mode, setMode] = useState('encode')
    const [scope, setScope] = useState('all')
    const [named, setNamed] = useState(true)
    const [numeric, setNumeric] = useState('dec')
    const [showRef, setShowRef] = useState(false)

    const output = useMemo(() => {
        if (!input) return ''
        return mode === 'encode' ? htmlEncode(input, { scope, named, numeric }) : htmlDecode(input)
    }, [input, mode, scope, named, numeric])

    useSmartInput({ input: (value) => typeof value === 'string' && setInput(value) })

    useRegisterAIContext({
        tool: 'HTML Entity Encoder',
        getContext: () => ({ input, output }),
        suggestedPrompts: ['Is this safe to put inside an HTML attribute?', 'Which characters here must be escaped?', 'Explain these entities'],
    })

    const swap = () => {
        if (!output) return
        setInput(output)
        setMode(mode === 'encode' ? 'decode' : 'encode')
    }

    // Inserts at the caret: the character when encoding, the entity when decoding
    const insert = (entry) => {
        const text = mode === 'decode' ? entry.entity : entry.char
        const el = inputRef.current
        const start = el?.selectionStart ?? input.length
        const end = el?.selectionEnd ?? input.length
        const next = input.slice(0, start) + text + input.slice(end)
        setInput(next)
        requestAnimationFrame(() => {
            if (!el) return
            el.focus()
            el.setSelectionRange(start + text.length, start + text.length)
        })
    }

    const optionLabel = { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', color: 'var(--text-muted)' }

    return (
        <div className="page page-medium page-html-entity">
            <ToolHeader />

            <section className="card card-compact" aria-label="Options" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-sm) var(--space-lg)' }}>
                <SegmentedControl ariaLabel="Mode" options={MODES} value={mode} onChange={setMode} />
                {mode === 'encode' && (
                    <>
                        <SegmentedControl ariaLabel="Characters to encode" size="sm" options={SCOPES} value={scope} onChange={setScope} />
                        {scope === 'all' && (
                            <>
                                <label style={optionLabel}>
                                    <input type="checkbox" checked={named} onChange={e => setNamed(e.target.checked)} />
                                    Named entities (&amp;copy;)
                                </label>
                                <label style={optionLabel}>
                                    Numbers
                                    <select value={numeric} onChange={e => setNumeric(e.target.value)} style={{ width: 'auto', padding: '0.35rem 0.55rem', fontSize: '0.85rem' }}>
                                        <option value="dec">Decimal (&amp;#169;)</option>
                                        <option value="hex">Hex (&amp;#xA9;)</option>
                                    </select>
                                </label>
                            </>
                        )}
                    </>
                )}
            </section>

            <div className="split-pane">
                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={inputId} className="section-title">{mode === 'encode' ? 'Text' : 'HTML with entities'}</label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineRead onRead={setInput} />
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setInput('')} disabled={!input}>
                                <Trash2 size={14} aria-hidden="true" /> Clear
                            </button>
                        </div>
                    </div>
                    <textarea
                        ref={inputRef}
                        id={inputId}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder={mode === 'encode' ? 'Text with special characters, e.g. café <b>€100</b> 😀' : 'Entities to decode, e.g. &lt;p&gt; &copy; &#128512;'}
                        spellCheck={false}
                        style={{ minHeight: 180, fontSize: '0.9rem', lineHeight: 1.5, padding: '0.75rem' }}
                    />
                </div>

                <div className="card card-compact" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', minHeight: 34 }}>
                        <label htmlFor={outputId} className="section-title">{mode === 'encode' ? 'Encoded HTML' : 'Decoded text'}</label>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={swap} disabled={!output} title="Use the result as the new input and switch mode">
                                <ArrowDownUp size={14} aria-hidden="true" /> Swap
                            </button>
                            <CopyButton text={output} />
                        </div>
                    </div>
                    <textarea
                        id={outputId}
                        readOnly
                        value={output}
                        placeholder="The result appears here"
                        spellCheck={false}
                        style={{ minHeight: 180, fontSize: '0.9rem', lineHeight: 1.5, padding: '0.75rem', background: 'var(--bg-inset)', wordBreak: 'break-all' }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <PipelineSend dataToSend={output} />
                    </div>
                </div>
            </div>

            <section className="card card-compact">
                <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    aria-expanded={showRef}
                    aria-controls={refId}
                    onClick={() => setShowRef(v => !v)}
                    style={{ paddingLeft: 4 }}
                >
                    <BookOpen size={14} aria-hidden="true" /> Common entities
                    <ChevronDown size={14} aria-hidden="true" style={{ transform: showRef ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
                </button>
                {showRef && (
                    <div id={refId} style={{ marginTop: 'var(--space-sm)' }}>
                        <p className="field-hint" style={{ marginTop: 0, marginBottom: 'var(--space-sm)' }}>
                            Click to insert at the cursor: the character when encoding, the entity when decoding.
                        </p>
                        <div className="auto-grid" style={{ '--auto-grid-min': '150px', gap: 'var(--space-xs)' }}>
                            {REFERENCE.map(ent => (
                                <button
                                    key={ent.entity}
                                    type="button"
                                    className="chip"
                                    onClick={() => insert(ent)}
                                    title={`Insert ${mode === 'decode' ? ent.entity : ent.name}`}
                                    style={{ borderRadius: 'var(--radius-sm)', justifyContent: 'flex-start', padding: '0.4rem 0.6rem', gap: 10 }}
                                >
                                    <span aria-hidden="true" style={{ fontSize: '1.2rem', width: 24, textAlign: 'center', color: 'var(--text-main)' }}>{ent.show ?? ent.char}</span>
                                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                                        <span className="mono" style={{ fontSize: '0.8rem', color: 'var(--primary-text)' }}>{ent.entity}</span>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{ent.name} · {ent.numeric}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </section>
        </div>
    )
}
