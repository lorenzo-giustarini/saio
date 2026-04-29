import { getVpsHosts, type VpsHost } from './ssh-inventory'
import { logger } from './logger'

/**
 * V14.28 — multi-VPS iterator. Esegue `fn` su ogni VPS del registry, gestendo
 * errori per-server senza far crashare l'intero batch. Usato dai cron T4
 * (VPS-Pull, VPS-Errors, ecc) per non hardcodare gli IP nei singoli script.
 */

export interface VpsIterResult<T> {
  vpsId: string
  label: string
  ip: string
  result?: T
  error?: string
  durationMs: number
}

export interface VpsIterOptions {
  concurrency?: number // max parallel ops, default 3
  timeoutMsPerVps?: number // hard timeout per-VPS (default 60s)
  filter?: (vps: VpsHost) => boolean // skip alcune VPS
}

async function runWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer!)
  }
}

export async function forEachVps<T>(
  fn: (vps: VpsHost) => Promise<T>,
  options: VpsIterOptions = {}
): Promise<VpsIterResult<T>[]> {
  const concurrency = options.concurrency ?? 3
  const timeoutMs = options.timeoutMsPerVps ?? 60_000
  const allHosts = getVpsHosts()
  const hosts = options.filter ? allHosts.filter(options.filter) : allHosts

  if (hosts.length === 0) {
    logger.info('[vps-iter] no VPS in registry')
    return []
  }

  const results: VpsIterResult<T>[] = []
  let cursor = 0

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++
      if (idx >= hosts.length) return
      const vps = hosts[idx]
      const start = Date.now()
      try {
        const result = await runWithTimeout(fn(vps), timeoutMs)
        results.push({
          vpsId: vps.id,
          label: vps.label,
          ip: vps.ip,
          result,
          durationMs: Date.now() - start,
        })
      } catch (err: any) {
        const msg = err?.message || String(err)
        logger.warn(`[vps-iter] ${vps.id} failed: ${msg}`)
        results.push({
          vpsId: vps.id,
          label: vps.label,
          ip: vps.ip,
          error: msg,
          durationMs: Date.now() - start,
        })
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, hosts.length) }, () => worker())
  await Promise.all(workers)

  // Riordina per id (cursor-based parallelism può ritornare fuori ordine)
  return results.sort((a, b) => a.vpsId.localeCompare(b.vpsId))
}

/**
 * Helper: VPS online (skip se ultimo probe ha failed). Use case: cron VPS-Pull
 * che non vuole bloccarsi su server unreachable per giorni.
 */
export async function forEachOnlineVps<T>(
  fn: (vps: VpsHost) => Promise<T>,
  options: Omit<VpsIterOptions, 'filter'> = {}
): Promise<VpsIterResult<T>[]> {
  // Per ora non abbiamo "last online state" persistente cheap → in futuro
  // si può leggere da vps-state-store. Per ora alias di forEachVps.
  return forEachVps(fn, options)
}
