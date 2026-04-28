/**
 * V15.0 WS3-3A — Login page (magic-link flow).
 *
 * Flow:
 *  1. Verifica claim status → se !claimed, redirect /claim (manca token)
 *  2. Form email entry → POST /api/auth/request-link
 *  3. Sempre redirect a /magic-sent (response identica per allowed/unknown email)
 */
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useClaimStatus } from '@/hooks/useClaimStatus'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const error = params.get('error')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data: status, isLoading } = useClaimStatus()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
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
      if (msg.includes('429')) setSubmitError('Too many requests. Please wait 15 minutes.')
      else if (msg.includes('409')) setSubmitError('Dashboard not yet claimed. Visit /claim?token=…')
      else setSubmitError('Could not send link. Try again in a moment.')
    } finally {
      setSubmitting(false)
    }
  }

  const errorBanner: Record<string, string> = {
    link_expired: 'The previous link expired. Request a new one below.',
    not_authorized: 'This email is no longer authorized.',
    invalid_link: 'Invalid sign-in link.',
    session_revoked: 'Session revoked. Sign in again.',
    invalid_token: 'Session expired. Sign in again.',
    server_error: 'Server error. Try again.',
  }
  const errorMsg = error && errorBanner[error]

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full p-6 border border-border rounded-lg bg-card space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter your email to receive a sign-in link.
          </p>
        </div>
        {errorMsg && (
          <div className="text-sm text-amber-500 bg-amber-500/10 border border-amber-500/30 rounded-md p-3">
            {errorMsg}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
              disabled={submitting}
            />
          </div>
          {submitError && <div className="text-sm text-red-500">{submitError}</div>}
          <Button type="submit" className="w-full" disabled={submitting || !email.trim()}>
            {submitting ? 'Sending link…' : 'Send sign-in link'}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          The link expires in 15 minutes and can be used once. If your email is not authorized, no email will be sent.
        </p>
      </div>
    </div>
  )
}

export { LoginPage as Login }
