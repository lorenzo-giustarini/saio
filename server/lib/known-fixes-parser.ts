import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'

/**
 * V14.28 Step 2 — Parser markdown known-fixes.md → array di Pattern compilati.
 * Cache 60s (i fix non cambiano spesso e ricompilare regex è non gratis).
 */

export type AutoFixType = 'SAFE' | 'REQUIRES-APPROVAL' | 'MANUAL'
export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface KnownPattern {
  slug: string
  pattern: RegExp
  patternRaw: string
  severity: Severity
  autoFix: AutoFixType
  fixScript?: string
  description?: string
  hint?: string
  resolutionCount?: number
  successRate?: number
}

const KNOWN_FIXES_FILE = path.join(process.cwd(), 'data', 'errors', 'known-fixes.md')
let cache: { patterns: KnownPattern[]; mtime: number } | null = null
const CACHE_TTL_MS = 60_000

function parseRegexLiteral(input: string): RegExp | null {
  // input formato: `/regex/flags` (con backtick rimossi)
  const trimmed = input.trim().replace(/^`|`$/g, '')
  const match = trimmed.match(/^\/(.*)\/([gimsuy]*)$/)
  if (!match) return null
  try {
    return new RegExp(match[1], match[2])
  } catch {
    return null
  }
}

function parsePatternBlock(slug: string, body: string): KnownPattern | null {
  const lines = body.split(/\r?\n/)
  const meta: Record<string, string> = {}
  for (const ln of lines) {
    const m = ln.match(/^\s*-\s*(\w+):\s*(.+)$/)
    if (m) meta[m[1]] = m[2].trim()
  }
  if (!meta.pattern) {
    logger.warn(`known-fixes: pattern "${slug}" missing 'pattern:' field, skipping`)
    return null
  }
  const re = parseRegexLiteral(meta.pattern)
  if (!re) {
    logger.warn(`known-fixes: pattern "${slug}" has invalid regex literal: ${meta.pattern}`)
    return null
  }
  const severity = (meta.severity as Severity) || 'medium'
  const autoFix = (meta.autoFix as AutoFixType) || 'MANUAL'
  if (!['low', 'medium', 'high', 'critical'].includes(severity)) {
    logger.warn(`known-fixes: pattern "${slug}" invalid severity: ${severity}`)
    return null
  }
  if (!['SAFE', 'REQUIRES-APPROVAL', 'MANUAL'].includes(autoFix)) {
    logger.warn(`known-fixes: pattern "${slug}" invalid autoFix: ${autoFix}`)
    return null
  }
  return {
    slug,
    pattern: re,
    patternRaw: meta.pattern,
    severity,
    autoFix,
    fixScript: meta.fixScript || undefined,
    description: meta.description || undefined,
    hint: meta.hint || undefined,
    resolutionCount: meta.resolutionCount ? parseInt(meta.resolutionCount, 10) : 0,
    successRate: meta.successRate ? parseInt(meta.successRate, 10) : undefined,
  }
}

export async function loadKnownPatterns(): Promise<KnownPattern[]> {
  try {
    const stat = await fs.stat(KNOWN_FIXES_FILE)
    if (cache && cache.mtime === stat.mtimeMs && Date.now() - cache.mtime < CACHE_TTL_MS) {
      return cache.patterns
    }
    const raw = await fs.readFile(KNOWN_FIXES_FILE, 'utf-8')

    // Split per H2 (## )
    const blocks = raw.split(/^##\s+/m).slice(1) // skip frontmatter
    const patterns: KnownPattern[] = []
    for (const block of blocks) {
      const firstLineEnd = block.indexOf('\n')
      if (firstLineEnd < 0) continue
      const slug = block.slice(0, firstLineEnd).trim()
      const body = block.slice(firstLineEnd + 1)
      const pat = parsePatternBlock(slug, body)
      if (pat) patterns.push(pat)
    }

    cache = { patterns, mtime: stat.mtimeMs }
    logger.info(`known-fixes: loaded ${patterns.length} patterns`)
    return patterns
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      logger.warn('known-fixes: file not found, returning empty list')
      return []
    }
    logger.error(`known-fixes: load failed: ${err.message}`)
    return []
  }
}

/**
 * Match singola error line contro tutti i known patterns. Ritorna il primo
 * match (gli altri sono ignorati, l'ordine in known-fixes.md è significativo).
 */
export async function matchKnownPattern(errorLine: string): Promise<KnownPattern | null> {
  const patterns = await loadKnownPatterns()
  for (const p of patterns) {
    if (p.pattern.test(errorLine)) return p
  }
  return null
}

export function invalidateKnownFixesCache(): void {
  cache = null
}
