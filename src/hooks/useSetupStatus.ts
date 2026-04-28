import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const SETUP_STATUS_KEY = ['auth', 'setup-status'] as const

export function useSetupStatus() {
  return useQuery({
    queryKey: SETUP_STATUS_KEY,
    queryFn: () => api.auth.setupStatus(),
    staleTime: 30_000,
    retry: false,
  })
}
