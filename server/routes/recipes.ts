import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../lib/logger'

/**
 * V14.28 Step 4 — API recipes browse.
 * Read-only su <vault>/recipes/. UI dashboard mostra anti-pattern + atomic
 * con search client-side. Mai scrive (build_recipes.py è l'unico writer).
 */

const VAULT_RECIPES_DIR = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'memory',
  'recipes',
)

const INDEX_JSON = path.join(VAULT_RECIPES_DIR, 'recipes-index.json')

interface RecipeIndexItem {
  slug: string
  title: string
  tags: string[]
  sessionsSeenCount: number
  discoveredAt: string
  timeSavedMin?: number
  filePath: string
}

interface RecipeIndex {
  lastBuiltAt: string
  antiPatterns: RecipeIndexItem[]
  atomic: RecipeIndexItem[]
}

async function loadIndex(): Promise<RecipeIndex | null> {
  try {
    const raw = await fs.readFile(INDEX_JSON, 'utf-8')
    return JSON.parse(raw) as RecipeIndex
  } catch (err: any) {
    if (err.code === 'ENOENT') return null
    logger.warn(`recipes index load failed: ${err.message}`)
    return null
  }
}

const SLUG_REGEX = /^[a-z0-9-]+$/

export function recipesRouter() {
  const router = Router()

  router.get('/', async (_req, res) => {
    const index = await loadIndex()
    if (!index) {
      return res.json({
        lastBuiltAt: null,
        antiPatterns: [],
        atomic: [],
        hint: 'Recipe Builder non ha ancora generato output. Cron daily 03:00 oppure run manuale: python <vault>/scripts/build_recipes.py',
      })
    }
    res.json(index)
  })

  router.get('/:type/:slug', async (req, res) => {
    const type = String(req.params.type)
    const slug = String(req.params.slug)
    if (!['anti-patterns', 'atomic'].includes(type)) {
      return res.status(400).json({ error: 'type must be anti-patterns or atomic' })
    }
    if (!SLUG_REGEX.test(slug)) {
      return res.status(400).json({ error: 'invalid slug' })
    }
    try {
      const filePath = path.join(VAULT_RECIPES_DIR, type, `${slug}.md`)
      // Path traversal check
      const rel = path.relative(VAULT_RECIPES_DIR, filePath)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(400).json({ error: 'invalid path' })
      }
      const content = await fs.readFile(filePath, 'utf-8')
      res.json({ slug, type, content, filePath: `recipes/${type}/${slug}.md` })
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'recipe not found' })
      }
      logger.error(`recipe read failed: ${err.message}`)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/build', async (_req, res) => {
    // Trigger manual build (utile per test). Esegue python script.
    const { spawn } = await import('node:child_process')
    const scriptPath = path.join(
      os.homedir(),
      '.claude',
      'projects',
      'C--Users-info-Desktop-CLAUDE-WORLD',
      'memory',
      'scripts',
      'build_recipes.py',
    )
    try {
      await fs.access(scriptPath)
    } catch {
      return res.status(404).json({ error: `build script not found: ${scriptPath}` })
    }
    const child = spawn('python', [scriptPath], {
      shell: false,
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    res.json({ ok: true, pid: child.pid, hint: 'Build avviato in background. Refresh /api/recipes tra ~30s' })
  })

  return router
}
