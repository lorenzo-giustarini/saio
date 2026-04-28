import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import {
  BookOpen, AlertOctagon, Wrench, Search, Calendar, Tag, Clock, Loader2, RefreshCw,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface RecipeIndexItem {
  slug: string
  title: string
  tags: string[]
  sessionsSeenCount: number
  discoveredAt: string
  timeSavedMin?: number
  filePath: string
}

interface RecipeIndex {
  lastBuiltAt: string | null
  antiPatterns: RecipeIndexItem[]
  atomic: RecipeIndexItem[]
  hint?: string
}

async function fetchIndex(): Promise<RecipeIndex> {
  const res = await fetch('/api/recipes')
  if (!res.ok) throw new Error('failed')
  return res.json()
}

async function fetchRecipe(type: 'anti-patterns' | 'atomic', slug: string): Promise<{ content: string; slug: string; type: string }> {
  const res = await fetch(`/api/recipes/${type}/${encodeURIComponent(slug)}`)
  if (!res.ok) throw new Error((await res.json()).error || 'failed')
  return res.json()
}

async function triggerBuild(): Promise<{ pid?: number; hint: string }> {
  const res = await fetch('/api/recipes/build', { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).error || 'failed')
  return res.json()
}

export function RecipesPage() {
  const qc = useQueryClient()
  const indexQ = useQuery({ queryKey: ['recipes', 'index'], queryFn: fetchIndex, refetchInterval: 60_000 })
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'anti-patterns' | 'atomic'>('anti-patterns')
  const [selected, setSelected] = useState<{ type: 'anti-patterns' | 'atomic'; slug: string; title: string } | null>(null)

  const detailQ = useQuery({
    queryKey: ['recipes', 'detail', selected?.type, selected?.slug],
    queryFn: () => fetchRecipe(selected!.type, selected!.slug),
    enabled: !!selected,
  })

  const buildMut = useMutation({
    mutationFn: triggerBuild,
    onSuccess: (d) => toast.success('Build avviato in background', { description: d.hint }),
    onError: (e: any) => toast.error('Build fallito', { description: String(e.message || e) }),
  })

  const filtered = useMemo(() => {
    if (!indexQ.data) return { antiPatterns: [], atomic: [] }
    const q = search.toLowerCase().trim()
    const filterFn = (r: RecipeIndexItem) =>
      !q ||
      r.title.toLowerCase().includes(q) ||
      r.tags.some((t) => t.toLowerCase().includes(q))
    return {
      antiPatterns: indexQ.data.antiPatterns.filter(filterFn),
      atomic: indexQ.data.atomic.filter(filterFn),
    }
  }, [indexQ.data, search])

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-violet-400" />
          <h1 className="text-xl font-semibold">Recipes</h1>
        </div>
        <Badge variant="outline" className="text-[10px]">
          Self-learning AI memory
        </Badge>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {indexQ.data?.lastBuiltAt
            ? `Last build: ${new Date(indexQ.data.lastBuiltAt).toLocaleString()}`
            : 'Never built'}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => buildMut.mutate()}
          disabled={buildMut.isPending}
          className="gap-1 h-7 text-xs"
        >
          {buildMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Build now
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Cron daily 03:00 legge le sessioni Claude Code ultime 24h e produce <strong>anti-pattern strutturali</strong> (errori da non rifare) e
        <strong> atomic recipes</strong> (task tecnici riusabili). Le ricette sono consultabili a richiesta — non vengono iniettate automaticamente nei prompt.
      </p>

      {indexQ.data?.hint && (
        <Card className="neon-card-amber">
          <CardContent className="pt-3 pb-3 text-xs text-amber-200">
            {indexQ.data.hint}
          </CardContent>
        </Card>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per titolo o tag..."
            className="pl-8"
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList>
          <TabsTrigger value="anti-patterns" className="gap-1.5">
            <AlertOctagon className="w-3 h-3" /> Anti-pattern ({filtered.antiPatterns.length})
          </TabsTrigger>
          <TabsTrigger value="atomic" className="gap-1.5">
            <Wrench className="w-3 h-3" /> Atomic recipes ({filtered.atomic.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="anti-patterns" className="mt-3">
          <RecipeList items={filtered.antiPatterns} type="anti-patterns" onSelect={setSelected} />
        </TabsContent>

        <TabsContent value="atomic" className="mt-3">
          <RecipeList items={filtered.atomic} type="atomic" onSelect={setSelected} />
        </TabsContent>
      </Tabs>

      {/* Detail Sheet */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {selected?.type === 'anti-patterns' ? <AlertOctagon className="w-4 h-4 text-red-400" /> : <Wrench className="w-4 h-4 text-emerald-400" />}
              {selected?.title}
            </SheetTitle>
            <SheetDescription>
              <code className="text-[10px] font-mono">recipes/{selected?.type}/{selected?.slug}.md</code>
            </SheetDescription>
          </SheetHeader>
          <ScrollArea className="mt-4 max-h-[80vh] pr-3">
            {detailQ.isLoading && <div className="py-12 text-center text-muted-foreground text-sm">Caricamento...</div>}
            {detailQ.error && <div className="py-4 text-red-400 text-sm">Errore: {String((detailQ.error as any)?.message || '')}</div>}
            {detailQ.data && (
              <pre className="text-xs font-mono whitespace-pre-wrap break-words leading-relaxed">
                {detailQ.data.content}
              </pre>
            )}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function RecipeList({
  items,
  type,
  onSelect,
}: {
  items: RecipeIndexItem[]
  type: 'anti-patterns' | 'atomic'
  onSelect: (sel: { type: 'anti-patterns' | 'atomic'; slug: string; title: string }) => void
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Nessuna recipe in questa categoria. {type === 'anti-patterns' ? 'Verrà popolata appena la AI incontra errori strutturali ricorrenti.' : 'Verrà popolata appena la AI completa task atomici con trial-and-error.'}
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {items.map((r) => (
        <Card
          key={r.slug}
          className={cn(
            'cursor-pointer hover:border-violet-500 transition-colors',
            type === 'anti-patterns' ? 'neon-card-red' : 'neon-card-green'
          )}
          onClick={() => onSelect({ type, slug: r.slug, title: r.title })}
        >
          <CardHeader className="pb-2">
            <h3 className="font-semibold text-sm leading-tight">{r.title}</h3>
          </CardHeader>
          <CardContent className="pt-0 pb-3 space-y-1.5 text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="w-3 h-3" />
              <span>Discovered {r.discoveredAt}</span>
              <span className="opacity-60">·</span>
              <span>seen {r.sessionsSeenCount}×</span>
              {r.timeSavedMin ? (
                <>
                  <span className="opacity-60">·</span>
                  <Clock className="w-3 h-3" />
                  <span>saves {r.timeSavedMin}min</span>
                </>
              ) : null}
            </div>
            {r.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                <Tag className="w-2.5 h-2.5 text-muted-foreground" />
                {r.tags.slice(0, 5).map((t) => (
                  <Badge key={t} variant="outline" className="text-[9px] h-4 px-1.5">{t}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
