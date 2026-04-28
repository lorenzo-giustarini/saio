import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../lib/atomic-write'

export function mcpDiscoveryRouter(dataDir: string) {
  const router = Router()
  const metaPath = path.join(dataDir, 'mcp-suggestions.json')
  const seenPath = path.join(dataDir, 'mcp-suggestions-seen.json')

  router.get('/', async (_req, res) => {
    try {
      const raw = await fs.readFile(metaPath, 'utf8')
      const meta = JSON.parse(raw)
      let newSinceLastView = true
      try {
        const seenRaw = await fs.readFile(seenPath, 'utf8')
        const seen = JSON.parse(seenRaw)
        newSinceLastView = seen.lastSeen !== meta.lastRun
      } catch {
        /* never seen */
      }
      res.json({ ...meta, newSinceLastView, available: true })
    } catch {
      res.json({ available: false, newSinceLastView: false })
    }
  })

  router.post('/mark-read', async (_req, res) => {
    try {
      const raw = await fs.readFile(metaPath, 'utf8')
      const meta = JSON.parse(raw)
      await atomicWriteFile(seenPath, JSON.stringify({ lastSeen: meta.lastRun }, null, 2))
      res.json({ ok: true })
    } catch (err: any) {
      res.status(404).json({ error: 'no suggestions yet' })
    }
  })

  return router
}
