import { Router } from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { TaskStatusSchema } from '../../shared/schemas'
import { sanitizeProjectId } from '../lib/sanitize'
import { atomicWriteFile } from '../lib/atomic-write'
import { logger } from '../lib/logger'

/**
 * Check if a PID is still alive on Windows.
 * Uses process.kill(pid, 0) — throws if the PID doesn't exist.
 */
function isPidAlive(pid: number | undefined): boolean {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // ESRCH = No such process, EPERM = exists but no perm (still alive from our POV)
    return err.code === 'EPERM'
  }
}

const ACTIVE_STATUSES = new Set(['running', 'paused', 'waiting_user', 'pending'])

export function tasksRouter(dataDir: string) {
  const router = Router()
  const tasksDir = path.join(dataDir, 'tasks')
  const commandsDir = path.join(dataDir, 'commands')

  router.get('/', async (_req, res) => {
    try {
      const files = await fs.readdir(tasksDir)
      const tasks: any[] = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        const filePath = path.join(tasksDir, f)
        try {
          const raw = await fs.readFile(filePath, 'utf8')
          const parsed = TaskStatusSchema.safeParse(JSON.parse(raw))
          if (!parsed.success) continue

          let task = parsed.data
          // LIVENESS CHECK (V11): distinguish explicit completion vs user-closed terminal.
          // Marker file `<taskFile>.completed` present → done (blue). Absent → idle (grey).
          if (ACTIVE_STATUSES.has(task.status) && !isPidAlive(task.pid)) {
            const markerPath = `${filePath}.completed`
            const completed = fsSync.existsSync(markerPath)
            const nextStatus = completed ? ('done' as const) : ('idle' as const)
            const outcome = completed ? 'completed' : 'terminated'
            logger.info(
              `[task liveness] ${task.projectId}: PID ${task.pid} dead + marker=${completed} → ${nextStatus}`
            )
            task = {
              ...task,
              status: nextStatus,
              sessionOutcome: outcome,
              currentStep: completed ? 'Completata esplicitamente' : 'Terminata (PID non più vivo)',
              updatedAt: new Date().toISOString(),
              history: [
                ...(task.history || []),
                {
                  ts: new Date().toISOString(),
                  event: completed ? 'auto-marked-done (marker)' : 'auto-marked-idle (terminated)',
                },
              ],
            }
            await atomicWriteFile(filePath, JSON.stringify(task, null, 2))
          }
          tasks.push(task)
        } catch {
          /* skip malformed */
        }
      }
      tasks.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''))
      res.json({ tasks })
    } catch (err) {
      logger.error('List tasks failed:', err)
      res.status(500).json({ error: 'Failed to list tasks' })
    }
  })

  // Manual cleanup endpoint: removes done/failed tasks older than X days
  router.post('/cleanup', async (req, res) => {
    const olderThanDays = Number(req.body?.olderThanDays || 7)
    const cutoff = Date.now() - olderThanDays * 24 * 3600 * 1000
    try {
      const files = await fs.readdir(tasksDir)
      let removed = 0
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        const filePath = path.join(tasksDir, f)
        try {
          const raw = await fs.readFile(filePath, 'utf8')
          const task = JSON.parse(raw)
          if (['done', 'failed'].includes(task.status) && new Date(task.updatedAt).getTime() < cutoff) {
            await fs.unlink(filePath)
            removed++
          }
        } catch {
          /* skip */
        }
      }
      res.json({ ok: true, removed, olderThanDays })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const id = sanitizeProjectId(req.params.id)
      const raw = await fs.readFile(path.join(tasksDir, `${id}.json`), 'utf8')
      res.json(TaskStatusSchema.parse(JSON.parse(raw)))
    } catch {
      res.status(404).json({ error: 'Task not found' })
    }
  })

  // POST /:id/complete — explicit completion signal
  // Writes marker file `<tasksDir>/<id>.json.completed`. The next liveness scan
  // will observe it and transition status to 'done' (blue dot).
  // If there's an active task file, also updates it immediately for instant UI feedback.
  router.post('/:id/complete', async (req, res) => {
    try {
      const id = sanitizeProjectId(req.params.id)
      const taskFile = path.join(tasksDir, `${id}.json`)
      const markerFile = `${taskFile}.completed`

      const ts = new Date().toISOString()
      const body = (req.body || {}) as { note?: string }
      const markerPayload = JSON.stringify(
        { completedAt: ts, note: (body.note || '').slice(0, 500) },
        null,
        2
      )
      await atomicWriteFile(markerFile, markerPayload)

      // Also update the task file if it exists — gives immediate blue dot
      try {
        const raw = await fs.readFile(taskFile, 'utf8')
        const task = JSON.parse(raw)
        const updated = {
          ...task,
          status: 'done',
          sessionOutcome: 'completed',
          currentStep: 'Completata esplicitamente',
          updatedAt: ts,
          history: [
            ...(task.history || []),
            { ts, event: 'marked-complete (user action)' },
          ],
        }
        await atomicWriteFile(taskFile, JSON.stringify(updated, null, 2))
      } catch {
        // No task file yet — the marker alone suffices for when a task will spawn later
      }

      logger.info(`[tasks] ${id}: explicit completion marker written`)
      res.json({ ok: true, completedAt: ts, markerFile })
    } catch (err: any) {
      logger.error('complete failed:', err)
      res.status(400).json({ error: String(err.message || err) })
    }
  })

  // Queue a pause/resume/kill command
  router.post('/:id/command', async (req, res) => {
    try {
      const projectId = sanitizeProjectId(req.params.id)
      const { type } = req.body as { type: 'pause' | 'resume' | 'kill' }
      if (!['pause', 'resume', 'kill'].includes(type)) {
        return res.status(400).json({ error: 'Invalid command type' })
      }
      const cmdId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const cmdPath = path.join(commandsDir, `${cmdId}.json`)
      await atomicWriteFile(
        cmdPath,
        JSON.stringify({
          id: cmdId,
          type,
          projectId,
          createdAt: new Date().toISOString(),
        })
      )
      res.json({ ok: true, commandId: cmdId })
    } catch (err) {
      res.status(400).json({ error: String(err) })
    }
  })

  return router
}
