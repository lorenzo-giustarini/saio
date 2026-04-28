/**
 * V15.0 WS3-3D — Rate limiting per endpoint auth + brute-force ban.
 *
 * Strategia:
 *  - Banned IPs hard-banlist (file) → 403 prima di tutto, priorità max
 *  - express-rate-limit per endpoint con limiti differenziati
 *  - Su ripetuti rate-limit hit (es. /totp/verify) → registra failure → eventuale ban
 */
import type { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { getClientIp } from '../lib/auth/ip-trust'
import { isIpBanned, recordAuthFailure } from '../lib/auth/ban-store'
import { BAN_FAIL_THRESHOLD, BAN_DURATION_MIN, BAN_COUNTER_WINDOW_MIN } from '../lib/auth/constants'

const keyByIp = (req: Request) => getClientIp(req)

/**
 * Hard-banlist check: prima di tutto, se IP è in banned-ips.json → 403.
 * Hand-editable file, no restart richiesto.
 */
export async function checkBanlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  const ip = getClientIp(req)
  if (await isIpBanned(ip)) {
    res.status(403).json({ error: 'ip_banned', message: 'Access denied.' })
    return
  }
  next()
}

/** Umbrella: max 30 request /api/auth/* in 15min per IP. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many auth requests.' },
})

/** Magic link request: 5/15min/IP. Più stretto perché spam email. */
export const requestLinkLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 5,
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many link requests. Wait 15 min.' },
})

/** Magic link request per-email: 3/15min/email. Anti-spam mirato. */
export const requestLinkPerEmailLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 3,
  keyGenerator: (req: Request) => {
    const email = (req.body?.email || '').toString().toLowerCase().trim()
    return `email:${email || 'unknown'}`
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many link requests for this email.' },
})

/**
 * TOTP verify: 6/15min/IP + brute-force ban.
 * Handler custom registra failure e potenzialmente banna l'IP.
 */
export const totpVerifyLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 6,
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req: Request, res: Response) => {
    const ip = getClientIp(req)
    const result = await recordAuthFailure(ip, BAN_FAIL_THRESHOLD, BAN_COUNTER_WINDOW_MIN, BAN_DURATION_MIN)
    if (result.banned) {
      res.status(403).json({ error: 'ip_banned', message: 'Too many failed attempts. IP banned.' })
    } else {
      res.status(429).json({ error: 'rate_limited', message: 'Too many verify attempts.' })
    }
  },
})

/**
 * Claim start: 10/h/IP. Stretto ma sufficiente per UX iterativa
 * (utente che corregge SMTP config, prova email diverse, ecc.).
 * Resta efficace come anti-spam (chi attacca farebbe migliaia di tentativi/ora).
 */
export const claimStartLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many claim attempts. Wait 1 hour.' },
})

/**
 * V15.0 WS7 — Setup-email: 5/h/IP.
 * Anti-bruteforce su persistenza config pre-claim. Solo POST /setup-email.
 * /setup-status NON è limitato (lettura). /validate-smtp ha limite separato
 * più permissivo (vedi validateSmtpLimiter) per UX iterativa.
 */
export const setupLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many setup attempts. Wait 1 hour.' },
})

/**
 * V15.0 WS8 — Validate-smtp: 30/h/IP.
 * Limite più permissivo perché on-blur validation può triggerare molte volte
 * mentre l'utente itera con credenziali. Anti-DOS verso server SMTP esterni
 * resta efficace (30 verify in 1h è ragionevole per uso umano).
 */
export const validateSmtpLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 30,
  keyGenerator: keyByIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Too many SMTP validations. Wait 1 hour.' },
})
