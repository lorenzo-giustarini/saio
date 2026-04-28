/**
 * Autodetect Service (V13-T6.5 + usato anche da T2.2 per seed iniziale)
 *
 * Scansiona il sistema locale per individuare:
 *  - CLI AI installate in PATH (claude, codex, gemini, aichat, fal, ...)
 *  - Variabili d'ambiente di provider (ANTHROPIC_API_KEY, OPENAI_API_KEY, ...)
 *  - Config di login salvate (~/.claude/config, ~/.config/gemini/*, ...)
 *
 * Produce una lista di proposed accounts (provider, mode, config minima).
 * L'utente può applicare tutte, alcune, o nessuna.
 */
import fsSync from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { providerRegistry, type ProviderDefinition, type ProviderMode } from './provider-registry'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

export interface AutodetectProposal {
  providerId: string
  providerLabel: string
  mode: ProviderMode
  suggestedId: string
  suggestedLabel: string
  reason: string
  // Config fields to pre-populate
  cliName?: string
  envVarRef?: string
  defaultModel?: string
}

async function commandExists(cmd: string): Promise<boolean> {
  if (!/^[a-zA-Z0-9_.-]+$/.test(cmd)) return false
  try {
    // Windows: `where <cmd>`, Unix: `command -v <cmd>`
    if (os.platform() === 'win32') {
      await execFileAsync('where', [cmd], { timeout: 3000, shell: false as any })
    } else {
      await execFileAsync('sh', ['-c', `command -v ${cmd}`], { timeout: 3000 })
    }
    return true
  } catch {
    return false
  }
}

/**
 * Check if a CLI is "logged in / ready" based on known config patterns.
 * Returns true if we believe the user has completed Plan-mode auth.
 */
async function planAuthReady(cliName: string): Promise<boolean> {
  const home = os.homedir()
  switch (cliName) {
    case 'claude': {
      // Claude Code stores session in ~/.claude/
      const cfg1 = path.join(home, '.claude', 'config.json')
      const cfg2 = path.join(home, '.claude', '.credentials.json')
      if (fsSync.existsSync(cfg1)) return true
      if (fsSync.existsSync(cfg2)) return true
      // Fallback: check if any project with jsonl history exists (meaning claude has run loggato)
      const projDir = path.join(home, '.claude', 'projects')
      if (fsSync.existsSync(projDir)) {
        try {
          const entries = fsSync.readdirSync(projDir)
          for (const e of entries) {
            const sub = path.join(projDir, e)
            if (fsSync.statSync(sub).isDirectory()) {
              const inner = fsSync.readdirSync(sub)
              if (inner.some((f) => f.endsWith('.jsonl'))) return true
            }
          }
        } catch {
          /* ignore */
        }
      }
      return false
    }
    case 'gemini': {
      const cfg = path.join(home, '.config', 'gemini')
      if (fsSync.existsSync(cfg)) return true
      const alt = path.join(home, '.gemini')
      return fsSync.existsSync(alt)
    }
    default:
      return false
  }
}

function envValuePresent(varName: string): boolean {
  const val = process.env[varName]
  return typeof val === 'string' && val.trim().length > 8
}

/**
 * Also look at ~/.claude/settings.json `env` key for stashed API keys.
 */
async function settingsJsonEnv(varName: string): Promise<boolean> {
  try {
    const p = path.join(os.homedir(), '.claude', 'settings.json')
    const raw = await fsp.readFile(p, 'utf8')
    const data = JSON.parse(raw)
    const v = data?.env?.[varName]
    return typeof v === 'string' && v.trim().length > 8
  } catch {
    return false
  }
}

async function anyKeySource(varName: string): Promise<boolean> {
  return envValuePresent(varName) || (await settingsJsonEnv(varName))
}

/**
 * Main detection — scans system and returns list of proposed accounts.
 */
export async function detectAccounts(): Promise<AutodetectProposal[]> {
  const proposals: AutodetectProposal[] = []
  const providers: ProviderDefinition[] = providerRegistry.list()

  for (const p of providers) {
    // ============== MODE: plan ===================
    if (p.supportedModes.includes('plan') && p.modeDefaults.plan?.cliName) {
      const cli = p.modeDefaults.plan.cliName
      if ((await commandExists(cli)) && (await planAuthReady(cli))) {
        proposals.push({
          providerId: p.id,
          providerLabel: p.label,
          mode: 'plan',
          suggestedId: `${p.id}-plan`,
          suggestedLabel: `${p.label.replace(/\s*\(.*\)$/, '')} Plan`,
          reason: `${cli} CLI in PATH + login config rilevato`,
          cliName: cli,
          defaultModel: p.availableModels?.[0],
        })
      }
    }

    // ============== MODE: api ====================
    if (p.supportedModes.includes('api') && p.modeDefaults.api?.envVars) {
      for (const envVar of p.modeDefaults.api.envVars) {
        if (await anyKeySource(envVar)) {
          proposals.push({
            providerId: p.id,
            providerLabel: p.label,
            mode: 'api',
            suggestedId: `${p.id}-api`,
            suggestedLabel: `${p.label.replace(/\s*\(.*\)$/, '')} API`,
            reason: `env var ${envVar} presente`,
            envVarRef: envVar,
            cliName: p.modeDefaults.api.cliWrapper || p.modeDefaults.cli?.cliName,
            defaultModel: p.availableModels?.[0],
          })
          break // one api account per provider is enough
        }
      }
    }

    // ============== MODE: cli ====================
    // Only propose if CLI is in PATH but plan auth is NOT ready (otherwise plan wins)
    if (p.supportedModes.includes('cli') && p.modeDefaults.cli?.cliName) {
      const cli = p.modeDefaults.cli.cliName
      const hasPlanAlready = proposals.some(
        (x) => x.providerId === p.id && x.mode === 'plan'
      )
      if (!hasPlanAlready && (await commandExists(cli))) {
        // Still need env var for providers that don't support true plan (e.g. codex, aichat)
        const needsEnv = p.modeDefaults.api?.envVars?.[0]
        const hasApiAlready = proposals.some(
          (x) => x.providerId === p.id && x.mode === 'api'
        )
        // If we already proposed 'api', skip this CLI proposal to avoid duplicate
        if (!hasApiAlready) {
          proposals.push({
            providerId: p.id,
            providerLabel: p.label,
            mode: 'cli',
            suggestedId: `${p.id}-cli`,
            suggestedLabel: `${p.label.replace(/\s*\(.*\)$/, '')} CLI`,
            reason: `${cli} CLI in PATH${needsEnv ? ` (richiede ${needsEnv})` : ''}`,
            cliName: cli,
            envVarRef: needsEnv,
            defaultModel: p.availableModels?.[0],
          })
        }
      }
    }

    // ============== MODE: playwright =============
    // Do NOT auto-propose playwright — user must opt-in explicitly
    // (browser automation is fragile + requires manual login)
  }

  logger.info(`[autodetect] ${proposals.length} proposals detected`)
  return proposals
}

/**
 * Quick diff: given existing accounts, return only NEW proposals (not yet covered).
 */
export function filterNewProposals(
  all: AutodetectProposal[],
  existingAccounts: Array<{ providerId: string; mode: ProviderMode }>
): AutodetectProposal[] {
  return all.filter((p) => {
    return !existingAccounts.some(
      (acc) => acc.providerId === p.providerId && acc.mode === p.mode
    )
  })
}
