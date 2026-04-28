import { execFile } from 'node:child_process'
import { spawn } from 'node:child_process'
import { promisify } from 'node:util'
import type { IShell, ShellSpec, OperationResult } from '../types'

const execFileAsync = promisify(execFile)

export class LinuxShell implements IShell {
  defaultShell(): ShellSpec {
    const sh = process.env.SHELL || '/bin/bash'
    return {
      shellPath: sh,
      args: (cmd: string) => ['-c', cmd],
    }
  }

  async resolveExecutable(name: string): Promise<string | null> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) return null
    try {
      const { stdout } = await execFileAsync('which', [name], { timeout: 3000 })
      const v = String(stdout).trim()
      return v || null
    } catch {
      return null
    }
  }

  async spawnDetached(executable: string, args: string[]): Promise<OperationResult> {
    try {
      const child = spawn(executable, args, {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      return { ok: true, exitCode: 0 }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }
}
