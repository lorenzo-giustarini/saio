/**
 * V15.0 WS10 — Hook per verificare dipendenze runtime.
 * Polling al primo mount post-claim (Inbox o Layout).
 */
import { useQuery } from '@tanstack/react-query'

export interface DepStatus {
  found: boolean
  version?: string
  category: 'CRITICAL' | 'CORE' | 'OPTIONAL'
  installCommand?: string
  installLink?: string
}

export interface DepsReport {
  os: string
  deps: Record<string, DepStatus>
  allCriticalOk: boolean
  missingCritical: string[]
}

export const DEPS_CHECK_KEY = ['system', 'deps-check'] as const

async function fetchDepsCheck(): Promise<DepsReport> {
  const res = await fetch('/api/system/deps-check', { credentials: 'include' })
  if (!res.ok) throw new Error(`deps-check ${res.status}`)
  return res.json()
}

export function useDepsCheck() {
  return useQuery({
    queryKey: DEPS_CHECK_KEY,
    queryFn: fetchDepsCheck,
    staleTime: 5 * 60_000,
    retry: false,
  })
}
