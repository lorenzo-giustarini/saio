import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface MeResponse {
  email: string
  role: 'owner' | 'guest'
  sid: string
  authBypass: boolean
}

export const AUTH_ME_KEY = ['auth', 'me'] as const

async function fetchMe(): Promise<MeResponse> {
  const res = await fetch('/api/auth/me', { credentials: 'include' })
  if (!res.ok) {
    if (res.status === 401) throw new Error('unauthenticated')
    throw new Error(`auth/me ${res.status}`)
  }
  return res.json()
}

export function useMe() {
  return useQuery({
    queryKey: AUTH_ME_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok && res.status !== 401) throw new Error(`logout ${res.status}`)
      return true
    },
    onSettled: () => {
      qc.clear()
      window.location.href = '/login'
    },
  })
}
