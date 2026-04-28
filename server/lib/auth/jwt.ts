/**
 * V15.0 WS3 — JWT helper.
 * Starter version per 3G (signShortJwt, verifyShortJwt usato per saio_pending cookie).
 * Espanso in 3C con session pair (saio_at + saio_rt) e revocation lookup.
 */
import jwt from 'jsonwebtoken'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { atomicWriteFile } from '../atomic-write'
import { authPath } from './constants'
import { logger } from '../logger'

let cachedSecret: string | null = null

export async function getJwtSecret(dataDir: string): Promise<string> {
  if (cachedSecret) return cachedSecret
  const envSecret = (process.env.DASHBOARD_AUTH_JWT_SECRET || '').trim()
  if (envSecret.length >= 32) {
    cachedSecret = envSecret
    return cachedSecret
  }
  const file = authPath(dataDir, 'jwtSecret')
  try {
    const txt = (await fs.readFile(file, 'utf-8')).trim()
    if (txt.length >= 32) {
      cachedSecret = txt
      return cachedSecret
    }
  } catch {
    /* missing → generate */
  }
  const newSecret = crypto.randomBytes(32).toString('hex')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, newSecret)
  // Best-effort permissions tightening on POSIX
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(file, 0o600)
    } catch {
      /* ignore */
    }
  }
  logger.warn('[auth] DASHBOARD_AUTH_JWT_SECRET unset — generated and saved to data/auth/.jwt-secret')
  cachedSecret = newSecret
  return cachedSecret
}

/**
 * Signed short-lived JWT (per saio_pending cookie tra magic-link verify e TOTP).
 * NON è la session principale (che è saio_at/saio_rt).
 */
export interface PendingPayload {
  sub: string // email
  role: 'owner' | 'guest'
  purpose: 'totp-pending'
}

export async function signPending(dataDir: string, payload: PendingPayload, ttlSec: number): Promise<string> {
  const secret = await getJwtSecret(dataDir)
  return jwt.sign(payload, secret, { expiresIn: ttlSec })
}

export async function verifyPending(dataDir: string, token: string): Promise<PendingPayload | null> {
  const secret = await getJwtSecret(dataDir)
  try {
    const decoded = jwt.verify(token, secret) as PendingPayload & { iat: number; exp: number }
    if (decoded.purpose !== 'totp-pending') return null
    return { sub: decoded.sub, role: decoded.role, purpose: decoded.purpose }
  } catch {
    return null
  }
}

// ─────────────────── 3C — Session JWT pair ───────────────────

export interface AccessPayload {
  sub: string // email
  role: 'owner' | 'guest'
  sid: string // session id
  type: 'access'
  iat?: number
  exp?: number
}

export interface RefreshPayload {
  sub: string
  role: 'owner' | 'guest'
  sid: string
  jti: string
  type: 'refresh'
  iat?: number
  exp?: number
}

export interface TokenPair {
  access: string
  refresh: string
  sid: string
  jti: string
  refreshExpiresAt: string
}

export async function signTokenPair(
  dataDir: string,
  email: string,
  role: 'owner' | 'guest'
): Promise<TokenPair> {
  const secret = await getJwtSecret(dataDir)
  const sid = crypto.randomUUID()
  const jti = crypto.randomUUID()
  const access = jwt.sign({ sub: email, role, sid, type: 'access' }, secret, { expiresIn: '1h' })
  // jti già nel payload — non duplicare con `jwtid` option (causa errore "payload already has jti")
  const refresh = jwt.sign({ sub: email, role, sid, jti, type: 'refresh' }, secret, {
    expiresIn: '7d',
  })
  // Compute refresh expiry approx
  const refreshDecoded = jwt.decode(refresh) as { exp: number } | null
  const refreshExpiresAt = refreshDecoded?.exp
    ? new Date(refreshDecoded.exp * 1000).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60_000).toISOString()
  return { access, refresh, sid, jti, refreshExpiresAt }
}

export async function verifyAccess(dataDir: string, token: string): Promise<AccessPayload | null> {
  const secret = await getJwtSecret(dataDir)
  try {
    const decoded = jwt.verify(token, secret) as AccessPayload
    if (decoded.type !== 'access') return null
    return decoded
  } catch {
    return null
  }
}

export async function verifyRefresh(dataDir: string, token: string): Promise<RefreshPayload | null> {
  const secret = await getJwtSecret(dataDir)
  try {
    const decoded = jwt.verify(token, secret) as RefreshPayload
    if (decoded.type !== 'refresh') return null
    return decoded
  } catch {
    return null
  }
}

// ─────────────────── WS6 — Trusted device JWT ───────────────────

export interface TrustedPayload {
  sub: string
  role: 'owner' | 'guest'
  sid: string
  jti: string
  type: 'trusted'
  iat?: number
  exp?: number
}

export async function signTrusted(
  dataDir: string,
  sub: string,
  role: 'owner' | 'guest',
  sid: string,
  jti: string,
  ttlDays: number
): Promise<string> {
  const secret = await getJwtSecret(dataDir)
  return jwt.sign({ sub, role, sid, jti, type: 'trusted' }, secret, {
    expiresIn: `${ttlDays}d`,
  })
}

export async function verifyTrusted(dataDir: string, token: string): Promise<TrustedPayload | null> {
  const secret = await getJwtSecret(dataDir)
  try {
    const decoded = jwt.verify(token, secret) as TrustedPayload
    if (decoded.type !== 'trusted') return null
    return decoded
  } catch {
    return null
  }
}
