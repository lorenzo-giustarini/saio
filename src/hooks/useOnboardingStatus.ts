/**
 * V15.0 WS12 — Hook stato onboarding first-login.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export interface OnboardingChoices {
  obsidian?: 'have-it' | 'install-later' | 'skip'
  cloudflare?: 'now' | 'later' | 'skip'
  anthropicApi?: 'configured' | 'will-configure' | 'skip'
}

export interface OnboardingState {
  version: 1
  firstLoginCompletedAt: string | null
  choices: OnboardingChoices
}

export const ONBOARDING_KEY = ['onboarding', 'status'] as const

export function useOnboardingStatus() {
  return useQuery({
    queryKey: ONBOARDING_KEY,
    queryFn: async () => {
      const res = await fetch('/api/onboarding/status', { credentials: 'include' })
      if (!res.ok) throw new Error(`onboarding/status ${res.status}`)
      return (await res.json()) as OnboardingState
    },
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function usePatchChoices() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (choices: OnboardingChoices) => {
      const res = await fetch('/api/onboarding/choices', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choices),
      })
      if (!res.ok) throw new Error(`choices ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  })
}

export function useCompleteOnboarding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) throw new Error(`complete ${res.status}`)
      return res.json()
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ONBOARDING_KEY }),
  })
}

export function useSetVaultPath() {
  return useMutation({
    mutationFn: async (vaultPath: string) => {
      const res = await fetch('/api/onboarding/set-vault-path', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: vaultPath }),
      })
      if (!res.ok) {
        const txt = await res.text()
        throw new Error(`vault ${res.status}: ${txt}`)
      }
      return res.json()
    },
  })
}

export function useSetAnthropicKey() {
  return useMutation({
    mutationFn: async (apiKey: string) => {
      const res = await fetch('/api/onboarding/set-anthropic-key', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      if (!res.ok) throw new Error(`anthropic ${res.status}`)
      return res.json()
    },
  })
}
