import os from 'node:os'
import path from 'node:path'
import type { IPaths } from '../types'

export class LinuxPaths implements IPaths {
  home(): string {
    return os.homedir()
  }
  configDir(appName: string): string {
    // XDG: $XDG_CONFIG_HOME ?? $HOME/.config
    const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
    return path.join(base, appName)
  }
  dataDir(appName: string): string {
    const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
    return path.join(base, appName)
  }
  cacheDir(appName: string): string {
    const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
    return path.join(base, appName)
  }
  claudeVaultDir(): string {
    return path.join(os.homedir(), '.claude', 'projects')
  }
  sshDir(): string {
    return path.join(os.homedir(), '.ssh')
  }
}
