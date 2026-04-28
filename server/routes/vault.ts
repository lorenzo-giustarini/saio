import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from '../lib/logger'

const VAULT_PATH =
  process.env.VAULT_PATH ||
  'C:\\Users\\info\\.claude\\projects\\C--Users-info-Desktop-CLAUDE-WORLD\\memory'

const IGNORED_DIRS = new Set([
  '.git',
  '.obsidian',
  '.smart-env',
  'node_modules',
  'backups',
  '__pycache__',
  '.venv',
])

function insideVault(absPath: string): boolean {
  const resolved = path.resolve(absPath)
  const vaultResolved = path.resolve(VAULT_PATH)
  return resolved.startsWith(vaultResolved)
}

async function buildTree(dir: string, depth = 0, maxDepth = 4): Promise<any> {
  if (depth > maxDepth) return null
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const items: any[] = []
  for (const e of entries) {
    if (IGNORED_DIRS.has(e.name)) continue
    if (e.name.startsWith('.') && depth === 0) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      const children = await buildTree(full, depth + 1, maxDepth)
      if (children && children.length > 0) {
        items.push({
          type: 'dir',
          name: e.name,
          path: path.relative(VAULT_PATH, full).replace(/\\/g, '/'),
          children,
        })
      }
    } else if (e.name.endsWith('.md')) {
      const stat = await fs.stat(full)
      items.push({
        type: 'file',
        name: e.name,
        path: path.relative(VAULT_PATH, full).replace(/\\/g, '/'),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      })
    }
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return items
}

export function vaultRouter() {
  const router = Router()

  // Cache tree (2 min TTL) — vault structure doesn't change often
  let treeCache: { data: any; ts: number } | null = null
  const TREE_CACHE_TTL = 2 * 60_000

  router.get('/tree', async (_req, res) => {
    try {
      if (treeCache && Date.now() - treeCache.ts < TREE_CACHE_TTL) {
        return res.json(treeCache.data)
      }
      const tree = await buildTree(VAULT_PATH)
      const payload = { root: VAULT_PATH, tree }
      treeCache = { data: payload, ts: Date.now() }
      res.json(payload)
    } catch (err) {
      logger.error('Vault tree failed:', err)
      res.status(500).json({ error: String(err) })
    }
  })

  router.get('/file', async (req, res) => {
    try {
      const rel = String(req.query.path || '')
      if (!rel || rel.includes('..')) return res.status(400).json({ error: 'invalid path' })
      const abs = path.join(VAULT_PATH, rel)
      if (!insideVault(abs)) return res.status(403).json({ error: 'forbidden' })
      const stat = await fs.stat(abs)
      if (!stat.isFile()) return res.status(400).json({ error: 'not a file' })
      if (!rel.endsWith('.md')) return res.status(400).json({ error: 'only .md supported' })
      const rawContent = await fs.readFile(abs, 'utf8')

      // Strip YAML frontmatter (between --- markers at start)
      const frontmatterMatch = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
      const frontmatter: Record<string, string> = {}
      let content = rawContent
      if (frontmatterMatch) {
        const fmBody = frontmatterMatch[1]
        for (const line of fmBody.split(/\r?\n/)) {
          const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/)
          if (kv) frontmatter[kv[1]] = kv[2].trim()
        }
        content = rawContent.slice(frontmatterMatch[0].length)
      }

      res.json({
        path: rel,
        name: path.basename(rel),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        frontmatter,
        content,
      })
    } catch (err) {
      logger.error('Vault file read failed:', err)
      res.status(404).json({ error: String(err) })
    }
  })

  router.get('/search', async (req, res) => {
    const q = String(req.query.q || '').toLowerCase().trim()
    if (!q || q.length < 2) return res.json({ results: [] })
    try {
      const results: Array<{ path: string; name: string; snippets: string[] }> = []
      async function walk(dir: string, depth = 0) {
        if (depth > 5) return
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (IGNORED_DIRS.has(e.name)) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            await walk(full, depth + 1)
          } else if (e.name.endsWith('.md')) {
            try {
              const content = await fs.readFile(full, 'utf8')
              const lower = content.toLowerCase()
              if (lower.includes(q) || e.name.toLowerCase().includes(q)) {
                const snippets: string[] = []
                const lines = content.split('\n')
                lines.forEach((ln, i) => {
                  if (ln.toLowerCase().includes(q) && snippets.length < 3) {
                    snippets.push(ln.trim().slice(0, 120))
                  }
                })
                results.push({
                  path: path.relative(VAULT_PATH, full).replace(/\\/g, '/'),
                  name: e.name,
                  snippets,
                })
                if (results.length >= 30) return
              }
            } catch {
              /* skip unreadable */
            }
          }
        }
      }
      await walk(VAULT_PATH)
      res.json({ results })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}
