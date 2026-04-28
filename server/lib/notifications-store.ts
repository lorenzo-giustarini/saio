import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from './logger'

/**
 * V14.28 Step 3 — Notifications store per fix in attesa di approvazione utente.
 * Salva in `data/notifications/auto-fix-pending.json` (array). UI Cron legge
 * via GET /api/cron/notifications, l'utente approva/dismiss via POST.
 *
 * Notification expirano dopo 7gg → archiviate in `data/audit/notifications-archive-YYYYMM.jsonl`.
 */

export type NotificationStatus = 'pending' | 'approved' | 'dismissed' | 'executed' | 'failed'

export interface AutoFixNotification {
  id: string
  createdAt: string
  type: 'auto-fix-pending'
  vpsId: string
  errorPattern: string
  errorSamples: string[]
  occurrenceCount: number
  knownFix: {
    slug: string
    autoFix: 'SAFE' | 'REQUIRES-APPROVAL' | 'MANUAL'
    fixScript?: string
    description?: string
    hint?: string
  } | null
  status: NotificationStatus
  expiresAt: string
  resolvedAt?: string
  resolutionNote?: string
}

const NOTIF_FILE = path.join(process.cwd(), 'data', 'notifications', 'auto-fix-pending.json')
const ARCHIVE_DIR = path.join(process.cwd(), 'data', 'audit')
const EXPIRY_DAYS = 7

async function readAll(): Promise<AutoFixNotification[]> {
  try {
    const raw = await fs.readFile(NOTIF_FILE, 'utf-8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch (err: any) {
    if (err.code === 'ENOENT') return []
    logger.warn(`notifications read failed: ${err.message}`)
    return []
  }
}

async function writeAll(arr: AutoFixNotification[]): Promise<void> {
  await fs.mkdir(path.dirname(NOTIF_FILE), { recursive: true })
  const tmp = `${NOTIF_FILE}.tmp`
  await fs.writeFile(tmp, JSON.stringify(arr, null, 2), 'utf-8')
  await fs.rename(tmp, NOTIF_FILE)
}

export async function listNotifications(filter?: { status?: NotificationStatus }): Promise<AutoFixNotification[]> {
  const all = await readAll()
  if (filter?.status) return all.filter((n) => n.status === filter.status)
  return all
}

export async function createNotification(input: Omit<AutoFixNotification, 'id' | 'createdAt' | 'status' | 'expiresAt'>): Promise<AutoFixNotification> {
  const now = new Date()
  const notif: AutoFixNotification = {
    ...input,
    id: `notif-${randomUUID()}`,
    createdAt: now.toISOString(),
    status: 'pending',
    expiresAt: new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  }
  // Sanitize samples: rimuove possibili token/password
  notif.errorSamples = notif.errorSamples.map(sanitizeLine)
  const all = await readAll()
  all.push(notif)
  await writeAll(all)
  return notif
}

export async function updateNotification(id: string, patch: Partial<AutoFixNotification>): Promise<AutoFixNotification | null> {
  const all = await readAll()
  const idx = all.findIndex((n) => n.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...patch }
  await writeAll(all)
  return all[idx]
}

export async function getNotification(id: string): Promise<AutoFixNotification | null> {
  const all = await readAll()
  return all.find((n) => n.id === id) || null
}

/**
 * Archive expired notifications + risolte da >24h.
 * Chiamato opportunisticamente all'avvio o da cron daily.
 */
export async function archiveStale(): Promise<number> {
  const all = await readAll()
  const now = Date.now()
  const cutoffResolved = now - 24 * 60 * 60 * 1000
  const toArchive = all.filter((n) => {
    const expired = new Date(n.expiresAt).getTime() < now
    const oldResolved = n.status !== 'pending' && n.resolvedAt && new Date(n.resolvedAt).getTime() < cutoffResolved
    return expired || oldResolved
  })
  if (toArchive.length === 0) return 0

  // Append to archive jsonl
  const ym = new Date().toISOString().slice(0, 7).replace('-', '')
  const archiveFile = path.join(ARCHIVE_DIR, `notifications-archive-${ym}.jsonl`)
  await fs.mkdir(ARCHIVE_DIR, { recursive: true })
  const archiveContent = toArchive.map((n) => JSON.stringify(n)).join('\n') + '\n'
  await fs.appendFile(archiveFile, archiveContent, 'utf-8')

  // Remove from pending file
  const remaining = all.filter((n) => !toArchive.includes(n))
  await writeAll(remaining)

  logger.info(`notifications: archived ${toArchive.length} stale entries`)
  return toArchive.length
}

/**
 * Sanitize log line per rimuovere possibili secrets prima di salvarla in
 * notification (la UI la mostra).
 */
function sanitizeLine(line: string): string {
  return line
    .replace(/(api[_-]?key|token|password|secret)[\s:='"]+\S+/gi, '$1=<REDACTED>')
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1<REDACTED>')
    .replace(/(authorization:\s*)\S+/gi, '$1<REDACTED>')
    .slice(0, 500)
}
