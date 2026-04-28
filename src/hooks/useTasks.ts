import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.tasks.list(),
    refetchInterval: 15_000, // SSE handles instant updates
    staleTime: 10_000,
  })
}

export function useTaskCommand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, type }: { id: string; type: 'pause' | 'resume' | 'kill' }) =>
      api.tasks.sendCommand(id, type),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
