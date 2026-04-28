import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { IInstaller, OperationResult } from '../types'
import { MacOSPackageManager } from './package-manager'

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)

export class MacOSInstaller implements IInstaller {
  constructor(private pkgMgr: MacOSPackageManager) {}

  async isInstalled(cliName: string): Promise<boolean> {
    if (!/^[a-zA-Z0-9_.-]+$/.test(cliName)) return false
    try {
      await execFileAsync('which', [cliName], { timeout: 3000 })
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
    if (spec.brewFormula) {
      return await this.pkgMgr.install(spec.brewFormula)
    }
    return { ok: false, error: `no install method for ${spec.cliName} on macOS` }
  }
}
