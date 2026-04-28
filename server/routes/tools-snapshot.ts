import { Router } from 'express'
import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { logger } from '../lib/logger'
import { getCronToken } from './error-pipeline'

/**
 * V14.28 Step 5 — Trigger tools snapshot (pip + npm + git remote inventory).
 * Esegue PS script che scrive in <vault>/inventory/tools-YYYY-W.md
 */

export function toolsSnapshotRouter() {
  const router = Router()

  router.post('/run', async (req, res) => {
    const expected = await getCronToken()
    if (req.headers['x-cron-token'] !== expected) {
      return res.status(401).json({ error: 'invalid X-Cron-Token' })
    }

    const scriptPath = path.join(process.cwd(), 'scripts', 'cron', 'run-tools-snapshot.ps1')
    try {
      await fs.access(scriptPath)
    } catch {
      return res.status(404).json({ error: `script not found: ${scriptPath}` })
    }

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-NoCron'],
      { detached: true, stdio: 'ignore' }
    )
    child.unref()
    logger.info(`[tools-snapshot] script spawned pid=${child.pid}`)
    res.json({ ok: true, pid: child.pid, hint: 'Inventario in corso, output in <vault>/inventory/' })
  })

  return router
}
