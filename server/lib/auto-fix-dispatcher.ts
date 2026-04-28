import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'
import { createNotification, updateNotification, getNotification, type AutoFixNotification } from './notifications-store'
import type { ErrorAggregate } from './error-pipeline'

const execFileAsync = promisify(execFile)

/**
 * V14.28 Step 3 — Auto-Fix Dispatcher.
 *
 * Decision tree:
 *   knownFix.autoFix === SAFE && cron.autoFix === ON  → executeFixScript()
 *   knownFix.autoFix === SAFE && cron.autoFix === OFF → writeNotification()
 *   knownFix.autoFix === REQUIRES-APPROVAL            → writeNotification()
 *   knownFix.autoFix === MANUAL || !knownFix          → skip
 */

const SCRIPTS_DIR = path.join(process.cwd(), 'scripts', 'auto-fix')
const AUDIT_DIR = path.join(process.cwd(), 'data', 'audit')
const LOCK_FILE = path.join(process.cwd(), 'data', '.auto-fix.lock')
const DEFAULT_TIMEOUT_MS = 60_000
const LOCK_STALE_MS = 5 * 60 * 1000 // 5min

export interface DispatchOptions {
  cronAutoFixEnabled: boolean
  trigger: 'auto' | 'manual' | 'force'
  notificationId?: string // se trigger=manual, riferimento alla notification approvata
}

export interface DispatchResult {
  action: 'executed' | 'notified' | 'skipped'
  success?: boolean
  notificationId?: string
  exitCode?: number
  durationMs?: number
  error?: string
  rollbackUsed?: boolean
}

interface ScriptHeader {
  safe: boolean
  approval: boolean
  timeout: number
  description?: string
  rollback?: string
}

async function parseScriptHeader(scriptPath: string): Promise<ScriptHeader> {
  const content = await fs.readFile(scriptPath, 'utf-8')
  const lines = content.split(/\r?\n/).slice(0, 30) // primi 30 righe
  const header: ScriptHeader = { safe: false, approval: false, timeout: DEFAULT_TIMEOUT_MS }
  for (const ln of lines) {
    if (/^#\s*@safe\b/i.test(ln)) header.safe = true
    if (/^#\s*@approval\b/i.test(ln)) header.approval = true
    const t = ln.match(/^#\s*@timeout\s*=\s*(\d+)/i)
    if (t) header.timeout = parseInt(t[1], 10) * 1000
    const d = ln.match(/^#\s*@description\s*=\s*(.+)$/i)
    if (d) header.description = d[1].trim()
    const r = ln.match(/^#\s*@rollback\s*=\s*(.+)$/i)
    if (r) header.rollback = r[1].trim()
  }
  return header
}

async function validateScriptPath(scriptName: string): Promise<{ valid: boolean; reason?: string; absPath?: string }> {
  // No path traversal: deve essere file dentro SCRIPTS_DIR senza ../
  const baseName = path.basename(scriptName)
  if (baseName !== scriptName.replace(/^scripts\/auto-fix\//, '')) {
    return { valid: false, reason: 'path traversal blocked' }
  }
  const absPath = path.join(SCRIPTS_DIR, baseName)
  const rel = path.relative(SCRIPTS_DIR, absPath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { valid: false, reason: 'script outside whitelist dir' }
  }
  try {
    await fs.access(absPath)
    return { valid: true, absPath }
  } catch {
    return { valid: false, reason: `script not found: ${absPath}` }
  }
}

async function acquireLock(): Promise<boolean> {
  try {
    const existing = await fs.stat(LOCK_FILE).catch(() => null)
    if (existing) {
      const age = Date.now() - existing.mtimeMs
      if (age < LOCK_STALE_MS) return false // lock vivo
      // stale lock → reclaim
      logger.warn(`auto-fix: stale lock (age=${Math.round(age / 1000)}s), reclaiming`)
    }
    await fs.writeFile(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: new Date().toISOString() }), 'utf-8')
    return true
  } catch (err: any) {
    logger.error(`auto-fix: lock acquire failed: ${err.message}`)
    return false
  }
}

async function releaseLock(): Promise<void> {
  await fs.unlink(LOCK_FILE).catch(() => {})
}

async function appendAudit(entry: object): Promise<void> {
  const ym = new Date().toISOString().slice(0, 7).replace('-', '')
  const file = path.join(AUDIT_DIR, `auto-fix-attempts-${ym}.jsonl`)
  await fs.mkdir(AUDIT_DIR, { recursive: true })
  await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf-8')
}

async function executeFixScript(
  scriptName: string,
  args: { vpsId: string; pattern: string },
  trigger: 'auto' | 'manual' | 'force'
): Promise<DispatchResult> {
  const validation = await validateScriptPath(scriptName)
  if (!validation.valid) {
    return { action: 'skipped', success: false, error: validation.reason }
  }
  const header = await parseScriptHeader(validation.absPath!)
  if (!header.safe && trigger === 'auto') {
    return { action: 'skipped', success: false, error: 'script missing # @safe header (auto trigger required SAFE)' }
  }

  const acquired = await acquireLock()
  if (!acquired) {
    return { action: 'skipped', success: false, error: 'another fix in progress (mutex busy)' }
  }

  const start = Date.now()
  let exitCode = 0
  let stdout = ''
  let stderr = ''
  let rollbackUsed = false
  let rollbackExitCode: number | undefined

  try {
    const result = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', validation.absPath!,
        '-VpsId', args.vpsId,
        '-Pattern', args.pattern,
      ],
      { timeout: header.timeout, encoding: 'utf-8' }
    )
    stdout = result.stdout
    stderr = result.stderr
  } catch (err: any) {
    exitCode = err.code || 1
    stdout = err.stdout || ''
    stderr = err.stderr || err.message || ''

    // Try rollback if companion exists
    if (header.rollback) {
      const rbValidation = await validateScriptPath(header.rollback)
      if (rbValidation.valid) {
        try {
          await execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', rbValidation.absPath!,
            '-VpsId', args.vpsId,
            '-Pattern', args.pattern,
          ], { timeout: header.timeout, encoding: 'utf-8' })
          rollbackUsed = true
          rollbackExitCode = 0
        } catch (rbErr: any) {
          rollbackUsed = true
          rollbackExitCode = rbErr.code || 1
          logger.error(`auto-fix: rollback ${header.rollback} failed: ${rbErr.message}`)
        }
      }
    }
  } finally {
    await releaseLock()
  }

  const durationMs = Date.now() - start
  const success = exitCode === 0
  await appendAudit({
    ts: new Date().toISOString(),
    vpsId: args.vpsId,
    pattern: args.pattern,
    script: scriptName,
    trigger,
    exitCode,
    durationMs,
    success,
    stdout: stdout.slice(0, 500),
    stderr: stderr.slice(0, 500),
    rollbackUsed,
    rollbackExitCode,
  })

  return {
    action: 'executed',
    success,
    exitCode,
    durationMs,
    error: success ? undefined : (stderr || `exit ${exitCode}`),
    rollbackUsed,
  }
}

async function writeNotification(aggregate: ErrorAggregate): Promise<DispatchResult> {
  const notif = await createNotification({
    type: 'auto-fix-pending',
    vpsId: aggregate.vpsId,
    errorPattern: aggregate.knownFix?.slug || aggregate.patternRaw,
    errorSamples: aggregate.samples,
    occurrenceCount: aggregate.count,
    knownFix: aggregate.knownFix
      ? {
          slug: aggregate.knownFix.slug,
          autoFix: aggregate.knownFix.autoFix,
          fixScript: aggregate.knownFix.fixScript,
          description: aggregate.knownFix.description,
          hint: aggregate.knownFix.hint,
        }
      : null,
  })
  return { action: 'notified', notificationId: notif.id }
}

/**
 * Public API — dispatchFix per un singolo aggregate.
 * Chiamato dal pipeline alla fine di Layer 2/3 (oppure manualmente da UI approve).
 */
export async function dispatchFix(
  aggregate: ErrorAggregate,
  options: DispatchOptions
): Promise<DispatchResult> {
  // No knownFix → skip (Layer 4 AI ha messaggi ma non script eseguibili)
  if (!aggregate.knownFix) {
    return { action: 'skipped', error: 'no knownFix' }
  }
  const { autoFix, fixScript } = aggregate.knownFix

  // MANUAL → no-op
  if (autoFix === 'MANUAL') {
    return { action: 'skipped', error: 'autoFix=MANUAL (no automation)' }
  }

  // SAFE + cron toggle ON → execute auto
  if (autoFix === 'SAFE' && options.cronAutoFixEnabled && options.trigger === 'auto' && fixScript) {
    return executeFixScript(fixScript, { vpsId: aggregate.vpsId, pattern: aggregate.patternRaw }, 'auto')
  }

  // Manual trigger (utente ha approvato notification) → execute
  if (options.trigger === 'manual' && fixScript) {
    return executeFixScript(fixScript, { vpsId: aggregate.vpsId, pattern: aggregate.patternRaw }, 'manual')
  }

  // SAFE + toggle OFF, oppure REQUIRES-APPROVAL → notification
  return writeNotification(aggregate)
}

/**
 * Approva una notification: esegue il fix script associato.
 */
export async function approveNotification(notifId: string): Promise<DispatchResult> {
  const notif = await getNotification(notifId)
  if (!notif) return { action: 'skipped', error: 'notification not found' }
  if (notif.status !== 'pending') return { action: 'skipped', error: `notification status=${notif.status}` }
  if (!notif.knownFix?.fixScript) return { action: 'skipped', error: 'no fixScript in notification' }

  // Mark approved
  await updateNotification(notifId, { status: 'approved', resolvedAt: new Date().toISOString() })

  // Build minimal aggregate from notification per re-use dispatchFix
  const fakeAggregate: any = {
    vpsId: notif.vpsId,
    patternRaw: notif.errorPattern,
    knownFix: {
      slug: notif.knownFix.slug,
      autoFix: notif.knownFix.autoFix,
      fixScript: notif.knownFix.fixScript,
      severity: 'medium',
      pattern: new RegExp(''),
      patternRaw: notif.errorPattern,
    },
    samples: notif.errorSamples,
    count: notif.occurrenceCount,
    firstSeen: notif.createdAt,
    lastSeen: notif.createdAt,
    severity: 'medium',
    source: 'notification',
    patternKey: notif.knownFix.slug,
  }

  const result = await dispatchFix(fakeAggregate, { cronAutoFixEnabled: true, trigger: 'manual', notificationId: notifId })
  await updateNotification(notifId, {
    status: result.success ? 'executed' : 'failed',
    resolutionNote: result.success ? `Executed in ${result.durationMs}ms` : (result.error || 'failed'),
  })
  return result
}

export async function dismissNotification(notifId: string, note?: string): Promise<boolean> {
  const result = await updateNotification(notifId, {
    status: 'dismissed',
    resolvedAt: new Date().toISOString(),
    resolutionNote: note || 'dismissed by user',
  })
  return !!result
}
