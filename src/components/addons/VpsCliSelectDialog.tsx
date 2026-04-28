import { useState, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  RefreshCw,
  Terminal,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface CliStatus {
  installed: boolean
  version?: string
  path?: string
  lastCheck?: string
  attemptedInstall?: string
  installError?: string
}

interface VpsState {
  vpsId: string
  probedAt: string | null
  clis: Record<string, CliStatus>
  firstRunToday: string | null
  lastUpdateRun: string | null
  notes?: string
}

interface Props {
  open: boolean
  onClose: () => void
  vpsId: string
  vpsLabel: string
  projectId?: string
}

const CLI_INFO: Record<string, { label: string; provider: string }> = {
  claude: { label: 'Claude Code', provider: 'Anthropic' },
  codex: { label: 'OpenAI Codex', provider: 'OpenAI' },
  gemini: { label: 'Gemini CLI', provider: 'Google' },
  aichat: { label: 'aichat (Kimi/multi)', provider: 'Moonshot+' },
  fal: { label: 'fal.ai CLI', provider: 'fal.ai' },
}

export function VpsCliSelectDialog({ open, onClose, vpsId, vpsLabel, projectId }: Props) {
  const [state, setState] = useState<VpsState | null>(null)
  const [loading, setLoading] = useState(false)
  const [probeError, setProbeError] = useState<string | null>(null)

  // Initial probe
  useEffect(() => {
    if (!open || !vpsId) return
    setLoading(true)
    setProbeError(null)
    fetch(`/api/pty/remote/${encodeURIComponent(vpsId)}/probe`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setProbeError(data.error)
        else setState(data)
      })
      .catch((err) => setProbeError(String(err)))
      .finally(() => setLoading(false))
  }, [open, vpsId])

  const installMut = useMutation({
    mutationFn: async (cli: string) => {
      const res = await fetch(`/api/pty/remote/${encodeURIComponent(vpsId)}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cli }),
      })
      return res.json()
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(`CLI ${data.cli} installata su ${vpsLabel}`)
        setState(data.state)
      } else {
        toast.error(`Install ${data.cli} fallita`)
        setState(data.state)
      }
    },
    onError: (err) => toast.error('Errore install', { description: String(err) }),
  })

  const spawnMut = useMutation({
    mutationFn: async (cli: string) => {
      if (!projectId) throw new Error('projectId missing')
      const res = await fetch(
        `/api/pty/remote/${encodeURIComponent(vpsId)}/${encodeURIComponent(projectId)}/spawn`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cli }),
        }
      )
      return res.json()
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(`Sessione ${data.cli} su ${vpsLabel} avviata`, {
          description: `PID ${data.pid}${data.dailyUpdate?.ran?.length ? ' · update eseguito' : ''}`,
        })
        onClose()
      } else {
        toast.error('Spawn fallito', { description: data.error })
      }
    },
    onError: (err) => toast.error('Errore spawn', { description: String(err) }),
  })

  const reprobeMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/pty/remote/${encodeURIComponent(vpsId)}/probe?force=true`)
      return res.json()
    },
    onSuccess: (data) => {
      toast.success('Probe CLI aggiornato')
      setState(data)
    },
  })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-violet-400" />
            Sessione AI su {vpsLabel}
          </DialogTitle>
          <DialogDescription>
            Scegli quale AI CLI usare sul VPS. Sessioni future erediteranno la scelta. Prima
            esecuzione del giorno esegue anche `npm update -g` automaticamente.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Probe CLI installate...
          </div>
        )}

        {probeError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Probe failed: {probeError}
          </div>
        )}

        {state && (
          <>
            <div className="space-y-2">
              {Object.entries(state.clis).map(([cli, status]) => {
                const info = CLI_INFO[cli] || { label: cli, provider: 'unknown' }
                const installing = installMut.isPending && installMut.variables === cli
                const spawning = spawnMut.isPending && spawnMut.variables === cli
                return (
                  <div
                    key={cli}
                    className={cn(
                      'flex items-center gap-3 p-3 rounded-md border',
                      status.installed
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-border bg-muted/10'
                    )}
                  >
                    {status.installed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{info.label}</span>
                        <Badge variant="outline" className="text-[9px] h-4">
                          {cli}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {status.installed
                          ? status.version || info.provider
                          : status.installError
                          ? `⚠ ${status.installError}`
                          : `${info.provider} · non installata`}
                      </div>
                    </div>
                    {status.installed ? (
                      projectId ? (
                        <Button
                          size="sm"
                          onClick={() => spawnMut.mutate(cli)}
                          disabled={spawning}
                          className="gap-1 h-8"
                        >
                          {spawning ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          Apri
                        </Button>
                      ) : (
                        <Badge className="h-5 text-[10px]">pronto</Badge>
                      )
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => installMut.mutate(cli)}
                        disabled={installing}
                        className="gap-1 h-8"
                      >
                        {installing ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" /> Installo...
                          </>
                        ) : (
                          <>
                            <Download className="w-3 h-3" /> Installa
                          </>
                        )}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3 text-[10px] text-muted-foreground pt-2 border-t border-border">
              {state.probedAt && (
                <span>
                  Probed: {new Date(state.probedAt).toLocaleTimeString('it-IT')}
                </span>
              )}
              {state.lastUpdateRun && (
                <span>
                  Last update: {new Date(state.lastUpdateRun).toLocaleDateString('it-IT')}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => reprobeMut.mutate()}
                disabled={reprobeMut.isPending}
                className="ml-auto gap-1 h-6 text-[10px]"
              >
                <RefreshCw
                  className={cn('w-3 h-3', reprobeMut.isPending && 'animate-spin')}
                />
                Ri-probe
              </Button>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Chiudi
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
