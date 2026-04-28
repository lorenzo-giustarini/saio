/**
 * V15.0 WS3-3D — Audit log JSONL append-only.
 * Una riga = un JSON event. Mai cancellato dal codice (rotation manuale via SSH).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { authPath, AUTH_DIR_NAME } from './constants'
import { logger } from '../logger'

export type AuditEventType =
  | 'claim.requested'
  | 'claim.completed'
  | 'login.requested'
  | 'login.success'
  | 'login.failed'
  | 'totp.enrolled'
  | 'totp.failed'
  | 'totp.recovery_used'
  | 'session.created'
  | 'session.refreshed'
  | 'session.revoked'
  | 'invite.sent'
  | 'invite.revoked'
  | 'ban.added'
  | 'unauthorized.access'

export interface AuditEvent {
  ts: string
  type: AuditEventType
  email?: string
  ip: string
  userAgentHash: string
  meta?: Record<string, unknown>
}

let cachedDataDir: string | null = null

export function setAuditDataDir(dataDir: string): void {
  cachedDataDir = dataDir
}

export async function audit(event: Omit<AuditEvent, 'ts'>): Promise<void> {
  if (!cachedDataDir) {
    logger.warn('[audit] data dir not set — event lost', event.type)
    return
  }
  const full: AuditEvent = { ts: new Date().toISOString(), ...event }
  const file = authPath(cachedDataDir, 'auditLog')
  try {
    // Ensure dir esiste (defensive — datadirs.ts dovrebbe averla creata)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, JSON.stringify(full) + '\n', 'utf-8')
  } catch (err) {
    logger.error('[audit] write failed', err, full)
  }
}

void AUTH_DIR_NAME // keep import side-effect-free
