import { AlertTriangle, ShieldAlert, Shield, CircleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Risk } from '@/lib/types'

interface RiskIndicatorProps {
  risk: Risk
  className?: string
}

const severityConfig = {
  low: {
    icon: Shield,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/20',
    label: 'Basso',
  },
  medium: {
    icon: CircleAlert,
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/20',
    label: 'Medio',
  },
  high: {
    icon: AlertTriangle,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
    label: 'Alto',
  },
  critical: {
    icon: ShieldAlert,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
    label: 'Critico',
  },
}

export function RiskIndicator({ risk, className }: RiskIndicatorProps) {
  const cfg = severityConfig[risk.severita]
  const Icon = cfg.icon
  const probPct = Math.round(risk.probabilita * 100)
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        cfg.bg,
        cfg.border,
        className
      )}
    >
      <Icon className={cn('w-4 h-4 shrink-0 mt-0.5', cfg.color)} />
      <div className="flex-1 space-y-1">
        <div className="text-foreground">{risk.desc}</div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className={cfg.color}>● {cfg.label}</span>
          <span className="text-muted-foreground">Prob {probPct}%</span>
        </div>
      </div>
    </div>
  )
}
