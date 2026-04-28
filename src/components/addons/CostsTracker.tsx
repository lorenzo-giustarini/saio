import { useQuery } from '@tanstack/react-query'
import { DollarSign } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { api } from '@/lib/api'

// Rough cost estimate — $15 per M input tokens for Opus 4.7 (approx)
const COST_PER_M_TOKENS = 15

export function CostsTracker() {
  const { data } = useQuery({
    queryKey: ['metrics', 'tokens'],
    queryFn: () => api.metrics.tokens(),
    refetchInterval: 120_000,
  })

  const series = data?.series || []
  const today = series[series.length - 1]?.tokens || 0
  const week = series.slice(-7).reduce((s, x) => s + x.tokens, 0)
  const month = series.reduce((s, x) => s + x.tokens, 0)

  const cost = (tokens: number) => ((tokens / 1_000_000) * COST_PER_M_TOKENS).toFixed(2)

  return (
    <Card className="neon-card-green">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-400" />
          <h3 className="font-semibold text-sm">Costi stimati</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        <Row label="Oggi" tokens={today} cost={cost(today)} />
        <Row label="Settimana" tokens={week} cost={cost(week)} />
        <Row label="Mese (14g)" tokens={month} cost={cost(month)} />
        <p className="text-[10px] text-muted-foreground pt-2">
          Stima: ${COST_PER_M_TOKENS}/M token (Opus 4.7)
        </p>
      </CardContent>
    </Card>
  )
}

function Row({ label, tokens, cost }: { label: string; tokens: number; cost: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">
        {tokens.toLocaleString('it-IT')}{' '}
        <span className="text-emerald-400">${cost}</span>
      </span>
    </div>
  )
}
