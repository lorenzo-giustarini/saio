/**
 * Pricing Table (V13.1-T10)
 *
 * USD per 1M tokens per modello + tipo. Usato per calcolare costi SOLO per account
 * con mode=api (NON per Plan/subscription che hanno costi fissi mensili).
 *
 * Aggiornare periodicamente con i prezzi aktuali dei provider.
 * Source: doc ufficiali provider (2026-04).
 */

export interface ModelPricing {
  input: number         // USD per 1M input tokens
  output: number        // USD per 1M output tokens
  cache_read?: number   // USD per 1M cache-read tokens (se supportato)
  cache_5m?: number     // USD per 1M cache creation 5min TTL (Anthropic)
  cache_1h?: number     // USD per 1M cache creation 1h TTL (Anthropic)
}

/** Mappa model id → pricing. Chiavi case-insensitive (normalizzate lowercase). */
export const PRICING: Record<string, ModelPricing> = {
  // === Anthropic Claude ===
  'claude-opus-4-7[1m]': { input: 15, output: 75, cache_read: 1.50, cache_5m: 18.75, cache_1h: 30 },
  'claude-opus-4-7': { input: 15, output: 75, cache_read: 1.50, cache_5m: 18.75, cache_1h: 30 },
  'claude-opus-4-6': { input: 15, output: 75, cache_read: 1.50, cache_5m: 18.75, cache_1h: 30 },
  'claude-opus-4-5': { input: 15, output: 75, cache_read: 1.50, cache_5m: 18.75, cache_1h: 30 },
  'claude-sonnet-4-6': { input: 3, output: 15, cache_read: 0.30, cache_5m: 3.75, cache_1h: 6 },
  'claude-sonnet-4-5': { input: 3, output: 15, cache_read: 0.30, cache_5m: 3.75, cache_1h: 6 },
  'claude-haiku-4-5': { input: 1, output: 5, cache_read: 0.10, cache_5m: 1.25, cache_1h: 2 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cache_read: 0.10, cache_5m: 1.25, cache_1h: 2 },
  // === OpenAI ===
  'o1': { input: 15, output: 60, cache_read: 7.50 },
  'o1-mini': { input: 3, output: 12, cache_read: 1.50 },
  'gpt-5': { input: 10, output: 40, cache_read: 2.50 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4o': { input: 2.50, output: 10, cache_read: 1.25 },
  'sora-2': { input: 0, output: 0 }, // video gen — diverso pricing model
  // === Google Gemini ===
  'gemini-3-pro': { input: 1.25, output: 5, cache_read: 0.125 },
  'gemini-3-flash': { input: 0.10, output: 0.40, cache_read: 0.025 },
  'gemini-2.5-pro': { input: 1.25, output: 5, cache_read: 0.125 },
  'gemini-2.5-flash': { input: 0.075, output: 0.30, cache_read: 0.02 },
  'nanobanana-pro': { input: 0.40, output: 30 }, // image gen — prices per image, qui approssimato
  // === Moonshot Kimi ===
  'kimi-k2': { input: 0.15, output: 2.50 },
  'kimi-k2-turbo': { input: 0.60, output: 2.50 },
  'kimi-k1.5': { input: 0.30, output: 0.90 },
  // === xAI Grok ===
  'grok-4': { input: 3, output: 15 },
  'grok-4-heavy': { input: 6, output: 30 },
  'grok-3': { input: 3, output: 15 },
  // === DeepSeek ===
  'deepseek-v3.2': { input: 0.27, output: 1.10, cache_read: 0.07 },
  'deepseek-r1': { input: 0.55, output: 2.19, cache_read: 0.14 },
  'deepseek-coder-v2': { input: 0.14, output: 0.28 },
  // === Mistral ===
  'mistral-large-2': { input: 2, output: 6 },
  'mistral-medium-3': { input: 0.40, output: 2 },
  'codestral-2': { input: 0.30, output: 0.90 },
}

/**
 * Compute USD cost for a usage record.
 * Usage input is already in raw token counts (not divided by 1M).
 */
export interface TokenUsage {
  input?: number
  output?: number
  cache_read?: number
  cache_5m?: number
  cache_1h?: number
}

export function computeCost(model: string | undefined, usage: TokenUsage): number {
  if (!model) return 0
  const key = model.toLowerCase()
  const pricing = PRICING[key]
  if (!pricing) return 0
  const divisor = 1_000_000
  return (
    (usage.input || 0) * pricing.input / divisor +
    (usage.output || 0) * pricing.output / divisor +
    (usage.cache_read || 0) * (pricing.cache_read || 0) / divisor +
    (usage.cache_5m || 0) * (pricing.cache_5m || 0) / divisor +
    (usage.cache_1h || 0) * (pricing.cache_1h || 0) / divisor
  )
}

/** Check if model is known (has pricing entry) */
export function hasPricing(model: string | undefined): boolean {
  if (!model) return false
  return model.toLowerCase() in PRICING
}
