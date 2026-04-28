import { Router } from 'express'
import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from '../lib/logger'
import { isElevatorAvailable, runViaElevator, invalidateElevatorCache } from '../lib/elevator'
import { getAllCronMeta, setCronMeta, deleteCronMeta as deleteCronMetaSidecar, renameCronMeta } from '../lib/cronMeta'
import { listNotifications, archiveStale } from '../lib/notifications-store'
import { approveNotification, dismissNotification } from '../lib/auto-fix-dispatcher'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

interface CronTask {
  name: string
  next: string | null
  last: string | null
  status: string
  enabled: boolean
  description: string
  details?: string
  lastResult?: string
  schedule?: string
  // V14.28 — auto-fix toggle (solo per cron error-handling capable)
  errorHandlingCapable?: boolean
  autoFix?: boolean | null
}

/**
 * V14.28 — cron che processano errori e supportano auto-fix toggle.
 * I cron in questa lista mostrano il Switch UI nella CronCard.
 */
const ERROR_HANDLING_CRONS = new Set([
  'Obsidian-Providers-Errors-Hourly',
  'Obsidian-VPS-Errors-Daily',
  'Obsidian-Extract-Errors-Daily', // già esistente, ora con toggle disponibile
])

// Known Obsidian automation descriptions
// V14.23 — aggiunto field `details` per descrizione espandibile in UI
const KNOWN_DESCRIPTIONS: Record<string, { desc: string; schedule: string; details?: string }> = {
  'Obsidian-Daily-Cockpit': {
    desc: 'Genera daily note con calendar + task overdue + progetti attivi',
    schedule: 'Ogni giorno 07:30',
    details:
      'Ogni mattina alle 07:30 invoca Claude CLI in modalità readonly (no Write/Edit) sul vault Obsidian locale. ' +
      "Estrae: priorità top 3 della giornata, tabella progetti attivi con stato, task urgenti con scadenze, decisioni aperte in inbox, stato VPS, item overdue trascinati, reminder, da dove ripartire. " +
      "Output salvato in <vault>/daily/<YYYY-MM-DD>.md. Se output >100 char viene anche pushato nella coda email per il dispatcher. " +
      "Vantaggio: ogni mattina hai un cockpit pronto da leggere senza dover ricostruire il contesto.",
  },
  'Obsidian-Health-Weekly': {
    desc: 'Vault health audit: broken links, stale notes, tag duplicati',
    schedule: 'Ogni lunedì 09:30',
    details:
      'Audit settimanale del vault: scansiona tutte le note .md, identifica broken links [[note-mancante]], note stale (>90 giorni senza modifica), tag duplicati con varianti (es. #vps vs #VPS). ' +
      'Output: report markdown in <vault>/audit/health-<YYYY-W>.md con score globale, samples e raccomandazioni. ' +
      'Vantaggio: previene la "memory rot" del vault tenendo traccia di link rotti e note che invecchiano senza essere consultate.',
  },
  'Obsidian-Session-Save-EOD': {
    desc: 'Salva sessione End-of-Day + extract error patterns',
    schedule: 'Ogni sera 00:30',
    details:
      "A mezzanotte estrae il sommario delle sessioni Claude/Codex dell'ultimo giorno (lette da ~/.claude/projects/.../*.jsonl), identifica pattern d'errore ricorrenti, salva in <vault>/sessions/EOD-<YYYY-MM-DD>.md. " +
      'Vantaggio: trasformi le sessioni grezze in conoscenza incrementale per il vault, individua errori ripetuti che meritano un feedback memo.',
  },
  'Obsidian-Connect-Weekly': {
    desc: 'Trova connessioni non ovvie tra note, evidenzia pattern',
    schedule: 'Ogni sabato 09:00',
    details:
      'Sabato mattina analizza il vault cercando connessioni semantiche tra note che non sono linkate ma trattano lo stesso topic. ' +
      'Output: report con suggerimenti di [[link]] da aggiungere. Vantaggio: il vault diventa più "graph-like" senza dover ricordare ogni connessione.',
  },
  'Obsidian-Pattern-Deep-Scan': {
    desc: 'Deep scan pattern tecnici consolidati + proposte nuovi pattern',
    schedule: 'Ogni giorno 01:00',
    details:
      "Ogni notte alle 01:00 analizza pattern tecnici consolidati nel vault (anti-flood, retry, queue recovery, AI timeout, n8n v3, ecc.). " +
      'Identifica nuovi pattern emergenti dal flusso recente di sessioni e propone aggiunta a <vault>/patterns/. ' +
      'Vantaggio: il catalogo pattern cresce organicamente da osservazione reale, non solo manuale.',
  },
  'Obsidian-Extract-Errors-Daily': {
    desc: 'Estrae error patterns dai session log ultimi 24h',
    schedule: 'Ogni giorno 01:30',
    details:
      'Daily extraction: legge log delle ultime 24h, identifica error patterns (stack trace ricorrenti, problemi VPS, timeout AI). ' +
      'Output: <vault>/errors/<YYYY-MM-DD>.md con categorizzazione + count. Vantaggio: feed continuo di osservazioni per migliorare gli script + roadmap fix.',
  },
  'Obsidian-GitHub-AI-Trending': {
    desc: 'Scan GitHub per AI repo trending + valuta rilevanza per vault',
    schedule: 'Ogni domenica 03:30',
    details:
      'Domenica notte scan GitHub trending in categoria AI/Claude/MCP/Agents, filtra per rilevanza al tuo lavoro, salva in <vault>/research/github-trending-<YYYY-W>.md. ' +
      'Vantaggio: scopri tool nuovi senza dover scrollare GitHub manualmente.',
  },
  'Obsidian-Hot-Topics-Weekly': {
    desc: 'Identifica hot topics in vault + proposta wiki pages',
    schedule: 'Ogni venerdì 02:00',
    details:
      'Venerdì notte identifica i topic più toccati nel vault questa settimana (frequency analysis), propone creazione di MOC wiki pages se mancanti. ' +
      'Vantaggio: il vault si auto-organizza con MOC che riflettono il focus reale, non a priori.',
  },
  'Obsidian-Serendipity-Scan': {
    desc: 'Scan serendipity: trova collegamenti random tra note',
    schedule: 'Ogni giorno 02:00',
    details:
      'Ogni notte un meccanismo "lottery" propone 1-2 collegamenti tra note distanti tra loro temalmente, per stimolare insight inaspettati. ' +
      'Output: <vault>/serendipity/<YYYY-MM-DD>.md (1 paragrafo). Vantaggio: rompi i silos cognitivi del vault.',
  },
  'Obsidian-Anthropic-Weekly': {
    desc: 'Update vault con news Anthropic/Claude + best practices',
    schedule: 'Ogni domenica 02:00',
    details:
      'Aggiornamento settimanale: scansiona blog/changelog Anthropic, modelli Claude, best practices CLI/SDK/MCP. ' +
      'Output in <vault>/research/anthropic-week-<YYYY-W>.md. Vantaggio: rimani aggiornato sul provider principale senza monitorare manualmente.',
  },
  'Obsidian-Ecosystem-Update': {
    desc: 'Scan ecosistema Claude Code: nuove skill, MCP, agenti',
    schedule: 'Ogni mercoledì 02:00',
    details:
      'Mercoledì notte scansiona ecosistema Claude Code (registry skill, marketplace MCP, repo awesome-claude, agenti pubblicati). ' +
      'Identifica novità da valutare per AgencyOS. Output in <vault>/research/ecosystem-<YYYY-W>.md. Vantaggio: copri tutto l\'ecosistema senza monitoring manuale.',
  },
  'RM-Dashboard-Feedback-AI': {
    desc: 'Elabora feedback con AI 2-step (V14.19): meta-prompt + exec',
    schedule: 'Ogni giorno 03:00',
    details:
      'Per ogni nota di feedback non processata: Step A invia il testo a Claude per generare un prompt mirato, Step B esegue quel prompt e ottiene JSON con causa/effetto/rischi/soluzione. ' +
      'Aggrega tutte le decisioni in 1 brief Inbox <data/briefs/feedback-digest-<date>.json>. Vantaggio: trasforma le tue note rapide in proposte di azione strutturate, pronte da approvare in Inbox.',
  },
}

async function listTasks(): Promise<CronTask[]> {
  try {
    const { stdout } = await execAsync('schtasks /query /fo CSV /v', {
      maxBuffer: 20 * 1024 * 1024,
      encoding: 'utf-8',
    })
    const lines = stdout.split(/\r?\n/).filter(Boolean)
    if (lines.length < 2) return []

    // Parse CSV header
    const header = parseCsvLine(lines[0])
    const nameIdx = header.findIndex((h) => h.includes('TaskName') || h.includes('Nome attivit'))
    const nextIdx = header.findIndex((h) => h.includes('Next Run') || h.includes('Prossima esec'))
    const lastIdx = header.findIndex((h) => h.includes('Last Run') || h.includes('Ultima esec'))
    // V14.25 — match esatto su "Status" / "Stato" per il field runtime (col 4),
    // evitando di matchare "Stato attività pianificata" (col 12) che è il field
    // veramente affidabile per enabled/disabled.
    const statusIdx = header.findIndex((h) => h === 'Status' || h === 'Stato')
    const scheduledStateIdx = header.findIndex(
      (h) => h.includes('Scheduled Task State') || h.toLowerCase().includes('attività pianificat')
    )
    const resultIdx = header.findIndex((h) => h.includes('Last Result') || h.includes('Ultimo risultato'))
    // V14.27 — Comment field nativo schtasks (col 10): description short-form.
    // Match esatto per evitare conflitto con altri header che contengono "Comment".
    const commentIdx = header.findIndex((h) => h === 'Comment' || h === 'Commento')
    // V14.27 — campi per derivare schedule fallback se non in sidecar
    const scheduleTypeIdx = header.findIndex(
      (h) => h.includes('Schedule Type') || h.toLowerCase().includes('tipo di pianificazione')
    )
    const startTimeIdx = header.findIndex(
      (h) => h.includes('Start Time') || h.toLowerCase().includes('ora di avvio')
    )

    // V14.27 — task interni di sistema dashboard (nascosti dalla UI list).
    // Restano accessibili solo via endpoint dedicati (es. /elevator/status).
    const INTERNAL_TASKS = new Set(['RM-Saio-Tauri-Elevator'])

    // V14.27 — load sidecar metadata (long-form details + custom schedule labels)
    const allMeta = await getAllCronMeta()

    const tasks: CronTask[] = []
    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i])
      if (row.length < 3) continue
      const fullName = row[nameIdx] || ''
      const name = fullName.replace(/^\\/, '')
      if (!name.toLowerCase().includes('obsidian') && !name.toLowerCase().includes('claude') && !name.toLowerCase().includes('rm-dashboard')) continue
      if (INTERNAL_TASKS.has(name)) continue // V14.27 — nasconde Cron-Manager dalla UI

      // V14.27 — FALLBACK ONLY: usato solo se Comment field e cron-meta.json sidecar
      // entrambi vuoti (es. task creato manualmente fuori dalla dashboard senza commento).
      const known = KNOWN_DESCRIPTIONS[name]

      const status = row[statusIdx] || 'unknown'
      const scheduledState = scheduledStateIdx >= 0 ? row[scheduledStateIdx] || '' : ''
      const enabled =
        scheduledStateIdx >= 0
          ? !/disabil|disabled/i.test(scheduledState)
          : !/disabil|disabled/i.test(status)

      // V14.27 — sources priority: Comment field (sistema) > sidecar (custom) > KNOWN fallback
      const commentRaw = (commentIdx >= 0 ? (row[commentIdx] || '').trim() : '')
      const meta = allMeta[name] || {}
      const description =
        commentRaw ||
        known?.desc ||
        `Automazione cron: ${name}`
      const details = meta.details || known?.details
      // Schedule label: sidecar > KNOWN > inferred from CSV
      const schedule =
        meta.schedule ||
        known?.schedule ||
        inferSchedule(scheduleTypeIdx >= 0 ? row[scheduleTypeIdx] : '', startTimeIdx >= 0 ? row[startTimeIdx] : '')

      // V14.28 — auto-fix capability + state per cron error-handling
      const errorHandlingCapable = ERROR_HANDLING_CRONS.has(name)
      const autoFix = errorHandlingCapable ? (meta.autoFix ?? false) : null

      tasks.push({
        name,
        next: row[nextIdx] || null,
        last: row[lastIdx] || null,
        status,
        enabled,
        description,
        details,
        schedule,
        lastResult: row[resultIdx] || undefined,
        errorHandlingCapable,
        autoFix,
      })
    }
    // Unique per name
    const uniq = new Map<string, CronTask>()
    for (const t of tasks) {
      if (!uniq.has(t.name)) uniq.set(t.name, t)
    }
    return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    logger.error('listTasks failed:', err)
    return []
  }
}

/**
 * V14.27 — Derive schedule label leggibile dai campi CSV "Tipo di pianificazione"
 * e "Ora di avvio" quando sidecar/KNOWN mancano.
 */
function inferSchedule(type: string, time: string): string | undefined {
  const t = (type || '').trim().toLowerCase()
  const ts = (time || '').trim()
  if (!t) return undefined
  if (t.includes('giorno') || t.includes('daily')) return ts ? `Daily ${ts}` : 'Daily'
  if (t.includes('settiman') || t.includes('weekly')) return ts ? `Weekly ${ts}` : 'Weekly'
  if (t.includes('mens') || t.includes('monthly')) return ts ? `Monthly ${ts}` : 'Monthly'
  if (t.includes('once') || t.includes('una volta')) return ts ? `Once ${ts}` : 'Once'
  return type
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"' && line[i + 1] === '"') {
      cur += '"'
      i++
    } else if (c === '"') {
      inQuotes = !inQuotes
    } else if (c === ',' && !inQuotes) {
      result.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  result.push(cur)
  return result
}

/**
 * V14.24 — Esegue schtasks in modalità elevated (admin) tramite UAC popup.
 * Wraps `Start-Process schtasks -ArgumentList @(...) -Verb RunAs -Wait -PassThru`.
 * UAC popup appare all'utente; se accetta, il comando esegue. Se rifiuta o c'è
 * errore, lancia eccezione.
 *
 * NOTA: stdout/stderr di schtasks NON sono catturabili in -Verb RunAs perché la
 * nuova finestra è isolata. Catturo solo l'exit code via -PassThru + ExitCode.
 *
 * V14.26 — fix critico: gli args venivano passati come UNA stringa singola
 * `"/change /tn X /disable"`, ma con quoting nidificato cmd→powershell→schtasks
 * il param veniva visto da schtasks come argomento unico malformato → exit 0
 * silente, task NON modificato. Fix: spawn diretto powershell.exe via execFile
 * con args array (no shell quoting) + `-ArgumentList @('/change','/tn','...')`
 * (PowerShell array literal, ogni token separato per schtasks).
 */
async function runElevatedSchtasks(args: string): Promise<void> {
  // Tokenizza args (es. "/change /tn TaskName /disable" -> ['/change','/tn','TaskName','/disable'])
  const tokens = args.split(/\s+/).filter(Boolean)
  // Costruisci array literal PowerShell con single-quote escape
  const psArrayLiteral = tokens.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')
  const psCmd = `$p = Start-Process -FilePath schtasks.exe -ArgumentList @(${psArrayLiteral}) -Verb RunAs -Wait -PassThru -WindowStyle Hidden; if ($null -eq $p) { exit 1 }; if ($p.ExitCode -ne 0) { exit $p.ExitCode }`
  // execFile evita shell quoting: ogni arg viene passato letterale a powershell.exe
  await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', psCmd],
    { encoding: 'utf-8', timeout: 60_000 }
  )
}

export function cronRouter() {
  const router = Router()

  router.get('/', async (_req, res) => {
    const tasks = await listTasks()
    res.json({ tasks, count: tasks.length, updatedAt: new Date().toISOString() })
  })

  // V14.19 — Health endpoint: per ogni task, stato derivato da log + last result
  router.get('/health', async (_req, res) => {
    try {
      const tasks = await listTasks()
      const vaultLogsDir = path.join(
        os.homedir(),
        '.claude',
        'projects',
        'C--Users-info-Desktop-CLAUDE-WORLD',
        'memory',
        'logs'
      )
      const dashboardLogsDir = path.join(process.cwd(), 'data', 'logs')

      const health = await Promise.all(
        tasks.map(async (task) => {
          // Prefix matching: Obsidian-Daily-Cockpit -> "obsidian-daily*"
          const prefix = task.name.toLowerCase().replace(/^(obsidian|rm-dashboard)-/, '').slice(0, 25)
          const logDirs = [vaultLogsDir, dashboardLogsDir]
          let latestLog: { path: string; mtime: Date; preview: string } | null = null

          for (const dir of logDirs) {
            try {
              const files = await fs.readdir(dir)
              const matches = files.filter((f) =>
                f.toLowerCase().includes(prefix) ||
                f.toLowerCase().includes(task.name.toLowerCase().replace('rm-dashboard-', ''))
              )
              for (const f of matches) {
                const fp = path.join(dir, f)
                const stat = await fs.stat(fp)
                if (!latestLog || stat.mtime > latestLog.mtime) {
                  latestLog = { path: fp, mtime: stat.mtime, preview: '' }
                }
              }
            } catch {
              /* dir non esiste */
            }
          }

          if (latestLog) {
            try {
              const content = await fs.readFile(latestLog.path, 'utf8')
              latestLog.preview = content.slice(-2000) // Ultimi 2KB
            } catch { /* unreadable */ }
          }

          // Status derivation
          const lastResultStr = (task.lastResult || '').trim()
          const isError =
            lastResultStr.includes('1') ||
            lastResultStr.toLowerCase().includes('errore') ||
            (latestLog?.preview || '').toLowerCase().includes('error:') ||
            (latestLog?.preview || '').toLowerCase().includes('fatal')
          const last = task.last || ''
          const isStale = last.includes('1999') || last.includes('30/11') // "30/11/1999" = mai eseguito
          let status: 'ok' | 'failed' | 'stale' | 'unknown' = 'unknown'
          if (isStale) status = 'stale'
          else if (isError) status = 'failed'
          else if (latestLog) status = 'ok'

          return {
            name: task.name,
            description: task.description,
            schedule: task.schedule,
            enabled: task.enabled,
            lastRun: task.last,
            lastResult: task.lastResult,
            status,
            latestLogPath: latestLog?.path || null,
            latestLogMtime: latestLog?.mtime?.toISOString() || null,
            latestLogPreview: latestLog?.preview || null,
          }
        })
      )

      res.json({
        health,
        count: health.length,
        failed: health.filter((h) => h.status === 'failed').length,
        stale: health.filter((h) => h.status === 'stale').length,
        ok: health.filter((h) => h.status === 'ok').length,
        updatedAt: new Date().toISOString(),
      })
    } catch (err: any) {
      logger.error('cron/health failed:', err)
      res.status(500).json({ error: err?.message || String(err) })
    }
  })

  function validateTaskName(name: string): string | null {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'invalid task name'
    if (
      !name.toLowerCase().includes('obsidian') &&
      !name.toLowerCase().includes('claude') &&
      !name.toLowerCase().includes('rm-dashboard')
    ) {
      return 'task not allowed'
    }
    return null
  }

  // V14.23 — riconosce errore "Accesso negato" / "Access is denied" che Windows
  // ritorna su schtasks /change|/create senza privilegi admin.
  function isAdminRequiredError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase()
    return msg.includes('accesso negato') || msg.includes('access is denied')
  }

  // V14.27 — pre-check per rename/delete: blocca op su task in running.
  // Status runtime (col 4 CSV) = "In esecuzione" / "Running".
  async function isTaskRunning(name: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`schtasks /query /tn "${name}" /fo CSV /v`, { encoding: 'utf-8' })
      const lines = stdout.split(/\r?\n/).filter(Boolean)
      if (lines.length < 2) return false
      const header = parseCsvLine(lines[0])
      const statusIdx = header.findIndex((h) => h === 'Status' || h === 'Stato')
      if (statusIdx < 0) return false
      const row = parseCsvLine(lines[1])
      const status = (row[statusIdx] || '').trim().toLowerCase()
      return status === 'running' || status === 'in esecuzione'
    } catch {
      return false
    }
  }

  router.post('/:name/run', async (req, res) => {
    const name = String(req.params.name)
    const err = validateTaskName(name)
    if (err) return res.status(err === 'invalid task name' ? 400 : 403).json({ error: err })

    // V14.27 — try elevator first
    if (await isElevatorAvailable()) {
      const r = await runViaElevator({ op: 'run', taskName: name })
      if (r.ok) return res.json({ ok: true, stdout: r.output || '', viaElevator: true })
      logger.warn(`elevator run failed for ${name}, falling back: ${r.error}`)
    }

    try {
      const { stdout, stderr } = await execAsync(`schtasks /run /tn "${name}"`, { encoding: 'utf-8' })
      res.json({ ok: true, stdout: stdout.trim(), stderr: stderr.trim() })
    } catch (err: any) {
      if (isAdminRequiredError(err)) {
        return res.status(403).json({
          error: 'Operazione richiede privilegi admin Windows',
          errorCode: 'admin_required',
          hint: 'Riavvia la dashboard come Administrator oppure usa Task Scheduler GUI',
        })
      }
      res.status(500).json({ error: err.message })
    }
  })

  // V14.28 — PATCH auto-fix toggle: ON/OFF per cron error-handling
  router.patch('/:name/auto-fix', async (req, res) => {
    const name = String(req.params.name)
    const err = validateTaskName(name)
    if (err) return res.status(err === 'invalid task name' ? 400 : 403).json({ error: err })
    if (!ERROR_HANDLING_CRONS.has(name)) {
      return res.status(400).json({
        error: 'Questo cron non supporta auto-fix toggle',
        errorCode: 'not_capable',
      })
    }
    const { enabled } = req.body || {}
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'body.enabled deve essere boolean' })
    }
    try {
      await setCronMeta(name, { autoFix: enabled })
      res.json({ ok: true, name, autoFix: enabled })
    } catch (e: any) {
      logger.error(`auto-fix toggle failed: ${e.message}`)
      res.status(500).json({ error: e.message })
    }
  })

  // V14.28 Step 3 — Notifications endpoint (lista + approve + dismiss)
  router.get('/notifications', async (req, res) => {
    try {
      // Opportunistic archive di stale notifications all'init
      await archiveStale().catch(() => {})
      const status = req.query.status as any
      const list = await listNotifications(status ? { status } : undefined)
      res.json({ notifications: list, count: list.length, pendingCount: list.filter((n) => n.status === 'pending').length })
    } catch (err: any) {
      logger.error(`notifications list failed: ${err.message}`)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/notifications/:id/approve', async (req, res) => {
    try {
      const result = await approveNotification(String(req.params.id))
      res.json(result)
    } catch (err: any) {
      logger.error(`notification approve failed: ${err.message}`)
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/notifications/:id/dismiss', async (req, res) => {
    try {
      const note = req.body?.note ? String(req.body.note).slice(0, 200) : undefined
      const ok = await dismissNotification(String(req.params.id), note)
      if (!ok) return res.status(404).json({ error: 'notification not found' })
      res.json({ ok: true })
    } catch (err: any) {
      logger.error(`notification dismiss failed: ${err.message}`)
      res.status(500).json({ error: err.message })
    }
  })

  // V14.27 — endpoint per check stato Elevator (UI mostra warning "setup richiesto" se assente)
  router.get('/elevator/status', async (_req, res) => {
    invalidateElevatorCache()
    const available = await isElevatorAvailable()
    res.json({
      available,
      taskName: 'RM-Saio-Tauri-Elevator',
      setupCommand: available ? null : 'pwsh "scripts\\register-elevator.ps1"',
      hint: available
        ? 'Elevator attivo: nessun popup UAC sui toggle cron'
        : 'Elevator NON registrato: ogni toggle apre popup UAC. Esegui setup una volta.',
    })
  })

  router.post('/:name/enable', async (req, res) => {
    const name = String(req.params.name)
    const err = validateTaskName(name)
    if (err) return res.status(err === 'invalid task name' ? 400 : 403).json({ error: err })

    // V14.27 — try elevator first (zero UAC)
    if (await isElevatorAvailable()) {
      const r = await runViaElevator({ op: 'enable', taskName: name })
      if (r.ok) return res.json({ ok: true, enabled: true, viaElevator: true })
      logger.warn(`elevator enable failed for ${name}, falling back: ${r.error}`)
    }

    try {
      await execAsync(`schtasks /change /tn "${name}" /enable`, { encoding: 'utf-8' })
      res.json({ ok: true, enabled: true, elevated: false })
    } catch (err: any) {
      if (isAdminRequiredError(err)) {
        // V14.24 — auto-elevation via UAC popup (fallback)
        try {
          await runElevatedSchtasks(`/change /tn ${name} /enable`)
          return res.json({ ok: true, enabled: true, elevated: true })
        } catch (elevErr: any) {
          return res.status(403).json({
            error: 'Abilitazione fallita anche con UAC',
            errorCode: 'admin_denied',
            hint: 'Hai cliccato No al popup UAC, oppure UAC è disabilitato. Usa Task Scheduler GUI.',
            detail: String(elevErr?.message || elevErr).slice(0, 300),
          })
        }
      }
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/:name/disable', async (req, res) => {
    const name = String(req.params.name)
    const err = validateTaskName(name)
    if (err) return res.status(err === 'invalid task name' ? 400 : 403).json({ error: err })

    // V14.27 — try elevator first (zero UAC)
    if (await isElevatorAvailable()) {
      const r = await runViaElevator({ op: 'disable', taskName: name })
      if (r.ok) return res.json({ ok: true, enabled: false, viaElevator: true })
      logger.warn(`elevator disable failed for ${name}, falling back: ${r.error}`)
    }

    try {
      await execAsync(`schtasks /change /tn "${name}" /disable`, { encoding: 'utf-8' })
      res.json({ ok: true, enabled: false, elevated: false })
    } catch (err: any) {
      if (isAdminRequiredError(err)) {
        // V14.24 — auto-elevation via UAC popup (fallback)
        try {
          await runElevatedSchtasks(`/change /tn ${name} /disable`)
          return res.json({ ok: true, enabled: false, elevated: true })
        } catch (elevErr: any) {
          return res.status(403).json({
            error: 'Disabilitazione fallita anche con UAC',
            errorCode: 'admin_denied',
            hint: 'Hai cliccato No al popup UAC, oppure UAC è disabilitato. Usa Task Scheduler GUI.',
            detail: String(elevErr?.message || elevErr).slice(0, 300),
          })
        }
      }
      res.status(500).json({ error: err.message })
    }
  })

  // V14.27 — DELETE task scheduled (richiede admin in Windows)
  router.delete('/:name', async (req, res) => {
    const name = String(req.params.name)
    const err = validateTaskName(name)
    if (err) return res.status(err === 'invalid task name' ? 400 : 403).json({ error: err })

    // Pre-check: blocca delete se task running
    if (await isTaskRunning(name)) {
      return res.status(423).json({
        error: 'Task in esecuzione, riprova tra qualche minuto',
        errorCode: 'task_running',
      })
    }

    // Try elevator first
    if (await isElevatorAvailable()) {
      const r = await runViaElevator({ op: 'delete', taskName: name })
      if (r.ok) {
        await deleteCronMetaSidecar(name).catch(() => {}) // V14.27 — cleanup sidecar
        return res.json({ ok: true, viaElevator: true })
      }
      logger.warn(`elevator delete failed for ${name}: ${r.error}`)
    }

    try {
      await execAsync(`schtasks /delete /tn "${name}" /f`, { encoding: 'utf-8' })
      await deleteCronMetaSidecar(name).catch(() => {})
      res.json({ ok: true, elevated: false })
    } catch (err: any) {
      if (isAdminRequiredError(err)) {
        try {
          await runElevatedSchtasks(`/delete /tn ${name} /f`)
          await deleteCronMetaSidecar(name).catch(() => {})
          return res.json({ ok: true, elevated: true })
        } catch (elevErr: any) {
          return res.status(403).json({
            error: 'Eliminazione fallita anche con UAC',
            errorCode: 'admin_denied',
            detail: String(elevErr?.message || elevErr).slice(0, 300),
          })
        }
      }
      res.status(500).json({ error: err.message })
    }
  })

  // V14.27 — PUT rename: blocca se task running, usa elevator op rename (export+delete+create-from-xml)
  router.put('/:name/rename', async (req, res) => {
    const oldName = String(req.params.name)
    const { newName } = (req.body || {}) as { newName?: string }
    const e1 = validateTaskName(oldName)
    if (e1) return res.status(e1 === 'invalid task name' ? 400 : 403).json({ error: e1 })
    if (!newName || typeof newName !== 'string') {
      return res.status(400).json({ error: 'newName richiesto' })
    }
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(newName)) {
      return res.status(400).json({ error: 'newName 3-64 char alphanum/dash/underscore' })
    }
    const e2 = validateTaskName(newName)
    if (e2) return res.status(e2 === 'invalid task name' ? 400 : 403).json({ error: e2 })
    if (newName === oldName) {
      return res.status(400).json({ error: 'newName uguale a oldName' })
    }

    // Pre-check: blocca rename se task running
    if (await isTaskRunning(oldName)) {
      return res.status(423).json({
        error: 'Task in esecuzione, riprova tra qualche minuto',
        errorCode: 'task_running',
      })
    }

    // Pre-check: newName non deve esistere
    try {
      await execAsync(`schtasks /query /tn "${newName}"`, { encoding: 'utf-8' })
      return res.status(409).json({ error: `Esiste già un task con nome "${newName}"` })
    } catch {
      // newName non esiste, OK
    }

    if (!(await isElevatorAvailable())) {
      return res.status(503).json({
        error: 'Rename richiede elevator (RM-Saio-Tauri-Elevator non registrato)',
        errorCode: 'elevator_required',
        hint: 'Esegui setup: pwsh scripts/dev.ps1 con conferma wizard',
      })
    }

    const r = await runViaElevator({ op: 'rename', taskName: oldName, newName })
    if (!r.ok) {
      logger.error(`rename failed ${oldName}->${newName}: ${r.error}`)
      return res.status(500).json({ error: r.error || 'rename failed', detail: r.output })
    }
    await renameCronMeta(oldName, newName).catch(() => {})

    // Audit log
    try {
      const auditDir = path.join(process.cwd(), 'data', 'audit')
      await fs.mkdir(auditDir, { recursive: true })
      const auditFile = path.join(auditDir, `cron-rename-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`)
      const entry = JSON.stringify({ ts: new Date().toISOString(), op: 'rename', old: oldName, new: newName, success: true }) + '\n'
      await fs.appendFile(auditFile, entry, 'utf-8')
    } catch (auditErr) {
      logger.warn(`audit log append failed: ${auditErr}`)
    }

    res.json({ ok: true, name: newName, viaElevator: true })
  })

  // V14.23 — Apri Task Scheduler GUI (no admin needed per aprire la GUI)
  router.post('/open-gui', async (_req, res) => {
    try {
      await execAsync('start "" taskschd.msc', { encoding: 'utf-8', shell: 'cmd.exe' } as any)
      res.json({ ok: true })
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'failed to open Task Scheduler' })
    }
  })

  // V14.23 — POST / : crea nuovo task scheduled
  // V14.27 — accetta + persiste: description (Comment field via set-comment) + details (sidecar JSON)
  // Body: { name, schedule: { type: 'DAILY'|'WEEKLY'|'ONCE'|'MONTHLY', time: 'HH:MM', day?: 'MON|TUE|...', dayOfMonth?: '1-31' }, command, description, details }
  router.post('/', async (req, res) => {
    try {
      const { name, schedule, command, description, details, commandType } = (req.body || {}) as {
        name?: string
        schedule?: { type: 'DAILY' | 'WEEKLY' | 'ONCE' | 'MONTHLY'; time?: string; day?: string; dayOfMonth?: string }
        command?: string
        description?: string
        details?: string
        commandType?: 'command' | 'file' // V14.28 — 'file' usa -File path (no -Command wrap)
      }
      if (!name || !/^[a-zA-Z0-9_-]{3,64}$/.test(name)) {
        return res.status(400).json({ error: 'name 3-64 char alphanum/dash/underscore richiesto' })
      }
      if (!command || command.length < 3 || command.length > 2000) {
        return res.status(400).json({ error: 'command 3-2000 chars richiesto' })
      }
      if (!schedule || !['DAILY', 'WEEKLY', 'ONCE', 'MONTHLY'].includes(schedule.type)) {
        return res.status(400).json({ error: 'schedule.type DAILY|WEEKLY|MONTHLY|ONCE richiesto' })
      }
      const time = schedule.time && /^\d{2}:\d{2}$/.test(schedule.time) ? schedule.time : '03:00'
      let scParams = ''
      let scheduleLabel = ''
      if (schedule.type === 'DAILY') {
        scParams = `/SC DAILY /ST ${time}`
        scheduleLabel = `Daily ${time}`
      } else if (schedule.type === 'WEEKLY') {
        const day = schedule.day && /^(MON|TUE|WED|THU|FRI|SAT|SUN)$/.test(schedule.day) ? schedule.day : 'MON'
        scParams = `/SC WEEKLY /D ${day} /ST ${time}`
        scheduleLabel = `Weekly ${day} ${time}`
      } else if (schedule.type === 'MONTHLY') {
        const dom = schedule.dayOfMonth && /^([1-9]|[12][0-9]|3[01])$/.test(schedule.dayOfMonth) ? schedule.dayOfMonth : '1'
        scParams = `/SC MONTHLY /D ${dom} /ST ${time}`
        scheduleLabel = `Monthly day-${dom} ${time}`
      } else {
        scParams = `/SC ONCE /ST ${time}`
        scheduleLabel = `Once ${time}`
      }
      // Force prefix RM-Dashboard- if not already (così validateTaskName ammette il task dopo creazione)
      const taskName = name.toLowerCase().includes('obsidian') || name.toLowerCase().includes('rm-dashboard')
        ? name
        : `RM-Dashboard-${name}`
      // V14.28 — wrap command: 'file' usa -File path (no quoting nidificato), 'command' usa -Command (legacy)
      let trCommand: string
      if (commandType === 'file') {
        // command è path al .ps1. Doppie virgolette letterali nel TR.
        trCommand = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File \\"${command}\\"`
      } else {
        const escaped = command.replace(/"/g, '\\"')
        trCommand = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command \\"${escaped}\\"`
      }
      const cmdLine = `schtasks /Create /TN "${taskName}" ${scParams} /TR "${trCommand}" /F`
      const elevatedArgs = `/Create /TN ${taskName} ${scParams} /TR "${trCommand}" /F`

      // V14.27 — persisti sidecar appena create OK (details + schedule label leggibile)
      const persistSidecar = async () => {
        if (details || scheduleLabel) {
          await setCronMeta(taskName, { details: details || undefined, schedule: scheduleLabel })
        }
      }

      // V14.27 — set Comment field nativo schtasks (chiamata elevator separata, fa XML edit)
      const persistComment = async () => {
        if (description && description.trim()) {
          if (await isElevatorAvailable()) {
            const r = await runViaElevator({ op: 'set-comment', taskName, comment: description.trim() })
            if (!r.ok) logger.warn(`set-comment failed for ${taskName}: ${r.error}`)
          }
        }
      }

      try {
        await execAsync(cmdLine, { encoding: 'utf-8' })
        await persistSidecar()
        await persistComment()
        res.status(201).json({ ok: true, name: taskName, description: description || '', elevated: false })
      } catch (err: any) {
        if (isAdminRequiredError(err)) {
          // V14.27 — fallback elevator chain instead of bare UAC
          try {
            await runElevatedSchtasks(elevatedArgs)
            await persistSidecar()
            await persistComment()
            return res.status(201).json({ ok: true, name: taskName, description: description || '', elevated: true })
          } catch (elevErr: any) {
            return res.status(403).json({
              error: 'Creazione task fallita anche con UAC',
              errorCode: 'admin_denied',
              hint: 'Hai cliccato No al popup UAC, oppure UAC è disabilitato. Usa Task Scheduler GUI.',
              detail: String(elevErr?.message || elevErr).slice(0, 300),
            })
          }
        }
        return res.status(500).json({ error: err?.message || 'failed' })
      }
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'failed' })
    }
  })

  return router
}
