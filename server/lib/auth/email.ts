/**
 * V15.0 WS6 — Email sender multi-provider.
 * V15.9 WS43 — i18n IT/EN/ES support via opts.locale.
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

export type EmailLocale = 'it' | 'en' | 'es'
export const SUPPORTED_EMAIL_LOCALES: readonly EmailLocale[] = ['it', 'en', 'es'] as const

export interface MagicLinkEmailOpts {
  to: string
  link: string
  purpose: 'login' | 'claim' | 'invite'
  expiresInMinutes: number
  /** Lingua del messaggio. Default 'en'. */
  locale?: EmailLocale
}

/** Picks a supported locale from an Accept-Language header or a cookie value. */
export function pickEmailLocale(input: string | undefined | null, fallback: EmailLocale = 'en'): EmailLocale {
  if (!input) return fallback
  const normalized = input.toLowerCase().split(/[,;]/)[0]?.split('-')[0]?.trim()
  if (normalized && (SUPPORTED_EMAIL_LOCALES as readonly string[]).includes(normalized)) {
    return normalized as EmailLocale
  }
  return fallback
}

interface EmailStrings {
  subject: { login: string; claim: string; invite: string }
  heading: string
  greeting: string
  body: { login: string; claim: string; invite: string }
  buttonLabel: string
  fallbackHelp: string
  ignoreFooter: string
  textBody: (link: string, expiresMin: number) => string
}

const EMAIL_STRINGS: Record<EmailLocale, EmailStrings> = {
  it: {
    subject: {
      login: 'SAIO Dashboard — link di accesso',
      claim: 'SAIO Dashboard — completa la configurazione',
      invite: 'SAIO Dashboard — sei stato invitato',
    },
    heading: 'SAIO Dashboard',
    greeting: 'Ciao,',
    body: {
      login: 'clicca sul pulsante qui sotto per accedere alla tua dashboard. Il link scade tra {{minutes}} minuti e può essere usato una sola volta.',
      claim: 'clicca sul pulsante qui sotto per completare la configurazione della tua dashboard. Il link scade tra {{minutes}} minuti e può essere usato una sola volta.',
      invite: 'clicca sul pulsante qui sotto per accedere alla dashboard a cui sei stato invitato. Il link scade tra {{minutes}} minuti e può essere usato una sola volta.',
    },
    buttonLabel: 'Continua',
    fallbackHelp: 'Se il pulsante non funziona, copia questo URL nel browser:',
    ignoreFooter: 'Se non hai richiesto tu questo accesso, puoi ignorare questa email.',
    textBody: (link, mins) => `SAIO Dashboard\n\nLink (scade tra ${mins} min, monouso):\n${link}\n\nSe non hai richiesto tu questo accesso, ignora pure questa email.`,
  },
  en: {
    subject: {
      login: 'SAIO Dashboard — sign-in link',
      claim: 'SAIO Dashboard — finish setup',
      invite: 'SAIO Dashboard — you have been invited',
    },
    heading: 'SAIO Dashboard',
    greeting: 'Hi there,',
    body: {
      login: 'click the button below to sign in to your dashboard. The link expires in {{minutes}} minutes and can be used once.',
      claim: 'click the button below to finish setting up your dashboard. The link expires in {{minutes}} minutes and can be used once.',
      invite: 'click the button below to access the dashboard you were invited to. The link expires in {{minutes}} minutes and can be used once.',
    },
    buttonLabel: 'Continue',
    fallbackHelp: "If the button doesn't work, copy this URL into your browser:",
    ignoreFooter: "If you didn't request this, you can safely ignore this email.",
    textBody: (link, mins) => `SAIO Dashboard\n\nLink (expires in ${mins} min, single-use):\n${link}\n\nIf you didn't request this, you can safely ignore this email.`,
  },
  es: {
    subject: {
      login: 'SAIO Dashboard — enlace de acceso',
      claim: 'SAIO Dashboard — finaliza la configuración',
      invite: 'SAIO Dashboard — has sido invitado',
    },
    heading: 'SAIO Dashboard',
    greeting: 'Hola,',
    body: {
      login: 'haz clic en el botón de abajo para acceder a tu dashboard. El enlace caduca en {{minutes}} minutos y solo se puede usar una vez.',
      claim: 'haz clic en el botón de abajo para terminar la configuración de tu dashboard. El enlace caduca en {{minutes}} minutos y solo se puede usar una vez.',
      invite: 'haz clic en el botón de abajo para acceder a la dashboard a la que te han invitado. El enlace caduca en {{minutes}} minutos y solo se puede usar una vez.',
    },
    buttonLabel: 'Continuar',
    fallbackHelp: 'Si el botón no funciona, copia esta URL en tu navegador:',
    ignoreFooter: 'Si no has solicitado este acceso, puedes ignorar este correo.',
    textBody: (link, mins) => `SAIO Dashboard\n\nEnlace (caduca en ${mins} min, un solo uso):\n${link}\n\nSi no has solicitado este acceso, puedes ignorar este correo.`,
  },
}

function getStrings(locale: EmailLocale | undefined): EmailStrings {
  return EMAIL_STRINGS[locale && EMAIL_STRINGS[locale] ? locale : 'en']
}

function buildSubject(purpose: MagicLinkEmailOpts['purpose'], locale?: EmailLocale): string {
  return getStrings(locale).subject[purpose]
}

function buildHtml(opts: MagicLinkEmailOpts): string {
  const s = getStrings(opts.locale)
  const body = s.body[opts.purpose].replace('{{minutes}}', String(opts.expiresInMinutes))
  return `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0a0a0a;color:#e5e5e5;padding:40px;">
  <div style="max-width:520px;margin:0 auto;background:#171717;border:1px solid #262626;border-radius:8px;padding:32px;">
    <h2 style="margin:0 0 16px 0;font-weight:600;">${s.heading}</h2>
    <p>${s.greeting}</p>
    <p>${body}</p>
    <p style="margin:24px 0;"><a href="${opts.link}" style="display:inline-block;background:#10b981;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">${s.buttonLabel}</a></p>
    <p style="font-size:13px;color:#737373;">${s.fallbackHelp}</p>
    <p style="font-size:12px;color:#a3a3a3;word-break:break-all;">${opts.link}</p>
    <hr style="border:none;border-top:1px solid #262626;margin:24px 0;" />
    <p style="font-size:12px;color:#737373;">${s.ignoreFooter}</p>
  </div>
</body></html>`
}

function buildText(opts: MagicLinkEmailOpts): string {
  const s = getStrings(opts.locale)
  return s.textBody(opts.link, opts.expiresInMinutes)
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
    logger.info(`  [DEBUG] MAGIC LINK (${opts.purpose}, locale=${opts.locale || 'en'}) for: ${opts.to}`)
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
      secure: port === 465,
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
      subject: buildSubject(opts.purpose, opts.locale),
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
      subject: buildSubject(opts.purpose, opts.locale),
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

export function clearSenderCache(): void {
  cachedSender = null
}

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
 */
export async function sendMagicLinkEmail(opts: MagicLinkEmailOpts): Promise<void> {
  return getSender().send(opts)
}
