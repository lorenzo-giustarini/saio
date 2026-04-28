import { Router } from 'express'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from '../lib/logger'
import { sanitizeProjectId } from '../lib/sanitize'
import { resolveSpawnAccount } from '../lib/resolve-spawn-account'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const SPAWN_SINGLE_SCRIPT = path.join(PROJECT_ROOT, 'orchestrator', 'spawn_single.py')
const KILL_ONE_SCRIPT = path.join(PROJECT_ROOT, 'orchestrator', 'kill_one.py')

export function orchestratorRouter(
  dataDir: string,
  getProjectById: (id: string) => Promise<any> | any
) {
  const router = Router()

  // V15.0 WS3-3F — Health check vero. Legge data/orchestrator.health (heartbeat
  // scritto dal Python orchestrator ogni 30s con pid+ts).
  router.get('/health', async (_req, res) => {
    const healthFile = path.join(dataDir, 'orchestrator.health')
    try {
      const content = await fs.readFile(healthFile, 'utf-8')
      const data = JSON.parse(content) as { pid: number; ts: string; uptime?: number }
      const ageSec = (Date.now() - new Date(data.ts).getTime()) / 1000

      // Process alive check
      let processAlive = false
      try {
        process.kill(data.pid, 0) // signal 0 = check only
        processAlive = true
      } catch {
        processAlive = false
      }

      let status: 'up' | 'stale' | 'down' = 'up'
      if (!processAlive) status = 'down'
      else if (ageSec > 90) status = 'stale'

      res.json({
        status,
        pid: data.pid,
        lastHeartbeat: data.ts,
        ageSeconds: Math.round(ageSec),
        uptime: data.uptime,
        processAlive,
      })
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return res.json({ status: 'down', reason: 'no heartbeat file', hint: 'orchestrator non avviato' })
      }
      res.status(500).json({ status: 'unknown', error: err.message })
    }
  })

  router.post('/spawn/:projectId', async (req, res) => {
    try {
      const projectId = sanitizeProjectId(req.params.projectId)
      const project = await getProjectById(projectId)
      if (!project) return res.status(404).json({ error: 'project not found' })

      // V13.1 BUG1a: resolve CLI/account from active global or projectOverride
      const accountSpec = await resolveSpawnAccount(projectId).catch((err) => {
        logger.warn(`[orchestrator] account resolve failed:`, err)
        return null
      })

      const payload = {
        projectId,
        title: project.name,
        dataDir,
        kickoffMessage: project.kickoffTemplate || req.body?.kickoffMessage || '',
        tags: project.tags || [],
        // V13.1 BUG1a: CLI override
        cliName: accountSpec?.cliName || 'claude',
        cliArgs: accountSpec?.cliArgs || [],
        envOverrides: accountSpec?.envOverrides || {},
      }

      const pyExe = process.env.PYTHON_EXE || 'python'
      const child = spawn(pyExe, [SPAWN_SINGLE_SCRIPT], {
        shell: false,
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d.toString()))
      child.stderr.on('data', (d) => (stderr += d.toString()))

      child.stdin.write(JSON.stringify(payload))
      child.stdin.end()

      child.on('close', (code) => {
        if (code !== 0) {
          logger.error(`spawn_single exit ${code}: ${stderr}`)
          return res.status(500).json({ error: stderr || `exit ${code}` })
        }
        try {
          const result = JSON.parse(stdout.trim().split('\n').pop() || '{}')
          res.json(result)
        } catch (e) {
          res.status(500).json({ error: 'malformed spawn response', raw: stdout })
        }
      })

      child.on('error', (err) => {
        logger.error('spawn error:', err)
        res.status(500).json({ error: String(err) })
      })
    } catch (err) {
      res.status(400).json({ error: String(err) })
    }
  })

  /**
   * V14.1: DELETE /api/orchestrator/kill/:projectId
   * Killa la finestra cmd.exe esterna spawnata da /spawn/:projectId.
   * Legge il PID da data/tasks/<id>.json e invoca orchestrator/kill_one.py
   * (che usa psutil + taskkill /T /F come fallback).
   * Aggiorna il task file a status='idle' + sessionOutcome='killed_by_user'.
   */
  router.delete('/kill/:projectId', async (req, res) => {
    let id: string
    try {
      id = sanitizeProjectId(req.params.projectId)
    } catch (err: any) {
      return res.status(400).json({ ok: false, error: String(err.message || err) })
    }

    const taskFile = path.join(dataDir, 'tasks', `${id}.json`)
    let pid: number | undefined
    let task: any = null
    try {
      const raw = await fs.readFile(taskFile, 'utf8')
      task = JSON.parse(raw)
      pid = typeof task.pid === 'number' ? task.pid : undefined
    } catch {
      return res.json({ ok: false, reason: 'no task file', projectId: id })
    }
    if (!pid) {
      return res.json({ ok: false, reason: 'no pid in task', projectId: id })
    }

    const pyExe = process.env.PYTHON_EXE || 'python'
    const child = spawn(pyExe, [KILL_ONE_SCRIPT, String(pid)], {
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))

    child.on('close', async (code) => {
      // Aggiorno il task file (best-effort, non bloccante per la response)
      try {
        const updated = {
          ...task,
          status: 'idle',
          sessionOutcome: 'killed_by_user',
          currentStep: 'Terminata da utente (kill esterno)',
          updatedAt: new Date().toISOString(),
          history: [
            ...(task.history || []),
            { ts: new Date().toISOString(), event: `killed externally (pid=${pid}, exit=${code})` },
          ],
        }
        await fs.writeFile(taskFile, JSON.stringify(updated, null, 2))
      } catch (err) {
        logger.warn(`[orchestrator/kill] task file update failed: ${err}`)
      }

      logger.info(`[orchestrator/kill] ${id}: pid=${pid} exit=${code} stdout=${stdout.trim()} stderr=${stderr.trim()}`)
      res.json({
        ok: code === 0,
        killedPid: pid,
        projectId: id,
        stdout: stdout.trim().slice(0, 500),
        stderr: stderr.trim().slice(0, 500),
      })
    })

    child.on('error', (err) => {
      logger.error(`[orchestrator/kill] spawn error: ${err}`)
      res.status(500).json({ ok: false, error: String(err.message || err) })
    })
  })

  return router
}
