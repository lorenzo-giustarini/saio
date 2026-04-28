import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive as ArchiveIcon, Search, FileText, Clock, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatRelativeTime, cn } from '@/lib/utils'
import { toast } from 'sonner'

export function ArchivePage() {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['archive'],
    queryFn: () => api.archive.list(),
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  const filtered = useMemo(() => {
    if (!data) return []
    if (!query.trim()) return data.entries
    const q = query.toLowerCase()
    return data.entries.filter((e) => e.filename.toLowerCase().includes(q))
  }, [data, query])

  // V14.23 — Delete singolo + Clear all
  const [deleteFor, setDeleteFor] = useState<{ path: string; filename: string } | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearInput, setClearInput] = useState('')

  const deleteMut = useMutation({
    mutationFn: (path: string) => api.archive.deleteItem(path),
    onSuccess: () => {
      toast.success('Entry eliminata')
      setDeleteFor(null)
      qc.invalidateQueries({ queryKey: ['archive'] })
    },
    onError: (err) => toast.error('Errore delete', { description: String((err as any)?.message || err) }),
  })

  const clearMut = useMutation({
    mutationFn: () => api.archive.clearAll(),
    onSuccess: (data) => {
      toast.success(`Archivio pulito: ${data.deletedCount} file rimossi${data.errors.length ? ` · ${data.errors.length} errori` : ''}`)
      setClearOpen(false)
      setClearInput('')
      qc.invalidateQueries({ queryKey: ['archive'] })
    },
    onError: (err) => toast.error('Errore clear', { description: String((err as any)?.message || err) }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <ArchiveIcon className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Archivio decisioni</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.entries.length} risposte
          </span>
        )}
        {data && data.entries.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto gap-1.5 text-red-400/80 hover:text-red-300 hover:bg-red-500/10"
            onClick={() => {
              setClearOpen(true)
              setClearInput('')
            }}
            title="Cancella TUTTE le risposte archiviate (irreversibile)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Pulisci tutto
          </Button>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca per nome file..."
          className="pl-9"
        />
      </div>

      {isLoading && <p className="text-muted-foreground text-sm">Caricamento...</p>}

      <div className="space-y-2">
        {filtered.map((entry) => (
          <Card key={entry.path} className="neon-card cursor-pointer group">
            <CardContent className="py-3 flex items-center gap-3">
              <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-mono text-sm truncate">{entry.filename}</div>
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <Clock className="w-2.5 h-2.5" />
                  {formatRelativeTime(entry.date)}
                  <span>·</span>
                  <span>{(entry.size / 1024).toFixed(1)} KB</span>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-red-400/70 hover:text-red-300 hover:bg-red-500/10"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDeleteFor({ path: entry.path, filename: entry.filename })
                }}
                title="Elimina questa entry"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && !isLoading && (
          <p className="text-center text-muted-foreground py-12 text-sm">Nessun risultato</p>
        )}
      </div>

      {/* V14.23 — Dialog conferma delete singolo */}
      <Dialog
        open={!!deleteFor}
        onOpenChange={(o) => {
          if (!o && !deleteMut.isPending) {
            setDeleteFor(null)
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              Elimina entry archiviata?
            </DialogTitle>
            <DialogDescription>
              File: <code className="text-[11px] bg-muted px-1 rounded">{deleteFor?.filename}</code>
              <div className="mt-2 text-amber-300/80 text-[11px]">
                ⚠ Azione irreversibile. Il file JSON viene rimosso definitivamente.
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleteFor(null)}
              disabled={deleteMut.isPending}
            >
              Annulla
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteFor && deleteMut.mutate(deleteFor.path)}
              disabled={deleteMut.isPending}
              className="gap-1.5"
            >
              {deleteMut.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Eliminazione…
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Elimina
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* V14.23 — Dialog conferma Pulisci tutto */}
      <Dialog
        open={clearOpen}
        onOpenChange={(o) => {
          if (!o && !clearMut.isPending) {
            setClearOpen(false)
            setClearInput('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              Pulisci tutto l'archivio
            </DialogTitle>
            <DialogDescription>
              Verranno eliminate <strong className="text-red-400">{data?.entries.length || 0}</strong> risposte archiviate
              da <code>data/archive/</code> e <code>data/responses/</code>.
              <div className="mt-2 text-amber-300/80">⚠ Azione irreversibile.</div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs">
              Per confermare digita <code className="bg-muted px-1 py-0.5 rounded text-red-300 font-bold">DELETE-ALL</code> e premi Invio:
            </label>
            <Input
              value={clearInput}
              onChange={(e) => setClearInput(e.target.value)}
              placeholder="DELETE-ALL"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && clearInput === 'DELETE-ALL' && !clearMut.isPending) {
                  e.preventDefault()
                  clearMut.mutate()
                }
              }}
              className={cn(
                'font-mono',
                clearInput === 'DELETE-ALL' && 'border-red-500/60 ring-1 ring-red-500/40'
              )}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setClearOpen(false)
                setClearInput('')
              }}
              disabled={clearMut.isPending}
            >
              Annulla
            </Button>
            <Button
              variant="destructive"
              disabled={clearInput !== 'DELETE-ALL' || clearMut.isPending}
              onClick={() => clearMut.mutate()}
              className="gap-1.5"
            >
              {clearMut.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Pulizia…
                </>
              ) : (
                <>
                  <Trash2 className="w-3.5 h-3.5" />
                  Pulisci tutto
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
