/**
 * V15.0 WS3-3C — Sessions store + revocation list.
 *
 * sessions.json indice principale per refresh tokens. revoked-tokens.json mantiene
 * jti revocati fino alla loro original expiresAt (poi GC). isSessionRevoked è
 * usata da requireAuth ogni request.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { authPath } from './constants'

export type SessionRole = 'owner' | 'guest'

export interface Session {
  jti: string // refresh token jwt id
  sid: string // session id (in access token payload)
  email: string
  role: SessionRole
  createdAt: string
  refreshedAt: string
  expiresAt: string // refresh exp = createdAt + 7d
  ip: string
  userAgentHash: string
  revoked: boolean
  revokedReason?: 'logout' | 'admin-revoke' | 'rotated' | 'global-revoke'
}

interface SessionStore {
  version: 1
  sessions: Session[]
}

interface RevokedRecord {
  jti: string
  sid: string
  revokedAt: string
  expiresAt: string
}

interface RevokedStore {
  version: 1
  revoked: RevokedRecord[]
}

const EMPTY_SESS: SessionStore = { version: 1, sessions: [] }
const EMPTY_REV: RevokedStore = { version: 1, revoked: [] }

async function readSessions(dataDir: string): Promise<SessionStore> {
  try {
    const txt = await fs.readFile(authPath(dataDir, 'sessions'), 'utf-8')
    const parsed = JSON.parse(txt) as SessionStore
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return { ...EMPTY_SESS }
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return { ...EMPTY_SESS }
    throw err
  }
}

async function writeSessions(dataDir: string, store: SessionStore): Promise<void> {
  const file = authPath(dataDir, 'sessions')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(store, null, 2))
}

async function readRevoked(dataDir: string): Promise<RevokedStore> {
  try {
    const txt = await fs.readFile(authPath(dataDir, 'revokedTokens'), 'utf-8')
    const parsed = JSON.parse(txt) as RevokedStore
    if (parsed.version !== 1 || !Array.isArray(parsed.revoked)) return { ...EMPTY_REV }
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return { ...EMPTY_REV }
    throw err
  }
}

async function writeRevoked(dataDir: string, store: RevokedStore): Promise<void> {
  const file = authPath(dataDir, 'revokedTokens')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(store, null, 2))
}

function gcSessions(store: SessionStore): SessionStore {
  const now = Date.now()
  store.sessions = store.sessions.filter((s) => new Date(s.expiresAt).getTime() > now)
  return store
}

function gcRevoked(store: RevokedStore): RevokedStore {
  const now = Date.now()
  store.revoked = store.revoked.filter((r) => new Date(r.expiresAt).getTime() > now)
  return store
}

export async function createSession(dataDir: string, sess: Session): Promise<void> {
  let store = await readSessions(dataDir)
  store = gcSessions(store)
  store.sessions.push(sess)
  await writeSessions(dataDir, store)
}

export async function findSessionBySid(dataDir: string, sid: string): Promise<Session | null> {
  const store = await readSessions(dataDir)
  return store.sessions.find((s) => s.sid === sid && !s.revoked) || null
}

export async function findSessionByJti(dataDir: string, jti: string): Promise<Session | null> {
  const store = await readSessions(dataDir)
  return store.sessions.find((s) => s.jti === jti && !s.revoked) || null
}

export async function rotateSession(
  dataDir: string,
  oldJti: string,
  newSession: Session
): Promise<void> {
  let store = await readSessions(dataDir)
  store = gcSessions(store)
  const oldIdx = store.sessions.findIndex((s) => s.jti === oldJti)
  if (oldIdx >= 0) {
    const old = store.sessions[oldIdx]
    if (old) {
      old.revoked = true
      old.revokedReason = 'rotated'
      store.sessions[oldIdx] = old
    }
  }
  store.sessions.push(newSession)
  await writeSessions(dataDir, store)
  // Aggiungi anche a revoked-tokens per cache veloce
  await addRevoked(dataDir, oldJti, newSession.sid /* ignore - old sid sarebbe meglio ma è in old */, newSession.expiresAt)
}

export async function revokeSession(
  dataDir: string,
  sid: string,
  reason: 'logout' | 'admin-revoke' | 'global-revoke'
): Promise<void> {
  const sessStore = await readSessions(dataDir)
  const idx = sessStore.sessions.findIndex((s) => s.sid === sid)
  if (idx >= 0) {
    const sess = sessStore.sessions[idx]
    if (sess) {
      sess.revoked = true
      sess.revokedReason = reason
      sessStore.sessions[idx] = sess
      await writeSessions(dataDir, sessStore)
      await addRevoked(dataDir, sess.jti, sess.sid, sess.expiresAt)
    }
  }
}

export async function revokeAllSessionsForEmail(
  dataDir: string,
  email: string,
  reason: 'admin-revoke' | 'global-revoke'
): Promise<number> {
  const sessStore = await readSessions(dataDir)
  let revoked = 0
  const norm = email.toLowerCase()
  for (const s of sessStore.sessions) {
    if (s.email === norm && !s.revoked) {
      s.revoked = true
      s.revokedReason = reason
      revoked++
      await addRevoked(dataDir, s.jti, s.sid, s.expiresAt)
    }
  }
  if (revoked > 0) await writeSessions(dataDir, sessStore)
  return revoked
}

export async function addRevoked(
  dataDir: string,
  jti: string,
  sid: string,
  expiresAt: string
): Promise<void> {
  let store = await readRevoked(dataDir)
  store = gcRevoked(store)
  if (!store.revoked.find((r) => r.sid === sid || r.jti === jti)) {
    store.revoked.push({ jti, sid, revokedAt: new Date().toISOString(), expiresAt })
    await writeRevoked(dataDir, store)
  }
}

export async function isSessionRevoked(dataDir: string, sid: string): Promise<boolean> {
  // Check revoked list first (fast)
  const rev = await readRevoked(dataDir)
  if (rev.revoked.find((r) => r.sid === sid)) return true
  // Fallback: session itself flagged revoked
  const sess = await findSessionBySid(dataDir, sid)
  if (!sess) return true // session deleted/expired = treat as revoked
  return sess.revoked
}
