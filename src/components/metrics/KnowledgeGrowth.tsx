import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brain, TrendingUp, FileText, GitBranch, BookOpen, Bug, Info, X, ExternalLink } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip, CartesianGrid } from 'recharts'
import { formatRelativeTime, cn } from '@/lib/utils'

async function fetchKnowledge() {
  const res = await fetch('/api/metrics/knowledge-growth')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<{
    buckets: Record<string, { total: number; research: number; feedback: number; project: number; moc: number; debug: number }>
    weeklyTimeline: Array<{ week: string; count: number }>
  }>
}

async function fetchFiles(category: string) {
  const res = await fetch(`/api/metrics/knowledge-files?category=${category}&days=7`)
  return res.json() as Promise<{
    items: Array<{ path: string; name: string; mtime: string; size: number }>
  }>
}

const categoryIcons: Record<string, any> = {
  research: BookOpen,
  feedback: TrendingUp,
  project: FileText,
  moc: GitBranch,
  debug: Bug,
}

const categoryLabels: Record<string, string> = {
  research: 'Ricerche',
  feedback: 'Feedback',
  project: 'Progetti',
  moc: 'MOC',
  debug: 'Debug',
}

const categoryColors: Record<string, string> = {
  research: 'text-purple-400',
  feedback: 'text-amber-400',
  project: 'text-blue-400',
  moc: 'text-emerald-400',
  debug: 'text-red-400',
}

// V14.18 — neon hover per i 3 sub-box periodo (1d=emerald, 7d=violet, 30d=amber)
const periodColors: Record<string, string> = {
  '1d': 'hover:border-emerald-500/60 hover:shadow-[0_0_15px_rgba(16,185,129,0.3)] hover:bg-emerald-500/5',
  '7d': 'hover:border-violet-500/60 hover:shadow-[0_0_15px_rgba(139,92,246,0.3)] hover:bg-violet-500/5',
  '30d': 'hover:border-amber-500/60 hover:shadow-[0_0_15px_rgba(245,158,11,0.3)] hover:bg-amber-500/5',
}

export function KnowledgeGrowth() {
  const navigate = useNavigate()
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['metrics', 'knowledge-growth'],
    queryFn: fetchKnowledge,
    refetchInterval: 300_000,
    staleTime: 120_000,
  })

  const filesQ = useQuery({
    queryKey: ['metrics', 'knowledge-files', openCategory],
    queryFn: () => fetchFiles(openCategory!),
    enabled: !!openCategory,
  })

  const timelineData = data?.weeklyTimeline.map((w) => ({ week: w.week.slice(5), count: w.count })) || []

  return (
    <>
      <Card className="relative overflow-hidden neon-card-purple">
        <div className="absolute -top-8 -right-8 w-32 h-32 bg-gradient-to-br from-primary/20 to-transparent rounded-full blur-2xl pointer-events-none" />
        <CardHeader className="pb-2 relative">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-400" />
            <h3 className="font-semibold text-sm">Knowledge Growth</h3>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-3 h-3 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  <div className="text-xs space-y-1">
                    <div>Conta i file del vault Obsidian creati/modificati per periodo.</div>
                    <div className="text-muted-foreground text-[10px] pt-1">Click su una categoria per vedere i file recenti.</div>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <p className="text-[10px] text-muted-foreground">File vault creati/modificati per periodo · click categoria per dettaglio</p>
        </CardHeader>
        <CardContent className="space-y-4 relative">
          {isLoading && <p className="text-xs text-muted-foreground">Scanning vault...</p>}

          {data && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {(['1d', '7d', '30d'] as const).map((period) => {
                  const b = data.buckets[period]
                  return (
                    <div
                      key={period}
                      className={cn(
                        'text-center p-2 rounded-md bg-muted/30 border border-border/50 transition-all duration-200 cursor-default',
                        periodColors[period]
                      )}
                    >
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                        {period === '1d' ? 'Giorno' : period === '7d' ? '7 giorni' : '30 giorni'}
                      </div>
                      <div className="text-2xl font-bold text-primary">{b.total}</div>
                      <div className="text-[10px] text-muted-foreground">file toccati</div>
                    </div>
                  )
                })}
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                  Breakdown 7 giorni · <span className="text-primary">clicca per vedere</span>
                </div>
                <div className="grid grid-cols-5 gap-1">
                  {(['research', 'feedback', 'project', 'moc', 'debug'] as const).map((cat) => {
                    const Icon = categoryIcons[cat]
                    const count = data.buckets['7d'][cat]
                    return (
                      <button
                        key={cat}
                        onClick={() => setOpenCategory(cat)}
                        className="text-center p-1.5 rounded border border-border/40 bg-card/50 hover:bg-accent hover:border-primary/40 transition-all cursor-pointer"
                      >
                        <Icon className={`w-3 h-3 mx-auto mb-0.5 ${categoryColors[cat]}`} />
                        <div className="text-sm font-semibold">{count}</div>
                        <div className="text-[9px] text-muted-foreground">{categoryLabels[cat]}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {timelineData.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Settimane recenti</div>
                  <div className="h-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={timelineData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                        <XAxis dataKey="week" tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 9, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
                        <RTooltip
                          contentStyle={{
                            backgroundColor: 'hsl(var(--popover))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: 8,
                            fontSize: 11,
                          }}
                        />
                        <Bar dataKey="count" fill="url(#gradPurple)" radius={[4, 4, 0, 0]} />
                        <defs>
                          <linearGradient id="gradPurple" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.9} />
                            <stop offset="100%" stopColor="#7c3aed" stopOpacity={0.3} />
                          </linearGradient>
                        </defs>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Modal lista file */}
      <Dialog open={!!openCategory} onOpenChange={(open) => !open && setOpenCategory(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {openCategory && (() => {
                const Icon = categoryIcons[openCategory]
                return <Icon className={`w-5 h-5 ${categoryColors[openCategory]}`} />
              })()}
              {openCategory && categoryLabels[openCategory]} — ultimi 7 giorni
            </DialogTitle>
            <DialogDescription className="text-xs">
              {filesQ.data?.items.length || 0} file modificati. Click per aprire nel vault.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-3">
            <div className="space-y-1">
              {filesQ.isLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
              {filesQ.data?.items.length === 0 && (
                <p className="text-xs text-muted-foreground">Nessun file in questa categoria negli ultimi 7 giorni.</p>
              )}
              {filesQ.data?.items.map((f) => (
                <button
                  key={f.path}
                  onClick={() => {
                    setOpenCategory(null)
                    navigate(`/docs?file=${encodeURIComponent(f.path)}`)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 py-2 px-3 rounded-md border border-border/40 bg-card/30 hover:bg-accent hover:border-primary/40 transition-all text-left group'
                  )}
                >
                  <FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{f.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate font-mono">{f.path}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground shrink-0">
                    {formatRelativeTime(f.mtime)}
                  </div>
                  <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  )
}
