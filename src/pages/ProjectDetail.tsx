import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ExternalLink, FileText, GitBranch, Server,
  BookOpen, Loader2, Globe, Cloud, Terminal, XCircle,
  CheckCircle2, Archive as ArchiveIcon, ArchiveRestore, FolderTree as FolderTreeIcon, Pencil, Check, X as XIcon,
} from 'lucide-react'
import { LogDrawer } from '@/components/tasks/LogDrawer'
import { EmbeddedChat } from '@/components/projects/EmbeddedChat'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sparkles } from 'lucide-react'
import { MarkdownRenderer } from '@/components/docs/MarkdownRenderer'
import { PageErrorBoundary } from '@/components/system/PageErrorBoundary'
import { SessionStatusDot } from '@/components/projects/SessionStatusDot'
import { listAllFolders } from '@/components/projects/FolderTree'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const statusDots: Record<string, string> = {
  green: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.6)]',
  yellow: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]',
  red: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]',
  paused: 'bg-slate-500',
  unknown: 'bg-slate-600',
}

async function fetchMoc(path: string) {
  const res = await fetch(`/api/vault/file?path=${encodeURIComponent(path)}`)
  if (!res.ok) return null
  return res.json() as Promise<{ content: string; name: string }>
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [logOpen, setLogOpen] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [newFolderInput, setNewFolderInput] = useState('')
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false)
  // V14.18 — rename inline del nome progetto
  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  const project = useQuery({
    queryKey: ['project', id],
    queryFn: () => api.projects.get(id!),
    enabled: !!id,
    refetchInterval: 5_000,
  })

  // Full projects list used to extract existing folders for the "Move to..." dropdown
  const allProjects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    staleTime: 30_000,
  })

  // V14.1: PTY info per gating bottone "Chiudi" — dice se PTY embedded è attivo
  const ptyInfoQ = useQuery({
    queryKey: ['pty/info', id],
    queryFn: async () => {
      const res = await fetch(`/api/pty/${encodeURIComponent(id!)}/info`)
      return res.json() as Promise<{ active: boolean; canResume: boolean }>
    },
    enabled: !!id,
    refetchInterval: 5_000,
  })

  const completeMut = useMutation({
    mutationFn: () => api.tasks.complete(id!),
    onSuccess: () => {
      toast.success('Task marcata come completata', {
        description: 'Pallino blu al prossimo refresh. Marker file scritto.',
      })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (err) => toast.error('Errore mark completed', { description: String(err) }),
  })

  const archiveMut = useMutation({
    mutationFn: () => api.projects.archive(id!),
    onSuccess: () => {
      toast.success('Progetto archiviato', {
        description: 'Lo trovi in sezione Archiviati. Puoi ripristinarlo quando vuoi.',
      })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate('/projects')
    },
    onError: (err: any) => {
      const msg = String(err.message || err)
      if (msg.includes('session_active') || msg.includes('409')) {
        toast.error('Sessione attiva', {
          description: 'Chiudi la sessione prima di archiviare.',
        })
      } else {
        toast.error('Errore archiviazione', { description: msg })
      }
    },
  })

  const restoreMut = useMutation({
    mutationFn: () => api.projects.restore(id!),
    onSuccess: () => {
      toast.success('Progetto ripristinato')
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error('Errore ripristino', { description: String(err) }),
  })

  const moveMut = useMutation({
    mutationFn: (folder: string | undefined) => api.projects.move(id!, folder),
    onSuccess: (_, folder) => {
      toast.success(folder ? `Spostato in "${folder}"` : 'Riportato alla root')
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error('Errore spostamento', { description: String(err) }),
  })

  // V13: Account override
  const accountsQuery = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
    staleTime: 60_000,
  })

  const patchMut = useMutation({
    mutationFn: (patch: any) => api.projects.patch(id!, patch),
    onSuccess: () => {
      toast.success('Progetto aggiornato')
      queryClient.invalidateQueries({ queryKey: ['project', id] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error('Errore update', { description: String(err) }),
  })

  const moc = useQuery({
    queryKey: ['project', id, 'moc'],
    queryFn: () => fetchMoc((project.data as any)!.mocPath!),
    enabled: !!(project.data as any)?.mocPath,
  })

  if (project.isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" /> Caricamento progetto...
      </div>
    )
  }
  if (project.error || !project.data) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Indietro
        </Button>
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Progetto non trovato: {id}
        </div>
      </div>
    )
  }

  const p = project.data as any

  // V14.19 — provider name dinamico (effectiveCli) per label visibili
  const _effectiveAccountId = p?.accountOverride || (accountsQuery.data as any)?.activeId
  const _effectiveAccount = (accountsQuery.data as any)?.accounts?.find((a: any) => a.id === _effectiveAccountId)
  const effectiveCli: string = _effectiveAccount?.cliName || 'AI'

  // V14.2: rimosso openClaudeSession — l'embedded auto-spawna ed è la modalità unica.
  // Chi voleva la cmd.exe Windows visibile può continuare a lanciare claude da terminale.

  const closeSession = async () => {
    const t = toast.loading(`Chiusura sessione "${p.name}"...`)
    try {
      // V14.1: chiudo in parallelo PTY embedded + cmd.exe esterna se presenti
      const [ptyResult, extResult] = await Promise.allSettled([
        fetch(`/api/pty/${p.id}`, { method: 'DELETE' }).then((r) => r.json()),
        api.orchestrator.killExternal(p.id),
      ])
      const ptyOk = ptyResult.status === 'fulfilled' && ptyResult.value?.ok === true
      const extOk = extResult.status === 'fulfilled' && extResult.value?.ok === true
      const extPid = extResult.status === 'fulfilled' ? extResult.value?.killedPid : undefined

      if (ptyOk || extOk) {
        const parts = [
          ptyOk && 'PTY embedded terminato',
          extOk && `cmd.exe esterno killed (PID ${extPid})`,
        ].filter(Boolean) as string[]
        toast.success('Sessioni chiuse', {
          id: t,
          description: parts.join(' · ') + ' — il contesto AI è salvato in ~/.claude/projects/',
          duration: 6000,
        })
        // Refresh queries così il bottone si disabilita e il pallino aggiorna
        queryClient.invalidateQueries({ queryKey: ['project', id] })
        queryClient.invalidateQueries({ queryKey: ['pty/info', id] })
      } else {
        toast.info('Nessuna sessione attiva da chiudere', { id: t })
      }
    } catch (err) {
      toast.error('Errore chiusura', { id: t, description: String(err) })
    }
  }

  return (
    <PageErrorBoundary pageName="ProjectDetail">
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/projects')} className="gap-1.5 mb-3 -ml-2">
          <ArrowLeft className="w-3.5 h-3.5" /> Tutti i progetti
        </Button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <span className={cn('w-3 h-3 rounded-full mt-2 shrink-0', statusDots[p.status] || statusDots.unknown)} />
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                {/* V14.18 — rename inline */}
                {renaming ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      maxLength={100}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && draftName.trim().length >= 2 && draftName.trim() !== p.name) {
                          patchMut.mutate({ name: draftName.trim() })
                          setRenaming(false)
                        }
                        if (e.key === 'Escape') {
                          setRenaming(false)
                          setDraftName(p.name)
                        }
                      }}
                      className="text-xl md:text-2xl font-semibold tracking-tight h-9 px-2 max-w-md"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-emerald-400 hover:text-emerald-300"
                      onClick={() => {
                        if (draftName.trim().length >= 2 && draftName.trim() !== p.name) {
                          patchMut.mutate({ name: draftName.trim() })
                        }
                        setRenaming(false)
                      }}
                      disabled={draftName.trim().length < 2 || draftName.trim() === p.name || patchMut.isPending}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setRenaming(false)
                        setDraftName(p.name)
                      }}
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <h1 className="text-xl md:text-2xl font-semibold tracking-tight flex items-center gap-2 group/name">
                    {p.name}
                    <button
                      type="button"
                      onClick={() => {
                        setDraftName(p.name)
                        setRenaming(true)
                      }}
                      className="text-muted-foreground hover:text-foreground opacity-50 group-hover/name:opacity-100 transition-opacity"
                      title="Rinomina progetto"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </h1>
                )}
                <div className="flex items-center gap-1.5 text-xs">
                  <SessionStatusDot status={p.sessionStatus || 'idle'} />
                  <span className="text-muted-foreground capitalize">
                    {p.sessionStatus === 'idle' ? 'idle' : p.sessionStatus}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1.5">
                {p.category && (
                  <Badge variant="secondary" className="text-[10px]">{p.category}</Badge>
                )}
                {p.tags?.map((t: string) => (
                  <span key={t} className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => setLogOpen(true)} className="gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              Log
            </Button>
            {(() => {
              const ptyActive = ptyInfoQ.data?.active === true
              const sessionLive = p.sessionStatus === 'running' || p.sessionStatus === 'recently_terminated'
              const canClose = ptyActive || sessionLive
              return (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={closeSession}
                  disabled={!canClose}
                  className={cn(
                    'gap-1.5',
                    canClose
                      ? 'text-red-400 hover:text-red-300 hover:bg-red-500/10'
                      : 'opacity-50 cursor-not-allowed'
                  )}
                  title={
                    canClose
                      ? 'Killa il PTY embedded e i suoi processi figli (claude CLI)'
                      : 'Nessun PTY embedded attivo da terminare'
                  }
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Termina embedded
                </Button>
              )
            })()}
          </div>
        </div>

        {/* V11 action bar: completion, folder move, archive */}
        <div className="flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-border/40">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
            Lifecycle
          </span>

          <Button
            size="sm"
            variant="outline"
            onClick={() => completeMut.mutate()}
            disabled={completeMut.isPending || p.sessionStatus === 'running'}
            className="gap-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
            title={
              p.sessionStatus === 'running'
                ? 'Chiudi la sessione prima di marcare come completato'
                : "Conferma: quello che avevi chiesto è stato portato a termine. Pallino diventa blu."
            }
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {completeMut.isPending ? 'Salvo...' : 'Segna completato'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <FolderTreeIcon className="w-3.5 h-3.5" />
                {p.folder ? `In: ${p.folder}` : 'Sposta in...'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>Sposta progetto</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => moveMut.mutate(undefined)}>
                <span className="text-xs italic text-muted-foreground">
                  (root — nessuna cartella)
                </span>
              </DropdownMenuItem>
              {(() => {
                const folders = listAllFolders(
                  (allProjects.data?.projects as any) || []
                )
                if (folders.length === 0) {
                  return (
                    <DropdownMenuItem disabled>
                      <span className="text-xs italic text-muted-foreground">
                        Nessuna cartella esistente
                      </span>
                    </DropdownMenuItem>
                  )
                }
                return folders.map((f) => (
                  <DropdownMenuItem key={f} onClick={() => moveMut.mutate(f)}>
                    <FolderTreeIcon className="w-3.5 h-3.5 mr-2 text-violet-400" />
                    <span className="text-xs truncate">{f}</span>
                  </DropdownMenuItem>
                ))
              })()}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault()
                  setNewFolderDialogOpen(true)
                }}
                className="text-primary"
              >
                + Nuova cartella...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {p.archived ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => restoreMut.mutate()}
              disabled={restoreMut.isPending}
              className="gap-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
              Ripristina
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setArchiveConfirmOpen(true)}
              disabled={archiveMut.isPending}
              className="gap-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
            >
              <ArchiveIcon className="w-3.5 h-3.5" />
              Archivia
            </Button>
          )}

          {p.archived && p.archivedAt && (
            <span className="text-[10px] text-muted-foreground ml-2">
              Archiviato il {new Date(p.archivedAt).toLocaleDateString('it-IT')}
            </span>
          )}
        </div>

        {/* V13: AI Account override per-project */}
        <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-border/40">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">
            AI Account
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                {p.accountOverride
                  ? accountsQuery.data?.accounts.find((a) => a.id === p.accountOverride)?.label ||
                    p.accountOverride
                  : 'Usa globale'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuLabel>Account AI per questo progetto</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => patchMut.mutate({ accountOverride: null, modelOverride: null })}
              >
                <Sparkles className="w-3.5 h-3.5 mr-2 text-violet-400" />
                <div className="flex-1">
                  <div className="text-xs">Usa globale</div>
                  <div className="text-[10px] text-muted-foreground">
                    Eredita dall'account attivo in topbar
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {(accountsQuery.data?.accounts || []).map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onClick={() => patchMut.mutate({ accountOverride: a.id, modelOverride: null })}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{a.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {a.mode} · {a.defaultModel || 'modello default'}
                    </div>
                  </div>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Model override dropdown */}
          {(() => {
            const effectiveAccountId = p.accountOverride || accountsQuery.data?.activeId
            const effectiveAccount = accountsQuery.data?.accounts.find(
              (a) => a.id === effectiveAccountId
            )
            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <span className="text-[10px] text-muted-foreground">Modello:</span>
                    <code className="text-[10px]">
                      {p.modelOverride || effectiveAccount?.defaultModel || 'default'}
                    </code>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  <DropdownMenuLabel>Modello override</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => patchMut.mutate({ modelOverride: null })}>
                    <div className="flex-1">
                      <div className="text-xs">Default dell'account</div>
                      <div className="text-[10px] text-muted-foreground">
                        {effectiveAccount?.defaultModel || '(nessuno)'}
                      </div>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {/* Models from effective account's provider */}
                  {effectiveAccount ? (
                    <DropdownMenuItem disabled>
                      <span className="text-[10px] text-muted-foreground italic">
                        Modelli disponibili: vedi pagina /accounts
                      </span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem disabled>
                      <span className="text-[10px] text-muted-foreground italic">
                        Seleziona account prima
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          })()}
        </div>
      </div>

      {/* Archive confirmation dialog */}
      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiviare "{p.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Il progetto sparirà dalla sezione Attivi e finirà negli Archiviati. Puoi sempre
              ripristinarlo. Nessun dato viene eliminato.
              {p.sessionStatus === 'running' && (
                <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
                  ⚠ Sessione embedded attiva: terminala prima con "Termina embedded".
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setArchiveConfirmOpen(false)
                archiveMut.mutate()
              }}
              disabled={p.sessionStatus === 'running'}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              Archivia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New folder dialog */}
      <AlertDialog open={newFolderDialogOpen} onOpenChange={setNewFolderDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nuova cartella</AlertDialogTitle>
            <AlertDialogDescription>
              Digita il path della cartella (esempio:{' '}
              <code className="bg-muted px-1 rounded">Clients/NewClient</code>). Usa{' '}
              <code className="bg-muted px-1 rounded">/</code> per annidare.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            autoFocus
            value={newFolderInput}
            onChange={(e) => setNewFolderInput(e.target.value)}
            placeholder="es. Clients/NewClient"
            className="my-2"
          />
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setNewFolderInput('')}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const folder = newFolderInput.trim()
                if (!folder) return
                if (!/^[a-zA-Z0-9 _-]+(?:\/[a-zA-Z0-9 _-]+)*$/.test(folder)) {
                  toast.error('Path cartella invalido', {
                    description: 'Solo lettere, numeri, spazi, _ - e / come separatore',
                  })
                  return
                }
                moveMut.mutate(folder)
                setNewFolderInput('')
                setNewFolderDialogOpen(false)
              }}
            >
              Sposta qui
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Waiting user banner */}
      {p.sessionStatus === 'waiting_user' && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4 flex items-center gap-3">
            <SessionStatusDot status="waiting_user" size="md" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-amber-300">Sessione in attesa di tua risposta</div>
              <div className="text-xs text-muted-foreground">
                Vai al terminale CMD con titolo "{effectiveCli}-{p.id}" per rispondere.
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => toast.info(`Focus finestra: ${effectiveCli}-${p.id}`)}
              className="gap-1.5"
            >
              <ExternalLink className="w-3 h-3" />
              Vai alla finestra
            </Button>
          </CardContent>
        </Card>
      )}

      {/* External active banner — V11-03: Claude Code attivo fuori da SAIO PTY */}
      {p.sessionStatus === 'external_active' && (
        <Card className="border-violet-500/40 bg-violet-500/5 neon-card-purple">
          <CardContent className="py-4 flex items-center gap-3">
            <SessionStatusDot status="external_active" size="md" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-violet-300">
                CLI AI attiva esternamente
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Una finestra {effectiveCli} sta scrivendo jsonl in questo momento su <code className="text-[11px] bg-muted/40 px-1 py-0.5 rounded">{p.externalCwd || p.id}</code>.
                Non è la PTY embedded di SAIO — è la tua sessione {effectiveCli} terminale/IDE.
              </div>
            </div>
            <div
              title="Rilevamento basato su mtime recente (< 2 min) di ~/.claude/projects/<slug>/*.jsonl"
              className="text-[10px] text-muted-foreground cursor-help px-2 py-1 rounded border border-violet-500/30 bg-violet-500/5"
            >
              ℹ detection
            </div>
          </CardContent>
        </Card>
      )}

      {/* Next action */}
      {p.nextAction && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="text-[10px] uppercase tracking-wider text-primary mb-1">Next action</div>
            <p className="text-sm">{p.nextAction}</p>
          </CardContent>
        </Card>
      )}

      {/* Actions row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {p.mocPath && (
          <Link to={`/docs`} className="block">
            <Card className="hover:border-blue-500/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.15)] transition-all cursor-pointer h-full">
              <CardContent className="p-3 flex flex-col items-center text-center gap-1">
                <BookOpen className="w-5 h-5 text-blue-400" />
                <div className="text-xs font-semibold">MOC</div>
                <div className="text-[9px] text-muted-foreground truncate max-w-full">{p.mocPath.split('/').pop()}</div>
              </CardContent>
            </Card>
          </Link>
        )}
        {p.github && (
          <a href={p.github} target="_blank" rel="noopener noreferrer">
            <Card className="hover:border-purple-500/50 hover:shadow-[0_0_15px_rgba(147,51,234,0.15)] transition-all cursor-pointer h-full">
              <CardContent className="p-3 flex flex-col items-center text-center gap-1">
                <GitBranch className="w-5 h-5 text-purple-400" />
                <div className="text-xs font-semibold">GitHub</div>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </CardContent>
            </Card>
          </a>
        )}
        {p.vercel && (
          <a href={p.vercel} target="_blank" rel="noopener noreferrer">
            <Card className="hover:border-white/50 hover:shadow-[0_0_15px_rgba(255,255,255,0.15)] transition-all cursor-pointer h-full">
              <CardContent className="p-3 flex flex-col items-center text-center gap-1">
                <Cloud className="w-5 h-5 text-foreground" />
                <div className="text-xs font-semibold">Vercel</div>
                <ExternalLink className="w-3 h-3 text-muted-foreground" />
              </CardContent>
            </Card>
          </a>
        )}
        {p.hostUrl && (
          <a href={p.hostUrl} target="_blank" rel="noopener noreferrer">
            <Card className="hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(16,185,129,0.15)] transition-all cursor-pointer h-full">
              <CardContent className="p-3 flex flex-col items-center text-center gap-1">
                <Globe className="w-5 h-5 text-emerald-400" />
                <div className="text-xs font-semibold">Sito live</div>
                <div className="text-[9px] text-muted-foreground truncate max-w-full">
                  {p.hostUrl.replace(/^https?:\/\//, '').split('/')[0]}
                </div>
              </CardContent>
            </Card>
          </a>
        )}
        {p.vps && (
          <Card className="hover:border-amber-500/50 transition-all h-full">
            <CardContent className="p-3 flex flex-col items-center text-center gap-1">
              <Server className="w-5 h-5 text-amber-400" />
              <div className="text-xs font-semibold">VPS</div>
              <code className="text-[9px] text-muted-foreground truncate max-w-full">{p.vps.replace('ssh ', '')}</code>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Log Drawer (live session output) */}
      <LogDrawer
        task={
          logOpen
            ? ({ projectId: p.id, title: p.name, logFile: `data/logs/${p.id}.log` } as any)
            : null
        }
        onClose={() => setLogOpen(false)}
      />

      {/* Chat Claude embedded (live PTY via WebSocket) */}
      <Card className="neon-card-purple overflow-hidden">
        <CardContent className="p-0">
          <EmbeddedChat projectId={p.id} />
        </CardContent>
      </Card>

      {/* MOC content embedded */}
      {p.mocPath && (
        <Card className="neon-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-border flex-wrap">
              <FileText className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Documentazione progetto</h2>
              <code className="ml-auto text-[10px] text-muted-foreground truncate max-w-[60%]">{p.mocPath}</code>
            </div>
            {moc.isLoading && (
              <div className="text-xs text-muted-foreground">Caricamento documentazione...</div>
            )}
            {moc.data && typeof moc.data.content === 'string' && moc.data.content.length > 0 ? (
              <div className="max-w-none overflow-x-auto scrollbar-thin">
                <MarkdownRenderer
                  content={moc.data.content}
                  onWikiLinkClick={(target) => {
                    navigate(`/docs`)
                    toast.info(`Cerca "${target}" nel vault`)
                  }}
                />
              </div>
            ) : (
              !moc.isLoading && (
                <p className="text-xs text-muted-foreground">
                  MOC non trovato o file vuoto (path: <code>{p.mocPath}</code>). Crea il file o aggiorna il riferimento del progetto.
                </p>
              )
            )}
          </CardContent>
        </Card>
      )}
    </div>
    </PageErrorBoundary>
  )
}
