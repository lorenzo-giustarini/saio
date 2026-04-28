/**
 * V15.0 WS22 — Dialog espanso per gestione PTY sessions live.
 *
 * Triggerato da click su PtySessionsIndicator (sidebar). Permette:
 * - Visualizzare lista completa sessioni con projectId, PID, startedAt
 * - Terminare singola sessione con AlertDialog conferma
 * - Terminare TUTTE con doppia conferma (checkbox + bottone)
 *
 * Endpoint riusati:
 * - GET /api/pty/sessions (lista)
 * - DELETE /api/pty/:projectId (kill singolo, loop per batch)
 */
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

interface PtySessionInfo {
  projectId: string
  pid?: number
  startedAt?: string
  cli?: string
}

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
}

export function PtySessionsDialog({ open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['pty', 'sessions'],
    queryFn: async () => {
      const res = await fetch('/api/pty/sessions', { credentials: 'include' })
      if (!res.ok) return { sessions: [] }
      return (await res.json()) as { sessions: PtySessionInfo[] }
    },
    enabled: open,
    refetchInterval: open ? 5_000 : false,
  })
  const sessions = data?.sessions || []

  const [killTarget, setKillTarget] = useState<string | null>(null)
  const [killAllOpen, setKillAllOpen] = useState(false)
  const [killAllConfirmed, setKillAllConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)

  async function killOne(projectId: string) {
    setBusy(true)
    try {
      const r = await fetch(`/api/pty/${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (r.ok) {
        toast.success(`Sessione "${projectId}" terminata`)
      } else {
        toast.error(`Errore terminazione "${projectId}" (HTTP ${r.status})`)
      }
      qc.invalidateQueries({ queryKey: ['pty', 'sessions'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    } catch (err) {
      toast.error(`Errore terminazione: ${(err as Error).message}`)
    } finally {
      setBusy(false)
      setKillTarget(null)
    }
  }

  async function killAll() {
    setBusy(true)
    const ids = sessions.map((s) => s.projectId)
    let ok = 0
    let ko = 0
    for (const id of ids) {
      try {
        const r = await fetch(`/api/pty/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (r.ok) ok++
        else ko++
      } catch {
        ko++
      }
    }
    if (ko === 0) {
      toast.success(`${ok}/${ids.length} sessioni terminate`)
    } else {
      toast.error(`${ok}/${ids.length} terminate, ${ko} errori`)
    }
    qc.invalidateQueries({ queryKey: ['pty', 'sessions'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
    setBusy(false)
    setKillAllOpen(false)
    setKillAllConfirmed(false)
  }

  function formatDuration(startedAt?: string): string {
    if (!startedAt) return '?'
    const ms = Date.now() - new Date(startedAt).getTime()
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}min`
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}min`
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Sessioni PTY attive ({sessions.length})</DialogTitle>
            <DialogDescription>
              Terminali Claude live nei progetti aperti. Terminare una sessione chiude
              il processo CLI; la cronologia conversazione resta in <code className="text-[11px]">~/.claude/projects/</code>.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
              Caricamento...
            </div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nessuna sessione attiva.
            </div>
          ) : (
            <ScrollArea className="max-h-[50vh] -mx-6 px-6">
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div
                    key={s.projectId}
                    className="flex items-center justify-between p-3 rounded-md border border-border bg-card/40 hover:bg-card/60 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm truncate">{s.projectId}</div>
                      <div className="text-[11px] text-muted-foreground space-x-2">
                        {s.pid && <span>PID: {s.pid}</span>}
                        {s.cli && <span>· CLI: {s.cli}</span>}
                        {s.startedAt && <span>· uptime: {formatDuration(s.startedAt)}</span>}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => setKillTarget(s.projectId)}
                      className="shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 mr-1" />
                      Termina
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          <DialogFooter className="flex-row sm:justify-between gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Chiudi
            </Button>
            {sessions.length > 1 && (
              <Button
                variant="destructive"
                onClick={() => setKillAllOpen(true)}
                disabled={busy}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Termina tutte ({sessions.length})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conferma kill singola */}
      <AlertDialog open={!!killTarget} onOpenChange={(v) => !v && setKillTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminare sessione "{killTarget}"?</AlertDialogTitle>
            <AlertDialogDescription>
              La sessione Claude verrà chiusa immediatamente. La cronologia della
              conversazione resta salvata in <code>~/.claude/projects/</code> e potrai
              riprenderla in futuro con <strong>Riconnetti</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (killTarget) killOne(killTarget)
              }}
              disabled={busy}
              className="bg-red-600 hover:bg-red-700"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Termina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Conferma DOPPIA kill all (checkbox + bottone) */}
      <AlertDialog
        open={killAllOpen}
        onOpenChange={(v) => {
          setKillAllOpen(v)
          if (!v) setKillAllConfirmed(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminare TUTTE le {sessions.length} sessioni?</AlertDialogTitle>
            <AlertDialogDescription>
              Operazione massiva — tutte le sessioni Claude verranno chiuse contemporaneamente.
              Le conversazioni restano salvate ma le PTY attualmente live verranno terminate.
              <br />
              <br />
              Conferma esplicita richiesta per evitare click accidentale.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-start gap-2 my-3 p-3 rounded-md border border-red-500/30 bg-red-500/5">
            <Checkbox
              id="killall-confirm"
              checked={killAllConfirmed}
              onCheckedChange={(c) => setKillAllConfirmed(c === true)}
              className="mt-0.5"
            />
            <label
              htmlFor="killall-confirm"
              className="text-sm leading-tight cursor-pointer select-none"
            >
              Confermo: voglio terminare tutte le <strong>{sessions.length} sessioni</strong> attive
            </label>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} onClick={() => setKillAllConfirmed(false)}>
              Annulla
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                killAll()
              }}
              disabled={!killAllConfirmed || busy}
              className="bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Termina tutte
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
