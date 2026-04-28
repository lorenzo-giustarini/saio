import { Router } from 'express'
import { taskTypesStore } from '../lib/task-types-store'
import { TaskTypeSchema } from '../../shared/schemas'
import { logger } from '../lib/logger'

export function taskTypesRouter() {
  const router = Router()

  router.get('/', async (_req, res) => {
    res.json({ taskTypes: await taskTypesStore.list() })
  })

  router.get('/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-z0-9_-]/g, '')
    const t = await taskTypesStore.findById(id)
    if (!t) return res.status(404).json({ error: 'not found' })
    res.json(t)
  })

  router.post('/', async (req, res) => {
    const parsed = TaskTypeSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid', details: parsed.error.issues })
    }
    try {
      const added = await taskTypesStore.add(parsed.data)
      res.status(201).json(added)
    } catch (err: any) {
      res.status(409).json({ error: err.message })
    }
  })

  router.patch('/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-z0-9_-]/g, '')
    const parsed = TaskTypeSchema.partial().safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid', details: parsed.error.issues })
    }
    try {
      const updated = await taskTypesStore.update(id, parsed.data)
      res.json(updated)
    } catch (err: any) {
      res.status(404).json({ error: err.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-z0-9_-]/g, '')
    const ok = await taskTypesStore.remove(id)
    if (!ok) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true, id })
  })

  // Skill scan + auto-add
  router.post('/scan-skills', async (_req, res) => {
    try {
      const newTypes = await taskTypesStore.scanSkillRegistry()
      const added = await taskTypesStore.applyScanResults(newTypes)
      res.json({ ok: true, scanned: newTypes.length, added: added.length, newTypes: added })
    } catch (err: any) {
      logger.error('[task-types] scan failed:', err)
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
