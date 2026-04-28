import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Send,
  Calendar,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  Cpu,
  FolderKanban,
  CheckCircle2,
  Eye,
  Trash2,
  Sparkles,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { DecisionCard } from './DecisionCard'
import { VoiceButton } from './VoiceButton'
import { safeJsonResponse, isJsonError } from '@/lib/safe-json'
import { useDraftStore } from '@/store/draftStore'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { Brief } from '@/lib/types'

interface DecisionInboxProps {
  brief: Brief
  /** Override initial collapsed state (default: auto — expanded if ≤1 decision or in-session, collapsed otherwise) */
  defaultCollapsed?: boolean
}

const typeLabels: Record<string, string> = {
  morning: 'Morning Brief',
  eod: 'End of Day',
  adhoc: 'Ad Hoc',
  urgent: 'URGENTE',
}

const typeColors: Record<string, string> = {
  morning: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  eod: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
  adhoc: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
  urgent: 'bg-red-500/20 text-red-300 border-red-500/40',
}

const sourceLabels: Record<string, string> = {
  brief: 'Brief',
  'in-session': 'Da sessione',
  cron: 'Cron',
}

const sourceColors: Record<string, string> = {
  brief: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'in-session': 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  cron: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
}

export function DecisionInbox({ brief, defaultCollapsed }: DecisionInboxProps) {
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<null | {
    savedTo: string
    markdownTo: string
    orchestrator: unknown
  }>(null)
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [resolutionText, setResolutionText] = useState('')

  const source = (brief as any).source || 'brief'
  const projectId = (brief as any).projectId
  const isInSession = source === 'in-session'

  // V15.0 WS23 — Log viewer per brief in-session
  const [logDialogOpen, setLogDialogOpen] = useState(false)
  const [logBuffer, setLogBuffer] = useState<string>('')
  const [logLoading, setLogLoading] = useState(false)
  // V15.0 WS25 — Cleanup & regenerate per brief in-session
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [regenOpen, setRegenOpen] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  async function handleCleanup() {
    if (!projectId) return
    setActionBusy(true)
    try {
      const r = await fetch('/api/briefs/in-session/cleanup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await safeJsonResponse<{ archived: number; failed: number; error?: string }>(r)
      if (isJsonError(data)) {
        if (data.httpStatus === 404) {
          toast.error('Endpoint non trovato (404)', {
            description: 'Il backend ha codice obsoleto. Riavvia: Ctrl+C nel terminale dev:server, poi npm run dev:server (o dev:all).',
          })
        } else if (data.httpStatus >= 500) {
          toast.error(`Backend errore ${data.httpStatus}`, {
            description: 'Riprova tra qualche secondo o controlla i log backend.',
          })
        } else {
          toast.error('Risposta non valida dal backend', {
            description: `HTTP ${data.httpStatus}. Hard refresh (Ctrl+Shift+R) e riprova.`,
          })
        }
        return
      }
      if (r.ok) {
        // V15.0 WS28 — Toast con bottone "Annulla (ripristina)" per undo
        toast.success(`Archiviati ${data.archived} brief in-session di "${projectId}"`, {
          description: data.failed > 0 ? `${data.failed} errori (vedi log)` : undefined,
          duration: 12_000,
          action: data.archived > 0
            ? {
                label: 'Annulla (ripristina)',
                onClick: () => handleRestore(),
              }
            : undefined,
        })
        queryClient.invalidateQueries({ queryKey: ['briefs'] })
      } else {
        toast.error(`Errore cleanup: ${data.error || `HTTP ${r.status}`}`)
      }
    } catch (err) {
      toast.error(`Errore: ${(err as Error).message}`)
    } finally {
      setActionBusy(false)
      setCleanupOpen(false)
    }
  }

  async function handleRegenerate() {
    if (!projectId) return
    setActionBusy(true)
    try {
      const r = await fetch('/api/briefs/in-session/regenerate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await safeJsonResponse<{
        ok: boolean
        briefId?: string
        decisionId?: string
        cleanedCount?: number
        detectedAs?: string
        summarizeMode?: string
        bufferSource?: string
        error?: string
        message?: string
        hint?: string
      }>(r)
      if (isJsonError(data)) {
        if (data.httpStatus === 404) {
          toast.error('Endpoint non trovato (404)', {
            description: 'Il backend ha codice obsoleto. Riavvia: Ctrl+C nel terminale dev:server, poi npm run dev:server (o dev:all).',
          })
        } else if (data.httpStatus >= 500) {
          toast.error(`Backend errore ${data.httpStatus}`, {
            description: 'Riprova tra qualche secondo o controlla i log backend.',
          })
        } else {
          toast.error('Risposta non valida dal backend', {
            description: `HTTP ${data.httpStatus}. Hard refresh (Ctrl+Shift+R) e riprova.`,
          })
        }
        return
      }
      if (r.ok && data.ok) {
        // V15.0 WS28 — bufferSource informa l'utente da dove vengono i dati
        const sourceLabel = data.bufferSource === 'log_file' ? ' (da log)' : ''
        toast.success(`Brief rigenerato (${data.detectedAs}, ${data.summarizeMode})${sourceLabel}`, {
          description: `Cleaned ${data.cleanedCount} vecchi · ${data.briefId}`,
        })
        queryClient.invalidateQueries({ queryKey: ['briefs'] })
      } else if (
        r.status === 404 &&
        (data.error === 'no_buffer_available' || data.error === 'session_not_active')
      ) {
        // V15.0 WS28 — Sessione non disponibile + log file mancante.
        // I brief vecchi NON sono stati cancellati (atomicity). Suggerisce apri progetto.
        toast.error(`Sessione "${projectId}" non disponibile`, {
          description: data.message || 'Apri il progetto per riavviare la sessione PTY, poi riprova.',
          duration: 12_000,
          action: {
            label: 'Apri progetto',
            onClick: () => {
              window.location.href = `/projects/${encodeURIComponent(projectId)}`
            },
          },
        })
      } else {
        toast.error(`Errore regenerate: ${data.error || r.status}`)
      }
    } catch (err) {
      toast.error(`Errore: ${(err as Error).message}`)
    } finally {
      setActionBusy(false)
      setRegenOpen(false)
    }
  }

  // V15.0 WS28 — Restore briefs archiviati (undo cleanup)
  async function handleRestore() {
    if (!projectId) return
    try {
      const r = await fetch('/api/briefs/in-session/restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      })
      const data = await safeJsonResponse<{ restored: number; failed: number; error?: string }>(r)
      if (isJsonError(data)) {
        toast.error(`Restore fallito (HTTP ${data.httpStatus})`)
        return
      }
      if (r.ok && data.restored > 0) {
        toast.success(`Ripristinati ${data.restored} brief in-session di "${projectId}"`)
        queryClient.invalidateQueries({ queryKey: ['briefs'] })
      } else {
        toast.info('Nessun brief archiviato da ripristinare per questo progetto')
      }
    } catch (err) {
      toast.error(`Errore: ${(err as Error).message}`)
    }
  }

  async function loadLogBuffer() {
    if (!projectId) {
      setLogBuffer('Nessun projectId associato al brief.')
      return
    }
    setLogLoading(true)
    try {
      const r = await fetch(`/api/pty/${encodeURIComponent(projectId)}/buffer`, {
        credentials: 'include',
      })
      const data = await safeJsonResponse<{ buffer?: string }>(r)
      if (isJsonError(data)) {
        if (data.httpStatus === 404) {
          setLogBuffer(
            'Endpoint /api/pty/:id/buffer non trovato (404).\n\nIl backend ha codice obsoleto. Riavvialo:\n  1. Ctrl+C nel terminale dev:server\n  2. npm run dev:server (o dev:all)\n\nPoi riprova.'
          )
        } else {
          setLogBuffer(
            `Backend non raggiungibile (HTTP ${data.httpStatus}).\nFai Hard refresh (Ctrl+Shift+R) e riprova.`
          )
        }
        return
      }
      if (r.ok) {
        const clean = (data.buffer || '')
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\x1b\][^\x07]*\x07/g, '')
        setLogBuffer(clean || '(buffer vuoto)')
      } else if (r.status === 404) {
        setLogBuffer('Sessione PTY non attiva o terminata. Buffer non disponibile.\n\nApri il progetto per riavviarla.')
      } else {
        setLogBuffer(`Errore ${r.status} caricamento buffer.`)
      }
    } catch (err) {
      setLogBuffer(`Errore: ${(err as Error).message}`)
    } finally {
      setLogLoading(false)
    }
  }

  const resolveMut = useMutation({
    mutationFn: (resolution: string) =>
      api.briefs.resolve(brief.id, {
        resolvedVia: isInSession ? 'chat' : 'external',
        resolution: resolution.trim(),
        resolvedBy: 'user',
      }),
    onSuccess: () => {
      toast.success('Brief archiviato come risolto', {
        description: isInSession
          ? 'Rimosso da Inbox — sessione chat ha già chiuso la decisione'
          : 'Rimosso da Inbox — risolto altrove',
      })
      queryClient.invalidateQueries({ queryKey: ['briefs'] })
      setResolveDialogOpen(false)
      setResolutionText('')
    },
    onError: (err: any) => {
      const msg = String(err.message || err)
      if (msg.includes('404')) {
        toast.info('Brief già archiviato altrove', {
          description: 'Refresh per aggiornare',
        })
        queryClient.invalidateQueries({ queryKey: ['briefs'] })
        setResolveDialogOpen(false)
      } else {
        toast.error('Errore resolve', { description: msg })
      }
    },
  })

  // Auto-collapse logic: standard briefs with >1 decision → collapsed by default (progressive disclosure).
  // In-session briefs have 1 decision and are shown expanded since they need fast response.
  const autoCollapsed = defaultCollapsed ?? (brief.decisions.length > 1 && !isInSession)
  const [collapsed, setCollapsed] = useState(autoCollapsed)

  const { drafts, globalComments, setGlobalComment, clearBrief } = useDraftStore()
  const briefDrafts = drafts[brief.id] || {}
  const globalComment = globalComments[brief.id] || ''

  const answeredCount = Object.values(briefDrafts).filter((d) => d.answer).length
  const totalCount = brief.decisions.length
  const allAnswered = answeredCount === totalCount

  const handleSubmit = async () => {
    const entries = brief.decisions
      .map((d) => {
        const draft = briefDrafts[d.id]
        if (!draft?.answer) return null
        return {
          decisionId: d.id,
          answer: draft.answer,
          comment: draft.comment || '',
          voiceUsed: !!draft.voiceUsed,
        }
      })
      .filter(Boolean) as Array<{ decisionId: string; answer: any; comment: string; voiceUsed: boolean }>

    if (entries.length === 0) {
      toast.error('Rispondi almeno a una decisione prima di inviare')
      return
    }

    setSubmitting(true)
    try {
      const result = await api.responses.submit({
        briefId: brief.id,
        submittedAt: new Date().toISOString(),
        globalComment,
        entries,
      })
      setSubmitted({
        savedTo: result.savedTo,
        markdownTo: result.markdownTo,
        orchestrator: result.orchestrator,
      })
      clearBrief(brief.id)
      // V15.0 WS19 — Toast differenziato in base allo stato orchestrator
      const orch = result.orchestrator as { spawned?: boolean } | null
      if (orch && orch.spawned === false) {
        toast.error('Risposte salvate, orchestrator NON avviato', {
          description: 'Vedi banner errore per dettagli',
        })
      } else {
        toast.success('Risposte inviate. Orchestrator lanciato.', {
          description: `${entries.length} decisioni processate`,
        })
      }
    } catch (err) {
      toast.error('Errore invio risposte', { description: String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    // V15.0 WS19 — Mostra error visible se orchestrator non spawnato
    const orch = submitted.orchestrator as {
      spawned?: boolean
      error?: string
      errorCode?: string
      missingDeps?: string[]
      logTail?: string
      logPath?: string
    } | null
    const orchFailed = orch && orch.spawned === false
    const isPyDepsMissing = orch?.errorCode === 'python_deps_missing'

    if (orchFailed) {
      return (
        <Card className="border-red-500/40 bg-red-500/5">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <span className="text-red-400 text-xl">!</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-red-200">
                  Risposte salvate ma orchestrator NON avviato
                </h3>
                <p className="text-sm text-muted-foreground">
                  {isPyDepsMissing
                    ? 'Mancano dipendenze Python. Installale e riprova.'
                    : 'Orchestrator crashato all\'avvio. Vedi log per dettagli.'}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="bg-red-950/40 border border-red-500/30 rounded p-3 text-xs">
              <div className="font-medium text-red-200 mb-1">Errore:</div>
              <div className="text-red-100/90 font-mono">{orch.error}</div>
              {orch.missingDeps && orch.missingDeps.length > 0 && (
                <div className="mt-2 text-red-200/80">
                  Deps mancanti: <span className="font-mono">{orch.missingDeps.join(', ')}</span>
                </div>
              )}
            </div>

            {orch.logTail && (
              <details className="text-xs">
                <summary className="cursor-pointer text-red-300 hover:text-red-100 font-medium">
                  Log tail orchestrator (ultimi 1KB)
                </summary>
                <pre className="mt-2 bg-black/60 p-2 rounded text-red-100 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                  {orch.logTail}
                </pre>
                {orch.logPath && (
                  <div className="text-[10px] text-muted-foreground mt-1">Log completo: {orch.logPath}</div>
                )}
              </details>
            )}

            {isPyDepsMissing && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-xs">
                <div className="font-medium text-amber-200 mb-1.5">Fix rapido:</div>
                <ol className="list-decimal pl-5 space-y-1 text-amber-100/90">
                  <li>Vai in Inbox e clicca "Installa Python deps automaticamente" nel banner giallo in alto</li>
                  <li>Aspetta che l'install completi (~30-60s)</li>
                  <li>Riavvia il backend (Ctrl+C nel terminale + <code className="bg-amber-500/20 px-1 rounded">npm run dev:all</code>)</li>
                  <li>Riprova a inviare le risposte</li>
                </ol>
              </div>
            )}

            <div className="pt-1 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setSubmitted(null)}>
                Riprova
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(orch.logTail || orch.error || '')}
              >
                Copia log
              </Button>
            </div>
          </CardContent>
        </Card>
      )
    }

    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5 neon-card-green">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Send className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Risposte inviate</h3>
              <p className="text-sm text-muted-foreground">
                L'orchestrator sta pianificando i task paralleli.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">File JSON:</span>{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{submitted.savedTo}</code>
          </div>
          <div>
            <span className="text-muted-foreground">Markdown:</span>{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{submitted.markdownTo}</code>
          </div>
          <div className="pt-2">
            <Button size="sm" variant="outline" onClick={() => setSubmitted(null)}>
              Rispondi a un altro brief
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Resolve button — works in both collapsed and expanded views.
  const ResolveButton = ({ size = 'sm' }: { size?: 'sm' | 'xs' }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        setResolveDialogOpen(true)
      }}
      className={cn(
        'gap-1.5 text-muted-foreground hover:text-violet-300',
        size === 'xs' ? 'text-[11px] h-7 px-2' : 'text-xs'
      )}
      title={isInSession ? 'Hai già risposto in chat a Claude? Archivia il brief' : 'Risolto altrove? Archivia'}
    >
      <CheckCircle2 className="w-3.5 h-3.5" />
      {isInSession ? 'Risolto via chat' : 'Risolto altrove'}
    </Button>
  )

  // V15.0 WS25 — Bottone "Pulisci tutti gli in-session di questo progetto"
  const CleanupButton = ({ size = 'sm' }: { size?: 'sm' | 'xs' }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        setCleanupOpen(true)
      }}
      className={cn(
        'gap-1.5 text-muted-foreground hover:text-amber-300',
        size === 'xs' ? 'text-[11px] h-7 px-2' : 'text-xs'
      )}
      title={`Archivia tutti i brief in-session per il progetto "${projectId}"`}
    >
      <Trash2 className="w-3.5 h-3.5" />
      Pulisci tutti
    </Button>
  )

  // V15.0 WS25 — Bottone "Pulisci & rigenera": archivia vecchi + crea brief AI dal buffer corrente
  const RegenerateButton = ({ size = 'sm' }: { size?: 'sm' | 'xs' }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        setRegenOpen(true)
      }}
      className={cn(
        'gap-1.5 text-muted-foreground hover:text-violet-300',
        size === 'xs' ? 'text-[11px] h-7 px-2' : 'text-xs'
      )}
      title={`Pulisci e rigenera 1 brief AI dal buffer corrente PTY di "${projectId}"`}
    >
      <Sparkles className="w-3.5 h-3.5" />
      Rigenera
    </Button>
  )

  // V15.0 WS25 — Dialog conferma cleanup
  const CleanupDialog = () => (
    <AlertDialog open={cleanupOpen} onOpenChange={setCleanupOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archiviare tutti i brief in-session di "{projectId}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Tutti i briefs <code>source: 'in-session'</code> di questo progetto verranno
            spostati in <code>data/archive/briefs/</code>. Operazione reversibile (nessuna
            cancellazione fisica).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={actionBusy}>Annulla</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleCleanup()
            }}
            disabled={actionBusy}
            className="bg-amber-600 hover:bg-amber-700"
          >
            {actionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            Archivia tutti
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // V15.0 WS25 — Dialog conferma regenerate
  const RegenerateDialog = () => (
    <AlertDialog open={regenOpen} onOpenChange={setRegenOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rigenerare il brief in-session di "{projectId}"?</AlertDialogTitle>
          <AlertDialogDescription>
            Operazione one-shot: archivia tutti i vecchi brief in-session di questo progetto,
            legge il buffer PTY corrente, chiama il modello AI cheap (Claude Haiku via abbonamento
            o API REST se configurata), genera <strong>1 nuovo brief</strong> con title + summary
            di qualità. Richiede sessione PTY attiva.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={actionBusy}>Annulla</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              handleRegenerate()
            }}
            disabled={actionBusy}
            className="bg-violet-600 hover:bg-violet-700"
          >
            {actionBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            Rigenera
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // V15.0 WS23 — Bottone "Vedi log" per briefs in-session
  const ViewLogButton = ({ size = 'sm' }: { size?: 'sm' | 'xs' }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        setLogDialogOpen(true)
        loadLogBuffer()
      }}
      className={cn(
        'gap-1.5 text-muted-foreground hover:text-emerald-300',
        size === 'xs' ? 'text-[11px] h-7 px-2' : 'text-xs'
      )}
      title="Mostra il buffer raw della sessione PTY (ultimi 8KB) per leggere il contesto completo"
    >
      <Eye className="w-3.5 h-3.5" />
      Vedi log
    </Button>
  )

  // V15.0 WS23 — Dialog log viewer
  const LogViewerDialog = () => (
    <Dialog open={logDialogOpen} onOpenChange={setLogDialogOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Log PTY · {projectId}</DialogTitle>
          <DialogDescription>
            Buffer raw degli ultimi 8KB della sessione (ANSI codes rimossi). Utile per vedere
            il contesto completo prima di rispondere alla scelta.
          </DialogDescription>
        </DialogHeader>
        {logLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <pre className="text-[11px] bg-black/70 text-emerald-100/90 p-3 rounded max-h-[60vh] overflow-y-auto whitespace-pre-wrap font-mono scrollbar-violet border border-emerald-500/20">
            {logBuffer || '(nessun output)'}
          </pre>
        )}
      </DialogContent>
    </Dialog>
  )

  const ResolveDialog = () => (
    <AlertDialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isInSession ? 'Risolto via chat?' : 'Risolto altrove?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isInSession ? (
              <>
                Conferma che hai già risposto a Claude direttamente nella sessione del progetto{' '}
                <code className="bg-muted px-1 rounded text-xs">{projectId}</code>. Il brief verrà
                archiviato e sparirà da Inbox.
              </>
            ) : (
              'Conferma che la decisione è stata presa altrove (meeting, email, altro canale). Il brief verrà archiviato.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="py-2">
          <label className="text-xs text-muted-foreground mb-1.5 block">
            Nota (opzionale — sintesi di come è stato risolto):
          </label>
          <Textarea
            value={resolutionText}
            onChange={(e) => setResolutionText(e.target.value)}
            placeholder={
              isInSession
                ? 'es. "Ho detto a Claude di procedere con opzione A"'
                : 'es. "Decisione presa in meeting del 24/04"'
            }
            className="min-h-[60px] text-sm"
            maxLength={2000}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setResolutionText('')}>Annulla</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault()
              resolveMut.mutate(resolutionText)
            }}
            disabled={resolveMut.isPending}
            className="bg-violet-500 hover:bg-violet-600 text-white"
          >
            {resolveMut.isPending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Archivio...
              </>
            ) : (
              'Archivia come risolto'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  // ==========================================================
  // Collapsed view: compact card with "Vedi tutte le task (N)"
  // ==========================================================
  if (collapsed) {
    return (
      <>
      <ResolveDialog />
      {isInSession && <LogViewerDialog />}
      {isInSession && <CleanupDialog />}
      {isInSession && <RegenerateDialog />}
      <Card
        className={cn(
          'transition-colors cursor-pointer group',
          isInSession
            ? 'neon-card-purple hover:border-violet-400/60'
            : 'neon-card-purple hover:border-primary/60'
        )}
        onClick={() => setCollapsed(false)}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn('gap-1', typeColors[brief.type])}>
                  {typeLabels[brief.type]}
                </Badge>
                <Badge variant="outline" className={cn('gap-1', sourceColors[source])}>
                  {source === 'in-session' && <Cpu className="w-3 h-3" />}
                  {sourceLabels[source]}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(brief.createdAt).toLocaleString('it-IT', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                {projectId && (
                  <Link
                    to={`/projects/${projectId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 ml-1"
                  >
                    <FolderKanban className="w-3 h-3" />
                    {projectId}
                  </Link>
                )}
              </div>
              <h2 className="text-lg font-semibold leading-tight">{brief.title}</h2>
              {brief.summary && (
                <p className="text-sm text-muted-foreground line-clamp-2">{brief.summary}</p>
              )}
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Progresso</div>
                <div className="text-lg font-semibold">
                  {answeredCount} <span className="text-muted-foreground">/ {totalCount}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isInSession && <ViewLogButton size="xs" />}
                {isInSession && <RegenerateButton size="xs" />}
                {isInSession && <CleanupButton size="xs" />}
                <ResolveButton size="xs" />
                <Button variant="ghost" size="sm" className="gap-1 text-xs">
                  <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  Vedi tutte ({totalCount})
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>
      </>
    )
  }

  // ==========================================================
  // Expanded view: full brief with decision cards + submit form
  // ==========================================================
  return (
    <div className="space-y-6">
      <ResolveDialog />
      {isInSession && <LogViewerDialog />}
      {isInSession && <CleanupDialog />}
      {isInSession && <RegenerateDialog />}
      {/* Brief header */}
      <Card className={cn(isInSession ? 'neon-card-purple border-violet-400/40' : 'neon-card-purple')}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className={cn('gap-1', typeColors[brief.type])}>
                  {typeLabels[brief.type]}
                </Badge>
                <Badge variant="outline" className={cn('gap-1', sourceColors[source])}>
                  {source === 'in-session' && <Cpu className="w-3 h-3" />}
                  {sourceLabels[source]}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(brief.createdAt).toLocaleString('it-IT', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </span>
                {projectId && (
                  <Link
                    to={`/projects/${projectId}`}
                    className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 ml-1"
                  >
                    <FolderKanban className="w-3 h-3" />
                    {projectId}
                  </Link>
                )}
              </div>
              <h2 className="text-xl font-semibold leading-tight">{brief.title}</h2>
              {brief.summary && <p className="text-sm text-muted-foreground">{brief.summary}</p>}
            </div>
            <div className="text-right shrink-0 flex flex-col items-end gap-2">
              <div>
                <div className="text-xs text-muted-foreground">Progresso</div>
                <div className="text-lg font-semibold">
                  {answeredCount} <span className="text-muted-foreground">/ {totalCount}</span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {isInSession && <ViewLogButton size="xs" />}
                {isInSession && <RegenerateButton size="xs" />}
                {isInSession && <CleanupButton size="xs" />}
                <ResolveButton size="xs" />
                {brief.decisions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCollapsed(true)}
                    className="gap-1 text-xs"
                    title="Riduci questo brief"
                  >
                    <ChevronDown className="w-3.5 h-3.5 rotate-180 transition-transform" />
                    Comprimi
                  </Button>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Decision cards */}
      <div className="space-y-4">
        {brief.decisions.map((d, i) => (
          <DecisionCard key={d.id} briefId={brief.id} decision={d} index={i} />
        ))}
      </div>

      {/* Global comment + submit */}
      <Card className="neon-card-blue">
        <CardContent className="pt-6 space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Commenti aggiuntivi (opzionali)</label>
            <div className="relative">
              <Textarea
                value={globalComment}
                onChange={(e) => setGlobalComment(brief.id, e.target.value)}
                placeholder="Altre cose da comunicare che non riguardano una decisione specifica..."
                className="min-h-[80px] pr-12 resize-none"
              />
              <div className="absolute top-2 right-2">
                <VoiceButton
                  initial={globalComment}
                  onTranscript={(t) => setGlobalComment(brief.id, t)}
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              {answeredCount === 0 ? (
                <>
                  <AlertCircle className="w-4 h-4 text-amber-400" />
                  Rispondi ad almeno una decisione
                </>
              ) : allAnswered ? (
                <span className="text-emerald-400">Tutte le decisioni compilate ✓</span>
              ) : (
                <span>{totalCount - answeredCount} decisioni non ancora compilate</span>
              )}
            </div>
            <Button
              size="lg"
              onClick={handleSubmit}
              disabled={submitting || answeredCount === 0}
              className="gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Invia risposte
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
