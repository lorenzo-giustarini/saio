import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ResponseSchema, type Response as ResponseType, type Brief } from '../../shared/schemas'
import { BriefSchema } from '../../shared/schemas'
import { atomicWriteFile, backupIfExists } from '../lib/atomic-write'
import { sanitizeFilename } from '../lib/sanitize'
import { logger } from '../lib/logger'
import { triggerOrchestrator } from '../lib/orchestrator-client'

export function responsesRouter(dataDir: string) {
  const router = Router()
  const responsesDir = path.join(dataDir, 'responses')
  const briefsDir = path.join(dataDir, 'briefs')
  const backupDir = path.join(dataDir, 'logs', 'response-backups')
  const locksDir = path.join(dataDir, 'locks')

  const LOCK_FILE = path.join(locksDir, 'response-submission.lock')
  const LOCK_TTL_MS = 10_000

  async function acquireLock(): Promise<boolean> {
    try {
      const stat = await fs.stat(LOCK_FILE).catch(() => null)
      if (stat) {
        const age = Date.now() - stat.mtimeMs
        if (age < LOCK_TTL_MS) return false
      }
      await fs.writeFile(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: Date.now() }))
      return true
    } catch {
      return false
    }
  }

  async function releaseLock() {
    try {
      await fs.unlink(LOCK_FILE)
    } catch {
      /* ignore */
    }
  }

  // POST /api/responses
  router.post('/', async (req, res) => {
    const parseResult = ResponseSchema.safeParse(req.body)
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid response payload',
        issues: parseResult.error.issues,
      })
    }
    const response: ResponseType = parseResult.data

    const locked = await acquireLock()
    if (!locked) {
      return res.status(429).json({ error: 'Another submission in progress, retry' })
    }

    try {
      // Load the original brief for context
      const briefPath = path.join(briefsDir, `${response.briefId}.json`)
      let brief: Brief | null = null
      try {
        const raw = await fs.readFile(briefPath, 'utf8')
        brief = BriefSchema.parse(JSON.parse(raw))
      } catch {
        return res.status(404).json({ error: `Brief ${response.briefId} not found` })
      }

      const baseName = sanitizeFilename(
        `user-response-${new Date().toISOString().slice(0, 10)}-${brief.type}`
      )
      const jsonPath = path.join(responsesDir, `${baseName}.json`)
      const txtPath = path.join(responsesDir, `${baseName}.txt`)

      // Backup existing (rare but possible if second response same day)
      await backupIfExists(jsonPath, backupDir)
      await backupIfExists(txtPath, backupDir)

      // Write JSON
      await atomicWriteFile(jsonPath, JSON.stringify(response, null, 2))

      // Write human-readable markdown
      const md = renderResponseMarkdown(brief, response)
      await atomicWriteFile(txtPath, md)

      logger.info(`Response saved: ${baseName}`)

      // Archive the brief so it disappears from Inbox (once answered)
      try {
        const archiveBriefsDir = path.join(dataDir, 'archive', 'briefs')
        await fs.mkdir(archiveBriefsDir, { recursive: true })
        const archivedBriefPath = path.join(archiveBriefsDir, `${baseName}.json`)
        await fs.rename(briefPath, archivedBriefPath)
        logger.info(`Brief archived: ${archivedBriefPath}`)
      } catch (archErr) {
        // Non-fatal: response already saved, just log
        logger.warn(`Brief archive failed (continuing):`, archErr)
      }

      // Trigger orchestrator (non-blocking, best-effort)
      let orchResult: any = { spawned: false, error: 'not attempted' }
      try {
        orchResult = await triggerOrchestrator({
          responsePath: jsonPath,
          briefPath,
          dataDir,
        })
      } catch (orchErr: any) {
        logger.error('Orchestrator trigger error (response already saved):', orchErr)
        orchResult = { spawned: false, error: String(orchErr?.message || orchErr) }
      }

      res.json({
        ok: true,
        savedTo: jsonPath,
        markdownTo: txtPath,
        orchestrator: orchResult,
      })
    } catch (err: any) {
      const detail = err?.message || String(err)
      logger.error(`Response save failed: ${detail}`, err)
      res.status(500).json({ error: 'Failed to save response', detail })
    } finally {
      await releaseLock()
    }
  })

  return router
}

function renderResponseMarkdown(brief: Brief, resp: ResponseType): string {
  const lines: string[] = []
  lines.push(`# Risposte ${brief.type.toUpperCase()} — ${new Date(resp.submittedAt).toLocaleString('it-IT')}`)
  lines.push('')
  lines.push(`**Brief ID**: ${brief.id}`)
  lines.push(`**Titolo brief**: ${brief.title}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const entry of resp.entries) {
    const decision = brief.decisions.find((d) => d.id === entry.decisionId)
    if (!decision) continue
    const icon =
      entry.answer === 'yes' ? '✅'
      : entry.answer === 'no' ? '❌'
      : entry.answer === 'skip' ? '⏭️'
      : '💬'
    lines.push(`## ${icon} ${decision.title}`)
    lines.push('')
    lines.push(`**Risposta**: \`${entry.answer}\``)
    if (decision.projectTarget) {
      lines.push(`**Progetto**: ${decision.projectTarget}`)
    }
    if (entry.comment) {
      lines.push('')
      lines.push('**Commento utente**:')
      lines.push('> ' + entry.comment.split('\n').join('\n> '))
    }
    if (entry.voiceUsed) {
      lines.push('')
      lines.push('_(commento dettato vocalmente)_')
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  if (resp.globalComment) {
    lines.push('## 🗨️ Commento globale')
    lines.push('')
    lines.push(resp.globalComment)
    lines.push('')
  }

  return lines.join('\n')
}
