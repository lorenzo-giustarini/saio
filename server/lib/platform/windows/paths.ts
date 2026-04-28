import os from 'node:os'
import path from 'node:path'
import type { IPaths } from '../types'

export class WindowsPaths implements IPaths {
  home(): string {
    return os.homedir()
  }
  configDir(appName: string): string {
    // %APPDATA% (Roaming)
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), appName)
  }
  dataDir(appName: string): string {
    // %LOCALAPPDATA%
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      appName
    )
  }
  cacheDir(appName: string): string {
    return path.join(this.dataDir(appName), 'Cache')
  }
  claudeVaultDir(): string {
    return path.join(os.homedir(), '.claude', 'projects')
  }
  sshDir(): string {
    return path.join(os.homedir(), '.ssh')
  }
}
