/**
 * V15.0 WS3-3B — TOTP verify page (post magic-link, user already enrolled).
 *
 * Toggle "Use a recovery code instead" per fallback in caso authenticator perso.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function VerifyTotpPage() {
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // V15.0 WS6 — Trusted device opt-in (default OFF)
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
        if (res.status === 401) setError(useRecovery ? 'Invalid recovery code.' : 'Invalid TOTP code.')
        else if (res.status === 429) setError('Too many attempts. Wait 15 minutes.')
        else if (res.status === 403) setError('IP temporarily banned for too many failed attempts.')
        else setError('Could not verify.')
        return
      }
      const data = (await res.json()) as { ok: boolean; redirect?: string; usedRecovery?: boolean }
      navigate(data.redirect || '/inbox', { replace: true })
    } catch {
      setError('Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full p-6 border border-border rounded-lg bg-card space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Two-factor verification</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {useRecovery
              ? 'Enter one of your recovery codes (single-use).'
              : 'Enter the 6-digit code from your authenticator app.'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">{useRecovery ? 'Recovery code' : '6-digit code'}</Label>
            <Input
              id="code"
              type="text"
              inputMode={useRecovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              maxLength={useRecovery ? 32 : 6}
              value={code}
              onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
              placeholder={useRecovery ? 'aaaa-bbbb-cccc-dddd' : '000000'}
              required
              disabled={submitting}
            />
          </div>
          {/* V15.0 WS6 — Trust this device */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <input
              type="checkbox"
              id="trust-device-verify"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              disabled={submitting}
            />
            <label htmlFor="trust-device-verify" className="text-sm cursor-pointer flex-1">
              Trust this device
            </label>
            <select
              value={trustDays}
              onChange={(e) =>
                setTrustDays(Number(e.target.value) as 1 | 3 | 7 | 15 | 30)
              }
              disabled={!trustDevice || submitting}
              className="text-xs bg-muted px-2 py-1 rounded border border-border disabled:opacity-40"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={15}>15 days</option>
              <option value={30}>30 days</option>
            </select>
          </div>
          {trustDevice && (
            <p className="text-xs text-muted-foreground">
              Skip 2FA on this browser for {trustDays} day{trustDays > 1 ? 's' : ''}.
            </p>
          )}

          {error && <div className="text-sm text-red-500">{error}</div>}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || (useRecovery ? code.length < 8 : code.length !== 6)}
          >
            {submitting ? 'Verifying…' : 'Verify and sign in'}
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
          {useRecovery ? 'Use authenticator app instead' : 'Use a recovery code instead'}
        </button>
      </div>
    </div>
  )
}

export { VerifyTotpPage as VerifyTotp }
