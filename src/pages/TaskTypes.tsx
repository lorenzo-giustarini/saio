import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Table,
  RefreshCw,
  Plus,
  Trash2,
  Search,
  AlertCircle,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const CATEGORY_COLORS: Record<string, string> = {
  dev: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  strategy: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
  creative: 'bg-pink-500/20 text-pink-300 border-pink-500/40',
  content: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  data: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  ops: 'bg-red-500/20 text-red-300 border-red-500/40',
  research: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  other: 'bg-slate-500/20 text-slate-300 border-slate-500/40',
}

export function TaskTypesPage() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const taskTypes = useQuery({
    queryKey: ['task-types'],
    queryFn: () => api.taskTypes.list(),
  })
  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.accounts.list(),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => api.taskTypes.update(id, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task-types'] })
    },
    onError: (err) => toast.error('Errore update', { description: String(err) }),
  })

  const removeMut = useMutation({
    mutationFn: (id: string) => api.taskTypes.remove(id),
    onSuccess: () => {
      toast.success('Task type rimosso')
      queryClient.invalidateQueries({ queryKey: ['task-types'] })
      setDeletingId(null)
    },
  })

  const scanMut = useMutation({
    mutationFn: () => api.taskTypes.scanSkills(),
    onSuccess: (data) => {
      if (data.added > 0) {
        toast.success(`${data.added} nuovi task-types da skill scan`)
        queryClient.invalidateQueries({ queryKey: ['task-types'] })
      } else {
        toast.info(`Skill scan: ${data.scanned} trovati, ${data.added} nuovi`)
      }
    },
    onError: (err) => toast.error('Errore scan', { description: String(err) }),
  })

  const filtered = (taskTypes.data?.taskTypes || []).filter((t: any) => {
    if (!query) return true
    const q = query.toLowerCase()
    return [t.id, t.label, t.description, t.category, ...(t.suggestedProviders || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q)
  })

  return (
    <div className="space-y-6 max-w-6xl pb-12">
      <div>
        <Link to="/accounts">
          <Button variant="ghost" size="sm" className="gap-1.5 mb-3 -ml-2">
            <ArrowLeft className="w-3.5 h-3.5" />
            Torna ad Account
          </Button>
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <Table className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Task-Types routing</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Tabella macro-task × account. Cron e agenti auto-routano secondo questa tabella.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => scanMut.mutate()}
              disabled={scanMut.isPending}
              className="gap-1.5"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', scanMut.isPending && 'animate-spin')} />
              Scan skill registry
            </Button>
          </div>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca task-type..."
          className="pl-9"
        />
      </div>

      {taskTypes.isLoading && (
        <div className="flex items-center gap-2 py-12 text-muted-foreground justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Caricamento...
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((t: any) => {
          const account = accounts.data?.accounts.find((a) => a.id === t.accountId)
          return (
            <Card key={t.id} className={cn(t.pendingAssignment && 'border-amber-500/30 bg-amber-500/5')}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={cn('text-[9px] h-4', CATEGORY_COLORS[t.category] || CATEGORY_COLORS.other)}>
                        {t.category}
                      </Badge>
                      <h3 className="font-medium text-sm truncate">{t.label}</h3>
                      <code className="text-[10px] bg-muted/40 px-1.5 rounded">{t.id}</code>
                      {t.pendingAssignment && (
                        <Badge variant="outline" className="text-[9px] h-4 border-amber-500/40 text-amber-300 gap-1">
                          <AlertCircle className="w-3 h-3" />
                          assegna
                        </Badge>
                      )}
                    </div>
                    {t.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{t.description}</p>
                    )}
                    {t.suggestedProviders?.length > 0 && (
                      <div className="text-[10px] text-muted-foreground mt-1">
                        Suggeriti: {t.suggestedProviders.join(', ')}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Select
                      value={t.accountId || '__none__'}
                      onValueChange={(val) => {
                        const newAccountId = val === '__none__' ? null : val
                        updateMut.mutate({
                          id: t.id,
                          patch: {
                            accountId: newAccountId,
                            pendingAssignment: !newAccountId,
                          },
                        })
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs w-48">
                        <SelectValue placeholder="(non assegnato)" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">
                          <span className="text-muted-foreground italic">(non assegnato)</span>
                        </SelectItem>
                        {(accounts.data?.accounts || []).map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="w-3 h-3 text-violet-400" />
                              <span>{a.label}</span>
                              <Badge variant="outline" className="text-[9px] h-4 ml-1">
                                {a.mode}
                              </Badge>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input
                      value={t.model || ''}
                      onChange={(e) => {
                        const val = e.target.value
                        clearTimeout((window as any).__tt_debounce)
                        ;(window as any).__tt_debounce = setTimeout(() => {
                          updateMut.mutate({ id: t.id, patch: { model: val || undefined } })
                        }, 800)
                      }}
                      placeholder={account?.defaultModel || 'modello default'}
                      className="h-8 text-xs w-40"
                    />

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingId(t.id)}
                      className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 w-8 p-0"
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <AlertDialog open={!!deletingId} onOpenChange={(o) => !o && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rimuovere task-type?</AlertDialogTitle>
            <AlertDialogDescription>
              Il routing per questo task-type sarà perso. Cron e agenti non potranno più selezionare
              automaticamente provider per questo tipo di task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={() => deletingId && removeMut.mutate(deletingId)}
            >
              Rimuovi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
