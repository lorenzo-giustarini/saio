import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { IElevator, ElevatorOp, OperationResult } from '../types'

const execAsync = promisify(exec)

/**
 * macOS elevator: usa `osascript` per richiedere privilegi admin con GUI
 * prompt (Touch ID / password). Pattern:
 *   osascript -e 'do shell script "..." with administrator privileges'
 *
 * Per task scheduler launchd user-level (LaunchAgents): nessun admin necessario,
 * vivono in ~/Library/LaunchAgents/. Solo brew install/upgrade richiede sudo
 * (ma brew è user-installed in /opt/homebrew, di solito no admin necessario
 * se Homebrew è già stato installato in user-mode).
 */
export class MacOSElevator implements IElevator {
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which osascript', { encoding: 'utf-8' })
      return true
    } catch {
      return false
    }
  }

  async run(op: ElevatorOp): Promise<OperationResult> {
    switch (op.op) {
      case 'pkg-upgrade':
      case 'pkg-install': {
        // Brew non richiede sudo se installato user-mode
        const cmd = op.op === 'pkg-install' ? `brew install ${op.package}` : `brew upgrade ${op.package}`
        try {
          const { stdout } = await execAsync(cmd, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
          return { ok: true, output: stdout, exitCode: 0 }
        } catch (err: unknown) {
          const e = err as Error & { code?: number }
          return { ok: false, error: e.message, exitCode: e.code ?? -1 }
        }
      }
      case 'shell':
        return await this.runViaOsaScript([op.command, ...(op.args || [])].join(' '))
      default:
        return {
          ok: false,
          error: `macOS elevator non supporta op '${op.op}'. Usa MacOSTaskScheduler direttamente (LaunchAgents user-level no admin needed).`,
        }
    }
  }

  async setup(): Promise<OperationResult> {
    return { ok: true, output: 'macOS elevator: nessun setup richiesto.' }
  }

  async teardown(): Promise<OperationResult> {
    return { ok: true }
  }

  // ──────────────── Private ────────────────

  private async runViaOsaScript(cmd: string): Promise<OperationResult> {
    // Escape doppie quote per AppleScript
    const escaped = cmd.replace(/"/g, '\\"')
    try {
      const { stdout } = await execAsync(
        `osascript -e 'do shell script "${escaped}" with administrator privileges'`,
        { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }
      )
      return { ok: true, output: stdout, exitCode: 0 }
    } catch (err: unknown) {
      const e = err as Error & { code?: number }
      return { ok: false, error: e.message, exitCode: e.code ?? -1 }
    }
  }
}
