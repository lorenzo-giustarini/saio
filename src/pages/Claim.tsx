/**
 * V15.0 WS3-3G + WS7 — Claim page con onboarding wizard email.
 *
 * Flow:
 *  1. Read ?token= from URL
 *  2. Query setupStatus → se !configured && !claimed → wizard auto-open
 *  3. Query claimStatus → se claimed=true → AlreadyClaimedPage
 *  4. Email entry form. Submit → POST /api/auth/claim/start
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Settings2 } from 'lucide-react'
import { useSetupStatus, SETUP_STATUS_KEY } from '@/hooks/useSetupStatus'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmailProviderWizard } from '@/components/auth/EmailProviderWizard'

export default function ClaimPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const token = (searchParams.get('token') || '').trim()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [skipped, setSkipped] = useState(false)

  const { data: setupStatus, isLoading } = useSetupStatus()

  // Auto-apri wizard al primo mount se !configured && !claimed && !skipped
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
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  if (setupStatus?.claimed) {
    return <AlreadyClaimedPage />
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full p-6 border border-border rounded-lg bg-card">
          <h1 className="text-xl font-semibold mb-2">Missing claim token</h1>
          <p className="text-sm text-muted-foreground">
            The claim URL must include <code className="bg-muted px-1 rounded">?token=…</code>.
            Check the server stdout banner or{' '}
            <code className="bg-muted px-1 rounded">data/auth/CLAIM-TOKEN.txt</code>.
          </p>
        </div>
      </div>
    )
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) {
      setError('Email is required.')
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
      if (msg.includes('410')) setError('This dashboard has already been claimed, or the token has expired.')
      else if (msg.includes('400')) setError('Invalid claim token. Verify the URL and retry.')
      else if (msg.includes('429')) setError('Troppi tentativi. Aspetta un\'ora e riprova.')
      // V15.0 WS8 — 422 = recipient rejected / sender rejected / quota / auth / etc.
      // Backend response include un message dettagliato; estrailo dal payload Error
      else if (msg.includes('422')) {
        // Format errore: "422: {json body}"
        const bodyMatch = msg.match(/^422:\s*(.+)$/s)
        if (bodyMatch && bodyMatch[1]) {
          try {
            const parsed = JSON.parse(bodyMatch[1]) as { message?: string }
            setError(parsed.message || 'Invio email rifiutato dal server SMTP.')
          } catch {
            setError('Invio email rifiutato dal server SMTP. Riconfigura il provider.')
          }
        } else {
          setError('Invio email rifiutato dal server SMTP. Riconfigura il provider.')
        }
      } else if (msg.includes('503')) setError('Server SMTP irraggiungibile. Riprova tra qualche minuto.')
      else if (msg.includes('500')) setError('Email send failed. Configura il provider email cliccando "Setup email" qui sotto.')
      else setError('Could not send claim email. Check server logs.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-md w-full p-6 border border-border rounded-lg bg-card space-y-4">
          <div>
            <h1 className="text-xl font-semibold">Claim this dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              You're the first user. Enter your email to become the owner. A magic link will be sent
              there.
            </p>
          </div>

          {showSetupWarning && (
            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300">
              Email provider non ancora configurato. Senza setup, il magic link non verrà inviato.{' '}
              <button
                type="button"
                onClick={() => setWizardOpen(true)}
                className="underline font-medium"
              >
                Apri setup →
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Owner email</Label>
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
              {/* V15.0 WS8 — Hint per provider SMTP non-relay */}
              {setupStatus?.provider === 'smtp' && (
                <p className="text-xs text-muted-foreground">
                  💡 Se usi SMTP del tuo dominio (es. ChemiCloud, Aruba, cPanel), l'email destinataria
                  deve essere una casella dello stesso dominio (es. <code className="bg-muted px-1 rounded">tu@tuodominio.com</code>).
                  I provider hosting non sono open-relay verso domini esterni.
                </p>
              )}
            </div>
            {error && (
              <div className="text-sm text-red-500 whitespace-pre-line bg-red-500/5 border border-red-500/20 rounded-md p-3">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Sending link…' : 'Send claim link'}
            </Button>
          </form>

          <div className="flex items-center justify-between pt-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              The link expires in 15 minutes. Once claimed, this page returns 410 Gone forever.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setWizardOpen(true)}
              className="shrink-0 ml-2"
            >
              <Settings2 className="w-3.5 h-3.5 mr-1" />
              Setup email
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
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full p-6 border border-border rounded-lg bg-card text-center space-y-3">
        <h1 className="text-xl font-semibold">Already claimed</h1>
        <p className="text-sm text-muted-foreground">
          This dashboard has been bootstrapped. The claim flow is permanently disabled.
        </p>
        <p className="text-sm">
          <a href="/login" className="text-primary underline">
            Go to login →
          </a>
        </p>
      </div>
    </div>
  )
}

export { ClaimPage as Claim }
void Navigate
