import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'

/**
 * V15.0 WS2-2H — Provider AI Call Logger middleware.
 *
 * Wrap fetch() calls a provider AI esterni (fal.ai, Anthropic, OpenAI, Runway,
 * Kling, ElevenLabs, Suno, Recraft, Ideogram) per loggare ogni call in JSONL
 * append-only nel vault. Output letto da error-pipeline V14.28 Layer 2 per
 * pattern matching con known-fixes.md.
 *
 * Storage: <vault>/logs/providers/<provider>/<YYYY-MM-DD>.jsonl
 * Niente token/secret nel log (sanitize obbligatorio).
 */

const VAULT_PROVIDERS_DIR = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'memory',
  'logs',
  'providers',
)

export type Provider =
  | 'anthropic'
  | 'openai'
  | 'fal-ai'
  | 'runway'
  | 'kling'
  | 'elevenlabs'
  | 'suno'
  | 'recraft'
  | 'ideogram'
  | 'heygen'
  | 'nanobanana'
  | 'unknown'

export interface ProviderCallLog {
  ts: string
  provider: Provider
  endpoint: string // path senza query string
  method: string
  status: number | null
  latencyMs: number
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  errorClass?: string // se status >= 400
  errorMessage?: string // sanitized
  callerContext?: string // es. 'error-pipeline.layer4', 'recipe-distiller', 'ui-action'
}

/**
 * Determina il provider da una URL.
 */
export function detectProvider(url: string): Provider {
  const u = url.toLowerCase()
  if (u.includes('api.anthropic.com')) return 'anthropic'
  if (u.includes('api.openai.com')) return 'openai'
  if (u.includes('fal.run') || u.includes('fal.ai')) return 'fal-ai'
  if (u.includes('runwayml.com') || u.includes('runway.team')) return 'runway'
  if (u.includes('kling.io') || u.includes('klingai.com')) return 'kling'
  if (u.includes('elevenlabs.io')) return 'elevenlabs'
  if (u.includes('suno.ai') || u.includes('sunoapi.com')) return 'suno'
  if (u.includes('recraft.ai')) return 'recraft'
  if (u.includes('ideogram.ai')) return 'ideogram'
  if (u.includes('heygen.com')) return 'heygen'
  if (u.includes('nanobanana')) return 'nanobanana'
  return 'unknown'
}

/**
 * Sanitize stringhe rimuovendo possibili token/secret.
 */
function sanitize(text: string): string {
  if (!text) return ''
  return text
    .replace(/(api[_-]?key|token|password|secret|authorization)[\s:='"]+\S+/gi, '$1=<REDACTED>')
    .replace(/(Bearer\s+)[\w.-]+/gi, '$1<REDACTED>')
    .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '<REDACTED>')
    .replace(/sbp_[a-zA-Z0-9]{20,}/g, '<REDACTED>')
    .slice(0, 500)
}

/**
 * Classifica errore HTTP in categoria stabile per pattern match.
 */
function classifyError(status: number | null, body: string): string | undefined {
  if (status === null || status < 400) return undefined
  if (status === 429) return 'rate-limit'
  if (status === 401 || status === 403) return 'auth'
  if (status === 408 || status === 504) return 'timeout'
  if (status === 422) return 'validation'
  if (status >= 500) return 'server-error'
  if (status === 400) {
    const b = body.toLowerCase()
    if (b.includes('content') && b.includes('polic')) return 'content-policy'
    if (b.includes('quota')) return 'quota-exceeded'
    return 'bad-request'
  }
  return `http-${status}`
}

/**
 * Append singolo log line in JSONL del provider corretto.
 */
async function appendLog(entry: ProviderCallLog): Promise<void> {
  try {
    const dir = path.join(VAULT_PROVIDERS_DIR, entry.provider)
    await fs.mkdir(dir, { recursive: true })
    const date = entry.ts.slice(0, 10)
    const file = path.join(dir, `${date}.jsonl`)
    const line = JSON.stringify(entry) + '\n'
    await fs.appendFile(file, line, 'utf-8')
  } catch (err: any) {
    // Non blocca la chiamata real-time se logging fallisce (best-effort)
    logger.warn(`provider-call-logger append failed: ${err.message}`)
  }
}

/**
 * Public API — wrapper fetch logging.
 *
 * Usage:
 *   const resp = await loggedFetch('https://api.anthropic.com/v1/messages', {
 *     method: 'POST',
 *     headers: { ... },
 *     body: JSON.stringify({...}),
 *   }, { callerContext: 'recipe-distiller' })
 */
export async function loggedFetch(
  url: string,
  init: RequestInit & { method?: string } = {},
  options: { callerContext?: string } = {}
): Promise<Response> {
  const provider = detectProvider(url)
  const ts = new Date().toISOString()
  const start = Date.now()
  const method = (init.method || 'GET').toUpperCase()
  const endpoint = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '')

  let status: number | null = null
  let bodyForError = ''
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  let costUsd: number | undefined

  try {
    const resp = await fetch(url, init)
    status = resp.status

    // Leggo body solo per estrarre usage (Anthropic/OpenAI tornano in body)
    // CON CAUTELA: clone() per non consumare il body originale
    if (provider === 'anthropic' || provider === 'openai') {
      try {
        const clone = resp.clone()
        const body = await clone.json()
        const usage = body.usage || {}
        inputTokens = usage.input_tokens || usage.prompt_tokens
        outputTokens = usage.output_tokens || usage.completion_tokens
        if (resp.ok && inputTokens !== undefined && outputTokens !== undefined) {
          const headers = init.headers as Record<string, string> | undefined
          const modelHint = body.model || headers?.['anthropic-version'] || ''
          costUsd = estimateCostUsd(provider, modelHint, inputTokens, outputTokens)
        }
      } catch {
        // body not JSON, skip usage parse
      }
    }

    if (!resp.ok) {
      try {
        bodyForError = await resp.clone().text()
      } catch {
        bodyForError = ''
      }
    }

    const entry: ProviderCallLog = {
      ts,
      provider,
      endpoint,
      method,
      status,
      latencyMs: Date.now() - start,
      inputTokens,
      outputTokens,
      costUsd,
      errorClass: classifyError(status, bodyForError),
      errorMessage: bodyForError ? sanitize(bodyForError) : undefined,
      callerContext: options.callerContext,
    }
    await appendLog(entry)
    return resp
  } catch (err: any) {
    // Network error, no response
    const entry: ProviderCallLog = {
      ts,
      provider,
      endpoint,
      method,
      status: null,
      latencyMs: Date.now() - start,
      errorClass: 'network',
      errorMessage: sanitize(err?.message || String(err)),
      callerContext: options.callerContext,
    }
    await appendLog(entry)
    throw err
  }
}

/**
 * Stima cost USD per provider+model. Pricing approssimativo, da aggiornare.
 */
function estimateCostUsd(provider: Provider, model: string, inputTokens: number, outputTokens: number): number {
  const m = (model || '').toLowerCase()
  // Anthropic Claude
  if (provider === 'anthropic') {
    if (m.includes('opus-4-7') || m.includes('opus-4.7')) return (inputTokens * 15 + outputTokens * 75) / 1_000_000
    if (m.includes('sonnet-4-6') || m.includes('sonnet-4.6')) return (inputTokens * 3 + outputTokens * 15) / 1_000_000
    if (m.includes('haiku-4-5') || m.includes('haiku-4.5')) return (inputTokens * 1 + outputTokens * 5) / 1_000_000
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000 // default sonnet pricing
  }
  // OpenAI GPT
  if (provider === 'openai') {
    if (m.includes('gpt-4')) return (inputTokens * 30 + outputTokens * 60) / 1_000_000
    if (m.includes('gpt-3.5')) return (inputTokens * 0.5 + outputTokens * 1.5) / 1_000_000
    return (inputTokens * 5 + outputTokens * 15) / 1_000_000
  }
  // Other providers: per-call fixed pricing approssimativa, da estendere
  return 0
}
