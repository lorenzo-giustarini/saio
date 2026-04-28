/**
 * V15.0 WS3 — Auth router (/api/auth/*).
 *
 * 3G implementa:
 *  - GET  /api/auth/claim/status         — public, dice se il dashboard è già claimato
 *  - POST /api/auth/claim/start          — public + rate-limited, owner bootstrap one-shot
 *  - GET  /api/auth/verify               — public, consume magic-link (claim purpose)
 *
 * 3A/3B/3C aggiungeranno: /request-link, /me, /refresh, /logout, /totp/*.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import nodemailer from 'nodemailer'
import {
  bootstrapAuth,
  deleteClaimToken,
  readClaimStatePublic,
  writeClaimState,
  type ClaimState,
} from '../lib/auth/bootstrap'
import {
  consumeMagicLink,
  createMagicLink,
  sha256Hex,
} from '../lib/auth/magic-link'
import {
  appendOwnerEntry,
  findAllowed,
  setTotpEnrolledAt,
} from '../lib/auth/allowlist'
import {
  isClaimed,
  writeOwner,
} from '../lib/auth/owner-store'
import { clearSenderCache, getProviderSnapshot, sendMagicLinkEmail } from '../lib/auth/email'
import { setProcessEnv, updateEnvLocal } from '../lib/auth/env-writer'
import { signPending, signTokenPair, signTrusted, verifyPending, verifyRefresh } from '../lib/auth/jwt'
import {
  confirmEnroll,
  getTotpRecord,
  startEnroll,
  verifyTotpOrRecovery,
} from '../lib/auth/totp'
import {
  createSession,
  findSessionByJti,
  rotateSession,
  revokeSession,
  type Session,
} from '../lib/auth/session-store'
import { audit } from '../lib/auth/audit'
import { getClientIp, hashUserAgent } from '../lib/auth/ip-trust'
import {
  COOKIE_ACCESS,
  COOKIE_PENDING,
  COOKIE_REFRESH,
  COOKIE_TRUSTED,
  MAGIC_LINK_TTL_MIN,
  SAIO_PENDING_COOKIE_TTL_MIN,
  TRUSTED_TTL_OPTIONS,
  isAuthRequired,
} from '../lib/auth/constants'
import {
  claimStartLimiter,
  requestLinkLimiter,
  requestLinkPerEmailLimiter,
  setupLimiter,
  totpVerifyLimiter,
  validateSmtpLimiter,
} from '../middleware/rate-limit'
import { makeRequireAuth } from '../middleware/require-auth'
import { logger } from '../lib/logger'

const ClaimStartBody = z.object({
  token: z.string().min(16).max(256),
  email: z.string().email().max(254),
})

const RequestLinkBody = z.object({
  email: z.string().email().max(254),
})

// V15.0 WS7 — Setup email body schemas
const SmtpSetupSchema = z.object({
  provider: z.literal('smtp'),
  smtpHost: z.string().min(1).max(253),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().min(1).max(254),
  smtpPass: z.string().min(1).max(512),
  fromEmail: z.string().email().max(254),
})

const ResendSetupSchema = z.object({
  provider: z.literal('resend'),
  resendApiKey: z.string().min(8).max(256),
  fromEmail: z.string().email().max(254),
})

const DebugSetupSchema = z.object({
  provider: z.literal('debug'),
})

const SetupEmailBody = z.discriminatedUnion('provider', [
  SmtpSetupSchema,
  ResendSetupSchema,
  DebugSetupSchema,
])

// V15.0 WS8 — Validate SMTP endpoint body
const ValidateSmtpBody = z.object({
  smtpHost: z.string().min(1).max(253),
  smtpPort: z.number().int().min(1).max(65535),
  smtpUser: z.string().min(1).max(254),
  smtpPass: z.string().min(1).max(512),
})

/**
 * V15.0 WS8 — mappa errori nodemailer/SMTP raw a messaggi UX italiani.
 * Evita info disclosure su versioni server e dà hint actionable all'utente.
 */
function classifySmtpError(rawMsg: string): string {
  const m = rawMsg.toLowerCase()
  if (m.includes('eauth') || m.includes('invalid login') || m.includes('authentication failed') || m.includes('535')) {
    return 'Credenziali errate. Controlla username e password (per Gmail/Outlook/Yahoo: usa una App Password, NON la password normale).'
  }
  if (m.includes('etimedout') || m.includes('connection timeout')) {
    return 'Server SMTP non risponde entro 8 secondi. Controlla host e porta, oppure il tuo firewall potrebbe bloccare la connessione SMTP.'
  }
  if (m.includes('getaddrinfo') || m.includes('enotfound') || m.includes('esocket')) {
    return 'Host SMTP non trovato. Controlla l\'indirizzo (es. smtp.gmail.com, mail.tuodominio.com).'
  }
  if (m.includes('wrong version number') || m.includes('ssl routines')) {
    return 'Errore TLS/SSL. Prova porta 465 (SSL) invece di 587 (STARTTLS), o viceversa.'
  }
  if (m.includes('econnrefused')) {
    return 'Connessione rifiutata dal server SMTP. Verifica che la porta sia corretta (di solito 587 o 465).'
  }
  return `Errore SMTP: ${rawMsg.slice(0, 200)}`
}

/**
 * V15.0 WS8 — Classifica errori di INVIO email (vs validation handshake).
 * sendMagicLinkEmail può fallire dopo che validate-smtp è andato bene se:
 *  - Server SMTP rifiuta destinatario (550 RCPT TO) — comune con hosting
 *    cPanel/ChemiCloud/Aruba che non sono open-relay verso domini esterni.
 *  - Mittente non autorizzato (553)
 *  - Quota / blacklist
 * Ritorna {code, message, httpStatus} per response strutturata.
 */
function classifyEmailDeliveryError(
  err: unknown,
  recipient: string
): { code: string; message: string; httpStatus: number } {
  const errAny = err as { code?: string; responseCode?: number; response?: string; message?: string } | null
  const raw = (errAny?.message || String(err)).toLowerCase()
  const responseCode = errAny?.responseCode
  const errCode = errAny?.code

  // 550 No Such User Here / EENVELOPE / RCPT rejected
  if (
    errCode === 'EENVELOPE' ||
    responseCode === 550 ||
    raw.includes('no such user') ||
    raw.includes('recipient') && raw.includes('reject')
  ) {
    return {
      code: 'recipient_rejected',
      httpStatus: 422,
      message:
        `Il server SMTP ha rifiutato il destinatario "${recipient}". Molti hosting (cPanel/ChemiCloud/Aruba/Register) accettano l'invio SOLO verso caselle del proprio dominio. ` +
        `Soluzioni:\n` +
        `1) Usa come email destinataria una casella del dominio che sta inviando (es. "info@tuodominio.com").\n` +
        `2) Abilita "outbound relay" nel pannello hosting (raro, di solito disabilitato).\n` +
        `3) Cambia provider SMTP usando un servizio transazionale (Mailgun, SendGrid, Resend) progettato per inviare a destinatari esterni.`,
    }
  }
  if (responseCode === 553) {
    return {
      code: 'sender_rejected',
      httpStatus: 422,
      message: 'Il server SMTP ha rifiutato il mittente. Probabilmente l\'indirizzo "from" non è autorizzato — controlla le impostazioni del provider.',
    }
  }
  if (responseCode === 552 || raw.includes('quota')) {
    return {
      code: 'quota_exceeded',
      httpStatus: 422,
      message: 'Quota di invio email superata sul server SMTP.',
    }
  }
  if (errCode === 'EAUTH' || raw.includes('authentication') || responseCode === 535) {
    return {
      code: 'auth_failed',
      httpStatus: 422,
      message: 'Autenticazione SMTP fallita durante l\'invio. Riconfigura il provider email dal wizard.',
    }
  }
  if (errCode === 'ETIMEDOUT' || errCode === 'ECONNREFUSED' || raw.includes('timeout')) {
    return {
      code: 'smtp_unreachable',
      httpStatus: 503,
      message: 'Server SMTP irraggiungibile. Riprova tra qualche minuto.',
    }
  }
  return {
    code: 'send_failed',
    httpStatus: 500,
    message: 'Invio email fallito. Controlla i log del backend per dettagli e riconfigura il provider.',
  }
}

const TotpCodeBody = z.object({
  code: z.string().min(6).max(32), // 6 digits TOTP o 16 hex recovery
  // V15.0 WS6 — Trusted device opt-in
  trustDevice: z.boolean().optional(),
  trustDays: z
    .number()
    .int()
    .refine((n) => (TRUSTED_TTL_OPTIONS as readonly number[]).includes(n), {
      message: 'trustDays must be one of [1, 3, 7, 15, 30]',
    })
    .optional(),
})

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildPublicUrl(req: Request, suffix: string): string {
  const tunnel = (process.env.DASHBOARD_AUTH_TUNNEL_URL || '').trim()
  if (tunnel) return `${tunnel}${suffix}`
  // Dev fallback
  const proto = req.headers['x-forwarded-proto']?.toString() || req.protocol || 'http'
  const host = req.headers['host'] || '127.0.0.1:3031'
  return `${proto}://${host}${suffix}`
}

function setSessionCookies(req: Request, res: Response, access: string, refresh: string): void {
  const isProdOrHttps = process.env.NODE_ENV === 'production' || req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https'
  res.cookie(COOKIE_ACCESS, access, {
    httpOnly: true,
    secure: isProdOrHttps,
    sameSite: 'strict',
    maxAge: 60 * 60_000, // 1h
    path: '/',
  })
  res.cookie(COOKIE_REFRESH, refresh, {
    httpOnly: true,
    secure: isProdOrHttps,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60_000, // 7d
    path: '/api/auth', // refresh cookie scoped al solo refresh endpoint
  })
}

function clearAllCookies(res: Response): void {
  res.clearCookie(COOKIE_ACCESS, { path: '/' })
  res.clearCookie(COOKIE_REFRESH, { path: '/api/auth' })
  res.clearCookie(COOKIE_PENDING, { path: '/' })
  res.clearCookie(COOKIE_TRUSTED, { path: '/' })
}

async function maybeSetTrustedCookie(
  req: Request,
  res: Response,
  dataDir: string,
  email: string,
  role: 'owner' | 'guest',
  sid: string,
  jti: string,
  trustDevice: boolean | undefined,
  trustDays: number | undefined
): Promise<void> {
  if (!trustDevice || !trustDays) return
  if (!(TRUSTED_TTL_OPTIONS as readonly number[]).includes(trustDays)) return
  const trustedJwt = await signTrusted(dataDir, email, role, sid, jti, trustDays)
  const isProdOrHttps =
    process.env.NODE_ENV === 'production' ||
    req.protocol === 'https' ||
    req.headers['x-forwarded-proto'] === 'https'
  res.cookie(COOKIE_TRUSTED, trustedJwt, {
    httpOnly: true,
    secure: isProdOrHttps,
    sameSite: 'strict',
    maxAge: trustDays * 24 * 60 * 60_000,
    path: '/',
  })
}

export function authRouter(dataDir: string): Router {
  const router = Router()
  const requireAuthMw = makeRequireAuth(dataDir)

  // ─────────────────── CLAIM STATUS (public) ───────────────────
  router.get('/claim/status', async (_req, res) => {
    const claimed = await isClaimed(dataDir)
    res.json({ claimed })
  })

  // ─────────────────── SETUP STATUS (public, lettura no rate-limit) ───────────────────
  // V15.0 WS7 — Frontend wizard usa questo per decidere se mostrare onboarding
  router.get('/setup-status', async (_req, res) => {
    const claimed = await isClaimed(dataDir)
    const snap = getProviderSnapshot()
    res.json({ ...snap, claimed })
  })

  // ─────────────────── SETUP EMAIL (public + setupLimiter, pre-claim only) ───────────────────
  // V15.0 WS7 — Wizard salva config provider email senza richiedere SSH
  router.post('/setup-email', setupLimiter, async (req: Request, res: Response): Promise<void> => {
    // Pre-claim guard: una volta claimato il dashboard, no modifica config web
    if (await isClaimed(dataDir)) {
      res.status(410).json({ error: 'already_claimed', message: 'Dashboard already claimed. Edit .env.local via SSH.' })
      return
    }

    const parsed = SetupEmailBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues })
      return
    }
    const ip = getClientIp(req)
    const uah = hashUserAgent(req)

    let updates: Record<string, string> = {}
    try {
      switch (parsed.data.provider) {
        case 'smtp': {
          updates = {
            DASHBOARD_AUTH_SMTP_HOST: parsed.data.smtpHost,
            DASHBOARD_AUTH_SMTP_PORT: String(parsed.data.smtpPort),
            DASHBOARD_AUTH_SMTP_USER: parsed.data.smtpUser,
            DASHBOARD_AUTH_SMTP_PASS: parsed.data.smtpPass,
            DASHBOARD_AUTH_FROM: parsed.data.fromEmail,
            DASHBOARD_AUTH_DEBUG_MAGIC_LINK: 'false',
            DASHBOARD_AUTH_RESEND_API_KEY: '',
          }
          break
        }
        case 'resend': {
          updates = {
            DASHBOARD_AUTH_RESEND_API_KEY: parsed.data.resendApiKey,
            DASHBOARD_AUTH_FROM: parsed.data.fromEmail,
            DASHBOARD_AUTH_DEBUG_MAGIC_LINK: 'false',
            DASHBOARD_AUTH_SMTP_HOST: '',
            DASHBOARD_AUTH_SMTP_USER: '',
            DASHBOARD_AUTH_SMTP_PASS: '',
          }
          break
        }
        case 'debug': {
          updates = {
            DASHBOARD_AUTH_DEBUG_MAGIC_LINK: 'true',
            DASHBOARD_AUTH_SMTP_HOST: '',
            DASHBOARD_AUTH_RESEND_API_KEY: '',
          }
          break
        }
      }

      const result = await updateEnvLocal(updates)
      setProcessEnv(updates)
      clearSenderCache()

      await audit({
        type: 'claim.requested', // semantica: setup è step pre-claim
        ip,
        userAgentHash: uah,
        meta: { result: 'setup_email', provider: parsed.data.provider, backup: result.backup },
      })

      res.json({ ok: true, configured: true, provider: parsed.data.provider })
    } catch (err) {
      logger.error('[auth] setup-email failed:', err)
      res.status(500).json({ error: 'setup_failed', message: 'Could not write configuration.' })
    }
  })

  // ─────────────────── VALIDATE SMTP (live verify, pre-claim only) ───────────────────
  // V15.0 WS8 — Wizard chiama questo on-blur del campo password per dare feedback
  // immediato. Usa nodemailer.transporter.verify() che fa SMTP handshake + AUTH check
  // SENZA inviare email. Nessun side effect (no .env.local write).
  router.post('/validate-smtp', validateSmtpLimiter, async (req: Request, res: Response): Promise<void> => {
    if (await isClaimed(dataDir)) {
      res.status(410).json({ valid: false, error: 'already_claimed' })
      return
    }
    const parsed = ValidateSmtpBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ valid: false, error: 'invalid_body' })
      return
    }
    const { smtpHost, smtpPort, smtpUser, smtpPass } = parsed.data
    logger.info(`[auth] validate-smtp ${smtpHost}:${smtpPort} user=${smtpUser.slice(0, 3)}...`)
    let transporter: ReturnType<typeof nodemailer.createTransport> | null = null
    try {
      transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465, // 465 = SSL, 587 = STARTTLS
        auth: { user: smtpUser, pass: smtpPass },
        connectionTimeout: 8_000,
        greetingTimeout: 5_000,
        socketTimeout: 10_000,
      })
      await transporter.verify()
      logger.info(`[auth] validate-smtp OK ${smtpHost}`)
      res.json({ valid: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.warn(`[auth] validate-smtp FAIL ${smtpHost}: ${msg.slice(0, 120)}`)
      res.json({ valid: false, error: classifySmtpError(msg) })
    } finally {
      if (transporter) transporter.close()
    }
  })

  // ─────────────────── REQUEST MAGIC LINK (login) — public, rate-limited ───────────────────
  router.post(
    '/request-link',
    requestLinkLimiter,
    requestLinkPerEmailLimiter,
    async (req: Request, res: Response): Promise<void> => {
      const ip = getClientIp(req)
      const uah = hashUserAgent(req)
      const parsed = RequestLinkBody.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_email' })
        return
      }
      const email = parsed.data.email.toLowerCase().trim()

      // Bootstrap not yet done? Reindirizza implicitamente a claim flow lato UI.
      if (!(await isClaimed(dataDir))) {
        res.status(409).json({ error: 'not_bootstrapped', message: 'Dashboard non ancora claimato.' })
        return
      }

      // Allowlist lookup
      const allowed = await findAllowed(dataDir, email)

      // Anti-enumeration: response identica per allowed/unknown email + delay 100-500ms
      const delayMs = 100 + Math.floor(Math.random() * 400)

      if (!allowed) {
        await audit({ type: 'login.requested', email, ip, userAgentHash: uah, meta: { allowed: false } })
        await sleep(delayMs)
        res.json({ ok: true, message: 'If this email is authorized, a sign-in link has been sent.' })
        return
      }

      // OK: crea magic-link login + invia
      try {
        const { rawToken } = await createMagicLink({
          dataDir,
          email,
          role: allowed.role,
          purpose: 'login',
          ip,
          userAgentHash: uah,
          ttlMinutes: MAGIC_LINK_TTL_MIN,
        })
        const link = buildPublicUrl(req, `/api/auth/verify?lt=${rawToken}`)
        await sendMagicLinkEmail({ to: email, link, purpose: 'login', expiresInMinutes: MAGIC_LINK_TTL_MIN })
        await audit({ type: 'login.requested', email, ip, userAgentHash: uah, meta: { allowed: true } })
      } catch (err) {
        logger.error('[auth] request-link failed:', err)
        await audit({ type: 'login.failed', email, ip, userAgentHash: uah, meta: { reason: 'send_failed' } })
        // anche su fallimento send: response 200 generic per non leakare stato
      }
      await sleep(delayMs)
      res.json({ ok: true, message: 'If this email is authorized, a sign-in link has been sent.' })
    }
  )

  // ─────────────────── TOTP ENROLL (saio_pending cookie required) ───────────────────
  router.post('/totp/enroll', async (req: Request, res: Response): Promise<void> => {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies || {}
    const pending = cookies[COOKIE_PENDING]
    if (!pending) {
      res.status(401).json({ error: 'no_pending_cookie' })
      return
    }
    const payload = await verifyPending(dataDir, pending)
    if (!payload) {
      res.status(401).json({ error: 'invalid_pending' })
      return
    }
    // Se già enrolled, blocca (deve usare /verify-totp invece di re-enroll)
    const existing = await getTotpRecord(dataDir, payload.sub)
    if (existing && existing.enrolledAt) {
      res.status(409).json({ error: 'already_enrolled' })
      return
    }
    try {
      const { qrCodeDataUrl, recoveryCodes } = await startEnroll(dataDir, payload.sub)
      // NON ritorno il secret in chiaro — solo QR (che lo contiene encoded)
      res.json({
        qrCodeDataUrl,
        recoveryCodes, // PLAINTEXT shown ONCE
        email: payload.sub,
      })
    } catch (err) {
      logger.error('[auth] totp/enroll failed:', err)
      res.status(500).json({ error: 'enroll_failed' })
    }
  })

  // ─────────────────── TOTP ENROLL CONFIRM ───────────────────
  router.post(
    '/totp/enroll-confirm',
    totpVerifyLimiter,
    async (req: Request, res: Response): Promise<void> => {
      const cookies = (req as Request & { cookies?: Record<string, string> }).cookies || {}
      const pending = cookies[COOKIE_PENDING]
      if (!pending) {
        res.status(401).json({ error: 'no_pending_cookie' })
        return
      }
      const payload = await verifyPending(dataDir, pending)
      if (!payload) {
        res.status(401).json({ error: 'invalid_pending' })
        return
      }
      const parsed = TotpCodeBody.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_code' })
        return
      }
      const ok = await confirmEnroll(dataDir, payload.sub, parsed.data.code.trim())
      if (!ok) {
        await audit({
          type: 'totp.failed',
          email: payload.sub,
          ip: getClientIp(req),
          userAgentHash: hashUserAgent(req),
          meta: { stage: 'enroll-confirm' },
        })
        res.status(401).json({ error: 'invalid_code' })
        return
      }
      // OK: clear pending cookie + issue session pair
      const ip = getClientIp(req)
      const uah = hashUserAgent(req)
      const pair = await signTokenPair(dataDir, payload.sub, payload.role)
      await createSession(dataDir, {
        jti: pair.jti,
        sid: pair.sid,
        email: payload.sub,
        role: payload.role,
        createdAt: new Date().toISOString(),
        refreshedAt: new Date().toISOString(),
        expiresAt: pair.refreshExpiresAt,
        ip,
        userAgentHash: uah,
        revoked: false,
      })
      res.clearCookie(COOKIE_PENDING, { path: '/' })
      setSessionCookies(req, res, pair.access, pair.refresh)
      await maybeSetTrustedCookie(
        req,
        res,
        dataDir,
        payload.sub,
        payload.role,
        pair.sid,
        pair.jti,
        parsed.data.trustDevice,
        parsed.data.trustDays
      )
      await audit({ type: 'totp.enrolled', email: payload.sub, ip, userAgentHash: uah })
      await audit({
        type: 'session.created',
        email: payload.sub,
        ip,
        userAgentHash: uah,
        meta: {
          sid: pair.sid,
          viaEnroll: true,
          trusted: !!parsed.data.trustDevice,
          trustedDays: parsed.data.trustDevice ? parsed.data.trustDays : undefined,
        },
      })
      res.json({ ok: true, redirect: '/inbox' })
    }
  )

  // ─────────────────── TOTP VERIFY (post magic link, user already enrolled) ───────────────────
  router.post(
    '/totp/verify',
    totpVerifyLimiter,
    async (req: Request, res: Response): Promise<void> => {
      const cookies = (req as Request & { cookies?: Record<string, string> }).cookies || {}
      const pending = cookies[COOKIE_PENDING]
      if (!pending) {
        res.status(401).json({ error: 'no_pending_cookie' })
        return
      }
      const payload = await verifyPending(dataDir, pending)
      if (!payload) {
        res.status(401).json({ error: 'invalid_pending' })
        return
      }
      const parsed = TotpCodeBody.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_code' })
        return
      }
      const result = await verifyTotpOrRecovery(dataDir, payload.sub, parsed.data.code.trim())
      if (!result.ok) {
        await audit({
          type: 'totp.failed',
          email: payload.sub,
          ip: getClientIp(req),
          userAgentHash: hashUserAgent(req),
          meta: { stage: 'verify' },
        })
        res.status(401).json({ error: 'invalid_code' })
        return
      }
      const ip = getClientIp(req)
      const uah = hashUserAgent(req)
      const pair = await signTokenPair(dataDir, payload.sub, payload.role)
      await createSession(dataDir, {
        jti: pair.jti,
        sid: pair.sid,
        email: payload.sub,
        role: payload.role,
        createdAt: new Date().toISOString(),
        refreshedAt: new Date().toISOString(),
        expiresAt: pair.refreshExpiresAt,
        ip,
        userAgentHash: uah,
        revoked: false,
      })
      res.clearCookie(COOKIE_PENDING, { path: '/' })
      setSessionCookies(req, res, pair.access, pair.refresh)
      await maybeSetTrustedCookie(
        req,
        res,
        dataDir,
        payload.sub,
        payload.role,
        pair.sid,
        pair.jti,
        parsed.data.trustDevice,
        parsed.data.trustDays
      )
      await audit({
        type: 'login.success',
        email: payload.sub,
        ip,
        userAgentHash: uah,
        meta: {
          usedRecovery: !!result.usedRecovery,
          sid: pair.sid,
          trusted: !!parsed.data.trustDevice,
          trustedDays: parsed.data.trustDevice ? parsed.data.trustDays : undefined,
        },
      })
      res.json({ ok: true, redirect: '/inbox', usedRecovery: !!result.usedRecovery })
    }
  )

  // ─────────────────── ME (auth required) ───────────────────
  router.get('/me', requireAuthMw, (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthenticated' })
      return
    }
    res.json({
      email: req.user.email,
      role: req.user.role,
      sid: req.user.sid,
      authBypass: !isAuthRequired(),
    })
  })

  // ─────────────────── REFRESH (public con cookie saio_rt) ───────────────────
  router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies || {}
    const rt = cookies[COOKIE_REFRESH]
    if (!rt) {
      res.status(401).json({ error: 'missing_refresh' })
      return
    }
    const payload = await verifyRefresh(dataDir, rt)
    if (!payload) {
      clearAllCookies(res)
      res.status(401).json({ error: 'invalid_refresh' })
      return
    }
    const session = await findSessionByJti(dataDir, payload.jti)
    if (!session || session.revoked) {
      clearAllCookies(res)
      res.status(401).json({ error: 'session_invalid' })
      return
    }
    const ip = getClientIp(req)
    const uah = hashUserAgent(req)
    const pair = await signTokenPair(dataDir, payload.sub, payload.role)
    const newSess: Session = {
      jti: pair.jti,
      sid: pair.sid,
      email: payload.sub,
      role: payload.role,
      createdAt: new Date().toISOString(),
      refreshedAt: new Date().toISOString(),
      expiresAt: pair.refreshExpiresAt,
      ip,
      userAgentHash: uah,
      revoked: false,
    }
    await rotateSession(dataDir, payload.jti, newSess)
    setSessionCookies(req, res, pair.access, pair.refresh)
    await audit({ type: 'session.refreshed', email: payload.sub, ip, userAgentHash: uah, meta: { sid: pair.sid } })
    res.json({ ok: true })
  })

  // ─────────────────── LOGOUT (auth required) ───────────────────
  router.post('/logout', requireAuthMw, async (req: Request, res: Response): Promise<void> => {
    if (req.user && req.user.sid !== 'dev-bypass') {
      await revokeSession(dataDir, req.user.sid, 'logout')
      await audit({
        type: 'session.revoked',
        email: req.user.email,
        ip: getClientIp(req),
        userAgentHash: hashUserAgent(req),
        meta: { sid: req.user.sid, reason: 'logout' },
      })
    }
    clearAllCookies(res)
    res.json({ ok: true })
  })

  // ─────────────────── CLAIM START (public, rate-limited) ───────────────────
  router.post('/claim/start', claimStartLimiter, async (req: Request, res: Response): Promise<void> => {
    const ip = getClientIp(req)
    const uah = hashUserAgent(req)

    // Already claimed?
    if (await isClaimed(dataDir)) {
      await audit({ type: 'claim.requested', ip, userAgentHash: uah, meta: { result: 'already_claimed' } })
      res.status(410).json({ error: 'already_claimed' })
      return
    }

    // Validate body
    const parsed = ClaimStartBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' })
      return
    }
    const { token, email } = parsed.data

    // Read claim state
    const state = await readClaimStatePublic(dataDir)
    if (!state || state.claimed === true) {
      // claim-state mancante post-bootstrap = anomalia
      res.status(410).json({ error: 'already_claimed' })
      return
    }

    // Token expired?
    if (new Date(state.expiresAt).getTime() < Date.now()) {
      // Cleanup + chiedi al server di rigenerare al restart
      await deleteClaimToken(dataDir)
      // Lasciamo claim-state.json com'è (claimed:false con tokenHash che non matcha
      // più nulla — al prossimo bootstrapAuth verrà rigenerato)
      res.status(410).json({ error: 'token_expired' })
      return
    }

    // Token match?
    if (sha256Hex(token) !== state.tokenHash) {
      await audit({ type: 'claim.requested', ip, userAgentHash: uah, email, meta: { result: 'token_mismatch' } })
      res.status(400).json({ error: 'invalid_token' })
      return
    }

    // OK: crea magic-link "claim" da inviare via email
    try {
      const { rawToken, expiresAt } = await createMagicLink({
        dataDir,
        email,
        role: 'owner',
        purpose: 'claim',
        ip,
        userAgentHash: uah,
        ttlMinutes: MAGIC_LINK_TTL_MIN,
      })
      const link = buildPublicUrl(req, `/api/auth/verify?lt=${rawToken}`)
      await sendMagicLinkEmail({ to: email, link, purpose: 'claim', expiresInMinutes: MAGIC_LINK_TTL_MIN })
      await audit({ type: 'claim.requested', ip, userAgentHash: uah, email, meta: { result: 'magic_link_sent', expiresAt } })
      res.json({ ok: true, message: 'Check your inbox for the sign-in link.' })
      return
    } catch (err) {
      logger.error('[auth] claim/start failed:', err)
      // V15.0 WS8 — classifica errori SMTP comuni per dare guidance frontend
      const classified = classifyEmailDeliveryError(err, email)
      await audit({
        type: 'login.failed',
        email,
        ip,
        userAgentHash: uah,
        meta: { stage: 'claim/start', errorCode: classified.code },
      })
      res.status(classified.httpStatus).json({
        error: classified.code,
        message: classified.message,
      })
      return
    }
  })

  // ─────────────────── MAGIC LINK VERIFY (public) ───────────────────
  router.get('/verify', requestLinkLimiter, async (req: Request, res: Response): Promise<void> => {
    const ip = getClientIp(req)
    const uah = hashUserAgent(req)
    const lt = (req.query.lt || '').toString().trim()
    if (!lt || lt.length < 16) {
      res.redirect('/login?error=invalid_link')
      return
    }
    const link = await consumeMagicLink(dataDir, lt)
    if (!link) {
      res.redirect('/login?error=link_expired')
      return
    }

    if (link.purpose === 'claim') {
      // First-time owner bootstrap completion
      try {
        // Idempotency: se nel frattempo qualcun altro ha claimato, blocca
        if (await isClaimed(dataDir)) {
          res.redirect('/login?error=already_claimed')
          return
        }
        const claimedAt = new Date().toISOString()
        await writeOwner(dataDir, { email: link.email, claimedAt, claimIp: ip })
        await appendOwnerEntry(dataDir, link.email)
        const claimedState: ClaimState = { claimed: true, claimedAt, ownerEmail: link.email }
        await writeClaimState(dataDir, claimedState)
        await deleteClaimToken(dataDir)
        await audit({ type: 'claim.completed', ip, userAgentHash: uah, email: link.email })
        // Issue saio_pending cookie → frontend va su /enroll-totp
        const pendingJwt = await signPending(
          dataDir,
          { sub: link.email, role: 'owner', purpose: 'totp-pending' },
          SAIO_PENDING_COOKIE_TTL_MIN * 60
        )
        res.cookie(COOKIE_PENDING, pendingJwt, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
          sameSite: 'strict',
          maxAge: SAIO_PENDING_COOKIE_TTL_MIN * 60_000,
          path: '/',
        })
        res.redirect('/enroll-totp')
        return
      } catch (err) {
        logger.error('[auth] verify (claim) failed:', err)
        res.redirect('/login?error=server_error')
        return
      }
    }

    // login / invite purpose → controlla allowlist + TOTP enrollment status
    const allowed = await findAllowed(dataDir, link.email)
    if (!allowed) {
      // L'email non è più allowlisted (revocata mentre il link era pending)
      await audit({ type: 'unauthorized.access', ip, userAgentHash: uah, email: link.email, meta: { reason: 'not_in_allowlist' } })
      res.redirect('/login?error=not_authorized')
      return
    }

    const pendingJwt = await signPending(
      dataDir,
      { sub: link.email, role: allowed.role, purpose: 'totp-pending' },
      SAIO_PENDING_COOKIE_TTL_MIN * 60
    )
    res.cookie(COOKIE_PENDING, pendingJwt, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' || req.protocol === 'https',
      sameSite: 'strict',
      maxAge: SAIO_PENDING_COOKIE_TTL_MIN * 60_000,
      path: '/',
    })
    if (allowed.totpEnrolledAt) {
      res.redirect('/verify-totp')
    } else {
      res.redirect('/enroll-totp')
    }
  })

  return router
}

// Re-export per evitare circular: bootstrapAuth è chiamato da server/index.ts direttamente.
export { bootstrapAuth, setTotpEnrolledAt }
