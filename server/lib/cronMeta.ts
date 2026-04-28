import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'

/**
 * V14.27 — Sidecar JSON store per metadata cron (long-form details, schedule
 * leggibile, timestamps). Il Comment field nativo di schtasks ospita la
 * description short; questo store è per il resto.
 *
 * Layout:
 * {
 *   "Obsidian-Daily-Cockpit": {
 *     "details": "...",
 *     "schedule": "Daily 07:30",
 *     "createdAt": "2026-04-26T...",
 *     "lastEditAt": "2026-04-26T..."
 *   }
 * }
 */

export interface CronMeta {
  details?: string
  schedule?: string
  createdAt?: string
  lastEditAt?: string
  /**
   * V14.28 — toggle auto-fix per cron error-handling.
   * - undefined/null: cron non capable di auto-fix (default per cron generici)
   * - false: capable, attualmente OFF → propone fix in dashboard, non applica
   * - true: capable, attualmente ON → applica fix marcati 'safe' in known-fixes.md
   */
  autoFix?: boolean | null
  /**
   * V14.28 — flag che indica se questo cron è capable di error-handling
   * (lavora con `error-pipeline.ts`). Solo questi mostrano il Switch UI.
   */
  errorHandlingCapable?: boolean
}

const META_FILE = path.join(process.cwd(), 'data', 'cron-meta.json')

let cache: { data: Record<string, CronMeta>; mtime: number } | null = null
const CACHE_TTL_MS = 5_000

async function readAll(): Promise<Record<string, CronMeta>> {
  try {
    const stat = await fs.stat(META_FILE)
    const mtime = stat.mtimeMs
    if (cache && cache.mtime === mtime && Date.now() - mtime < CACHE_TTL_MS) {
      return cache.data
    }
    const raw = await fs.readFile(META_FILE, 'utf-8')
    const data = JSON.parse(raw) as Record<string, CronMeta>
    cache = { data, mtime }
    return data
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      cache = { data: {}, mtime: 0 }
      return {}
    }
    logger.warn(`cronMeta read failed: ${err.message}`)
    return {}
  }
}

async function writeAll(data: Record<string, CronMeta>): Promise<void> {
  await fs.mkdir(path.dirname(META_FILE), { recursive: true })
  const tmp = `${META_FILE}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmp, META_FILE)
  cache = null
}

export async function getCronMeta(name: string): Promise<CronMeta | null> {
  const all = await readAll()
  return all[name] || null
}

export async function getAllCronMeta(): Promise<Record<string, CronMeta>> {
  return readAll()
}

export async function setCronMeta(name: string, patch: Partial<CronMeta>): Promise<void> {
  const all = await readAll()
  const now = new Date().toISOString()
  const existing = all[name] || { createdAt: now }
  all[name] = { ...existing, ...patch, lastEditAt: now }
  await writeAll(all)
}

export async function deleteCronMeta(name: string): Promise<void> {
  const all = await readAll()
  if (all[name]) {
    delete all[name]
    await writeAll(all)
  }
}

export async function renameCronMeta(oldName: string, newName: string): Promise<void> {
  const all = await readAll()
  if (all[oldName]) {
    all[newName] = { ...all[oldName], lastEditAt: new Date().toISOString() }
    delete all[oldName]
    await writeAll(all)
  }
}
