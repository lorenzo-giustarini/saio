/**
 * V15.0 WS3+WS6 — Landing dopo invio magic-link.
 * Anti-enumeration: stesso messaggio per email allowed/unknown.
 * WS6: countdown 60s + Resend button (rate-limit aware).
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'

const COUNTDOWN_SECONDS = 60

type ResendStatus = null | 'success' | 'error' | 'rate_limited' | 'not_authorized'

export default function MagicLinkSentPage() {
  const [params] = useSearchParams()
  const email = params.get('email') || ''
  const purpose = params.get('purpose') || 'login'

  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS)
  const [resending, setResending] = useState(false)
  const [resendStatus, setResendStatus] = useState<ResendStatus>(null)

  useEffect(() => {
    if (secondsLeft <= 0) return
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000)
    return () => window.clearTimeout(t)
  }, [secondsLeft])

  const title =
    purpose === 'claim'
      ? 'Check your inbox to claim'
      : purpose === 'invite'
      ? 'Invitation sent — check your inbox'
      : 'Check your inbox'

  const canResend = secondsLeft <= 0 && !resending && email
  const progress = ((COUNTDOWN_SECONDS - secondsLeft) / COUNTDOWN_SECONDS) * 100

  async function handleResend() {
    if (!canResend) return
    setResending(true)
    setResendStatus(null)
    try {
      // Solo per purpose='login' ha senso il resend (claim usa /api/auth/claim/start
      // che richiede il token + email — non gestiamo qui).
      if (purpose !== 'login') {
        setResendStatus('error')
        return
      }
      await api.auth.requestLink(email)
      setResendStatus('success')
      setSecondsLeft(COUNTDOWN_SECONDS) // restart countdown
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
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full p-6 border border-border rounded-lg bg-card text-center space-y-4">
        <div className="text-5xl">📬</div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {email ? (
            <>
              If <span className="font-medium text-foreground">{email}</span> is authorized,
            </>
          ) : (
            'If this email is authorized,'
          )}{' '}
          a sign-in link has been sent. Expires in 15 minutes and can be used once.
        </p>

        <div className="pt-3 border-t border-border space-y-3">
          {secondsLeft > 0 ? (
            <>
              <div className="text-xs text-muted-foreground">
                Didn't receive it? You can resend in{' '}
                <span className="font-mono font-medium text-foreground">{secondsLeft}s</span>
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
              {resending ? 'Sending…' : 'Resend link'}
            </Button>
          )}

          {resendStatus === 'success' && (
            <div className="text-xs text-emerald-500">Link resent — check your inbox</div>
          )}
          {resendStatus === 'rate_limited' && (
            <div className="text-xs text-amber-500">
              Too many requests. Wait 15 minutes and retry from{' '}
              <a href="/login" className="underline">
                /login
              </a>
              .
            </div>
          )}
          {resendStatus === 'not_authorized' && (
            <div className="text-xs text-amber-500">Dashboard not yet bootstrapped.</div>
          )}
          {resendStatus === 'error' && (
            <div className="text-xs text-red-500">
              Could not resend. Try{' '}
              <a href="/login" className="underline">
                /login
              </a>{' '}
              again.
            </div>
          )}

          {purpose !== 'login' && (
            <div className="text-xs text-muted-foreground pt-2">
              For claim/invite resend, restart the flow from{' '}
              <a href={purpose === 'claim' ? '/claim' : '/login'} className="underline">
                {purpose === 'claim' ? '/claim?token=…' : '/login'}
              </a>
              .
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export { MagicLinkSentPage as MagicLinkSent }
