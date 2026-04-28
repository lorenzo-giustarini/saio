/**
 * V15.0 WS3-3H — Admin access control (owner-only).
 *
 * Endpoint per invitare/revocare guest. requireAuth + requireOwner sono applicati
 * nel mount esterno (server/index.ts). Owner non può rimuovere se stesso.
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import {
  appendGuestEntry,
  findAllowed,
  readAllowlist,
  removeEntry,
} from '../lib/auth/allowlist'
import { createMagicLink } from '../lib/auth/magic-link'
import { sendMagicLinkEmail } from '../lib/auth/email'
import { revokeAllSessionsForEmail } from '../lib/auth/session-store'
import { deleteTotpRecord } from '../lib/auth/totp'
import { audit } from '../lib/auth/audit'
import { getClientIp, hashUserAgent } from '../lib/auth/ip-trust'
import { MAGIC_LINK_INVITE_TTL_MIN } from '../lib/auth/constants'
import { logger } from '../lib/logger'

const InviteBody = z.object({
  email: z.string().email().max(254),
})

function buildPublicUrl(req: Request, suffix: string): string {
  const tunnel = (process.env.DASHBOARD_AUTH_TUNNEL_URL || '').trim()
  if (tunnel) return `${tunnel}${suffix}`
  const proto = req.headers['x-forwarded-proto']?.toString() || req.protocol || 'http'
  const host = req.headers['host'] || '127.0.0.1:3031'
  return `${proto}://${host}${suffix}`
}

export function adminAccessRouter(dataDir: string): Router {
  const router = Router()

  // ─────────────────── LIST ─────────────────────
  router.get('/', async (_req, res) => {
    const list = await readAllowlist(dataDir)
    res.json({ entries: list.entries })
  })

  // ─────────────────── INVITE ─────────────────────
  router.post('/invite', async (req: Request, res: Response): Promise<void> => {
    const parsed = InviteBody.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_email' })
      return
    }
    const norm = parsed.data.email.toLowerCase().trim()
    const ip = getClientIp(req)
    const uah = hashUserAgent(req)
    const inviterEmail = req.user?.email || 'unknown'

    const existing = await findAllowed(dataDir, norm)
    if (existing) {
      res.status(409).json({ error: 'already_allowed', role: existing.role })
      return
    }

    await appendGuestEntry(dataDir, norm, inviterEmail)

    // Trigger primo magic-link 24h TTL (più tempo per leggere email)
    try {
      const { rawToken } = await createMagicLink({
        dataDir,
        email: norm,
        role: 'guest',
        purpose: 'invite',
        ip,
        userAgentHash: uah,
        ttlMinutes: MAGIC_LINK_INVITE_TTL_MIN,
      })
      const link = buildPublicUrl(req, `/api/auth/verify?lt=${rawToken}`)
      await sendMagicLinkEmail({ to: norm, link, purpose: 'invite', expiresInMinutes: MAGIC_LINK_INVITE_TTL_MIN })
      await audit({ type: 'invite.sent', email: norm, ip, userAgentHash: uah, meta: { invitedBy: inviterEmail } })
      res.json({ ok: true, email: norm })
    } catch (err) {
      logger.error('[admin-access] invite send failed:', err)
      // Email aggiunta in allowlist comunque — owner può triggerare nuovo link manualmente
      res.json({ ok: true, email: norm, warning: 'email_send_failed' })
    }
  })

  // ─────────────────── REVOKE ─────────────────────
  router.delete('/:email', async (req: Request, res: Response): Promise<void> => {
    const raw = req.params.email
    const norm = (typeof raw === 'string' ? raw : '').toLowerCase().trim()
    if (!norm) {
      res.status(400).json({ error: 'invalid_email' })
      return
    }
    const target = await findAllowed(dataDir, norm)
    if (!target) {
      res.status(404).json({ error: 'not_found' })
      return
    }
    if (target.role === 'owner') {
      res.status(400).json({ error: 'cannot_revoke_owner' })
      return
    }
    if (req.user?.email && req.user.email.toLowerCase() === norm) {
      // Difensivo: owner non dovrebbe avere role='guest' su se stesso, ma se ha
      // ricevuto un'altra email per sé, evita auto-lockout
      res.status(400).json({ error: 'cannot_revoke_self' })
      return
    }

    await removeEntry(dataDir, norm)
    await deleteTotpRecord(dataDir, norm)
    const revokedSessions = await revokeAllSessionsForEmail(dataDir, norm, 'admin-revoke')

    const ip = getClientIp(req)
    const uah = hashUserAgent(req)
    await audit({
      type: 'invite.revoked',
      email: norm,
      ip,
      userAgentHash: uah,
      meta: { revokedBy: req.user?.email || 'unknown', sessionsRevoked: revokedSessions },
    })

    res.json({ ok: true, email: norm, sessionsRevoked: revokedSessions })
  })

  return router
}
