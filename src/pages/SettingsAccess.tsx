/**
 * V15.0 WS3-3H — Settings/Access (owner-only).
 *
 * Tabella allowed-emails con invite/revoke. RequireOwner wrap garantisce solo
 * l'owner accede. Backend rifiuta non-owner via requireOwner middleware.
 */
import { useState, type FormEvent } from 'react'
import { useAccessList, useInvite, useRevoke, type AccessEntry } from '@/hooks/useAccessList'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function SettingsAccessPage() {
  const { data, isLoading, error } = useAccessList()
  const invite = useInvite()
  const revoke = useRevoke()
  const [email, setEmail] = useState('')
  const [inviteFeedback, setInviteFeedback] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setInviteFeedback(null)
    setInviteError(null)
    try {
      const result = await invite.mutateAsync(email.trim())
      setEmail('')
      if (result.warning) {
        setInviteFeedback(`Invited ${result.email}, ma email send fallito (controlla Resend setup).`)
      } else {
        setInviteFeedback(`Invitation sent to ${result.email}.`)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('409')) setInviteError('This email is already in the allowlist.')
      else if (msg.includes('400')) setInviteError('Invalid email format.')
      else setInviteError('Could not send invite.')
    }
  }

  async function handleRevoke(target: AccessEntry) {
    if (target.role === 'owner') return
    if (!confirm(`Revoke access for ${target.email}? Active sessions will be terminated immediately.`)) return
    try {
      await revoke.mutateAsync(target.email)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      alert(`Revoke failed: ${msg}`)
    }
  }

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Access management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Single-owner instance. You can invite or revoke guest emails. Revoking terminates all active sessions for that email immediately.
        </p>
      </div>

      <div className="border border-border rounded-lg bg-card p-4 space-y-3">
        <h2 className="text-sm font-semibold">Invite a guest</h2>
        <form onSubmit={handleInvite} className="flex gap-2 items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="friend@example.com"
              required
              disabled={invite.isPending}
            />
          </div>
          <Button type="submit" disabled={invite.isPending || !email.trim()}>
            {invite.isPending ? 'Sending…' : 'Invite'}
          </Button>
        </form>
        {inviteFeedback && <div className="text-sm text-emerald-500">{inviteFeedback}</div>}
        {inviteError && <div className="text-sm text-red-500">{inviteError}</div>}
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Allowed emails</h2>
        </div>
        {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
        {error && <div className="p-4 text-sm text-red-500">Error loading list.</div>}
        {data && data.entries.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">No entries yet.</div>
        )}
        {data && data.entries.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-4 py-2 font-medium">TOTP</th>
                <th className="px-4 py-2 font-medium">Invited</th>
                <th className="px-4 py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.email} className="border-t border-border">
                  <td className="px-4 py-3">{e.email}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        e.role === 'owner'
                          ? 'text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30'
                      }
                    >
                      {e.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {e.totpEnrolledAt ? (
                      <span className="text-emerald-400">enrolled</span>
                    ) : (
                      <span className="text-muted-foreground">pending</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(e.invitedAt).toLocaleDateString()}
                    {e.invitedBy && (
                      <span className="block text-muted-foreground/70">by {e.invitedBy}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {e.role === 'owner' ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevoke(e)}
                        disabled={revoke.isPending}
                      >
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export { SettingsAccessPage as SettingsAccess }
