/**
 * V15.0 WS3-3B — TOTP enrollment page.
 *
 * Mounted dopo magic-link verify (server emette saio_pending cookie).
 * V15.9 WS43: i18n IT/EN/ES.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'

interface EnrollResponse {
  qrCodeDataUrl: string
  recoveryCodes: string[]
  email: string
}

export default function EnrollTotpPage() {
  const navigate = useNavigate()
  const { t } = useTranslation(['auth', 'common'])
  const [enroll, setEnroll] = useState<EnrollResponse | null>(null)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [trustDevice, setTrustDevice] = useState(false)
  const [trustDays, setTrustDays] = useState<1 | 3 | 7 | 15 | 30>(7)

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const res = await fetch('/api/auth/totp/enroll', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })
        if (!res.ok) {
          if (res.status === 401) {
            setEnrollError(t('common:errors.session_expired'))
          } else if (res.status === 409) {
            setEnrollError(t('auth:totp.errors.already_enrolled', { defaultValue: 'TOTP already enrolled. Go to /verify-totp to sign in.' }))
          } else {
            setEnrollError(t('auth:totp.errors.enrollment_unavailable'))
          }
          return
        }
        const data = (await res.json()) as EnrollResponse
        if (!cancelled) setEnroll(data)
      } catch {
        if (!cancelled) setEnrollError(t('common:errors.network'))
      }
    }
    void init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function downloadRecoveryCodes() {
    if (!enroll) return
    const txt =
      `SAIO Dashboard — recovery codes for ${enroll.email}\n` +
      `Generated: ${new Date().toISOString()}\n\n` +
      enroll.recoveryCodes.map((c, i) => `${(i + 1).toString().padStart(2, '0')}. ${c}`).join('\n') +
      `\n\nKeep these codes safe. Each code can be used once if you lose your authenticator.\n`
    const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `saio-recovery-codes-${enroll.email}.txt`
    a.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)
  }

  async function copyCodes() {
    if (!enroll) return
    await navigator.clipboard.writeText(enroll.recoveryCodes.join('\n'))
    setDownloaded(true)
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!code.trim() || !downloaded) return
    setSubmitting(true)
    setConfirmError(null)
    try {
      const res = await fetch('/api/auth/totp/enroll-confirm', {
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
        if (res.status === 401) setConfirmError(t('auth:totp.errors.invalid_code'))
        else if (res.status === 429 || res.status === 403) setConfirmError(t('auth:totp.errors.lockout'))
        else setConfirmError(t('common:errors.generic'))
        return
      }
      const data = (await res.json()) as { ok: boolean; redirect?: string }
      navigate(data.redirect || '/inbox', { replace: true })
    } catch {
      setConfirmError(t('common:errors.network'))
    } finally {
      setSubmitting(false)
    }
  }

  if (enrollError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
        <div className="max-w-md w-full p-5 sm:p-6 border border-border rounded-lg bg-card text-center space-y-3">
          <div className="flex items-start justify-end">
            <LanguageSwitcher />
          </div>
          <h1 className="text-lg sm:text-xl font-semibold">
            {t('auth:totp.enrollment_unavailable_title', { defaultValue: 'TOTP enrollment unavailable' })}
          </h1>
          <p className="text-sm text-muted-foreground">{enrollError}</p>
          <a href="/login" className="text-sm text-primary underline">
            {t('auth:totp.restart_signin', { defaultValue: 'Restart sign-in' })}
          </a>
        </div>
      </div>
    )
  }

  if (!enroll) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">{t('auth:totp.generating_qr', { defaultValue: 'Generating QR…' })}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 sm:p-6">
      <div className="max-w-xl w-full p-5 sm:p-6 border border-border rounded-lg bg-card space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-lg sm:text-xl font-semibold">{t('auth:totp.setup_title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('auth:totp.setup_subtitle')}</p>
          </div>
          <LanguageSwitcher />
        </div>

        <div className="flex justify-center bg-white p-3 rounded-md">
          <img src={enroll.qrCodeDataUrl} alt={t('auth:totp.qr_label')} className="w-48 h-48 sm:w-56 sm:h-56" />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm">
              {t('auth:totp.recovery_codes_label', { defaultValue: 'Recovery codes (10)' })}
            </Label>
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="text-xs text-muted-foreground underline"
            >
              {reveal
                ? t('auth:totp.hide_codes', { defaultValue: 'Hide' })
                : t('auth:totp.show_codes', { defaultValue: 'Show' })}
            </button>
          </div>
          {reveal && (
            <div className="bg-muted p-3 rounded-md font-mono text-xs grid grid-cols-1 sm:grid-cols-2 gap-1 break-all">
              {enroll.recoveryCodes.map((c, i) => (
                <div key={i}>
                  <span className="text-muted-foreground">{(i + 1).toString().padStart(2, '0')}.</span> {c}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('auth:totp.recovery_body')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadRecoveryCodes}>
              {t('auth:totp.recovery_download')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
              {t('auth:totp.recovery_copy', { defaultValue: 'Copy to clipboard' })}
            </Button>
          </div>
          <label className="flex items-center gap-2 pt-2 text-sm">
            <input
              type="checkbox"
              checked={downloaded}
              onChange={(e) => setDownloaded(e.target.checked)}
            />
            <span>{t('auth:totp.recovery_continue')}</span>
          </label>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <Label htmlFor="totp">{t('auth:totp.code_label')}</Label>
            <Input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder={t('auth:totp.code_placeholder')}
              required
              disabled={submitting}
            />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-2 border-t border-border">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <input
                type="checkbox"
                id="trust-device-enroll"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                disabled={submitting}
              />
              <label htmlFor="trust-device-enroll" className="text-sm cursor-pointer flex-1 min-w-0">
                {t('auth:totp.trust_device')}
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
              <option value={1}>{t('auth:totp.trust_days_1')}</option>
              <option value={3}>{t('auth:totp.trust_days_3')}</option>
              <option value={7}>{t('auth:totp.trust_days_7')}</option>
              <option value={15}>{t('auth:totp.trust_days_15')}</option>
              <option value={30}>{t('auth:totp.trust_days_30')}</option>
            </select>
          </div>
          {trustDevice && (
            <p className="text-xs text-muted-foreground">
              {t('auth:totp.trust_hint', { count: trustDays })}
            </p>
          )}

          {confirmError && <div className="text-sm text-red-500">{confirmError}</div>}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || code.length !== 6 || !downloaded}
          >
            {submitting ? t('auth:totp.verifying') : t('auth:totp.verify_button')}
          </Button>
        </form>
      </div>
    </div>
  )
}

export { EnrollTotpPage as EnrollTotp }
