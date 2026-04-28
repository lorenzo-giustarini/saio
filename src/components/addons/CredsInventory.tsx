import { useQuery } from '@tanstack/react-query'
import { Key, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface CredItem {
  name: string
  scope: string
  source: string
  configured: boolean
  notes?: string
}

async function fetchCreds() {
  const res = await fetch('/api/credentials')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<{
    items: CredItem[]
    stats: { total: number; configured: number; missing: number }
  }>
}

const sourceColors: Record<string, string> = {
  'settings.json env': 'text-emerald-400',
  'Windows env': 'text-blue-400',
  'VPS .env': 'text-amber-400',
  'vault reference': 'text-purple-400',
  file: 'text-pink-400',
}

export function CredsInventory() {
  const { data, isLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: fetchCreds,
    refetchInterval: 300_000,
    staleTime: 120_000,
  })

  return (
    <Card className="h-full neon-card-purple">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Credenziali (inventario live)</h3>
          {data && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {data.stats.configured}/{data.stats.total}
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">Solo nomi + scope — valori mai esposti</p>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> Caricamento...
          </div>
        )}
        <div className="max-h-72 overflow-auto scrollbar-thin space-y-1">
          {data?.items.map((c) => (
            <div key={c.name + c.source} className="flex items-start gap-2 text-xs py-0.5">
              {c.configured ? (
                <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-3 h-3 text-muted-foreground/40 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0 flex-1">
                <div className={cn('font-mono truncate', !c.configured && 'opacity-50')}>
                  {c.name}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={cn('text-[9px]', sourceColors[c.source] || 'text-muted-foreground')}>
                    {c.source}
                  </span>
                  <span className="text-[9px] text-muted-foreground truncate">· {c.scope}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
