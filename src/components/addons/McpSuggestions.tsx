import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Sparkles, Calendar, FileText, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'

interface McpMeta {
  available: boolean
  lastRun?: string
  relativePath?: string
  suggestionsPath?: string
  sizeKB?: number
  newSinceLastView?: boolean
}

async function fetchMeta() {
  const res = await fetch('/api/mcp-discovery')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<McpMeta>
}

export function McpSuggestions() {
  const { data, refetch } = useQuery({
    queryKey: ['mcp-discovery'],
    queryFn: fetchMeta,
    staleTime: 60_000,
    refetchInterval: 300_000,
  })

  const markRead = async () => {
    await fetch('/api/mcp-discovery/mark-read', { method: 'POST' })
    refetch()
  }

  return (
    <Card className="neon-card-amber">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <h3 className="font-semibold text-sm">MCP Discovery</h3>
          {data?.newSinceLastView && (
            <Badge variant="outline" className="text-[9px] h-4 px-1.5 text-amber-400 border-amber-500/40 animate-pulse">
              NEW
            </Badge>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">Scansione weekly MCP utili per i tuoi casi d'uso</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {!data?.available && (
          <div className="text-xs text-muted-foreground">
            Nessuna scansione ancora. Registra il cron con <code className="bg-muted px-1 py-0.5 rounded text-[10px]">pwsh scripts/register-mcp-discovery.ps1</code>
          </div>
        )}
        {data?.available && (
          <>
            <div className="flex items-center gap-2 text-xs">
              <Calendar className="w-3 h-3 text-muted-foreground" />
              <span className="text-muted-foreground">Ultima scansione:</span>
              <span>{data.lastRun && formatRelativeTime(data.lastRun)}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <FileText className="w-2.5 h-2.5" />
              <code className="truncate">{data.relativePath}</code>
              <span>· {data.sizeKB}KB</span>
            </div>
            <div className="flex items-center gap-2 pt-1">
              {data.relativePath && (
                <Link to={`/docs?file=${encodeURIComponent(data.relativePath)}`} onClick={markRead}>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
                    <FileText className="w-3 h-3" />
                    Apri proposte
                  </Button>
                </Link>
              )}
              {data.newSinceLastView && (
                <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={markRead}>
                  Segna letto
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
