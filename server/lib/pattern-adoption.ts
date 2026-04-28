import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'

/**
 * V14.28 Step 5 — Pattern Adoption Tracker.
 * Daily cron 02:30 scansiona <vault>/recipes/atomic/*.md ed estrae per ogni
 * recipe lo "snippet identificativo" del working solution. Cerca nei jsonl
 * di Claude Code ultime 24h se quel snippet appare → match = adopted.
 *
 * Output: <vault>/metrics/pattern-adoption.md (rebuild totale ogni run).
 */

const VAULT_RECIPES_ATOMIC = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'memory',
  'recipes',
  'atomic',
)
const VAULT_METRICS = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'memory',
  'metrics',
)
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const CLAUDE_PROJECT_DIRS = [
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'C--Users-info-Desktop-CLAUDE-WORLD-AgencyOS',
  'C--Users-info-Desktop-GSD-AGENCY',
]

interface Recipe {
  slug: string
  title: string
  filePath: string
  discoveredAt: string
  workingSnippet: string // primo blocco code estratto, signature stabile
  workingHash: string
}

interface AdoptionMetric {
  recipeSlug: string
  recipeTitle: string
  matches: number
  firstAdoptionAt?: string
  lastAdoptionAt?: string
  status: 'adopted' | 'pending' | 'rejected'
}

function extractWorkingSnippet(content: string): string {
  // Cerca primo code block dentro la sezione "Soluzione che funziona" o simili
  const m = content.match(/##\s+(soluzione|working|correct).*?\n([\s\S]*?)(?:\n##|$)/i)
  const section = m?.[2] || content
  const code = section.match(/```[\w]*\n([\s\S]*?)```/)
  if (code) {
    // Normalize: rimuove whitespace edge, limit 200 char per signature
    return code[1].trim().slice(0, 200)
  }
  return ''
}

async function loadRecipes(): Promise<Recipe[]> {
  try {
    const files = await fs.readdir(VAULT_RECIPES_ATOMIC)
    const recipes: Recipe[] = []
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      const fp = path.join(VAULT_RECIPES_ATOMIC, f)
      try {
        const content = await fs.readFile(fp, 'utf-8')
        const slug = f.replace(/\.md$/, '')
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1].trim() : slug
        const dateMatch = content.match(/discovered_at:\s*([\d-]+)/)
        const discoveredAt = dateMatch ? dateMatch[1] : ''
        const workingSnippet = extractWorkingSnippet(content)
        if (!workingSnippet) continue // skip recipes senza code block
        // Hash semplice per signature (stabile per dedupe)
        const workingHash = simpleHash(workingSnippet)
        recipes.push({ slug, title, filePath: fp, discoveredAt, workingSnippet, workingHash })
      } catch (err: any) {
        logger.warn(`[pattern-adoption] read ${f}: ${err.message}`)
      }
    }
    return recipes
  } catch (err: any) {
    if (err.code === 'ENOENT') return []
    logger.error(`[pattern-adoption] load recipes failed: ${err.message}`)
    return []
  }
}

function simpleHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h) + input.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h).toString(36)
}

async function scanJsonlForSnippet(snippet: string, sinceTs: number): Promise<{ matches: number; firstTs?: string; lastTs?: string }> {
  // Match grezzo: snippet.includes(line) usando substring di 80 char (signature stabile)
  const sig = snippet.slice(0, 80).trim()
  if (sig.length < 20) return { matches: 0 }

  let matches = 0
  let firstTs: string | undefined
  let lastTs: string | undefined

  for (const projDir of CLAUDE_PROJECT_DIRS) {
    const dir = path.join(CLAUDE_PROJECTS, projDir)
    let files: string[] = []
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const fp = path.join(dir, f)
      try {
        const stat = await fs.stat(fp)
        if (stat.mtimeMs < sinceTs) continue
      } catch {
        continue
      }
      try {
        const content = await fs.readFile(fp, 'utf-8')
        if (content.includes(sig)) {
          matches += 1
          // Estrai ts dal primo evento file (semplificato)
          const firstLine = content.split('\n', 1)[0]
          try {
            const ev = JSON.parse(firstLine)
            const ts = ev.timestamp
            if (ts && (!firstTs || ts < firstTs)) firstTs = ts
            if (ts && (!lastTs || ts > lastTs)) lastTs = ts
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
  }
  return { matches, firstTs, lastTs }
}

export async function runPatternAdoption(): Promise<AdoptionMetric[]> {
  const recipes = await loadRecipes()
  if (recipes.length === 0) {
    logger.info('[pattern-adoption] no atomic recipes found, skipping')
    return []
  }

  // Search nei jsonl ultimi 30 giorni
  const sinceTs = Date.now() - 30 * 24 * 60 * 60 * 1000

  const metrics: AdoptionMetric[] = []
  for (const r of recipes) {
    const { matches, firstTs, lastTs } = await scanJsonlForSnippet(r.workingSnippet, sinceTs)
    metrics.push({
      recipeSlug: r.slug,
      recipeTitle: r.title,
      matches,
      firstAdoptionAt: firstTs,
      lastAdoptionAt: lastTs,
      status: matches >= 2 ? 'adopted' : matches === 1 ? 'pending' : 'pending',
    })
  }

  // Write summary
  await fs.mkdir(VAULT_METRICS, { recursive: true })
  const ym = new Date().toISOString().slice(0, 7)
  const file = path.join(VAULT_METRICS, `pattern-adoption-${ym}.md`)
  const lines: string[] = [
    `# Pattern Adoption — ${ym}`,
    '',
    `> Last run: ${new Date().toISOString()}`,
    `> Recipes scansionate: ${recipes.length}`,
    `> Adopted: ${metrics.filter((m) => m.status === 'adopted').length}`,
    '',
    '## Adopted (matches >= 2)',
    '',
  ]
  for (const m of metrics.filter((x) => x.status === 'adopted')) {
    lines.push(`- **${m.recipeTitle}** · ${m.matches} match · last seen ${m.lastAdoptionAt || '?'}`)
  }
  lines.push('', '## Pending (1 match) o Mai adottate', '')
  for (const m of metrics.filter((x) => x.status !== 'adopted')) {
    lines.push(`- ${m.recipeTitle} · ${m.matches} match`)
  }
  await fs.writeFile(file, lines.join('\n'), 'utf-8')
  logger.info(`[pattern-adoption] written ${file} with ${metrics.length} metrics`)
  return metrics
}
