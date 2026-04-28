import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { logger } from './logger'

const execAsync = promisify(exec)

export const ELEVATOR_TASK_NAME = 'RM-Dashboard-Cron-Manager'
const ELEVATOR_DIR = path.join(process.cwd(), 'data', 'elevator')
const POLL_INTERVAL_MS = 100
const TIMEOUT_MS = 30_000 // V14.27 — bumped from 15s; rename (export+delete+create) può impiegare >15s in sistemi lenti

export interface ElevatorCommand {
  op:
    | 'enable'
    | 'disable'
    | 'run'
    | 'delete'
    | 'create'
    | 'rename'
    | 'export-xml'
    | 'create-from-xml'
    | 'set-comment'
    | 'winget-upgrade'
  taskName?: string
  // op-specific extras
  newName?: string
  comment?: string
  taskCommand?: string
  scheduleType?: 'DAILY' | 'WEEKLY' | 'MONTHLY'
  startTime?: string
  dayOfWeek?: string
  dayOfMonth?: string
  xmlPath?: string
  // V15.2 WS32: winget-upgrade payload
  package?: string
}

export interface ElevatorResult {
  id: string
  ok: boolean
  exitCode?: number
  output?: string
  error?: string
}

let cachedAvailability: { available: boolean; checkedAt: number } | null = null
const AVAILABILITY_CACHE_MS = 30_000

export async function isElevatorAvailable(): Promise<boolean> {
  if (cachedAvailability && Date.now() - cachedAvailability.checkedAt < AVAILABILITY_CACHE_MS) {
    return cachedAvailability.available
  }
  try {
    await execAsync(`schtasks /query /tn ${ELEVATOR_TASK_NAME}`, { encoding: 'utf-8' })
    cachedAvailability = { available: true, checkedAt: Date.now() }
    return true
  } catch {
    cachedAvailability = { available: false, checkedAt: Date.now() }
    return false
  }
}

export function invalidateElevatorCache(): void {
  cachedAvailability = null
}

export async function runViaElevator(cmd: Omit<ElevatorCommand, 'id'>): Promise<ElevatorResult> {
  const id = randomUUID()
  const cmdFile = path.join(ELEVATOR_DIR, `cmd-${id}.json`)
  const resultFile = path.join(ELEVATOR_DIR, `result-${id}.json`)

  await fs.mkdir(ELEVATOR_DIR, { recursive: true })

  // V14.27 — opportunistic cleanup di result file orfani (>5min) per non lasciare disco sporco
  try {
    const entries = await fs.readdir(ELEVATOR_DIR)
    const now = Date.now()
    for (const e of entries) {
      if (e.startsWith('result-') || (e.startsWith('cmd-') && e.endsWith('.json.tmp'))) {
        try {
          const stat = await fs.stat(path.join(ELEVATOR_DIR, e))
          if (now - stat.mtimeMs > 5 * 60_000) {
            await fs.unlink(path.join(ELEVATOR_DIR, e)).catch(() => {})
          }
        } catch { /* ignore */ }
      }
    }
  } catch { /* ignore */ }

  // Atomic write: scrive su .tmp e rinomina
  const tmpFile = `${cmdFile}.tmp`
  await fs.writeFile(tmpFile, JSON.stringify({ id, ...cmd }), 'utf-8')
  await fs.rename(tmpFile, cmdFile)

  // Trigger elevator (no UAC: user owns the task)
  try {
    await execAsync(`schtasks /run /tn ${ELEVATOR_TASK_NAME}`, { encoding: 'utf-8' })
  } catch (e: any) {
    await fs.unlink(cmdFile).catch(() => {})
    return { id, ok: false, error: `elevator trigger failed: ${e.message}` }
  }

  // Poll result file
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    try {
      const raw = await fs.readFile(resultFile, 'utf-8')
      const result = JSON.parse(raw) as ElevatorResult
      // cleanup
      await fs.unlink(resultFile).catch(() => {})
      return result
    } catch {
      // not yet ready
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }

  // Timeout
  await fs.unlink(cmdFile).catch(() => {})
  logger.warn(`elevator timeout: op=${cmd.op} task=${cmd.taskName}`)
  return { id, ok: false, error: 'elevator timeout 15s' }
}
