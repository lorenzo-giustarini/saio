import { Router } from 'express'
import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { BriefSchema, InSessionDecisionSchema } from '../../shared/schemas'
import { atomicWriteFile } from '../lib/atomic-write'
import { cleanupZombieBriefs } from '../lib/zombie-cleanup'
import { logger } from '../lib/logger'

const ResolvePayloadSchema = z.object({
  resolvedVia: z.enum(['chat', 'manual', 'external']).default('manual'),
  resolution: z.string().max(2000).default(''),
  resolvedBy: z.enum(['user', 'claude']).default('user'),
})

function sanitizeBriefId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128)
}

// V15.0 WS25 — Estraggo logica summarize riusabile da /summarize route + /regenerate.
// Esegue fallback chain WS24: account.mode='plan' CLI -p → API REST → null fallback.
export interface RunSummarizeBody {
  buffer: string
  projectId: string
  options: Array<{ num: string; text: string }>
  providerHint?: string
}
export interface RunSummarizeResult {
  title: string | null
  summary: string | null
  options: Array<{ num: string; label: string }> | null
  provider: 'anthropic' | 'openai' | 'gemini'
  mode: 'plan' | 'api' | 'fallback'
  fallback: false | string
  error?: string
}

export async function runSummarize(body: RunSummarizeBody): Promise<RunSummarizeResult> {
  const buffer = String(body.buffer || '').slice(-3500)
  const options = Array.isArray(body.options) ? body.options.slice(0, 6) : []
  if (!buffer || options.length === 0) {
    return { title: null, summary: null, options: null, provider: 'anthropic', mode: 'fallback', fallback: 'no_input' }
  }

  // Risolvi account ATTIVO per routing CLI plan vs API REST
  const { accountsStore } = await import('../lib/accounts-store')
  const activeAccount = await accountsStore.getActive()
  const accountProviderId = activeAccount?.providerId
  const accountMode = activeAccount?.mode || 'api'

  let provider: 'anthropic' | 'openai' | 'gemini' = 'anthropic'
  if (accountProviderId === 'anthropic' || accountProviderId === 'openai' || accountProviderId === 'google') {
    provider = accountProviderId === 'google' ? 'gemini' : accountProviderId
  } else if (body.providerHint === 'anthropic' || body.providerHint === 'openai' || body.providerHint === 'gemini') {
    provider = body.providerHint
  }

  const optionsTextForPrompt = options.map((o) => `${o.num}. ${o.text}`).join('\n')
  const prompt = `Sei un assistente che riassume scelte in attesa decisione utente per il sistema SAIO Dashboard. L'utente vede output di Claude TUI con opzioni numerate e deve scegliere consapevolmente.

OUTPUT TUI RECENTE (ultimi 4KB):
"""
${buffer}
"""

OPZIONI RILEVATE:
${optionsTextForPrompt}

Compila JSON con:
- "title": domanda principale che l'utente deve rispondere (max 80 char, italiano, chiaro e specifico)
- "summary": riassunto della scelta + contesto utile per decidere (max 300 char, italiano)
- "options": array con label arricchita per ogni opzione { "num": "1", "label": "..." } (label max 80 char, ITALIANO)

Rispondi SOLO con JSON valido, NIENTE altro testo o markdown.`

  // Tentativo 1: CLI plan
  if (accountMode === 'plan') {
    const { spawnCliPrintMode, resolveCheapModelForPlan, parseCliJsonOutput } = await import('../lib/cli-print-mode')
    const cheap = resolveCheapModelForPlan(accountProviderId || 'anthropic')
    if (cheap) {
      const result = await spawnCliPrintMode({ cli: cheap.cli, prompt, model: cheap.model, timeoutMs: 30_000 })
      if (result.ok && result.stdout) {
        const parsed = parseCliJsonOutput<{ title?: string; summary?: string; options?: Array<{ num: string; label: string }> }>(result.stdout)
        if (parsed) {
          logger.info(`[briefs] runSummarize via CLI plan ${cheap.cli}/${cheap.model} (${result.durationMs}ms)`)
          return {
            title: typeof parsed.title === 'string' ? parsed.title.slice(0, 200) : null,
            summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : null,
            options: Array.isArray(parsed.options) ? parsed.options.slice(0, 6) : null,
            provider, mode: 'plan', fallback: false,
          }
        }
        logger.warn(`[briefs] CLI plan parse failed for ${cheap.cli}, falling through to API REST`)
      } else {
        logger.warn(`[briefs] CLI plan ${cheap.cli} failed (${result.error || result.exitCode}): ${result.stderr.slice(-200)}`)
      }
    }
  }

  // Tentativo 2: API REST
  const apiKey = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  }[provider]
  if (!apiKey) {
    return { title: null, summary: null, options: null, provider, mode: 'fallback', fallback: 'no_api_key' }
  }
  try {
    let parsed: { title?: string; summary?: string; options?: Array<{ num: string; label: string }> } = {}
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!r.ok) throw new Error(`anthropic_${r.status}`)
      const data = (await r.json()) as { content?: Array<{ text?: string }> }
      const text = data.content?.[0]?.text || '{}'
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim())
    } else if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 600, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
      })
      if (!r.ok) throw new Error(`openai_${r.status}`)
      const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
      parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    } else {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 600 } }),
        }
      )
      if (!r.ok) throw new Error(`gemini_${r.status}`)
      const data = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      parsed = JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text || '{}')
    }
    logger.info(`[briefs] runSummarize via API REST ${provider}`)
    return {
      title: typeof parsed.title === 'string' ? parsed.title.slice(0, 200) : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : null,
      options: Array.isArray(parsed.options) ? parsed.options.slice(0, 6) : null,
      provider, mode: 'api', fallback: false,
    }
  } catch (err) {
    logger.warn(`[briefs] runSummarize ${provider} API REST failed:`, (err as Error).message)
    return {
      title: null, summary: null, options: null, provider, mode: 'fallback',
      fallback: 'api_error',
      error: String((err as Error).message).slice(0, 200),
    }
  }
}

export function briefsRouter(dataDir: string) {
  const router = Router()
  const briefsDir = path.join(dataDir, 'briefs')
  try {
    fsSync.mkdirSync(briefsDir, { recursive: true })
  } catch {
    /* ignore */
  }

  // List briefs — with optional filters:
  // ?pending=true — only source='in-session' briefs (for Claude discovery)
  // ?projectId=X — only briefs targeting a specific project
  router.get('/', async (req, res) => {
    try {
      const pendingOnly = req.query.pending === 'true'
      const projectIdFilter =
        typeof req.query.projectId === 'string'
          ? req.query.projectId.replace(/[^a-z0-9_-]/g, '').slice(0, 64)
          : null

      const files = await fs.readdir(briefsDir)
      const briefs: any[] = []
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const raw = await fs.readFile(path.join(briefsDir, f), 'utf8')
          const parsed = JSON.parse(raw)
          const brief = BriefSchema.safeParse(parsed)
          if (brief.success) {
            const b = brief.data as any
            if (pendingOnly && b.source !== 'in-session') continue
            if (projectIdFilter && b.projectId !== projectIdFilter) continue
            briefs.push(b)
          } else {
            logger.warn(`Invalid brief ${f}:`, brief.error.issues[0])
          }
        } catch (err) {
          logger.error(`Failed to parse brief ${f}:`, err)
        }
      }
      briefs.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      res.json({ briefs, count: briefs.length })
    } catch (err) {
      logger.error('List briefs failed:', err)
      res.status(500).json({ error: 'Failed to list briefs' })
    }
  })

  // Get single brief
  router.get('/:id', async (req, res) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) return res.status(400).json({ error: 'Invalid id' })
    try {
      const fp = path.join(briefsDir, `${id}.json`)
      const raw = await fs.readFile(fp, 'utf8')
      const parsed = BriefSchema.parse(JSON.parse(raw))
      res.json(parsed)
    } catch (err) {
      res.status(404).json({ error: 'Brief not found' })
    }
  })

  // ===========================================================
  // POST /cleanup-zombies — bulk archive in-session briefs > N days
  // V13.1 T9
  // ===========================================================
  router.post('/cleanup-zombies', async (req, res) => {
    const olderThanDays = Number(req.body?.olderThanDays ?? 7)
    if (!Number.isFinite(olderThanDays) || olderThanDays < 0 || olderThanDays > 365) {
      return res.status(400).json({ error: 'olderThanDays must be 0-365' })
    }
    try {
      const result = await cleanupZombieBriefs(dataDir, olderThanDays)
      logger.info(`[briefs/cleanup-zombies] olderThanDays=${olderThanDays} → ${result.archived}/${result.scanned}`)
      res.json({ ok: true, olderThanDays, ...result })
    } catch (err: any) {
      logger.error('[briefs/cleanup-zombies] failed:', err)
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  // ===========================================================
  // POST /:id/resolve — mark brief as resolved-elsewhere
  // V12-01: quando l'utente risponde in chat (non via Inbox form)
  // il brief diventa zombi. Questo endpoint lo sposta in archive con
  // sidecar metadata che traccia come/quando/chi ha risolto.
  // Idempotente: seconda chiamata su brief già archiviato → 404.
  // ===========================================================
  router.post('/:id/resolve', async (req, res) => {
    const id = sanitizeBriefId(req.params.id)
    if (!id) return res.status(400).json({ error: 'invalid id' })

    const parse = ResolvePayloadSchema.safeParse(req.body || {})
    if (!parse.success) {
      return res.status(400).json({ error: 'invalid payload', details: parse.error.issues })
    }

    const briefPath = path.join(briefsDir, `${id}.json`)
    if (!fsSync.existsSync(briefPath)) {
      return res.status(404).json({
        error: 'brief not found in active inbox',
        hint: 'brief may already be archived/resolved',
      })
    }

    const archiveDir = path.join(dataDir, 'archive', 'briefs')
    try {
      await fs.mkdir(archiveDir, { recursive: true })
    } catch {
      /* ignore */
    }

    const archivedBriefPath = path.join(archiveDir, `${id}.json`)
    const sidecarPath = path.join(archiveDir, `${id}.resolution.json`)

    try {
      await fs.rename(briefPath, archivedBriefPath)
    } catch (err: any) {
      logger.error(`[briefs] resolve rename failed for ${id}:`, err)
      return res.status(500).json({ error: 'archive move failed', detail: String(err.message || err) })
    }

    try {
      await atomicWriteFile(
        sidecarPath,
        JSON.stringify(
          {
            briefId: id,
            resolvedAt: new Date().toISOString(),
            resolvedVia: parse.data.resolvedVia,
            resolution: parse.data.resolution,
            resolvedBy: parse.data.resolvedBy,
          },
          null,
          2
        )
      )
    } catch (err) {
      // Non-fatal: brief is in archive, sidecar missing can be rebuilt
      logger.warn(`[briefs] sidecar write failed for ${id}:`, err)
    }

    logger.info(
      `[briefs] ${id} resolved via ${parse.data.resolvedVia} by ${parse.data.resolvedBy}`
    )
    res.json({
      ok: true,
      briefId: id,
      archivedTo: archivedBriefPath,
      sidecar: sidecarPath,
      resolvedVia: parse.data.resolvedVia,
    })
  })

  // ===========================================================
  // POST /decision — create standalone in-session decision card
  // V11-01: when Claude hits a choice point during an active session,
  // it posts here instead of asking inline. A minimal Brief is created
  // with type='adhoc', source='in-session', 1 decision inside.
  // V15.0 WS23 — Idempotency dedupe: stessa scelta entro 30s ritorna lo stesso
  // briefId senza creare duplicati. Aggiunto msSlug per same-second uniqueness
  // tra brief LEGITTIMI distinti.
  // ===========================================================
  router.post('/decision', async (req, res) => {
    const parse = InSessionDecisionSchema.safeParse(req.body)
    if (!parse.success) {
      return res.status(400).json({ error: 'invalid payload', details: parse.error.issues })
    }
    const { projectId, sessionId, decision } = parse.data

    // V15.0 WS23 — Dedupe in-memory check
    pruneInSessionDedupe()
    const dKey = inSessionDedupeKey(projectId, decision.title, decision.soluzioneProposta || '')
    const existing = inSessionDedupeMap.get(dKey)
    if (existing) {
      logger.info(`[briefs] in-session dedupe HIT: ${existing.briefId} (project=${projectId})`)
      return res.json({ ok: true, briefId: existing.briefId, decisionId: existing.decisionId, dedup: true })
    }

    const now = new Date()
    const ts = now.toISOString()
    const dateSlug = ts.slice(0, 10)
    const timeSlug = ts.slice(11, 19).replace(/:/g, '')
    // V15.0 WS23 — ms suffix per same-second uniqueness se 2 brief LEGITTIMI distinti
    const msSlug = ts.slice(20, 23) || '000'
    const decisionId = decision.id || `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const briefId = `in-session-${projectId}-${dateSlug}-${timeSlug}-${msSlug}`

    const brief = {
      id: briefId,
      type: 'adhoc' as const,
      createdAt: ts,
      author: 'claude' as const,
      title: decision.title,
      summary: decision.causa.slice(0, 200),
      decisions: [{ ...decision, id: decisionId }],
      source: 'in-session' as const,
      projectId,
      sessionId,
    }

    // Validate full brief to ensure nothing slipped
    const full = BriefSchema.safeParse(brief)
    if (!full.success) {
      return res.status(500).json({ error: 'brief assembly failed', details: full.error.issues })
    }

    try {
      const fp = path.join(briefsDir, `${briefId}.json`)
      await atomicWriteFile(fp, JSON.stringify(full.data, null, 2))
      logger.info(`[briefs] in-session decision created: ${briefId} (project=${projectId})`)
      // V15.0 WS23 — Save dedupe entry post-write
      inSessionDedupeMap.set(dKey, { briefId, decisionId, createdAt: Date.now() })
      res.json({ ok: true, briefId, decisionId, path: fp })
    } catch (err) {
      logger.error('in-session decision create failed:', err)
      res.status(500).json({ error: 'persist failed' })
    }
  })

  // ===========================================================
  // V15.0 WS23+WS24 — POST /summarize — AI cheap-model summary di una scelta runtime
  // Riceve buffer PTY + opzioni rilevate, usa Haiku/4o-mini/Flash per generare
  // title + summary + label opzioni più chiari di estrazione naive heuristic.
  //
  // Fallback chain (WS24):
  //  1. Account.mode='plan' → spawn CLI in print mode (claude -p, gemini -p) →
  //     usa abbonamento utente, ZERO costo extra
  //  2. Account.mode='api' OR fallback → REST API con env API key (paga per token)
  //  3. Tutti gli altri casi → ritorna null per heuristic naive lato client
  //
  // "Progetto invisibile in background" — print mode è execFile + stdout capture,
  // NON crea PTY session, NON appare in ptyManager.list().
  // ===========================================================
  // V15.0 WS25 — Refactor: la logica è in `runSummarize()` modulo-level, riusata
  // anche da /in-session/regenerate. Route resta come thin wrapper per back-compat.
  router.post('/summarize', async (req, res) => {
    const result = await runSummarize(req.body as RunSummarizeBody)
    res.json(result)
  })

  // V15.0 WS25 — POST /in-session/cleanup — archive batch dei brief in-session
  // per uno specifico projectId. Sposta in data/archive/briefs/ con sidecar.
  router.post('/in-session/cleanup', async (req, res) => {
    const { projectId } = req.body as { projectId?: string }
    if (!projectId || !/^[a-z0-9_-]{1,64}$/.test(projectId)) {
      return res.status(400).json({ error: 'invalid_projectId' })
    }
    try {
      const allFiles = await fs.readdir(briefsDir)
      const target = allFiles.filter((f) =>
        f.startsWith(`in-session-${projectId}-`) && f.endsWith('.json')
      )
      let archived = 0
      let failed = 0
      const archiveDir = path.join(dataDir, 'archive', 'briefs')
      await fs.mkdir(archiveDir, { recursive: true })
      for (const f of target) {
        try {
          const src = path.join(briefsDir, f)
          const dst = path.join(archiveDir, f)
          await fs.rename(src, dst)
          const sidecar = {
            archivedAt: new Date().toISOString(),
            archivedVia: 'in-session-cleanup',
            archivedBy: 'user',
            reason: 'bulk cleanup of in-session refusi',
            projectId,
          }
          await atomicWriteFile(
            dst.replace('.json', '.resolution.json'),
            JSON.stringify(sidecar, null, 2)
          )
          archived++
        } catch (err) {
          logger.warn(`[briefs] cleanup ${f} failed:`, err)
          failed++
        }
      }
      logger.info(`[briefs] cleanup archived=${archived} failed=${failed} projectId=${projectId}`)
      res.json({ ok: true, archived, failed, projectId })
    } catch (err) {
      logger.error('[briefs] cleanup failed:', err)
      res.status(500).json({ error: 'cleanup_failed', message: (err as Error).message })
    }
  })

  // V15.0 WS25 — POST /in-session/regenerate — cleanup + leggi buffer PTY +
  // summarize chain WS24 + crea brief nuovo. Use case: l'utente vuole testare
  // come WS24 rigenererebbe un brief sul progetto attualmente attivo.
  router.post('/in-session/regenerate', async (req, res) => {
    const { projectId } = req.body as { projectId?: string }
    if (!projectId || !/^[a-z0-9_-]{1,64}$/.test(projectId)) {
      return res.status(400).json({ error: 'invalid_projectId' })
    }
    try {
      // V15.0 WS28 — STEP A (FIRST): leggi buffer PRIMA di fare cleanup.
      // Atomicità invertita: se non c'è buffer disponibile NON cancelliamo nulla.
      // Priorità: PTY in-memory live > log file persistente fallback.
      const { ptyManager } = await import('../lib/pty-manager')
      const session = ptyManager.get(projectId)
      let buffer = ''
      let bufferSource: 'pty_live' | 'log_file' | 'none' = 'none'
      if (session) {
        buffer = session.buffer.join('').slice(-3500)
        bufferSource = 'pty_live'
      } else {
        // Fallback log file: pty-manager scrive append-only in data/logs/<projectId>.log
        const logPath = path.join(dataDir, 'logs', `${projectId}.log`)
        try {
          const logContent = await fs.readFile(logPath, 'utf-8')
          buffer = logContent.slice(-3500)
          bufferSource = 'log_file'
        } catch {
          /* log file non esiste o non leggibile */
        }
      }

      if (!buffer || buffer.trim().length < 50) {
        // V15.0 WS28 — Atomicità: NON cancelliamo nulla se non possiamo rigenerare
        return res.status(404).json({
          error: 'no_buffer_available',
          message:
            bufferSource === 'none'
              ? `Sessione PTY di "${projectId}" non attiva e log file non trovato. Apri il progetto per generare nuovo output, poi riprova.`
              : `Buffer troppo corto (${buffer.length} char). Apri il progetto e fai una domanda a Claude, poi riprova.`,
          hint: 'open_project',
          bufferSource,
        })
      }

      logger.info(`[briefs] regenerate buffer source=${bufferSource} length=${buffer.length}`)

      // Step 3: rileva opzioni numerate (heuristic WS23 stretto)
      const lines = buffer.split('\n').slice(-15)
      const optionRegex = /^\s*(?:❯\s*)?([1-9])[.)]\s+(.+?)\s*$/
      type Match = { num: string; text: string; lineIdx: number; hasMarker: boolean }
      const matches: Match[] = []
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? ''
        const m = line.match(optionRegex)
        if (m) {
          matches.push({
            num: m[1]!,
            text: m[2]!.slice(0, 200),
            lineIdx: i,
            hasMarker: /^[\s]*❯/.test(line),
          })
        }
      }
      const isMenu =
        matches.length >= 2 &&
        matches.length <= 6 &&
        matches.some((m) => m.hasMarker) &&
        matches.reduce((s, m) => s + m.text.length, 0) / matches.length <= 45

      // Step 4: summarize via WS24 chain
      const optionsForSummarize = isMenu
        ? matches.map((m) => ({ num: m.num, text: m.text.slice(0, 60) }))
        : [
            { num: '1', text: 'Conferma per procedere' },
            { num: '2', text: 'Annulla / chiedi chiarimenti' },
          ]
      const summary = await runSummarize({
        buffer,
        projectId,
        options: optionsForSummarize,
      })

      // V15.0 WS28 — STEP B (LAST): cleanup vecchi briefs SOLO ORA che il summarize
      // ha generato output utile. Atomicità: tutto-o-niente.
      const allFiles = await fs.readdir(briefsDir)
      const targetFiles = allFiles.filter(
        (f) => f.startsWith(`in-session-${projectId}-`) && f.endsWith('.json')
      )
      const archiveDir = path.join(dataDir, 'archive', 'briefs')
      await fs.mkdir(archiveDir, { recursive: true })
      let cleanedCount = 0
      for (const f of targetFiles) {
        try {
          await fs.rename(path.join(briefsDir, f), path.join(archiveDir, f))
          cleanedCount++
        } catch {
          /* */
        }
      }

      // Step 5: build brief + write
      const detectedAs: 'option_menu' | 'implicit_question' = isMenu ? 'option_menu' : 'implicit_question'
      const title =
        summary.title ||
        (isMenu ? 'Scelta multipla in sessione' : 'Conferma richiesta da Claude')
      const causa = summary.summary || 'Claude attende feedback nel terminale.'
      const optionsList: Array<{ num: string; label?: string; text?: string }> =
        Array.isArray(summary.options) && summary.options.length > 0
          ? summary.options
          : optionsForSummarize.map((o) => ({ num: o.num, label: o.text }))
      const optionsText = optionsList
        .map((o) => `${o.num}. ${o.label || o.text}`)
        .join('\n')

      const decision = {
        title: title.slice(0, 200),
        causa: causa.slice(0, 1900),
        effetto: {
          si: optionsForSummarize[0] ? `Opzione 1: ${optionsForSummarize[0].text}` : 'Procedi',
          no: optionsForSummarize[1] ? `Opzione 2: ${optionsForSummarize[1].text}` : 'Rimanda',
        },
        rischi: [],
        soluzioneProposta: `Scelta runtime (rigenerata via WS25 - ${detectedAs}):\n${optionsText.slice(0, 2900)}`,
        priority: 'normal' as const,
      }
      const ts = new Date().toISOString()
      const dateSlug = ts.slice(0, 10)
      const timeSlug = ts.slice(11, 19).replace(/:/g, '')
      const msSlug = ts.slice(20, 23) || '000'
      const briefId = `in-session-${projectId}-${dateSlug}-${timeSlug}-${msSlug}`
      const decisionId = `d-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      const brief = {
        id: briefId,
        type: 'adhoc' as const,
        createdAt: ts,
        author: 'claude' as const,
        title: decision.title,
        summary: decision.causa.slice(0, 200),
        decisions: [{ ...decision, id: decisionId }],
        source: 'in-session' as const,
        projectId,
      }
      const validated = BriefSchema.safeParse(brief)
      if (!validated.success) {
        return res.status(500).json({
          error: 'brief_assembly_failed',
          details: validated.error.issues,
          cleanedCount,
        })
      }
      const fp = path.join(briefsDir, `${briefId}.json`)
      await atomicWriteFile(fp, JSON.stringify(validated.data, null, 2))
      logger.info(
        `[briefs] regenerate created ${briefId} (cleaned=${cleanedCount}, detectedAs=${detectedAs}, mode=${summary.mode})`
      )
      res.json({
        ok: true,
        briefId,
        decisionId,
        cleanedCount,
        detectedAs,
        summarizeMode: summary.mode,
        provider: summary.provider,
        bufferSource,
      })
    } catch (err) {
      logger.error('[briefs] regenerate failed:', err)
      res.status(500).json({ error: 'regenerate_failed', message: (err as Error).message })
    }
  })

  // V15.0 WS28 — POST /in-session/restore — ripristina briefs archiviati per un projectId
  // Sposta da data/archive/briefs/ a data/briefs/. Rimuove sidecar resolution.json.
  // Usato da toast undo post-cleanup per recuperare brief erroneamente archiviati.
  router.post('/in-session/restore', async (req, res) => {
    const { projectId } = req.body as { projectId?: string }
    if (!projectId || !/^[a-z0-9_-]{1,64}$/.test(projectId)) {
      return res.status(400).json({ error: 'invalid_projectId' })
    }
    try {
      const archiveDir = path.join(dataDir, 'archive', 'briefs')
      const files = await fs.readdir(archiveDir).catch(() => [] as string[])
      const target = files.filter(
        (f) => f.startsWith(`in-session-${projectId}-`) && f.endsWith('.json')
      )
      let restored = 0
      let failed = 0
      for (const f of target) {
        try {
          await fs.rename(path.join(archiveDir, f), path.join(briefsDir, f))
          // Rimuovi sidecar resolution se esiste (cleanup ne aveva creato uno)
          try {
            await fs.unlink(path.join(archiveDir, f.replace('.json', '.resolution.json')))
          } catch {
            /* sidecar opzionale, ok se non c'è */
          }
          restored++
        } catch (err) {
          logger.warn(`[briefs] restore ${f} failed:`, err)
          failed++
        }
      }
      logger.info(`[briefs] restore restored=${restored} failed=${failed} projectId=${projectId}`)
      res.json({ ok: true, restored, failed, projectId })
    } catch (err) {
      logger.error('[briefs] restore failed:', err)
      res.status(500).json({ error: 'restore_failed', message: (err as Error).message })
    }
  })

  // ===========================================================
  // V15.0 WS23+WS24 — Vecchio /summarize body inline (DEAD CODE — rimosso in
  // favore di runSummarize). Lasciato sotto come riferimento storico.
  // ===========================================================
  router.post('/summarize-legacy-disabled', async (req, res) => {
    const body = req.body as {
      buffer?: string
      projectId?: string
      options?: Array<{ num: string; text: string }>
      providerHint?: 'anthropic' | 'openai' | 'gemini'
    }
    const buffer = String(body.buffer || '').slice(-3500)
    const options = Array.isArray(body.options) ? body.options.slice(0, 6) : []
    if (!buffer || options.length === 0) {
      return res.json({ title: null, summary: null, options: null, fallback: 'no_input' })
    }

    // V15.0 WS24 — Risolvi account ATTIVO per decidere routing CLI plan vs API REST
    const { accountsStore } = await import('../lib/accounts-store')
    const activeAccount = await accountsStore.getActive()
    const accountProviderId = activeAccount?.providerId
    const accountMode = activeAccount?.mode || 'api'

    // Provider scelto: priorità active account > providerHint > anthropic default
    let provider: 'anthropic' | 'openai' | 'gemini' = 'anthropic'
    if (accountProviderId === 'anthropic' || accountProviderId === 'openai' || accountProviderId === 'google') {
      provider = accountProviderId === 'google' ? 'gemini' : accountProviderId
    } else if (body.providerHint === 'anthropic' || body.providerHint === 'openai' || body.providerHint === 'gemini') {
      provider = body.providerHint
    }

    const optionsTextForPrompt = options.map((o) => `${o.num}. ${o.text}`).join('\n')
    const prompt = `Sei un assistente che riassume scelte in attesa decisione utente per il sistema SAIO Dashboard. L'utente vede output di Claude TUI con opzioni numerate e deve scegliere consapevolmente.

OUTPUT TUI RECENTE (ultimi 4KB):
"""
${buffer}
"""

OPZIONI RILEVATE:
${optionsTextForPrompt}

Compila JSON con:
- "title": domanda principale che l'utente deve rispondere (max 80 char, italiano, chiaro e specifico)
- "summary": riassunto della scelta + contesto utile per decidere (max 300 char, italiano)
- "options": array con label arricchita per ogni opzione { "num": "1", "label": "..." } (label max 80 char, ITALIANO)

Rispondi SOLO con JSON valido, NIENTE altro testo o markdown.`

    // ─────── Tentativo 1: CLI plan mode (no API cost) ───────
    if (accountMode === 'plan') {
      const { spawnCliPrintMode, resolveCheapModelForPlan, parseCliJsonOutput } = await import(
        '../lib/cli-print-mode'
      )
      // accountProviderId è 'anthropic' | 'google' | 'openai' nel registry (non 'gemini')
      const cheap = resolveCheapModelForPlan(accountProviderId || 'anthropic')
      if (cheap) {
        const result = await spawnCliPrintMode({
          cli: cheap.cli,
          prompt,
          model: cheap.model,
          timeoutMs: 30_000,
        })
        if (result.ok && result.stdout) {
          const parsed = parseCliJsonOutput<{
            title?: string
            summary?: string
            options?: Array<{ num: string; label: string }>
          }>(result.stdout)
          if (parsed) {
            logger.info(
              `[briefs] summarize via CLI plan ${cheap.cli}/${cheap.model} (${result.durationMs}ms)`
            )
            return res.json({
              title: typeof parsed.title === 'string' ? parsed.title.slice(0, 200) : null,
              summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : null,
              options: Array.isArray(parsed.options) ? parsed.options.slice(0, 6) : null,
              provider,
              mode: 'plan',
              fallback: false,
            })
          }
          logger.warn(
            `[briefs] CLI plan parse failed for ${cheap.cli}, falling through to API REST`
          )
        } else {
          logger.warn(
            `[briefs] CLI plan ${cheap.cli} failed (${result.error || result.exitCode}): ${result.stderr.slice(-200)}`
          )
        }
      } else {
        logger.info(
          `[briefs] no CLI plan support for provider=${accountProviderId}, trying API REST`
        )
      }
    }

    // ─────── Tentativo 2: API REST con env key ───────
    const apiKey = {
      anthropic: process.env.ANTHROPIC_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
    }[provider]
    if (!apiKey) {
      return res.json({
        title: null,
        summary: null,
        options: null,
        fallback: 'no_api_key',
        provider,
        accountMode,
      })
    }

    try {
      let parsed: { title?: string; summary?: string; options?: Array<{ num: string; label: string }> } = {}
      if (provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 600,
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        if (!r.ok) throw new Error(`anthropic_${r.status}`)
        const data = (await r.json()) as { content?: Array<{ text?: string }> }
        const text = data.content?.[0]?.text || '{}'
        // Strip eventuali fence ```json ... ``` se il modello li mette
        const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
        parsed = JSON.parse(cleaned)
      } else if (provider === 'openai') {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            max_tokens: 600,
            response_format: { type: 'json_object' },
            messages: [{ role: 'user', content: prompt }],
          }),
        })
        if (!r.ok) throw new Error(`openai_${r.status}`)
        const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> }
        const text = data.choices?.[0]?.message?.content || '{}'
        parsed = JSON.parse(text)
      } else {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 600 },
            }),
          }
        )
        if (!r.ok) throw new Error(`gemini_${r.status}`)
        const data = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
        parsed = JSON.parse(text)
      }

      logger.info(`[briefs] summarize via API REST ${provider}`)
      res.json({
        title: typeof parsed.title === 'string' ? parsed.title.slice(0, 200) : null,
        summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : null,
        options: Array.isArray(parsed.options) ? parsed.options.slice(0, 6) : null,
        provider,
        mode: 'api',
        fallback: false,
      })
    } catch (err) {
      logger.warn(`[briefs] summarize ${provider} API REST failed:`, (err as Error).message)
      res.json({
        title: null,
        summary: null,
        options: null,
        fallback: 'api_error',
        provider,
        error: String((err as Error).message).slice(0, 200),
      })
    }
  })

  return router
}

// V15.0 WS23 — In-memory dedupe map per POST /decision (TTL 30s).
// Evita duplicati quando frontend POST 2 volte (StrictMode dev, mount race, retry).
const inSessionDedupeMap = new Map<string, { briefId: string; decisionId: string; createdAt: number }>()
const IN_SESSION_DEDUPE_TTL_MS = 30_000

function pruneInSessionDedupe(): void {
  const now = Date.now()
  for (const [k, v] of inSessionDedupeMap.entries()) {
    if (now - v.createdAt > IN_SESSION_DEDUPE_TTL_MS) inSessionDedupeMap.delete(k)
  }
}

function inSessionDedupeKey(projectId: string, title: string, soluzione: string): string {
  // Hash leggero (djb2-like) sui primi 100 char di soluzione + title
  const content = `${title}|${soluzione.slice(0, 100)}`
  let h = 5381
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) + h) + content.charCodeAt(i)
    h |= 0
  }
  return `${projectId}:${h}`
}
