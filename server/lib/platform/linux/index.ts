/**
 * Linux Platform implementation (V15.9 WS39 Microtask 5)
 */
import { LinuxTaskScheduler } from './task-scheduler'
import { LinuxPackageManager } from './package-manager'
import { LinuxElevator } from './elevator'
import { LinuxShell } from './shell'
import { LinuxPaths } from './paths'
import { LinuxInstaller } from './installer'
import type { IPlatform } from '../types'

export class LinuxPlatform implements IPlatform {
  readonly platform = 'linux' as const
  readonly elevator: LinuxElevator
  readonly taskScheduler: LinuxTaskScheduler
  readonly packageManager: LinuxPackageManager
  readonly shell: LinuxShell
  readonly paths: LinuxPaths
  readonly installer: LinuxInstaller

  constructor() {
    this.elevator = new LinuxElevator()
    this.taskScheduler = new LinuxTaskScheduler(this.elevator)
    this.packageManager = new LinuxPackageManager(this.elevator)
    this.shell = new LinuxShell()
    this.paths = new LinuxPaths()
    this.installer = new LinuxInstaller(this.packageManager)
  }
}

export { LinuxTaskScheduler, LinuxPackageManager, LinuxElevator, LinuxShell, LinuxPaths, LinuxInstaller }
