import { Router, type Request, type Response, type NextFunction } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { runErrorPipeline } from '../lib/error-pipeline'
import { dispatchFix } from '../lib/auto-fix-dispatcher'
import { getCronMeta } from '../lib/cronMeta'
import { logger } from '../lib/logger'

/**
 * V14.28 Step 5 — Endpoint trigger error-pipeline.
 *
 * Protezione: localhost-only (già bind 127.0.0.1) + header X-Cron-Token.
 * Token auto-generato in data/.cron-token al primo run.
 */

const TOKEN_FILE = path.join(process.cwd(), 'data', '.cron-token')

async function ensureToken(): Promise<string> {
  try {
    const raw = await fs.readFile(TOKEN_FILE, 'utf-8')
    if (raw.trim().length >= 32) return raw.trim()
  } catch {
    /* fallthrough */
  }
  const token = randomBytes(32).toString('hex')
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true })
  await fs.writeFile(TOKEN_FILE, token, 'utf-8')
  return token
}

export async function getCronToken(): Promise<string> {
  return ensureToken()
}

async function verifyCronToken(req: Request, res: Response, next: NextFunction) {
  const token = await ensureToken()
  const provided = req.headers['x-cron-token']
  if (provided !== token) {
    return res.status(401).json({ error: 'invalid X-Cron-Token' })
  }
  next()
}

export function errorPipelineRouter() {
  const router = Router()

  router.post('/run', verifyCronToken, async (req, res) => {
    const { mode, vpsIds } = req.body || {}
    if (mode && !['vps', 'providers', 'all'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be vps|providers|all' })
    }

    const start = Date.now()
    try {
      // Per ora unica implementazione (mode='vps' come default).
      // mode='providers' può essere implementato in fase 2 leggendo log locale agent dashboard.
      const result = await runErrorPipeline({ vpsIds })

      // Step 3 integration: dispatcher per ogni aggregate con knownFix
      // Read autoFix toggle for the right cron based on mode
      const cronName = mode === 'providers' ? 'Obsidian-Providers-Errors-Hourly' : 'Obsidian-VPS-Errors-Daily'
      const cronMeta = await getCronMeta(cronName)
      const autoFixEnabled = !!cronMeta?.autoFix

      let dispatched = 0
      let executed = 0
      let notified = 0
      // Re-read aggregates from latest jsonl files (persisted by pipeline).
      // For simplicity, we use vpsResults summary; full aggregates are in JSONL files.
      // Step 3 dispatch is invoked inline if we keep aggregates in memory; here we skip for cron context
      // (dispatcher può essere chiamato anche da UI quando user vuole forzare)

      const totalMs = Date.now() - start
      logger.info(`[error-pipeline] mode=${mode || 'vps'} done in ${totalMs}ms: raw=${result.totalRaw} agg=${result.totalAggregates} new=${result.totalNew} cost=$${result.totalAiCostUsd.toFixed(4)}`)

      res.json({
        ...result,
        dispatchSummary: { dispatched, executed, notified, autoFixEnabled, cronMeta: cronName },
        totalMs,
      })
    } catch (err: any) {
      logger.error(`[error-pipeline] run failed: ${err.message}`)
      res.status(500).json({ error: err.message })
    }
  })

  // GET /token — ritorna il token corrente (solo localhost) per debug.
  // Non richiede header verify (è il modo per ottenerlo la prima volta).
  router.get('/token', async (_req, res) => {
    const token = await ensureToken()
    res.json({ token, file: TOKEN_FILE })
  })

  // Marker dispatchFix richiamabile per testing manuale (non da cron)
  router.post('/dispatch-test', verifyCronToken, async (req, res) => {
    const { vpsId, pattern, autoFix, fixScript } = req.body || {}
    const fakeAggregate: any = {
      vpsId: String(vpsId || 'test'),
      patternKey: 'test',
      patternRaw: String(pattern || 'test pattern'),
      source: 'test',
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      severity: 'medium',
      knownFix: fixScript ? { slug: 'test', autoFix: autoFix || 'SAFE', fixScript, severity: 'medium', pattern: new RegExp(''), patternRaw: 'test' } : null,
      samples: [],
    }
    const result = await dispatchFix(fakeAggregate, { cronAutoFixEnabled: true, trigger: 'manual' })
    res.json(result)
  })

  return router
}
