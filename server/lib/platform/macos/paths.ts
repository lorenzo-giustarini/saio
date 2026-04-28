import os from 'node:os'
import path from 'node:path'
import type { IPaths } from '../types'

export class MacOSPaths implements IPaths {
  home(): string {
    return os.homedir()
  }
  configDir(appName: string): string {
    // ~/Library/Preferences/<appName> oppure ~/Library/Application Support/<appName>
    return path.join(os.homedir(), 'Library', 'Application Support', appName)
  }
  dataDir(appName: string): string {
    return path.join(os.homedir(), 'Library', 'Application Support', appName)
  }
  cacheDir(appName: string): string {
    return path.join(os.homedir(), 'Library', 'Caches', appName)
  }
  claudeVaultDir(): string {
    return path.join(os.homedir(), '.claude', 'projects')
  }
  sshDir(): string {
    return path.join(os.homedir(), '.ssh')
  }
}
