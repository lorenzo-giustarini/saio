import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { IPackageManager, PackageInfo, OperationResult } from '../types'
import { LinuxElevator } from './elevator'

const execAsync = promisify(exec)

/**
 * Linux package manager: detect distro (apt/dnf/pacman) + delegate.
 */
export class LinuxPackageManager implements IPackageManager {
  readonly name: string

  constructor(private elevator: LinuxElevator) {
    this.name = 'auto'
  }

  async detectPm(): Promise<'apt' | 'dnf' | 'pacman' | 'zypper' | 'unknown'> {
    for (const pm of ['apt', 'dnf', 'pacman', 'zypper'] as const) {
      try {
        await execAsync(`which ${pm}`, { encoding: 'utf-8' })
        return pm
      } catch {
        // continue
      }
    }
    return 'unknown'
  }

  async isAvailable(): Promise<boolean> {
    return (await this.detectPm()) !== 'unknown'
  }

  async getInstalled(packageId: string): Promise<string | null> {
    const pm = await this.detectPm()
    try {
      switch (pm) {
        case 'apt': {
          const { stdout } = await execAsync(`dpkg-query -W -f='\${Version}' ${packageId} 2>/dev/null`, {
            encoding: 'utf-8',
          })
          return String(stdout).trim() || null
        }
        case 'dnf': {
          const { stdout } = await execAsync(`rpm -q --queryformat '%{VERSION}' ${packageId} 2>/dev/null`, {
            encoding: 'utf-8',
          })
          return String(stdout).trim() || null
        }
        case 'pacman': {
          const { stdout } = await execAsync(`pacman -Qi ${packageId} 2>/dev/null | grep '^Version'`, {
            encoding: 'utf-8',
          })
          const m = /Version\s*:\s*(\S+)/.exec(String(stdout))
          return m?.[1] || null
        }
        default:
          return null
      }
    } catch {
      return null
    }
  }

  async getLatest(packageId: string): Promise<string | null> {
    const pm = await this.detectPm()
    try {
      switch (pm) {
        case 'apt': {
          const { stdout } = await execAsync(`apt-cache policy ${packageId} | grep Candidate`, {
            encoding: 'utf-8',
          })
          const m = /Candidate:\s*(\S+)/.exec(String(stdout))
          return m?.[1] || null
        }
        case 'dnf': {
          const { stdout } = await execAsync(`dnf info ${packageId} | grep '^Version'`, {
            encoding: 'utf-8',
          })
          const m = /Version\s*:\s*(\S+)/.exec(String(stdout))
          return m?.[1] || null
        }
        case 'pacman': {
          const { stdout } = await execAsync(`pacman -Si ${packageId} 2>/dev/null | grep '^Version'`, {
            encoding: 'utf-8',
          })
          const m = /Version\s*:\s*(\S+)/.exec(String(stdout))
          return m?.[1] || null
        }
        default:
          return null
      }
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
    const pm = await this.detectPm()
    try {
      let cmd: string
      switch (pm) {
        case 'apt':
          cmd = 'apt list --upgradable 2>/dev/null'
          break
        case 'dnf':
          cmd = 'dnf list updates -q'
          break
        case 'pacman':
          cmd = 'pacman -Qu'
          break
        default:
          return []
      }
      const { stdout } = await execAsync(cmd, { encoding: 'utf-8' })
      const out: PackageInfo[] = []
      for (const line of String(stdout).split(/\r?\n/)) {
        if (!line.trim() || line.startsWith('Listing')) continue
        const parts = line.split(/\s+/)
        if (parts.length >= 2) out.push({ id: parts[0]!, latestVersion: parts[1] })
      }
      return out
    } catch {
      return []
    }
  }
}
