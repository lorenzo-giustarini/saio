import { useState } from 'react'
import { ListChecks, Loader2, CheckCircle2 } from 'lucide-react'
import { TaskCard } from '@/components/tasks/TaskCard'
import { LogDrawer } from '@/components/tasks/LogDrawer'
import { useTasks } from '@/hooks/useTasks'
import type { TaskStatus } from '@/lib/types'

export function TasksPage() {
  const { data, isLoading, error } = useTasks()
  const [logTask, setLogTask] = useState<TaskStatus | null>(null)

  const tasks = data?.tasks || []
  const active = tasks.filter((t) => ['running', 'paused', 'waiting_user', 'pending'].includes(t.status))
  const done = tasks.filter((t) => ['done', 'failed'].includes(t.status))

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ListChecks className="w-6 h-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold tracking-tight">Task attivi</h1>
        {data && (
          <span className="ml-auto text-sm text-muted-foreground">
            {active.length} attivi · {done.length} completati
          </span>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          Caricamento task...
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Errore: {String(error)}
        </div>
      )}

      {!isLoading && tasks.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <CheckCircle2 className="w-12 h-12 opacity-40" />
          <p>Nessun task attivo. Quando invii risposte dalla Inbox, i progetti paralleli appaiono qui.</p>
        </div>
      )}

      {active.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            In esecuzione
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {active.map((t) => (
              <TaskCard key={t.projectId} task={t} onOpenLog={setLogTask} />
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Completati recenti
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {done.slice(0, 8).map((t) => (
              <TaskCard key={t.projectId} task={t} onOpenLog={setLogTask} />
            ))}
          </div>
        </section>
      )}

      <LogDrawer task={logTask} onClose={() => setLogTask(null)} />
    </div>
  )
}
