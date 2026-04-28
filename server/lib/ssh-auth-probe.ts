/**
 * SSH Auth Probe (V14)
 *
 * Verifica via SSH se un determinato CLI è installato e LOGGATO sul VPS target.
 * Usato da account-health.ts quando `account.target` è un vpsId (non 'local').
 *
 * Pattern coerente con `ssh-probe.ts` (riuso execFileAsync, BatchMode, timeout, cache TTL).
 *
 * Limitazioni:
 * - Verifica esistenza file di credentials, NON la validità del token (il login potrebbe essere scaduto)
 * - Mapping cliName→authPath è statico; CLI custom usano fallback "installed = ok"
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'
import { VPS_HOSTS } from './ssh-inventory'

const execFileAsync = promisify(execFile)

const SSH_KEY_DIR = path.join(os.homedir(), '.ssh')
const SSH_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 30_000

/**
 * Comandi che testano l'esistenza dei file di auth per ogni CLI noto.
 * Output esatto: `<CLI>_INSTALLED=0|1` e `<CLI>_AUTH=0|1` per parsing strutturato.
 */
const AUTH_PATHS_BY_CLI: Record<string, string[]> = {
  // Claude CLI: credenziali in ~/.claude/.credentials.json (o config.json)
  claude: ['$HOME/.claude/.credentials.json', '$HOME/.claude/config.json'],
  // OpenAI Codex CLI: ~/.codex/auth.json
  codex: ['$HOME/.codex/auth.json', '$HOME/.codex/credentials.json'],
  // Google Gemini CLI: token oauth in ~/.config/gemini-cli/oauth.json
  gemini: ['$HOME/.config/gemini-cli/oauth.json', '$HOME/.gemini/credentials.json'],
  // aichat: config con api keys in ~/.config/aichat/config.yaml
  aichat: ['$HOME/.config/aichat/config.yaml'],
  // fal CLI: ~/.fal/credentials
  fal: ['$HOME/.fal/credentials'],
}

export interface AuthProbeResult {
  vpsId: string
  cliName: string
  online: boolean
  cliInstalled: boolean
  cliVersion?: string
  authOk: boolean
  fetchedAt: string
  cached?: boolean
  error?: string
}

const cache = new Map<string, { result: AuthProbeResult; ts: number }>()

function buildProbeScript(cliName: string): string {
  const safeCli = cliName.replace(/[^a-zA-Z0-9._-]/g, '')
  if (!safeCli) return 'echo INSTALLED=0; echo AUTH=0; echo VERSION=' // safe no-op
  const authPaths = AUTH_PATHS_BY_CLI[safeCli] || []
  const authChecks = authPaths.length > 0
    ? authPaths.map((p) => `[ -f ${p} ]`).join(' || ')
    : 'false' // CLI sconosciuti: assume non loggato per default
  return [
    `if command -v ${safeCli} >/dev/null 2>&1; then echo INSTALLED=1; else echo INSTALLED=0; fi`,
    `if ${authChecks}; then echo AUTH=1; else echo AUTH=0; fi`,
    `echo VERSION=$(${safeCli} --version 2>/dev/null | head -1 || echo "")`,
  ].join('; ')
}

function parseProbeOutput(stdout: string): { installed: boolean; auth: boolean; version?: string } {
  const lines = stdout.split('\n').map((l) => l.trim())
  const installed = lines.some((l) => l === 'INSTALLED=1')
  const auth = lines.some((l) => l === 'AUTH=1')
  const verLine = lines.find((l) => l.startsWith('VERSION=')) || ''
  const version = verLine.replace(/^VERSION=/, '').trim() || undefined
  return { installed, auth, version }
}

function getKeyPath(keyName?: string): string {
  if (!keyName) return path.join(SSH_KEY_DIR, 'claude_vps')
  // Sanitize per evitare path traversal
  const safe = keyName.replace(/[^a-zA-Z0-9._-]/g, '')
  return path.join(SSH_KEY_DIR, safe || 'claude_vps')
}

export async function probeAuthOnVps(
  vpsId: string,
  cliName: string,
  options: { force?: boolean } = {}
): Promise<AuthProbeResult> {
  const now = new Date().toISOString()
  const cacheKey = `${vpsId}|${cliName}`

  if (!options.force) {
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      return { ...cached.result, cached: true }
    }
  }

  // Resolve VPS host details
  const host = VPS_HOSTS.find((v) => v.id === vpsId)
  if (!host) {
    const result: AuthProbeResult = {
      vpsId,
      cliName,
      online: false,
      cliInstalled: false,
      authOk: false,
      fetchedAt: now,
      error: `vpsId not found in ssh-inventory: ${vpsId}`,
    }
    return result
  }

  // Validate IP format strictly
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(host.ip)) {
    return {
      vpsId,
      cliName,
      online: false,
      cliInstalled: false,
      authOk: false,
      fetchedAt: now,
      error: `invalid IP format: ${host.ip}`,
    }
  }

  const keyPath = getKeyPath(host.keyName)
  const script = buildProbeScript(cliName)

  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-i', keyPath,
        '-o', 'ConnectTimeout=5',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        '-o', 'ServerAliveInterval=3',
        `root@${host.ip}`,
        script,
      ],
      { timeout: SSH_TIMEOUT_MS, maxBuffer: 256 * 1024 }
    )

    const parsed = parseProbeOutput(stdout)
    const result: AuthProbeResult = {
      vpsId,
      cliName,
      online: true,
      cliInstalled: parsed.installed,
      cliVersion: parsed.version,
      authOk: parsed.installed && parsed.auth,
      fetchedAt: now,
    }
    cache.set(cacheKey, { result, ts: Date.now() })
    return result
  } catch (err: any) {
    logger.warn(`[ssh-auth-probe] ${vpsId} cli=${cliName} failed: ${err.message || err}`)
    const result: AuthProbeResult = {
      vpsId,
      cliName,
      online: false,
      cliInstalled: false,
      authOk: false,
      fetchedAt: now,
      error: err.code === 'ETIMEDOUT' ? 'timeout' : (err.message || 'ssh probe failed').slice(0, 200),
    }
    // Short-lived offline cache (15s) per non hammering host down
    cache.set(cacheKey, { result, ts: Date.now() - (CACHE_TTL_MS - 15_000) })
    return result
  }
}

/** Bust cache per un dato vpsId+cliName (post-login per esempio). */
export function invalidateAuthProbeCache(vpsId: string, cliName: string): void {
  cache.delete(`${vpsId}|${cliName}`)
}
