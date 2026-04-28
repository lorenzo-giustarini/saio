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
  // V15.9 WS43 — retry with backoff for backend boot race (Tauri sidecar
  // takes 2-5s to bind :3031 after window opens). 10 retries × 2s = 20s
  // tolerance which covers the slowest cold start observed.
  return useQuery({
    queryKey: ['auth', 'claim-status'],
    queryFn: fetchClaimStatus,
    staleTime: 60_000,
    retry: 10,
    retryDelay: (attempt) => Math.min(2000, 500 + attempt * 200),
  })
}
