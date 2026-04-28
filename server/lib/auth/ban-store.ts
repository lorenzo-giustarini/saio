/**
 * V15.0 WS3-3D — Banned IPs hard-banlist.
 * Hand-editable file. Letto su ogni request auth (no caching, fail-open in caso di errore).
 * Brute-force counter in memoria + persistenza su threshold.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { authPath } from './constants'
import { audit } from './audit'

export interface BannedIp {
  ip: string
  bannedAt: string
  expiresAt: string | null // null = permanent
  reason: 'brute-force' | 'manual'
  failCount: number
}

export interface BanStore {
  version: 1
  bans: BannedIp[]
}

let cachedDataDir: string | null = null
const failCounters = new Map<string, { count: number; firstAt: number }>() // ip -> {count, ts}

export function setBanStoreDataDir(dataDir: string): void {
  cachedDataDir = dataDir
}

async function readStore(): Promise<BanStore> {
  if (!cachedDataDir) return { version: 1, bans: [] }
  const file = authPath(cachedDataDir, 'bannedIps')
  try {
    const txt = await fs.readFile(file, 'utf-8')
    const parsed = JSON.parse(txt) as BanStore
    if (parsed.version !== 1 || !Array.isArray(parsed.bans)) {
      return { version: 1, bans: [] }
    }
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { version: 1, bans: [] }
    }
    return { version: 1, bans: [] }
  }
}

async function writeStore(store: BanStore): Promise<void> {
  if (!cachedDataDir) return
  const file = authPath(cachedDataDir, 'bannedIps')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(store, null, 2))
}

/** Returns true se l'IP è bannato e il ban è ancora attivo. */
export async function isIpBanned(ip: string): Promise<boolean> {
  const store = await readStore()
  const now = Date.now()
  const ban = store.bans.find((b) => b.ip === ip)
  if (!ban) return false
  if (ban.expiresAt === null) return true // permanent
  if (new Date(ban.expiresAt).getTime() > now) return true
  return false // expired, but kept for audit
}

/**
 * Increment fail counter per IP. Se supera threshold dentro window → ban N min.
 * Counter è in-memory; ban diventa persistente.
 */
export async function recordAuthFailure(
  ip: string,
  threshold: number,
  windowMinutes: number,
  banDurationMinutes: number
): Promise<{ banned: boolean }> {
  const now = Date.now()
  const windowMs = windowMinutes * 60_000
  const c = failCounters.get(ip)
  if (!c || now - c.firstAt > windowMs) {
    failCounters.set(ip, { count: 1, firstAt: now })
    return { banned: false }
  }
  c.count += 1
  failCounters.set(ip, c)
  if (c.count >= threshold) {
    const store = await readStore()
    const existing = store.bans.findIndex((b) => b.ip === ip)
    const expiresAt = new Date(now + banDurationMinutes * 60_000).toISOString()
    const ban: BannedIp = {
      ip,
      bannedAt: new Date().toISOString(),
      expiresAt,
      reason: 'brute-force',
      failCount: c.count,
    }
    if (existing >= 0) store.bans[existing] = ban
    else store.bans.push(ban)
    await writeStore(store)
    failCounters.delete(ip) // reset counter dopo ban
    await audit({ type: 'ban.added', ip, userAgentHash: '', meta: { reason: 'brute-force', minutes: banDurationMinutes } })
    return { banned: true }
  }
  return { banned: false }
}

/** Reset counter per IP (chiamato su login success). */
export function resetAuthFailures(ip: string): void {
  failCounters.delete(ip)
}
