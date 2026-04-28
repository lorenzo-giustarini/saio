import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Server, Activity, HardDrive, Cpu, MemoryStick, Network, Box, Terminal,
  CheckCircle2, XCircle, Loader2, ChevronDown, ChevronUp, AlertTriangle, Info, Pencil, Copy, Plus, MoreVertical, Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import { AddVpsWizard } from './AddVpsWizard'

interface VpsHost {
  id: string
  ip: string
  hostname?: string
  label: string
  category: string
  keyName?: string
  // V13.3-T8: enriched fields from /api/vps
  effectiveLabel?: string
  userLabel?: string
  usedByAccounts?: string[]
}

interface VpsStats {
  id: string
  ip: string
  online: boolean
  fetchedAt: string
  cached?: boolean
  error?: string
  errorType?: 'auth-failed' | 'unreachable' | 'unknown' // V14.28 Step 1
  uptime?: string
  load?: { one: number; five: number; fifteen: number }
  memory?: { totalMB: number; usedMB: number; freeMB: number; cachedMB: number; usedPct: number }
  swap?: { totalMB: number; usedMB: number }
  disks?: Array<{ mount: string; size: string; used: string; avail: string; usePct: number; inodesPct: number }>
  cpu?: { user: number; system: number; idle: number; iowait: number }
  network?: Array<{ iface: string; rxBytes: number; txBytes: number }>
  docker?: { count: number; containers: Array<{ name: string; status: string; image: string; cpuPct?: number; memPct?: number }> }
  topProcs?: Array<{ cpu: number; mem: number; cmd: string }>
  kernel?: string
  label?: string
  hostname?: string
}

async function fetchHosts() {
  // V13.3-T8: usa endpoint arricchito con userLabel + usedByAccounts
  const res = await fetch('/api/vps')
  const data = await res.json()
  // Mappa shape {vps: [...]} → {hosts: [...]} per compat
  return { hosts: (data.vps || []) as VpsHost[] }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)}GB`
  return `${(bytes / 1024 ** 4).toFixed(2)}TB`
}

function pctColor(pct: number): string {
  if (pct >= 90) return 'text-red-400'
  if (pct >= 75) return 'text-amber-400'
  return 'text-emerald-400'
}

export function VpsMonitor() {
  const hostsQ = useQuery({ queryKey: ['vps', 'list'], queryFn: fetchHosts, staleTime: 300_000 })
  const [showAll, setShowAll] = useState(false)
  const [selectedVpsId, setSelectedVpsId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false) // V14.28 — wizard

  const allHosts = hostsQ.data?.hosts || []
  const displayedHosts = selectedVpsId
    ? allHosts.filter((h) => h.id === selectedVpsId)
    : showAll ? allHosts : allHosts.slice(0, 3)
  const hiddenCount = allHosts.length - displayedHosts.length

  return (
    <Card className="col-span-full neon-card-amber">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Server className="w-4 h-4 text-amber-400" />
          <h3 className="font-semibold text-sm">VPS Monitoring</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="text-xs space-y-1">
                  <div>Probe SSH per ogni VPS: uptime, RAM, disk, CPU, docker, traffico.</div>
                  <div className="text-muted-foreground text-[10px]">Cache 30s per non sovraccaricare i server. Click VPS per dettagli espandibili.</div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {allHosts.length > 3 && (
            <select
              value={selectedVpsId || ''}
              onChange={(e) => setSelectedVpsId(e.target.value || null)}
              className="text-xs bg-muted border border-border rounded px-2 py-0.5 h-6"
            >
              <option value="">Tutti</option>
              {allHosts.map((h) => (
                <option key={h.id} value={h.id}>{h.ip} ({h.label.slice(0, 30)})</option>
              ))}
            </select>
          )}
          {hostsQ.data && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {displayedHosts.length} di {allHosts.length} · cache 30s
            </span>
          )}
          {/* V14.28 — bottone Aggiungi VPS */}
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-7 text-xs"
            onClick={() => setAddOpen(true)}
            title="Aggiungi nuova VPS"
          >
            <Plus className="w-3 h-3" /> Aggiungi VPS
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {displayedHosts.map((h) => (
          <VpsCard key={h.id} host={h} />
        ))}
        {allHosts.length === 0 && (
          <div className="text-center py-8 text-xs text-muted-foreground">
            Nessuna VPS configurata. Click <strong>+ Aggiungi VPS</strong> per registrarne una.
          </div>
        )}
        {hiddenCount > 0 && !showAll && !selectedVpsId && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAll(true)}>
            Mostra altri {hiddenCount} VPS
          </Button>
        )}
        {showAll && allHosts.length > 3 && (
          <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowAll(false)}>
            Riduci lista
          </Button>
        )}
      </CardContent>
      {/* V14.28 — wizard add VPS */}
      <AddVpsWizard open={addOpen} onClose={() => setAddOpen(false)} />
    </Card>
  )
}

const DOCKER_IMAGE_DESCRIPTIONS: Record<string, string> = {
  coolify: 'Hosting self-managed (admin dashboard)',
  'coolify-proxy': 'Traefik reverse proxy SSL (80/443)',
  'coolify-db': 'Database Postgres di Coolify',
  'coolify-redis': 'Cache Redis di Coolify',
  'coolify-realtime': 'WebSocket realtime Coolify',
  'coolify-sentinel': 'Monitoring Coolify',
  n8n: 'n8n workflow automation engine',
  postgres: 'Database Postgres (workflow engine)',
  waha: 'WhatsApp HTTP API (per ZapLater)',
  browserless: 'Chromium headless per scraping',
  traefik: 'Reverse proxy routing HTTP',
}

function describeContainer(name: string, image: string): string {
  const lower = (name + ' ' + image).toLowerCase()
  for (const [key, desc] of Object.entries(DOCKER_IMAGE_DESCRIPTIONS)) {
    if (lower.includes(key)) return desc
  }
  return 'Container Docker'
}

function VpsCard({ host }: { host: VpsHost }) {
  const [expanded, setExpanded] = useState(false)
  const [dockerModal, setDockerModal] = useState(false)
  // V13.3-T8b: rename state
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const qc = useQueryClient()
  const displayLabel = host.effectiveLabel || host.label

  const statsQ = useQuery({
    queryKey: ['vps', 'stats', host.id],
    queryFn: async (): Promise<VpsStats> => {
      const res = await fetch(`/api/vps/${host.id}/stats`)
      return res.json()
    },
    refetchInterval: 45_000,
    staleTime: 30_000,
  })

  const openMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/vps/${host.id}/open-cmd`, { method: 'POST' })
      if (!res.ok) throw new Error((await res.json()).error || 'failed')
      return res.json()
    },
    onSuccess: (d: any) =>
      toast.success(`CMD aperto: ${d.title}`, {
        description: 'Digita `claude` dentro la finestra per sessione Claude sul VPS',
      }),
    onError: (e: any) => toast.error('Errore', { description: String(e) }),
  })

  // V13.3-T8b: rename mutation — PATCH /api/vps/:id
  const renameMut = useMutation({
    mutationFn: async (newLabel: string | null) =>
      api.vps.patch(host.id, { userLabel: newLabel }),
    onSuccess: () => {
      toast.success('Etichetta VPS aggiornata')
      qc.invalidateQueries({ queryKey: ['vps', 'list'] })
      qc.invalidateQueries({ queryKey: ['vps', 'stats', host.id] })
      qc.invalidateQueries({ queryKey: ['accounts-locations'] })
      setRenameOpen(false)
    },
    onError: (e: any) => toast.error('Errore rename', { description: String(e.message || e) }),
  })

  // V14.28 — remove VPS from registry
  const [removeOpen, setRemoveOpen] = useState(false)
  // V14.28 Step 1 — SSH key authorize help dialog
  const [sshHelpOpen, setSshHelpOpen] = useState(false)
  const removeMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/vps/${encodeURIComponent(host.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error || 'remove failed')
      return res.json()
    },
    onSuccess: () => {
      toast.success(`VPS "${displayLabel}" rimossa dal registro`)
      qc.invalidateQueries({ queryKey: ['vps', 'list'] })
      qc.invalidateQueries({ queryKey: ['accounts-locations'] })
      setRemoveOpen(false)
    },
    onError: (e: any) => toast.error('Errore remove', { description: String(e.message || e) }),
  })

  const openRename = () => {
    setRenameValue(host.userLabel || '')
    setRenameOpen(true)
  }

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (trimmed.length > 100) {
      toast.error('Etichetta troppo lunga (max 100 caratteri)')
      return
    }
    // Stringa vuota = reset a label hardcoded (passiamo null)
    renameMut.mutate(trimmed === '' ? null : trimmed)
  }

  const s = statsQ.data
  const online = s?.online

  return (
    <Card className={cn(
      'relative overflow-hidden',
      online ? 'neon-card-green' : s ? 'neon-card-red' : 'neon-card'
    )}>
      <CardContent className="pt-3 pb-3 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            {statsQ.isLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
            ) : online ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
            )}
            <div className="min-w-0">
              {/* V14.18 — Layout invertito: label dominante in alto, IP cliccabile a fianco, hostname sotto in piccolo */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm truncate">{displayLabel}</span>
                {host.userLabel && (
                  <span className="text-[9px] text-violet-300/70 border border-violet-500/30 rounded px-1 bg-violet-500/10">
                    custom
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    navigator.clipboard.writeText(host.ip).then(
                      () => toast.success(`IP copiato: ${host.ip}`, { duration: 1800 }),
                      () => toast.error('Copia IP fallita')
                    )
                  }}
                  className="font-mono text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded px-1.5 py-0.5 transition-colors flex items-center gap-1 cursor-pointer"
                  title="Click per copiare l'IP negli appunti"
                >
                  {host.ip}
                  <Copy className="w-2.5 h-2.5 opacity-60" />
                </button>
              </div>
              {host.hostname && (
                <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                  {host.hostname}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* V14.28 Step 1 — matita standalone rimossa, rinomina ora SOLO via kebab */}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs"
              onClick={() => openMut.mutate()}
              disabled={openMut.isPending}
            >
              <Terminal className="w-3 h-3" />
              Apri CMD
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setExpanded((v) => !v)}
              disabled={!online}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </Button>
            {/* V14.28 — kebab menu rimuovi VPS */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Altre azioni">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openRename} className="gap-2 text-xs">
                  <Pencil className="w-3.5 h-3.5" /> Rinomina etichetta…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setRemoveOpen(true)} className="gap-2 text-xs text-red-400 focus:text-red-300">
                  <Trash2 className="w-3.5 h-3.5" /> Rimuovi VPS dal registro…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Offline error */}
        {s && !online && (
          <div className="flex items-start gap-2 text-xs bg-red-500/10 rounded px-2 py-1.5 border border-red-500/20">
            <AlertTriangle className="w-3 h-3 text-red-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-red-300 font-medium">
                {s.errorType === 'auth-failed'
                  ? 'Chiave SSH non autorizzata su questa VPS'
                  : s.errorType === 'unreachable'
                  ? 'Server non raggiungibile (rete/spento)'
                  : 'Offline o errore probe'}
              </div>
              <div className="text-[10px] text-muted-foreground truncate">
                {s.error || 'errore probe'}
              </div>
              {s.errorType === 'auth-failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1.5 h-6 text-[10px] gap-1"
                  onClick={() => setSshHelpOpen(true)}
                >
                  Come autorizzare la chiave →
                </Button>
              )}
            </div>
          </div>
        )}
        {/* V14.28 Step 1 — Dialog istruzioni autorizzazione chiave SSH */}
        <SshKeyAuthorizeHelp
          open={sshHelpOpen}
          onClose={() => setSshHelpOpen(false)}
          host={host}
        />


        {/* Summary chips (always visible if online) */}
        {online && s && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {s.load && (
              <div className="rounded border border-border/50 bg-muted/20 p-2">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Activity className="w-2.5 h-2.5" /> Load</div>
                <div className="font-mono font-semibold">{s.load.one.toFixed(2)} <span className="text-muted-foreground text-[10px]">· {s.load.five.toFixed(2)} · {s.load.fifteen.toFixed(2)}</span></div>
              </div>
            )}
            {s.memory && (
              <div className="rounded border border-border/50 bg-muted/20 p-2">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><MemoryStick className="w-2.5 h-2.5" /> RAM</div>
                <div className={cn('font-mono font-semibold', pctColor(s.memory.usedPct))}>{s.memory.usedPct}%</div>
                <div className="text-[9px] text-muted-foreground">{s.memory.usedMB}/{s.memory.totalMB}MB</div>
              </div>
            )}
            {s.cpu && (
              <div className="rounded border border-border/50 bg-muted/20 p-2">
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Cpu className="w-2.5 h-2.5" /> CPU idle</div>
                <div className={cn('font-mono font-semibold', pctColor(100 - s.cpu.idle))}>{s.cpu.idle.toFixed(0)}%</div>
                <div className="text-[9px] text-muted-foreground">user {s.cpu.user.toFixed(0)}% · wa {s.cpu.iowait.toFixed(0)}%</div>
              </div>
            )}
            {s.docker && (
              <button
                onClick={() => setDockerModal(true)}
                className="rounded border border-border/50 bg-muted/20 p-2 hover:bg-accent hover:border-primary/40 transition-all text-left cursor-pointer"
              >
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground"><Box className="w-2.5 h-2.5" /> Docker</div>
                <div className="font-mono font-semibold">{s.docker.count}</div>
                <div className="text-[9px] text-primary">click per lista →</div>
              </button>
            )}
          </div>
        )}

        {/* Expanded details */}
        {expanded && online && s && (
          <div className="pt-2 space-y-3 text-xs border-t border-border/50">
            {s.uptime && (
              <div className="flex items-center gap-2">
                <Activity className="w-3 h-3 text-muted-foreground" />
                <span className="text-muted-foreground">Uptime:</span>
                <span className="font-mono">{s.uptime}</span>
                {s.kernel && <span className="ml-auto text-[10px] text-muted-foreground font-mono">{s.kernel}</span>}
              </div>
            )}

            {s.memory && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Memoria</div>
                <Progress value={s.memory.usedPct} className="h-2" />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
                  <span>{s.memory.usedMB}MB usata</span>
                  <span>{s.memory.freeMB}MB free · {s.memory.cachedMB}MB cached</span>
                  <span>{s.memory.totalMB}MB total</span>
                </div>
                {s.swap && s.swap.totalMB > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-0.5">Swap: {s.swap.usedMB}/{s.swap.totalMB}MB</div>
                )}
              </div>
            )}

            {s.disks && s.disks.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                  <HardDrive className="w-3 h-3" /> Dischi
                </div>
                <div className="space-y-1.5">
                  {s.disks.filter((d) => !d.mount.startsWith('/sys') && !d.mount.startsWith('/proc') && !d.mount.startsWith('/run')).slice(0, 6).map((d) => (
                    <div key={d.mount}>
                      <div className="flex items-center justify-between text-[10px]">
                        <code className="font-mono">{d.mount}</code>
                        <span className="text-muted-foreground">{d.used}/{d.size}</span>
                        <span className={pctColor(d.usePct)}>{d.usePct}%</span>
                      </div>
                      <Progress value={d.usePct} className="h-1" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s.network && s.network.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                  <Network className="w-3 h-3" /> Traffico cumulativo
                </div>
                <div className="space-y-0.5">
                  {s.network.slice(0, 4).map((n) => (
                    <div key={n.iface} className="flex items-center gap-3 text-[10px] font-mono">
                      <span className="w-10 text-muted-foreground">{n.iface}</span>
                      <span className="text-emerald-400">↓ {formatBytes(n.rxBytes)}</span>
                      <span className="text-blue-400">↑ {formatBytes(n.txBytes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {s.docker && s.docker.containers.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
                  <Box className="w-3 h-3" /> Container
                </div>
                <div className="space-y-0.5 max-h-40 overflow-auto scrollbar-thin">
                  {s.docker.containers.map((c) => {
                    const isUp = c.status.toLowerCase().startsWith('up')
                    return (
                      <div key={c.name} className="flex items-center gap-2 text-[10px] font-mono">
                        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', isUp ? 'bg-emerald-500' : 'bg-red-500')} />
                        <code className="truncate flex-1" title={c.name}>{c.name}</code>
                        {c.cpuPct !== undefined && (
                          <span className={pctColor(c.cpuPct)}>{c.cpuPct.toFixed(1)}%</span>
                        )}
                        {c.memPct !== undefined && (
                          <span className="text-muted-foreground">{c.memPct.toFixed(1)}%m</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {s.topProcs && s.topProcs.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Top processi</div>
                <div className="space-y-0.5">
                  {s.topProcs.slice(0, 4).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className={cn('w-10', pctColor(p.cpu))}>{p.cpu.toFixed(1)}%</span>
                      <span className="w-10 text-muted-foreground">{p.mem.toFixed(1)}%m</span>
                      <code className="truncate flex-1">{p.cmd}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="text-[9px] text-muted-foreground text-right">
              Ultimo probe: {new Date(s.fetchedAt).toLocaleTimeString('it-IT')} {s.cached && '(cache)'}
            </div>
          </div>
        )}
      </CardContent>

      {/* V13.3-T8b: rename modal */}
      <Dialog open={renameOpen} onOpenChange={(o) => !o && setRenameOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-violet-400" />
              Rinomina VPS <code className="text-xs font-mono text-muted-foreground ml-1">{host.id}</code>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Etichetta custom visibile in tutte le card account e nelle liste VPS.
              Lascia vuoto per tornare al nome di default (<code className="text-[10px]">{host.label}</code>).
              <br />
              Caratteri consentiti: lettere, numeri, spazi e <code>- _ . , : ( ) ' " &amp;</code> · max 100 char
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="es. Cliente Herbalife Prod"
              maxLength={100}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !renameMut.isPending) handleRenameSubmit()
              }}
            />
            <div className="text-[10px] text-muted-foreground mt-1 flex justify-between">
              <span>IP: <code className="font-mono">{host.ip}</code></span>
              <span>{renameValue.length}/100</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRenameOpen(false)}
              disabled={renameMut.isPending}
            >
              Annulla
            </Button>
            <Button
              size="sm"
              onClick={handleRenameSubmit}
              disabled={renameMut.isPending}
              className="gap-1.5"
            >
              {renameMut.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Pencil className="w-3.5 h-3.5" />
              )}
              Salva etichetta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Docker containers modal */}
      {s?.docker && (
        <Dialog open={dockerModal} onOpenChange={setDockerModal}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Box className="w-5 h-5 text-blue-400" />
                Docker containers — {host.ip}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {s.docker.count} container attivi su {host.label}
              </DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[60vh] pr-3">
              <div className="space-y-1.5">
                {s.docker.containers.map((c) => {
                  const isUp = c.status.toLowerCase().startsWith('up')
                  return (
                    <div key={c.name} className="flex items-start gap-2 py-2 px-3 rounded-md border border-border/40 bg-card/30 hover:bg-accent transition-colors">
                      <span className={cn('w-2 h-2 rounded-full shrink-0 mt-1.5', isUp ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-red-500')} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <code className="text-xs font-semibold font-mono">{c.name}</code>
                          {c.cpuPct !== undefined && (
                            <span className={cn('text-[10px]', pctColor(c.cpuPct))}>CPU {c.cpuPct.toFixed(1)}%</span>
                          )}
                          {c.memPct !== undefined && (
                            <span className="text-[10px] text-muted-foreground">MEM {c.memPct.toFixed(1)}%</span>
                          )}
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {describeContainer(c.name, c.image)}
                        </div>
                        <div className="text-[10px] text-muted-foreground/60 mt-0.5 font-mono truncate">
                          {c.image} · {c.status}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>
      )}
      {/* V14.28 — AlertDialog conferma rimozione VPS */}
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rimuovere "{displayLabel}" dal registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per cancellare la VPS <strong>{host.id}</strong> ({host.ip}) dal registro della dashboard.
              <br /><br />
              <strong>Cosa NON viene cancellato</strong>:
              <br />• Il server reale (rimane attivo presso il provider)
              <br />• La chiave SSH in <code>~/.ssh/{host.keyName}</code>
              <br /><br />
              <strong>Cosa viene rimosso</strong>: la VPS sparisce dalla lista, dal monitoring e dai cron multi-VPS.
              Puoi ri-aggiungerla in qualsiasi momento dal wizard.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMut.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => removeMut.mutate()}
              disabled={removeMut.isPending}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              {removeMut.isPending ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Rimuovendo…</> : 'Rimuovi dal registro'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

/**
 * V14.28 Step 1 — Dialog "Come autorizzare la chiave SSH"
 * Fetcha /api/vps/:id/public-key e mostra 2 comandi copyable per autorizzare
 * la chiave pubblica della dashboard sulla VPS che dà "permission denied".
 */
function SshKeyAuthorizeHelp({
  open,
  onClose,
  host,
}: {
  open: boolean
  onClose: () => void
  host: VpsHost
}) {
  const pubKeyQ = useQuery({
    queryKey: ['vps', 'public-key', host.id],
    queryFn: async () => {
      const res = await fetch(`/api/vps/${encodeURIComponent(host.id)}/public-key`)
      if (!res.ok) throw new Error((await res.json()).error || 'failed')
      return res.json() as Promise<{ publicKey: string; publicKeyPath: string; keyName: string; ip: string }>
    },
    enabled: open,
    staleTime: 60_000,
  })

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copiato negli appunti`),
      () => toast.error('Copia fallita')
    )
  }

  if (!pubKeyQ.data && !pubKeyQ.isLoading) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Errore lettura chiave pubblica</DialogTitle>
          </DialogHeader>
          <div className="text-xs text-red-300">{(pubKeyQ.error as any)?.message || 'errore'}</div>
        </DialogContent>
      </Dialog>
    )
  }

  const keyName = pubKeyQ.data?.keyName || host.keyName || ''
  const pubKey = pubKeyQ.data?.publicKey || '...'
  const ip = pubKeyQ.data?.ip || host.ip
  const cmd1 = `ssh-copy-id -i ~/.ssh/${keyName}.pub root@${ip}`
  const cmd2 = `echo '${pubKey}' >> ~/.ssh/authorized_keys`

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Autorizza la chiave SSH della dashboard su questa VPS</DialogTitle>
          <DialogDescription>
            La chiave pubblica della dashboard NON è autorizzata su <code>{ip}</code>. Hai 2 modi rapidi per autorizzarla.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-emerald-300">Opzione 1 — se hai accesso via password alla VPS</div>
            <div className="flex items-center gap-2 bg-black/40 p-2 rounded font-mono text-[11px] border border-border/50">
              <code className="flex-1 break-all">{cmd1}</code>
              <Button size="sm" variant="ghost" className="h-6 gap-1" onClick={() => copy(cmd1, 'Comando ssh-copy-id')}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Esegui da PowerShell/Terminale. Ti chiederà la password della VPS una sola volta, poi non più.
            </p>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-amber-300">Opzione 2 — se accedi tramite console del provider (Hetzner, DigitalOcean, ecc.)</div>
            <p className="text-[10px] text-muted-foreground">
              Apri la console del provider, collegati come root, poi incolla questo comando:
            </p>
            <div className="flex items-start gap-2 bg-black/40 p-2 rounded font-mono text-[10px] border border-border/50">
              <code className="flex-1 break-all whitespace-pre-wrap">{cmd2}</code>
              <Button size="sm" variant="ghost" className="h-6 gap-1 shrink-0" onClick={() => copy(cmd2, 'Comando completo')}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground">Solo la chiave pubblica (per copia/incolla manuale in pannelli web)</div>
            <div className="flex items-start gap-2 bg-black/40 p-2 rounded font-mono text-[10px] border border-border/50">
              <code className="flex-1 break-all whitespace-pre-wrap">{pubKey}</code>
              <Button size="sm" variant="ghost" className="h-6 gap-1 shrink-0" onClick={() => copy(pubKey, 'Chiave pubblica')}>
                <Copy className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Chiudi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
