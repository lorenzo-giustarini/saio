import { Router } from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../lib/logger'
import { computeCost, hasPricing, PRICING, type TokenUsage } from '../lib/pricing'
import { atomicWriteFile } from '../lib/atomic-write'
import { startProcessJob, getCurrentJob } from '../lib/feedback-processor'

const CLAUDE_HOME = path.join(os.homedir(), '.claude')
const PROJECTS_DIR = path.join(CLAUDE_HOME, 'projects')

// Opus 4.7 pricing per 1M tokens (Sep 2024 rates)
const PRICE = {
  input: 15,
  output: 75,
  cacheRead: 1.5, // 10% of input
  cacheCreate5m: 18.75, // 25% premium
  cacheCreate1h: 30, // 100% premium
} as const

interface DayStats {
  date: string
  inputTokens: number
  outputTokens: number
  cacheRead: number
  cacheCreate5m: number
  cacheCreate1h: number
  totalTokens: number
  costUSD: number
  messages: number
}

let tokenCache: { days: Map<string, DayStats>; computedAt: number } | null = null
const TOKEN_CACHE_TTL = 3 * 60_000 // 3 min

async function computeRealTokens(): Promise<Map<string, DayStats>> {
  const byDay = new Map<string, DayStats>()

  async function walk(dir: string, depth = 0): Promise<void> {
    if (depth > 4) return
    const entries = await fsSync.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name === 'subagents') continue // aggregate main sessions
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full, depth + 1)
      } else if (e.name.endsWith('.jsonl')) {
        await processFile(full)
      }
    }
  }

  async function processFile(filePath: string): Promise<void> {
    try {
      const content = await fsSync.promises.readFile(filePath, 'utf8')
      for (const line of content.split('\n')) {
        if (!line.trim()) continue
        try {
          const evt = JSON.parse(line)
          // Only count 'assistant' events with usage
          if (evt.type !== 'assistant') continue
          const msg = evt.message
          if (!msg || !msg.usage) continue
          const usage = msg.usage
          const ts = evt.timestamp || msg.timestamp || evt.createdAt
          if (!ts) continue
          const dateKey = new Date(ts).toISOString().slice(0, 10)

          const prev = byDay.get(dateKey) || {
            date: dateKey,
            inputTokens: 0,
            outputTokens: 0,
            cacheRead: 0,
            cacheCreate5m: 0,
            cacheCreate1h: 0,
            totalTokens: 0,
            costUSD: 0,
            messages: 0,
          }

          const input = usage.input_tokens || 0
          const output = usage.output_tokens || 0
          const cacheRead = usage.cache_read_input_tokens || 0
          const cacheCreate = usage.cache_creation_input_tokens || 0
          const ephemeral5m = usage.cache_creation?.ephemeral_5m_input_tokens || 0
          const ephemeral1h = usage.cache_creation?.ephemeral_1h_input_tokens || 0

          prev.inputTokens += input
          prev.outputTokens += output
          prev.cacheRead += cacheRead
          prev.cacheCreate5m += ephemeral5m
          prev.cacheCreate1h += ephemeral1h
          prev.totalTokens += input + output + cacheRead + cacheCreate
          prev.costUSD +=
            (input / 1_000_000) * PRICE.input +
            (output / 1_000_000) * PRICE.output +
            (cacheRead / 1_000_000) * PRICE.cacheRead +
            (ephemeral5m / 1_000_000) * PRICE.cacheCreate5m +
            (ephemeral1h / 1_000_000) * PRICE.cacheCreate1h
          prev.messages += 1
          byDay.set(dateKey, prev)
        } catch {
          /* skip malformed */
        }
      }
    } catch {
      /* skip unreadable */
    }
  }

  await walk(PROJECTS_DIR)
  return byDay
}

export function metricsRouter(dataDir: string) {
  const router = Router()
  const metricsDir = path.join(dataDir, 'metrics')
  const feedbackDir = path.join(dataDir, 'feedback')

  router.get('/tokens', async (_req, res) => {
    try {
      // Use cache if fresh
      if (!tokenCache || Date.now() - tokenCache.computedAt > TOKEN_CACHE_TTL) {
        const days = await computeRealTokens()
        tokenCache = { days, computedAt: Date.now() }
      }

      const today = new Date()
      const series: Array<DayStats & { tokens: number }> = []
      let totalCost = 0
      let totalTokens = 0
      let totalMessages = 0

      for (let i = 13; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const dateKey = d.toISOString().slice(0, 10)
        const stats = tokenCache.days.get(dateKey) || {
          date: dateKey,
          inputTokens: 0,
          outputTokens: 0,
          cacheRead: 0,
          cacheCreate5m: 0,
          cacheCreate1h: 0,
          totalTokens: 0,
          costUSD: 0,
          messages: 0,
        }
        series.push({ ...stats, tokens: stats.totalTokens })
        totalCost += stats.costUSD
        totalTokens += stats.totalTokens
        totalMessages += stats.messages
      }

      res.json({
        series,
        source: '~/.claude/projects/**/*.jsonl (message.usage)',
        disclaimer:
          'Token REALI estratti dai file di sessione Claude Code. Include input/output/cache (5m+1h). Costo calcolato con pricing Opus 4.7 ufficiale.',
        pricing: {
          inputPerM: PRICE.input,
          outputPerM: PRICE.output,
          cacheReadPerM: PRICE.cacheRead,
          cacheCreate5mPerM: PRICE.cacheCreate5m,
          cacheCreate1hPerM: PRICE.cacheCreate1h,
        },
        totals: {
          tokens: totalTokens,
          costUSD: +totalCost.toFixed(2),
          messages: totalMessages,
        },
        updatedAt: new Date(tokenCache.computedAt).toISOString(),
      })
    } catch (err) {
      logger.error('tokens metric error:', err)
      res.json({ series: [], updatedAt: new Date().toISOString(), error: String(err) })
    }
  })

  // =====================================================================
  // V13.1 T10 — Token breakdown per date × model × type, with cost
  // =====================================================================
  router.get('/tokens/detailed', async (_req, res) => {
    try {
      // Compute fresh (not using the aggregate cache since we need per-model detail)
      type ModelBreakdown = {
        input: number
        output: number
        cache_read: number
        cache_5m: number
        cache_1h: number
        messages: number
      }
      type DayModelBreakdown = {
        date: string
        byModel: Record<string, ModelBreakdown>
        total: ModelBreakdown
      }
      const byDay = new Map<string, DayModelBreakdown>()

      async function walk(dir: string, depth = 0): Promise<void> {
        if (depth > 4) return
        const entries = await fsSync.promises.readdir(dir, { withFileTypes: true }).catch(() => [])
        for (const e of entries) {
          if (e.name === 'subagents') continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) await walk(full, depth + 1)
          else if (e.name.endsWith('.jsonl')) await processFile(full)
        }
      }

      async function processFile(filePath: string): Promise<void> {
        try {
          const content = await fsSync.promises.readFile(filePath, 'utf8')
          for (const line of content.split('\n')) {
            if (!line.trim()) continue
            try {
              const evt = JSON.parse(line)
              if (evt.type !== 'assistant') continue
              const msg = evt.message
              if (!msg?.usage) continue
              const ts = evt.timestamp || msg.timestamp || evt.createdAt
              if (!ts) continue
              const dateKey = new Date(ts).toISOString().slice(0, 10)
              const model = (msg.model || 'unknown').toLowerCase()

              const u = msg.usage
              const input = u.input_tokens || 0
              const output = u.output_tokens || 0
              const cacheRead = u.cache_read_input_tokens || 0
              const cache5m = u.cache_creation?.ephemeral_5m_input_tokens || 0
              const cache1h = u.cache_creation?.ephemeral_1h_input_tokens || 0

              let day = byDay.get(dateKey)
              if (!day) {
                day = {
                  date: dateKey,
                  byModel: {},
                  total: { input: 0, output: 0, cache_read: 0, cache_5m: 0, cache_1h: 0, messages: 0 },
                }
                byDay.set(dateKey, day)
              }
              let mb = day.byModel[model]
              if (!mb) {
                mb = { input: 0, output: 0, cache_read: 0, cache_5m: 0, cache_1h: 0, messages: 0 }
                day.byModel[model] = mb
              }
              mb.input += input
              mb.output += output
              mb.cache_read += cacheRead
              mb.cache_5m += cache5m
              mb.cache_1h += cache1h
              mb.messages += 1
              day.total.input += input
              day.total.output += output
              day.total.cache_read += cacheRead
              day.total.cache_5m += cache5m
              day.total.cache_1h += cache1h
              day.total.messages += 1
            } catch {
              /* skip malformed */
            }
          }
        } catch {
          /* unreadable */
        }
      }

      await walk(PROJECTS_DIR)

      // Build 14-day series
      const today = new Date()
      const series: Array<{
        date: string
        byModel: Record<string, ModelBreakdown & { costUSD: number; hasPricing: boolean }>
        total: ModelBreakdown & { costUSD: number }
      }> = []

      let grandTotalCost = 0

      for (let i = 13; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const dateKey = d.toISOString().slice(0, 10)
        const day = byDay.get(dateKey)
        if (!day) {
          series.push({
            date: dateKey,
            byModel: {},
            total: { input: 0, output: 0, cache_read: 0, cache_5m: 0, cache_1h: 0, messages: 0, costUSD: 0 },
          })
          continue
        }
        const entry: any = { date: dateKey, byModel: {}, total: { ...day.total, costUSD: 0 } }
        let dayCost = 0
        for (const [model, mb] of Object.entries(day.byModel)) {
          const usage: TokenUsage = {
            input: mb.input,
            output: mb.output,
            cache_read: mb.cache_read,
            cache_5m: mb.cache_5m,
            cache_1h: mb.cache_1h,
          }
          const cost = computeCost(model, usage)
          dayCost += cost
          entry.byModel[model] = {
            ...mb,
            costUSD: +cost.toFixed(4),
            hasPricing: hasPricing(model),
          }
        }
        entry.total.costUSD = +dayCost.toFixed(4)
        grandTotalCost += dayCost
        series.push(entry)
      }

      // Unique models seen
      const modelsSeen = new Set<string>()
      for (const d of series) Object.keys(d.byModel).forEach((m) => modelsSeen.add(m))

      res.json({
        series,
        modelsSeen: Array.from(modelsSeen).sort(),
        pricingDb: Object.keys(PRICING).length,
        totalCostUSD: +grandTotalCost.toFixed(2),
        updatedAt: new Date().toISOString(),
        disclaimer:
          'Breakdown REALE da ~/.claude/projects/**/*.jsonl. Costo computato SOLO se il modello è nella pricing table (vedi server/lib/pricing.ts). Plan subscriptions NON hanno costi per-token.',
      })
    } catch (err: any) {
      logger.error('tokens/detailed error:', err)
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  router.get('/feedback', async (_req, res) => {
    try {
      const files = await fs.readdir(feedbackDir).catch(() => [])
      const items = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = await fs.readFile(path.join(feedbackDir, f), 'utf8')
          items.push(JSON.parse(raw))
        } catch {
          /* skip */
        }
      }
      items.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
      res.json({ items: items.slice(0, 50) })
    } catch {
      res.json({ items: [] })
    }
  })

  // V14.19 — Conta feedback non ancora elaborati (per badge UI)
  router.get('/feedback/pending-count', async (_req, res) => {
    try {
      const files = await fs.readdir(feedbackDir).catch(() => [] as string[])
      let pending = 0
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        const okExists = fsSync.existsSync(path.join(feedbackDir, `${f}.processed`))
        const errExists = fsSync.existsSync(path.join(feedbackDir, `${f}.error`))
        if (!okExists && !errExists) pending++
      }
      res.json({ pending, total: files.filter((f) => f.endsWith('.json')).length })
    } catch {
      res.json({ pending: 0, total: 0 })
    }
  })

  // V14.19 — Avvia job AI 2-step processing
  router.post('/feedback/process-all', async (req, res) => {
    try {
      const cliBinary = (req.body?.cliBinary as string) || process.env.SAIO_CLI_BINARY || 'claude'
      const briefsDir = path.join(dataDir, 'briefs')
      const locksDir = path.join(dataDir, 'locks')
      const result = await startProcessJob({
        cliBinary,
        feedbackDir,
        briefsDir,
        locksDir,
      })
      res.status(202).json(result)
    } catch (err: any) {
      res.status(409).json({ error: err?.message || 'failed to start job' })
    }
  })

  // V14.19 — Stato job (polling)
  router.get('/feedback/process-status', (_req, res) => {
    res.json(getCurrentJob() || { status: 'idle' })
  })

  // V14.18 — POST nota di feedback rapida (osservazioni, idee, correzioni AI)
  router.post('/feedback', async (req, res) => {
    try {
      const { text } = (req.body || {}) as { text?: string }
      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'text required' })
      }
      const trimmed = text.trim()
      if (trimmed.length < 3 || trimmed.length > 2000) {
        return res.status(400).json({ error: 'text must be 3-2000 chars' })
      }
      const id = `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const ts = new Date().toISOString()
      await fs.mkdir(feedbackDir, { recursive: true })
      await atomicWriteFile(
        path.join(feedbackDir, `${id}.json`),
        JSON.stringify({ id, ts, text: trimmed }, null, 2)
      )
      res.json({ ok: true, id, ts })
    } catch (err: any) {
      logger.error('feedback POST failed:', err)
      res.status(500).json({ error: err?.message || 'feedback save failed' })
    }
  })

  // Cache heavy vault scans (5 min TTL) — these endpoints walk 211 files
  let vaultHealthCache: { data: any; ts: number } | null = null
  let knowledgeGrowthCache: { data: any; ts: number } | null = null
  const CACHE_TTL = 5 * 60_000

  router.get('/vault-health', async (_req, res) => {
    const VAULT_PATH =
      process.env.VAULT_PATH ||
      'C:\\Users\\info\\.claude\\projects\\C--Users-info-Desktop-CLAUDE-WORLD\\memory'
    if (vaultHealthCache && Date.now() - vaultHealthCache.ts < CACHE_TTL) {
      return res.json(vaultHealthCache.data)
    }
    try {
      const stats = await computeVaultHealth(VAULT_PATH)
      vaultHealthCache = { data: stats, ts: Date.now() }
      res.json(stats)
    } catch (err) {
      logger.error('vault-health failed:', err)
      res.json({
        score: 0,
        totalNotes: 0,
        brokenLinks: 0,
        staleNotes: 0,
        orphans: 0,
        error: String(err),
        updatedAt: new Date().toISOString(),
      })
    }
  })

  // List recent files by category for Knowledge Growth drill-down
  router.get('/knowledge-files', async (req, res) => {
    const VAULT_PATH =
      process.env.VAULT_PATH ||
      'C:\\Users\\info\\.claude\\projects\\C--Users-info-Desktop-CLAUDE-WORLD\\memory'
    const cat = String(req.query.category || '').toLowerCase()
    const days = Number(req.query.days || 7)
    const since = Date.now() - days * 24 * 3600 * 1000
    try {
      const items: Array<{ path: string; name: string; mtime: string; size: number }> = []
      await walkVault(VAULT_PATH, async (rel, _abs, stat) => {
        if (stat.mtime.getTime() < since) return
        const base = path.basename(rel).toLowerCase()
        let match = false
        if (cat === 'research') match = base.startsWith('research') || rel.startsWith('research/')
        else if (cat === 'feedback') match = base.startsWith('feedback')
        else if (cat === 'project') match = base.startsWith('project')
        else if (cat === 'moc') match = base.startsWith('moc') || base.includes('moc-')
        else if (cat === 'debug') match = base.startsWith('debug')
        else if (cat === 'all' || !cat) match = true
        if (match) {
          items.push({
            path: rel,
            name: path.basename(rel).replace(/\.md$/, ''),
            mtime: stat.mtime.toISOString(),
            size: Number(stat.size),
          })
        }
      })
      items.sort((a, b) => b.mtime.localeCompare(a.mtime))
      res.json({ category: cat || 'all', days, items: items.slice(0, 100) })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/knowledge-growth', async (_req, res) => {
    const VAULT_PATH =
      process.env.VAULT_PATH ||
      'C:\\Users\\info\\.claude\\projects\\C--Users-info-Desktop-CLAUDE-WORLD\\memory'
    if (knowledgeGrowthCache && Date.now() - knowledgeGrowthCache.ts < CACHE_TTL) {
      return res.json(knowledgeGrowthCache.data)
    }
    try {
      const stats = await computeKnowledgeGrowth(VAULT_PATH)
      knowledgeGrowthCache = { data: stats, ts: Date.now() }
      res.json(stats)
    } catch (err) {
      logger.error('knowledge-growth failed:', err)
      res.status(500).json({ error: String(err) })
    }
  })

  return router
}

const IGNORED_DIRS = new Set(['.git', '.obsidian', '.smart-env', 'node_modules', 'backups'])

async function walkVault(
  root: string,
  onFile: (relPath: string, absPath: string, stat: Awaited<ReturnType<typeof fs.stat>>) => Promise<void> | void
): Promise<void> {
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue
      if (e.name.startsWith('.') && dir === root) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        await walk(full)
      } else if (e.name.endsWith('.md')) {
        try {
          const stat = await fs.stat(full)
          await onFile(path.relative(root, full).replace(/\\/g, '/'), full, stat)
        } catch {
          /* skip */
        }
      }
    }
  }
  await walk(root)
}

async function computeVaultHealth(vaultPath: string) {
  const now = Date.now()
  const STALE_MS = 90 * 24 * 60 * 60 * 1000 // 90 days
  const notes = new Map<string, { path: string; abs: string; mtime: Date; content: string; links: string[] }>()
  const referencedFiles = new Set<string>()

  // Load all notes
  await walkVault(vaultPath, async (rel, abs, stat) => {
    try {
      const content = await fs.readFile(abs, 'utf8')
      const links: string[] = []
      const linkRegex = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g
      let m
      while ((m = linkRegex.exec(content)) !== null) {
        links.push(m[1].trim())
      }
      notes.set(rel.toLowerCase().replace(/\.md$/, ''), {
        path: rel,
        abs,
        mtime: stat.mtime,
        content,
        links,
      })
      const basename = path.basename(rel, '.md').toLowerCase()
      notes.set(basename, notes.get(rel.toLowerCase().replace(/\.md$/, ''))!)
    } catch {
      /* skip unreadable */
    }
  })

  const notesArr = Array.from(new Set(notes.values()))
  const totalNotes = notesArr.length

  // Broken links: references to notes that don't exist
  const brokenLinks: { from: string; target: string }[] = []
  for (const n of notesArr) {
    for (const l of n.links) {
      const key = l.toLowerCase().replace(/\.md$/, '')
      if (!notes.has(key) && !notes.has(path.basename(key))) {
        brokenLinks.push({ from: n.path, target: l })
      } else {
        referencedFiles.add(key)
      }
    }
  }

  // Stale notes (>90gg)
  const staleNotes = notesArr.filter((n) => now - n.mtime.getTime() > STALE_MS)

  // Orphans: notes with zero inbound references
  const orphans = notesArr.filter((n) => {
    const basename = path.basename(n.path, '.md').toLowerCase()
    return !referencedFiles.has(basename)
  })

  // Score: weighted average (0-1)
  // Penalties: broken links, stale notes, orphans
  const brokenPenalty = Math.min(1, brokenLinks.length / Math.max(1, totalNotes * 0.2)) * 0.35
  const stalePenalty = Math.min(1, staleNotes.length / Math.max(1, totalNotes * 0.3)) * 0.3
  const orphanPenalty = Math.min(1, orphans.length / Math.max(1, totalNotes * 0.25)) * 0.2
  const score = Math.max(0, 1 - brokenPenalty - stalePenalty - orphanPenalty)

  return {
    score: Math.round(score * 100) / 100,
    totalNotes,
    brokenLinks: brokenLinks.length,
    staleNotes: staleNotes.length,
    orphans: orphans.length,
    samples: {
      brokenLinks: brokenLinks.slice(0, 5),
      staleNotes: staleNotes.slice(0, 5).map((n) => ({ path: n.path, mtime: n.mtime.toISOString() })),
      orphans: orphans.slice(0, 5).map((n) => n.path),
    },
    updatedAt: new Date().toISOString(),
  }
}

async function computeKnowledgeGrowth(vaultPath: string) {
  const now = Date.now()
  const DAYS = [1, 7, 30]
  const buckets: Record<string, { total: number; research: number; feedback: number; project: number; moc: number; debug: number }> = {}
  for (const d of DAYS) {
    buckets[`${d}d`] = { total: 0, research: 0, feedback: 0, project: 0, moc: 0, debug: 0 }
  }

  const byWeek = new Map<string, number>() // week start date → count created this week

  await walkVault(vaultPath, async (rel, _abs, stat) => {
    const ageMs = now - stat.mtime.getTime()
    const ageDays = ageMs / (24 * 60 * 60 * 1000)
    for (const d of DAYS) {
      if (ageDays <= d) {
        const b = buckets[`${d}d`]
        b.total++
        const base = path.basename(rel).toLowerCase()
        if (base.startsWith('research') || rel.startsWith('research/')) b.research++
        else if (base.startsWith('feedback')) b.feedback++
        else if (base.startsWith('project')) b.project++
        else if (base.startsWith('moc') || base.toLowerCase().includes('moc-')) b.moc++
        else if (base.startsWith('debug')) b.debug++
      }
    }
    const weekStart = new Date(stat.mtime)
    weekStart.setHours(0, 0, 0, 0)
    weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const key = weekStart.toISOString().slice(0, 10)
    byWeek.set(key, (byWeek.get(key) || 0) + 1)
  })

  const recentWeeks = Array.from(byWeek.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([week, count]) => ({ week, count }))

  return {
    buckets,
    weeklyTimeline: recentWeeks,
    updatedAt: new Date().toISOString(),
  }
}
