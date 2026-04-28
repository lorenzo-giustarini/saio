/**
 * V15.0 WS7 — Stato wizard persisted in localStorage.
 * NON salviamo MAI password (solo step + email + flag completato).
 */
import { useEffect, useState } from 'react'

export type WizardStep =
  | 'intro'
  | 'gmail-open'
  | 'gmail-security'
  | 'gmail-search'
  | 'gmail-create'
  | 'gmail-paste'
  | 'custom-provider-picker' // V15.0 WS8 — preset selector pre custom-smtp
  | 'custom-smtp'
  | 'resend-form'
  | 'debug-confirm'
  | 'done'

export type WizardProvider = 'gmail' | 'custom' | 'resend' | 'debug' | null

export interface WizardDraft {
  email?: string
  smtpHost?: string
  smtpPort?: number
  smtpUser?: string
  fromEmail?: string
  presetId?: string // V15.0 WS8 — selected SMTP preset id (outlook, icloud, ..., custom)
  // password fields are NEVER persisted
}

export interface WizardState {
  step: WizardStep
  provider: WizardProvider
  draft: WizardDraft
  updatedAt: number
}

const STORAGE_KEY = 'saio-wizard-state'
const TTL_MS = 24 * 60 * 60 * 1000 // 24h

const DEFAULT_STATE: WizardState = {
  step: 'intro',
  provider: null,
  draft: {},
  updatedAt: Date.now(),
}

function loadState(): WizardState {
  if (typeof window === 'undefined') return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as WizardState
    if (!parsed || typeof parsed !== 'object') return DEFAULT_STATE
    if (Date.now() - parsed.updatedAt > TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY)
      return DEFAULT_STATE
    }
    return parsed
  } catch {
    return DEFAULT_STATE
  }
}

function saveState(state: WizardState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota exceeded etc — ignore */
  }
}

export function useWizardState() {
  const [state, setState] = useState<WizardState>(() => loadState())

  useEffect(() => {
    saveState(state)
  }, [state])

  function setStep(step: WizardStep) {
    setState((s) => ({ ...s, step, updatedAt: Date.now() }))
  }
  function setProvider(provider: WizardProvider) {
    setState((s) => ({ ...s, provider, updatedAt: Date.now() }))
  }
  function patchDraft(patch: WizardDraft) {
    setState((s) => ({ ...s, draft: { ...s.draft, ...patch }, updatedAt: Date.now() }))
  }
  function reset() {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORAGE_KEY)
    }
    setState({ ...DEFAULT_STATE, updatedAt: Date.now() })
  }

  return { state, setStep, setProvider, patchDraft, reset }
}
