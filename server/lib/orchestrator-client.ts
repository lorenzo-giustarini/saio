/**
 * V15.0 WS19 — Pre-flight Python deps + log capture + PID alive verify.
 *
 * Risolve il bug "SESSIONE TERMINATA" silenzioso causato da orchestrator
 * Python che crashava al boot per dipendenze mancanti (pywinpty/psutil/watchdog).
 * Prima: stdio:'ignore' nascondeva l'errore, backend ritornava {spawned:true}
 * anche per processi morti subito.
 * Adesso:
 *  1. Pre-flight import check su Python target → fail-fast con errore chiaro
 *  2. Stdio redirect a file log → l'errore reale è ricostruibile
 *  3. PID alive check 1.5s dopo spawn → ritorna {spawned:false, logTail} se morto
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { logger } from './logger'
import { resolvePythonExe, checkPythonDeps, isPidAlive } from './python-deps-check'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const ORCHESTRATOR_SCRIPT = path.join(PROJECT_ROOT, 'orchestrator', 'orchestrator.py')

const REQUIRED_PYTHON_DEPS =
  process.platform === 'win32' ? ['psutil', 'watchdog', 'pywinpty'] : ['psutil', 'watchdog']

export interface TriggerParams {
  responsePath: string
  briefPath: string
  dataDir: string
}

export interface TriggerResult {
  spawned: boolean
  pid?: number
  error?: string
  errorCode?: 'python_deps_missing' | 'orchestrator_crashed' | 'spawn_failed'
  missingDeps?: string[]
  logTail?: string
  logPath?: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function triggerOrchestrator(params: TriggerParams): Promise<TriggerResult> {
  const pyExe = await resolvePythonExe()

  // ────────── Pre-flight: verifica deps Python importabili ──────────
  const depCheck = await checkPythonDeps(pyExe, REQUIRED_PYTHON_DEPS)
  if (!depCheck.allOk) {
    logger.error(`[orchestrator-client] Python deps mancanti: ${depCheck.missing.join(', ')}`)
    return {
      spawned: false,
      error: `Python deps mancanti: ${depCheck.missing.join(', ')}. Esegui "npm run setup:deps" per installare.`,
      errorCode: 'python_deps_missing',
      missingDeps: depCheck.missing,
    }
  }

  // ────────── Setup log capture ──────────
  const logsDir = path.join(params.dataDir, 'logs')
  await fs.mkdir(logsDir, { recursive: true })
  const logPath = path.join(logsDir, `orchestrator-spawn-${Date.now()}.log`)
  let logFd: fs.FileHandle | null = null
  try {
    logFd = await fs.open(logPath, 'a')
  } catch (err) {
    logger.error('[orchestrator-client] cannot open log file:', err)
    return {
      spawned: false,
      error: `Impossibile creare log file: ${(err as Error).message}`,
      errorCode: 'spawn_failed',
    }
  }

  // ────────── Spawn detached con stdio redirect a log ──────────
  let child: import('node:child_process').ChildProcess
  try {
    child = spawn(
      pyExe,
      [
        ORCHESTRATOR_SCRIPT,
        '--response',
        params.responsePath,
        '--brief',
        params.briefPath,
        '--data-dir',
        params.dataDir,
      ],
      {
        detached: true,
        stdio: ['ignore', logFd.fd, logFd.fd], // stdout+stderr → log
        windowsHide: false,
        shell: false,
      }
    )
  } catch (err) {
    await logFd.close()
    logger.error('[orchestrator-client] spawn fail:', err)
    return {
      spawned: false,
      error: `Spawn Python fallito: ${(err as Error).message}`,
      errorCode: 'spawn_failed',
    }
  }

  // Attach error handler PRIMA del wait
  child.on('error', (err) => {
    logger.error('[orchestrator-client] child error event:', err)
  })

  // ────────── PID alive verify dopo 1.5s ──────────
  child.unref()
  await sleep(1500)
  // Chiudo file descriptor (orchestrator ha già duplicato il suo, ok per noi)
  try {
    await logFd.close()
  } catch {
    /* already closed by child */
  }

  if (!isPidAlive(child.pid)) {
    // Crashed — leggi log per estrarre vero errore
    let logTail = ''
    try {
      const content = await fs.readFile(logPath, 'utf-8')
      logTail = content.slice(-1000) // ultimi 1KB
    } catch {
      /* log non leggibile */
    }
    logger.error(`[orchestrator-client] orchestrator crashed within 1.5s, log: ${logPath}`)
    return {
      spawned: false,
      error: `Orchestrator crashato all'avvio. Vedi log per dettagli.`,
      errorCode: 'orchestrator_crashed',
      logTail,
      logPath,
    }
  }

  logger.info(`[orchestrator-client] orchestrator running pid=${child.pid} log=${logPath}`)
  return { spawned: true, pid: child.pid, logPath }
}
