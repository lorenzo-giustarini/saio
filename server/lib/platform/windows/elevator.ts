import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import type { IElevator, ElevatorOp, OperationResult } from '../types'

const execAsync = promisify(exec)

const ELEVATOR_TASK_NAME = 'RM-Saio-Tauri-Elevator'
const POLL_INTERVAL_MS = 100
const TIMEOUT_MS = 60_000 * 5 // 5 min default (winget upgrade può essere lento)

/**
 * Windows elevator: usa pattern V14.27 + V15.2 WS32 con TASK SCHEDULER DEDICATO
 * `RM-Saio-Tauri-Elevator` (separato da `RM-Dashboard-Cron-Manager` di SAIO originale).
 *
 * Setup richiede UAC una sola volta (registrazione task con RunLevel=Highest).
 * Dopo, ogni invocazione zero-UAC (proprietario user può `schtasks /run` proprio task).
 */
export class WindowsElevator implements IElevator {
  private elevatorDir: string
  private cachedAvailable: boolean | null = null
  private cachedAt = 0

  constructor() {
    // data/elevator/ nel saio-tauri data directory
    this.elevatorDir = path.join(process.cwd(), 'data', 'elevator')
  }

  async isAvailable(): Promise<boolean> {
    const now = Date.now()
    if (this.cachedAvailable !== null && now - this.cachedAt < 30_000) {
      return this.cachedAvailable
    }
    try {
      await execAsync(`schtasks /query /tn ${ELEVATOR_TASK_NAME}`, { encoding: 'utf-8' })
      this.cachedAvailable = true
    } catch {
      this.cachedAvailable = false
    }
    this.cachedAt = now
    return this.cachedAvailable
  }

  async run(op: ElevatorOp): Promise<OperationResult> {
    const id = randomUUID()
    const cmdFile = path.join(this.elevatorDir, `cmd-${id}.json`)
    const resultFile = path.join(this.elevatorDir, `result-${id}.json`)

    await fs.mkdir(this.elevatorDir, { recursive: true })

    // Atomic write
    const tmpFile = `${cmdFile}.tmp`
    await fs.writeFile(tmpFile, JSON.stringify({ id, ...op }), 'utf-8')
    await fs.rename(tmpFile, cmdFile)

    // Trigger
    try {
      await execAsync(`schtasks /run /tn ${ELEVATOR_TASK_NAME}`, { encoding: 'utf-8' })
    } catch (err: unknown) {
      const e = err as Error
      await fs.unlink(cmdFile).catch(() => undefined)
      return { ok: false, error: `elevator trigger failed: ${e.message}` }
    }

    // Poll
    const start = Date.now()
    while (Date.now() - start < TIMEOUT_MS) {
      try {
        const raw = await fs.readFile(resultFile, 'utf-8')
        const r = JSON.parse(raw) as OperationResult
        await fs.unlink(resultFile).catch(() => undefined)
        return r
      } catch {
        // not ready
      }
      await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS))
    }
    await fs.unlink(cmdFile).catch(() => undefined)
    return { ok: false, error: `elevator timeout ${TIMEOUT_MS}ms` }
  }

  async setup(): Promise<OperationResult> {
    // Registra task scheduler. Richiede UAC una tantum (Start-Process -Verb RunAs).
    const elevatorScript = path.join(process.cwd(), 'scripts', 'elevator-windows.ps1')
    const tr = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "${elevatorScript}"`
    const cmd = `schtasks /create /tn "${ELEVATOR_TASK_NAME}" /tr "${tr}" /sc ONCE /st 23:59 /sd 01/01/2099 /ru "${os.userInfo().username}" /rl HIGHEST /f`
    try {
      await execAsync(cmd, { encoding: 'utf-8' })
      this.cachedAvailable = null // reset cache
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async teardown(): Promise<OperationResult> {
    try {
      await execAsync(`schtasks /delete /tn "${ELEVATOR_TASK_NAME}" /f`, { encoding: 'utf-8' })
      this.cachedAvailable = null
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }
}
