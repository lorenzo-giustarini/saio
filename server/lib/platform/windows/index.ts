/**
 * Windows Platform implementation (V15.9 WS39 Microtask 4)
 *
 * Wraps codice esistente Win-specific (elevator.ts, schtasks pattern, winget,
 * cmd.exe shell) nelle interfaces PAL.
 */
import { WindowsTaskScheduler } from './task-scheduler'
import { WindowsPackageManager } from './package-manager'
import { WindowsElevator } from './elevator'
import { WindowsShell } from './shell'
import { WindowsPaths } from './paths'
import { WindowsInstaller } from './installer'
import type { IPlatform } from '../types'

export class WindowsPlatform implements IPlatform {
  readonly platform = 'win32' as const
  readonly elevator: WindowsElevator
  readonly taskScheduler: WindowsTaskScheduler
  readonly packageManager: WindowsPackageManager
  readonly shell: WindowsShell
  readonly paths: WindowsPaths
  readonly installer: WindowsInstaller

  constructor() {
    this.elevator = new WindowsElevator()
    this.taskScheduler = new WindowsTaskScheduler(this.elevator)
    this.packageManager = new WindowsPackageManager(this.elevator)
    this.shell = new WindowsShell()
    this.paths = new WindowsPaths()
    this.installer = new WindowsInstaller(this.packageManager)
  }
}

export { WindowsTaskScheduler, WindowsPackageManager, WindowsElevator, WindowsShell, WindowsPaths, WindowsInstaller }
