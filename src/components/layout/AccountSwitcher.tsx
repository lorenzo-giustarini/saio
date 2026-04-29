import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  Settings,
  Sparkles,
  ChevronDown,
} from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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

function HealthDot({ health }: { health: string }) {
  if (health === 'ready') return <CheckCircle2 className="w-3 h-3 text-emerald-400" />
  if (health === 'not-configured') return <AlertCircle className="w-3 h-3 text-amber-400" />
  if (health === 'not-installed') return <XCircle className="w-3 h-3 text-red-400" />
  if (health === 'error') return <XCircle className="w-3 h-3 text-red-500" />
  return <div className="w-2 h-2 rounded-full bg-slate-500 inline-block" />
}

export function AccountSwitcher() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
    refetchInterval: 60_000,
  })

  const health = useQuery({
    queryKey: ['accounts-health'],
    queryFn: () => api.accounts.healthAll(),
    refetchInterval: 120_000,
  })

  const selectMut = useMutation({
    mutationFn: (id: string) => api.accounts.select(id),
    onSuccess: (_, id) => {
      toast.success('Account attivo aggiornato')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-health'] })
      setOpen(false)
    },
    onError: (err) => toast.error('Errore switch account', { description: String(err) }),
  })

  const activeAccount = accounts.data?.accounts.find((a) => a.id === accounts.data?.activeId) || null
  const healthById = new Map((health.data?.results || []).map((r: any) => [r.accountId, r]))

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 h-10 px-3 min-w-[2.5rem]"
          aria-label="Account AI attivo"
        >
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          {accounts.isLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : activeAccount ? (
            <>
              <span className="text-xs font-medium">{activeAccount.label.split(' ')[0]}</span>
              <Badge
                variant="outline"
                className={cn('text-[9px] h-4 px-1.5 border', MODE_COLORS[activeAccount.mode])}
              >
                {MODE_LABELS[activeAccount.mode]}
              </Badge>
              <HealthDot health={healthById.get(activeAccount.id)?.health || 'unknown'} />
            </>
          ) : (
            <span className="text-xs text-muted-foreground">Nessun account</span>
          )}
          <ChevronDown className="w-3 h-3 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1.5rem)] p-2">
        {/* V13.3-T2: rimosso "Gestisci" in header — link unico in footer */}
        <div className="px-2 py-1.5 border-b border-border mb-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Account AI
          </span>
        </div>

        {accounts.isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-4 justify-center text-xs">
            <Loader2 className="w-3 h-3 animate-spin" />
            Caricamento...
          </div>
        )}

        {accounts.data?.accounts.length === 0 && !accounts.isLoading && (
          <div className="text-xs text-muted-foreground py-6 text-center">
            Nessun account configurato.
            <br />
            <Link to="/accounts" onClick={() => setOpen(false)} className="text-primary hover:underline">
              Aggiungi il primo →
            </Link>
          </div>
        )}

        <div className="space-y-0.5 max-h-80 overflow-y-auto scrollbar-thin">
          {accounts.data?.accounts.map((acc) => {
            const isActive = acc.id === accounts.data.activeId
            const h = healthById.get(acc.id)
            return (
              <button
                key={acc.id}
                onClick={() => selectMut.mutate(acc.id)}
                disabled={isActive || selectMut.isPending}
                className={cn(
                  'w-full text-left flex items-center gap-2 px-2 py-2 rounded-md text-xs transition-colors',
                  isActive
                    ? 'bg-primary/15 border border-primary/40'
                    : 'hover:bg-accent hover:translate-x-0.5 transition-all cursor-pointer'
                )}
              >
                <HealthDot health={h?.health || 'unknown'} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn('font-medium truncate', isActive && 'text-primary')}>
                      {acc.label}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn('text-[9px] h-4 px-1.5 border shrink-0', MODE_COLORS[acc.mode])}
                    >
                      {MODE_LABELS[acc.mode]}
                    </Badge>
                  </div>
                  {acc.defaultModel && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {acc.defaultModel}
                    </div>
                  )}
                  {h?.message && h.health !== 'ready' && (
                    <div className="text-[10px] text-amber-400/80 truncate mt-0.5">
                      ⚠ {h.message}
                    </div>
                  )}
                </div>
                {isActive && (
                  <Badge variant="default" className="text-[9px] h-4 shrink-0">
                    attivo
                  </Badge>
                )}
              </button>
            )
          })}
        </div>

        <div className="pt-2 mt-2 border-t border-border">
          <Link to="/accounts" onClick={() => setOpen(false)}>
            <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs h-8">
              <Settings className="w-3 h-3" />
              Tutti gli account & task-types
            </Button>
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  )
}
