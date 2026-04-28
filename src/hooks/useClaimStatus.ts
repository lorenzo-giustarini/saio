import { useQuery } from '@tanstack/react-query'

export interface ClaimStatus {
  claimed: boolean
}

async function fetchClaimStatus(): Promise<ClaimStatus> {
  const res = await fetch('/api/auth/claim/status', { credentials: 'include' })
  if (!res.ok) throw new Error(`claim/status ${res.status}`)
  return res.json()
}

export function useClaimStatus() {
  return useQuery({
    queryKey: ['auth', 'claim-status'],
    queryFn: fetchClaimStatus,
    staleTime: 60_000,
    retry: false,
  })
}
