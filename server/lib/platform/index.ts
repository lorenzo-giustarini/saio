/**
 * Platform Abstraction Layer — factory entry point (V15.9 WS39 Microtask 3)
 *
 * Usage:
 *   import { getPlatform } from './platform'
 *   const pal = getPlatform()
 *   await pal.taskScheduler.create({ name: '...', schedule: {...}, command: '...' })
 *
 * L'implementazione è scelta automaticamente in base a `os.platform()`.
 * Lazy loading per evitare di caricare codice non-applicabile (es. WindowsTaskScheduler
 * che importa schtasks su una macchina Linux).
 */
// V15.9 WS43.3 — saio-tauri is ESM ("type":"module"). createRequire so the
// lazy-loaded platform-specific modules can use sync require() to avoid
// turning getPlatform() into an async function (it's called from many
// non-async callsites).
import { createRequire } from 'node:module'
import os from 'node:os'
import type { IPlatform, Platform } from './types'

const require = createRequire(import.meta.url)

let _instance: IPlatform | null = null

export function getPlatform(): IPlatform {
  if (_instance) return _instance
  const p = os.platform() as Platform
  switch (p) {
    case 'win32': {
      const { WindowsPlatform } = require('./windows') as typeof import('./windows')
      _instance = new WindowsPlatform()
      break
    }
    case 'linux': {
      const { LinuxPlatform } = require('./linux') as typeof import('./linux')
      _instance = new LinuxPlatform()
      break
    }
    case 'darwin': {
      const { MacOSPlatform } = require('./macos') as typeof import('./macos')
      _instance = new MacOSPlatform()
      break
    }
    default:
      throw new Error(`Platform non supportata: ${p}. Supportati: win32, linux, darwin.`)
  }
  return _instance!
}

export * from './types'
