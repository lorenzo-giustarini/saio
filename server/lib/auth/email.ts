/**
 * V15.0 WS6 — Email sender multi-provider.
 *
 * Routing:
 *  - DASHBOARD_AUTH_DEBUG_MAGIC_LINK=true → stampa link in stdout (no email reali)
 *  - DASHBOARD_AUTH_SMTP_HOST settato → nodemailer (Gmail App Password / Outlook /
 *    qualsiasi SMTP custom). Zero-friction setup per chi non vuole Resend.
 *  - DASHBOARD_AUTH_RESEND_API_KEY settato → Resend (raccomandato in prod con
 *    dominio verificato + DNS SPF/DKIM)
 *  - Altrimenti throw (no provider configurato — esegui scripts/saio-init.ps1)
 */
import nodemailer, { type Transporter } from 'nodemailer'
import { Resend } from 'resend'
import { logger } from '../logger'
import { isDebugMagicLink } from './constants'

export interface MagicLinkEmailOpts {
  to: string
  link: string
  purpose: 'login' | 'claim' | 'invite'
  expiresInMinutes: number
}

function buildSubject(purpose: MagicLinkEmailOpts['purpose']): string {
  switch (purpose) {
    case 'claim':
      return 'SAIO Dashboard — claim your instance'
    case 'invite':
      return 'SAIO Dashboard — you have been invited'
    case 'login':
    default:
      return 'SAIO Dashboard — sign-in link'
  }
}

function buildHtml(opts: MagicLinkEmailOpts): string {
  const action =
    opts.purpose === 'claim'
      ? 'claim ownership of'
      : opts.purpose === 'invite'
      ? 'access (first-time invite to)'
      : 'sign in to'
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:40px;">
  <div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;">
    <h2 style="margin:0 0 16px 0;font-weight:600;">SAIO Dashboard</h2>
    <p>Click the link below to ${action} your dashboard. The link expires in ${opts.expiresInMinutes} minutes and can be used only once.</p>
    <p style="margin:24px 0;"><a href="${opts.link}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Continue</a></p>
    <p style="font-size:13px;color:#737373;">If the button doesn't work, copy this URL into your browser:</p>
    <p style="font-size:12px;color:#a3a3a3;word-break:break-all;">${opts.link}</p>
    <hr style="border:none;border-top:1px solid #262626;margin:24px 0;" />
    <p style="font-size:12px;color:#737373;">If you didn't request this, you can ignore this email.</p>
  </div>
</body></html>`
}

function buildText(opts: MagicLinkEmailOpts): string {
  return `SAIO Dashboard\n\nLink (expires in ${opts.expiresInMinutes} min, single-use):\n${opts.link}\n\nIf you didn't request this, ignore this email.`
}

// ─────────────────── Sender abstraction ───────────────────

interface EmailSender {
  send(opts: MagicLinkEmailOpts): Promise<void>
  describe(): string
}

class DebugSender implements EmailSender {
  describe(): string {
    return 'DEBUG (stdout only)'
  }
  async send(opts: MagicLinkEmailOpts): Promise<void> {
    logger.info('═══════════════════════════════════════════════════════════════════════')
    logger.info(`  [DEBUG] MAGIC LINK (${opts.purpose}) for: ${opts.to}`)
    logger.info(`  ${opts.link}`)
    logger.info(`  Expires in ${opts.expiresInMinutes} minutes`)
    logger.info('═══════════════════════════════════════════════════════════════════════')
  }
}

class SmtpSender implements EmailSender {
  private transporter: Transporter
  private host: string
  private user: string
  private from: string
  constructor(host: string, port: number, user: string, pass: string, from: string) {
    this.host = host
    this.user = user
    this.from = from
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = SSL, 587 = STARTTLS
      auth: { user, pass },
    })
  }
  describe(): string {
    return `SMTP ${this.host} as ${this.user}`
  }
  async send(opts: MagicLinkEmailOpts): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: opts.to,
      subject: buildSubject(opts.purpose),
      html: buildHtml(opts),
      text: buildText(opts),
    })
  }
}

class ResendSender implements EmailSender {
  private client: Resend
  private from: string
  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey)
    this.from = from
  }
  describe(): string {
    return `Resend from ${this.from}`
  }
  async send(opts: MagicLinkEmailOpts): Promise<void> {
    const result = await this.client.emails.send({
      from: this.from,
      to: opts.to,
      subject: buildSubject(opts.purpose),
      html: buildHtml(opts),
      text: buildText(opts),
    })
    if (result.error) {
      throw new Error(`Resend send failed: ${result.error.message || 'unknown'}`)
    }
  }
}

// ─────────────────── Provider selection ───────────────────

let cachedSender: EmailSender | null = null

/**
 * V15.0 WS7 — Reset cache. Usato dopo /api/auth/setup-email per forzare
 * re-evaluation del provider con i nuovi env vars.
 */
export function clearSenderCache(): void {
  cachedSender = null
}

/**
 * V15.0 WS7 — Snapshot dello stato provider corrente, NO secrets.
 * Usato da GET /api/auth/setup-status per UI wizard.
 */
export function getProviderSnapshot(): {
  configured: boolean
  provider: 'smtp' | 'resend' | 'debug' | null
} {
  if (isDebugMagicLink()) return { configured: true, provider: 'debug' }
  if ((process.env.DASHBOARD_AUTH_SMTP_HOST || '').trim()) {
    return { configured: true, provider: 'smtp' }
  }
  if ((process.env.DASHBOARD_AUTH_RESEND_API_KEY || '').trim()) {
    return { configured: true, provider: 'resend' }
  }
  return { configured: false, provider: null }
}

function getSender(): EmailSender {
  if (cachedSender) return cachedSender

  if (isDebugMagicLink()) {
    cachedSender = new DebugSender()
    logger.info('[email] Using DEBUG mode — magic links printed to stdout')
    return cachedSender
  }

  const smtpHost = (process.env.DASHBOARD_AUTH_SMTP_HOST || '').trim()
  if (smtpHost) {
    const port = Number(process.env.DASHBOARD_AUTH_SMTP_PORT || 587)
    const user = (process.env.DASHBOARD_AUTH_SMTP_USER || '').trim()
    const pass = (process.env.DASHBOARD_AUTH_SMTP_PASS || '').trim()
    const from = (process.env.DASHBOARD_AUTH_FROM || user).trim()
    if (!user || !pass) {
      throw new Error('SMTP host set but DASHBOARD_AUTH_SMTP_USER or DASHBOARD_AUTH_SMTP_PASS missing')
    }
    cachedSender = new SmtpSender(smtpHost, port, user, pass, from)
    logger.info(`[email] Using ${cachedSender.describe()}`)
    return cachedSender
  }

  const resendKey = (process.env.DASHBOARD_AUTH_RESEND_API_KEY || '').trim()
  if (resendKey) {
    const from = (process.env.DASHBOARD_AUTH_FROM || 'onboarding@resend.dev').trim()
    cachedSender = new ResendSender(resendKey, from)
    logger.info(`[email] Using ${cachedSender.describe()}`)
    return cachedSender
  }

  throw new Error(
    'No email provider configured. Set DASHBOARD_AUTH_SMTP_HOST + USER + PASS, ' +
      'or DASHBOARD_AUTH_RESEND_API_KEY, or DASHBOARD_AUTH_DEBUG_MAGIC_LINK=true. ' +
      'Run scripts/saio-init.ps1 for guided setup.'
  )
}

/**
 * Sends magic-link email via configured provider.
 * Throws su provider mancante o errori di invio. Caller deve gestire.
 */
export async function sendMagicLinkEmail(opts: MagicLinkEmailOpts): Promise<void> {
  return getSender().send(opts)
}
