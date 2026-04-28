import { Router } from 'express'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { logger } from '../lib/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const DEEP_SCRIPT = path.join(PROJECT_ROOT, 'orchestrator', 'spawn_deepresearch.py')
const DOCS_DIR = path.join(os.homedir(), 'Documents')

const MODES = ['quick', 'standard', 'deep', 'ultradeep'] as const
type Mode = typeof MODES[number]

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `research-${Date.now()}`
}

export function deepResearchRouter() {
  const router = Router()

  router.post('/start', async (req, res) => {
    try {
      const { title, query, mode } = req.body as { title?: string; query?: string; mode?: Mode }
      if (!query || query.length < 3 || query.length > 2000) {
        return res.status(400).json({ error: 'query 3-2000 chars required' })
      }
      if (mode && !MODES.includes(mode)) {
        return res.status(400).json({ error: 'invalid mode' })
      }
      const slug = slugify(title || query)
      const pyExe = process.env.PYTHON_EXE || 'python'

      const child = spawn(pyExe, [DEEP_SCRIPT], {
        shell: false,
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => (stdout += d.toString()))
      child.stderr.on('data', (d) => (stderr += d.toString()))

      child.stdin.write(JSON.stringify({
        title: title || 'Deep Research',
        query,
        mode: mode || 'standard',
        slug,
      }))
      child.stdin.end()

      child.on('close', (code) => {
        if (code !== 0) {
          logger.error(`deepresearch spawn exit ${code}: ${stderr}`)
          return res.status(500).json({ error: stderr || `exit ${code}` })
        }
        try {
          const result = JSON.parse(stdout.trim().split('\n').pop() || '{}')
          res.json({ ...result, slug, expectedDir: path.join(DOCS_DIR, `*${slug}*Research*`) })
        } catch (e) {
          res.status(500).json({ error: 'malformed response', raw: stdout })
        }
      })

      child.on('error', (err) => {
        logger.error('deepresearch spawn error:', err)
        res.status(500).json({ error: String(err) })
      })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // List completed researches by scanning ~/Documents/*_Research_*
  router.get('/list', async (_req, res) => {
    try {
      const entries = await fs.readdir(DOCS_DIR, { withFileTypes: true })
      const items: Array<{
        slug: string
        dir: string
        title: string
        completedAt: string
        pdfPath: string | null
        sizeMB: number
      }> = []
      for (const e of entries) {
        if (!e.isDirectory()) continue
        if (!e.name.toLowerCase().includes('research')) continue
        const fullDir = path.join(DOCS_DIR, e.name)
        const stat = await fs.stat(fullDir)
        let pdfPath: string | null = null
        let sizeMB = 0
        try {
          const files = await fs.readdir(fullDir)
          const pdfs = files.filter((f) => f.toLowerCase().endsWith('.pdf'))
          if (pdfs.length > 0) {
            pdfPath = path.join(fullDir, pdfs[0])
            const st = await fs.stat(pdfPath)
            sizeMB = +(st.size / 1024 / 1024).toFixed(2)
          }
        } catch {
          /* skip */
        }
        items.push({
          slug: slugify(e.name),
          dir: fullDir,
          title: e.name.replace(/_Research_.*$/, '').replace(/_/g, ' '),
          completedAt: stat.mtime.toISOString(),
          pdfPath,
          sizeMB,
        })
      }
      items.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      res.json({ items: items.slice(0, 30) })
    } catch (err: any) {
      res.json({ items: [] })
    }
  })

  // Stream PDF
  router.get('/pdf', (req, res) => {
    const p = String(req.query.path || '')
    if (!p) return res.status(400).json({ error: 'path required' })
    // Must be inside DOCS_DIR
    const resolved = path.resolve(p)
    if (!resolved.startsWith(path.resolve(DOCS_DIR))) {
      return res.status(403).json({ error: 'forbidden path' })
    }
    if (!resolved.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({ error: 'only PDF' })
    }
    if (!fsSync.existsSync(resolved)) return res.status(404).json({ error: 'not found' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(resolved)}"`)
    fsSync.createReadStream(resolved).pipe(res)
  })

  return router
}
