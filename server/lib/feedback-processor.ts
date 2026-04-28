/**
 * V14.19 — Feedback AI processor 2-step
 *
 * Per ogni feedback non processato:
 *   Step A (meta-prompt) → AI legge il feedback raw e genera UN PROMPT mirato
 *   Step B (exec)        → AI esegue il prompt → JSON con campi decisione
 *
 * Aggrega N decisioni in 1 brief unico `data/briefs/feedback-digest-<YYYY-MM-DD>.json`.
 * Marca ogni feedback elaborato con `<id>.json.processed` (oppure `.error` se step fallito).
 *
 * Lock file `data/locks/feedback-processor.lock` (PID + ts) → stale 10min, evita double-run.
 *
 * Path discovery del binary CLI: tenta `claude` (PATH cross-platform Windows shim .cmd
 * incluso). Se assente → errore esplicito. Provider override: chi chiama l'endpoint può
 * passare `cliBinary` per usare codex/gemini/altro al posto di claude.
 */

import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { atomicWriteFile } from './atomic-write'
import { logger } from './logger'

const STEP_TIMEOUT_MS = 30_000
const MAX_FEEDBACK_PER_RUN = 20
const LOCK_STALE_MS = 10 * 60_000

interface FeedbackFile {
  id: string
  ts: string
  text: string
}

interface DecisionResult {
  causa: string
  effetto_si: string
  effetto_no: string
  rischi: Array<{ desc: string; probabilita: number; severita: 'low' | 'medium' | 'high' | 'critical' }>
  soluzioneProposta: string
  title?: string
  priority?: 'low' | 'normal' | 'high' | 'urgent'
  tags?: string[]
}

interface ProcessJobStatus {
  jobId: string
  status: 'queued' | 'running' | 'done' | 'error'
  startedAt?: string
  finishedAt?: string
  total: number
  processed: number
  errors: number
  briefPath?: string
  errorMessage?: string
}

// In-memory job tracker (single concurrent job; backed by lock file)
let currentJob: ProcessJobStatus | null = null

export function getCurrentJob(): ProcessJobStatus | null {
  return currentJob
}

const META_PROMPT_TEMPLATE = (feedbackText: string) => `Sei un planner. Ti do una nota di feedback raw scritta dall'utente:

---
${feedbackText}
---

Genera UN PROMPT specifico e mirato che, quando eseguito da un'AI tecnica, produrrebbe un'analisi utile del feedback con output JSON contenente:
- causa: causa profonda
- effetto_si: cosa succede se si interviene
- effetto_no: cosa succede se NON si interviene
- rischi: array di {desc, probabilita (0-1), severita (low|medium|high|critical)}
- soluzioneProposta: azione concreta da prendere
- title: titolo breve della decisione (max 100 char)
- priority: low|normal|high|urgent
- tags: array di tag tematici

Restituisci SOLO il prompt che dovrà essere eseguito dall'AI tecnica. NO markdown, NO preamboli. Solo testo prompt.`

const EXEC_PROMPT_INSTRUCTION = (innerPrompt: string) => `${innerPrompt}

IMPORTANTE: Restituisci SOLO un oggetto JSON valido (no markdown, no testo extra) con esattamente questi campi:
{
  "causa": "string",
  "effetto_si": "string",
  "effetto_no": "string",
  "rischi": [{ "desc": "string", "probabilita": 0.0-1.0, "severita": "low"|"medium"|"high"|"critical" }],
  "soluzioneProposta": "string",
  "title": "string (max 100 char)",
  "priority": "low"|"normal"|"high"|"urgent",
  "tags": ["string"]
}`

/** Spawn `<cliBinary> -p "<prompt>"` con timeout. Ritorna stdout raw (string trimmed). */
function execCli(cliBinary: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cliBinary, ['-p', prompt], {
      shell: process.platform === 'win32', // Windows: .cmd shim resolution
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error(`CLI timeout after ${STEP_TIMEOUT_MS}ms`))
    }, STEP_TIMEOUT_MS)

    proc.stdout?.on('data', (b) => (stdout += b.toString('utf8')))
    proc.stderr?.on('data', (b) => (stderr += b.toString('utf8')))
    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`CLI spawn failed: ${err.message}`))
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`CLI exit ${code}: ${stderr.slice(0, 500)}`))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

function tryParseJson(text: string): any | null {
  // Strip markdown code fences se presenti
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  // Trova primo { e ultimo } per robustezza (es. AI ha aggiunto preamboli)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

function slugify(s: string, maxLen = 60): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen) || 'item'
  )
}

async function acquireLock(lockPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath)
    const age = Date.now() - stat.mtimeMs
    if (age < LOCK_STALE_MS) {
      return false // Lock attivo
    }
    // Stale → riacquisisci sotto
  } catch {
    /* non esiste, prosegui */
  }
  await fs.mkdir(path.dirname(lockPath), { recursive: true })
  await atomicWriteFile(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }))
  return true
}

async function releaseLock(lockPath: string): Promise<void> {
  try { await fs.unlink(lockPath) } catch { /* ignore */ }
}

export interface ProcessOptions {
  cliBinary?: string // default 'claude'
  feedbackDir: string
  briefsDir: string
  locksDir: string
}

/**
 * Avvia il processing async. Ritorna jobId immediato.
 * Lo stato è leggibile con getCurrentJob().
 */
export async function startProcessJob(opts: ProcessOptions): Promise<{ jobId: string; queued: boolean }> {
  if (currentJob && (currentJob.status === 'queued' || currentJob.status === 'running')) {
    return { jobId: currentJob.jobId, queued: false }
  }

  const lockPath = path.join(opts.locksDir, 'feedback-processor.lock')
  const acquired = await acquireLock(lockPath)
  if (!acquired) {
    throw new Error('Lock attivo (altro processo in esecuzione, attendi 10min se stale)')
  }

  const jobId = `fp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  currentJob = {
    jobId,
    status: 'queued',
    startedAt: new Date().toISOString(),
    total: 0,
    processed: 0,
    errors: 0,
  }

  // Async fire-and-forget
  ;(async () => {
    try {
      currentJob = { ...currentJob!, status: 'running' }
      const result = await runProcessing(opts)
      currentJob = {
        ...currentJob!,
        status: 'done',
        finishedAt: new Date().toISOString(),
        total: result.total,
        processed: result.processed,
        errors: result.errors,
        briefPath: result.briefPath,
      }
    } catch (err: any) {
      logger.error('feedback-processor failed:', err)
      currentJob = {
        ...currentJob!,
        status: 'error',
        finishedAt: new Date().toISOString(),
        errorMessage: err?.message || String(err),
      }
    } finally {
      await releaseLock(lockPath)
    }
  })()

  return { jobId, queued: true }
}

interface ProcessResult {
  total: number
  processed: number
  errors: number
  briefPath?: string
}

async function runProcessing(opts: ProcessOptions): Promise<ProcessResult> {
  const cli = opts.cliBinary || 'claude'

  // Lista feedback non processati
  const files = await fs.readdir(opts.feedbackDir).catch(() => [] as string[])
  const candidates: string[] = []
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    if (f.endsWith('.processed.json')) continue
    // Skip se esiste già marker .processed o .error
    const markerOk = path.join(opts.feedbackDir, `${f}.processed`)
    const markerErr = path.join(opts.feedbackDir, `${f}.error`)
    const okExists = await fs.access(markerOk).then(() => true).catch(() => false)
    const errExists = await fs.access(markerErr).then(() => true).catch(() => false)
    if (okExists || errExists) continue
    candidates.push(f)
    if (candidates.length >= MAX_FEEDBACK_PER_RUN) break
  }

  if (candidates.length === 0) {
    return { total: 0, processed: 0, errors: 0 }
  }

  if (currentJob) currentJob.total = candidates.length

  const decisions: any[] = []
  let processed = 0
  let errors = 0

  for (const filename of candidates) {
    const fullPath = path.join(opts.feedbackDir, filename)
    let feedback: FeedbackFile
    try {
      const raw = await fs.readFile(fullPath, 'utf8')
      feedback = JSON.parse(raw)
    } catch (err: any) {
      errors++
      await atomicWriteFile(`${fullPath}.error`, JSON.stringify({ stage: 'read', error: err.message }))
      if (currentJob) currentJob.errors = errors
      continue
    }

    try {
      // Step A — meta-prompt
      const meta = META_PROMPT_TEMPLATE(feedback.text)
      const innerPrompt = await execCli(cli, meta)

      // Step B — exec del prompt prodotto
      const exec = EXEC_PROMPT_INSTRUCTION(innerPrompt)
      const execOutput = await execCli(cli, exec)

      const parsed = tryParseJson(execOutput) as DecisionResult | null
      if (!parsed || !parsed.causa || !parsed.effetto_si || !parsed.effetto_no || !parsed.soluzioneProposta) {
        throw new Error(`Step B: JSON invalido o campi mancanti. Output: ${execOutput.slice(0, 200)}`)
      }

      const decisionId = `dec-fb-${slugify(feedback.id)}`.slice(0, 60)
      decisions.push({
        id: decisionId,
        title: (parsed.title || `Feedback ${feedback.id}`).slice(0, 200),
        causa: parsed.causa.slice(0, 2000),
        effetto: {
          si: parsed.effetto_si.slice(0, 1000),
          no: parsed.effetto_no.slice(0, 1000),
        },
        rischi: Array.isArray(parsed.rischi)
          ? parsed.rischi.slice(0, 10).map((r) => ({
              desc: String(r.desc || '').slice(0, 500),
              probabilita: Math.max(0, Math.min(1, Number(r.probabilita) || 0.3)),
              severita: ['low', 'medium', 'high', 'critical'].includes(r.severita) ? r.severita : 'medium',
            }))
          : [],
        soluzioneProposta: parsed.soluzioneProposta.slice(0, 3000),
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 20).map(String) : ['feedback'],
        priority: ['low', 'normal', 'high', 'urgent'].includes(parsed.priority || '') ? parsed.priority : 'normal',
      })

      await atomicWriteFile(
        `${fullPath}.processed`,
        JSON.stringify({ ts: new Date().toISOString(), decisionId }, null, 2)
      )
      processed++
      if (currentJob) currentJob.processed = processed
    } catch (err: any) {
      errors++
      await atomicWriteFile(
        `${fullPath}.error`,
        JSON.stringify({ stage: 'ai', error: err.message, ts: new Date().toISOString() })
      )
      if (currentJob) currentJob.errors = errors
      logger.warn(`feedback-processor: feedback ${feedback.id} failed:`, err.message)
    }
  }

  if (decisions.length === 0) {
    return { total: candidates.length, processed: 0, errors }
  }

  // Brief unico
  const today = new Date().toISOString().slice(0, 10)
  const briefId = `feedback-digest-${today}-${Date.now()}`
  const brief = {
    id: briefId,
    type: 'adhoc' as const,
    createdAt: new Date().toISOString(),
    author: 'feedback-ai-processor',
    title: `Feedback digest ${today} (${decisions.length} item)`,
    summary: `Elaborazione AI 2-step di ${decisions.length} feedback raccolti dall'utente. Ogni decisione propone causa, effetto, rischi e soluzione.`,
    decisions,
    source: 'cron' as const,
    metadata: {
      processor: 'feedback-processor.v14.19',
      cliBinary: cli,
      total: candidates.length,
      processed,
      errors,
    },
  }

  const briefPath = path.join(opts.briefsDir, `${briefId}.json`)
  await fs.mkdir(opts.briefsDir, { recursive: true })
  await atomicWriteFile(briefPath, JSON.stringify(brief, null, 2))

  return { total: candidates.length, processed, errors, briefPath }
}
