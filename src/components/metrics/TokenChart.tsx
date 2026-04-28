import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Area, AreaChart } from 'recharts'
import { Info, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatTokens } from '@/lib/utils'
import { api } from '@/lib/api'

interface TokenResponse {
  series: Array<{
    date: string
    totalTokens: number
    tokens: number
    messages: number
    inputTokens: number
    outputTokens: number
    cacheRead: number
    cacheCreate5m: number
    cacheCreate1h: number
    costUSD: number
  }>
  source: string
  disclaimer?: string
  pricing?: {
    inputPerM: number
    outputPerM: number
    cacheReadPerM: number
    cacheCreate5mPerM: number
    cacheCreate1hPerM: number
  }
  totals?: { tokens: number; costUSD: number; messages: number }
  updatedAt: string
}

async function fetchTokens() {
  const res = await fetch('/api/metrics/tokens')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<TokenResponse>
}

// V13.1 T10: Detailed tooltip — breakdown per modello + cost
function TokenTooltipDetailed({ row }: { row: any }) {
  const detailed = row.__detailed // breakdown per-model attached if available
  const dateLabel = new Date(row.date).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })

  if (!detailed) {
    // Fallback to simple view
    return (
      <div className="text-xs space-y-1 bg-popover p-2 rounded border border-border">
        <div className="font-semibold">{dateLabel}</div>
        <div>Tokens: {formatTokens(row.totalTokens || row.tokens || 0)}</div>
        <div>Messages: {row.messages || 0}</div>
        {row.costUSD > 0 && <div>Cost: ${row.costUSD.toFixed(4)}</div>}
      </div>
    )
  }

  const byModel = detailed.byModel || {}
  const modelNames = Object.keys(byModel).sort()

  return (
    <div className="text-xs space-y-2 bg-popover p-3 rounded border border-border min-w-[320px] max-w-[440px]">
      <div className="font-semibold text-sm border-b border-border/50 pb-1">{dateLabel}</div>
      {modelNames.length === 0 && (
        <div className="text-muted-foreground italic">Nessun token questo giorno</div>
      )}
      {modelNames.map((m) => {
        const mb = byModel[m]
        const total = mb.input + mb.output + mb.cache_read + mb.cache_5m + mb.cache_1h
        return (
          <div key={m} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <code className="text-[10px] bg-muted/50 px-1 py-0.5 rounded truncate">{m}</code>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {formatTokens(total)} · {mb.messages} msg
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground pl-2">
              <span>In: <span className="text-foreground">{formatTokens(mb.input)}</span></span>
              <span>Out: <span className="text-foreground">{formatTokens(mb.output)}</span></span>
              {mb.cache_read > 0 && <span>CacheR: <span className="text-foreground">{formatTokens(mb.cache_read)}</span></span>}
              {mb.cache_5m > 0 && <span>Cache5m: <span className="text-foreground">{formatTokens(mb.cache_5m)}</span></span>}
              {mb.cache_1h > 0 && <span className="col-span-2">Cache1h: <span className="text-foreground">{formatTokens(mb.cache_1h)}</span></span>}
            </div>
            {mb.hasPricing ? (
              <div className="text-[10px] text-emerald-400 pl-2">
                Cost: ${mb.costUSD.toFixed(4)}
              </div>
            ) : (
              <div className="text-[10px] text-violet-400 pl-2 italic">Plan subscription — no per-token cost</div>
            )}
          </div>
        )
      })}
      {detailed.total?.costUSD > 0 && (
        <div className="pt-1 border-t border-border/50 text-[11px] font-semibold flex justify-between">
          <span>Totale cost:</span>
          <span className="text-emerald-400">${detailed.total.costUSD.toFixed(4)}</span>
        </div>
      )}
    </div>
  )
}

export function TokenChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['metrics', 'tokens'],
    queryFn: fetchTokens,
    refetchInterval: 60_000,
  })

  // V13.1 T10: fetch detailed breakdown separately
  const detailed = useQuery({
    queryKey: ['metrics', 'tokens-detailed'],
    queryFn: () => api.metrics.tokensDetailed(),
    refetchInterval: 60_000,
  })

  // Merge detailed breakdown into series for tooltip
  const detailedByDate = new Map<string, any>(
    (detailed.data?.series || []).map((d: any) => [d.date, d])
  )
  const series = (data?.series || []).map((s) => ({
    ...s,
    __detailed: detailedByDate.get(s.date) || null,
  }))
  const totalTokens = data?.totals?.tokens ?? series.reduce((sum, s) => sum + (s.totalTokens || s.tokens || 0), 0)
  const totalMessages = data?.totals?.messages ?? series.reduce((s, x) => s + (x.messages || 0), 0)
  const totalCost = data?.totals?.costUSD?.toFixed(2) ?? '0.00'

  return (
    <Card className="relative overflow-hidden neon-card-blue">
      <div className="absolute -top-8 -right-8 w-32 h-32 bg-gradient-to-br from-blue-500/20 to-transparent rounded-full blur-2xl pointer-events-none" />
      <CardHeader className="pb-2 relative">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-400" />
              <h3 className="font-semibold text-sm">Token + Messages (14g)</h3>
              {data?.source && (
                <TooltipProvider>
                  <UiTooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex items-center">
                        <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[360px]">
                      <div className="text-[11px] space-y-1">
                        <div><strong>Source:</strong> {data.source}</div>
                        {data.disclaimer && <div className="italic text-muted-foreground">{data.disclaimer}</div>}
                      </div>
                    </TooltipContent>
                  </UiTooltip>
                </TooltipProvider>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatTokens(totalTokens)} tokens · {totalMessages.toLocaleString('it-IT')} messages · <span className="text-emerald-400 font-semibold">${totalCost}</span>
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 relative">
        <div className="h-48">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Loading...</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradTokens" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.8} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickFormatter={formatTokens}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 11,
                    padding: 10,
                  }}
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0].payload
                    return <TokenTooltipDetailed row={row} />
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="tokens"
                  stroke="#60a5fa"
                  strokeWidth={2}
                  fill="url(#gradTokens)"
                  dot={{ r: 2, fill: '#60a5fa' }}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
