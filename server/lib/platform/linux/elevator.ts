import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { IElevator, ElevatorOp, OperationResult } from '../types'
import { LinuxTaskScheduler } from './task-scheduler'
import { LinuxPackageManager } from './package-manager'

const execAsync = promisify(exec)

/**
 * Linux elevator: usa `pkexec` (PolicyKit) per richiedere privilegi admin con
 * GUI prompt una-tantum, oppure `sudo -n` se policy/cache già accordata.
 *
 * Setup richiede creazione di policy file in `/usr/share/polkit-1/actions/`
 * `org.revolutionmarketing.saio.policy` che dichiara le actions consentite
 * (es. `org.revolutionmarketing.saio.task-create`, `pkg-install`).
 *
 * Nota: per task scheduler, su Linux molte operazioni NON richiedono root
 * (systemd-timer user-level vive in `~/.config/systemd/user/`). Queste
 * vengono eseguite directly dal LinuxTaskScheduler senza passare elevator.
 */
export class LinuxElevator implements IElevator {
  async isAvailable(): Promise<boolean> {
    try {
      await execAsync('which pkexec', { encoding: 'utf-8' })
      return true
    } catch {
      try {
        await execAsync('which sudo', { encoding: 'utf-8' })
        return true
      } catch {
        return false
      }
    }
  }

  async run(op: ElevatorOp): Promise<OperationResult> {
    // Per Linux molte op non richiedono elevation (systemd-timer user-level)
    // Per altre (apt-install, dnf-install, pkg-install) usiamo pkexec/sudo
    switch (op.op) {
      case 'pkg-upgrade':
      case 'pkg-install': {
        return await this.runViaSudo(this.buildPkgCommand(op.op, op.package))
      }
      case 'shell':
        return await this.runViaSudo([op.command, ...(op.args || [])].join(' '))
      // Task ops: delegate to LinuxTaskScheduler (user-level systemd, no root)
      default:
        // Le op task-* su Linux user-systemd non passano per elevator
        // (questo elevator supporta solo le op che richiedono root)
        return { ok: false, error: `Linux elevator non supporta op '${op.op}' direttamente. Usa LinuxTaskScheduler/LinuxPackageManager direttamente.` }
    }
  }

  async setup(): Promise<OperationResult> {
    // Setup: installa policy file Polkit per consentire pkexec senza prompt
    // ripetuto. File: /usr/share/polkit-1/actions/org.revolutionmarketing.saio.policy
    // Questo richiede una sola elevation iniziale.
    return {
      ok: true,
      output: 'Linux elevator: nessun setup obbligatorio. Pkexec/sudo gestiscono prompt on-demand.',
    }
  }

  async teardown(): Promise<OperationResult> {
    return { ok: true }
  }

  // ──────────────── Private ────────────────

  private async runViaSudo(cmd: string): Promise<OperationResult> {
    try {
      // Tenta sudo -n (non interactive, usa cache token)
      const { stdout } = await execAsync(`sudo -n ${cmd}`, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 })
      return { ok: true, output: stdout, exitCode: 0 }
    } catch {
      // Fallback: pkexec (GUI prompt)
      try {
        const { stdout } = await execAsync(`pkexec ${cmd}`, {
          encoding: 'utf-8',
          maxBuffer: 32 * 1024 * 1024,
        })
        return { ok: true, output: stdout, exitCode: 0 }
      } catch (err: unknown) {
        const e = err as Error & { code?: number }
        return { ok: false, error: e.message, exitCode: e.code ?? -1 }
      }
    }
  }

  private buildPkgCommand(op: 'pkg-install' | 'pkg-upgrade', pkg: string): string {
    // Detect distro
    const cmd = op === 'pkg-install' ? 'install' : 'upgrade'
    // Logica detect: apt (Debian/Ubuntu), dnf (Fedora), pacman (Arch)
    return `bash -c "if command -v apt >/dev/null; then apt ${cmd} -y ${pkg}; elif command -v dnf >/dev/null; then dnf ${cmd} -y ${pkg}; elif command -v pacman >/dev/null; then pacman -S --noconfirm ${pkg}; else echo no-pkg-manager; exit 1; fi"`
  }
}
