import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IInstaller, OperationResult } from '../types'
import { WindowsPackageManager } from './package-manager'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

/**
 * Windows installer per CLI tools: `winget` (per app sistema) o `npm install -g` (per CLI Node).
 */
export class WindowsInstaller implements IInstaller {
  constructor(private pkgMgr: WindowsPackageManager) {}

  async isInstalled(cliName: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(cliName)) return false
    try {
      await execFileAsync('where', [cliName], { timeout: 3000, shell: false as never })
      return true
    } catch {
      return false
    }
  }

  async installCli(spec: {
    cliName: string
    npmPackage?: string
    brewFormula?: string
    aptPackage?: string
    wingetId?: string
  }): Promise<OperationResult> {
    if (spec.npmPackage) {
      try {
        const { stdout } = await execAsync(`npm install -g ${spec.npmPackage}`, {
          encoding: 'utf-8',
          maxBuffer: 32 * 1024 * 1024,
        })
        return { ok: true, output: stdout, exitCode: 0 }
      } catch (err: unknown) {
        const e = err as Error & { code?: number }
        return { ok: false, error: e.message, exitCode: e.code ?? -1 }
      }
    }
    if (spec.wingetId) {
      return await this.pkgMgr.install(spec.wingetId)
    }
    return { ok: false, error: `no install method for ${spec.cliName} on Windows` }
  }
}
