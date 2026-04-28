import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { IPackageManager, PackageInfo, OperationResult } from '../types'
import { WindowsElevator } from './elevator'

const execAsync = promisify(exec)

/**
 * Windows package manager: winget + npm globale.
 * `upgrade` e `install` delegano a IElevator (richiedono admin).
 */
export class WindowsPackageManager implements IPackageManager {
  readonly name = 'winget'

  constructor(private elevator: WindowsElevator) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('winget --version', { encoding: 'utf-8' })
      return true
    } catch {
      return false
    }
  }

  async getInstalled(packageId: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`winget list --id ${packageId} --exact`, {
        encoding: 'utf-8',
      })
      const lines = String(stdout).split(/\r?\n/).filter((l) => l.includes(packageId))
      for (const line of lines) {
        const cols = line.split(/\s+/).filter((c) => c && !'-\\|/'.includes(c))
        const idx = cols.indexOf(packageId)
        if (idx >= 0 && idx + 1 < cols.length) {
          const ver = cols[idx + 1]!
          if (/^\d/.test(ver)) return ver.trim()
        }
      }
      return null
    } catch {
      return null
    }
  }

  async getLatest(packageId: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`winget show --id ${packageId} --exact`, {
        encoding: 'utf-8',
      })
      const m = /(?:Version|Versione|Versión|Versão)\w*:\s*([^\r\n]+)/i.exec(String(stdout))
      if (m && /^\d/.test(m[1]!)) return m[1]!.trim()
      return null
    } catch {
      return null
    }
  }

  async upgrade(packageId: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'pkg-upgrade', package: packageId })
  }

  async install(packageId: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'pkg-install', package: packageId })
  }

  async listOutdated(): Promise<PackageInfo[]> {
    try {
      const { stdout } = await execAsync('winget upgrade', { encoding: 'utf-8' })
      const out: PackageInfo[] = []
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/.exec(line.trim())
        if (m && /^\d/.test(m[3]!) && /^\d/.test(m[4]!)) {
          out.push({ id: m[2]!, installedVersion: m[3], latestVersion: m[4] })
        }
      }
      return out
    } catch {
      return []
    }
  }
}
