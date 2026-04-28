import * as pty from 'node-pty'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile, spawn as childSpawn } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from './logger'
import { VPS_HOSTS, type VpsHost } from './ssh-inventory'
import type { Account } from '../../shared/schemas'
import { providerRegistry } from './provider-registry'

const execFileAsync = promisify(execFile)

// V15.1 WS31: pre-spawn CLI update — paths e mapping CLI → tool registry id.
// Lo state file e' aggiornato dal weekly executor `run-cli-updates.ps1` e letto
// qui per decidere se schedulare un update fire-and-forget prima di pty.spawn.
// Plan: eventual-baking-bentley.md
const VAULT_LOGS_DIR = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'memory',
  'logs'
)
const CLI_UPDATE_STATE_FILE = path.join(VAULT_LOGS_DIR, 'cli-update-state.json')
const RUN_CLI_UPDATES_PS1 = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'memory',
  'scripts',
  'run-cli-updates.ps1'
)
const PRE_SPAWN_THROTTLE_MS = 168 * 60 * 60 * 1000 // 7 giorni

// Mappa CLI binary name → tool registry id usato in run-cli-updates.ps1.
// Estendere con nuovi mapping quando il provider-registry aggiunge CLI nuovi.
const CLI_TO_TOOL_ID: Record<string, string> = {
  claude: 'claude-code',
  'claude.exe': 'claude-code',
  gemini: 'gemini-cli',
  'gemini.exe': 'gemini-cli',
  codex: 'codex',
  'codex.exe': 'codex',
}

/**
 * V15.1 WS31: tenta async update di un CLI tool prima di spawnarlo.
 * Fire-and-forget: spawna PowerShell detached, NON blocca la pty.spawn().
 * Skip immediato (zero overhead) se il tool e' stato aggiornato negli ultimi 168h.
 * Logger.warn graceful su qualsiasi errore — mai bloccante.
 */
async function maybePreSpawnUpdate(cliName: string, projectId: string): Promise<void> {
  if (!cliName || os.platform() !== 'win32') return // wrapper Windows-only (PowerShell)
  if (!fs.existsSync(CLI_UPDATE_STATE_FILE)) return // primo run, lascia weekly fare populate
  const toolId = CLI_TO_TOOL_ID[cliName.toLowerCase()]
  if (!toolId) return // CLI non tracciato

  let state: any
  try {
    state = JSON.parse(fs.readFileSync(CLI_UPDATE_STATE_FILE, 'utf8'))
  } catch {
    return // state file corrotto: weekly lo riscrivera'
  }
  const tool = state?.tools?.[toolId]
  if (!tool?.last_update) return // mai aggiornato: weekly fara' primo populate

  const lastUpdate = new Date(tool.last_update).getTime()
  if (Number.isNaN(lastUpdate)) return
  const ageMs = Date.now() - lastUpdate
  if (ageMs < PRE_SPAWN_THROTTLE_MS) {
    logger.info(
      `[pty] ${projectId}: pre-spawn ${toolId} skipped (updated ${Math.round(ageMs / 3600000)}h ago < 168h)`
    )
    return
  }

  // Fire-and-forget: PowerShell detached, output discarded
  logger.info(
    `[pty] ${projectId}: pre-spawn triggering async update for ${toolId} (${Math.round(ageMs / 3600000)}h ago)`
  )
  try {
    const child = childSpawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        RUN_CLI_UPDATES_PS1,
        '-Tool',
        toolId,
        '-Async',
      ],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    child.unref()
  } catch (err: any) {
    logger.warn(`[pty] ${projectId}: pre-spawn spawn failed: ${err?.message || err}`)
  }
}

/** V13.1 T6: check if CLI is in local PATH (win32 uses 'where', Unix 'command -v') */
async function isLocalCliInstalled(cliName: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9_.-]+$/.test(cliName)) return false
  try {
    if (os.platform() === 'win32') {
      await execFileAsync('where', [cliName], { timeout: 3000, shell: false as any })
    } else {
      await execFileAsync('sh', ['-c', `command -v ${cliName}`], { timeout: 3000 })
    }
    return true
  } catch {
    return false
  }
}

// Resolve Claude Code slug from a cwd path. Claude transforms cwd → slug by
// replacing each non-alphanumeric char with '-' (no collapse, no prepend).
// Example: "C:\Users\info\Desktop\CLAUDE WORLD" → "C--Users-info-Desktop-CLAUDE-WORLD"
export function claudeSlugFromCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-').replace(/^-|-$/g, '')
}

/**
 * V14.4 — Validate the tail of a jsonl file (last `tailN` complete lines).
 * "Complete line" = line ending with newline; ignore eventual last partial line
 * (Claude potrebbe stare scrivendo proprio adesso e l'ultima riga è truncated).
 *
 * Ritorna true se TUTTE le ultime tailN righe complete sono JSON.parseable.
 * Ritorna false se anche solo una è corrotta → caller skipperà --continue per
 * evitare il bug Claude CLI `processing_error` al resume.
 *
 * NESSUN file viene mai rimosso da questa funzione: side-effect free.
 */
function validateJsonlTail(file: string, tailN: number): boolean {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw) return false
    // Se il file non termina con newline, l'ultima riga potrebbe essere in
    // scrittura concorrente: la scartiamo per evitare false positive.
    const endsWithNewline = raw.endsWith('\n') || raw.endsWith('\r\n')
    let lines = raw.split('\n').map((l) => l.replace(/\r$/, ''))
    if (!endsWithNewline && lines.length > 0) lines = lines.slice(0, -1)
    lines = lines.filter((l) => l.length > 0)
    if (lines.length === 0) return false
    const tail = lines.slice(-tailN)
    for (const line of tail) {
      try {
        JSON.parse(line)
      } catch {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

// Check if a cwd has ANY existing Claude conversation (jsonl files).
// Used to decide whether to use --continue or plain claude.
//
// V14.4: oltre al check di esistenza, valida la jsonl più recente (la sessione
// che `claude --continue` riprenderebbe). Se le ultime 10 righe sono malformate,
// considera la cronologia "non riprenibile" e ritorna false → spawn fresh.
// Le jsonl restano sul disco (non rimosse) per eventuale recovery manuale.
export function hasClaudeHistory(cwd: string): boolean {
  try {
    const slug = claudeSlugFromCwd(cwd)
    const projDir = path.join(os.homedir(), '.claude', 'projects', slug)
    if (!fs.existsSync(projDir)) return false
    const jsonls = fs.readdirSync(projDir).filter((e) => e.endsWith('.jsonl'))
    if (jsonls.length === 0) return false

    // Trova la jsonl più recente per mtime (è quella che --continue riprende)
    let mostRecent: { full: string; mtime: number } | null = null
    for (const name of jsonls) {
      try {
        const full = path.join(projDir, name)
        const st = fs.statSync(full)
        const mtime = st.mtimeMs
        if (!mostRecent || mtime > mostRecent.mtime) mostRecent = { full, mtime }
      } catch {
        /* skip unreadable */
      }
    }
    if (!mostRecent) return false

    if (!validateJsonlTail(mostRecent.full, 10)) {
      logger.warn(
        `[pty] ${slug}: jsonl più recente ${path.basename(mostRecent.full)} ha tail corrotta — skipping --continue (file NON rimosso, sessione fresh)`
      )
      return false
    }
    return true
  } catch {
    return false
  }
}

// Read the most recent session metadata (mtime, line count proxy for msg count)
export function lastSessionInfo(cwd: string): { lastUsed: string; messages: number; sessionId: string } | null {
  try {
    const slug = claudeSlugFromCwd(cwd)
    const projDir = path.join(os.homedir(), '.claude', 'projects', slug)
    if (!fs.existsSync(projDir)) return null
    const files = fs.readdirSync(projDir).filter((f) => f.endsWith('.jsonl'))
    if (files.length === 0) return null
    let latest: { file: string; mtime: Date } | null = null
    for (const f of files) {
      const full = path.join(projDir, f)
      const st = fs.statSync(full)
      if (!latest || st.mtime > latest.mtime) latest = { file: f, mtime: st.mtime }
    }
    if (!latest) return null
    const content = fs.readFileSync(path.join(projDir, latest.file), 'utf8')
    const messages = content.split('\n').filter((l) => {
      try {
        const d = JSON.parse(l)
        return d.type === 'user' || d.type === 'assistant'
      } catch { return false }
    }).length
    return {
      lastUsed: latest.mtime.toISOString(),
      messages,
      sessionId: latest.file.replace(/\.jsonl$/, ''),
    }
  } catch {
    return null
  }
}

// Strip ANSI escape codes for readable log files
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r\n/g, '\n')
}

const MAX_SESSIONS = 6
const IDLE_TIMEOUT_MS = 60 * 60_000 // 1 hour
const MAX_BUFFER_PER_SESSION = 1_000_000 // 1MB scrollback
const RECENT_TAIL_BYTES = 8192 // V15.0 WS30B: rolling output window per crash detection

// V15.0 WS30B: pattern di crash che indicano sessione .jsonl logicamente corrotta.
// Il Claude CLI bundlato con Bun, in alcune versioni, crasha al deserialize di
// certi state al `--continue` con TypeError minified tipo "FKH is not a function"
// (le lettere variano per versione, ma il pattern "<2-4 lettere> is not a function"
// emesso DAL bundle B:/~BUN/root/src/entrypoints/cli.js e' la firma).
// Vedi plan refactored-honking-planet.md FIX 2.
const CRASH_PATTERNS: RegExp[] = [
  /\bFKH is not a function\b/,
  /\b[A-Z]{2,4}[a-z]?\d? is not a function\b/,
  /BUN[/\\]+root[/\\]+src[/\\]+entrypoints[/\\]+cli\.js/i,
]

export interface Session {
  projectId: string
  proc: pty.IPty
  startedAt: number
  lastActivity: number
  buffer: string[]
  bufferSize: number
  listeners: Set<(data: string) => void>
  exitHandlers: Set<(exitCode: number, signal?: number) => void>
  logFilePath: string
  logStream: fs.WriteStream | null
  // V13.1: tracking for auto-respawn
  updateRunAt?: number       // timestamp ms of last update run (for respawn window)
  respawned?: boolean        // flag: already respawned once (prevent loop)
  lastSpawnOpts?: SpawnOptions // save opts for respawn
  // V15.0 WS30B: crash detection + auto-quarantine state
  recentTail?: string        // ultimi RECENT_TAIL_BYTES dell'output PTY (rolling)
  spawnedWithResume?: boolean // true se PTY era partita con --continue
  cwd?: string               // workspace dir, per ricostruire slug Claude in onExit
}

export interface SpawnOptions {
  cwd?: string
  resume?: boolean // if true and history exists → claude --continue (default true)
  forceNew?: boolean // if true → always plain claude, no resume
  model?: string // --model <id> (e.g. 'claude-opus-4-7', 'opus', 'sonnet')
  permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  // V13: account/provider dispatch
  accountId?: string // resolve to provider + mode + cli + envVars
  // V13: remote via SSH wrapper
  remote?: {
    vpsId: string // ID del VPS registrato (in ssh-inventory)
    cliName: string // CLI da invocare sul VPS (claude|codex|gemini|aichat|...)
  }
  // V13: task-type routing hint (analytics + auto-routing cron)
  taskType?: string
  // V13: per-spawn environment overrides (sec: only for whitelisted env var NAMES referenced by accounts)
  extraEnv?: Record<string, string>
}

export interface RemoteSpawnTarget {
  vpsId: string
  ip: string
  user: string
  keyPath: string
  cliName: string
  cliArgs: string[]
}

/**
 * Build the shell command string for a remote SSH spawn.
 * Uses pattern: ssh -i <key> -o ServerAliveInterval=30 user@ip "cd ~ && cli args"
 * Returns the full command suitable for `cmd.exe /k <cmd>` (Windows) or `bash -c <cmd>` (Unix).
 */
export function buildRemoteSshCommand(target: RemoteSpawnTarget): string {
  const sshFlags = [
    '-i', target.keyPath,
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-t', // allocate TTY for interactive CLI (required for claude/codex/gemini)
  ].join(' ')
  const remoteCmd = [target.cliName, ...target.cliArgs].join(' ').trim()
  // Double-escape single quotes for safe passthrough
  const escaped = remoteCmd.replace(/'/g, "'\\''")
  return `ssh ${sshFlags} ${target.user}@${target.ip} '${escaped}'`
}

/**
 * V13: Build args for a CLI based on account mode + model + permissionMode.
 * Handles different arg conventions across Claude, Codex, Gemini, aichat.
 */
export function buildCliArgsForAccount(
  cliName: string,
  opts: { model?: string; permissionMode?: string; resume?: boolean }
): string[] {
  const args: string[] = []
  switch (cliName) {
    case 'claude':
      if (opts.resume) args.push('--continue')
      if (opts.model) args.push('--model', opts.model)
      if (opts.permissionMode && opts.permissionMode !== 'default') {
        args.push('--permission-mode', opts.permissionMode)
      }
      break
    case 'codex':
      // @openai/codex args: --model <id>
      if (opts.model) args.push('--model', opts.model)
      break
    case 'gemini':
      // gemini CLI: --model <id>
      if (opts.model) args.push('--model', opts.model)
      break
    case 'aichat':
      // aichat: -m <provider:model>
      if (opts.model) args.push('-m', opts.model)
      break
    // Other CLIs: pass model verbatim
    default:
      if (opts.model) args.push('--model', opts.model)
  }
  return args
}

/**
 * V13: Resolve an env overlay for an account (API key injection).
 * Reads env var from process.env OR ~/.claude/settings.json `env`.
 * Returns an object to merge into spawn env.
 */
export async function resolveAccountEnv(account: Account): Promise<Record<string, string>> {
  const extra: Record<string, string> = {}
  if (account.mode === 'api' && account.envVarRef) {
    // Try process.env first (secure, preferred)
    const val = process.env[account.envVarRef]
    if (typeof val === 'string' && val.length > 0) {
      extra[account.envVarRef] = val
      return extra
    }
    // Fallback: read from ~/.claude/settings.json env
    try {
      const p = path.join(os.homedir(), '.claude', 'settings.json')
      const raw = await fsp.readFile(p, 'utf8')
      const data = JSON.parse(raw)
      const v = data?.env?.[account.envVarRef]
      if (typeof v === 'string' && v.length > 0) {
        extra[account.envVarRef] = v
      }
    } catch {
      /* ignore — env var simply missing, spawn will fail with auth error later */
    }
  }
  return extra
}

/**
 * Resolve CLI name + args + env for an Account.
 * Pure function — does not depend on running state.
 */
export async function buildSpawnSpecFromAccount(
  account: Account,
  opts: { model?: string; permissionMode?: string; resume?: boolean }
): Promise<{ cliName: string; args: string[]; env: Record<string, string> }> {
  const provider = providerRegistry.get(account.providerId)

  let cliName: string
  switch (account.mode) {
    case 'plan':
      cliName = account.cliName || provider?.modeDefaults.plan?.cliName || 'claude'
      break
    case 'api':
      cliName = account.cliName || provider?.modeDefaults.api?.cliWrapper || provider?.modeDefaults.cli?.cliName || 'claude'
      break
    case 'cli':
      cliName = account.cliName || provider?.modeDefaults.cli?.cliName || 'claude'
      break
    case 'playwright':
      // Playwright spawns node adapter — T7.1
      cliName = 'node'
      break
    default:
      cliName = 'claude'
  }

  const model = opts.model || account.defaultModel
  const args = account.mode === 'playwright'
    ? [] // Playwright adapter args added by caller (T7.1)
    : [
        ...(account.cliArgs || []),
        ...buildCliArgsForAccount(cliName, { ...opts, model }),
      ]

  const env = await resolveAccountEnv(account)
  return { cliName, args, env }
}

class PtyManager {
  private sessions = new Map<string, Session>()
  private dataDir = ''

  setDataDir(dir: string) {
    this.dataDir = dir
    try {
      fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
      fs.mkdirSync(path.join(dir, 'project-workspaces'), { recursive: true })
    } catch {
      /* ignore */
    }
  }

  // Resolve dedicated workspace dir for a project.
  // Fixed cwd ensures Claude's history is scoped to THIS project only.
  workspaceDirFor(projectId: string): string {
    const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64)
    const dir = path.join(this.dataDir, 'project-workspaces', safe)
    try {
      fs.mkdirSync(dir, { recursive: true })
      // Stub README to give Claude context on first spawn
      const readme = path.join(dir, 'README.md')
      if (!fs.existsSync(readme)) {
        fs.writeFileSync(readme, `# Workspace progetto: ${projectId}\n\nQuesta directory è il contesto persistente della sessione Claude per il progetto \`${projectId}\` nella dashboard RM.\n\n**Tutte le conversazioni qui dentro vengono salvate in \`~/.claude/projects/\` scopate per questo workspace** — \`claude --continue\` riprende automaticamente l'ultima conv di questo progetto.\n`)
      }
    } catch {
      /* ignore */
    }
    return dir
  }

  /**
   * getOrCreate — returns existing or spawns new PTY session.
   * V13: Async to allow accountId resolution (reads accounts-store).
   * If accountId is set, uses account's CLI/env for spawn. Otherwise defaults to 'claude' local.
   */
  async getOrCreate(projectId: string, opts: SpawnOptions = {}): Promise<Session | { error: string }> {
    const existing = this.sessions.get(projectId)
    if (existing) {
      // V15.0 WS30A: forceNew=true con sessione esistente → kill + spawn fresh.
      // Senza questo, "Inizia da zero" lato UI veniva ignorato dal backend e l'utente
      // restava attaccato al claude.exe crashato (es. bug FKH is not a function su
      // resume di .jsonl corrotta). Vedi plan refactored-honking-planet.md FIX 1.
      if (opts.forceNew) {
        logger.info(`[pty] ${projectId}: forceNew=true with existing session pid=${existing.proc.pid} → killing then spawning fresh`)
        this.kill(projectId)
        // Piccolo beat async per liberare la slot PTY su Windows prima del nuovo spawn
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
      } else {
        existing.lastActivity = Date.now()
        return existing
      }
    }
    if (this.sessions.size >= MAX_SESSIONS) {
      return { error: `max sessions reached (${MAX_SESSIONS}) — chiudi altre prima di aprirne di nuove` }
    }

    const cwd = opts.cwd || this.workspaceDirFor(projectId)
    const env = { ...process.env, ...(opts.extraEnv || {}) } as any

    // V13-T3.2 + V13.1-BUG1c: Resolve account
    // 1. If opts.accountId explicit → use it
    // 2. Else try project.accountOverride
    // 3. Else use globalActive
    // 4. Else fallback to claude
    let account: Account | null = null
    let resolvedAccountId = opts.accountId
    try {
      const { accountsStore } = await import('./accounts-store')
      if (resolvedAccountId) {
        account = await accountsStore.findById(resolvedAccountId)
        if (!account) return { error: `account not found: ${resolvedAccountId}` }
      } else if (!opts.remote) {
        // V13.1-BUG1c: auto-resolve for LOCAL spawn (remote uses separate cli override)
        // Check project override first
        try {
          const { projectsStore } = await import('./projects-store')
          const proj = await projectsStore.findById(projectId)
          if (proj?.accountOverride) {
            account = await accountsStore.findById(proj.accountOverride)
            if (account) {
              resolvedAccountId = account.id
              logger.info(`[pty] ${projectId}: using project override account ${account.id}`)
            }
          }
        } catch { /* no project, use global */ }

        // Fallback to active global
        if (!account) {
          account = await accountsStore.getActive()
          if (account) {
            resolvedAccountId = account.id
            logger.info(`[pty] ${projectId}: using global active account ${account.id}`)
          }
        }
      }
      if (account) {
        const accountEnv = await resolveAccountEnv(account)
        Object.assign(env, accountEnv)
        logger.info(`[pty] ${projectId}: account=${account.id} (${account.providerId}/${account.mode})`)
      }
    } catch (err: any) {
      logger.error(`[pty] account resolution failed: ${err.message}`)
      // Continue with fallback (no account, uses claude)
    }

    // V14 — auto-route via account.target: se account ha target!='local' e opts.remote non è già esplicito,
    // forza spawn remoto sul VPS configurato per quell'account. Project.spawnTarget (se passato via opts.remote)
    // ha sempre precedenza (caller decide).
    if (!opts.remote && account?.target && account.target !== 'local') {
      const cliForRemote = account.cliName
        || (account.mode === 'plan' ? 'claude' : account.mode === 'cli' ? 'claude' : 'claude')
      logger.info(`[pty] ${projectId}: account ${account.id} target=${account.target} → auto-route remote spawn (cli=${cliForRemote})`)
      opts = { ...opts, remote: { vpsId: account.target, cliName: cliForRemote } }
    }

    // ==== V13: Remote SSH branch ============================================
    // If opts.remote is set → spawn via ssh wrapper to a VPS. Resume flag is
    // respected (--continue on cli if supported). Model/permissionMode passed.
    let effectiveCmd: string
    let shouldResume = false
    if (opts.remote) {
      const vps: VpsHost | undefined = VPS_HOSTS.find((v) => v.id === opts.remote!.vpsId)
      if (!vps) return { error: `unknown vpsId: ${opts.remote.vpsId}` }
      const cliName = opts.remote.cliName
      if (!/^[a-zA-Z0-9_-]{1,32}$/.test(cliName)) return { error: `invalid cliName: ${cliName}` }

      // Use buildCliArgsForAccount for remote too (CLI-aware)
      const cliArgs = buildCliArgsForAccount(cliName, {
        model: opts.model || account?.defaultModel,
        permissionMode: opts.permissionMode,
      })

      const keyPath = path.join(os.homedir(), '.ssh', vps.keyName)
      effectiveCmd = buildRemoteSshCommand({
        vpsId: vps.id,
        ip: vps.ip,
        user: 'root',
        keyPath,
        cliName,
        cliArgs,
      })
      logger.info(`[pty] ${projectId}: REMOTE ssh to vps=${vps.id} cli=${cliName}`)
    } else if (account) {
      // ==== V13: Account-driven LOCAL spawn ================================
      const resume = !opts.forceNew && hasClaudeHistory(cwd)
      shouldResume = resume
      const spec = await buildSpawnSpecFromAccount(account, {
        model: opts.model,
        permissionMode: opts.permissionMode,
        resume,
      })

      // V14.14: rimosso il pre-spawn health check + auto-install console.
      // Causava 2 cmd.exe Windows in apertura simultanea (React strict mode dev runs
      // useEffect 2x) + race condition di `where claude` con timeout 3s su Windows.
      // Ora il PTY parte sempre: se Claude non è in PATH, il TUI mostrerà l'errore
      // visibile e l'utente può cliccare "Installa" sulla card account manualmente.
      // `isLocalCliInstalled` resta definita per usi futuri ma non più chiamata qui.

      Object.assign(env, spec.env)
      effectiveCmd = [spec.cliName, ...spec.args].join(' ').trim()
      logger.info(
        `[pty] ${projectId}: account=${account.id} cli=${spec.cliName} model=${opts.model || account.defaultModel || 'default'}`
      )
    } else {
      // ==== Fallback: Local Claude (preserve V12 compatibility) ============
      shouldResume = !opts.forceNew && hasClaudeHistory(cwd)
      const claudeArgs: string[] = []
      if (shouldResume) claudeArgs.push('--continue')
      if (opts.model) claudeArgs.push('--model', opts.model)
      if (opts.permissionMode && opts.permissionMode !== 'default') {
        claudeArgs.push('--permission-mode', opts.permissionMode)
      }
      effectiveCmd = ['claude', ...claudeArgs].join(' ')
      logger.info(`[pty] ${projectId}: cwd=${cwd} resume=${shouldResume} model=${opts.model || 'default'} perm=${opts.permissionMode || 'default'}`)
    }

    // V15.1 WS31: pre-spawn update check (fire-and-forget, throttled 168h per tool).
    // Plan: eventual-baking-bentley.md. Lettura state file <10ms; se update necessario
    // viene schedulato in background (PowerShell detached) e pty.spawn parte SUBITO.
    try {
      const cliId = (effectiveCmd.split(/\s+/)[0] || '').replace(/^"|"$/g, '')
      maybePreSpawnUpdate(cliId, projectId).catch((err) => {
        logger.warn(`[pty] ${projectId}: pre-spawn update check failed (non-blocking): ${err?.message || err}`)
      })
    } catch {
      /* never block spawn for pre-update issues */
    }

    const shell = os.platform() === 'win32' ? 'cmd.exe' : (process.env.SHELL || 'bash')

    let proc: pty.IPty
    try {
      proc = pty.spawn(
        shell,
        os.platform() === 'win32' ? ['/k', effectiveCmd] : ['-c', effectiveCmd],
        {
          name: 'xterm-color',
          cols: 100,
          rows: 30,
          cwd,
          env,
        }
      )
    } catch (err: any) {
      logger.error(`pty.spawn failed for ${projectId}:`, err)
      return { error: `pty spawn failed: ${err.message}` }
    }

    // Persistent log file (append-only, ANSI stripped)
    const logFilePath = this.dataDir
      ? path.join(this.dataDir, 'logs', `${projectId}.log`)
      : path.join(os.tmpdir(), `rm-dashboard-${projectId}.log`)
    let logStream: fs.WriteStream | null = null
    try {
      logStream = fs.createWriteStream(logFilePath, { flags: 'a' })
      logStream.write(`\n[${new Date().toISOString()}] === SESSION START pid=${proc.pid} ===\n`)
    } catch (err) {
      logger.warn(`Cannot open log file ${logFilePath}:`, err)
    }

    const session: Session = {
      projectId,
      proc,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      buffer: [],
      bufferSize: 0,
      listeners: new Set(),
      exitHandlers: new Set(),
      logFilePath,
      logStream,
      // V13.1 T8: save spawn opts for potential auto-respawn
      lastSpawnOpts: { ...opts },
      updateRunAt: opts.remote ? Date.now() : undefined, // mark as recent update if remote (may trigger daily update)
      respawned: false,
      // V15.0 WS30B: crash detection state
      recentTail: '',
      spawnedWithResume: shouldResume,
      cwd,
    }

    proc.onData((data) => {
      session.lastActivity = Date.now()
      // Append to scrollback buffer (dropping oldest if over limit)
      session.buffer.push(data)
      session.bufferSize += data.length
      while (session.bufferSize > MAX_BUFFER_PER_SESSION && session.buffer.length > 0) {
        const first = session.buffer.shift()
        session.bufferSize -= first?.length || 0
      }
      // V15.0 WS30B: rolling tail per crash signature detection in onExit
      session.recentTail = ((session.recentTail || '') + data).slice(-RECENT_TAIL_BYTES)
      // Persist to log file (stripped)
      if (session.logStream && !session.logStream.destroyed) {
        try { session.logStream.write(stripAnsi(data)) } catch { /* ignore */ }
      }
      // Fan-out to connected clients
      for (const l of session.listeners) {
        try { l(data) } catch { /* ignore */ }
      }
    })

    proc.onExit(({ exitCode, signal }) => {
      logger.info(`[pty] ${projectId} exit code=${exitCode} signal=${signal}`)
      if (session.logStream && !session.logStream.destroyed) {
        try {
          session.logStream.write(`\n[${new Date().toISOString()}] === SESSION END code=${exitCode} ===\n`)
          session.logStream.end()
        } catch { /* ignore */ }
      }

      // V15.0 WS30B: auto-quarantine .jsonl corrotta su crash signature.
      // Trigger SOLO se: exit non clean + spawn era con --continue + il tail dell'output
      // contiene una firma di crash conosciuta (es. "FKH is not a function" emesso dal
      // Bun bundle di Claude CLI). Rinomina la jsonl piu' recente con suffix
      // .quarantine-TIMESTAMP cosi' il prossimo --continue salta automaticamente alla
      // sessione precedente sana (hasClaudeHistory filtra solo .endsWith('.jsonl')).
      if (exitCode !== 0 && session.spawnedWithResume && session.cwd) {
        const tail = session.recentTail || ''
        const crashed = CRASH_PATTERNS.some((p) => p.test(tail))
        if (crashed) {
          try {
            const slug = claudeSlugFromCwd(session.cwd)
            const projDir = path.join(os.homedir(), '.claude', 'projects', slug)
            if (fs.existsSync(projDir)) {
              const jsonls = fs.readdirSync(projDir).filter((e) => e.endsWith('.jsonl'))
              let mostRecent: { full: string; mtime: number } | null = null
              for (const name of jsonls) {
                try {
                  const full = path.join(projDir, name)
                  const st = fs.statSync(full)
                  if (!mostRecent || st.mtimeMs > mostRecent.mtime) mostRecent = { full, mtime: st.mtimeMs }
                } catch { /* skip unreadable */ }
              }
              if (mostRecent) {
                const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
                const quarantined = `${mostRecent.full}.quarantine-${ts}`
                fs.renameSync(mostRecent.full, quarantined)
                logger.warn(`[pty] ${projectId}: CRASH SIGNATURE detected (exit=${exitCode}) → quarantined ${path.basename(mostRecent.full)} → ${path.basename(quarantined)}`)
              }
            }
          } catch (err: any) {
            logger.error(`[pty] ${projectId}: quarantine failed: ${err.message || err}`)
          }
        }
      }

      // V13.1 T8: auto-respawn post-update if exit was immediate AND not already respawned
      const sessionAge = Date.now() - session.startedAt
      const updateAge = session.updateRunAt ? Date.now() - session.updateRunAt : Infinity
      const isCleanExit = exitCode === 0 || exitCode === -1
      const shouldRespawn =
        !session.respawned &&
        isCleanExit &&
        (updateAge < 60_000 || sessionAge < 30_000) &&
        session.lastSpawnOpts

      for (const h of session.exitHandlers) {
        try { h(exitCode, signal) } catch { /* ignore */ }
      }
      this.sessions.delete(projectId)

      if (shouldRespawn) {
        logger.info(`[pty] ${projectId}: auto-respawn triggered (sessionAge=${sessionAge}ms, updateAge=${updateAge}ms)`)
        // Respawn asynchronously (give PTY a moment to release)
        setTimeout(() => {
          const newOpts: SpawnOptions = { ...(session.lastSpawnOpts || {}) }
          this.getOrCreate(projectId, newOpts).then((result) => {
            if ('error' in result) {
              logger.error(`[pty] ${projectId}: auto-respawn failed: ${result.error}`)
            } else {
              result.respawned = true
              logger.info(`[pty] ${projectId}: auto-respawned successfully (pid=${result.proc.pid})`)
            }
          }).catch((err) => {
            logger.error(`[pty] ${projectId}: auto-respawn crash:`, err)
          })
        }, 1500)
      }
    })

    this.sessions.set(projectId, session)
    logger.info(`[pty] spawned session ${projectId} pid=${proc.pid}`)

    // V13.3-T8: track account location (fire-and-forget)
    if (account) {
      if (opts.remote) {
        import('./vps-state-store').then(({ vpsStateStore }) => {
          vpsStateStore.trackAccountUsage(opts.remote!.vpsId, account!.id).catch((err) => {
            logger.warn(`[pty] trackAccountUsage failed: ${err?.message || err}`)
          })
        }).catch(() => { /* ignore dynamic import err */ })
      } else {
        import('./accounts-store').then(({ accountsStore }) => {
          accountsStore.touchLocalUse(account!.id).catch(() => { /* already logs */ })
        }).catch(() => { /* ignore */ })
      }
    }

    return session
  }

  write(projectId: string, data: string): boolean {
    const s = this.sessions.get(projectId)
    if (!s) return false
    s.proc.write(data)
    s.lastActivity = Date.now()
    return true
  }

  resize(projectId: string, cols: number, rows: number): boolean {
    const s = this.sessions.get(projectId)
    if (!s) return false
    try {
      s.proc.resize(Math.max(10, cols), Math.max(5, rows))
      return true
    } catch {
      return false
    }
  }

  kill(projectId: string): boolean {
    const s = this.sessions.get(projectId)
    if (!s) return false
    try {
      s.proc.kill()
    } catch (err) {
      logger.warn('pty kill err:', err)
    }
    if (s.logStream && !s.logStream.destroyed) {
      try { s.logStream.end() } catch { /* ignore */ }
    }
    this.sessions.delete(projectId)
    return true
  }

  list(): Array<{ projectId: string; pid: number; startedAt: number; lastActivity: number; bufferSize: number; listeners: number }> {
    return Array.from(this.sessions.values()).map((s) => ({
      projectId: s.projectId,
      pid: s.proc.pid,
      startedAt: s.startedAt,
      lastActivity: s.lastActivity,
      bufferSize: s.bufferSize,
      listeners: s.listeners.size,
    }))
  }

  get(projectId: string): Session | undefined {
    return this.sessions.get(projectId)
  }

  // Idle cleanup runs every 5 min
  startIdleSweeper() {
    setInterval(() => {
      const now = Date.now()
      for (const [id, s] of this.sessions) {
        if (now - s.lastActivity > IDLE_TIMEOUT_MS) {
          logger.info(`[pty] idle timeout ${id} — killing`)
          this.kill(id)
        }
      }
    }, 5 * 60_000).unref()
  }
}

export const ptyManager = new PtyManager()
ptyManager.startIdleSweeper()
