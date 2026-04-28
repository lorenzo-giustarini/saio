/**
 * TargetSelectorDialog (V14)
 *
 * Dialog per scegliere il "target" di un account: Local oppure uno dei VPS conosciuti.
 * Mostra in tempo reale lo stato auth per ogni opzione (probe SSH parallelo).
 * Dopo PATCH del target, callback `onLoginNeeded` viene invocato se il target scelto
 * non risulta loggato → il caller apre AccountLoginDialog su quel target.
 */
import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Server,
  Monitor,
  AlertCircle,
  WifiOff,
  RefreshCw,
} from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface Props {
  open: boolean
  onClose: () => void
  accountId: string
  accountLabel: string
  cliName: string
  currentTarget: string | null | undefined
  /** Quando il target salvato non risulta loggato, il caller può aprire LoginDialog */
  onLoginNeeded: (target: string) => void
}

export function TargetSelectorDialog({
  open,
  onClose,
  accountId,
  accountLabel,
  cliName,
  currentTarget,
  onLoginNeeded,
}: Props) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<string>(currentTarget || 'local')
  const [refreshKey, setRefreshKey] = useState(0)

  // Reset selected on open
  useEffect(() => {
    if (open) setSelected(currentTarget || 'local')
  }, [open, currentTarget])

  // Locations + auth probe parallelo (richiede ~2s per VPS)
  const locations = useQuery({
    queryKey: ['accounts-locations-probe', accountId, refreshKey],
    queryFn: () => api.accounts.locations(accountId, { probeAuth: true }),
    enabled: open,
    staleTime: 0,
  })

  // Conta account totali per Local (per warning "X account già attivi su Local")
  const allAccounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
    enabled: open,
  })

  const localOtherCount = useMemo(() => {
    return (allAccounts.data?.accounts || []).filter(
      (a) => a.id !== accountId && a.target === 'local' && a.cliName === cliName
    ).length
  }, [allAccounts.data, accountId, cliName])

  const vpsOtherCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const a of allAccounts.data?.accounts || []) {
      if (a.id === accountId || !a.target || a.target === 'local') continue
      if (a.cliName !== cliName) continue
      map.set(a.target, (map.get(a.target) || 0) + 1)
    }
    return map
  }, [allAccounts.data, accountId, cliName])

  const updateMut = useMutation({
    mutationFn: (target: string) => api.accounts.update(accountId, { target } as any),
    onSuccess: async (_, target) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-health'] })
      queryClient.invalidateQueries({ queryKey: ['accounts-locations'] })

      // Probe target post-PATCH per decidere se serve login
      try {
        const probe = await api.accounts.probeTarget(accountId, target)
        const isAuth =
          target === 'local' ? probe.health === 'ready' : probe.authOk === true
        const isInstalled =
          target === 'local' ? probe.health !== 'not-installed' : probe.cliInstalled === true
        if (!isInstalled) {
          toast.warning(`CLI ${cliName} non installato su ${target}`, {
            description: target === 'local' ? 'Installa dal bottone "Installa" sulla card' : 'Devi installare il CLI sul VPS prima di procedere',
          })
          onClose()
          return
        }
        if (!isAuth) {
          toast.info(`Target ${target === 'local' ? 'Local' : target} configurato — richiede login`)
          onClose()
          onLoginNeeded(target)
          return
        }
        toast.success(`Account configurato su ${target === 'local' ? 'Local' : target} — già loggato`)
        onClose()
      } catch (err: any) {
        toast.error('Errore probe target', { description: String(err.message || err) })
        onClose()
      }
    },
    onError: (err) => toast.error('Errore configurazione target', { description: String(err) }),
  })

  const authStates = locations.data?.authStates || {}
  const knownVps = locations.data?.knownVps || []
  const isProbing = locations.isLoading || locations.isFetching

  const renderAuthBadge = (target: string) => {
    if (target === 'local') {
      // Per Local non abbiamo probe in /locations — useremo l'health corrente come proxy
      // (semplificazione: mostriamo "Probe per attivare" e il vero check avviene al salvataggio)
      return null
    }
    const state = authStates[target]
    if (isProbing) {
      return (
        <Badge variant="outline" className="text-[9px] gap-1">
          <Loader2 className="w-2.5 h-2.5 animate-spin" /> probe…
        </Badge>
      )
    }
    if (!state) return null
    if (!state.online) {
      return (
        <Badge variant="outline" className="text-[9px] gap-1 border-red-500/40 bg-red-500/10 text-red-300">
          <WifiOff className="w-2.5 h-2.5" /> offline
        </Badge>
      )
    }
    if (!state.cliInstalled) {
      return (
        <Badge variant="outline" className="text-[9px] gap-1 border-amber-500/40 bg-amber-500/10 text-amber-300">
          <AlertCircle className="w-2.5 h-2.5" /> CLI non installata
        </Badge>
      )
    }
    if (state.authOk) {
      return (
        <Badge variant="outline" className="text-[9px] gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
          <CheckCircle2 className="w-2.5 h-2.5" /> già loggato
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="text-[9px] gap-1 border-violet-500/40 bg-violet-500/10 text-violet-300">
        <XCircle className="w-2.5 h-2.5" /> da loggare
      </Badge>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !updateMut.isPending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="w-5 h-5 text-violet-400" />
            Configura target — {accountLabel}
          </DialogTitle>
          <DialogDescription>
            Scegli dove "vive" questo account. Il login è separato per ogni target (Local o VPS).
            Una volta configurato, le sessioni Claude per questo account spawneranno automaticamente sul target scelto.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2 max-h-[55vh] overflow-y-auto">
          {/* Local option */}
          <button
            type="button"
            onClick={() => setSelected('local')}
            className={cn(
              'w-full text-left p-3 rounded-md border transition-all hover:border-primary/50',
              selected === 'local' ? 'border-primary bg-primary/5' : 'border-border'
            )}
          >
            <div className="flex items-center gap-2">
              <Monitor className="w-4 h-4 text-blue-400 shrink-0" />
              <span className="font-medium text-sm">Local (questa macchina)</span>
              {selected === 'local' && <CheckCircle2 className="w-4 h-4 text-primary ml-auto" />}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Spawn nei terminali CMD locali. Login condiviso con tutti i CLI {cliName} su questa macchina.
            </div>
            {localOtherCount > 0 && (
              <div className="text-[10px] text-amber-300/80 mt-1">
                ⚠ Hai già {localOtherCount} altro account {cliName} su Local — condividerebbero lo stesso login fisico.
              </div>
            )}
          </button>

          {/* VPS options */}
          {knownVps.map((vps) => {
            const otherCount = vpsOtherCounts.get(vps.id) || 0
            return (
              <button
                key={vps.id}
                type="button"
                onClick={() => setSelected(vps.id)}
                className={cn(
                  'w-full text-left p-3 rounded-md border transition-all hover:border-primary/50',
                  selected === vps.id ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Server className="w-4 h-4 text-violet-400 shrink-0" />
                  <span className="font-medium text-sm truncate max-w-[220px]">{vps.label}</span>
                  <Badge variant="outline" className="text-[9px] h-4 px-1.5 capitalize">
                    {vps.category}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground font-mono">{vps.ip}</span>
                  <div className="ml-auto">{renderAuthBadge(vps.id)}</div>
                  {selected === vps.id && <CheckCircle2 className="w-4 h-4 text-primary" />}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  ID: <code className="bg-muted/40 px-1 rounded">{vps.id}</code> · spawn via SSH (chiave già configurata)
                </div>
                {otherCount > 0 && (
                  <div className="text-[10px] text-amber-300/80 mt-1">
                    ⚠ Hai già {otherCount} altro account {cliName} su questo VPS — condividerebbero il login.
                  </div>
                )}
              </button>
            )
          })}

          {knownVps.length === 0 && (
            <div className="text-[11px] text-muted-foreground italic text-center py-3">
              Nessun VPS conosciuto. Aggiungilo a <code>data/ssh-inventory.json</code>.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={isProbing || updateMut.isPending}
            className="gap-1.5"
            title="Riesegui probe SSH per tutti i VPS"
          >
            <RefreshCw className={cn('w-3 h-3', isProbing && 'animate-spin')} />
            Re-probe
          </Button>
          <div className="sm:ml-auto flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={updateMut.isPending}>
              Annulla
            </Button>
            <Button
              size="sm"
              disabled={!selected || selected === currentTarget || updateMut.isPending}
              onClick={() => updateMut.mutate(selected)}
              className="gap-1.5"
            >
              {updateMut.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Configuro…
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Configura → continua
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
