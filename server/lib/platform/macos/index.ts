/**
 * macOS Platform implementation (V15.9 WS39 Microtask 6)
 */
import { MacOSTaskScheduler } from './task-scheduler'
import { MacOSPackageManager } from './package-manager'
import { MacOSElevator } from './elevator'
import { MacOSShell } from './shell'
import { MacOSPaths } from './paths'
import { MacOSInstaller } from './installer'
import type { IPlatform } from '../types'

export class MacOSPlatform implements IPlatform {
  readonly platform = 'darwin' as const
  readonly elevator: MacOSElevator
  readonly taskScheduler: MacOSTaskScheduler
  readonly packageManager: MacOSPackageManager
  readonly shell: MacOSShell
  readonly paths: MacOSPaths
  readonly installer: MacOSInstaller

  constructor() {
    this.elevator = new MacOSElevator()
    this.taskScheduler = new MacOSTaskScheduler(this.elevator)
    this.packageManager = new MacOSPackageManager(this.elevator)
    this.shell = new MacOSShell()
    this.paths = new MacOSPaths()
    this.installer = new MacOSInstaller(this.packageManager)
  }
}

export { MacOSTaskScheduler, MacOSPackageManager, MacOSElevator, MacOSShell, MacOSPaths, MacOSInstaller }
