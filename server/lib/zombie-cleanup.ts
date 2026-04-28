/**
 * Zombie Brief Cleanup (V13.1-T9)
 *
 * Archivia automaticamente brief in-session vecchi (obsoleti, non risposti).
 * Chiamato da:
 *  - Cron weekly (default 7 giorni)
 *  - Bottone UI "Pulisci zombi" (parametro `olderThanDays` configurabile)
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'

const ONE_DAY_MS = 24 * 60 * 60_000

export interface CleanupResult {
  scanned: number
  archived: number
  briefIds: string[]
  errors: string[]
}

/**
 * Scan data/briefs/ for in-session briefs older than N days.
 * Move matching to data/archive/briefs/ + write resolution sidecar with resolvedVia='expired'.
 */
export async function cleanupZombieBriefs(
  dataDir: string,
  olderThanDays: number
): Promise<CleanupResult> {
  const result: CleanupResult = { scanned: 0, archived: 0, briefIds: [], errors: [] }
  const briefsDir = path.join(dataDir, 'briefs')
  const archiveDir = path.join(dataDir, 'archive', 'briefs')

  if (!fs.existsSync(briefsDir)) {
    return result
  }

  await fsp.mkdir(archiveDir, { recursive: true })

  const cutoffMs = Date.now() - Math.max(0, olderThanDays) * ONE_DAY_MS

  let files: string[]
  try {
    files = await fsp.readdir(briefsDir)
  } catch (err: any) {
    result.errors.push(`readdir failed: ${err.message}`)
    return result
  }

  for (const f of files) {
    if (!f.endsWith('.json')) continue
    result.scanned++
    const full = path.join(briefsDir, f)
    try {
      const raw = await fsp.readFile(full, 'utf8')
      const brief = JSON.parse(raw)
      // Only in-session brief candidates
      if (brief?.source !== 'in-session') continue
      // Check age
      const createdAtMs = brief.createdAt ? new Date(brief.createdAt).getTime() : 0
      if (!createdAtMs || createdAtMs > cutoffMs) continue

      // Archive: move + sidecar
      const briefId = brief.id || f.replace(/\.json$/, '')
      const archivedPath = path.join(archiveDir, `${briefId}.json`)
      const sidecarPath = path.join(archiveDir, `${briefId}.resolution.json`)

      await fsp.rename(full, archivedPath)
      await fsp.writeFile(
        sidecarPath,
        JSON.stringify(
          {
            briefId,
            resolvedAt: new Date().toISOString(),
            resolvedVia: 'expired',
            resolution: `Auto-expired: brief > ${olderThanDays} giorni senza risposta`,
            resolvedBy: 'system',
          },
          null,
          2
        )
      )
      result.archived++
      result.briefIds.push(briefId)
    } catch (err: any) {
      result.errors.push(`${f}: ${err.message}`)
    }
  }

  if (result.archived > 0) {
    logger.info(
      `[zombie-cleanup] archived ${result.archived}/${result.scanned} brief in-session > ${olderThanDays}gg`
    )
  }
  return result
}
