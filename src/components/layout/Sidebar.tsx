import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useMe, useLogout } from '@/hooks/useAuth'
import { LogOut, UserCog, Globe, ScanLine } from 'lucide-react'
import { CloudflareSetupWizard } from '@/components/onboarding/CloudflareSetupWizard'
import { AutoScanWizard } from '@/components/onboarding/AutoScanWizard'
import { PtySessionsDialog } from '@/components/dialogs/PtySessionsDialog'
import {
  Inbox,
  ListChecks,
  FolderKanban,
  Archive,
  BarChart3,
  Wand2,
  BookOpen,
  Clock,
  Microscope,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SaioLogo } from '@/components/brand/SaioLogo'
import { SaioIcon } from '@/components/brand/SaioLogo'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

// V15.0 WS3-3F — Real orchestrator health check
interface OrchestratorHealth {
  status: 'up' | 'stale' | 'down' | 'unknown'
  pid?: number
  lastHeartbeat?: string
  ageSeconds?: number
  uptime?: number
  reason?: string
  hint?: string
}

async function fetchOrchestratorHealth(): Promise<OrchestratorHealth> {
  try {
    const res = await fetch('/api/orchestrator/health')
    if (!res.ok) return { status: 'unknown', reason: `HTTP ${res.status}` }
    return res.json()
  } catch (e: any) {
    return { status: 'down', reason: e?.message || 'fetch failed' }
  }
}

// V15.0 WS21 — PTY sessions list (separato dall'orchestrator per chiarezza)
interface PtySessionInfo {
  projectId: string
  pid?: number
  startedAt?: string
}
async function fetchPtySessions(): Promise<{ sessions: PtySessionInfo[] }> {
  try {
    const res = await fetch('/api/pty/sessions', { credentials: 'include' })
    if (!res.ok) return { sessions: [] }
    return res.json()
  } catch {
    return { sessions: [] }
  }
}

const navItems = [
  { to: '/inbox', i18nKey: 'sidebar.inbox', icon: Inbox, badge: true },
  { to: '/tasks', i18nKey: 'sidebar.tasks', icon: ListChecks },
  { to: '/projects', i18nKey: 'sidebar.projects', icon: FolderKanban },
  { to: '/docs', i18nKey: 'sidebar.docs', icon: BookOpen },
  { to: '/deep-research', i18nKey: 'sidebar.deep_research', icon: Microscope },
  { to: '/cron', i18nKey: 'sidebar.automations', icon: Clock },
  { to: '/archive', i18nKey: 'sidebar.archive', icon: Archive },
  { to: '/metrics', i18nKey: 'sidebar.metrics', icon: BarChart3 },
  { to: '/extras', i18nKey: 'sidebar.extras', icon: Wand2 },
] as const

const COLLAPSE_KEY = 'saio-sidebar-collapsed'

export function Sidebar() {
  const { t } = useTranslation('nav')
  // V14.19 — collapsible desktop con persistenza localStorage
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true'
    } catch {
      return false
    }
  })
  // V14.20 — usiamo useLocation per computare isActive manualmente.
  // Motivo: NavLink callback `className={({isActive}) => ...}` non viene valutata
  // quando il NavLink è child di Radix `<TooltipTrigger asChild>` (la funzione viene
  // toString-ata e concatenata come letterale nel className DOM). Workaround: passiamo
  // una stringa statica calcolata con isActive derivato da location.pathname.
  const location = useLocation()

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed))
    } catch { /* ignore */ }
  }, [collapsed])

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          'border-r border-border bg-gradient-to-b from-card/60 to-card/30 flex flex-col relative transition-all duration-200 h-full',
          collapsed ? 'w-14' : 'w-60'
        )}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-purple-500/5 pointer-events-none" />

        {/* V15.0 WS26 — Container scrollabile UNICO: header + nav + bottom items.
            Solo Planner + PTY restano fissi nel footer sotto. Scrollbar viola minimale. */}
        <div className="flex-1 overflow-y-auto scrollbar-violet flex flex-col relative min-h-0">
          {/* Header logo (resta in alto durante lo scroll perché è il primo elemento) */}
          <div className={cn('h-14 flex items-center border-b border-border shrink-0', collapsed ? 'justify-center px-2' : 'px-5')}>
            {collapsed ? (
              <SaioIcon size={28} />
            ) : (
              <SaioLogo iconSize={28} wordmarkSize="md" />
            )}
          </div>

          {/* Nav items principali */}
          <nav className={cn('py-4 space-y-1 relative', collapsed ? 'px-2' : 'px-3')}>
            {navItems.map(item => {
              // V14.20 — isActive computato qui (non via NavLink callback) per compat con Radix asChild
              const isActive = location.pathname === item.to || location.pathname.startsWith(item.to + '/')
              const linkClass = cn(
                'flex items-center gap-3 rounded-md text-sm transition-all relative',
                'hover:bg-accent hover:text-accent-foreground',
                !collapsed && 'hover:translate-x-0.5 px-3 py-2',
                collapsed && 'justify-center p-2',
                // V14.20 — active state minimale in collapsed (no linguetta border/gradient/shadow)
                isActive
                  ? collapsed
                    ? 'bg-primary/15 text-primary'
                    : 'bg-gradient-to-r from-primary/15 to-primary/5 text-foreground font-medium border-l-2 border-primary shadow-[inset_0_0_20px_rgba(255,255,255,0.04)]'
                  : collapsed
                  ? 'text-muted-foreground'
                  : 'text-muted-foreground border-l-2 border-transparent'
              )
              const label = t(item.i18nKey)
              const link = (
                <NavLink to={item.to} className={linkClass}>
                  <item.icon className="w-4 h-4 shrink-0" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </NavLink>
              )
              if (collapsed) {
                return (
                  <Tooltip key={item.to}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right" className="text-xs">
                      {label}
                    </TooltipContent>
                  </Tooltip>
                )
              }
              return <div key={item.to}>{link}</div>
            })}
          </nav>

          {/* Bottom items (Toggle + OwnerAccess + AutoScan + Cloudflare + Logout)
              dentro lo stesso container scrollabile. mt-auto li spinge in fondo se c'è spazio. */}
          <div className={cn('border-t border-border relative mt-auto', collapsed ? 'p-2 space-y-2' : 'p-3 space-y-2')}>
            {/* Toggle collapse/expand */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => !c)}
                  className={cn(
                    'w-full flex items-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
                    collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'
                  )}
                >
                  {collapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
                  {!collapsed && <span>Riduci sidebar</span>}
                </button>
              </TooltipTrigger>
              {collapsed && (
                <TooltipContent side="right" className="text-xs">
                  Espandi sidebar
                </TooltipContent>
              )}
            </Tooltip>

            {/* V15.0 WS3-3H — Owner-only Access settings */}
            <OwnerAccessNav collapsed={collapsed} />

            {/* V15.0 WS13 — Autoscan filesystem + import progetti */}
            <AutoScanNav collapsed={collapsed} />

            {/* V15.0 WS11 — Cloudflare Tunnel setup nav */}
            <CloudflareNav collapsed={collapsed} />

            {/* V15.0 WS3-3C — Logout */}
            <LogoutNav collapsed={collapsed} />
          </div>
        </div>

        {/* V15.0 WS26 — Footer FISSO con SOLO Planner + Sessioni PTY (sempre visibili) */}
        <div className={cn('border-t border-border relative shrink-0 backdrop-blur-sm bg-card/40', collapsed ? 'p-2 space-y-2' : 'p-3 space-y-2')}>
          {/* Orchestrator status — V15.0 WS3-3F vero check (ribrandato Planner in WS21) */}
          <OrchestratorStatusIndicator collapsed={collapsed} />

          {/* V15.0 WS21 — PTY sessions live (separato dal Planner per chiarezza) */}
          <PtySessionsIndicator collapsed={collapsed} />
        </div>
      </aside>
    </TooltipProvider>
  )
}

// V15.0 WS3-3F — Real-time orchestrator health indicator
function OrchestratorStatusIndicator({ collapsed }: { collapsed: boolean }) {
  const { data } = useQuery({
    queryKey: ['orchestrator', 'health'],
    queryFn: fetchOrchestratorHealth,
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  const status = data?.status || 'unknown'
  // V15.0 WS21 — Down è normal-state per planner on-demand. Coloro ambra invece di rosso
  // per non allarmare. Rosso solo per casi anomali (es. errore ts ma file presente).
  const colorMap = {
    up: { bg: 'bg-emerald-500', shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.7)]', border: 'border-emerald-500/20', from: 'from-emerald-500/10', label: 'In esecuzione' },
    stale: { bg: 'bg-amber-500', shadow: 'shadow-[0_0_6px_rgba(245,158,11,0.7)]', border: 'border-amber-500/20', from: 'from-amber-500/10', label: 'Stale (>90s)' },
    down: { bg: 'bg-slate-500', shadow: '', border: 'border-slate-500/20', from: 'from-slate-500/10', label: 'Idle (on-demand)' },
    unknown: { bg: 'bg-slate-500', shadow: '', border: 'border-slate-500/20', from: 'from-slate-500/10', label: 'Sconosciuto' },
  } as const
  const c = colorMap[status]

  const tooltipDetail = data ? (
    <>
      <div className="font-medium">Planner Python: {c.label}</div>
      <div className="text-[10px] text-muted-foreground mt-1 max-w-[220px]">
        Script Python che parte on-demand quando rispondi a un brief decision.
        "Idle" è normale: significa nessun planning in corso.
      </div>
      {data.pid && <div className="text-muted-foreground mt-1">PID: {data.pid}</div>}
      {data.lastHeartbeat && <div className="text-muted-foreground">Last: {new Date(data.lastHeartbeat).toLocaleTimeString()}</div>}
      {data.ageSeconds !== undefined && <div className="text-muted-foreground">Age: {data.ageSeconds}s</div>}
      {data.uptime !== undefined && <div className="text-muted-foreground">Uptime: {Math.round(data.uptime)}s</div>}
      {data.hint && <div className="text-amber-300 mt-1">{data.hint}</div>}
      {data.reason && status !== 'down' && <div className="text-red-300 mt-1">{data.reason}</div>}
    </>
  ) : (
    <div className="font-medium">Planner Python: caricamento…</div>
  )

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn('flex items-center justify-center p-2 rounded-md bg-gradient-to-br to-transparent border', c.from, c.border)}>
            <span className={cn('w-2 h-2 rounded-full', c.bg, c.shadow)} />
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          {tooltipDetail}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('rounded-md bg-gradient-to-br to-transparent border p-3 text-xs space-y-1 cursor-help', c.from, c.border)}>
          <div className="flex items-center gap-1.5">
            <span className={cn('w-2 h-2 rounded-full', c.bg, c.shadow)} />
            <span className="font-medium text-foreground">Planner</span>
          </div>
          <div className="text-muted-foreground">
            {c.label}
            {data?.ageSeconds !== undefined && status === 'up' && ` · ${data.ageSeconds}s ago`}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {tooltipDetail}
      </TooltipContent>
    </Tooltip>
  )
}

// V15.0 WS21+WS22 — PTY sessions live indicator + dialog kill/manage on click.
// Mostra count di sessioni terminale Claude attive nei progetti. Verde pulsante
// se >0 sessioni live, grigio se zero. Click apre PtySessionsDialog per gestione.
function PtySessionsIndicator({ collapsed }: { collapsed: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data } = useQuery({
    queryKey: ['pty', 'sessions'],
    queryFn: fetchPtySessions,
    refetchInterval: 15_000,
    staleTime: 10_000,
  })
  const sessions = data?.sessions || []
  const count = sessions.length
  const active = count > 0
  const c = active
    ? { bg: 'bg-emerald-500', shadow: 'shadow-[0_0_6px_rgba(16,185,129,0.7)]', border: 'border-emerald-500/20', from: 'from-emerald-500/10', label: `${count} attiv${count === 1 ? 'a' : 'e'}` }
    : { bg: 'bg-slate-500', shadow: '', border: 'border-slate-500/20', from: 'from-slate-500/10', label: 'Nessuna' }

  const tooltipDetail = (
    <>
      <div className="font-medium">Sessioni PTY: {c.label}</div>
      <div className="text-[10px] text-muted-foreground mt-1 max-w-[220px]">
        Click per gestire (terminare singola o tutte). Indipendenti dal Planner.
      </div>
      {active && (
        <div className="mt-1 space-y-0.5">
          {sessions.slice(0, 5).map((s) => (
            <div key={s.projectId} className="text-[10px] text-emerald-200/80 font-mono">· {s.projectId}</div>
          ))}
          {sessions.length > 5 && (
            <div className="text-[10px] text-muted-foreground">+{sessions.length - 5} altre</div>
          )}
        </div>
      )}
    </>
  )

  return (
    <>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={cn(
                'flex items-center justify-center p-2 rounded-md bg-gradient-to-br to-transparent border w-full transition-all hover:brightness-125',
                c.from, c.border
              )}
            >
              <span className={cn('w-2 h-2 rounded-full', c.bg, c.shadow, active && 'animate-pulse')} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {tooltipDetail}
          </TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className={cn(
                'w-full text-left rounded-md bg-gradient-to-br to-transparent border p-3 text-xs space-y-1 cursor-pointer transition-all hover:brightness-125 hover:scale-[1.02]',
                c.from, c.border
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full', c.bg, c.shadow, active && 'animate-pulse')} />
                <span className="font-medium text-foreground">Sessioni PTY</span>
              </div>
              <div className="text-muted-foreground">{c.label} · click per gestire</div>
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {tooltipDetail}
          </TooltipContent>
        </Tooltip>
      )}
      <PtySessionsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}

// V15.0 WS3-3H — Owner-only Access nav item
function OwnerAccessNav({ collapsed }: { collapsed: boolean }) {
  const { data } = useMe()
  if (!data || data.role !== 'owner' || data.authBypass) return null
  const buttonClass = cn(
    'w-full flex items-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
    collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'
  )
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <NavLink to="/settings/access" className={buttonClass}>
            <UserCog className="w-4 h-4" />
          </NavLink>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          Access management
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <NavLink to="/settings/access" className={buttonClass}>
      <UserCog className="w-4 h-4" />
      <span>Access</span>
    </NavLink>
  )
}

// V15.0 WS13 — Autoscan filesystem nav
function AutoScanNav({ collapsed }: { collapsed: boolean }) {
  const { data } = useMe()
  const [open, setOpen] = useState(false)
  if (!data || data.authBypass) return null
  const buttonClass = cn(
    'w-full flex items-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
    collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'
  )
  const trigger = collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
          <ScanLine className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        Autoscan progetti
      </TooltipContent>
    </Tooltip>
  ) : (
    <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
      <ScanLine className="w-4 h-4" />
      <span>Autoscan progetti</span>
    </button>
  )
  return (
    <>
      {trigger}
      <AutoScanWizard open={open} onClose={() => setOpen(false)} />
    </>
  )
}

// V15.0 WS11 — Cloudflare Tunnel nav (apre wizard browser)
function CloudflareNav({ collapsed }: { collapsed: boolean }) {
  const { data } = useMe()
  const [open, setOpen] = useState(false)
  if (!data || data.authBypass) return null
  const buttonClass = cn(
    'w-full flex items-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
    collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'
  )
  const trigger = collapsed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
          <Globe className="w-4 h-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        Setup pubblico (Cloudflare)
      </TooltipContent>
    </Tooltip>
  ) : (
    <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
      <Globe className="w-4 h-4" />
      <span>Setup pubblico</span>
    </button>
  )
  return (
    <>
      {trigger}
      <CloudflareSetupWizard open={open} onClose={() => setOpen(false)} />
    </>
  )
}

// V15.0 WS3-3C — Logout button
function LogoutNav({ collapsed }: { collapsed: boolean }) {
  const { data } = useMe()
  const logout = useLogout()
  if (!data || data.authBypass) return null
  const buttonClass = cn(
    'w-full flex items-center rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
    collapsed ? 'justify-center p-2' : 'gap-2 px-3 py-2'
  )
  const handler = () => logout.mutate()
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={handler} className={buttonClass}>
            <LogOut className="w-4 h-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" className="text-xs">
          Logout ({data.email})
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <button type="button" onClick={handler} className={buttonClass}>
      <LogOut className="w-4 h-4" />
      <span className="truncate">Logout</span>
    </button>
  )
}
