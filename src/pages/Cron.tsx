import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  Clock, Play, CheckCircle2, AlertTriangle, Loader2, Calendar, Zap,
  Power, PowerOff, FileText, Activity, Plus, ChevronDown, ChevronUp, Info, ExternalLink,
  MoreVertical, Pencil, Trash2,
} from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface CronTask {
  name: string
  next: string | null
  last: string | null
  status: string
  enabled: boolean
  description: string
  details?: string
  schedule?: string
  lastResult?: string
  // V14.28 — auto-fix toggle
  errorHandlingCapable?: boolean
  autoFix?: boolean | null
}

async function fetchCron() {
  const res = await fetch('/api/cron')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<{ tasks: CronTask[]; count: number; updatedAt: string }>
}

interface CronHealth {
  name: string
  description: string
  schedule?: string
  enabled: boolean
  lastRun: string | null
  lastResult?: string
  status: 'ok' | 'failed' | 'stale' | 'unknown'
  latestLogPath: string | null
  latestLogMtime: string | null
  latestLogPreview: string | null
}
async function fetchHealth() {
  const res = await fetch('/api/cron/health')
  if (!res.ok) throw new Error('Failed')
  return res.json() as Promise<{ health: CronHealth[]; count: number; failed: number; stale: number; ok: number; updatedAt: string }>
}

// V14.23 — wrapper che preserva errorCode per UX dispatch
class CronApiError extends Error {
  errorCode?: string
  hint?: string
  constructor(message: string, errorCode?: string, hint?: string) {
    super(message)
    this.errorCode = errorCode
    this.hint = hint
  }
}

async function runTask(name: string) {
  const res = await fetch(`/api/cron/${encodeURIComponent(name)}/run`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new CronApiError(err.error || `HTTP ${res.status}`, err.errorCode, err.hint)
  }
  return res.json()
}

async function toggleTask({ name, enable }: { name: string; enable: boolean }) {
  const res = await fetch(`/api/cron/${encodeURIComponent(name)}/${enable ? 'enable' : 'disable'}`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new CronApiError(err.error || `HTTP ${res.status}`, err.errorCode, err.hint)
  }
  return res.json()
}

async function createTask(payload: {
  name: string
  schedule: { type: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE'; time?: string; day?: string; dayOfMonth?: string }
  command: string
  description?: string
  details?: string
}) {
  const res = await fetch('/api/cron', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new CronApiError(err.error || `HTTP ${res.status}`, err.errorCode, err.hint)
  }
  return res.json()
}

// V14.27 — rename cron via PUT /:name/rename
async function renameTask({ oldName, newName }: { oldName: string; newName: string }) {
  const res = await fetch(`/api/cron/${encodeURIComponent(oldName)}/rename`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newName }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new CronApiError(err.error || `HTTP ${res.status}`, err.errorCode, err.hint)
  }
  return res.json()
}

// V14.27 — delete cron via DELETE /:name
async function deleteTask(name: string) {
  const res = await fetch(`/api/cron/${encodeURIComponent(name)}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new CronApiError(err.error || `HTTP ${res.status}`, err.errorCode, err.hint)
  }
  return res.json()
}

// V14.28 — toggle auto-fix per cron error-handling
async function toggleAutoFix({ name, enabled }: { name: string; enabled: boolean }) {
  const res = await fetch(`/api/cron/${encodeURIComponent(name)}/auto-fix`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new CronApiError(err.error || `HTTP ${res.status}`, err.errorCode, err.hint)
  }
  return res.json()
}

async function openTaskSchedulerGUI() {
  const res = await fetch('/api/cron/open-gui', { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).error)
  return res.json()
}

// V14.24 — handler errori cron: admin_required ormai non capita più (auto-elevation),
// admin_denied capita se l'utente clicca No al popup UAC.
function handleCronError(err: unknown) {
  if (err instanceof CronApiError && err.errorCode === 'admin_denied') {
    toast.error(err.message, {
      description: err.hint || 'Hai cliccato No al popup UAC. Riprova e accetta, oppure usa la GUI.',
      action: {
        label: 'Apri Task Scheduler',
        onClick: () => {
          openTaskSchedulerGUI().catch((e) =>
            toast.error('Apertura GUI fallita', { description: String(e?.message || e) })
          )
        },
      },
      duration: 8000,
    })
    return
  }
  // Legacy: se per qualche motivo arriva ancora admin_required (vecchia versione backend)
  if (err instanceof CronApiError && err.errorCode === 'admin_required') {
    toast.error(err.message, {
      description: 'Aggiorna la dashboard (V14.24+) per auto-elevation. Per ora apri la GUI.',
      action: {
        label: 'Apri Task Scheduler',
        onClick: () => openTaskSchedulerGUI().catch(() => {}),
      },
      duration: 8000,
    })
    return
  }
  toast.error(String((err as any)?.message || err))
}

export function CronPage() {
  const qc = useQueryClient()
  const [logFor, setLogFor] = useState<CronHealth | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['cron'],
    queryFn: fetchCron,
    refetchInterval: 120_000,
    staleTime: 60_000,
  })
  // V14.19 — health endpoint con log preview + status derivato
  const healthQ = useQuery({
    queryKey: ['cron', 'health'],
    queryFn: fetchHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const runMut = useMutation({
    mutationFn: runTask,
    onSuccess: (_d, name) => {
      toast.success(`Task "${name}" lanciato`)
      setTimeout(() => qc.invalidateQueries({ queryKey: ['cron'] }), 2000)
    },
    onError: handleCronError,
  })

  const toggleMut = useMutation({
    mutationFn: toggleTask,
    onSuccess: (data: any, v) => {
      const elevated = data?.elevated === true
      toast.success(`Task "${v.name}" ${v.enable ? 'attivata' : 'disattivata'}`, {
        description: elevated ? 'Eseguita con privilegi admin (UAC)' : undefined,
      })
      qc.invalidateQueries({ queryKey: ['cron'] })
    },
    onError: handleCronError,
  })

  // V14.23 — Cron create form state · V14.27 — added MONTHLY + details
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ONCE'>('DAILY')
  const [newTime, setNewTime] = useState('03:00')
  const [newDay, setNewDay] = useState<'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN'>('MON')
  const [newDayOfMonth, setNewDayOfMonth] = useState('1')
  const [newCommand, setNewCommand] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newDetails, setNewDetails] = useState('')
  const createMut = useMutation({
    mutationFn: createTask,
    onSuccess: (data: any) => {
      const elevated = data?.elevated === true
      toast.success(`Task "${data.name}" creato`, {
        description: elevated ? 'Creato con privilegi admin (UAC)' : undefined,
      })
      qc.invalidateQueries({ queryKey: ['cron'] })
      qc.invalidateQueries({ queryKey: ['cron', 'health'] })
      setCreateOpen(false)
      setNewName('')
      setNewCommand('')
      setNewDescription('')
      setNewDetails('')
    },
    onError: handleCronError,
  })

  // V14.27 — Rename + Delete state + mutations
  const [renameFor, setRenameFor] = useState<CronTask | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [deleteFor, setDeleteFor] = useState<CronTask | null>(null)

  const renameMut = useMutation({
    mutationFn: renameTask,
    onSuccess: (_data, vars) => {
      toast.success(`Rinominato in "${vars.newName}"`)
      qc.invalidateQueries({ queryKey: ['cron'] })
      qc.invalidateQueries({ queryKey: ['cron', 'health'] })
      setRenameFor(null)
      setRenameInput('')
    },
    onError: (err) => {
      if (err instanceof CronApiError && err.errorCode === 'task_running') {
        toast.error(err.message, { description: 'Aspetta che il task finisca poi riprova' })
        return
      }
      handleCronError(err)
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteTask,
    onSuccess: (_data, name) => {
      toast.success(`Task "${name}" eliminato`)
      qc.invalidateQueries({ queryKey: ['cron'] })
      qc.invalidateQueries({ queryKey: ['cron', 'health'] })
      setDeleteFor(null)
    },
    onError: (err) => {
      if (err instanceof CronApiError && err.errorCode === 'task_running') {
        toast.error(err.message, { description: 'Aspetta che il task finisca poi riprova' })
        return
      }
      handleCronError(err)
    },
  })

  // V14.28 — toggle auto-fix
  const autoFixMut = useMutation({
    mutationFn: toggleAutoFix,
    onSuccess: (data: any, vars) => {
      toast.success(`Auto-fix ${vars.enabled ? 'abilitato' : 'disabilitato'} per "${vars.name}"`, {
        description: vars.enabled
          ? 'I fix marcati "safe" verranno applicati automaticamente'
          : 'La AI proporrà fix in dashboard, applicati solo dopo tua conferma',
      })
      qc.invalidateQueries({ queryKey: ['cron'] })
    },
    onError: handleCronError,
  })

  return (
    <div className="space-y-4 md:space-y-6 pb-12">
      <div className="flex items-center gap-3 flex-wrap">
        <Clock className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Automazioni schedulate</h1>
        {data && (
          <span className="text-xs md:text-sm text-muted-foreground">
            {data.count} task · {data.tasks.filter(t => t.enabled).length} attive
          </span>
        )}
        <Button
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="w-3.5 h-3.5" /> Nuovo cron
        </Button>
      </div>

      <div className="rounded-md bg-muted/30 border border-border/50 p-3 text-xs text-muted-foreground flex items-start gap-2">
        <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <div>
          Automazioni Windows Task Scheduler che scrivono nel vault Obsidian: imparano dai tuoi errori, trovano nuovi tool,
          aggiornano l'ecosistema, generano il daily cockpit. <strong>Non serve che la CLI AI sia attiva</strong> — girano in background.
          Usa <strong>Run</strong> per eseguirla ora, <strong>Power</strong> per attivare/disattivare, <strong>+ Nuovo cron</strong> per crearne.
          <div className="mt-1.5 text-[11px] text-amber-300/80">
            ⚠ Attivare/disattivare/creare aprono un <strong>popup UAC di Windows</strong>: accetta per completare l'operazione (non serve riavviare la dashboard come admin).
          </div>
        </div>
      </div>

      {/* V14.19 — Health overview card */}
      {healthQ.data && (
        <Card className="neon-card">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Activity className="w-4 h-4 text-violet-400" />
              <h3 className="font-semibold text-sm">Health automazioni — 24h</h3>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {healthQ.data.count} task · refresh ogni 60s
              </span>
            </div>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 bg-emerald-500/10">
                ✓ {healthQ.data.ok} OK
              </Badge>
              {healthQ.data.failed > 0 && (
                <Badge variant="outline" className="text-[10px] border-red-500/50 text-red-300 bg-red-500/10">
                  ✗ {healthQ.data.failed} FAILED
                </Badge>
              )}
              {healthQ.data.stale > 0 && (
                <Badge variant="outline" className="text-[10px] border-slate-500/50 text-slate-300 bg-slate-500/10">
                  ⊘ {healthQ.data.stale} mai eseguito
                </Badge>
              )}
            </div>
            {healthQ.data.failed > 0 && (
              <div className="mt-3 space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-red-300 mb-1">Task FAILED — clicca per vedere log</div>
                {healthQ.data.health
                  .filter((h) => h.status === 'failed')
                  .map((h) => (
                    <button
                      key={h.name}
                      onClick={() => setLogFor(h)}
                      className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 transition-colors text-left"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="font-medium truncate">{h.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{h.lastRun || '—'}</span>
                      <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
                    </button>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Caricamento task...
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {data?.tasks.map((t) => (
          <CronCard
            key={t.name}
            task={t}
            onRun={() => runMut.mutate(t.name)}
            running={runMut.isPending && runMut.variables === t.name}
            onToggle={() => toggleMut.mutate({ name: t.name, enable: !t.enabled })}
            toggling={toggleMut.isPending && toggleMut.variables?.name === t.name}
            onRename={() => { setRenameFor(t); setRenameInput(t.name) }}
            onDelete={() => setDeleteFor(t)}
            onToggleAutoFix={(enabled) => autoFixMut.mutate({ name: t.name, enabled })}
            autoFixToggling={autoFixMut.isPending && autoFixMut.variables?.name === t.name}
          />
        ))}
      </div>

      {data && data.tasks.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          Nessuna automazione Obsidian/CLI AI trovata in Task Scheduler.
        </div>
      )}

      {/* V14.23 — Dialog Crea nuovo cron */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-violet-400" /> Nuovo cron Windows
            </DialogTitle>
            <DialogDescription>
              Crea una nuova automazione Windows Task Scheduler. Verrà prefissata con
              <code className="bg-muted px-1 rounded mx-1">RM-Dashboard-</code>
              se non contiene già "obsidian" o "rm-dashboard".
              <span className="block mt-2 text-emerald-400/80">
                Se il <strong>Cron Manager</strong> è registrato (default dopo setup), la creazione avviene <strong>senza popup UAC</strong>. Altrimenti, accetta il popup quando appare.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-muted-foreground">Nome (alfanum, dash, underscore — 3-64)</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Es. weekly-feedback-digest"
                maxLength={64}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Frequenza</label>
              <div className="flex gap-2 mt-1">
                {(['DAILY', 'WEEKLY', 'MONTHLY', 'ONCE'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setNewType(t)}
                    className={cn(
                      'flex-1 text-xs px-2 py-1.5 rounded border transition-colors',
                      newType === t ? 'border-violet-500 bg-violet-500/15 text-violet-200' : 'border-border text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {t === 'DAILY' ? 'Ogni giorno' : t === 'WEEKLY' ? 'Ogni settimana' : t === 'MONTHLY' ? 'Ogni mese' : 'Una volta'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Ora (HH:MM)</label>
                <Input
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  placeholder="03:00"
                  maxLength={5}
                />
              </div>
              {newType === 'WEEKLY' && (
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Giorno settimana</label>
                  <select
                    value={newDay}
                    onChange={(e) => setNewDay(e.target.value as any)}
                    className="w-full text-sm bg-background border border-border rounded px-2 py-1.5 h-9"
                  >
                    {(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              )}
              {newType === 'MONTHLY' && (
                <div className="flex-1">
                  <label className="text-xs text-muted-foreground">Giorno del mese (1-31)</label>
                  <Input
                    value={newDayOfMonth}
                    onChange={(e) => setNewDayOfMonth(e.target.value)}
                    placeholder="1"
                    maxLength={2}
                  />
                </div>
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Comando PowerShell</label>
              <Textarea
                value={newCommand}
                onChange={(e) => setNewCommand(e.target.value)}
                placeholder='Es. & "$env:USERPROFILE\scripts\run-mio-script.ps1" oppure /home/user/scripts/run.sh'
                className="text-xs font-mono min-h-[80px]"
                maxLength={2000}
              />
              <div className="text-[9px] text-muted-foreground mt-1">
                Eseguito via <code>powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "..."</code>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Descrizione breve (compare nella card)</label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Es. Backup vault settimanale"
                maxLength={500}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Spiegazione dettagliata (opzionale, espandibile in card)</label>
              <Textarea
                value={newDetails}
                onChange={(e) => setNewDetails(e.target.value)}
                placeholder="Cosa fa nel dettaglio: input, output, perché serve, link a documentazione…"
                className="text-xs min-h-[60px]"
                maxLength={2000}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={createMut.isPending}>
              Annulla
            </Button>
            <Button
              onClick={() =>
                createMut.mutate({
                  name: newName.trim(),
                  schedule: {
                    type: newType,
                    time: newTime,
                    day: newType === 'WEEKLY' ? newDay : undefined,
                    dayOfMonth: newType === 'MONTHLY' ? newDayOfMonth : undefined,
                  },
                  command: newCommand.trim(),
                  description: newDescription.trim() || undefined,
                  details: newDetails.trim() || undefined,
                })
              }
              disabled={
                createMut.isPending ||
                !/^[a-zA-Z0-9_-]{3,64}$/.test(newName.trim()) ||
                newCommand.trim().length < 3
              }
              className="gap-1.5"
            >
              {createMut.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Crea task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* V14.27 — Dialog rinomina cron */}
      <Dialog open={!!renameFor} onOpenChange={(o) => { if (!o) { setRenameFor(null); setRenameInput('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rinomina automazione</DialogTitle>
            <DialogDescription>
              Cambia il nome di "<span className="font-mono">{renameFor?.name}</span>". Il task viene
              ricreato in Windows Task Scheduler con i medesimi parametri.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-xs text-muted-foreground">Nuovo nome</label>
            <Input
              autoFocus
              value={renameInput}
              onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameFor && /^[a-zA-Z0-9_-]{3,64}$/.test(renameInput.trim()) && renameInput.trim() !== renameFor.name) {
                  renameMut.mutate({ oldName: renameFor.name, newName: renameInput.trim() })
                }
                if (e.key === 'Escape') { setRenameFor(null); setRenameInput('') }
              }}
              placeholder="es. Obsidian-My-Custom-Task"
              className="font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground">
              3-64 caratteri, lettere/numeri/dash/underscore. Deve contenere "obsidian", "claude" o "rm-dashboard".
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRenameFor(null); setRenameInput('') }}>Annulla</Button>
            <Button
              disabled={
                renameMut.isPending ||
                !renameFor ||
                !/^[a-zA-Z0-9_-]{3,64}$/.test(renameInput.trim()) ||
                renameInput.trim() === renameFor?.name
              }
              onClick={() => renameFor && renameMut.mutate({ oldName: renameFor.name, newName: renameInput.trim() })}
            >
              {renameMut.isPending ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Rinominando…</> : 'Rinomina'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* V14.27 — AlertDialog conferma elimina */}
      <AlertDialog open={!!deleteFor} onOpenChange={(o) => { if (!o) setDeleteFor(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare l'automazione?</AlertDialogTitle>
            <AlertDialogDescription>
              Stai per cancellare definitivamente "<span className="font-mono">{deleteFor?.name}</span>" da Windows Task Scheduler.
              Questa operazione non può essere annullata. Lo script associato sul filesystem NON viene cancellato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMut.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMut.isPending || !deleteFor}
              onClick={() => deleteFor && deleteMut.mutate(deleteFor.name)}
              className="bg-red-600 hover:bg-red-500 text-white"
            >
              {deleteMut.isPending ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" /> Eliminando…</> : 'Elimina'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* V14.19 — Drawer log preview per task failed */}
      <Sheet open={!!logFor} onOpenChange={(o) => !o && setLogFor(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              {logFor?.name}
            </SheetTitle>
            <SheetDescription>
              {logFor?.description}
              {logFor?.latestLogPath && (
                <div className="mt-1 text-[10px] font-mono opacity-70 truncate">{logFor.latestLogPath}</div>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 text-xs">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Ultimo log (ultimi 2KB) — {logFor?.latestLogMtime || '—'}
            </div>
            <pre className="text-[11px] font-mono whitespace-pre-wrap bg-black/40 border border-border/50 rounded p-3 max-h-[60vh] overflow-auto">
              {logFor?.latestLogPreview || '(nessun log disponibile)'}
            </pre>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function CronCard({
  task, onRun, running, onToggle, toggling, onRename, onDelete, onToggleAutoFix, autoFixToggling,
}: {
  task: CronTask
  onRun: () => void
  running: boolean
  onToggle: () => void
  toggling: boolean
  onRename: () => void
  onDelete: () => void
  onToggleAutoFix: (enabled: boolean) => void
  autoFixToggling: boolean
}) {
  const isRunning = task.status.toLowerCase().includes('in esecuzione') || task.status.toLowerCase() === 'running'
  const lastResultOk = task.lastResult === '0' || task.lastResult === '0x0'
  const enabled = task.enabled
  // V14.23 — toggle dettagli espandibili
  const [detailsOpen, setDetailsOpen] = useState(false)

  return (
    <Card className={cn(
      'relative overflow-hidden h-full',
      isRunning ? 'ring-1 ring-blue-500/40 neon-card-blue' : enabled ? 'neon-card-green' : 'neon-card-red',
      !enabled && 'opacity-60'
    )}>
      {isRunning && (
        <div className="absolute top-0 left-0 h-0.5 w-full bg-gradient-to-r from-transparent via-blue-500 to-transparent animate-pulse-soft" />
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
              ) : enabled ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <PowerOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
              )}
              <h3 className="font-semibold text-sm leading-tight truncate">
                {task.name.replace(/^Obsidian-/, '')}
              </h3>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              size="icon"
              variant="ghost"
              className={cn('h-7 w-7', enabled ? 'text-emerald-400 hover:text-emerald-300' : 'text-red-400 hover:text-red-300')}
              onClick={onToggle}
              disabled={toggling}
              title={enabled ? 'Disattiva' : 'Attiva'}
            >
              {toggling ? <Loader2 className="w-3 h-3 animate-spin" /> : enabled ? <Power className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-7 text-xs"
              onClick={onRun}
              disabled={running || isRunning || !enabled}
            >
              {running ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              Run
            </Button>
            {/* V14.27 — kebab menu rinomina/elimina */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" title="Altre azioni">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onRename} className="gap-2 text-xs">
                  <Pencil className="w-3.5 h-3.5" /> Rinomina…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDelete} className="gap-2 text-xs text-red-400 focus:text-red-300">
                  <Trash2 className="w-3.5 h-3.5" /> Elimina…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-2 pb-3 space-y-1.5 text-xs">
        {task.schedule && (
          <div className="flex items-center gap-1.5">
            <Calendar className="w-3 h-3 text-muted-foreground" />
            <span className="text-muted-foreground">{task.schedule}</span>
          </div>
        )}
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
          {task.next && <div><span className="opacity-60">Next: </span>{task.next}</div>}
          {task.last && <div><span className="opacity-60">Last: </span>{task.last}</div>}
        </div>
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Badge
            variant="outline"
            className={cn(
              'text-[9px] h-4 px-1.5',
              isRunning ? 'text-blue-400' : enabled ? 'text-emerald-400' : 'text-red-400'
            )}
          >
            {enabled ? task.status : 'Disabilitata'}
          </Badge>
          {/* V14.25 — hint visibile per riattivare quando disabled */}
          {!enabled && !isRunning && (
            <span className="text-[9px] text-amber-300/80 italic flex items-center gap-1">
              · Click <Power className="w-2.5 h-2.5 inline text-emerald-400" /> per riattivare
            </span>
          )}
          {task.lastResult && (
            <Badge
              variant="outline"
              className={cn('text-[9px] h-4 px-1.5', lastResultOk ? 'text-emerald-400' : 'text-red-400')}
            >
              Result: {task.lastResult}
            </Badge>
          )}
        </div>
        {/* V14.28 — Switch auto-fix per cron error-handling capable */}
        {task.errorHandlingCapable && (
          <div className="flex items-center justify-between pt-2 mt-1 border-t border-border/40">
            <div className="flex flex-col gap-0.5 min-w-0 mr-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                <Zap className="w-2.5 h-2.5" /> Auto-fix
              </span>
              <span className="text-[9px] text-muted-foreground/80 line-clamp-1">
                {task.autoFix
                  ? 'Applica fix marcati "safe" automaticamente'
                  : 'Propone fix in dashboard, applica dopo conferma'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {autoFixToggling && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              <Switch
                checked={!!task.autoFix}
                onCheckedChange={(v) => onToggleAutoFix(v)}
                disabled={autoFixToggling}
                className="scale-75"
              />
              <span className={cn('text-[9px] font-semibold w-7', task.autoFix ? 'text-emerald-400' : 'text-muted-foreground')}>
                {task.autoFix ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
        )}
        {/* V14.23 — Descrizione espandibile (chevron) */}
        {task.details && (
          <div className="pt-2 border-t border-border/40">
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="flex items-center gap-1">
                <Info className="w-3 h-3" />
                {detailsOpen ? 'Nascondi dettagli' : 'Cosa fa nel dettaglio'}
              </span>
              {detailsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {detailsOpen && (
              <p className="text-[10px] text-foreground/80 leading-relaxed mt-2 whitespace-pre-wrap">
                {task.details}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
