import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Microscope, FileText, Loader2, Clock, Play, ArrowLeft, ExternalLink, Zap
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { cn, formatRelativeTime } from '@/lib/utils'

const MODES = [
  { id: 'quick' as const, label: 'Quick', time: '~5 min', phases: 3, color: 'text-emerald-400', desc: 'Panoramica veloce su topic noti' },
  { id: 'standard' as const, label: 'Standard', time: '~15 min', phases: 6, color: 'text-blue-400', desc: 'Ricerca bilanciata — default' },
  { id: 'deep' as const, label: 'Deep', time: '~30 min', phases: 8, color: 'text-amber-400', desc: 'Analisi approfondita con fonti accademiche' },
  { id: 'ultradeep' as const, label: 'UltraDeep', time: '60+ min', phases: '8+', color: 'text-red-400', desc: 'Recursive agent con context preservation per topic complessi' },
]

interface Research {
  slug: string
  dir: string
  title: string
  completedAt: string
  pdfPath: string | null
  sizeMB: number
}

async function fetchList() {
  const res = await fetch('/api/deep-research/list')
  return res.json() as Promise<{ items: Research[] }>
}

export function DeepResearchPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'quick' | 'standard' | 'deep' | 'ultradeep'>('standard')

  const listQ = useQuery({ queryKey: ['deep-research', 'list'], queryFn: fetchList, refetchInterval: 30_000 })

  const startMut = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/deep-research/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title || query.slice(0, 60), query, mode }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }))
        throw new Error(err.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: (d: any) => {
      if (d.spawned) {
        toast.success('Deep research avviato', {
          description: `Finestra "${d.terminalTitle}" aperta — digita ${d.kickoffMessage ? 'il prompt' : '/deep-research ...'} dentro Claude`,
          duration: 8000,
        })
      } else {
        toast.error('Spawn fallito', { description: d.error })
      }
    },
    onError: (e: any) => toast.error('Errore', { description: String(e) }),
  })

  const valid = query.trim().length >= 3

  return (
    <div className="space-y-4 md:space-y-6 pb-12">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5 -ml-2">
        <ArrowLeft className="w-3.5 h-3.5" /> Indietro
      </Button>

      <div className="flex items-center gap-3 flex-wrap">
        <Microscope className="w-6 h-6 text-purple-400" />
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Deep Research</h1>
        <span className="text-xs text-muted-foreground">skill /deep-research · output PDF + MD + HTML in ~/Documents/</span>
      </div>

      <Card className="neon-card-purple">
        <CardHeader className="pb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-400" />
            Nuova ricerca
          </h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Titolo (breve)</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Es. Herbalife UK legal bridge" maxLength={120} />
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Query / topic di ricerca *</label>
            <Textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Descrivi cosa vuoi ricercare. Più contesto dai (background, obiettivi, constraints), più specifico sarà il risultato."
              className="min-h-[120px] resize-y"
              maxLength={2000}
            />
            <div className="text-[10px] text-muted-foreground mt-1">{query.length}/2000 · min 3</div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground mb-2 block">Modalità</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={cn(
                    'rounded-md border p-3 text-left transition-all',
                    mode === m.id
                      ? 'border-primary/60 bg-primary/10 shadow-[0_0_15px_rgba(147,51,234,0.2)]'
                      : 'border-border/50 hover:border-border bg-muted/20'
                  )}
                >
                  <div className={cn('font-semibold text-sm', m.color)}>{m.label}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {m.time} · {m.phases} fasi
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[10px] text-muted-foreground">
              Output salvato in <code className="bg-muted px-1 py-0.5 rounded">~/Documents/[Title]_Research_[Date]/</code> con PDF + Markdown + HTML
            </div>
            <Button
              size="lg"
              onClick={() => startMut.mutate()}
              disabled={!valid || startMut.isPending}
              className="gap-1.5"
            >
              {startMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Avvia ricerca
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Storico ricerche */}
      <Card className="neon-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Ricerche precedenti</h2>
            {listQ.data && (
              <span className="ml-auto text-[10px] text-muted-foreground">{listQ.data.items.length} completate</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {listQ.data?.items.length === 0 && (
            <p className="text-xs text-muted-foreground">Nessuna ricerca ancora completata. Avvia la prima qui sopra.</p>
          )}
          <div className="space-y-2">
            {listQ.data?.items.map((r) => (
              <div key={r.dir} className="flex items-center gap-3 rounded-md border border-border/50 bg-muted/20 px-3 py-2 neon-card">
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{r.dir}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0 text-[10px]">
                  <span className="text-muted-foreground">{formatRelativeTime(r.completedAt)}</span>
                  {r.pdfPath && (
                    <>
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">{r.sizeMB}MB</Badge>
                      <a
                        href={`/api/deep-research/pdf?path=${encodeURIComponent(r.pdfPath)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline flex items-center gap-1"
                      >
                        <ExternalLink className="w-2.5 h-2.5" /> PDF
                      </a>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
