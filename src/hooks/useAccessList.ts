import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface AccessEntry {
  email: string
  role: 'owner' | 'guest'
  invitedAt: string
  invitedBy?: string
  totpEnrolledAt: string | null
}

export const ACCESS_LIST_KEY = ['admin', 'access'] as const

export function useAccessList() {
  return useQuery({
    queryKey: ACCESS_LIST_KEY,
    queryFn: async () => {
      const res = await fetch('/api/admin/access', { credentials: 'include' })
      if (!res.ok) throw new Error(`access list ${res.status}`)
      return (await res.json()) as { entries: AccessEntry[] }
    },
  })
}

export function useInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch('/api/admin/access/invite', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`invite ${res.status}: ${txt}`)
      }
      return (await res.json()) as { ok: boolean; email: string; warning?: string }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCESS_LIST_KEY }),
  })
}

export function useRevoke() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`/api/admin/access/${encodeURIComponent(email)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`revoke ${res.status}: ${txt}`)
      }
      return (await res.json()) as { ok: boolean; email: string; sessionsRevoked: number }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ACCESS_LIST_KEY }),
  })
}
