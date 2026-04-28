/**
 * V15.0 WS12 — Onboarding state store.
 * data/auth/onboarding-state.json — flag firstLoginCompletedAt + scelte step.
 * Mai PII; salva solo le decisioni alto livello dell'utente.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { authPath, AUTH_DIR_NAME } from './constants'

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

const EMPTY: OnboardingState = { version: 1, firstLoginCompletedAt: null, choices: {} }

function filePath(dataDir: string): string {
  return path.join(dataDir, AUTH_DIR_NAME, 'onboarding-state.json')
}

export async function readOnboardingState(dataDir: string): Promise<OnboardingState> {
  try {
    const txt = await fs.readFile(filePath(dataDir), 'utf-8')
    const parsed = JSON.parse(txt) as OnboardingState
    if (parsed.version !== 1) return { ...EMPTY }
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return { ...EMPTY }
    throw err
  }
}

export async function writeOnboardingState(dataDir: string, state: OnboardingState): Promise<void> {
  const file = filePath(dataDir)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(state, null, 2))
}

export async function patchChoices(
  dataDir: string,
  patch: OnboardingChoices
): Promise<OnboardingState> {
  const cur = await readOnboardingState(dataDir)
  cur.choices = { ...cur.choices, ...patch }
  await writeOnboardingState(dataDir, cur)
  return cur
}

export async function markCompleted(dataDir: string): Promise<OnboardingState> {
  const cur = await readOnboardingState(dataDir)
  cur.firstLoginCompletedAt = new Date().toISOString()
  await writeOnboardingState(dataDir, cur)
  return cur
}
