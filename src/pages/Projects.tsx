import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  FolderKanban,
  Loader2,
  ChevronRight,
  Search,
  X,
  Plus,
  FolderTree as FolderTreeIcon,
  Archive as ArchiveIcon,
  ArchiveRestore,
  ChevronDown,
  Trash2,
  AlertTriangle,
  MoreVertical,
  Pencil,
  CheckSquare,
  Square,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SessionStatusDot } from '@/components/projects/SessionStatusDot'
import { FolderTree, listAllFolders } from '@/components/projects/FolderTree'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const ACTIVE_PREVIEW_COUNT = 4

// Project health status → border glow on hover. Session status is displayed via
// the SessionStatusDot (blue/green/amber/slate) placed before the project name.
const statusBorder: Record<string, string> = {
  green: 'hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]',
  yellow: 'hover:border-amber-500/50 hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]',
  red: 'hover:border-red-500/50 hover:shadow-[0_0_20px_rgba(239,68,68,0.15)]',
  paused: 'hover:border-slate-500/50',
  unknown: 'hover:border-slate-500/50',
}

// V14.18 — ProjectCard con kebab menu (rename/move/archive) + supporto selectionMode (checkbox + click=select)
interface ProjectCardProps {
  p: any
  allFolders: string[]
  selectionMode?: boolean
  selected?: boolean
  onToggleSelect?: (id: string) => void
  onRename?: (p: any) => void
  onMove?: (id: string, folder: string | undefined) => void
  onNewFolder?: (id: string) => void
  onArchive?: (id: string) => void
}

function ProjectCard({
  p,
  allFolders,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onRename,
  onMove,
  onNewFolder,
  onArchive,
}: ProjectCardProps) {
  const cardBody = (
    <Card
      className={cn(
        'transition-all duration-300 cursor-pointer h-full relative',
        statusBorder[p.status] || statusBorder.unknown,
        selectionMode && selected && 'border-violet-500/60 shadow-[0_0_20px_rgba(139,92,246,0.25)] bg-violet-500/5'
      )}
    >
      <CardContent className="pt-5 pb-4 space-y-3 relative">
        {/* Selection checkbox top-left in selectionMode */}
        {selectionMode && (
          <div className="absolute top-3 left-3 z-10">
            {selected ? (
              <CheckSquare className="w-4 h-4 text-violet-400" />
            ) : (
              <Square className="w-4 h-4 text-muted-foreground" />
            )}
          </div>
        )}

        {/* Kebab menu top-right (visible only outside selectionMode) */}
        {!selectionMode && (
          <div
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 hover:bg-accent"
                  onClick={(e) => e.preventDefault()}
                  title="Azioni progetto"
                >
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {p.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onRename?.(p)}>
                  <Pencil className="w-3.5 h-3.5 mr-2" /> Rinomina...
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <FolderTreeIcon className="w-3.5 h-3.5 mr-2 text-violet-400" />
                    Sposta in...
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56">
                    <DropdownMenuItem onClick={() => onMove?.(p.id, undefined)}>
                      <span className="text-xs italic text-muted-foreground">(root — nessuna)</span>
                    </DropdownMenuItem>
                    {allFolders.length === 0 ? (
                      <DropdownMenuItem disabled>
                        <span className="text-xs italic text-muted-foreground">Nessuna cartella</span>
                      </DropdownMenuItem>
                    ) : (
                      allFolders.map((f) => (
                        <DropdownMenuItem key={f} onClick={() => onMove?.(p.id, f)}>
                          <FolderTreeIcon className="w-3.5 h-3.5 mr-2 text-violet-400" />
                          <span className="text-xs truncate">{f}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => onNewFolder?.(p.id)} className="text-primary">
                      <Plus className="w-3.5 h-3.5 mr-2" /> Nuova cartella...
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onArchive?.(p.id)}
                  className="text-amber-400 focus:text-amber-300"
                >
                  <ArchiveIcon className="w-3.5 h-3.5 mr-2" /> Archivia
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {!selectionMode && (
          <ChevronRight className="absolute top-4 right-10 w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        )}
        <div className={cn('flex items-start justify-between gap-2', selectionMode ? 'pl-7' : 'pr-5')}>
          <div className="flex items-center gap-2 min-w-0">
            <SessionStatusDot status={p.sessionStatus || 'idle'} />
            <h3 className="font-semibold text-sm leading-tight truncate">{p.name}</h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {p.category && (
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {p.category}
              </Badge>
            )}
          </div>
        </div>
        {p.folder && (
          <div className={cn('text-[10px] text-muted-foreground flex items-center gap-1', selectionMode && 'pl-7')}>
            <FolderTreeIcon className="w-3 h-3" />
            <span className="truncate">{p.folder}</span>
          </div>
        )}
        {p.nextAction && (
          <div className={selectionMode ? 'pl-7' : ''}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
              Next
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed line-clamp-2">
              {p.nextAction}
            </p>
          </div>
        )}
        <div className={cn('flex items-center gap-2 pt-1 text-[10px] text-muted-foreground flex-wrap', selectionMode && 'pl-7')}>
          <code className="bg-muted px-1.5 py-0.5 rounded">{p.id}</code>
          {p.tags?.slice(0, 2).map((t: string) => (
            <span key={t} className="opacity-70">
              #{t}
            </span>
          ))}
        </div>
      </CardContent>
    </Card>
  )

  if (selectionMode) {
    return (
      <button
        type="button"
        onClick={() => onToggleSelect?.(p.id)}
        className="group text-left w-full"
      >
        {cardBody}
      </button>
    )
  }
  return (
    <Link to={`/projects/${p.id}`} className="group block">
      {cardBody}
    </Link>
  )
}

function ArchivedCard({
  p,
  onRestore,
  onDelete,
}: {
  p: any
  onRestore: (id: string) => void
  onDelete: (p: any) => void
}) {
  return (
    <Card className="border-dashed opacity-80 hover:opacity-100 transition-opacity">
      <CardContent className="py-3 px-4 flex items-center gap-3">
        <Link to={`/projects/${p.id}`} className="flex items-center gap-2 flex-1 min-w-0 group">
          <ArchiveIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-sm truncate group-hover:text-primary transition-colors">
                {p.name}
              </h4>
              {p.folder && (
                <span className="text-[10px] text-muted-foreground">· {p.folder}</span>
              )}
            </div>
            {p.archivedAt && (
              <p className="text-[10px] text-muted-foreground">
                Archiviato il {new Date(p.archivedAt).toLocaleDateString('it-IT')}
              </p>
            )}
          </div>
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 shrink-0"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRestore(p.id)
          }}
          title="Sposta nuovamente nei progetti attivi"
        >
          <ArchiveRestore className="w-3.5 h-3.5" />
          <span className="text-xs">Ripristina</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 shrink-0 text-red-400/80 hover:text-red-300 hover:bg-red-500/10"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete(p)
          }}
          title="Elimina definitivamente progetto + tutti i file correlati"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span className="text-xs">Elimina</span>
        </Button>
      </CardContent>
    </Card>
  )
}

export function ProjectsPage() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [showAllActive, setShowAllActive] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.projects.list(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.projects.restore(id),
    onSuccess: (_, id) => {
      toast.success('Progetto ripristinato', { description: id })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error('Errore ripristino', { description: String(err) }),
  })

  // V14.8 — hard delete con conferma DELETE
  const [deleteFor, setDeleteFor] = useState<{ id: string; name: string } | null>(null)
  const [deleteConfirmInput, setDeleteConfirmInput] = useState('')
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.projects.deleteHard(id),
    onSuccess: (data) => {
      toast.success('Progetto eliminato definitivamente', {
        description: `${data.deletedFiles.length} file rimossi${data.errors.length ? ` · ${data.errors.length} errori` : ''}`,
      })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setDeleteFor(null)
      setDeleteConfirmInput('')
    },
    onError: (err) => toast.error('Errore eliminazione', { description: String(err) }),
  })

  // V14.18 — Rename + Move + NewFolder + Archive + batch selection
  const [renameFor, setRenameFor] = useState<{ id: string; name: string } | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [newFolderFor, setNewFolderFor] = useState<{ ids: string[] } | null>(null)
  const [newFolderInput, setNewFolderInput] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.projects.patch(id, { name } as any),
    onSuccess: (_, vars) => {
      toast.success('Progetto rinominato', { description: vars.name })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setRenameFor(null)
      setRenameInput('')
    },
    onError: (err) => toast.error('Errore rename', { description: String(err) }),
  })
  const moveMut = useMutation({
    mutationFn: ({ id, folder }: { id: string; folder: string | undefined }) =>
      api.projects.move(id, folder),
    onSuccess: (_, vars) => {
      toast.success(vars.folder ? `Spostato in "${vars.folder}"` : 'Spostato in root')
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error('Errore spostamento', { description: String(err) }),
  })
  const archiveMut = useMutation({
    mutationFn: (id: string) => api.projects.archive(id),
    onSuccess: () => {
      toast.success('Archiviato')
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
    onError: (err) => toast.error('Errore archive', { description: String(err) }),
  })
  // Batch ops: tutte parallele
  const batchMoveMut = useMutation({
    mutationFn: async ({ ids, folder }: { ids: string[]; folder: string | undefined }) => {
      const results = await Promise.allSettled(ids.map((id) => api.projects.move(id, folder)))
      return results
    },
    onSuccess: (results, vars) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const ko = results.length - ok
      toast.success(`${ok} progetti spostati${vars.folder ? ` in "${vars.folder}"` : ' in root'}${ko > 0 ? ` · ${ko} errori` : ''}`)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setSelectedIds(new Set())
      setSelectionMode(false)
    },
    onError: (err) => toast.error('Errore batch move', { description: String(err) }),
  })
  const batchArchiveMut = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.allSettled(ids.map((id) => api.projects.archive(id)))
      return results
    },
    onSuccess: (results) => {
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const ko = results.length - ok
      toast.success(`${ok} progetti archiviati${ko > 0 ? ` · ${ko} errori` : ''}`)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setSelectedIds(new Set())
      setSelectionMode(false)
    },
    onError: (err) => toast.error('Errore batch archive', { description: String(err) }),
  })

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { active, archived, filteredActive, filteredArchived, tokenized } = useMemo(() => {
    const all = (data?.projects || []) as any[]
    const q = query.trim().toLowerCase()
    const matches = (p: any) => {
      if (!q) return true
      const haystack = [p.name, p.id, p.category, p.nextAction, p.folder, ...(p.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    }
    const activeList = all.filter((p) => !p.archived)
    const archivedList = all.filter((p) => p.archived)
    return {
      active: activeList,
      archived: archivedList,
      filteredActive: activeList.filter(matches),
      filteredArchived: archivedList.filter(matches),
      tokenized: !!q,
    }
  }, [data, query])

  const activePreview = showAllActive || tokenized ? filteredActive : filteredActive.slice(0, ACTIVE_PREVIEW_COUNT)
  const hasMoreActive = filteredActive.length > ACTIVE_PREVIEW_COUNT && !tokenized

  // V14.18 — derive folders for kebab move submenu
  const allFolders = useMemo(() => listAllFolders(active as any), [active])

  return (
    <div className="space-y-6 md:space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <FolderKanban className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Progetti</h1>
        {data && (
          <span className="text-xs md:text-sm text-muted-foreground">
            {active.length} attivi · {archived.length} archiviati
          </span>
        )}
        <Link to="/projects/new" className="ml-auto">
          <Button size="sm" className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Nuovo progetto
          </Button>
        </Link>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca in tutti i progetti, cartelle, archivio..."
          className="pl-9 pr-8"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Caricamento progetti...
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm">
          Errore: {String(error)}
        </div>
      )}

      {/* SEZIONE 1: Progetti attivi (preview 4 + "Vedi tutti") */}
      {!isLoading && (
        <section className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
              Attivi
            </h2>
            <span className="text-xs text-muted-foreground">
              {tokenized
                ? `${filteredActive.length} match`
                : showAllActive
                ? `tutti ${filteredActive.length}`
                : `${Math.min(ACTIVE_PREVIEW_COUNT, filteredActive.length)} di ${filteredActive.length}`}
            </span>
            <div className="ml-auto flex items-center gap-2">
              {/* V14.18 — toggle selection mode */}
              <Button
                variant={selectionMode ? 'default' : 'ghost'}
                size="sm"
                onClick={() => {
                  setSelectionMode((x) => {
                    if (x) setSelectedIds(new Set())
                    return !x
                  })
                }}
                className="gap-1.5 text-xs"
                title={selectionMode ? 'Esci da selezione multipla' : 'Seleziona più progetti per azioni di massa'}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                {selectionMode ? 'Esci da selezione' : 'Seleziona multipli'}
              </Button>
              {hasMoreActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAllActive((x) => !x)}
                  className="gap-1.5 text-xs"
                >
                  {showAllActive ? (
                    <>
                      Comprimi
                      <ChevronDown className="w-3 h-3 rotate-180 transition-transform" />
                    </>
                  ) : (
                    <>
                      Vedi tutti ({filteredActive.length})
                      <ChevronDown className="w-3 h-3" />
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
          {activePreview.length === 0 ? (
            <div className="text-sm text-muted-foreground italic py-6 text-center">
              {tokenized
                ? `Nessun attivo per "${query}"`
                : 'Nessun progetto attivo. Crea il primo con "+ Nuovo progetto".'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {activePreview.map((p) => (
                <ProjectCard
                  key={p.id}
                  p={p}
                  allFolders={allFolders}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(p.id)}
                  onToggleSelect={toggleSelect}
                  onRename={(proj) => {
                    setRenameFor({ id: proj.id, name: proj.name })
                    setRenameInput(proj.name)
                  }}
                  onMove={(id, folder) => moveMut.mutate({ id, folder })}
                  onNewFolder={(id) => {
                    setNewFolderFor({ ids: [id] })
                    setNewFolderInput('')
                  }}
                  onArchive={(id) => archiveMut.mutate(id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* SEZIONE 2: Cartelle (tree) */}
      {!isLoading && filteredActive.some((p) => p.folder) && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <FolderTreeIcon className="w-4 h-4 text-violet-400" />
            <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
              Cartelle
            </h2>
          </div>
          <Card className="bg-muted/10">
            <CardContent className="py-3">
              <FolderTree projects={filteredActive} />
            </CardContent>
          </Card>
        </section>
      )}

      {/* SEZIONE 3: Archiviati (collapsed) */}
      {!isLoading && filteredArchived.length > 0 && (
        <section className="space-y-3">
          <button
            onClick={() => setArchivedOpen((x) => !x)}
            className="flex items-center gap-3 w-full text-left hover:opacity-80 transition-opacity"
          >
            <ArchiveIcon className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold tracking-tight uppercase text-muted-foreground">
              Archiviati
            </h2>
            <span className="text-xs text-muted-foreground">
              {filteredArchived.length}
            </span>
            {archivedOpen ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground ml-auto" />
            )}
          </button>
          {archivedOpen && (
            <div className="space-y-2">
              {filteredArchived.map((p) => (
                <ArchivedCard
                  key={p.id}
                  p={p}
                  onRestore={(id) => restoreMut.mutate(id)}
                  onDelete={(proj) => {
                    setDeleteFor({ id: proj.id, name: proj.name })
                    setDeleteConfirmInput('')
                  }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Legend sessione — espandibile (V14.1) */}
      <SessionLegend />

      {/* V14.18 — Bottom action bar fluttuante per batch ops */}
      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-card border border-violet-500/40 shadow-[0_4px_30px_rgba(139,92,246,0.25)] rounded-lg px-4 py-2.5 flex items-center gap-3 z-50 backdrop-blur-md">
          <span className="text-xs font-medium">
            <span className="text-violet-300">{selectedIds.size}</span> selezionati
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
                <FolderTreeIcon className="w-3.5 h-3.5 text-violet-400" /> Sposta in...
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-56">
              <DropdownMenuLabel>Sposta {selectedIds.size} progetti</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => batchMoveMut.mutate({ ids: Array.from(selectedIds), folder: undefined })}
              >
                <span className="text-xs italic text-muted-foreground">(root — nessuna cartella)</span>
              </DropdownMenuItem>
              {allFolders.length === 0 ? (
                <DropdownMenuItem disabled>
                  <span className="text-xs italic text-muted-foreground">Nessuna cartella esistente</span>
                </DropdownMenuItem>
              ) : (
                allFolders.map((f) => (
                  <DropdownMenuItem
                    key={f}
                    onClick={() => batchMoveMut.mutate({ ids: Array.from(selectedIds), folder: f })}
                  >
                    <FolderTreeIcon className="w-3.5 h-3.5 mr-2 text-violet-400" />
                    <span className="text-xs truncate">{f}</span>
                  </DropdownMenuItem>
                ))
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setNewFolderFor({ ids: Array.from(selectedIds) })
                  setNewFolderInput('')
                }}
                className="text-primary"
              >
                <Plus className="w-3.5 h-3.5 mr-2" /> Nuova cartella...
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="outline"
            onClick={() => batchArchiveMut.mutate(Array.from(selectedIds))}
            disabled={batchArchiveMut.isPending}
            className="gap-1.5 h-7 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
          >
            <ArchiveIcon className="w-3.5 h-3.5" /> Archivia
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedIds(new Set())
              setSelectionMode(false)
            }}
            className="h-7 text-xs"
          >
            <X className="w-3.5 h-3.5" /> Annulla
          </Button>
        </div>
      )}

      {/* V14.18 — Dialog Rinomina progetto */}
      <Dialog
        open={!!renameFor}
        onOpenChange={(o) => {
          if (!o && !renameMut.isPending) {
            setRenameFor(null)
            setRenameInput('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rinomina progetto</DialogTitle>
            <DialogDescription>
              Cambia il nome visualizzato. L'ID slug non viene modificato.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameInput}
            onChange={(e) => setRenameInput(e.target.value)}
            placeholder="Nuovo nome (2-100 caratteri)"
            maxLength={100}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                renameInput.trim().length >= 2 &&
                renameInput.trim() !== renameFor?.name &&
                renameFor &&
                !renameMut.isPending
              ) {
                e.preventDefault()
                renameMut.mutate({ id: renameFor.id, name: renameInput.trim() })
              }
            }}
          />
          <div className="text-[10px] text-muted-foreground">
            {renameInput.trim().length} / 100 · min 2
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRenameFor(null)
                setRenameInput('')
              }}
              disabled={renameMut.isPending}
            >
              Annulla
            </Button>
            <Button
              onClick={() =>
                renameFor && renameMut.mutate({ id: renameFor.id, name: renameInput.trim() })
              }
              disabled={
                renameMut.isPending ||
                renameInput.trim().length < 2 ||
                renameInput.trim() === renameFor?.name
              }
              className="gap-1.5"
            >
              {renameMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Salva
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* V14.18 — Dialog Nuova cartella (singolo o batch) */}
      <Dialog
        open={!!newFolderFor}
        onOpenChange={(o) => {
          if (!o && !moveMut.isPending && !batchMoveMut.isPending) {
            setNewFolderFor(null)
            setNewFolderInput('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova cartella</DialogTitle>
            <DialogDescription>
              Crea una nuova cartella e sposta {newFolderFor?.ids.length === 1 ? '1 progetto' : `${newFolderFor?.ids.length} progetti`} al suo interno. Usa <code className="bg-muted px-1 rounded">/</code> per cartelle annidate (es. <code className="bg-muted px-1 rounded">Clienti/Herbalife</code>).
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={newFolderInput}
            onChange={(e) => setNewFolderInput(e.target.value)}
            placeholder="Es. Clienti/Herbalife/UK"
            maxLength={200}
            onKeyDown={(e) => {
              const folder = newFolderInput.trim()
              if (
                e.key === 'Enter' &&
                folder.length >= 1 &&
                /^[a-zA-Z0-9 _-]+(?:\/[a-zA-Z0-9 _-]+)*$/.test(folder) &&
                newFolderFor &&
                !moveMut.isPending &&
                !batchMoveMut.isPending
              ) {
                e.preventDefault()
                if (newFolderFor.ids.length === 1) {
                  moveMut.mutate({ id: newFolderFor.ids[0], folder })
                } else {
                  batchMoveMut.mutate({ ids: newFolderFor.ids, folder })
                }
                setNewFolderFor(null)
                setNewFolderInput('')
              }
            }}
          />
          <div className="text-[10px] text-muted-foreground">
            Caratteri permessi: a-z, A-Z, 0-9, spazio, underscore, dash, slash. Max 200.
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewFolderFor(null)
                setNewFolderInput('')
              }}
              disabled={moveMut.isPending || batchMoveMut.isPending}
            >
              Annulla
            </Button>
            <Button
              onClick={() => {
                const folder = newFolderInput.trim()
                if (!newFolderFor || !folder) return
                if (newFolderFor.ids.length === 1) {
                  moveMut.mutate({ id: newFolderFor.ids[0], folder })
                } else {
                  batchMoveMut.mutate({ ids: newFolderFor.ids, folder })
                }
                setNewFolderFor(null)
                setNewFolderInput('')
              }}
              disabled={
                moveMut.isPending ||
                batchMoveMut.isPending ||
                !newFolderInput.trim() ||
                !/^[a-zA-Z0-9 _-]+(?:\/[a-zA-Z0-9 _-]+)*$/.test(newFolderInput.trim())
              }
              className="gap-1.5"
            >
              {(moveMut.isPending || batchMoveMut.isPending) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Crea e sposta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* V14.8 — Dialog conferma DELETE per hard-delete progetti archiviati */}
      <Dialog
        open={!!deleteFor}
        onOpenChange={(o) => {
          if (!o && !deleteMut.isPending) {
            setDeleteFor(null)
            setDeleteConfirmInput('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="w-5 h-5" />
              Elimina definitivamente "{deleteFor?.name}"
            </DialogTitle>
            <DialogDescription>
              Questa azione è <strong className="text-red-400">irreversibile</strong>. Verranno cancellati:
              <ul className="list-disc ml-5 mt-2 space-y-0.5 text-[11px]">
                <li>Record progetto in <code>data/projects.json</code></li>
                <li>Workspace <code>data/new-project-{deleteFor?.id}/</code></li>
                <li>PTY workspace <code>data/project-workspaces/{deleteFor?.id}/</code></li>
                <li>Kickoff brief <code>data/kickoffs/kickoff-{deleteFor?.id}-*.md</code></li>
                <li>Task state, log, lock, briefs runtime</li>
              </ul>
              <div className="mt-3 text-amber-300/80">
                ⚠ Le sessioni AI in <code>~/.claude/projects/</code> NON vengono toccate.
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs">
              Per confermare digita <code className="bg-muted px-1 py-0.5 rounded text-red-300 font-bold">DELETE</code> e premi Invio:
            </label>
            <Input
              value={deleteConfirmInput}
              onChange={(e) => setDeleteConfirmInput(e.target.value)}
              placeholder="DELETE"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  deleteConfirmInput === 'DELETE' &&
                  deleteFor &&
                  !deleteMut.isPending
                ) {
                  e.preventDefault()
                  deleteMut.mutate(deleteFor.id)
                }
              }}
              className={cn(
                'font-mono',
                deleteConfirmInput === 'DELETE' && 'border-red-500/60 ring-1 ring-red-500/40'
              )}
            />
            <div className="text-[10px] text-muted-foreground">
              {deleteConfirmInput === 'DELETE'
                ? '✓ Conferma valida — premi Invio o "Elimina definitivamente"'
                : 'Digita esattamente DELETE (maiuscolo) per abilitare il bottone'}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDeleteFor(null)
                setDeleteConfirmInput('')
              }}
              disabled={deleteMut.isPending}
            >
              Annulla
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={deleteConfirmInput !== 'DELETE' || deleteMut.isPending || !deleteFor}
              onClick={() => deleteFor && deleteMut.mutate(deleteFor.id)}
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
                  Elimina definitivamente
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * Legenda dei pallini sessione — collapsed di default, espande con animazione
 * grid-rows. Tabella completa con colore + nome + significato + quando appare.
 */
function SessionLegend() {
  const [open, setOpen] = useState(false)
  const rows: Array<{ status: any; name: string; meaning: string; when: string }> = [
    {
      status: 'running',
      name: 'In esecuzione',
      meaning: 'Sessione PTY embedded SAIO attiva — la CLI AI sta processando in questo momento.',
      when: 'Hai aperto la sessione dalla dashboard (PTY interna).',
    },
    {
      status: 'waiting_user',
      name: 'Attende risposta',
      meaning: 'Sessione attiva con DecisionCard pendente in Inbox o input richiesto.',
      when: 'L\'AI ha postato una decisione e aspetta il tuo Sì/No/Skip.',
    },
    {
      status: 'external_active',
      name: 'CLI AI esterna',
      meaning: 'La CLI AI sta scrivendo log JSONL per questo progetto, ma NON è la PTY embedded — è una tua sessione aperta da terminale Windows / IDE / VSCode.',
      when: 'Hai lanciato `claude` manualmente in una cartella collegata al progetto. Detection: mtime di `~/.claude/projects/<slug>/*.jsonl` < 2 min.',
    },
    {
      status: 'done',
      name: 'Completato esplicitamente',
      meaning: 'Persiste fino a riavvio. La sessione ha chiamato `POST /api/tasks/:id/complete` o l\'utente ha cliccato "Marca completato".',
      when: 'Marker file `data/tasks/<id>.json.completed` presente.',
    },
    {
      status: 'recently_terminated',
      name: 'Terminata di recente',
      meaning: 'Il processo CLI è morto senza marker di completamento, ma è successo da meno di 30 min. Il task JSON e il log sono ancora freschi: clicca per vedere l\'output prima che decadi.',
      when: 'Hai chiuso la finestra cmd o la CLI è uscita senza chiamare /complete. Decade automaticamente a "Idle" dopo 30 min.',
    },
    {
      status: 'failed',
      name: 'Fallita',
      meaning: 'Sessione conclusa con errore (exit code != 0 o errore segnalato dallo spawner).',
      when: 'Vedi log per dettagli, marker error nel task JSON.',
    },
    {
      status: 'idle',
      name: 'Idle / terminata',
      meaning: 'Nessuna sessione attiva, nessun marker di completamento, nessun output recente.',
      when: 'Stato di default per progetti che non hanno mai avuto sessioni o che sono terminati da > 30 min.',
    },
    {
      status: 'pending',
      name: 'In coda',
      meaning: 'Sessione richiesta ma non ancora spawnata (es. orchestrator sta ancora valutando).',
      when: 'Tra "Crea progetto" e "Sessione pronta".',
    },
  ]

  return (
    <Card className="bg-muted/20 border-border/50 neon-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-xs hover:bg-muted/30 transition-colors rounded-md"
        aria-expanded={open}
      >
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 transition-transform duration-200 text-muted-foreground',
            open && 'rotate-90'
          )}
        />
        <span className="font-medium text-foreground">Significato dei pallini stato sessione</span>
        <span className="text-muted-foreground">— legenda colori</span>
        {/* Quick preview chips quando collapsed */}
        {!open && (
          <div className="ml-auto flex items-center gap-1.5">
            <SessionStatusDot status="running" />
            <SessionStatusDot status="external_active" />
            <SessionStatusDot status="recently_terminated" />
            <SessionStatusDot status="done" />
            <SessionStatusDot status="idle" />
          </div>
        )}
      </button>

      {/* Animated content via grid-rows trick (no JS animation lib) */}
      <div
        className={cn(
          'grid transition-all duration-300 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <CardContent className="pt-0 pb-3">
            <div className="overflow-x-auto rounded-md border border-border/40">
              <table className="w-full text-[11px]">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-10"></th>
                    <th className="text-left px-3 py-2 font-medium w-36">Stato</th>
                    <th className="text-left px-3 py-2 font-medium">Cosa significa</th>
                    <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Quando appare</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.status} className="border-t border-border/30 hover:bg-muted/15">
                      <td className="px-3 py-2 align-top">
                        <SessionStatusDot status={row.status} size="md" />
                      </td>
                      <td className="px-3 py-2 align-top font-medium text-foreground whitespace-nowrap">
                        {row.name}
                      </td>
                      <td className="px-3 py-2 align-top text-muted-foreground leading-snug">
                        {row.meaning}
                      </td>
                      <td className="px-3 py-2 align-top text-muted-foreground/80 leading-snug hidden md:table-cell">
                        {row.when}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-2 italic">
              Clicca su una card progetto per vedere log, output e azioni disponibili (marca completato, riavvia, ecc.).
            </p>
          </CardContent>
        </div>
      </div>
    </Card>
  )
}
