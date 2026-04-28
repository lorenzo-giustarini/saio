/**
 * V15.0 WS3-3G + WS7 — Claim page con onboarding wizard email.
 *
 * Flow:
 *  1. Read ?token= from URL
 *  2. Query setupStatus → se !configured && !claimed → wizard auto-open
 *  3. Query claimStatus → se claimed=true → AlreadyClaimedPage
 *  4. Email entry form. Submit → POST /api/auth/claim/start
 *
 * V15.9 WS43: i18n IT/EN/ES.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { useSetupStatus, SETUP_STATUS_KEY } from '@/hooks/useSetupStatus'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmailProviderWizard } from '@/components/auth/EmailProviderWizard'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export default function ClaimPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const token = (searchParams.get('token') || '').trim()
  const { t } = useTranslation(['auth', 'common'])
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [skipped, setSkipped] = useState(false)

  const { data: setupStatus, isLoading } = useSetupStatus()

  // Auto-open wizard at first mount if !configured && !claimed && !skipped
  useEffect(() => {
    if (!setupStatus) return
    if (setupStatus.claimed) return
    if (!setupStatus.configured && !skipped) {
      setWizardOpen(true)
    }
  }, [setupStatus, skipped])

  useEffect(() => {
    setError(null)
  }, [email])

  const showSetupWarning = useMemo(
    () => setupStatus && !setupStatus.configured && !setupStatus.claimed && skipped,
    [setupStatus, skipped]
  )

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">{t('common:actions.loading')}</div>
      </div>
    )
  }

  if (setupStatus?.claimed) {
    return <AlreadyClaimedPage />
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
        <div className="max-w-md w-full p-5 sm:p-6 border border-border rounded-lg bg-card">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h1 className="text-lg sm:text-xl font-semibold">
              {t('auth:claim.error_missing_token_title', { defaultValue: 'Missing claim token' })}
            </h1>
            <LanguageSwitcher />
          </div>
          <p
            className="text-sm text-muted-foreground"
            dangerouslySetInnerHTML={{
              __html: t('auth:claim.error_missing_token_body', {
                defaultValue:
                  'The claim URL must include <code>?token=…</code>. Check the server stdout banner or <code>data/auth/CLAIM-TOKEN.txt</code>.',
              }),
            }}
          />
        </div>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      setError(t('common:errors.invalid_email'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await api.auth.claimStart(token, email.trim())
      navigate(`/magic-sent?email=${encodeURIComponent(email.trim())}&purpose=claim`, {
        replace: true,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('410')) setError(t('auth:claim.error_already_claimed'))
      else if (msg.includes('400')) setError(t('auth:claim.error_invalid_token'))
      else if (msg.includes('429')) setError(t('common:errors.rate_limit'))
      else if (msg.includes('422')) {
        const bodyMatch = msg.match(/^422:\s*(.+)$/s)
        if (bodyMatch && bodyMatch[1]) {
          try {
            const parsed = JSON.parse(bodyMatch[1]) as { message?: string }
            setError(parsed.message || t('auth:claim.error_smtp_failed'))
          } catch {
            setError(t('auth:claim.error_smtp_failed'))
          }
        } else {
          setError(t('auth:claim.error_smtp_failed'))
        }
      } else if (msg.includes('503')) setError(t('auth:claim.error_smtp_unreachable', { defaultValue: 'SMTP server unreachable. Try again in a few minutes.' }))
      else if (msg.includes('500')) setError(t('auth:claim.error_email_send_failed', { defaultValue: 'Email send failed. Open "Setup email" below to configure the provider.' }))
      else setError(t('common:errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
        <div className="max-w-md w-full p-5 sm:p-6 border border-border rounded-lg bg-card space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold">{t('auth:claim.title')}</h1>
              <p className="text-sm text-muted-foreground mt-1">{t('auth:claim.subtitle')}</p>
            </div>
            <LanguageSwitcher />
          </div>

          {showSetupWarning && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
              {t('auth:claim.smtp_not_configured_warning', {
                defaultValue:
                  'Email provider not yet configured. Without setup, the magic link won\'t be sent.',
              })}{' '}
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="underline font-medium"
              >
                {t('auth:claim.open_setup', { defaultValue: 'Open setup →' })}
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth:claim.email_label')}</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder={t('auth:claim.email_placeholder')}
                required
                autoComplete="email"
                disabled={submitting}
              />
              {setupStatus?.provider === 'smtp' && (
                <p className="text-xs text-muted-foreground">
                  💡 {t('auth:claim.smtp_recipient_hint', {
                    defaultValue:
                      'If you use your own domain SMTP, the recipient email must be a mailbox on the same domain. Hosting providers don\'t open-relay to external domains.',
                  })}
                </p>
              )}
            </div>
            {error && (
              <div className="text-sm text-red-500 whitespace-pre-line bg-red-500/5 border border-red-500/20 rounded-md p-3">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t('auth:claim.submitting') : t('auth:claim.submit')}
            </Button>
          </form>

          <div className="flex items-center justify-between pt-3 border-t border-border gap-2">
            <p className="text-xs text-muted-foreground flex-1">
              {t('auth:claim.expires_hint', {
                defaultValue: 'The link expires in 15 minutes. Once claimed, this page is permanently disabled.',
              })}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWizardOpen(true)}
              className="shrink-0"
            >
              <Settings2 className="w-3.5 h-3.5 mr-1" />
              {t('auth:claim.setup_email_button', { defaultValue: 'Setup email' })}
            </Button>
          </div>
        </div>
      </div>

      <EmailProviderWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onConfigured={() => {
          setWizardOpen(false)
          setSkipped(false)
          qc.invalidateQueries({ queryKey: SETUP_STATUS_KEY })
        }}
        onSkip={() => {
          setSkipped(true)
          setWizardOpen(false)
        }}
      />
    </>
  )
}

function AlreadyClaimedPage() {
  const { t } = useTranslation(['auth'])
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="max-w-md w-full p-5 sm:p-6 border border-border rounded-lg bg-card text-center space-y-3">
        <h1 className="text-lg sm:text-xl font-semibold">
          {t('auth:claim.already_claimed_title', { defaultValue: 'Already configured' })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('auth:claim.already_claimed_body', {
            defaultValue: 'This dashboard has already been set up. The claim flow is permanently disabled.',
          })}
        </p>
        <p className="text-sm">
          <a href="/login" className="text-primary underline">
            {t('auth:claim.go_to_login', { defaultValue: 'Go to sign in →' })}
          </a>
        </p>
      </div>
    </div>
  )
}

export { ClaimPage as Claim }
void Navigate
