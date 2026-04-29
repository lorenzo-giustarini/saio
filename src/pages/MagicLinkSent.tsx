/**
 * V15.0 WS3+WS6 — Landing dopo invio magic-link.
 * Anti-enumeration: stesso messaggio per email allowed/unknown.
 * WS6: countdown 60s + Resend button (rate-limit aware).
 * V15.9 WS43: i18n IT/EN/ES.
 */
import { useEffect, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

const COUNTDOWN_SECONDS = 60

type ResendStatus = null | 'success' | 'error' | 'rate_limited' | 'not_authorized'

export default function MagicLinkSentPage() {
  const [params] = useSearchParams()
  const email = params.get('email') || ''
  const purpose = params.get('purpose') || 'login'
  const { t } = useTranslation(['auth', 'common'])

  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [resending, setResending] = useState(false)
  const [resendStatus, setResendStatus] = useState<ResendStatus>(null)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const tm = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(tm)
  }, [secondsLeft])

  const canResend = secondsLeft <= 0 && !resending && email
  const progress = ((COUNTDOWN_SECONDS - secondsLeft) / COUNTDOWN_SECONDS) * 100

  async function handleResend() {
    if (!canResend) return
    setResending(true)
    setResendStatus(null)
    try {
      if (purpose !== 'login') {
        setResendStatus('error')
        return
      }
      await api.auth.requestLink(email)
      setResendStatus('success')
      setSecondsLeft(COUNTDOWN_SECONDS)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('429')) setResendStatus('rate_limited')
      else if (msg.includes('409')) setResendStatus('not_authorized')
      else setResendStatus('error')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="max-w-md w-full p-5 sm:p-6 border border-border rounded-lg bg-card text-center space-y-4">
        <div className="flex items-start justify-end -mb-2">
          <LanguageSwitcher />
        </div>
        <div className="text-4xl sm:text-5xl">📬</div>
        <h1 className="text-lg sm:text-xl font-semibold">{t('auth:magic_sent.title')}</h1>
        <p className="text-sm text-muted-foreground">
          <Trans
            t={t}
            i18nKey={purpose === 'claim' ? 'auth:magic_sent.body_claim' : 'auth:magic_sent.body_login'}
            values={{ email }}
            components={{ strong: <span className="font-medium text-foreground" /> }}
          />
        </p>
        <p className="text-xs text-muted-foreground">{t('auth:magic_sent.expires_hint')}</p>

        <div className="pt-3 border-t border-border space-y-3">
          {secondsLeft > 0 ? (
            <>
              <div className="text-xs text-muted-foreground break-words">
                <Trans
                  t={t}
                  i18nKey={'auth:magic_sent.countdown'}
                  defaults="Resend available in <strong>{{count}}s</strong>"
                  values={{ count: secondsLeft }}
                  components={{ strong: <span className="font-mono font-medium text-foreground whitespace-nowrap" /> }}
                />
              </div>
              <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-1000"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </>
          ) : (
            <Button
              type="button"
              onClick={handleResend}
              disabled={resending || !email || purpose !== 'login'}
              variant="outline"
              size="sm"
              className="w-full"
            >
              {resending ? t('auth:magic_sent.resending') : t('auth:magic_sent.resend_button')}
            </Button>
          )}

          {resendStatus === 'success' && (
            <div className="text-xs text-emerald-500">{t('auth:magic_sent.resend_success', { defaultValue: 'Link resent — check your inbox.' })}</div>
          )}
          {resendStatus === 'rate_limited' && (
            <div className="text-xs text-amber-500">{t('auth:login.errors.rate_limit')}</div>
          )}
          {resendStatus === 'not_authorized' && (
            <div className="text-xs text-amber-500">{t('auth:login.errors.not_claimed')}</div>
          )}
          {resendStatus === 'error' && (
            <div className="text-xs text-red-500">{t('auth:login.errors.generic')}</div>
          )}

          <div className="text-xs text-muted-foreground">{t('auth:magic_sent.spam_hint')}</div>

          <a href="/login" className="block text-xs underline text-primary">
            {t('auth:magic_sent.back_to_login')}
          </a>
        </div>
      </div>
    </div>
  )
}

export { MagicLinkSentPage as MagicLinkSent }
