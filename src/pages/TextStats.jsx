import { useId, useMemo, useState } from 'react'
import { AlignLeft, BookOpen, HardDrive, Hash, Mic, Pilcrow, Quote, Trash2, Type } from 'lucide-react'
import ToolHeader from '../components/ui/ToolHeader'
import Field from '../components/ui/Field'
import CopyButton from '../components/ui/CopyButton'
import { PipelineRead, PipelineSend } from '../components/PipelineFeature'
import { useRegisterAIContext } from '../hooks/useRegisterAIContext'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { analyzeText, formatDuration, READING_WPM, SPEAKING_WPM } from '../utils/textMetrics'
import { formatBytes } from '../utils/download'
import { getTool } from '../config/tools'

const TOOL_NAME = getTool('/text-stats')?.title ?? 'Text Statistics'
const fmt = (n, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })

function StatTile({ icon: Icon, label, value, hint }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--bg-subtle)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', minWidth: 0 }}>
            <span style={{ display: 'inline-flex', padding: 8, borderRadius: '50%', background: 'var(--primary-glow)', color: 'var(--primary-text)', flexShrink: 0 }}>
                <Icon size={18} aria-hidden="true" />
            </span>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.15, color: 'var(--text-main)', overflowWrap: 'anywhere' }}>{value}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{label}</div>
                {hint && <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{hint}</div>}
            </div>
        </div>
    )
}

function SectionHeading({ id, children, style }) {
    return <h2 id={id} className="section-title" style={style}>{children}</h2>
}

function DetailRow({ label, value, title }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.9rem' }}>
            <dt style={{ color: 'var(--text-muted)' }} title={title}>{label}</dt>
            <dd style={{ color: 'var(--text-main)', fontWeight: 600, textAlign: 'right', overflowWrap: 'anywhere', minWidth: 0 }}>{value}</dd>
        </div>
    )
}

function summarize(stats) {
    return [
        `Words: ${fmt(stats.words)} (${fmt(stats.uniqueWords)} unique)`,
        `Characters: ${fmt(stats.characters)} (${fmt(stats.charactersNoSpaces)} without whitespace)`,
        `Sentences: ${fmt(stats.sentences)}`,
        `Paragraphs: ${fmt(stats.paragraphs)}`,
        `Lines: ${fmt(stats.lines)}`,
        `Reading time: ${formatDuration(stats.readingSeconds)}`,
        `Speaking time: ${formatDuration(stats.speakingSeconds)}`,
        `Size: ${fmt(stats.bytes)} bytes UTF-8, ${fmt(stats.codePoints)} code points, ${fmt(stats.utf16Units)} UTF-16 units`,
        stats.topWords.length ? `Top words: ${stats.topWords.map(w => `${w.word} (${w.count})`).join(', ')}` : null,
    ].filter(Boolean).join('\n')
}

export default function TextStats() {
    const hideCommonId = useId()
    const [text, setText] = useState('')
    const [hideCommon, setHideCommon] = useState(true)

    // Segmenting megabytes of text takes a moment: wait for typing to pause
    const analyzed = useDebouncedValue(text, text.length > 20000 ? 250 : 0)
    const stats = useMemo(() => analyzeText(analyzed, { hideCommonWords: hideCommon }), [analyzed, hideCommon])
    const summary = useMemo(() => summarize(stats), [stats])
    const hasText = analyzed.length > 0

    useRegisterAIContext({
        tool: TOOL_NAME,
        getContext: () => ({
            input: text.length > 6000 ? `${text.slice(0, 6000)}\n… (truncated, ${fmt(text.length)} characters in total)` : text,
            output: text ? summary : 'No text yet',
        }),
        suggestedPrompts: [
            'Summarize this text in 3 bullet points',
            'What is the tone and sentiment of this text?',
            'Suggest 3 alternative titles for this text',
            'How can I improve the readability of this writing?',
            'Explain these statistics in plain English',
        ],
    })

    const pipelineData = hasText ? JSON.stringify({
        words: stats.words,
        uniqueWords: stats.uniqueWords,
        characters: stats.characters,
        charactersNoWhitespace: stats.charactersNoSpaces,
        codePoints: stats.codePoints,
        utf16Units: stats.utf16Units,
        bytesUtf8: stats.bytes,
        sentences: stats.sentences,
        paragraphs: stats.paragraphs,
        lines: stats.lines,
        readingSeconds: Math.round(stats.readingSeconds),
        speakingSeconds: Math.round(stats.speakingSeconds),
        topWords: stats.topWords,
    }, null, 2) : ''

    return (
        <div className="page page-wide">
            <ToolHeader />

            <div className="split-pane" style={{ alignItems: 'start' }}>
                <section className="card">
                    <Field
                        label="Text to analyze"
                        hint="Counts use Unicode rules: emoji and accented letters count as one character, and words are found in any language."
                        labelAction={
                            <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                <PipelineRead onRead={setText} />
                                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText('')} disabled={!text}>
                                    <Trash2 size={14} aria-hidden="true" /> Clear
                                </button>
                            </div>
                        }
                    >
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Type or paste text here…"
                            spellCheck={false}
                            style={{ minHeight: 360, fontFamily: 'var(--font-family)', fontSize: '1rem', lineHeight: 1.6 }}
                        />
                    </Field>
                </section>

                <section className="card" aria-label="Statistics" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                        <SectionHeading>Statistics</SectionHeading>
                        <div style={{ display: 'flex', gap: 'var(--space-xs)', flexWrap: 'wrap' }}>
                            <PipelineSend dataToSend={pipelineData} disabled={!hasText} />
                            <CopyButton text={hasText ? summary : ''} label="Copy summary" />
                        </div>
                    </div>

                    <div className="auto-grid" style={{ '--auto-grid-min': '150px', gap: 'var(--space-sm)' }} aria-live="polite">
                        <StatTile icon={Type} label="Words" value={fmt(stats.words)} hint={hasText ? `${fmt(stats.uniqueWords)} unique` : null} />
                        <StatTile icon={Hash} label="Characters" value={fmt(stats.characters)} hint={hasText ? `${fmt(stats.charactersNoSpaces)} without spaces` : null} />
                        <StatTile icon={Quote} label="Sentences" value={fmt(stats.sentences)} />
                        <StatTile icon={Pilcrow} label="Paragraphs" value={fmt(stats.paragraphs)} />
                        <StatTile icon={AlignLeft} label="Lines" value={fmt(stats.lines)} />
                        <StatTile icon={BookOpen} label="Reading time" value={formatDuration(stats.readingSeconds)} hint={`at ${READING_WPM} wpm`} />
                        <StatTile icon={Mic} label="Speaking time" value={formatDuration(stats.speakingSeconds)} hint={`at ${SPEAKING_WPM} wpm`} />
                        <StatTile icon={HardDrive} label="Size (UTF-8)" value={formatBytes(stats.bytes)} hint={hasText ? `${fmt(stats.bytes)} bytes` : null} />
                    </div>

                    {hasText && (
                        <dl style={{ margin: 0 }}>
                            <DetailRow label="Code points" value={fmt(stats.codePoints)} title="Unicode code points; an emoji like 😀 is one" />
                            <DetailRow label="UTF-16 units (JavaScript length)" value={fmt(stats.utf16Units)} title="What String.length reports; emoji count as two" />
                            <DetailRow label="Whitespace characters" value={fmt(stats.whitespace)} />
                            <DetailRow label="Average word length" value={`${fmt(stats.avgWordLength, 1)} characters`} />
                            <DetailRow label="Average sentence length" value={`${fmt(stats.avgSentenceWords, 1)} words`} />
                            <DetailRow label="Longest word" value={stats.longestWord || '—'} />
                        </dl>
                    )}
                </section>
            </div>

            {hasText && (
                <div className="auto-grid" style={{ '--auto-grid-min': '300px' }}>
                    <section className="card" aria-labelledby={`${hideCommonId}-words`}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-sm)', flexWrap: 'wrap', marginBottom: 'var(--space-md)' }}>
                            <SectionHeading id={`${hideCommonId}-words`}>Top words</SectionHeading>
                            <label htmlFor={hideCommonId} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                <input id={hideCommonId} type="checkbox" checked={hideCommon} onChange={(e) => setHideCommon(e.target.checked)} />
                                Hide common English words
                            </label>
                        </div>
                        {stats.topWords.length ? (
                            <ol style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', margin: 0, padding: 0 }}>
                                {stats.topWords.map(({ word, count }) => (
                                    <li key={word} className="chip" style={{ cursor: 'default' }}>
                                        <span style={{ color: 'var(--text-main)' }}>{word}</span>
                                        <span style={{ color: 'var(--primary-text)', fontWeight: 700 }}>{fmt(count)}</span>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>No words found.</p>
                        )}
                    </section>

                    <section className="card" aria-labelledby={`${hideCommonId}-chars`}>
                        <SectionHeading id={`${hideCommonId}-chars`} style={{ marginBottom: 'var(--space-md)', flexWrap: 'wrap', columnGap: 'var(--space-sm)', rowGap: 0 }}>
                            Top characters <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: '0.8rem' }}>(excluding whitespace)</span>
                        </SectionHeading>
                        {stats.topChars.length ? (
                            <ol style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-xs)', margin: 0, padding: 0 }}>
                                {stats.topChars.map((c) => (
                                    <li key={c.char} className="chip" title={c.name} style={{ cursor: 'default' }}>
                                        <span className="mono" style={{ color: c.invisible ? 'var(--text-dim)' : 'var(--text-main)' }}>{c.label}</span>
                                        <span style={{ color: 'var(--primary-text)', fontWeight: 700 }}>{fmt(c.count)}</span>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>Only whitespace so far.</p>
                        )}
                    </section>
                </div>
            )}
        </div>
    )
}
