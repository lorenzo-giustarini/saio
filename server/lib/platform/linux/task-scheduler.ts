import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import type {
  ITaskScheduler,
  ScheduledTask,
  ScheduleSpec,
  OperationResult,
} from '../types'
import { LinuxElevator } from './elevator'

const execAsync = promisify(exec)

/**
 * Linux Task Scheduler: usa **systemd-timer user-level** in
 * `~/.config/systemd/user/`. Non richiede root (user services).
 *
 * Per ogni task crea 2 file:
 * - `<name>.service` — definisce il comando da eseguire
 * - `<name>.timer` — definisce il calendar schedule
 *
 * Esempio nome: `saio-Obsidian-Anthropic-Weekly.timer`
 *
 * Operazioni:
 * - create: scrive .service + .timer files, `systemctl --user daemon-reload`, `systemctl --user enable --now <name>.timer`
 * - delete: `systemctl --user disable --now <name>.timer`, rimuove i file
 * - enable/disable: `systemctl --user enable/disable <name>.timer`
 * - run: `systemctl --user start <name>.service`
 * - list: legge `systemctl --user list-timers`
 *
 * Fallback opzionale a `crontab -l/-e` se systemd non disponibile (raro).
 */
export class LinuxTaskScheduler implements ITaskScheduler {
  private unitDir: string

  constructor(_elevator: LinuxElevator) {
    this.unitDir = path.join(os.homedir(), '.config', 'systemd', 'user')
  }

  async list(): Promise<ScheduledTask[]> {
    try {
      const { stdout } = await execAsync('systemctl --user list-timers --all --no-pager --no-legend', {
        encoding: 'utf-8',
      })
      const tasks: ScheduledTask[] = []
      for (const line of String(stdout).split(/\r?\n/)) {
        const m = /^([\d-]+\s[\d:]+\s\w+)\s+\S+\s+([\d-]+\s[\d:]+\s\w+)\s+\S+\s+(\S+\.timer)\s+(\S+\.service)/.exec(line)
        if (!m) continue
        const timerName = m[3]!.replace(/\.timer$/, '')
        if (!timerName.startsWith('saio-')) continue
        tasks.push({
          name: timerName.replace(/^saio-/, ''),
          command: '',
          schedule: { type: 'DAILY', time: '00:00' }, // parsed lazily da OnCalendar
          state: 'ready',
          nextRunAt: m[1],
          lastRunAt: m[2],
        })
      }
      return tasks
    } catch {
      return []
    }
  }

  async get(name: string): Promise<ScheduledTask | null> {
    const list = await this.list()
    return list.find((t) => t.name === name) || null
  }

  async create(task: Omit<ScheduledTask, 'state' | 'lastRunAt' | 'lastResult'>): Promise<OperationResult> {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(task.name)) {
      return { ok: false, error: 'name 3-64 char alphanum/dash/underscore' }
    }
    const unitName = `saio-${task.name}`
    const serviceFile = path.join(this.unitDir, `${unitName}.service`)
    const timerFile = path.join(this.unitDir, `${unitName}.timer`)

    const onCalendar = this.scheduleToOnCalendar(task.schedule)
    const description = task.description || `SAIO scheduled task: ${task.name}`

    const serviceContent = `[Unit]
Description=${description}
After=network-online.target

[Service]
Type=oneshot
ExecStart=${task.command}

[Install]
WantedBy=default.target
`

    const timerContent = `[Unit]
Description=Timer for ${unitName}

[Timer]
OnCalendar=${onCalendar}
Persistent=true
Unit=${unitName}.service

[Install]
WantedBy=timers.target
`

    try {
      await fs.mkdir(this.unitDir, { recursive: true })
      await fs.writeFile(serviceFile, serviceContent, 'utf-8')
      await fs.writeFile(timerFile, timerContent, 'utf-8')
      await execAsync('systemctl --user daemon-reload', { encoding: 'utf-8' })
      await execAsync(`systemctl --user enable --now ${unitName}.timer`, { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async delete(name: string): Promise<OperationResult> {
    const unitName = `saio-${name}`
    try {
      await execAsync(`systemctl --user disable --now ${unitName}.timer`, { encoding: 'utf-8' })
      await fs.unlink(path.join(this.unitDir, `${unitName}.timer`)).catch(() => undefined)
      await fs.unlink(path.join(this.unitDir, `${unitName}.service`)).catch(() => undefined)
      await execAsync('systemctl --user daemon-reload', { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async enable(name: string): Promise<OperationResult> {
    const unitName = `saio-${name}`
    try {
      await execAsync(`systemctl --user enable --now ${unitName}.timer`, { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async disable(name: string): Promise<OperationResult> {
    const unitName = `saio-${name}`
    try {
      await execAsync(`systemctl --user disable --now ${unitName}.timer`, { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async run(name: string): Promise<OperationResult> {
    const unitName = `saio-${name}`
    try {
      await execAsync(`systemctl --user start ${unitName}.service`, { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async rename(oldName: string, newName: string): Promise<OperationResult> {
    const old = await this.get(oldName)
    if (!old) return { ok: false, error: 'task not found' }
    const create = await this.create({ ...old, name: newName })
    if (!create.ok) return create
    return await this.delete(oldName)
  }

  async setComment(name: string, comment: string): Promise<OperationResult> {
    // systemd: modifico Description nel .service file
    const unitName = `saio-${name}`
    const serviceFile = path.join(this.unitDir, `${unitName}.service`)
    try {
      const content = await fs.readFile(serviceFile, 'utf-8')
      const updated = content.replace(/^Description=.*$/m, `Description=${comment}`)
      await fs.writeFile(serviceFile, updated, 'utf-8')
      await execAsync('systemctl --user daemon-reload', { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  // ──────────────── Helpers ────────────────

  private scheduleToOnCalendar(spec: ScheduleSpec): string {
    const time = spec.time && /^\d{2}:\d{2}$/.test(spec.time) ? spec.time : '03:00'
    switch (spec.type) {
      case 'DAILY':
        return `*-*-* ${time}:00`
      case 'WEEKLY': {
        const dayMap: Record<string, string> = {
          MON: 'Mon',
          TUE: 'Tue',
          WED: 'Wed',
          THU: 'Thu',
          FRI: 'Fri',
          SAT: 'Sat',
          SUN: 'Sun',
        }
        const d = dayMap[spec.day || 'MON']
        return `${d} *-*-* ${time}:00`
      }
      case 'MONTHLY': {
        const dom = String(spec.dayOfMonth || '1').padStart(2, '0')
        return `*-*-${dom} ${time}:00`
      }
      case 'ONCE':
      default:
        return `*-*-* ${time}:00`
    }
  }
}
