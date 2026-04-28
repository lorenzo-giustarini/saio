import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type SessionStatus =
  | 'idle'
  | 'pending'
  | 'running'
  | 'running_idle'
  | 'waiting_user'
  | 'paused'
  | 'done'
  | 'failed'
  | 'external_active'
  | 'recently_terminated'

interface SessionStatusDotProps {
  status: SessionStatus
  size?: 'sm' | 'md'
  className?: string
}

const CFG: Record<SessionStatus, { color: string; animate: boolean; label: string }> = {
  idle: { color: 'bg-slate-600', animate: false, label: 'Nessuna sessione attiva' },
  pending: { color: 'bg-slate-500', animate: false, label: 'In coda' },
  running: { color: 'bg-emerald-500', animate: true, label: 'In esecuzione attiva (output recente)' },
  // V15.0 WS26 — Verde fisso (no animate) quando >8s senza output PTY.
  // Caso tipico: Claude attende silenziosamente la tua risposta (anche senza ? esplicito).
  running_idle: {
    color: 'bg-emerald-500',
    animate: false,
    label: 'Sessione attiva ma idle (>8s senza output) — Claude potrebbe attendere risposta silenziosamente',
  },
  waiting_user: { color: 'bg-amber-500', animate: true, label: 'Attende tua risposta esplicita (? o menu)' },
  paused: { color: 'bg-orange-500', animate: false, label: 'In pausa (orchestrator esterno)' },
  done: { color: 'bg-blue-500', animate: false, label: 'Completato esplicitamente' },
  failed: { color: 'bg-red-500', animate: false, label: 'Fallito — vedi log' },
  external_active: {
    color: 'bg-violet-500',
    animate: true,
    label: 'CLI AI attiva esternamente (non PTY SAIO)',
  },
  recently_terminated: {
    color: 'bg-cyan-500',
    animate: true,
    label: 'Sessione terminata di recente (< 30 min) — output disponibile, completion non confermato',
  },
}

// V15.0 WS26 — Legenda colori, mostrata in tooltip per orientarsi.
const LEGEND: Array<{ color: string; animate: boolean; text: string }> = [
  { color: 'bg-emerald-500', animate: true, text: 'Verde pulsante: in esecuzione attiva' },
  { color: 'bg-emerald-500', animate: false, text: 'Verde fisso: attiva ma idle (>8s)' },
  { color: 'bg-amber-500', animate: true, text: 'Giallo: attende risposta esplicita' },
  { color: 'bg-violet-500', animate: true, text: 'Viola: CLI esterna attiva' },
  { color: 'bg-cyan-500', animate: true, text: 'Cyan: terminata di recente' },
  { color: 'bg-blue-500', animate: false, text: 'Blu: completata' },
  { color: 'bg-orange-500', animate: false, text: 'Arancio: in pausa' },
  { color: 'bg-red-500', animate: false, text: 'Rosso: fallita' },
  { color: 'bg-slate-600', animate: false, text: 'Grigio: nessuna sessione' },
]

export function SessionStatusDot({ status, size = 'sm', className }: SessionStatusDotProps) {
  const cfg = CFG[status] || CFG.idle
  const px = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('relative inline-flex', className)}>
            {cfg.animate && (
              <span
                className={cn(
                  'absolute inline-flex rounded-full animate-ping opacity-70',
                  px,
                  cfg.color
                )}
              />
            )}
            <span className={cn('relative inline-flex rounded-full', px, cfg.color)} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px]">
          <div className="space-y-2">
            <span className="text-xs font-medium block">{cfg.label}</span>
            <div className="border-t border-border/40 pt-1.5 space-y-0.5">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                Legenda colori
              </span>
              {LEGEND.map((l, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="relative inline-flex shrink-0">
                    {l.animate && (
                      <span
                        className={cn('absolute inline-flex w-1.5 h-1.5 rounded-full animate-ping opacity-70', l.color)}
                      />
                    )}
                    <span className={cn('relative inline-flex w-1.5 h-1.5 rounded-full', l.color)} />
                  </span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
