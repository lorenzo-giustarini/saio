import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ITaskScheduler,
  ScheduledTask,
  ScheduleSpec,
  OperationResult,
  TaskState,
} from '../types'
import { WindowsElevator } from './elevator'

const execAsync = promisify(exec)

/**
 * Windows Task Scheduler implementation tramite `schtasks.exe` + elevator
 * pattern (zero-UAC) per operazioni che richiedono privilegi admin.
 */
export class WindowsTaskScheduler implements ITaskScheduler {
  constructor(private elevator: WindowsElevator) {}

  async list(): Promise<ScheduledTask[]> {
    try {
      const { stdout } = await execAsync('schtasks /query /fo CSV /v', {
        encoding: 'utf-8',
        maxBuffer: 64 * 1024 * 1024,
      })
      return this.parseCsvOutput(stdout)
    } catch {
      return []
    }
  }

  async get(name: string): Promise<ScheduledTask | null> {
    try {
      const { stdout } = await execAsync(`schtasks /query /tn "${name}" /fo CSV /v`, {
        encoding: 'utf-8',
      })
      const tasks = this.parseCsvOutput(stdout)
      return tasks[0] || null
    } catch {
      return null
    }
  }

  async create(task: Omit<ScheduledTask, 'state' | 'lastRunAt' | 'lastResult'>): Promise<OperationResult> {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(task.name)) {
      return { ok: false, error: 'name 3-64 char alphanum/dash/underscore' }
    }
    return await this.elevator.run({
      op: 'task-create',
      taskName: task.name,
      spec: task.schedule,
      command: task.command,
      description: task.description,
    })
  }

  async delete(name: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'task-delete', taskName: name })
  }

  async enable(name: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'task-enable', taskName: name })
  }

  async disable(name: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'task-disable', taskName: name })
  }

  async run(name: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'task-run', taskName: name })
  }

  async rename(oldName: string, newName: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'task-rename', taskName: oldName, newName })
  }

  async setComment(name: string, comment: string): Promise<OperationResult> {
    return await this.elevator.run({ op: 'task-set-comment', taskName: name, comment })
  }

  // ──────────────── Helpers ────────────────

  private parseCsvOutput(csv: string): ScheduledTask[] {
    const lines = csv.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) return []
    const headers = this.splitCsvLine(lines[0]!)
    const out: ScheduledTask[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = this.splitCsvLine(lines[i]!)
      if (cols.length < headers.length) continue
      const get = (h: string) => {
        const idx = headers.indexOf(h)
        return idx >= 0 ? cols[idx] || '' : ''
      }
      const name = get('TaskName').replace(/^\\/, '')
      if (!name) continue
      const status = (get('Status') || '').toLowerCase()
      const state: TaskState =
        status.includes('disab')
          ? 'disabled'
          : status.includes('run')
            ? 'running'
            : status.includes('queue')
              ? 'queued'
              : status.includes('ready')
                ? 'ready'
                : 'unknown'
      out.push({
        name,
        command: get('Task To Run'),
        schedule: this.parseSchedule(get('Schedule Type'), get('Start Time'), get('Days')),
        state,
        description: get('Comment') || undefined,
        nextRunAt: get('Next Run Time') || undefined,
        lastRunAt: get('Last Run Time') || undefined,
      })
    }
    // Dedupe per nome (schtasks può listare multi-trigger come righe duplicate)
    const seen = new Set<string>()
    return out.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)))
  }

  private splitCsvLine(line: string): string[] {
    const out: string[] = []
    let cur = ''
    let inQ = false
    for (const c of line) {
      if (c === '"') inQ = !inQ
      else if (c === ',' && !inQ) {
        out.push(cur)
        cur = ''
      } else cur += c
    }
    out.push(cur)
    return out
  }

  private parseSchedule(typeRaw: string, time: string, days: string): ScheduleSpec {
    const t = (typeRaw || '').toLowerCase()
    const hhmm = time && /(\d{1,2}):(\d{2})/.exec(time)
    const timeStr = hhmm ? `${hhmm[1]!.padStart(2, '0')}:${hhmm[2]}` : '00:00'
    if (t.includes('daily') || t.includes('giornal')) return { type: 'DAILY', time: timeStr }
    if (t.includes('weekly') || t.includes('settim'))
      return { type: 'WEEKLY', time: timeStr, day: this.parseDay(days) }
    if (t.includes('monthly') || t.includes('mens'))
      return { type: 'MONTHLY', time: timeStr, dayOfMonth: days || '1' }
    return { type: 'ONCE', time: timeStr }
  }

  private parseDay(d: string): import('../types').WeekDay {
    const u = (d || '').toUpperCase()
    if (u.includes('MON')) return 'MON'
    if (u.includes('TUE') || u.includes('MAR')) return 'TUE'
    if (u.includes('WED') || u.includes('MER')) return 'WED'
    if (u.includes('THU') || u.includes('GIO')) return 'THU'
    if (u.includes('FRI') || u.includes('VEN')) return 'FRI'
    if (u.includes('SAT') || u.includes('SAB')) return 'SAT'
    if (u.includes('SUN') || u.includes('DOM')) return 'SUN'
    return 'MON'
  }
}
