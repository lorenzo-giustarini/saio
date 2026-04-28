/**
 * V15.0 WS22 — Performance snapshot endpoint.
 *
 * GET /api/perf/snapshot
 *   Spawna `orchestrator/perf-snapshot.py` con i PIDs di:
 *   - Orchestrator Python (da data/orchestrator.health, se presente e PID alive)
 *   - Tutte le PTY sessions live (da ptyManager.list())
 *   Ritorna JSON con totalCpuPercent (sommato) + dettaglio per processo.
 *
 *   Usato dal frontend `usePerfMonitor` hook per detection CPU saturo > 100%
 *   sostenuto per > 10s → trigger PerfAlert (toast + banner + audio).
 *
 * Polling consigliato: ogni 2s. Cost: 1 spawn Python ogni call (~50ms typical).
 * Per ridurre overhead, l'endpoint risponde subito {} se non ci sono PIDs da monitorare.
 */
import { Router } from 'express'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ptyManager } from '../lib/pty-manager'
import { resolvePythonExe } from '../lib/python-deps-check'
import { logger } from '../lib/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT_PATH = path.join(PROJECT_ROOT, 'orchestrator', 'perf-snapshot.py')
const HEALTH_FILE = path.join(PROJECT_ROOT, 'data', 'orchestrator.health')

interface PerfSnapshot {
  totalCpuPercent: number
  cpuCount?: number
  processes: Array<{
    pid: number
    name?: string
    cpu?: number
    mem_mb?: number
    status?: string
    parent?: number
    error?: string
  }>
  error?: string
}

async function readOrchestratorPid(): Promise<number | null> {
  try {
    const content = await fs.readFile(HEALTH_FILE, 'utf-8')
    const data = JSON.parse(content) as { pid?: number; ts?: number }
    if (!data.pid) return null
    // Verifica PID alive con process.kill(pid, 0)
    try {
      process.kill(data.pid, 0)
      return data.pid
    } catch {
      return null
    }
  } catch {
    return null
  }
}

function spawnPerfScript(pids: number[]): Promise<PerfSnapshot> {
  return new Promise(async (resolve) => {
    if (pids.length === 0) {
      resolve({ totalCpuPercent: 0, processes: [] })
      return
    }
    const py = await resolvePythonExe()
    const proc = spawn(py, [SCRIPT_PATH, ...pids.map(String)], {
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf-8')))
    proc.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf-8')))
    proc.on('error', (err) => {
      logger.warn('[perf] spawn error:', err.message)
      resolve({ totalCpuPercent: 0, processes: [], error: 'spawn_failed' })
    })
    proc.on('exit', () => {
      try {
        const parsed = JSON.parse(stdout.trim()) as PerfSnapshot
        resolve(parsed)
      } catch (err) {
        logger.warn('[perf] parse error, stderr:', stderr.slice(-200))
        resolve({ totalCpuPercent: 0, processes: [], error: 'parse_failed' })
      }
    })
    // Safety timeout 4s (script normally <1s)
    setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* */
      }
    }, 4000)
  })
}

export function perfRouter(): Router {
  const router = Router()

  router.get('/snapshot', async (_req, res) => {
    try {
      const ptyPids = ptyManager
        .list()
        .map((s) => s.pid)
        .filter((p): p is number => typeof p === 'number' && p > 0)
      const orchPid = await readOrchestratorPid()
      const allPids = orchPid ? [orchPid, ...ptyPids] : ptyPids

      const snapshot = await spawnPerfScript(allPids)
      res.json(snapshot)
    } catch (err) {
      logger.error('[perf] snapshot failed:', err)
      res.status(500).json({
        totalCpuPercent: 0,
        processes: [],
        error: 'internal_error',
        message: (err as Error).message,
      })
    }
  })

  return router
}
