/**
 * Account Health Check (V13-T3.1)
 *
 * Per ogni Account verifica se è usabile per spawnare una sessione:
 *  - mode='plan'/'cli'  → CLI binary in PATH + (per plan) login ready
 *  - mode='api'         → env var presente (env OS o ~/.claude/settings.json)
 *  - mode='playwright'  → saved browser session presente (data/playwright-sessions/<accountId>/)
 *
 * Cache in-memory 60s per account. Clearable via `clearHealthCache()`.
 */
import fsSync from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { providerRegistry } from './provider-registry'
import type { Account } from '../../shared/schemas'
import { logger } from './logger'
import { probeAuthOnVps } from './ssh-auth-probe'

const execFileAsync = promisify(execFile)

const CACHE_TTL_MS = 60_000

export type HealthStatus = 'ready' | 'not-configured' | 'not-installed' | 'error' | 'unknown' | 'unconfigured'

export interface HealthResult {
  accountId: string
  health: HealthStatus
  checkedAt: string
  cliInstalled?: boolean
  cliVersion?: string
  envVarSet?: boolean
  playwrightSessionReady?: boolean
  message?: string
  /** V14: target su cui è stato eseguito il probe ('local' o vpsId). undefined = non probato perché unconfigured. */
  target?: string
}

interface CacheEntry {
  result: HealthResult
  ts: number
}

const cache = new Map<string, CacheEntry>()

export function clearHealthCache(accountId?: string) {
  if (accountId) cache.delete(accountId)
  else cache.clear()
}

async function cliExists(cmd: string): Promise<{ installed: boolean; version?: string }> {
  if (!/^[a-zA-Z0-9_.-]+$/.test(cmd)) return { installed: false }
  try {
    const args = [cmd]
    if (os.platform() === 'win32') {
      await execFileAsync('where', args, { timeout: 3000, shell: false as any })
    } else {
      await execFileAsync('sh', ['-c', `command -v ${cmd}`], { timeout: 3000 })
    }
    // Try get version (best-effort)
    let version: string | undefined
    try {
      const { stdout } = await execFileAsync(cmd, ['--version'], { timeout: 4000, shell: false as any })
      version = stdout.split('\n')[0]?.trim().slice(0, 100)
    } catch {
      /* version unavailable, still installed */
    }
    return { installed: true, version }
  } catch {
    return { installed: false }
  }
}

async function envVarPresent(varName: string): Promise<boolean> {
  if (typeof process.env[varName] === 'string' && process.env[varName]!.trim().length > 8) {
    return true
  }
  // Fallback: ~/.claude/settings.json env
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

function playwrightSessionExists(accountId: string, dataDir: string): boolean {
  const dir = path.join(dataDir, 'playwright-sessions', accountId.replace(/[^a-zA-Z0-9_-]/g, ''))
  if (!fsSync.existsSync(dir)) return false
  try {
    const files = fsSync.readdirSync(dir)
    // storageState.json or cookies.json indicates a saved session
    return files.some((f) => /^(storageState|cookies|state)\.(json|txt)$/.test(f))
  } catch {
    return false
  }
}

// Ref to dataDir from server/index.ts
let DATA_DIR = ''
export function setHealthDataDir(dir: string) {
  DATA_DIR = dir
}

export async function checkAccount(account: Account): Promise<HealthResult> {
  const now = Date.now()
  const cached = cache.get(account.id)
  if (cached && now - cached.ts < CACHE_TTL_MS) return cached.result

  const provider = providerRegistry.get(account.providerId)
  const result: HealthResult = {
    accountId: account.id,
    health: 'unknown',
    checkedAt: new Date().toISOString(),
    target: account.target,
  }

  if (!provider) {
    result.health = 'error'
    result.message = `provider ${account.providerId} not found in registry`
    cache.set(account.id, { result, ts: now })
    return result
  }

  // V14 — target gating: account senza target = unconfigured (l'utente deve scegliere)
  if (!account.target) {
    result.health = 'unconfigured'
    result.message = 'Scegli un target (Local o VPS) prima di poter usare questo account'
    cache.set(account.id, { result, ts: now })
    return result
  }

  // V14 — target remoto: probe via SSH invece dei file locali
  if (account.target !== 'local') {
    // Resolve cliName per ogni mode (api ha cliWrapper, gli altri cliName)
    let cliName: string | undefined = account.cliName
    if (!cliName) {
      const md = provider.modeDefaults
      if (account.mode === 'api') cliName = md.api?.cliWrapper || md.cli?.cliName
      else if (account.mode === 'plan') cliName = md.plan?.cliName
      else if (account.mode === 'cli') cliName = md.cli?.cliName
    }
    if (!cliName) {
      result.health = 'not-configured'
      result.message = `Nessun CLI configurato per il mode ${account.mode}`
      cache.set(account.id, { result, ts: now })
      return result
    }
    const probe = await probeAuthOnVps(account.target, cliName)
    result.cliInstalled = probe.cliInstalled
    result.cliVersion = probe.cliVersion
    if (!probe.online) {
      result.health = 'error'
      result.message = `VPS ${account.target} non raggiungibile: ${probe.error || 'errore SSH'}`
    } else if (!probe.cliInstalled) {
      result.health = 'not-installed'
      result.message = `${cliName} non installato su ${account.target}`
    } else if (account.mode === 'plan' && !probe.authOk) {
      result.health = 'not-configured'
      result.message = `${cliName} su ${account.target} non loggato — esegui login dal popup`
    } else if (account.mode === 'cli' && !probe.authOk) {
      // Per CLI mode con file di credenziali noto, segnala non-configured. Per CLI senza file noto, ready.
      const cliKnown = ['claude', 'codex', 'gemini', 'aichat', 'fal'].includes(cliName)
      if (cliKnown) {
        result.health = 'not-configured'
        result.message = `${cliName} su ${account.target} non loggato`
      } else {
        result.health = 'ready'
      }
    } else {
      // api mode su VPS: per ora consideriamo ready se cli installato (env var lato VPS non verificabile facilmente)
      result.health = 'ready'
    }
    cache.set(account.id, { result, ts: now })
    return result
  }

  try {
    switch (account.mode) {
      case 'plan': {
        const cliName = account.cliName || provider.modeDefaults.plan?.cliName
        if (!cliName) {
          result.health = 'not-configured'
          result.message = 'no CLI configured for plan mode'
          break
        }
        const cli = await cliExists(cliName)
        result.cliInstalled = cli.installed
        result.cliVersion = cli.version
        if (!cli.installed) {
          result.health = 'not-installed'
          result.message = `${cliName} CLI non installata`
          break
        }
        // Check login for plan
        const claudeLoggedIn = cliName === 'claude' && (
          fsSync.existsSync(path.join(os.homedir(), '.claude', 'config.json')) ||
          fsSync.existsSync(path.join(os.homedir(), '.claude', '.credentials.json'))
        )
        const geminiLoggedIn = cliName === 'gemini' && (
          fsSync.existsSync(path.join(os.homedir(), '.config', 'gemini')) ||
          fsSync.existsSync(path.join(os.homedir(), '.gemini'))
        )
        if (claudeLoggedIn || geminiLoggedIn || !['claude', 'gemini'].includes(cliName)) {
          result.health = 'ready'
        } else {
          result.health = 'not-configured'
          result.message = `${cliName}: login non rilevato — esegui ${provider.modeDefaults.plan?.loginCmd || cliName + ' login'}`
        }
        break
      }

      case 'api': {
        const envVarRef = account.envVarRef || provider.modeDefaults.api?.envVars?.[0]
        if (!envVarRef) {
          result.health = 'not-configured'
          result.message = 'no env var reference'
          break
        }
        const present = await envVarPresent(envVarRef)
        result.envVarSet = present

        // Also check CLI wrapper if declared (e.g. claude CLI for Claude API with env key)
        const wrapper = account.cliName || provider.modeDefaults.api?.cliWrapper || provider.modeDefaults.cli?.cliName
        if (wrapper) {
          const cli = await cliExists(wrapper)
          result.cliInstalled = cli.installed
          result.cliVersion = cli.version
          if (!cli.installed) {
            result.health = 'not-installed'
            result.message = `${wrapper} CLI non installata (richiesta per API mode)`
            break
          }
        }

        if (!present) {
          result.health = 'not-configured'
          result.message = `env var ${envVarRef} non valorizzata`
        } else {
          result.health = 'ready'
        }
        break
      }

      case 'cli': {
        const cliName = account.cliName || provider.modeDefaults.cli?.cliName
        if (!cliName) {
          result.health = 'not-configured'
          result.message = 'no CLI configured'
          break
        }
        const cli = await cliExists(cliName)
        result.cliInstalled = cli.installed
        result.cliVersion = cli.version
        if (!cli.installed) {
          result.health = 'not-installed'
          result.message = `${cliName} non installata`
        } else {
          // Optional env var check if provider needs it
          const needsEnv = provider.modeDefaults.api?.envVars?.[0]
          if (needsEnv) {
            const present = await envVarPresent(needsEnv)
            result.envVarSet = present
            if (!present) {
              result.health = 'not-configured'
              result.message = `${cliName} ok ma manca env var ${needsEnv}`
              break
            }
          }
          result.health = 'ready'
        }
        break
      }

      case 'playwright': {
        const sessionReady = DATA_DIR ? playwrightSessionExists(account.id, DATA_DIR) : false
        result.playwrightSessionReady = sessionReady
        if (!sessionReady) {
          result.health = 'not-configured'
          result.message = 'Nessuna sessione browser salvata — completa il login manuale al primo spawn'
        } else {
          result.health = 'ready'
        }
        break
      }

      default:
        result.health = 'error'
        result.message = `unknown mode: ${account.mode}`
    }
  } catch (err: any) {
    logger.error(`[account-health] ${account.id}:`, err)
    result.health = 'error'
    result.message = err.message?.slice(0, 200)
  }

  cache.set(account.id, { result, ts: now })
  return result
}

export async function checkAllAccounts(accounts: Account[]): Promise<HealthResult[]> {
  return Promise.all(accounts.map((a) => checkAccount(a)))
}
