/**
 * V15.0 WS3 — Auth constants centralizzate
 * Path, TTL, cookie names. Tutto modificabile via env var.
 */
import path from 'node:path'

export const AUTH_DIR_NAME = 'auth' // sotto data/

// File names (relativi a data/auth/)
export const AUTH_FILES = {
  ownerJson: 'owner.json',
  allowedEmails: 'allowed-emails.json',
  claimState: 'claim-state.json',
  claimTokenTxt: 'CLAIM-TOKEN.txt',
  pendingMagicLinks: 'pending-magic-links.json',
  totpSecrets: 'totp-secrets.json',
  recoveryCodes: 'recovery-codes.json',
  sessions: 'sessions.json',
  revokedTokens: 'revoked-tokens.json',
  bannedIps: 'banned-ips.json',
  auditLog: 'audit.log',
  jwtSecret: '.jwt-secret',
} as const

export function authPath(dataDir: string, file: keyof typeof AUTH_FILES): string {
  return path.join(dataDir, AUTH_DIR_NAME, AUTH_FILES[file])
}

// TTLs
// V15.0 WS9 — Claim TTL default 24h (1440 min). Era 5 min, troppo stretto per
// chi clona oggi e completa setup domani. Override sempre via env var.
export const CLAIM_TTL_MIN = Number(process.env.DASHBOARD_AUTH_CLAIM_TTL_MIN || 1440)
export const MAGIC_LINK_TTL_MIN = 15
export const MAGIC_LINK_INVITE_TTL_MIN = 24 * 60 // primo invito: 24h per dare tempo di leggere email
export const SAIO_PENDING_COOKIE_TTL_MIN = 5 // half-auth dopo magic-link, prima TOTP
export const ACCESS_TOKEN_TTL = '1h'
export const REFRESH_TOKEN_TTL = '7d'
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

// Cookies
export const COOKIE_ACCESS = 'saio_at'
export const COOKIE_REFRESH = 'saio_rt'
export const COOKIE_PENDING = 'saio_pending'
export const COOKIE_TRUSTED = 'saio_trusted'

// V15.0 WS6 — Trusted device TTL options (giorni). Niente permanent, max 30.
export const TRUSTED_TTL_OPTIONS = [1, 3, 7, 15, 30] as const
export type TrustedTtlDays = (typeof TRUSTED_TTL_OPTIONS)[number]

// Brute-force ban
export const BAN_FAIL_THRESHOLD = 5
export const BAN_DURATION_MIN = 30
export const BAN_COUNTER_WINDOW_MIN = 30

// Master switch (false = bypass totale auth, solo dev)
export function isAuthRequired(): boolean {
  return process.env.DASHBOARD_AUTH_REQUIRED !== 'false'
}

export function isDebugMagicLink(): boolean {
  return process.env.DASHBOARD_AUTH_DEBUG_MAGIC_LINK === 'true'
}

export function trustCloudflare(): boolean {
  return process.env.DASHBOARD_AUTH_TRUST_CLOUDFLARE !== 'false' // default true
}
