import { memo } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from '../ui/CodeBlock'
import './ai.css'

function textOf(node) {
    if (!node) return ''
    if (node.type === 'text') return node.value
    return (node.children || []).map(textOf).join('')
}

function languageOf(codeNode) {
    const classes = codeNode?.properties?.className
    const list = Array.isArray(classes) ? classes : classes ? [classes] : []
    const match = list.map(String).find(c => c.startsWith('language-'))
    return match ? match.slice('language-'.length).toLowerCase() : null
}

// Raw HTML in answers is shown as text (react-markdown never renders it) and
// URLs go through react-markdown's safe-URL filter.
const COMPONENTS = {
    pre({ node }) {
        const code = node?.children?.find(c => c.type === 'element' && c.tagName === 'code')
        const language = languageOf(code)
        const text = textOf(code || node).replace(/\n$/, '')
        return (
            <CodeBlock
                code={text}
                language={language || 'text'}
                title={language || undefined}
                copyLabel="Copy code"
                className="ai-md-codeblock"
                maxHeight={360}
            />
        )
    },
    code({ node: _node, className, children, ...rest }) {
        return <code className={`ai-inline-code ${className || ''}`} {...rest}>{children}</code>
    },
    a({ node: _node, href, children, ...rest }) {
        return <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    },
    // Remote images would be fetched from third-party servers: link to them instead
    img({ src, alt }) {
        if (!src) return alt ? <span>{alt}</span> : null
        return <a href={src} target="_blank" rel="noopener noreferrer">{alt || src}</a>
    },
    table({ node: _node, ...rest }) {
        return (
            <div className="ai-md-table">
                <table {...rest} />
            </div>
        )
    },
}

const REMARK_PLUGINS = [remarkGfm]

/** Renders an assistant answer as GitHub-flavoured Markdown. */
function AssistantMarkdown({ text }) {
    return (
        <div className="ai-md">
            <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>{text}</Markdown>
        </div>
    )
}

export default memo(AssistantMarkdown)
