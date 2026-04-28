import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { IShell, ShellSpec, OperationResult } from '../types'

const execFileAsync = promisify(execFile)

export class WindowsShell implements IShell {
  defaultShell(): ShellSpec {
    return {
      shellPath: 'cmd.exe',
      args: (cmd: string) => ['/k', cmd],
    }
  }

  async resolveExecutable(name: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return null
    try {
      const { stdout } = await execFileAsync('where', [name], { timeout: 3000, shell: false as never })
      const first = String(stdout).split(/\r?\n/).find((l) => l.trim().length > 0)
      return first?.trim() || null
    } catch {
      return null
    }
  }

  async spawnDetached(executable: string, args: string[]): Promise<OperationResult> {
    try {
      const child = spawn(executable, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()
      return { ok: true, exitCode: 0 }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }
}
