import { Router } from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../lib/logger'
import { claudeSlugFromCwd, ptyManager } from '../lib/pty-manager'
import { projectsStore, type ProjectEntry } from '../lib/projects-store'
import { ProjectPatchSchema } from '../../shared/schemas'

// V15.0 WS22 — In-memory waiting state map con TTL auto-reset.
// Settato dal frontend (POST /:id/session-status {status:'waiting_user'}) quando
// EmbeddedChat rileva pendingChoices. Reset esplicito quando le scelte vengono cleared
// oppure auto-reset dopo TTL_MS se browser muore senza pulire.
const waitingStateMap = new Map<string, { until: number }>()
const WAITING_TTL_MS = 90_000

export function isWaitingForUser(projectId: string): boolean {
  const entry = waitingStateMap.get(projectId)
  if (!entry) return false
  if (Date.now() > entry.until) {
    waitingStateMap.delete(projectId)
    return false
  }
  return true
}

export function setWaitingForUser(projectId: string, waiting: boolean): void {
  if (waiting) {
    waitingStateMap.set(projectId, { until: Date.now() + WAITING_TTL_MS })
  } else {
    waitingStateMap.delete(projectId)
  }
}

// Check if a PID is still alive (for task liveness detection)
function isPidAlive(pid: number | undefined): boolean {
  if (!pid || typeof pid !== 'number' || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    return err.code === 'EPERM'
  }
}

// Detect if Claude Code is active externally for a given cwd.
// Returns true if any .jsonl in ~/.claude/projects/<slug>/ has mtime within last 2 minutes.
function isClaudeActiveExternally(cwd?: string): boolean {
  if (!cwd) return false
  try {
    const slug = claudeSlugFromCwd(cwd)
    const projDir = path.join(os.homedir(), '.claude', 'projects', slug)
    if (!fsSync.existsSync(projDir)) return false
    const entries = fsSync.readdirSync(projDir)
    const now = Date.now()
    const TWO_MIN = 2 * 60_000
    for (const f of entries) {
      if (!f.endsWith('.jsonl')) continue
      try {
        const st = fsSync.statSync(path.join(projDir, f))
        if (now - st.mtimeMs < TWO_MIN) return true
      } catch { /* ignore single-file errors */ }
    }
    return false
  } catch {
    return false
  }
}

const ACTIVE_STATUSES = new Set(['running', 'paused', 'waiting_user', 'pending'])

/**
 * Enriches a project with live session status. Liveness rules (V11):
 * - If task active but PID dead:
 *   - Marker file `<taskFile>.completed` present → status='done' (explicit completion, BLUE dot)
 *   - No marker → status='idle' (user just closed terminal, GREY dot)
 * - If no task file: check external Claude Code activity via externalCwd.
 */
async function enrichWithSession(
  p: ProjectEntry,
  tasksDir: string
): Promise<ProjectEntry & { sessionStatus: string; sessionOutcome: string | null }> {
  let sessionStatus: string = 'idle'
  let sessionOutcome: string | null = null
  const taskFile = path.join(tasksDir, `${p.id}.json`)
  const markerFile = `${taskFile}.completed`

  try {
    const raw = await fs.readFile(taskFile, 'utf8')
    const task = JSON.parse(raw)
    sessionStatus = task.status || 'idle'
    sessionOutcome = task.sessionOutcome ?? null

    if (ACTIVE_STATUSES.has(sessionStatus) && !isPidAlive(task.pid)) {
      const markerExists = fsSync.existsSync(markerFile)
      if (markerExists) {
        sessionStatus = 'done'
        sessionOutcome = 'completed'
        logger.info(`[projects] ${p.id}: PID dead + marker present → done (completed)`)
      } else {
        // V14.1 — PID morto senza marker: se updatedAt è recente (<30min) usa
        // 'recently_terminated' (cyan pulsante) invece di 'idle' diretto, così
        // l'utente non perde di vista la sessione finita anche senza /complete esplicito.
        const updatedAt = task.updatedAt ? Date.parse(task.updatedAt) : 0
        const ageMs = updatedAt > 0 ? Date.now() - updatedAt : Infinity
        const RECENT_WINDOW_MS = 30 * 60 * 1000
        if (ageMs < RECENT_WINDOW_MS) {
          sessionStatus = 'recently_terminated'
          sessionOutcome = 'terminated'
          logger.info(`[projects] ${p.id}: PID dead, no marker, recent (${Math.round(ageMs/60000)}min) → recently_terminated`)
        } else {
          sessionStatus = 'idle'
          sessionOutcome = 'terminated'
          logger.info(`[projects] ${p.id}: PID dead, no marker, stale → idle (terminated)`)
        }
      }
      try {
        const updated = {
          ...task,
          status: sessionStatus,
          sessionOutcome,
          currentStep:
            sessionOutcome === 'completed'
              ? 'Completata esplicitamente'
              : sessionStatus === 'recently_terminated'
                ? 'Terminata di recente — output disponibile'
                : 'Terminata (PID non più vivo)',
          updatedAt: new Date().toISOString(),
        }
        await fs.writeFile(taskFile, JSON.stringify(updated, null, 2))
      } catch {
        /* ignore persistence fail */
      }
    }

    // V14.1 — decay recently_terminated → idle dopo 30 min (anche se status persistito)
    if (sessionStatus === 'recently_terminated') {
      const updatedAt = task.updatedAt ? Date.parse(task.updatedAt) : 0
      const ageMs = updatedAt > 0 ? Date.now() - updatedAt : Infinity
      if (ageMs > 30 * 60 * 1000) {
        sessionStatus = 'idle'
        try {
          await fs.writeFile(
            taskFile,
            JSON.stringify({ ...task, status: 'idle', updatedAt: new Date().toISOString() }, null, 2)
          )
        } catch { /* ignore */ }
      }
    }
  } catch {
    /* no task file → idle */
  }

  // External session detection (viola pulsante) — only if really idle
  if (sessionStatus === 'idle' && p.externalCwd) {
    if (isClaudeActiveExternally(p.externalCwd)) {
      sessionStatus = 'external_active'
    }
  }

  // V14.2 — PTY embedded vivo dentro ptyManager → pallino running anche senza task file.
  // Rispetta priorità più alta di stati intenzionali (done, waiting_user, paused) e di
  // external_active. Sovrascrive solo idle/unknown/recently_terminated.
  if (
    (sessionStatus === 'idle' || sessionStatus === 'unknown' || sessionStatus === 'recently_terminated')
    && ptyManager.get(p.id)
  ) {
    sessionStatus = 'running'
  }

  // V15.0 WS22 — Override running → waiting_user se il frontend ha segnalato
  // che Claude TUI mostra un menu di scelte (detectPrompts in EmbeddedChat).
  // Pallino diventa giallo (animate) per chiarire che la sessione è in attesa di input.
  if (sessionStatus === 'running' && isWaitingForUser(p.id)) {
    sessionStatus = 'waiting_user'
  }

  // V15.0 WS26 — Differenzia verde pulsante (working, output recente) vs verde
  // fisso (idle, no output > 8s). Identifica caso "Claude attende silenziosamente"
  // senza che l'utente abbia bisogno di trigger esplicito (?).
  if (sessionStatus === 'running') {
    const session = ptyManager.get(p.id)
    if (session && Date.now() - session.lastActivity > 8000) {
      sessionStatus = 'running_idle'
    }
  }

  return { ...p, sessionStatus, sessionOutcome }
}

/** Public helper used by orchestrator router */
export async function getProjectById(id: string): Promise<ProjectEntry | null> {
  return projectsStore.findById(id)
}

function validFolderPath(folder: unknown): folder is string | undefined {
  if (folder === undefined || folder === null || folder === '') return true
  if (typeof folder !== 'string') return false
  if (folder.length > 200) return false
  if (folder.includes('..')) return false
  return /^[a-zA-Z0-9 _-]+(?:\/[a-zA-Z0-9 _-]+)*$/.test(folder)
}

export function projectsRouter(dataDir: string) {
  const router = Router()
  const projectsDir = path.join(dataDir, 'projects')
  const tasksDir = path.join(dataDir, 'tasks')

  /** Legacy user-projects.json importer — one-shot on first request, merges with store */
  async function importLegacyUserProjects() {
    const legacyPath = path.join(projectsDir, 'user-projects.json')
    try {
      const raw = await fs.readFile(legacyPath, 'utf8')
      const data = JSON.parse(raw)
      if (!Array.isArray(data.projects)) return
      const existing = await projectsStore.load()
      const existingIds = new Set(existing.map((p) => p.id))
      let added = 0
      for (const p of data.projects) {
        if (!existingIds.has(p.id)) {
          await projectsStore.add({ ...p, archived: false })
          added++
        }
      }
      if (added > 0) {
        logger.info(`[projects] imported ${added} legacy user-projects into store`)
        // Archive the legacy file so we don't re-import on reload
        await fs.rename(legacyPath, `${legacyPath}.imported-${Date.now()}`)
      }
    } catch {
      /* no legacy file → skip */
    }
  }

  // Trigger one-shot import (async, non-blocking)
  importLegacyUserProjects().catch((err) =>
    logger.warn('[projects] legacy import failed:', err)
  )

  // ========================================================
  // GET / — list all (includes archived; client filters)
  // ========================================================
  router.get('/', async (_req, res) => {
    try {
      const all = await projectsStore.load()
      const enriched = await Promise.all(all.map((p) => enrichWithSession(p, tasksDir)))
      res.json({ projects: enriched })
    } catch (err) {
      logger.error('Projects fetch failed:', err)
      res.status(500).json({ error: 'Failed to load projects' })
    }
  })

  // ========================================================
  // V15.0 WS22 — POST /:id/session-status — frontend signals waiting_user state
  // EmbeddedChat invia status:'waiting_user' quando rileva pendingChoices in PTY
  // output. Reset esplicito con status:'running' quando le scelte sono cleared.
  // TTL 90s safety auto-reset se browser muore.
  // ========================================================
  router.post('/:id/session-status', (req, res) => {
    const id = String(req.params.id).replace(/[^a-z0-9_-]/g, '')
    if (!id) {
      res.status(400).json({ error: 'invalid id' })
      return
    }
    const status = (req.body as { status?: string })?.status
    if (status === 'waiting_user') {
      setWaitingForUser(id, true)
    } else {
      setWaitingForUser(id, false)
    }
    res.json({ ok: true, projectId: id, status })
  })

  // ========================================================
  // GET /:id — single project
  // ========================================================
  router.get('/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'invalid id' })
    const p = await projectsStore.findById(id)
    if (!p) return res.status(404).json({ error: 'not found' })
    const enriched = await enrichWithSession(p, tasksDir)
    res.json(enriched)
  })

  // ========================================================
  // PATCH /:id — partial update (name, folder, category, etc.)
  // ========================================================
  router.patch('/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'invalid id' })

    const parse = ProjectPatchSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({ error: 'invalid patch', details: parse.error.issues })
    }
    const patch = parse.data

    // Extra folder check: defense in depth
    if ('folder' in patch && !validFolderPath(patch.folder)) {
      return res.status(400).json({ error: 'invalid folder path' })
    }

    try {
      const updated = await projectsStore.update(id, patch)
      res.json(updated)
    } catch (err: any) {
      if (err.message?.startsWith('project not found')) {
        return res.status(404).json({ error: 'not found' })
      }
      logger.error('PATCH /projects/:id failed:', err)
      res.status(500).json({ error: 'update failed' })
    }
  })

  // ========================================================
  // POST /:id/archive — archive project (blocked if session active)
  // ========================================================
  router.post('/:id/archive', async (req, res) => {
    const id = String(req.params.id)
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'invalid id' })

    const p = await projectsStore.findById(id)
    if (!p) return res.status(404).json({ error: 'not found' })
    if (p.archived) return res.json(p) // already archived — idempotent

    // Archive lock: session running → 409
    try {
      const taskFile = path.join(tasksDir, `${id}.json`)
      const raw = await fs.readFile(taskFile, 'utf8')
      const task = JSON.parse(raw)
      if (ACTIVE_STATUSES.has(task.status) && isPidAlive(task.pid)) {
        return res.status(409).json({
          error: 'session_active',
          message: 'Chiudi la sessione prima di archiviare il progetto.',
        })
      }
    } catch {
      /* no task → ok to archive */
    }
    // Also check PTY manager for live internal session
    if (ptyManager.get(id)) {
      return res.status(409).json({
        error: 'session_active',
        message: 'Chiudi la sessione PTY prima di archiviare.',
      })
    }

    try {
      const updated = await projectsStore.archive(id)
      logger.info(`[projects] archived ${id}`)
      res.json(updated)
    } catch (err) {
      logger.error('archive failed:', err)
      res.status(500).json({ error: 'archive failed' })
    }
  })

  // ========================================================
  // POST /:id/restore — un-archive
  // ========================================================
  router.post('/:id/restore', async (req, res) => {
    const id = String(req.params.id)
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'invalid id' })

    const p = await projectsStore.findById(id)
    if (!p) return res.status(404).json({ error: 'not found' })

    try {
      const updated = await projectsStore.restore(id)
      logger.info(`[projects] restored ${id}`)
      res.json(updated)
    } catch (err) {
      logger.error('restore failed:', err)
      res.status(500).json({ error: 'restore failed' })
    }
  })

  // ========================================================
  // V14.8 DELETE /:id — hard delete progetto + tutti i file correlati.
  // Richiede progetto archiviato (preventivo). Body: { confirm: 'DELETE' }.
  // Pulisce: data/new-project-<id>/, data/kickoffs/kickoff-<id>-*.md,
  //          data/tasks/<id>.json[.completed], data/logs/<id>.log,
  //          data/project-workspaces/<id>/, data/locks/<id>.lock
  // ========================================================
  router.delete('/:id', async (req, res) => {
    const id = String(req.params.id)
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'invalid id' })

    const confirm = String((req.body as any)?.confirm || '')
    if (confirm !== 'DELETE') {
      return res.status(400).json({ error: 'confirmation required: body must include {"confirm":"DELETE"}' })
    }

    const p = await projectsStore.findById(id)
    if (!p) return res.status(404).json({ error: 'not found' })
    if (!p.archived) {
      return res.status(409).json({ error: 'project must be archived before deletion (use POST /:id/archive first)' })
    }

    // Block delete if PTY embedded ancora vivo (safety)
    if (ptyManager.get(id)) {
      return res.status(409).json({ error: 'PTY embedded ancora attivo — chiudilo prima' })
    }

    const deletedFiles: string[] = []
    const errors: string[] = []
    const safeRm = async (target: string, isDir = false) => {
      try {
        if (!fsSync.existsSync(target)) return
        if (isDir) {
          await fs.rm(target, { recursive: true, force: true })
        } else {
          await fs.unlink(target)
        }
        deletedFiles.push(target.replace(/\\/g, '/'))
      } catch (err: any) {
        errors.push(`${target}: ${err.message || err}`)
      }
    }

    try {
      // 1. Rimuovi dal store (single source of truth)
      const ok = await projectsStore.remove(id)
      if (!ok) {
        logger.warn(`[projects/delete] ${id} not in store but proceeding with file cleanup`)
      }

      // 2. Cleanup file system — paths sicuri (id già regex-validato)
      const dataDir = tasksDir.replace(/[\\/]tasks$/, '')
      // 2a. Project working dir
      await safeRm(path.join(dataDir, `new-project-${id}`), true)
      // 2b. Project workspace (PTY embedded cwd)
      await safeRm(path.join(dataDir, 'project-workspaces', id), true)
      // 2c. Kickoff files (multiple per id, glob match)
      try {
        const kickoffsDir = path.join(dataDir, 'kickoffs')
        if (fsSync.existsSync(kickoffsDir)) {
          const entries = fsSync.readdirSync(kickoffsDir)
          for (const entry of entries) {
            if (entry.startsWith(`kickoff-${id}-`) && entry.endsWith('.md')) {
              await safeRm(path.join(kickoffsDir, entry))
            }
          }
        }
      } catch (err: any) {
        errors.push(`kickoffs scan: ${err.message || err}`)
      }
      // 2d. Tasks state + marker
      await safeRm(path.join(tasksDir, `${id}.json`))
      await safeRm(path.join(tasksDir, `${id}.json.completed`))
      // 2e. Logs
      await safeRm(path.join(dataDir, 'logs', `${id}.log`))
      // 2f. Locks
      await safeRm(path.join(dataDir, 'locks', `${id}.lock`))
      // 2g. Briefs/Responses runtime
      await safeRm(path.join(dataDir, 'briefs', `${id}.json`))
      await safeRm(path.join(dataDir, 'responses', `${id}.json`))
      await safeRm(path.join(dataDir, 'responses', `${id}.txt`))

      logger.info(`[projects/delete] ${id}: removed from store + ${deletedFiles.length} files cleaned (${errors.length} errors)`)
      res.json({
        ok: true,
        id,
        removedFromStore: ok,
        deletedFiles,
        errors,
      })
    } catch (err: any) {
      logger.error(`[projects/delete] ${id} failed:`, err)
      res.status(500).json({ error: err.message || String(err), partialDeletes: deletedFiles, errors })
    }
  })

  // ========================================================
  // POST /:id/move — move to folder (empty = root)
  // ========================================================
  router.post('/:id/move', async (req, res) => {
    const id = String(req.params.id)
    if (!/^[a-z0-9_-]{1,64}$/.test(id)) return res.status(400).json({ error: 'invalid id' })

    const { folder } = req.body as { folder?: string }
    if (!validFolderPath(folder)) {
      return res.status(400).json({ error: 'invalid folder path' })
    }
    try {
      const updated = await projectsStore.moveToFolder(id, folder)
      logger.info(`[projects] moved ${id} → "${folder || '<root>'}"`)
      res.json(updated)
    } catch (err: any) {
      if (err.message?.startsWith('project not found')) {
        return res.status(404).json({ error: 'not found' })
      }
      logger.error('move failed:', err)
      res.status(500).json({ error: 'move failed' })
    }
  })

  return router
}
