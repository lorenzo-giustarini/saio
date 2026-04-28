import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { BarChart3, Heart, MessageSquare, AlertTriangle, GitBranch, Clock, Plus, Loader2, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TokenChart } from '@/components/metrics/TokenChart'
import { KnowledgeGrowth } from '@/components/metrics/KnowledgeGrowth'
import { api } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'

export function MetricsPage() {
  const queryClient = useQueryClient()
  const feedback = useQuery({
    queryKey: ['metrics', 'feedback'],
    queryFn: () => api.metrics.feedback(),
  })

  // V14.18 — Aggiungi nota feedback rapida
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const feedbackMut = useMutation({
    mutationFn: (text: string) => api.metrics.feedbackAdd(text),
    onSuccess: () => {
      toast.success('Nota di feedback salvata')
      setFeedbackOpen(false)
      setFeedbackText('')
      queryClient.invalidateQueries({ queryKey: ['metrics', 'feedback'] })
      queryClient.invalidateQueries({ queryKey: ['metrics', 'feedback-pending'] })
    },
    onError: (err: any) => {
      toast.error('Errore salvataggio nota', { description: String(err?.message || err) })
    },
  })

  // V14.19 — Pending count + AI 2-step processor
  const pending = useQuery({
    queryKey: ['metrics', 'feedback-pending'],
    queryFn: () => api.metrics.feedbackPendingCount(),
    refetchInterval: 30_000,
  })
  const processStatus = useQuery({
    queryKey: ['metrics', 'feedback-process-status'],
    queryFn: () => api.metrics.feedbackProcessStatus(),
    refetchInterval: 3_000,
  })
  const isJobActive = processStatus.data?.status === 'queued' || processStatus.data?.status === 'running'

  const processMut = useMutation({
    mutationFn: () => api.metrics.feedbackProcess(),
    onSuccess: () => {
      toast.success('Elaborazione AI avviata', {
        description: '2-step (meta-prompt + exec) per ogni feedback. Risultati arriveranno in Inbox come brief.',
        duration: 5000,
      })
      queryClient.invalidateQueries({ queryKey: ['metrics', 'feedback-process-status'] })
    },
    onError: (err: any) => {
      toast.error('Avvio elaborazione fallito', { description: String(err?.message || err) })
    },
  })
  const vaultHealth = useQuery<any>({
    queryKey: ['metrics', 'vault-health'],
    queryFn: async () => {
      const res = await fetch('/api/metrics/vault-health')
      return res.json()
    },
  })

  return (
    <div className="space-y-4 md:space-y-6 pb-12">
      <div className="flex items-center gap-3 flex-wrap">
        <BarChart3 className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Metriche & Self-improvement</h1>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2">
          <TokenChart />
        </div>
        <KnowledgeGrowth />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="relative overflow-hidden neon-card-red">
          <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-gradient-to-tr from-pink-500/20 to-transparent rounded-full blur-2xl pointer-events-none" />
          <CardHeader className="pb-2 relative">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-pink-400" />
              <h3 className="font-semibold text-sm">Vault Health (reale)</h3>
              {vaultHealth.data && (
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {vaultHealth.data.totalNotes} note totali
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 relative">
            {vaultHealth.data && (
              <>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Score globale</span>
                    <span className="font-mono font-semibold text-lg">{Math.round((vaultHealth.data.score || 0) * 100)}%</span>
                  </div>
                  <Progress value={(vaultHealth.data.score || 0) * 100} className="h-2" />
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                  <div className="text-center p-2 rounded border border-red-500/20 bg-red-500/5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Broken
                    </div>
                    <div className="font-mono text-lg text-red-400">{vaultHealth.data.brokenLinks}</div>
                    <div className="text-[9px] text-muted-foreground">link a note mancanti</div>
                  </div>
                  <div className="text-center p-2 rounded border border-amber-500/20 bg-amber-500/5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      Stale
                    </div>
                    <div className="font-mono text-lg text-amber-400">{vaultHealth.data.staleNotes}</div>
                    <div className="text-[9px] text-muted-foreground">&gt;90 giorni</div>
                  </div>
                  <div className="text-center p-2 rounded border border-slate-500/20 bg-slate-500/5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                      <GitBranch className="w-2.5 h-2.5" />
                      Orphan
                    </div>
                    <div className="font-mono text-lg text-slate-400">{vaultHealth.data.orphans}</div>
                    <div className="text-[9px] text-muted-foreground">senza backlink</div>
                  </div>
                </div>
                {vaultHealth.data.samples?.brokenLinks?.length > 0 && (
                  <div className="pt-2 border-t border-border/50">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Broken link samples
                    </div>
                    <div className="space-y-0.5">
                      {vaultHealth.data.samples.brokenLinks.slice(0, 3).map((b: any, i: number) => (
                        <div key={i} className="text-[10px] font-mono text-muted-foreground truncate">
                          [[{b.target}]] in {b.from.split('/').pop()}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card className="neon-card">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-semibold text-sm">Feedback recenti</h3>
              {/* V14.19 — badge pending + bottone Elabora con AI */}
              {pending.data && pending.data.pending > 0 && (
                <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-violet-500/50 text-violet-300 bg-violet-500/10">
                  {pending.data.pending} da elaborare
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-2">
                {pending.data && pending.data.pending > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] gap-1 border-violet-500/40 text-violet-300 hover:bg-violet-500/10"
                    onClick={() => processMut.mutate()}
                    disabled={isJobActive || processMut.isPending}
                    title="Elabora i feedback con AI (2-step: meta-prompt → exec). Genera brief con decisioni in Inbox."
                  >
                    {isJobActive ? (
                      <>
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {processStatus.data?.status === 'running'
                          ? `${processStatus.data.processed || 0}/${processStatus.data.total || '?'}`
                          : 'In coda...'}
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3" /> Elabora con AI
                      </>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] gap-1"
                  onClick={() => setFeedbackOpen(true)}
                  title="Annota un'osservazione rapida (pattern, errori AI, idee). Salvata in data/feedback/."
                >
                  <Plus className="w-3 h-3" /> Aggiungi nota
                </Button>
              </div>
            </div>
            {processStatus.data?.status === 'done' && processStatus.data.processed && processStatus.data.processed > 0 && (
              <div className="text-[10px] text-emerald-300/80 mt-1">
                ✓ Ultimo run: {processStatus.data.processed} elaborati, {processStatus.data.errors || 0} errori. Brief in Inbox.
              </div>
            )}
            {processStatus.data?.status === 'error' && (
              <div className="text-[10px] text-red-300/80 mt-1 truncate">
                ✗ Ultimo run errore: {processStatus.data.errorMessage}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {feedback.data?.items.length === 0 && (
              <div className="text-xs text-muted-foreground space-y-2 py-2">
                <p>Nessun feedback raccolto ancora.</p>
                <p className="text-[11px] leading-relaxed">
                  Annota qui osservazioni rapide su pattern, errori AI, idee da non perdere.
                  Le note vengono salvate in <code className="text-[10px] bg-muted px-1 rounded">data/feedback/</code> e
                  mostrate in ordine cronologico (max 10 visibili). Click su <strong>Aggiungi nota</strong> ↑ per inserire.
                </p>
              </div>
            )}
            <div className="space-y-2 max-h-60 overflow-auto scrollbar-thin">
              {feedback.data?.items.slice(0, 10).map((f) => (
                <div key={f.id} className="text-xs flex items-start gap-3 py-2 border-b border-border last:border-0">
                  <div className="text-[10px] text-muted-foreground shrink-0 w-20">
                    {formatRelativeTime(f.ts)}
                  </div>
                  <div className="flex-1 whitespace-pre-wrap break-words">{f.text}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* V14.18 — Dialog "Aggiungi nota di feedback" */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova nota di feedback</DialogTitle>
            <DialogDescription>
              Osservazione rapida da non perdere — pattern utili, errori dell'AI, idee, tweak da fare. Min 3, max 2000 caratteri.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            autoFocus
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder="Es. L'auto-submit Esc+Enter non funziona su Claude TUI, valutare alternative..."
            className="min-h-[120px] text-sm"
            maxLength={2000}
          />
          <div className="text-[10px] text-muted-foreground text-right">
            {feedbackText.trim().length} / 2000 · min 3
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackOpen(false)} disabled={feedbackMut.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() => feedbackMut.mutate(feedbackText)}
              disabled={feedbackMut.isPending || feedbackText.trim().length < 3}
              className="gap-1.5"
            >
              {feedbackMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Salva nota
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
