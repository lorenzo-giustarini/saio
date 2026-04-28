import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from '../lib/logger'

export function archiveRouter(dataDir: string) {
  const router = Router()
  const archiveDir = path.join(dataDir, 'archive')
  const responsesDir = path.join(dataDir, 'responses')

  router.get('/', async (_req, res) => {
    try {
      const entries: {
        filename: string
        path: string
        date: string
        size: number
      }[] = []

      for (const dir of [archiveDir, responsesDir]) {
        try {
          const files = await fs.readdir(dir)
          for (const f of files) {
            if (!f.endsWith('.json')) continue
            const fp = path.join(dir, f)
            const stat = await fs.stat(fp)
            entries.push({
              filename: f,
              path: fp,
              date: stat.mtime.toISOString(),
              size: stat.size,
            })
          }
        } catch {
          /* dir may not exist yet */
        }
      }

      entries.sort((a, b) => b.date.localeCompare(a.date))
      res.json({ entries })
    } catch (err) {
      logger.error('Archive list failed:', err)
      res.status(500).json({ error: 'Failed to list archive' })
    }
  })

  router.get('/item', async (req, res) => {
    const q = req.query.path
    if (typeof q !== 'string') return res.status(400).json({ error: 'path required' })
    try {
      const resolved = path.resolve(q)
      if (!resolved.startsWith(path.resolve(dataDir))) {
        return res.status(403).json({ error: 'forbidden path' })
      }
      const raw = await fs.readFile(resolved, 'utf8')
      res.json(JSON.parse(raw))
    } catch {
      res.status(404).json({ error: 'not found' })
    }
  })

  // V14.23 — DELETE singolo entry (path JSON in archive/ o responses/)
  router.delete('/item', async (req, res) => {
    const q = (req.body?.path || req.query.path) as string | undefined
    if (typeof q !== 'string') return res.status(400).json({ error: 'path required' })
    try {
      const resolved = path.resolve(q)
      const allowedRoots = [path.resolve(archiveDir), path.resolve(responsesDir)]
      if (!allowedRoots.some((root) => resolved.startsWith(root))) {
        return res.status(403).json({ error: 'forbidden path' })
      }
      if (!resolved.endsWith('.json')) {
        return res.status(400).json({ error: 'only .json files allowed' })
      }
      await fs.unlink(resolved)
      res.json({ ok: true, deleted: resolved })
    } catch (err: any) {
      if (err?.code === 'ENOENT') return res.status(404).json({ error: 'not found' })
      logger.error('Archive delete failed:', err)
      res.status(500).json({ error: err?.message || 'delete failed' })
    }
  })

  // V14.23 — Clear all (richiede {confirm:"DELETE-ALL"})
  router.post('/clear', async (req, res) => {
    if ((req.body?.confirm) !== 'DELETE-ALL') {
      return res.status(400).json({ error: 'confirmation required: body must include {"confirm":"DELETE-ALL"}' })
    }
    const deleted: string[] = []
    const errors: string[] = []
    for (const dir of [archiveDir, responsesDir]) {
      try {
        const files = await fs.readdir(dir)
        for (const f of files) {
          if (!f.endsWith('.json')) continue
          const fp = path.join(dir, f)
          try {
            await fs.unlink(fp)
            deleted.push(fp)
          } catch (e: any) {
            errors.push(`${fp}: ${e?.message || e}`)
          }
        }
      } catch {
        /* dir may not exist */
      }
    }
    res.json({ ok: true, deletedCount: deleted.length, deleted, errors })
  })

  return router
}
