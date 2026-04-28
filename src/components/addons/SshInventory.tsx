import { useQuery } from '@tanstack/react-query'
import { Key as KeyIcon, Shield, Server, Loader2, Info, Copy } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { cn, formatRelativeTime } from '@/lib/utils'

interface SshKey {
  name: string
  type: 'private' | 'public'
  algorithm?: string
  size: number
  mtime: string
}

interface VpsHost {
  id: string
  ip: string
  hostname?: string
  label: string
  keyName: string
  category: string
  notes?: string
}

async function fetchKeys() {
  const res = await fetch('/api/ssh/keys')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<{ keys: SshKey[]; count: number; knownHostsCount: number }>
}

async function fetchHosts() {
  const res = await fetch('/api/ssh/hosts')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<{ hosts: VpsHost[]; count: number }>
}

const categoryColors: Record<string, string> = {
  production: 'text-emerald-400',
  staging: 'text-amber-400',
  experimental: 'text-blue-400',
  unknown: 'text-slate-400',
}

export function SshInventory() {
  const keysQ = useQuery({
    queryKey: ['ssh', 'keys'],
    queryFn: fetchKeys,
    staleTime: 300_000,
    refetchInterval: 600_000,
  })
  const hostsQ = useQuery({
    queryKey: ['ssh', 'hosts'],
    queryFn: fetchHosts,
    staleTime: 600_000,
  })

  return (
    <Card className="h-full neon-card-purple">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-purple-400" />
          <h3 className="font-semibold text-sm">SSH Keys + VPS</h3>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3 h-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs">
                <div className="text-xs space-y-1.5">
                  <div className="font-semibold">Legenda colori chiavi</div>
                  <div className="flex items-center gap-2">
                    <KeyIcon className="w-3 h-3 text-amber-400" />
                    <span><strong>Gialla</strong>: chiave <strong>privata</strong> (da proteggere, mai condivisa)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <KeyIcon className="w-3 h-3 text-emerald-400" />
                    <span><strong>Verde</strong>: chiave <strong>pubblica</strong> (può essere condivisa)</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground pt-1 border-t border-border">
                    Dashboard mostra solo nomi + metadati. Contenuto MAI esposto.
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {keysQ.data && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {keysQ.data.count} chiavi · {keysQ.data.knownHostsCount} known hosts
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {(keysQ.isLoading || hostsQ.isLoading) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" /> Caricamento...
          </div>
        )}

        {/* Keys */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
            <KeyIcon className="w-3 h-3" /> Chiavi
          </div>
          <div className="space-y-1 max-h-32 overflow-auto scrollbar-thin">
            {keysQ.data?.keys.map((k) => (
              <div key={k.name} className="flex items-center gap-2 text-xs">
                <KeyIcon className={cn('w-3 h-3 shrink-0', k.type === 'private' ? 'text-amber-400' : 'text-emerald-400')} />
                <code className="font-mono truncate flex-1">{k.name}</code>
                {k.algorithm && (
                  <span className="text-[9px] text-muted-foreground uppercase">{k.algorithm}</span>
                )}
                <span className="text-[9px] text-muted-foreground">{k.size}b</span>
              </div>
            ))}
            {keysQ.data?.keys.length === 0 && (
              <p className="text-[10px] text-muted-foreground italic">Nessuna chiave trovata in ~/.ssh/</p>
            )}
          </div>
        </div>

        {/* VPS hosts */}
        <div className="pt-2 border-t border-border/50">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
            <Server className="w-3 h-3" /> VPS noti
          </div>
          <div className="space-y-1.5">
            {hostsQ.data?.hosts.map((h) => (
              <div key={h.id} className="flex items-start gap-2 text-xs">
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0 mt-1.5', h.category === 'production' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-slate-500')} />
                <div className="flex-1 min-w-0">
                  {/* V14.18 — Layout invertito: label dominante, IP cliccabile, hostname sotto */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold truncate">{h.label}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        navigator.clipboard.writeText(h.ip).then(
                          () => toast.success(`IP copiato: ${h.ip}`, { duration: 1800 }),
                          () => toast.error('Copia IP fallita')
                        )
                      }}
                      className="font-mono text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent rounded px-1 py-0.5 transition-colors flex items-center gap-1 cursor-pointer"
                      title="Click per copiare l'IP"
                    >
                      {h.ip}
                      <Copy className="w-2 h-2 opacity-60" />
                    </button>
                  </div>
                  {h.hostname && (
                    <div className="text-[10px] text-muted-foreground truncate">{h.hostname}</div>
                  )}
                  <div className="flex items-center gap-1.5 text-[9px]">
                    <span className={categoryColors[h.category] || 'text-slate-400'}>● {h.category}</span>
                    <span className="text-muted-foreground">· key: <code>{h.keyName}</code></span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
