/**
 * V15.0 WS3-3B — TOTP verify page (post magic-link, user already enrolled).
 *
 * Toggle "Use a recovery code instead" per fallback in caso authenticator perso.
 * V15.9 WS43: i18n IT/EN/ES.
 */
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

export default function VerifyTotpPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['auth', 'common'])
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [trustDevice, setTrustDevice] = useState(false)
  const [trustDays, setTrustDays] = useState<1 | 3 | 7 | 15 | 30>(7)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/totp/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim(),
          trustDevice,
          trustDays: trustDevice ? trustDays : undefined,
        }),
      })
      if (!res.ok) {
        if (res.status === 401) setError(t('auth:totp.errors.invalid_code'))
        else if (res.status === 429) setError(t('auth:totp.errors.lockout'))
        else if (res.status === 403) setError(t('auth:totp.errors.lockout'))
        else setError(t('common:errors.generic'))
        return
      }
      const data = (await res.json()) as { ok: boolean; redirect?: string; usedRecovery?: boolean }
      navigate(data.redirect || '/inbox', { replace: true })
    } catch {
      setError(t('common:errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="max-w-md w-full p-5 sm:p-6 border border-border rounded-lg bg-card space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h1 className="text-lg sm:text-xl font-semibold">{t('auth:totp.verify_title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {useRecovery
                ? t('auth:totp.verify_subtitle_recovery', { defaultValue: 'Enter one of your single-use recovery codes.' })
                : t('auth:totp.verify_subtitle')}
            </p>
          </div>
          <LanguageSwitcher />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">
              {useRecovery
                ? t('auth:totp.recovery_code_label', { defaultValue: 'Recovery code' })
                : t('auth:totp.code_label')}
            </Label>
            <Input
              id="code"
              type="text"
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={useRecovery ? 32 : 6}
              value={code}
              onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
              placeholder={useRecovery ? 'aaaa-bbbb-cccc-dddd' : t('auth:totp.code_placeholder')}
              required
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-border">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                type="checkbox"
                id="trust-device-verify"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                disabled={submitting}
              />
              <label htmlFor="trust-device-verify" className="text-sm cursor-pointer flex-1 min-w-0">
                {t('auth:totp.trust_device', { defaultValue: 'Trust this device' })}
              </label>
            </div>
            <select
              value={trustDays}
              onChange={(e) =>
                setTrustDays(Number(e.target.value) as 1 | 3 | 7 | 15 | 30)
              }
              disabled={!trustDevice || submitting}
              className="text-xs bg-muted px-2 py-2 sm:py-1 rounded border border-border disabled:opacity-40 w-full sm:w-auto"
            >
              <option value={1}>{t('auth:totp.trust_days_1', { defaultValue: '1 day' })}</option>
              <option value={3}>{t('auth:totp.trust_days_3', { defaultValue: '3 days' })}</option>
              <option value={7}>{t('auth:totp.trust_days_7', { defaultValue: '7 days' })}</option>
              <option value={15}>{t('auth:totp.trust_days_15', { defaultValue: '15 days' })}</option>
              <option value={30}>{t('auth:totp.trust_days_30', { defaultValue: '30 days' })}</option>
            </select>
          </div>
          {trustDevice && (
            <p className="text-xs text-muted-foreground">
              {t('auth:totp.trust_hint', {
                count: trustDays,
                defaultValue_one: 'Skip 2FA on this browser for {{count}} day.',
                defaultValue_other: 'Skip 2FA on this browser for {{count}} days.',
              })}
            </p>
          )}

          {error && <div className="text-sm text-red-500">{error}</div>}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || (useRecovery ? code.length < 8 : code.length !== 6)}
          >
            {submitting ? t('auth:totp.verifying') : t('auth:totp.verify_button_login')}
          </Button>
        </form>
        <button
          type="button"
          onClick={() => {
            setUseRecovery((r) => !r)
            setCode('')
            setError(null)
          }}
          className="w-full text-xs text-muted-foreground underline"
        >
          {useRecovery
            ? t('auth:totp.use_authenticator', { defaultValue: 'Use authenticator app instead' })
            : t('auth:totp.use_recovery')}
        </button>
      </div>
    </div>
  )
}

export { VerifyTotpPage as VerifyTotp }
