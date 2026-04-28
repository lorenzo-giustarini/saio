import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { IPackageManager, PackageInfo, OperationResult } from '../types'
import { MacOSElevator } from './elevator'

const execAsync = promisify(exec)

/**
 * macOS package manager: Homebrew (`brew`).
 */
export class MacOSPackageManager implements IPackageManager {
  readonly name = 'brew'

  constructor(private elevator: MacOSElevator) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('brew --version', { encoding: 'utf-8' })
      return true
    } catch {
      return false
    }
  }

  async getInstalled(packageId: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`brew list --versions ${packageId}`, { encoding: 'utf-8' })
      const m = /\S+\s+(\S+)/.exec(String(stdout).trim())
      return m?.[1] || null
    } catch {
      return null
    }
  }

  async getLatest(packageId: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`brew info --json=v2 ${packageId}`, { encoding: 'utf-8' })
      const j = JSON.parse(String(stdout)) as { formulae?: Array<{ versions?: { stable?: string } }> }
      return j.formulae?.[0]?.versions?.stable || null
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
      const { stdout } = await execAsync('brew outdated --json=v2', { encoding: 'utf-8' })
      const j = JSON.parse(String(stdout)) as {
        formulae?: Array<{ name: string; installed_versions?: string[]; current_version?: string }>
      }
      return (j.formulae || []).map((f) => ({
        id: f.name,
        installedVersion: f.installed_versions?.[0],
        latestVersion: f.current_version,
      }))
    } catch {
      return []
    }
  }
}
