import { useQuery } from '@tanstack/react-query'
import { Plug, CheckCircle2, AlertTriangle, XCircle, HelpCircle } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

const statusIcons = {
  healthy: { icon: CheckCircle2, color: 'text-emerald-400' },
  degraded: { icon: AlertTriangle, color: 'text-amber-400' },
  down: { icon: XCircle, color: 'text-red-400' },
  unknown: { icon: HelpCircle, color: 'text-slate-400' },
}

export function MCPStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ['mcp', 'status'],
    queryFn: () => api.mcp.status(),
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  return (
    <Card className="neon-card-blue">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">MCP Servers</h3>
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {isLoading && <p className="text-xs text-muted-foreground">Checking...</p>}
        {data?.mcps.map((mcp) => {
          const cfg = statusIcons[mcp.status as keyof typeof statusIcons] || statusIcons.unknown
          const Icon = cfg.icon
          return (
            <div key={mcp.name} className="flex items-center gap-2 text-xs">
              <Icon className={cn('w-3.5 h-3.5', cfg.color)} />
              <span className="font-mono">{mcp.name}</span>
              {mcp.latencyMs !== undefined && (
                <span className="ml-auto text-muted-foreground">{mcp.latencyMs}ms</span>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
