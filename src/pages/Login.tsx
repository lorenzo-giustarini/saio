/**
 * V15.0 WS3-3A — Login page (magic-link flow).
 *
 * Flow:
 *  1. Verifica claim status → se !claimed, redirect /claim (manca token)
 *  2. Form email entry → POST /api/auth/request-link
 *  3. Sempre redirect a /magic-sent (response identica per allowed/unknown email)
 */
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useClaimStatus } from '@/hooks/useClaimStatus'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const error = params.get('error')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data: status, isLoading, isError, refetch } = useClaimStatus()
  const { t } = useTranslation(['auth', 'common'])

  // V15.9 WS43 — splash "Starting backend" durante il cold-start del sidecar Tauri
  // (Express può richiedere 2-5s per bind :3031). useClaimStatus ora ha retry 10×.
  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <div className="text-muted-foreground text-sm">{t('common:app.starting_backend')}</div>
      </div>
    )
  }

  // Solo dopo 10 retry falliti mostriamo l'errore esplicito.
  if (isError || status === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md p-6 border border-destructive/30 rounded-lg bg-destructive/5">
          <h2 className="text-lg font-semibold text-destructive mb-2">{t('common:app.backend_unreachable_title')}</h2>
          <p
            className="text-sm text-muted-foreground mb-4"
            dangerouslySetInnerHTML={{ __html: t('common:app.backend_unreachable_body') }}
          />
          <button onClick={() => refetch()} className="text-sm underline text-primary">
            {t('common:app.retry')}
          </button>
        </div>
      </div>
    )
  }

  // Pre-bootstrap: redirect a /claim (anche se serve token URL — meglio segnalare)
  if (status && !status.claimed) {
    return <Navigate to="/claim" replace />
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api.auth.requestLink(email.trim())
      navigate(`/magic-sent?email=${encodeURIComponent(email.trim())}&purpose=login`, { replace: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('429')) setSubmitError(t('auth:login.errors.rate_limit'))
      else if (msg.includes('409')) setSubmitError(t('auth:login.errors.not_claimed'))
      else setSubmitError(t('auth:login.errors.generic'))
    } finally {
      setSubmitting(false)
    }
  }

  const errorBannerKeys: Record<string, string> = {
    link_expired: 'auth:login.errors.link_expired',
    not_authorized: 'auth:login.errors.not_authorized',
    invalid_link: 'auth:login.errors.invalid_link',
    session_revoked: 'auth:login.errors.session_revoked',
    invalid_token: 'auth:login.errors.invalid_token',
    server_error: 'auth:login.errors.server_error',
  }
  const errorMsg = error && errorBannerKeys[error] ? t(errorBannerKeys[error]) : null

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="max-w-md w-full p-5 sm:p-6 border border-border rounded-lg bg-card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold">{t('auth:login.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('auth:login.subtitle')}</p>
          </div>
          <LanguageSwitcher />
        </div>
        {errorMsg && (
          <div className="text-sm text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
            {errorMsg}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('auth:login.email_label')}</Label>
            <Input
              id="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder={t('auth:login.email_placeholder')}
              required
              autoComplete="email"
              disabled={submitting}
            />
          </div>
          {submitError && <div className="text-sm text-red-500">{submitError}</div>}
          <Button type="submit" className="w-full" disabled={submitting || !email.trim()}>
            {submitting ? t('auth:login.submitting') : t('auth:login.submit')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {t('auth:login.footer_hint')}
        </p>
      </div>
    </div>
  )
}

export { LoginPage as Login }
