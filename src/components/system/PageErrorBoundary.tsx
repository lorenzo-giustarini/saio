/**
 * V15.0 WS29 — Top-level ErrorBoundary per pagine.
 *
 * Cattura crash di rendering React (es. "FKH is not a function" minified) che
 * altrimenti farebbero schermo bianco. Mostra fallback con stack trace + bottoni
 * "Riprova" e "Ricarica pagina". Logga su console.error per debug.
 *
 * Pattern derivato da MarkdownRenderer.tsx:31 (V14.2). Riusabile per qualsiasi
 * page-level wrap (ProjectDetail, Inbox, Docs, ecc.).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  pageName?: string
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: ErrorInfo
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, error: err }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[PageErrorBoundary:${this.props.pageName || 'unknown'}]`, error, info)
    this.setState({ errorInfo: info })
  }

  reset = (): void => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined })
  }

  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.message || 'Errore sconosciuto'
      return (
        <div className="max-w-2xl mx-auto p-6 mt-12 border border-red-500/40 bg-red-500/5 rounded-lg space-y-3">
          <div className="flex items-center gap-2 text-red-400 font-semibold">
            <AlertTriangle className="w-5 h-5" />
            Errore rendering pagina ({this.props.pageName || 'sconosciuta'})
          </div>
          <div className="text-xs font-mono text-red-200/80 bg-black/40 p-3 rounded break-all">
            {errMsg}
          </div>
          <details className="text-[11px] text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">
              Stack trace (per debug)
            </summary>
            <pre className="mt-2 p-2 bg-black/60 rounded overflow-x-auto whitespace-pre-wrap text-[10px] max-h-64 scrollbar-violet">
              {this.state.error?.stack || '(no stack)'}
              {this.state.errorInfo?.componentStack && (
                <>
                  {'\n\n--- Component stack ---\n'}
                  {this.state.errorInfo.componentStack}
                </>
              )}
            </pre>
          </details>
          <p className="text-xs text-muted-foreground">
            Cause più frequenti: bundle frontend stale (Hard refresh{' '}
            <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Ctrl+Shift+R</kbd>) o
            backend con shape API incompatibile (riavvia <code>npm run dev:server</code>).
          </p>
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="default" onClick={this.reset}>
              <RefreshCcw className="w-3.5 h-3.5 mr-1.5" />
              Riprova
            </Button>
            <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
              Ricarica pagina
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
