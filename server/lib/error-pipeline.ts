import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'
import { forEachVps } from './vps-iter'
import { loadKnownPatterns, matchKnownPattern, type KnownPattern, type AutoFixType, type Severity } from './known-fixes-parser'
import { checkBudgetAvailable, recordUsage, type SupportedModel } from './error-budget'
import { loggedFetch } from './provider-call-logger'
import type { VpsHost } from './ssh-inventory'

const execFileAsync = promisify(execFile)

/**
 * V14.28 Step 2 — Error Pipeline 4-layer.
 *
 * Layer 1: SSH grep server-side (zero token AI)
 * Layer 2: match con known-fixes.md (zero token AI)
 * Layer 3: dedupe + count aggregation (zero token AI)
 * Layer 4: AI classify SOLO errori unici nuovi (1 chiamata batch Claude)
 *
 * NESSUN limite di errori processati. Filtri intermedi tipicamente riducono
 * 200 errori raw → 5-10 unici nuovi che vanno alla AI.
 */

export interface ErrorRaw {
  vpsId: string
  source: string // path log file
  line: string // raw line
  ts: string // ISO8601 (timestamp del run, non dell'errore originale)
}

export interface ErrorClassified extends ErrorRaw {
  knownFix?: KnownPattern // se Layer 2 ha matchato
}

export interface ErrorAggregate {
  vpsId: string
  patternKey: string // slug di knownFix oppure hash dell'errore
  patternRaw: string // descrizione human-readable
  source: string
  count: number
  firstSeen: string
  lastSeen: string
  severity: Severity
  knownFix: KnownPattern | null
  samples: string[] // max 3 sample lines
  aiClassified?: boolean
  aiClassification?: AiClassification
}

export interface AiClassification {
  category: string
  severity: Severity
  suggestedFix: string
  shouldAutoFix: boolean
  autoFixType: AutoFixType
  tokensUsed: number
  rawResponse?: string
}

export interface PipelineRunResult {
  ts: string
  vpsResults: Array<{
    vpsId: string
    label: string
    rawCount: number
    aggregateCount: number
    knownCount: number
    newCount: number
    aiCalled: boolean
    aiCostUsd: number
    error?: string
  }>
  totalRaw: number
  totalAggregates: number
  totalKnown: number
  totalNew: number
  totalAiCostUsd: number
  budgetWarning?: string
}

const SSH_KEY = path.join(os.homedir(), '.ssh', 'claude_vps')
const SSH_TIMEOUT_MS = 30_000

// Path log da grep su VPS (ordinati per priorità)
const DEFAULT_LOG_PATHS = [
  '/var/log/syslog',
  '/var/log/messages',
  '/opt/onweb24/agency-os/logs/*.log',
  '/root/.pm2/logs/*.log',
  '/var/log/nginx/error.log',
]

const ERROR_REGEX = '(error|fail|timeout|429|5[0-9][0-9]|denied|refused|unreachable|unauthorized|exception|fatal)'

/**
 * Layer 1 — SSH grep server-side. Solo righe con keyword errore.
 * Output: linee raw senza alcuna AI processing.
 */
async function sshGrepErrors(vps: VpsHost, sources: string[]): Promise<ErrorRaw[]> {
  const ts = new Date().toISOString()
  const sourcesArg = sources.join(' ')
  const grepCmd = `grep -ihE "${ERROR_REGEX}" ${sourcesArg} 2>/dev/null | tail -500`

  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-i', SSH_KEY,
        '-o', 'ConnectTimeout=8',
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        `${vps.id === 'rm3-prod' ? 'root' : 'root'}@${vps.ip}`,
        grepCmd,
      ],
      { timeout: SSH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 }
    )

    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((line) => ({
        vpsId: vps.id,
        source: 'mixed', // single source label, file specifico è in line
        line: line.slice(0, 800), // cap line length
        ts,
      }))
  } catch (err: any) {
    logger.warn(`[error-pipeline] Layer 1 SSH grep failed for ${vps.id}: ${err.message}`)
    return []
  }
}

/**
 * Layer 2 — Match raw line contro known patterns. NON consuma token AI.
 */
async function classifyKnown(raws: ErrorRaw[]): Promise<ErrorClassified[]> {
  const result: ErrorClassified[] = []
  for (const raw of raws) {
    const known = await matchKnownPattern(raw.line)
    result.push({ ...raw, knownFix: known || undefined })
  }
  return result
}

/**
 * Layer 3 — Dedupe + count. Aggrega errori uguali (stesso slug knownFix
 * oppure stessa hash della normalized line) in 1 record con count + samples.
 */
function dedupeAggregate(classified: ErrorClassified[]): ErrorAggregate[] {
  const groups = new Map<string, ErrorAggregate>()

  for (const c of classified) {
    const patternKey = c.knownFix?.slug || `unknown:${normalizeForDedupe(c.line)}`
    const patternRaw = c.knownFix?.slug || c.line.slice(0, 100)
    const severity: Severity = c.knownFix?.severity || 'medium'
    const existing = groups.get(`${c.vpsId}::${patternKey}`)
    if (existing) {
      existing.count += 1
      existing.lastSeen = c.ts
      if (existing.samples.length < 3) existing.samples.push(c.line)
    } else {
      groups.set(`${c.vpsId}::${patternKey}`, {
        vpsId: c.vpsId,
        patternKey,
        patternRaw,
        source: c.source,
        count: 1,
        firstSeen: c.ts,
        lastSeen: c.ts,
        severity,
        knownFix: c.knownFix || null,
        samples: [c.line],
      })
    }
  }

  return Array.from(groups.values())
}

function normalizeForDedupe(line: string): string {
  // Rimuove timestamp/IP/numeri specifici per raggruppare errori simili
  return line
    .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')
    .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME')
    .replace(/(\d{1,3}\.){3}\d{1,3}/g, 'IP')
    .replace(/\b\d+\b/g, 'N')
    .toLowerCase()
    .slice(0, 200)
}

/**
 * Layer 4 — AI classify (only "new"). Batch single call per ridurre roundtrip.
 * Skip se budget esaurito (hard cap) o se ANTHROPIC_API_KEY mancante.
 */
async function aiClassifyNew(
  newAggregates: ErrorAggregate[],
  model: SupportedModel = 'claude-haiku-4-5'
): Promise<{ classified: ErrorAggregate[]; tokensUsed: number; costUsd: number }> {
  if (newAggregates.length === 0) return { classified: [], tokensUsed: 0, costUsd: 0 }

  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn('[error-pipeline] Layer 4 skipped: ANTHROPIC_API_KEY not set')
    return { classified: newAggregates, tokensUsed: 0, costUsd: 0 }
  }

  const budgetCheck = await checkBudgetAvailable(0.10)
  if (!budgetCheck.allowed) {
    logger.warn(`[error-pipeline] Layer 4 skipped: ${budgetCheck.reason}`)
    return { classified: newAggregates, tokensUsed: 0, costUsd: 0 }
  }

  // Build batch prompt
  const errorsList = newAggregates
    .map((a, i) => `[${i + 1}] (count=${a.count}, vps=${a.vpsId})\n${a.samples[0]}`)
    .join('\n\n')

  const prompt = `Sei un classificatore di errori di sistema/infrastruttura. Per ogni errore, rispondi in JSON con questi campi:
- index: numero dell'errore
- category: una di [rate-limit, auth, timeout, network, oom, deadlock, syntax, content-policy, other]
- severity: una di [low, medium, high, critical]
- suggestedFix: stringa breve (max 200 char) con il fix raccomandato
- shouldAutoFix: bool, true se il fix è safe da automatizzare
- autoFixType: una di [SAFE, REQUIRES-APPROVAL, MANUAL]

Errori da classificare:

${errorsList}

Rispondi SOLO con un array JSON, niente altro testo. Esempio:
[{"index":1,"category":"timeout","severity":"medium","suggestedFix":"...","shouldAutoFix":true,"autoFixType":"SAFE"}]`

  try {
    // V15.0 WS2-2H — usa loggedFetch per loggare in vault/logs/providers/anthropic/
    const apiResp = await loggedFetch(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      { callerContext: 'error-pipeline.layer4' }
    )

    if (!apiResp.ok) {
      const txt = await apiResp.text()
      logger.error(`[error-pipeline] Layer 4 API error ${apiResp.status}: ${txt.slice(0, 200)}`)
      return { classified: newAggregates, tokensUsed: 0, costUsd: 0 }
    }

    const data = (await apiResp.json()) as any
    const content = data.content?.[0]?.text || ''
    const usage = data.usage || { input_tokens: 0, output_tokens: 0 }

    // Record budget
    const costRecord = await recordUsage(model, usage.input_tokens, usage.output_tokens)

    // Parse classifications
    let classifications: any[] = []
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/)
      if (jsonMatch) classifications = JSON.parse(jsonMatch[0])
    } catch (parseErr) {
      logger.error(`[error-pipeline] Layer 4 JSON parse failed: ${parseErr}`)
    }

    const enriched = newAggregates.map((agg, i) => {
      const c = classifications.find((x) => x.index === i + 1)
      if (!c) return agg
      return {
        ...agg,
        aiClassified: true,
        severity: (c.severity as Severity) || agg.severity,
        aiClassification: {
          category: c.category || 'other',
          severity: (c.severity as Severity) || 'medium',
          suggestedFix: c.suggestedFix || '',
          shouldAutoFix: !!c.shouldAutoFix,
          autoFixType: (c.autoFixType as AutoFixType) || 'MANUAL',
          tokensUsed: usage.input_tokens + usage.output_tokens,
          rawResponse: content.slice(0, 300),
        },
      }
    })

    return {
      classified: enriched,
      tokensUsed: usage.input_tokens + usage.output_tokens,
      costUsd: costRecord.totalUsd,
    }
  } catch (err: any) {
    logger.error(`[error-pipeline] Layer 4 fetch failed: ${err.message}`)
    return { classified: newAggregates, tokensUsed: 0, costUsd: 0 }
  }
}

/**
 * Persiste output JSONL per VPS.
 */
async function writeOutput(vpsId: string, aggregates: ErrorAggregate[]): Promise<string> {
  const date = new Date().toISOString().slice(0, 10)
  const dir = path.join(process.cwd(), 'data', 'errors', vpsId)
  await fs.mkdir(dir, { recursive: true })
  const file = path.join(dir, `${date}.jsonl`)
  const lines = aggregates.map((a) => JSON.stringify(a)).join('\n')
  // Append (multiple runs/day → multiple lines)
  await fs.appendFile(file, lines + '\n', 'utf-8')
  return file
}

/**
 * Append audit log per la corsa.
 */
async function writeAudit(result: PipelineRunResult): Promise<void> {
  const dir = path.join(process.cwd(), 'data', 'audit')
  await fs.mkdir(dir, { recursive: true })
  const ym = new Date().toISOString().slice(0, 7).replace('-', '')
  const file = path.join(dir, `error-pipeline-runs-${ym}.jsonl`)
  await fs.appendFile(file, JSON.stringify(result) + '\n', 'utf-8')
}

/**
 * Public API — runErrorPipeline. Orchestrator dei 4 layer per N VPS.
 */
export async function runErrorPipeline(opts: {
  vpsIds?: string[] // se omesso, tutti
  sources?: string[] // path log da grep, default DEFAULT_LOG_PATHS
}): Promise<PipelineRunResult> {
  const sources = opts.sources || DEFAULT_LOG_PATHS
  const ts = new Date().toISOString()
  const result: PipelineRunResult = {
    ts,
    vpsResults: [],
    totalRaw: 0,
    totalAggregates: 0,
    totalKnown: 0,
    totalNew: 0,
    totalAiCostUsd: 0,
  }

  // Per ogni VPS: Layer 1 + 2 + 3 (sequenza)
  const perVpsResults = await forEachVps(
    async (vps) => {
      const raws = await sshGrepErrors(vps, sources)
      const classified = await classifyKnown(raws)
      const aggregates = dedupeAggregate(classified)
      return { vps, raws, classified, aggregates }
    },
    {
      filter: opts.vpsIds ? (v) => opts.vpsIds!.includes(v.id) : undefined,
      timeoutMsPerVps: SSH_TIMEOUT_MS + 5_000,
    }
  )

  // Aggrega tutti i nuovi (cross-VPS) per Layer 4 batch
  const allAggregates: ErrorAggregate[] = []
  const aggregatesByVps: Record<string, ErrorAggregate[]> = {}
  for (const r of perVpsResults) {
    if (r.error || !r.result) {
      result.vpsResults.push({
        vpsId: r.vpsId,
        label: r.label,
        rawCount: 0,
        aggregateCount: 0,
        knownCount: 0,
        newCount: 0,
        aiCalled: false,
        aiCostUsd: 0,
        error: r.error,
      })
      continue
    }
    const { aggregates, raws } = r.result
    aggregatesByVps[r.vpsId] = aggregates
    allAggregates.push(...aggregates)
    result.totalRaw += raws.length
    result.totalAggregates += aggregates.length
    const known = aggregates.filter((a) => a.knownFix !== null).length
    result.totalKnown += known
    result.totalNew += aggregates.length - known
    result.vpsResults.push({
      vpsId: r.vpsId,
      label: r.label,
      rawCount: raws.length,
      aggregateCount: aggregates.length,
      knownCount: known,
      newCount: aggregates.length - known,
      aiCalled: false,
      aiCostUsd: 0,
    })
  }

  // Layer 4 — AI classify cross-VPS dei soli nuovi
  const newOnly = allAggregates.filter((a) => !a.knownFix)
  let aiResult = { classified: [] as ErrorAggregate[], tokensUsed: 0, costUsd: 0 }
  if (newOnly.length > 0) {
    aiResult = await aiClassifyNew(newOnly)
    result.totalAiCostUsd = aiResult.costUsd
  }

  // Re-merge AI-enriched aggregates per vpsId
  const aiByKey = new Map<string, ErrorAggregate>()
  for (const a of aiResult.classified) {
    aiByKey.set(`${a.vpsId}::${a.patternKey}`, a)
  }
  for (const vpsId of Object.keys(aggregatesByVps)) {
    aggregatesByVps[vpsId] = aggregatesByVps[vpsId].map((a) => {
      const key = `${vpsId}::${a.patternKey}`
      return aiByKey.get(key) || a
    })
    // Persist
    if (aggregatesByVps[vpsId].length > 0) {
      await writeOutput(vpsId, aggregatesByVps[vpsId])
    }
  }

  // Mark AI called in vpsResults
  if (newOnly.length > 0 && aiResult.tokensUsed > 0) {
    for (const v of result.vpsResults) {
      v.aiCalled = true
      v.aiCostUsd = aiResult.costUsd / Math.max(1, result.vpsResults.length)
    }
  }

  // Audit
  await writeAudit(result)

  logger.info(`[error-pipeline] run done: ${result.totalRaw} raw → ${result.totalAggregates} aggregates (${result.totalKnown} known, ${result.totalNew} new) in ${result.vpsResults.length} VPS, AI cost $${result.totalAiCostUsd.toFixed(4)}`)
  return result
}
