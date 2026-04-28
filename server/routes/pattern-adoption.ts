import { Router } from 'express'
import { runPatternAdoption } from '../lib/pattern-adoption'
import { logger } from '../lib/logger'
import { getCronToken } from './error-pipeline'

/**
 * V14.28 Step 5 — Pattern adoption tracker route.
 */
export function patternAdoptionRouter() {
  const router = Router()

  router.post('/run', async (req, res) => {
    const expected = await getCronToken()
    if (req.headers['x-cron-token'] !== expected) {
      return res.status(401).json({ error: 'invalid X-Cron-Token' })
    }
    try {
      const metrics = await runPatternAdoption()
      res.json({
        ok: true,
        recipesScanned: metrics.length,
        adoptedCount: metrics.filter((m) => m.status === 'adopted').length,
        pendingCount: metrics.filter((m) => m.status !== 'adopted').length,
      })
    } catch (err: any) {
      logger.error(`[pattern-adoption] run failed: ${err.message}`)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
