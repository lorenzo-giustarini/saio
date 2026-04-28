/**
 * V15.0 WS3-3B — TOTP enrollment page.
 *
 * Mounted dopo magic-link verify (server emette saio_pending cookie).
 * Flow:
 *  1. POST /api/auth/totp/enroll → riceve {qrCodeDataUrl, recoveryCodes plaintext}
 *  2. Mostra QR + recovery codes (con download .txt + copy)
 *  3. User scansiona QR con Google Authenticator/Authy/etc.
 *  4. User checkbox "I downloaded my recovery codes" required
 *  5. Input 6-digit code → POST /api/auth/totp/enroll-confirm
 *  6. Success → navigate /inbox
 */
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface EnrollResponse {
  qrCodeDataUrl: string
  recoveryCodes: string[]
  email: string
}

export default function EnrollTotpPage() {
  const navigate = useNavigate()
  const [enroll, setEnroll] = useState<EnrollResponse | null>(null)
  const [enrollError, setEnrollError] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [reveal, setReveal] = useState(false)
  // V15.0 WS6 — Trusted device opt-in (default OFF)
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
            setEnrollError('Session expired. Restart sign-in from /login.')
          } else if (res.status === 409) {
            setEnrollError('TOTP already enrolled. Go to /verify-totp to sign in.')
          } else {
            setEnrollError('Could not start TOTP enrollment.')
          }
          return
        }
        const data = (await res.json()) as EnrollResponse
        if (!cancelled) setEnroll(data)
      } catch {
        if (!cancelled) setEnrollError('Network error.')
      }
    }
    void init()
    return () => {
      cancelled = true
    }
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
        if (res.status === 401) setConfirmError('Invalid code. Open your authenticator app and try the current code.')
        else if (res.status === 429) setConfirmError('Too many attempts. Wait 15 minutes.')
        else if (res.status === 403) setConfirmError('Too many failed attempts — IP temporarily banned.')
        else setConfirmError('Could not confirm enrollment.')
        return
      }
      const data = (await res.json()) as { ok: boolean; redirect?: string }
      navigate(data.redirect || '/inbox', { replace: true })
    } catch {
      setConfirmError('Network error.')
    } finally {
      setSubmitting(false)
    }
  }

  if (enrollError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full p-6 border border-border rounded-lg bg-card text-center space-y-3">
          <h1 className="text-xl font-semibold">TOTP enrollment unavailable</h1>
          <p className="text-sm text-muted-foreground">{enrollError}</p>
          <a href="/login" className="text-sm text-primary underline">
            Restart sign-in
          </a>
        </div>
      </div>
    )
  }

  if (!enroll) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Generating QR…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-xl w-full p-6 border border-border rounded-lg bg-card space-y-5">
        <div>
          <h1 className="text-xl font-semibold">Enable two-factor authentication</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scan the QR with Google Authenticator, Authy, or any TOTP app. Then enter the 6-digit code below.
          </p>
        </div>

        <div className="flex justify-center bg-white p-3 rounded-md">
          <img src={enroll.qrCodeDataUrl} alt="TOTP QR code" className="w-56 h-56" />
        </div>

        <div className="space-y-2 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Recovery codes (10)</Label>
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="text-xs text-muted-foreground underline"
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
          </div>
          {reveal && (
            <div className="bg-muted p-3 rounded-md font-mono text-xs grid grid-cols-2 gap-1">
              {enroll.recoveryCodes.map((c, i) => (
                <div key={i}>
                  <span className="text-muted-foreground">{(i + 1).toString().padStart(2, '0')}.</span> {c}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Save these codes somewhere safe. Each code works once if you lose your authenticator. They will NOT be shown again.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={downloadRecoveryCodes}>
              Download .txt
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
              Copy to clipboard
            </Button>
          </div>
          <label className="flex items-center gap-2 pt-2 text-sm">
            <input
              type="checkbox"
              checked={downloaded}
              onChange={(e) => setDownloaded(e.target.checked)}
            />
            <span>I have saved my recovery codes</span>
          </label>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 border-t border-border pt-4">
          <div className="space-y-2">
            <Label htmlFor="totp">6-digit code from your authenticator app</Label>
            <Input
              id="totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              required
              disabled={submitting}
            />
          </div>
          {/* V15.0 WS6 — Trust this device */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <input
              type="checkbox"
              id="trust-device-enroll"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              disabled={submitting}
            />
            <label htmlFor="trust-device-enroll" className="text-sm cursor-pointer flex-1">
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
              Skip 2FA on this browser for {trustDays} day{trustDays > 1 ? 's' : ''}. Sicuro
              solo su dispositivi personali. Logout o revoca admin annullano subito.
            </p>
          )}

          {confirmError && <div className="text-sm text-red-500">{confirmError}</div>}
          <Button
            type="submit"
            className="w-full"
            disabled={submitting || code.length !== 6 || !downloaded}
          >
            {submitting ? 'Verifying…' : 'Confirm and sign in'}
          </Button>
        </form>
      </div>
    </div>
  )
}

export { EnrollTotpPage as EnrollTotp }
