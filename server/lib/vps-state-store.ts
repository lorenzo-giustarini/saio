/**
 * VPS State Store — per VPS tracking of installed CLIs + daily update state.
 *
 * Purpose (V13-T1.3):
 *  - Cache "which CLIs are installed on which VPS?" so UI can suggest the right AI
 *  - Track `firstRunToday` / `lastUpdateRun` so first daily session triggers preliminary updates
 *  - Probe via ssh on demand (not continuously)
 *
 * Storage: data/vps-state/<vpsId>.json, atomic write (temp+rename)
 */
import fsSync from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { VPS_HOSTS, type VpsHost } from './ssh-inventory'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

const SSH_TIMEOUT_MS = 12_000
const DEFAULT_KEY = path.join(os.homedir(), '.ssh', 'claude_vps')
const STATE_STALE_MS = 24 * 60 * 60_000 // 24h — probe again after this

// CLIs we care about (extensible)
export const KNOWN_CLIS = ['claude', 'codex', 'gemini', 'aichat', 'fal'] as const
export type KnownCli = (typeof KNOWN_CLIS)[number]

// Update commands per CLI (run via ssh during daily first-run)
const UPDATE_COMMANDS: Record<string, string> = {
  claude: 'npm update -g @anthropic-ai/claude-code 2>&1 | tail -5',
  codex: 'npm update -g @openai/codex 2>&1 | tail -5',
  gemini: 'npm update -g @google-ai/gemini 2>&1 | tail -5',
  aichat: 'cargo install --force aichat 2>&1 | tail -3 || true',
  fal: 'pip install --upgrade fal 2>&1 | tail -3 || true',
}

// Install commands per CLI (run on demand)
const INSTALL_COMMANDS: Record<string, string> = {
  claude: 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  gemini: 'npm install -g @google-ai/gemini',
  aichat: 'cargo install aichat',
  fal: 'pip install fal',
}

export interface CliStatus {
  installed: boolean
  version?: string
  path?: string
  lastCheck: string
  attemptedInstall?: string // ISO timestamp of last install attempt
  installError?: string
}

export interface VpsState {
  vpsId: string
  probedAt: string | null // ISO
  clis: Record<string, CliStatus>
  firstRunToday: string | null // ISO (YYYY-MM-DD detected from this)
  lastUpdateRun: string | null // ISO of last successful update
  notes?: string
  // V13.3-T8: tracking di quali account sono stati attivati su questa VPS
  usedByAccounts?: string[] // set di accountId visti in spawn remoti
  accountUsage?: Record<string, { firstUsedAt: string; lastUsedAt: string }>
}

function ymdFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    return iso.slice(0, 10)
  } catch {
    return null
  }
}

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10)
}

class VpsStateStore {
  private dataDir = ''
  private dir = ''

  setDataDir(baseDataDir: string) {
    this.dataDir = baseDataDir
    this.dir = path.join(baseDataDir, 'vps-state')
    try {
      fsSync.mkdirSync(this.dir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  private filePath(vpsId: string): string {
    const safe = vpsId.replace(/[^a-zA-Z0-9_-]/g, '')
    return path.join(this.dir, `${safe}.json`)
  }

  async load(vpsId: string): Promise<VpsState> {
    const fp = this.filePath(vpsId)
    try {
      const raw = await fsp.readFile(fp, 'utf8')
      return JSON.parse(raw) as VpsState
    } catch {
      // Fresh state
      return {
        vpsId,
        probedAt: null,
        clis: {},
        firstRunToday: null,
        lastUpdateRun: null,
      }
    }
  }

  private async atomicWrite(vpsId: string, state: VpsState): Promise<void> {
    const fp = this.filePath(vpsId)
    const tmp = `${fp}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
    await fsp.rename(tmp, fp)
  }

  async save(state: VpsState): Promise<void> {
    await this.atomicWrite(state.vpsId, state)
  }

  /**
   * Probe which CLIs are installed on a given VPS via a single ssh call.
   * Runs `command -v <cli> && <cli> --version` for each known CLI.
   */
  async probe(vps: VpsHost, clis: readonly string[] = KNOWN_CLIS): Promise<VpsState> {
    const keyPath = path.join(os.homedir(), '.ssh', vps.keyName)
    const probeScript = clis
      .map(
        (cli) =>
          `echo '===${cli}==='; command -v ${cli} 2>/dev/null && ${cli} --version 2>&1 | head -1 || echo 'NOT_INSTALLED'`
      )
      .join(';')

    const args = [
      '-i', keyPath,
      '-o', 'ConnectTimeout=5',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      `root@${vps.ip}`,
      probeScript,
    ]

    logger.info(`[vps-state] probe ${vps.id} for CLIs: ${clis.join(',')}`)
    let stdout = ''
    try {
      const res = await execFileAsync('ssh', args, { timeout: SSH_TIMEOUT_MS })
      stdout = res.stdout
    } catch (err: any) {
      logger.warn(`[vps-state] probe ${vps.id} failed: ${err.message}`)
      // Still update probedAt so we don't spam — mark all as unknown
      const state = await this.load(vps.id)
      state.probedAt = new Date().toISOString()
      state.notes = `probe failed: ${err.message?.slice(0, 200)}`
      await this.save(state)
      return state
    }

    const state = await this.load(vps.id)
    state.probedAt = new Date().toISOString()
    delete state.notes

    const sections = parseProbeOutput(stdout, clis as unknown as string[])
    for (const cli of clis) {
      const raw = sections[cli] || ''
      const installed = raw.trim().length > 0 && !raw.includes('NOT_INSTALLED')
      const lines = raw.split('\n').map((s) => s.trim()).filter(Boolean)
      const binPath = installed && lines[0]?.startsWith('/') ? lines[0] : undefined
      const version = installed ? lines.find((l) => !l.startsWith('/') && l !== 'NOT_INSTALLED') : undefined
      state.clis[cli] = {
        installed,
        version,
        path: binPath,
        lastCheck: new Date().toISOString(),
      }
    }

    await this.save(state)
    return state
  }

  /**
   * Ensure state is fresh. If never probed OR probed > 24h ago → re-probe.
   */
  async ensureFresh(vps: VpsHost): Promise<VpsState> {
    const state = await this.load(vps.id)
    const staleAge = state.probedAt ? Date.now() - new Date(state.probedAt).getTime() : Infinity
    if (!state.probedAt || staleAge > STATE_STALE_MS) {
      return this.probe(vps)
    }
    return state
  }

  /**
   * Return true if today is a NEW day (first spawn of the day on this VPS).
   * Idempotent: first call today → true, subsequent → false.
   * Caller must call `markFirstRunToday()` after consuming the signal.
   */
  async isFirstRunToday(vpsId: string): Promise<boolean> {
    const state = await this.load(vpsId)
    const lastYmd = ymdFromIso(state.firstRunToday)
    return lastYmd !== todayYmd()
  }

  async markFirstRunToday(vpsId: string): Promise<void> {
    const state = await this.load(vpsId)
    state.firstRunToday = new Date().toISOString()
    await this.save(state)
  }

  /**
   * V13.1 T7: Weekly update check — true if lastUpdateRun is > 7 days old or null.
   */
  async isFirstRunThisWeek(vpsId: string): Promise<boolean> {
    const state = await this.load(vpsId)
    if (!state.lastUpdateRun) return true
    const lastMs = new Date(state.lastUpdateRun).getTime()
    const now = Date.now()
    const WEEK_MS = 7 * 24 * 60 * 60_000
    return (now - lastMs) > WEEK_MS
  }

  /**
   * Run preliminary daily update on VPS for the given CLI(s).
   * Logs result, updates lastUpdateRun timestamp.
   * Non-fatal: if update fails, logs warning but does NOT throw.
   */
  async runDailyUpdate(vps: VpsHost, clis: string[] = []): Promise<{ ran: string[]; errors: Record<string, string> }> {
    const state = await this.load(vps.id)
    const target = clis.length > 0 ? clis : Object.keys(state.clis).filter((c) => state.clis[c]?.installed)
    if (target.length === 0) {
      logger.info(`[vps-state] ${vps.id}: no installed CLIs to update`)
      return { ran: [], errors: {} }
    }

    const keyPath = path.join(os.homedir(), '.ssh', vps.keyName)
    const ran: string[] = []
    const errors: Record<string, string> = {}

    for (const cli of target) {
      const cmd = UPDATE_COMMANDS[cli]
      if (!cmd) continue
      try {
        logger.info(`[vps-state] ${vps.id}: running daily update for ${cli}`)
        await execFileAsync(
          'ssh',
          [
            '-i', keyPath,
            '-o', 'ConnectTimeout=5',
            '-o', 'StrictHostKeyChecking=accept-new',
            '-o', 'BatchMode=yes',
            `root@${vps.ip}`,
            cmd,
          ],
          { timeout: 60_000 }
        )
        ran.push(cli)
      } catch (err: any) {
        logger.warn(`[vps-state] ${vps.id}: update ${cli} failed: ${err.message}`)
        errors[cli] = err.message?.slice(0, 200) || String(err)
      }
    }

    state.lastUpdateRun = new Date().toISOString()
    await this.save(state)
    return { ran, errors }
  }

  /**
   * Install a CLI on VPS via known install command.
   * Returns true on success, false on error (state.clis[cli].installError populated).
   */
  async installCli(vps: VpsHost, cli: string): Promise<boolean> {
    const installCmd = INSTALL_COMMANDS[cli]
    if (!installCmd) {
      logger.warn(`[vps-state] no install command for CLI: ${cli}`)
      return false
    }
    const keyPath = path.join(os.homedir(), '.ssh', vps.keyName)
    logger.info(`[vps-state] ${vps.id}: installing ${cli}`)
    const state = await this.load(vps.id)
    try {
      await execFileAsync(
        'ssh',
        [
          '-i', keyPath,
          '-o', 'ConnectTimeout=5',
          '-o', 'StrictHostKeyChecking=accept-new',
          '-o', 'BatchMode=yes',
          `root@${vps.ip}`,
          installCmd,
        ],
        { timeout: 120_000 }
      )
      // Re-probe just this CLI
      await this.probe(vps, [cli])
      return true
    } catch (err: any) {
      logger.error(`[vps-state] ${vps.id}: install ${cli} failed: ${err.message}`)
      state.clis[cli] = {
        ...(state.clis[cli] || {}),
        installed: false,
        lastCheck: new Date().toISOString(),
        attemptedInstall: new Date().toISOString(),
        installError: err.message?.slice(0, 200),
      }
      await this.save(state)
      return false
    }
  }

  /** List all VPS + their current state (loads all files) */
  async listAll(): Promise<VpsState[]> {
    const result: VpsState[] = []
    for (const vps of VPS_HOSTS) {
      result.push(await this.load(vps.id))
    }
    return result
  }

  /**
   * V13.3-T8: append accountId a `usedByAccounts` (dedup, idempotente).
   * Chiamato da pty-manager dopo uno spawn remoto con successo.
   */
  async trackAccountUsage(vpsId: string, accountId: string): Promise<void> {
    if (!vpsId || !accountId) return
    const state = await this.load(vpsId)
    const set = new Set(state.usedByAccounts || [])
    set.add(accountId)
    state.usedByAccounts = Array.from(set)
    const usage = state.accountUsage || {}
    const now = new Date().toISOString()
    const existing = usage[accountId]
    usage[accountId] = {
      firstUsedAt: existing?.firstUsedAt || now,
      lastUsedAt: now,
    }
    state.accountUsage = usage
    await this.save(state)
  }

  /** V13.3-T8: lista di tutti gli accountId visti su QUALUNQUE VPS */
  async listAccountsByVps(): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {}
    for (const vps of VPS_HOSTS) {
      const state = await this.load(vps.id)
      if (state.usedByAccounts && state.usedByAccounts.length > 0) {
        result[vps.id] = state.usedByAccounts
      }
    }
    return result
  }

  /** V13.3-T8: VPS IDs dove un dato account è stato attivato */
  async vpsUsedByAccount(accountId: string): Promise<Array<{ vpsId: string; firstUsedAt?: string; lastUsedAt?: string }>> {
    const hits: Array<{ vpsId: string; firstUsedAt?: string; lastUsedAt?: string }> = []
    for (const vps of VPS_HOSTS) {
      const state = await this.load(vps.id)
      if (state.usedByAccounts?.includes(accountId)) {
        hits.push({
          vpsId: vps.id,
          firstUsedAt: state.accountUsage?.[accountId]?.firstUsedAt,
          lastUsedAt: state.accountUsage?.[accountId]?.lastUsedAt,
        })
      }
    }
    return hits
  }
}

function parseProbeOutput(stdout: string, clis: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const cli of clis) {
    const start = `===${cli}===`
    const idx = stdout.indexOf(start)
    if (idx === -1) {
      out[cli] = ''
      continue
    }
    const rest = stdout.slice(idx + start.length)
    const endIdx = rest.search(/===[a-zA-Z0-9_-]+===/)
    out[cli] = (endIdx === -1 ? rest : rest.slice(0, endIdx)).trim()
  }
  return out
}

export const vpsStateStore = new VpsStateStore()

// For testing — export types
export { DEFAULT_KEY }
