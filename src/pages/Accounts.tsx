import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Sparkles,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Trash2,
  Star,
  Loader2,
  Cpu,
  Globe,
  Key,
  Terminal,
  Pencil,
  Server,
  Monitor,
  HelpCircle,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label as FormLabel } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
import { AddAccountModal } from '@/components/accounts/AddAccountModal'
import { AddCustomProviderModal } from '@/components/accounts/AddCustomProviderModal'
import { SetSecretDialog } from '@/components/accounts/SetSecretDialog'
import { AccountLoginDialog } from '@/components/accounts/AccountLoginDialog'
import { TargetSelectorDialog } from '@/components/accounts/TargetSelectorDialog'
import { Link } from 'react-router-dom'
import { Table, Download, Terminal as TerminalIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const MODE_LABELS: Record<string, string> = {
  plan: 'Plan',
  api: 'API',
  cli: 'CLI',
  playwright: 'Web',
}

const MODE_COLORS: Record<string, string> = {
  plan: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  api: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  cli: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  playwright: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
}

const MODE_ICONS: Record<string, any> = {
  plan: Star,
  api: Key,
  cli: Terminal,
  playwright: Globe,
}

const CATEGORY_COLORS: Record<string, string> = {
  text: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
  image: 'bg-pink-500/10 border-pink-500/30 text-pink-300',
  video: 'bg-red-500/10 border-red-500/30 text-red-300',
  audio: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  multimodal: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300',
}

function HealthIcon({ health }: { health: string }) {
  if (health === 'ready') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
  if (health === 'not-configured') return <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
  if (health === 'not-installed') return <XCircle className="w-3.5 h-3.5 text-red-400" />
  if (health === 'error') return <XCircle className="w-3.5 h-3.5 text-red-500" />
  if (health === 'unconfigured') return <HelpCircle className="w-3.5 h-3.5 text-violet-400" />
  return <div className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
}

export function AccountsPage() {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  const [addCustomOpen, setAddCustomOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [setSecretFor, setSetSecretFor] = useState<{ id: string; label: string; envVarRef: string } | null>(null)
  const [loginFor, setLoginFor] = useState<{ id: string; label: string; cliName: string; mode: string; target?: string; targetLabel?: string } | null>(null)
  const [targetSelectorFor, setTargetSelectorFor] = useState<{ id: string; label: string; cliName: string; mode: string; currentTarget: string | null | undefined } | null>(null)
  const [renameFor, setRenameFor] = useState<{ id: string; currentLabel: string } | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [showAutodetect, setShowAutodetect] = useState(false)
  const [autodetectResults, setAutodetectResults] = useState<any[]>([])

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
    refetchInterval: 60_000,
  })
  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.providers.list(),
  })
  // V13.3-T8a: fetch locations per ogni account — chip "Attivo su: Local + VPS labels"
  const accountIds = (accounts.data?.accounts || []).map((a) => a.id).sort().join(',')
  const locations = useQuery({
    queryKey: ['accounts-locations', accountIds],
    queryFn: async () => {
      const ids = accountIds ? accountIds.split(',') : []
      const entries = await Promise.all(
        ids.map(async (id) => {
          try {
            const r = await api.accounts.locations(id)
            return [id, r] as const
          } catch {
            return [id, null] as const
          }
        })
      )
      return new Map(entries)
    },
    enabled: accountIds.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })
  const health = useQuery({
    queryKey: ['accounts-health'],
    queryFn: () => api.accounts.healthAll(),
    refetchInterval: 120_000,
  })
  // V14: lista VPS per resolveTargetLabel su chip target
  const vpsList = useQuery({
    queryKey: ['vps/list'],
    queryFn: () => api.vps.listResolved(),
    staleTime: 60_000,
  })
  const resolveTargetLabel = (target: string | undefined | null): string => {
    if (!target) return 'Non configurato'
    if (target === 'local') return 'Local'
    const vps = vpsList.data?.vps.find((v) => v.id === target)
    return vps?.effectiveLabel || vps?.label || target
  }

  const healthById = useMemo(
    () => new Map((health.data?.results || []).map((r: any) => [r.accountId, r])),
    [health.data]
  )

  const selectMut = useMutation({
    mutationFn: (id: string) => api.accounts.select(id),
    onSuccess: () => {
      toast.success('Account attivo aggiornato')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (err) => toast.error('Errore', { description: String(err) }),
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => api.accounts.remove(id),
    onSuccess: () => {
      toast.success('Account rimosso')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setDeletingId(null)
    },
    onError: (err) => toast.error('Errore', { description: String(err) }),
  })

  const renameMut = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api.accounts.update(id, { label }),
    onSuccess: () => {
      toast.success('Account rinominato')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-locations'] })
      setRenameFor(null)
      setRenameValue('')
    },
    onError: (err) => toast.error('Errore rinomina', { description: String(err) }),
  })

  const autodetectMut = useMutation({
    mutationFn: () => api.accounts.autodetect(),
    onSuccess: (data) => {
      setAutodetectResults(data.proposals)
      setShowAutodetect(true)
      if (data.count === 0) {
        toast.info('Nessun nuovo account rilevato', {
          description: 'Tutti i provider disponibili sono già configurati',
        })
      }
    },
    onError: (err) => toast.error('Autodetect fallito', { description: String(err) }),
  })

  const applyAutodetectMut = useMutation({
    mutationFn: (proposals: any[]) => api.accounts.autodetectApply(proposals),
    onSuccess: (data) => {
      toast.success(`${data.count} account creati da autodetect`)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setShowAutodetect(false)
      setAutodetectResults([])
    },
    onError: (err) => toast.error('Errore', { description: String(err) }),
  })

  const refreshHealthMut = useMutation({
    mutationFn: () => api.accounts.healthAll(),
    onSuccess: () => {
      toast.success('Health check aggiornato')
      queryClient.invalidateQueries({ queryKey: ['accounts-health'] })
    },
  })

  // Group accounts by provider category
  const groupedAccounts = useMemo(() => {
    const acc = accounts.data?.accounts || []
    const provs = providers.data?.providers || []
    const groups: Record<string, typeof acc> = {}
    for (const a of acc) {
      const prov = provs.find((p: any) => p.id === a.providerId)
      const cat = prov?.category || 'text'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(a)
    }
    return groups
  }, [accounts.data, providers.data])

  const activeId = accounts.data?.activeId

  return (
    <div className="space-y-6 max-w-6xl pb-12">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-violet-400" />
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Account AI</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {accounts.data?.accounts.length || 0} account configurati ·{' '}
            {providers.data?.providers.length || 0} provider disponibili · matrix{' '}
            <code className="text-xs bg-muted/40 px-1 rounded">provider × mode</code>
          </p>
        </div>
        <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refreshHealthMut.mutate()}
                disabled={refreshHealthMut.isPending}
                className="gap-1.5"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', refreshHealthMut.isPending && 'animate-spin')} />
                Ricontrolla health
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="text-xs">Riesegue il health check per tutti gli account. Invalida la cache (60s) e controlla che CLI, env var e login siano attivi.</div>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={() => autodetectMut.mutate()}
                disabled={autodetectMut.isPending}
                className="gap-1.5"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', autodetectMut.isPending && 'animate-spin')} />
                Rileva di nuovo
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="text-xs">Scansiona il sistema per provider non ancora configurati (CLI in PATH, env var noti, login CLI esistenti) e propone di aggiungerli come account.</div>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="outline" onClick={() => setAddCustomOpen(true)} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Provider custom
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="text-xs">Aggiungi un provider AI non presente nel catalogo statico (es. Replicate, Anthropic Bedrock, aggregatore privato...).</div>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" onClick={() => setAddOpen(true)} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                Aggiungi account
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="text-xs">Crea un nuovo account: scegli provider + modo (Plan/API/CLI/Playwright) + config (chiave API o CLI).</div>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/accounts/task-types">
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Table className="w-3.5 h-3.5" />
                  Task-types
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <div className="text-xs">Tabella che mappa macro-task (coding, legal-writing, image-gen...) → account + modello. Cron e agenti la usano per auto-routing.</div>
            </TooltipContent>
          </Tooltip>
        </div>
        </TooltipProvider>
      </div>

      {accounts.isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Caricamento account...
        </div>
      )}

      {accounts.data?.accounts.length === 0 && !accounts.isLoading && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <Sparkles className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
            <div className="text-sm text-muted-foreground">
              Nessun account configurato. Inizia con un autodetect per rilevare provider già installati
              sul sistema.
            </div>
            <Button onClick={() => autodetectMut.mutate()} className="gap-1.5">
              <RefreshCw className="w-4 h-4" />
              Avvia autodetect
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Account groups per category */}
      {Object.entries(groupedAccounts).map(([cat, accs]) => (
        <section key={cat} className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
              {cat}
            </h2>
            <span className="text-xs text-muted-foreground">{accs.length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {accs.map((a) => {
              const h = healthById.get(a.id) as any
              const isActive = a.id === activeId
              const Icon = MODE_ICONS[a.mode] || Cpu
              return (
                <Card
                  key={a.id}
                  className={cn(
                    'transition-all',
                    isActive && 'border-primary/50 shadow-[0_0_15px_rgba(139,92,246,0.15)]',
                    CATEGORY_COLORS[cat] || ''
                  )}
                >
                  <CardContent className="py-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <h3 className="font-semibold text-sm truncate">{a.label}</h3>
                          {isActive && (
                            <Badge variant="default" className="text-[9px] h-4 px-1.5">
                              attivo
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground flex-wrap">
                          {/* V14: chip Target — cliccabile per riconfigurare */}
                          <button
                            type="button"
                            onClick={() =>
                              setTargetSelectorFor({
                                id: a.id,
                                label: a.label,
                                cliName: a.cliName || 'claude',
                                mode: a.mode,
                                currentTarget: a.target as any,
                              })
                            }
                            className={cn(
                              'inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border transition-colors',
                              !a.target
                                ? 'border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20'
                                : a.target === 'local'
                                ? 'border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20'
                                : 'border-violet-500/40 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25'
                            )}
                            title={
                              !a.target
                                ? 'Target non configurato — clicca per scegliere'
                                : `Target attuale: ${resolveTargetLabel(a.target)} — clicca per cambiare`
                            }
                          >
                            {!a.target ? (
                              <HelpCircle className="w-2.5 h-2.5" />
                            ) : a.target === 'local' ? (
                              <Monitor className="w-2.5 h-2.5" />
                            ) : (
                              <Server className="w-2.5 h-2.5" />
                            )}
                            <span className="max-w-[100px] truncate">{resolveTargetLabel(a.target)}</span>
                            <Pencil className="w-2.5 h-2.5 opacity-60" />
                          </button>
                          <Badge
                            variant="outline"
                            className={cn('text-[9px] h-4 px-1.5 border', MODE_COLORS[a.mode])}
                          >
                            {MODE_LABELS[a.mode]}
                          </Badge>
                          <code className="bg-muted/50 px-1 rounded">{a.providerId}</code>
                        </div>
                      </div>
                      <HealthIcon health={h?.health || 'unknown'} />
                    </div>

                    {/* V13.3-T1: model rimosso — scegli runtime dal popup/session */}
                    {a.envVarRef && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        Env: <code className="bg-muted/40 px-1 rounded">{a.envVarRef}</code>
                      </div>
                    )}
                    {h?.message && h.health !== 'ready' && (
                      <div className="text-[10px] text-amber-400/80 break-words">⚠ {h.message}</div>
                    )}
                    {h?.cliVersion && (
                      <div className="text-[10px] text-emerald-400/70 truncate">
                        ✓ {h.cliVersion}
                      </div>
                    )}

                    {/* V13.3-T8a: Attivo su — mostra chip Local (se lastLocalUseAt) + chip per ogni VPS */}
                    {(() => {
                      const loc = locations.data?.get(a.id)
                      if (!loc) return null
                      const hasLocal = !!loc.local?.everUsed
                      const vpsList = loc.vps || []
                      if (!hasLocal && vpsList.length === 0) return null
                      return (
                        <div className="flex items-center gap-1 flex-wrap pt-1.5 border-t border-border/30">
                          <span className="text-[10px] text-muted-foreground shrink-0">Attivo su:</span>
                          {hasLocal && (
                            <TooltipProvider delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] h-4 px-1.5 bg-blue-500/20 border-blue-500/40 text-blue-300 cursor-default"
                                  >
                                    Local
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs">
                                  {loc.local?.lastLocalUseAt
                                    ? `Ultimo uso locale: ${new Date(loc.local.lastLocalUseAt).toLocaleString()}`
                                    : 'Usato in locale'}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {vpsList.map((v) => (
                            <TooltipProvider key={v.vpsId} delayDuration={300}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] h-4 px-1.5 bg-violet-500/20 border-violet-500/40 text-violet-300 cursor-default max-w-[120px] truncate"
                                  >
                                    {v.effectiveLabel}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent side="bottom" className="text-xs max-w-xs">
                                  <div className="font-semibold">{v.effectiveLabel}</div>
                                  <div className="text-muted-foreground">VPS ID: {v.vpsId}</div>
                                  {v.lastUsedAt && (
                                    <div className="text-muted-foreground">
                                      Ultimo uso: {new Date(v.lastUsedAt).toLocaleString()}
                                    </div>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ))}
                        </div>
                      )
                    })()}

                    <div className="flex items-center gap-1 pt-2 border-t border-border/50 flex-wrap">
                      {/* V14: bottone primary adattivo basato su (target, health) */}
                      {!a.target ? (
                        // 1. Target non configurato — chiama TargetSelectorDialog
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-8 text-xs border-violet-500/40 text-violet-200 bg-violet-500/10 hover:bg-violet-500/20 font-medium"
                          onClick={() =>
                            setTargetSelectorFor({
                              id: a.id,
                              label: a.label,
                              cliName: a.cliName || 'claude',
                              mode: a.mode,
                              currentTarget: a.target as any,
                            })
                          }
                          title="Scegli dove (Local o VPS) vuoi che viva il login di questo account"
                        >
                          <Server className="w-3.5 h-3.5" />
                          Configura target
                        </Button>
                      ) : h?.health === 'ready' && !isActive ? (
                        // 2. Target ok + loggato + non attivo — bottone Attiva
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 h-7 text-xs"
                          onClick={() => selectMut.mutate(a.id)}
                          disabled={selectMut.isPending}
                          title="Imposta come account attivo per nuovi spawn"
                        >
                          <Star className="w-3 h-3" />
                          Attiva
                        </Button>
                      ) : null}
                      {/* V14: bottone Login su target — visibile se target configurato MA non ready */}
                      {a.target && h?.health && h.health !== 'ready' && h.health !== 'not-installed' && a.cliName && (
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5 h-8 text-xs border-violet-500/40 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 font-medium"
                                onClick={() =>
                                  setLoginFor({
                                    id: a.id,
                                    label: a.label,
                                    cliName: a.cliName!,
                                    mode: a.mode,
                                    target: a.target,
                                    targetLabel: resolveTargetLabel(a.target),
                                  })
                                }
                              >
                                <TerminalIcon className="w-3.5 h-3.5" />
                                Login su {resolveTargetLabel(a.target)}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs">
                              <div className="text-xs">
                                Apre un popup con {a.cliName} su {resolveTargetLabel(a.target)} per completare il login
                                {a.target !== 'local' ? ' via SSH' : ''}.
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                      {/* V13.1: Set API key for API mode + not-configured */}
                      {a.mode === 'api' && a.envVarRef && h?.health === 'not-configured' && !h?.cliInstalled && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 h-7 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          onClick={() =>
                            setSetSecretFor({
                              id: a.id,
                              label: a.label,
                              envVarRef: a.envVarRef!,
                            })
                          }
                        >
                          <Key className="w-3 h-3" />
                          Inserisci key
                        </Button>
                      )}
                      {a.mode === 'api' && a.envVarRef && !h?.envVarSet && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 h-7 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                          onClick={() =>
                            setSetSecretFor({
                              id: a.id,
                              label: a.label,
                              envVarRef: a.envVarRef!,
                            })
                          }
                        >
                          <Key className="w-3 h-3" />
                          Inserisci key
                        </Button>
                      )}
                      {/* V13.1 T5: Install CLI for not-installed */}
                      {h?.health === 'not-installed' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1 h-7 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                          onClick={async () => {
                            try {
                              const r = await api.accounts.install(a.id)
                              if (r.opened) {
                                toast.success('Installazione avviata in nuova finestra CMD', {
                                  description: r.chain,
                                })
                              } else {
                                toast.error('Install non avviato')
                              }
                            } catch (err) {
                              toast.error('Errore install', { description: String(err) })
                            }
                          }}
                        >
                          <Download className="w-3 h-3" />
                          Installa
                        </Button>
                      )}
                      {/* V14: il bottone Login è ora nel blocco unificato sopra (target-aware) */}
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto h-7 text-muted-foreground hover:text-violet-300 hover:bg-violet-500/10"
                              onClick={() => {
                                setRenameFor({ id: a.id, currentLabel: a.label })
                                setRenameValue(a.label)
                              }}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            Rinomina account
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <TooltipProvider delayDuration={300}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-400/80 hover:text-red-300 hover:bg-red-500/10 h-7"
                              onClick={() => setDeletingId(a.id)}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="text-xs">
                            Elimina account
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </section>
      ))}

      {/* Add modals */}
      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} />
      <AddCustomProviderModal open={addCustomOpen} onClose={() => setAddCustomOpen(false)} />
      {setSecretFor && (
        <SetSecretDialog
          open={!!setSecretFor}
          onClose={() => setSetSecretFor(null)}
          accountId={setSecretFor.id}
          accountLabel={setSecretFor.label}
          envVarRef={setSecretFor.envVarRef}
        />
      )}
      {loginFor && (
        <AccountLoginDialog
          open={!!loginFor}
          onClose={() => setLoginFor(null)}
          accountId={loginFor.id}
          accountLabel={loginFor.label}
          cliName={loginFor.cliName}
          mode={loginFor.mode}
          target={loginFor.target}
          targetLabel={loginFor.targetLabel}
        />
      )}

      {/* V14: target selector */}
      {targetSelectorFor && (
        <TargetSelectorDialog
          open={!!targetSelectorFor}
          onClose={() => setTargetSelectorFor(null)}
          accountId={targetSelectorFor.id}
          accountLabel={targetSelectorFor.label}
          cliName={targetSelectorFor.cliName}
          currentTarget={targetSelectorFor.currentTarget}
          onLoginNeeded={(target) => {
            // Aperto automaticamente dopo configura → richiede login
            setLoginFor({
              id: targetSelectorFor.id,
              label: targetSelectorFor.label,
              cliName: targetSelectorFor.cliName,
              mode: targetSelectorFor.mode,
              target,
              targetLabel: resolveTargetLabel(target),
            })
          }}
        />
      )}

      {/* Rename account */}
      <Dialog
        open={!!renameFor}
        onOpenChange={(o) => {
          if (!o && !renameMut.isPending) {
            setRenameFor(null)
            setRenameValue('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-violet-400" />
              Rinomina account
            </DialogTitle>
            <DialogDescription>
              Cambia il nome visualizzato sulla card. Il provider e il mode rimangono invariati.
              Utile per distinguere più account dello stesso tipo (es. "Anthropic Plan Personal" vs
              "Anthropic Plan Cliente Herbalife").
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <FormLabel className="text-xs">Nuovo nome</FormLabel>
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={200}
              autoFocus
              placeholder="es. Anthropic Plan Personal"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameFor && renameValue.trim() && !renameMut.isPending) {
                  e.preventDefault()
                  renameMut.mutate({ id: renameFor.id, label: renameValue.trim() })
                }
              }}
            />
            <div className="text-[10px] text-muted-foreground flex justify-between">
              <span>{renameValue.length}/200 caratteri</span>
              {renameFor && renameValue.trim() === renameFor.currentLabel.trim() && (
                <span className="italic">Nessuna modifica</span>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setRenameFor(null)
                setRenameValue('')
              }}
              disabled={renameMut.isPending}
            >
              Annulla
            </Button>
            <Button
              size="sm"
              disabled={
                !renameFor ||
                !renameValue.trim() ||
                renameValue.trim() === renameFor.currentLabel.trim() ||
                renameMut.isPending
              }
              onClick={() => {
                if (renameFor && renameValue.trim()) {
                  renameMut.mutate({ id: renameFor.id, label: renameValue.trim() })
                }
              }}
              className="gap-1.5"
            >
              {renameMut.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Salvo…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Salva
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rimuovere account?</AlertDialogTitle>
            <AlertDialogDescription>
              L'account "{deletingId}" verrà rimosso. Nuove sessioni non potranno più usarlo. Config
              già generate (session Claude, ecc.) restano intatte.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => deletingId && removeMut.mutate(deletingId)}
            >
              Rimuovi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Autodetect results */}
      <AlertDialog open={showAutodetect} onOpenChange={setShowAutodetect}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Risultati autodetect</AlertDialogTitle>
            <AlertDialogDescription>
              {autodetectResults.length > 0
                ? `Rilevati ${autodetectResults.length} nuovi provider. Vuoi aggiungerli come account?`
                : 'Nessun nuovo provider rilevato.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {autodetectResults.length > 0 && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {autodetectResults.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 p-2 rounded border border-border text-xs"
                >
                  <Badge
                    variant="outline"
                    className={cn('text-[9px] h-4 px-1.5 border', MODE_COLORS[p.mode])}
                  >
                    {MODE_LABELS[p.mode]}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{p.suggestedLabel}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{p.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            {autodetectResults.length > 0 && (
              <AlertDialogAction onClick={() => applyAutodetectMut.mutate(autodetectResults)}>
                Aggiungi tutti
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
