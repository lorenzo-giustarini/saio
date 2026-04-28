import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useBriefs() {
  return useQuery({
    queryKey: ['briefs'],
    queryFn: () => api.briefs.list(),
    refetchInterval: 60_000, // 1 min: SSE handles instant updates
    staleTime: 30_000,
  })
}

export function useBrief(id: string | undefined) {
  return useQuery({
    queryKey: ['brief', id],
    queryFn: () => api.briefs.get(id!),
    enabled: !!id,
  })
}
