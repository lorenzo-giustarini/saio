import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useNotifications } from '@/store/notificationStore'

interface SSEEvent {
  type: 'created' | 'updated' | 'deleted' | 'connected'
  kind?: 'brief' | 'task' | 'project' | 'response' | 'feedback' | 'other'
  path?: string
  filename?: string
  timestamp?: string
}

export function useSSE() {
  const qc = useQueryClient()
  const addNotification = useNotifications((s) => s.add)
  const seenTasksRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = async (ev) => {
      try {
        const data: SSEEvent = JSON.parse(ev.data)
        if (data.type === 'connected') return

        switch (data.kind) {
          case 'brief':
            qc.invalidateQueries({ queryKey: ['briefs'] })
            if (data.type === 'created') {
              toast.info('Nuovo brief ricevuto', {
                description: data.filename?.replace(/\.json$/, ''),
              })
              addNotification({
                type: 'info',
                title: 'Nuovo brief',
                message: `Brief ricevuto: ${data.filename?.replace(/\.json$/, '')}`,
              })
            }
            break
          case 'task':
            qc.invalidateQueries({ queryKey: ['tasks'] })
            qc.invalidateQueries({ queryKey: ['projects'] })
            // Check task status change for notifications
            if (data.filename) {
              const projectId = data.filename.replace(/\.json$/, '')
              try {
                const res = await fetch(`/api/tasks/${projectId}`)
                if (res.ok) {
                  const task = await res.json()
                  const prev = seenTasksRef.current.get(projectId)
                  if (task.status !== prev) {
                    seenTasksRef.current.set(projectId, task.status)
                    if (task.status === 'waiting_user') {
                      toast.warning(`${task.title} attende tua risposta`, {
                        description: 'Vai alla finestra CMD per rispondere',
                        duration: 10_000,
                      })
                      addNotification({
                        type: 'waiting_user',
                        projectId,
                        title: `${task.title} — attende risposta`,
                        message: 'Clicca per aprire il progetto',
                      })
                    } else if (task.status === 'done') {
                      toast.success(`${task.title} completato`)
                      addNotification({
                        type: 'task_done',
                        projectId,
                        title: `${task.title} — completato`,
                        message: 'Le richieste sono state portate a termine',
                      })
                    } else if (task.status === 'failed') {
                      toast.error(`${task.title} fallito`, { description: task.errorMessage })
                      addNotification({
                        type: 'task_failed',
                        projectId,
                        title: `${task.title} — fallito`,
                        message: task.errorMessage || 'Vedi log per dettagli',
                      })
                    }
                  }
                }
              } catch {
                /* task not accessible */
              }
            }
            break
          case 'response':
            qc.invalidateQueries({ queryKey: ['archive'] })
            break
          case 'project':
            qc.invalidateQueries({ queryKey: ['projects'] })
            break
          case 'feedback':
            qc.invalidateQueries({ queryKey: ['metrics', 'feedback'] })
            break
          default:
            break
        }
      } catch {
        /* malformed event */
      }
    }
    es.onerror = () => {
      /* EventSource auto-reconnects */
    }
    return () => {
      es.close()
    }
  }, [qc, addNotification])
}
