import { Component, type ErrorInfo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeHighlight from 'rehype-highlight'
import 'highlight.js/styles/github-dark.css'
import { cn } from '@/lib/utils'

interface MarkdownRendererProps {
  content: string
  onWikiLinkClick?: (target: string) => void
  className?: string
}

// Convert [[wiki-link]] and [[wiki-link|display]] to anchor tags
function preprocessWikiLinks(md: string): string {
  if (typeof md !== 'string') return ''
  return md.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, display) => {
    const text = display || target
    return `<a href="#wiki:${encodeURIComponent(String(target).trim())}" class="wiki-link">${text}</a>`
  })
}

/**
 * V14.2 — ErrorBoundary attorno a ReactMarkdown.
 * Causa nota: pipeline rehype-raw + rehype-highlight + content esoterico può
 * generare errori interni minified (es. "FKH is not a function") che fanno crashare
 * l'intera pagina invece di degradare graceful. L'ErrorBoundary cattura e mostra
 * un fallback con il contenuto raw.
 */
class MarkdownErrorBoundary extends Component<
  { children: ReactNode; rawContent: string; className?: string },
  { hasError: boolean; errorMsg?: string }
> {
  state = { hasError: false, errorMsg: undefined as string | undefined }
  static getDerivedStateFromError(err: Error) {
    return { hasError: true, errorMsg: err.message }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[MarkdownRenderer] render error caught:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className={cn('text-xs text-amber-300/90 italic border border-amber-500/30 bg-amber-500/5 rounded p-3 space-y-2', this.props.className)}>
          <div className="font-semibold flex items-center gap-1.5">⚠ Rendering markdown fallito</div>
          <div className="text-[10px] text-muted-foreground font-mono break-all">
            {this.state.errorMsg || 'errore sconosciuto durante il render'}
          </div>
          <details className="text-[10px]">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Mostra contenuto raw</summary>
            <pre className="mt-2 p-2 bg-black/40 rounded overflow-x-auto whitespace-pre-wrap text-[10px] max-h-96">
              {this.props.rawContent.slice(0, 5000)}
            </pre>
          </details>
        </div>
      )
    }
    return this.props.children
  }
}

export function MarkdownRenderer({ content, onWikiLinkClick, className }: MarkdownRendererProps) {
  // V14.2: guard contro content null/undefined/non-string
  if (typeof content !== 'string' || content.length === 0) {
    return (
      <div className={cn('text-xs text-muted-foreground italic', className)}>
        Contenuto non disponibile o vuoto.
      </div>
    )
  }
  const processed = preprocessWikiLinks(content)

  return (
    <div
      className={cn('markdown-body text-sm leading-relaxed', className)}
      onClick={(e) => {
        const target = e.target as HTMLElement
        if (target.tagName === 'A' && target.classList.contains('wiki-link')) {
          e.preventDefault()
          const href = target.getAttribute('href') || ''
          const match = href.match(/^#wiki:(.+)$/)
          if (match && onWikiLinkClick) {
            onWikiLinkClick(decodeURIComponent(match[1]))
          }
        }
      }}
    >
      <MarkdownErrorBoundary rawContent={content} className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeHighlight]}
        components={{
          h1: ({ children }) => <h1 className="text-2xl font-bold mt-6 mb-3 pb-2 border-b border-border">{children}</h1>,
          h2: ({ children }) => <h2 className="text-xl font-semibold mt-5 mb-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>,
          h4: ({ children }) => <h4 className="text-base font-semibold mt-3 mb-2">{children}</h4>,
          p: ({ children }) => <p className="my-3 text-foreground/90">{children}</p>,
          ul: ({ children }) => <ul className="list-disc pl-6 my-3 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-6 my-3 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-foreground/90">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-primary/40 pl-4 py-1 my-3 italic text-muted-foreground bg-muted/30 rounded-r">
              {children}
            </blockquote>
          ),
          code: ({ inline, className, children, ...props }: any) =>
            inline ? (
              <code className="bg-muted text-foreground px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                {children}
              </code>
            ) : (
              <code className={cn('block', className)} {...props}>
                {children}
              </code>
            ),
          pre: ({ children }) => (
            <pre className="bg-black/50 rounded-md p-3 my-3 overflow-x-auto scrollbar-thin text-xs border border-border">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 scrollbar-thin">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => <th className="border border-border px-3 py-2 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="border border-border px-3 py-2">{children}</td>,
          a: ({ href, children, className: cls, ...rest }) => (
            <a
              href={href}
              className={cn(
                'underline underline-offset-2 hover:text-primary transition-colors',
                cls?.includes('wiki-link')
                  ? 'text-primary bg-primary/10 px-1 rounded no-underline hover:bg-primary/20 cursor-pointer'
                  : 'text-info'
              )}
              target={href?.startsWith('http') ? '_blank' : undefined}
              rel={href?.startsWith('http') ? 'noopener noreferrer' : undefined}
              {...rest}
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-6 border-border/50" />,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
        }}
      >
        {processed}
      </ReactMarkdown>
      </MarkdownErrorBoundary>
    </div>
  )
}
