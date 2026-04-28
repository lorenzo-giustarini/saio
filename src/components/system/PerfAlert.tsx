/**
 * V15.0 WS22 — Banner top + beep audio + toast quando CPU sostenuto > 100% per >10s.
 *
 * Mounted in Layout (top-of-page). Riusa PtySessionsDialog di WS22 per kill rapido
 * sessioni dal banner stesso.
 *
 * Alert:
 * - Banner rosso fixed top con count CPU + dettaglio processi
 * - Bottone "Apri Sessioni" → apre PtySessionsDialog
 * - Bottone "Dismiss" → nasconde fino a prossimo trigger
 * - Beep singolo via Web Audio API (440Hz oscillator, 250ms) al primo trigger
 * - Toast persistente sonner con stesso messaggio
 *
 * Audio policy browser: AudioContext richiede user interaction per primo play.
 * Se primo trigger viene bloccato, il banner visivo + toast restano comunque.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, X, Cpu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { usePerfMonitor } from '@/hooks/usePerfMonitor'
import { PtySessionsDialog } from '@/components/dialogs/PtySessionsDialog'

function playAlertBeep(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 660
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.18, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
    // Pulizia AudioContext dopo 1s
    setTimeout(() => {
      try { ctx.close() } catch { /* */ }
    }, 1000)
  } catch {
    /* AudioContext non disponibile o bloccato */
  }
}

export function PerfAlert() {
  const { totalCpu, processes, cpuCount, highLoad, threshold } = usePerfMonitor(true)
  const [dismissed, setDismissed] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const beepedRef = useRef(false)
  const toastIdRef = useRef<string | number | null>(null)

  // Trigger quando highLoad passa da false a true
  useEffect(() => {
    if (highLoad && !beepedRef.current) {
      beepedRef.current = true
      playAlertBeep()
      const id = toast.error(
        `CPU saturo: ${totalCpu.toFixed(0)}% sostenuto > 10s. Considera di chiudere sessioni.`,
        { duration: Infinity, dismissible: true }
      )
      toastIdRef.current = id
      setDismissed(false)
    } else if (!highLoad && beepedRef.current) {
      beepedRef.current = false
      if (toastIdRef.current !== null) {
        toast.dismiss(toastIdRef.current)
        toastIdRef.current = null
      }
    }
  }, [highLoad, totalCpu])

  if (!highLoad || dismissed) return null

  const topProcs = [...processes]
    .filter((p) => typeof p.cpu === 'number')
    .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0))
    .slice(0, 3)

  return (
    <>
      <div className="border-b border-red-500/40 bg-red-500/10 px-6 py-3 sticky top-0 z-50 backdrop-blur-md">
        <div className="max-w-6xl mx-auto flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5 animate-pulse" />
          <div className="flex-1 min-w-0 space-y-1">
            <h3 className="text-sm font-semibold text-red-200 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5" />
              CPU saturo · {totalCpu.toFixed(0)}% (soglia {threshold}% · {cpuCount} core)
            </h3>
            <p className="text-xs text-red-200/80">
              Carico sostenuto oltre 10s — il terminale potrebbe rallentare o crashare. Chiudi
              alcune sessioni Claude per liberare CPU.
            </p>
            {topProcs.length > 0 && (
              <div className="text-[11px] text-red-200/70 font-mono mt-1">
                Top: {topProcs.map((p) => `${p.name || p.pid}:${(p.cpu ?? 0).toFixed(0)}%`).join(' · ')}
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setDialogOpen(true)}
              className="bg-red-600 hover:bg-red-700"
            >
              Apri Sessioni
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDismissed(true)}
              className="text-red-300 hover:text-red-100"
              title="Nascondi questo alert (riapparirà al prossimo trigger)"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
      <PtySessionsDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
}
