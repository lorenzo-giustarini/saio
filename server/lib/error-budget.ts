import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'

/**
 * V14.28 Step 2 — Tracking budget AI per error pipeline (Layer 4 classify).
 * Cumula spesa stimata per giorno → soft warning + hard stop per evitare
 * runaway cost da bug nella pipeline.
 *
 * Storage: data/errors/budget-YYYY-MM-DD.json (1 file per giorno).
 * Stime pricing aggiornabili in PRICING constant.
 */

const BUDGET_DIR = path.join(process.cwd(), 'data', 'errors')
const SOFT_CAP_USD = 0.50
const HARD_CAP_USD = 2.00

// Pricing per modello (input + output medio per chiamata classify)
// Source: claude-haiku-4.5 ~$1/M input, ~$5/M output
const PRICING = {
  'claude-haiku-4-5': {
    inputPerMillion: 1.0,
    outputPerMillion: 5.0,
  },
  'claude-sonnet-4-6': {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  'claude-opus-4-7': {
    inputPerMillion: 15.0,
    outputPerMillion: 75.0,
  },
} as const

export type SupportedModel = keyof typeof PRICING

export interface BudgetEntry {
  date: string // YYYY-MM-DD
  totalUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  callCount: number
  byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number; usd: number }>
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

function budgetFile(date: string): string {
  return path.join(BUDGET_DIR, `budget-${date}.json`)
}

export async function getCurrentBudget(): Promise<BudgetEntry> {
  const date = todayKey()
  try {
    const raw = await fs.readFile(budgetFile(date), 'utf-8')
    return JSON.parse(raw) as BudgetEntry
  } catch {
    return {
      date,
      totalUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      callCount: 0,
      byModel: {},
    }
  }
}

export function estimateCost(model: SupportedModel, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens * p.inputPerMillion + outputTokens * p.outputPerMillion) / 1_000_000
}

export async function recordUsage(model: SupportedModel, inputTokens: number, outputTokens: number): Promise<BudgetEntry> {
  const cost = estimateCost(model, inputTokens, outputTokens)
  const current = await getCurrentBudget()
  const m = current.byModel[model] || { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 }
  m.calls += 1
  m.inputTokens += inputTokens
  m.outputTokens += outputTokens
  m.usd += cost
  current.byModel[model] = m
  current.callCount += 1
  current.totalInputTokens += inputTokens
  current.totalOutputTokens += outputTokens
  current.totalUsd += cost

  await fs.mkdir(BUDGET_DIR, { recursive: true })
  const tmp = `${budgetFile(current.date)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(current, null, 2), 'utf-8')
  await fs.rename(tmp, budgetFile(current.date))

  if (current.totalUsd > SOFT_CAP_USD) {
    logger.warn(`error-budget: SOFT cap exceeded today $${current.totalUsd.toFixed(4)} (warn at $${SOFT_CAP_USD})`)
  }
  return current
}

/**
 * Verifica se Layer 4 può procedere senza superare hard cap.
 * Ritorna { allowed: bool, reason?: string }.
 */
export async function checkBudgetAvailable(estimatedCost: number = 0.05): Promise<{ allowed: boolean; reason?: string; currentUsd: number }> {
  const current = await getCurrentBudget()
  const projected = current.totalUsd + estimatedCost
  if (projected >= HARD_CAP_USD) {
    return {
      allowed: false,
      reason: `Hard cap $${HARD_CAP_USD} exceeded. Current: $${current.totalUsd.toFixed(4)}, projected: $${projected.toFixed(4)}`,
      currentUsd: current.totalUsd,
    }
  }
  return { allowed: true, currentUsd: current.totalUsd }
}

export function getCaps() {
  return { softCapUsd: SOFT_CAP_USD, hardCapUsd: HARD_CAP_USD }
}
