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
import { MacOSElevator } from './elevator'

const execAsync = promisify(exec)

/**
 * macOS Task Scheduler: usa `launchd` con LaunchAgents user-level in
 * `~/Library/LaunchAgents/`. NON richiede admin (vive nel sandbox utente).
 *
 * Per ogni task crea un .plist file (XML Apple) + carica con `launchctl load`.
 *
 * Naming: `us.revolutionmarketing.saio.<task-name>.plist`
 */
export class MacOSTaskScheduler implements ITaskScheduler {
  private agentDir: string

  constructor(_elevator: MacOSElevator) {
    this.agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents')
  }

  async list(): Promise<ScheduledTask[]> {
    try {
      const files = await fs.readdir(this.agentDir)
      const tasks: ScheduledTask[] = []
      for (const f of files) {
        if (!f.startsWith('us.revolutionmarketing.saio.')) continue
        if (!f.endsWith('.plist')) continue
        const name = f.replace(/^us\.revolutionmarketing\.saio\./, '').replace(/\.plist$/, '')
        const filePath = path.join(this.agentDir, f)
        const content = await fs.readFile(filePath, 'utf-8').catch(() => '')
        const task = this.parsePlist(name, content)
        if (task) tasks.push(task)
      }
      return tasks
    } catch {
      return []
    }
  }

  async get(name: string): Promise<ScheduledTask | null> {
    return (await this.list()).find((t) => t.name === name) || null
  }

  async create(task: Omit<ScheduledTask, 'state' | 'lastRunAt' | 'lastResult'>): Promise<OperationResult> {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(task.name)) {
      return { ok: false, error: 'name 3-64 char alphanum/dash/underscore' }
    }
    const label = `us.revolutionmarketing.saio.${task.name}`
    const filePath = path.join(this.agentDir, `${label}.plist`)
    const plist = this.buildPlist(label, task.command, task.schedule, task.description)
    try {
      await fs.mkdir(this.agentDir, { recursive: true })
      await fs.writeFile(filePath, plist, 'utf-8')
      await execAsync(`launchctl load -w "${filePath}"`, { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async delete(name: string): Promise<OperationResult> {
    const label = `us.revolutionmarketing.saio.${name}`
    const filePath = path.join(this.agentDir, `${label}.plist`)
    try {
      await execAsync(`launchctl unload -w "${filePath}"`, { encoding: 'utf-8' }).catch(() => undefined)
      await fs.unlink(filePath)
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async enable(name: string): Promise<OperationResult> {
    const label = `us.revolutionmarketing.saio.${name}`
    const filePath = path.join(this.agentDir, `${label}.plist`)
    try {
      await execAsync(`launchctl load -w "${filePath}"`, { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async disable(name: string): Promise<OperationResult> {
    const label = `us.revolutionmarketing.saio.${name}`
    const filePath = path.join(this.agentDir, `${label}.plist`)
    try {
      await execAsync(`launchctl unload -w "${filePath}"`, { encoding: 'utf-8' })
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  async run(name: string): Promise<OperationResult> {
    const label = `us.revolutionmarketing.saio.${name}`
    try {
      await execAsync(`launchctl start ${label}`, { encoding: 'utf-8' })
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
    // launchd plist non ha campo "Description" runtime visibile; salviamo come custom key
    const label = `us.revolutionmarketing.saio.${name}`
    const filePath = path.join(this.agentDir, `${label}.plist`)
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      // Inject/update <key>SaioDescription</key><string>...</string>
      const escaped = comment.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      let updated: string
      if (content.includes('<key>SaioDescription</key>')) {
        updated = content.replace(
          /<key>SaioDescription<\/key>\s*<string>[^<]*<\/string>/,
          `<key>SaioDescription</key>\n  <string>${escaped}</string>`
        )
      } else {
        updated = content.replace(
          /<\/dict>\s*<\/plist>/,
          `  <key>SaioDescription</key>\n  <string>${escaped}</string>\n</dict>\n</plist>`
        )
      }
      await fs.writeFile(filePath, updated, 'utf-8')
      return { ok: true }
    } catch (err: unknown) {
      const e = err as Error
      return { ok: false, error: e.message }
    }
  }

  // ──────────────── Helpers ────────────────

  private buildPlist(label: string, command: string, schedule: ScheduleSpec, description?: string): string {
    const time = schedule.time && /^\d{2}:\d{2}$/.test(schedule.time) ? schedule.time : '03:00'
    const [hh, mm] = time.split(':').map((n) => parseInt(n, 10))
    const calBlock = this.scheduleToCalendar(schedule, hh!, mm!)
    const desc = (description || `SAIO scheduled task: ${label}`).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>${command.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>
  </array>
  ${calBlock}
  <key>RunAtLoad</key>
  <false/>
  <key>SaioDescription</key>
  <string>${desc}</string>
</dict>
</plist>
`
  }

  private scheduleToCalendar(spec: ScheduleSpec, hh: number, mm: number): string {
    switch (spec.type) {
      case 'DAILY':
        return `<key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hh}</integer>
    <key>Minute</key><integer>${mm}</integer>
  </dict>`
      case 'WEEKLY': {
        const dayMap: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }
        const w = dayMap[spec.day || 'MON'] ?? 1
        return `<key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key><integer>${w}</integer>
    <key>Hour</key><integer>${hh}</integer>
    <key>Minute</key><integer>${mm}</integer>
  </dict>`
      }
      case 'MONTHLY': {
        const d = parseInt(String(spec.dayOfMonth || '1'), 10)
        return `<key>StartCalendarInterval</key>
  <dict>
    <key>Day</key><integer>${d}</integer>
    <key>Hour</key><integer>${hh}</integer>
    <key>Minute</key><integer>${mm}</integer>
  </dict>`
      }
      case 'ONCE':
      default:
        return `<key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hh}</integer>
    <key>Minute</key><integer>${mm}</integer>
  </dict>`
    }
  }

  private parsePlist(name: string, content: string): ScheduledTask | null {
    if (!content) return null
    const cmdMatch = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/m.exec(content)
    let command = ''
    if (cmdMatch) {
      const strs = [...cmdMatch[1]!.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]!)
      // ProgramArguments tipico: ['/bin/sh', '-c', '<command>']
      command = strs[strs.length - 1] || ''
    }
    const descMatch = /<key>SaioDescription<\/key>\s*<string>([^<]*)<\/string>/m.exec(content)
    const description = descMatch?.[1] || undefined
    // Schedule parse minimo (default DAILY 03:00)
    const hourMatch = /<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/m.exec(content)
    const minMatch = /<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/m.exec(content)
    const time = hourMatch && minMatch
      ? `${hourMatch[1]!.padStart(2, '0')}:${minMatch[1]!.padStart(2, '0')}`
      : '03:00'
    const wMatch = /<key>Weekday<\/key>\s*<integer>(\d+)<\/integer>/m.exec(content)
    const dMatch = /<key>Day<\/key>\s*<integer>(\d+)<\/integer>/m.exec(content)
    let schedule: ScheduleSpec
    if (wMatch) {
      const dayMap: Record<string, import('../types').WeekDay> = {
        '0': 'SUN', '1': 'MON', '2': 'TUE', '3': 'WED', '4': 'THU', '5': 'FRI', '6': 'SAT',
      }
      schedule = { type: 'WEEKLY', time, day: dayMap[wMatch[1]!] || 'MON' }
    } else if (dMatch) {
      schedule = { type: 'MONTHLY', time, dayOfMonth: dMatch[1] }
    } else {
      schedule = { type: 'DAILY', time }
    }
    return {
      name,
      command,
      schedule,
      state: 'ready',
      description,
    }
  }
}
