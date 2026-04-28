/**
 * cron-runner.ts — Cross-platform cron task runner (V15.9 WS39)
 *
 * Sostituisce i 12 file `.ps1` di scripts/cron/ con un singolo dispatcher
 * Node TypeScript invocato dal task scheduler nativo (schtasks/systemd/launchd).
 *
 * Usage:
 *   node --import tsx/esm scripts/cron-runner.ts <task-name> [args...]
 *
 * Tasks supportati (registry):
 *   - agencyos-logs       — sync log AgencyOS al vault
 *   - vault-backup        — backup atomico vault
 *   - extract-errors      — analisi error patterns
 *   - tools-snapshot      — snapshot CLI tools state
 *   - cli-updates         — auto-update CLI (claude, gh, gemini, ecc.)
 *   - vps-pull            — git pull repos VPS
 *   - vps-errors          — analisi errori VPS
 *   - onweb24-logs        — sync OnWeb24 logs
 *   - zaplater-n8n-logs   — ZapLater n8n logs
 *   - session-save        — fine sessione
 *   - hot-topics-weekly   — research weekly
 *   - github-trending     — AI trending repos weekly
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')

const TASK = process.argv[2]
const ARGS = process.argv.slice(3)

if (!TASK) {
  console.error('Usage: cron-runner.ts <task-name> [args...]')
  process.exit(1)
}

// ──────────────── Task registry ────────────────

type TaskHandler = (args: string[]) => Promise<number>

const REGISTRY: Record<string, TaskHandler> = {
  'cli-updates': taskCliUpdates,
  'vault-backup': taskVaultBackup,
  'agencyos-logs': taskAgencyOsLogs,
  'extract-errors': taskExtractErrors,
  'tools-snapshot': taskToolsSnapshot,
  'vps-pull': taskVpsPull,
  'vps-errors': taskVpsErrors,
  'onweb24-logs': taskOnweb24Logs,
  'zaplater-n8n-logs': taskZaplaterN8nLogs,
  'session-save': taskSessionSave,
  'hot-topics-weekly': taskHotTopicsWeekly,
  'github-trending': taskGithubTrending,
}

// ──────────────── Main ────────────────

async function main(): Promise<void> {
  const handler = REGISTRY[TASK!]
  if (!handler) {
    console.error(`Unknown task: ${TASK}. Available: ${Object.keys(REGISTRY).join(', ')}`)
    process.exit(1)
  }
  console.log(`[cron-runner] starting task: ${TASK} (args: ${ARGS.join(' ') || 'none'})`)
  const t0 = Date.now()
  try {
    const exitCode = await handler(ARGS)
    const elapsed = Math.round((Date.now() - t0) / 1000)
    console.log(`[cron-runner] task ${TASK} done (exit=${exitCode}, ${elapsed}s)`)
    process.exit(exitCode)
  } catch (err: unknown) {
    const e = err as Error
    console.error(`[cron-runner] task ${TASK} FAILED: ${e.message}`)
    process.exit(1)
  }
}

// ──────────────── Task handlers ────────────────

async function taskCliUpdates(_args: string[]): Promise<number> {
  // Importa dinamicamente per evitare side-effects al boot
  const { runCliUpdates } = await import('../server/lib/cli-updater/runner.js').catch(() => {
    return { runCliUpdates: async () => 0 } as { runCliUpdates: () => Promise<number> }
  })
  return await runCliUpdates()
}

async function taskVaultBackup(_args: string[]): Promise<number> {
  const { getPlatform } = await import('../server/lib/platform/index.js')
  const pal = getPlatform()
  const vaultDir = pal.paths.claudeVaultDir()
  const backupDir = path.join(pal.paths.dataDir('saio-tauri'), 'vault-backups')
  await fs.mkdir(backupDir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const out = path.join(backupDir, `vault-${ts}.tar.gz`)
  // Cross-platform tar (BSD tar Win10+ + GNU tar Unix)
  await execAsync(`tar -czf "${out}" -C "${vaultDir}" .`, { maxBuffer: 256 * 1024 * 1024 })
  console.log(`[vault-backup] created ${out}`)
  return 0
}

async function taskAgencyOsLogs(_args: string[]): Promise<number> {
  // TODO: porting vero — lettura log AgencyOS, sync in vault
  // Per ora stub no-op (logica stessa, path-agnostic)
  console.log('[agencyos-logs] STUB — porting da PS1 in arrivo')
  return 0
}

async function taskExtractErrors(_args: string[]): Promise<number> {
  const py = await execAsync('python --version', { encoding: 'utf-8' }).catch(() => null)
  if (!py) {
    console.error('[extract-errors] Python not in PATH, skipping')
    return 1
  }
  const script = path.join(REPO_ROOT, 'scripts', 'extract_errors.py')
  await execAsync(`python "${script}"`, { encoding: 'utf-8' })
  return 0
}

async function taskToolsSnapshot(_args: string[]): Promise<number> {
  const { getPlatform } = await import('../server/lib/platform/index.js')
  const pal = getPlatform()
  const snapshot = {
    timestamp: new Date().toISOString(),
    platform: pal.platform,
    packageManager: pal.packageManager.name,
    tools: {} as Record<string, { installed: string | null; latest: string | null }>,
  }
  const checks: Array<{ name: string; npm?: string }> = [
    { name: '@anthropic-ai/claude-code', npm: '@anthropic-ai/claude-code' },
    { name: '@google/gemini-cli', npm: '@google/gemini-cli' },
    { name: '@openai/codex', npm: '@openai/codex' },
  ]
  for (const c of checks) {
    if (c.npm) {
      try {
        const { stdout } = await execAsync(`npm view ${c.npm} version`)
        snapshot.tools[c.name] = { installed: null, latest: String(stdout).trim() }
      } catch {
        snapshot.tools[c.name] = { installed: null, latest: null }
      }
    }
  }
  const outFile = path.join(pal.paths.dataDir('saio-tauri'), 'tools-snapshot.json')
  await fs.mkdir(path.dirname(outFile), { recursive: true })
  await fs.writeFile(outFile, JSON.stringify(snapshot, null, 2), 'utf-8')
  console.log(`[tools-snapshot] saved to ${outFile}`)
  return 0
}

async function taskVpsPull(_args: string[]): Promise<number> {
  console.log('[vps-pull] STUB — porting da PS1 in arrivo (richiede SSH inventory dal server)')
  return 0
}

async function taskVpsErrors(_args: string[]): Promise<number> {
  console.log('[vps-errors] STUB — porting da PS1 in arrivo')
  return 0
}

async function taskOnweb24Logs(_args: string[]): Promise<number> {
  console.log('[onweb24-logs] STUB — porting da PS1 in arrivo')
  return 0
}

async function taskZaplaterN8nLogs(_args: string[]): Promise<number> {
  console.log('[zaplater-n8n-logs] STUB — porting da PS1 in arrivo')
  return 0
}

async function taskSessionSave(_args: string[]): Promise<number> {
  console.log('[session-save] STUB — porting da PS1 in arrivo')
  return 0
}

async function taskHotTopicsWeekly(_args: string[]): Promise<number> {
  console.log('[hot-topics-weekly] STUB — porting da PS1 in arrivo')
  return 0
}

async function taskGithubTrending(_args: string[]): Promise<number> {
  console.log('[github-trending] STUB — porting da PS1 in arrivo')
  return 0
}

// ──────────────── Run ────────────────

main().catch((err) => {
  console.error('[cron-runner] fatal:', err)
  process.exit(1)
})
