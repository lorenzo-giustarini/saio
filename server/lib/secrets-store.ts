/**
 * Secrets Store (V13.1-T2.1)
 *
 * Gestione sicura di API keys in ~/.claude/settings.json `env` section.
 * File user-owned. Atomic write. Backup prima di modifica. MAI loggare valori.
 *
 * Formato settings.json:
 * {
 *   "env": {
 *     "ANTHROPIC_API_KEY": "sk-ant-...",
 *     "OPENAI_API_KEY": "sk-..."
 *   },
 *   ... altri campi claude code ...
 * }
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'

const SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

// Regex valida nome env var: SCREAMING_SNAKE_CASE
const VAR_NAME_REGEX = /^[A-Z][A-Z0-9_]{0,99}$/

function maskValue(v: string | undefined): string {
  if (!v) return '(empty)'
  if (v.length < 12) return '***'
  return `${v.slice(0, 4)}***${v.slice(-2)}`
}

export class SecretsStore {
  /**
   * Check if an env var is set (in process.env or in settings.json).
   * Does NOT reveal the value.
   */
  async has(varName: string): Promise<boolean> {
    if (!VAR_NAME_REGEX.test(varName)) return false
    // Check process.env first
    if (typeof process.env[varName] === 'string' && process.env[varName]!.trim().length >= 8) {
      return true
    }
    // Check settings.json env
    try {
      const raw = await fsp.readFile(SETTINGS_PATH, 'utf8')
      const data = JSON.parse(raw)
      const v = data?.env?.[varName]
      return typeof v === 'string' && v.trim().length >= 8
    } catch {
      return false
    }
  }

  /**
   * Read value (ONLY for internal backend use — es. spawn env injection).
   * Never expose via API endpoint.
   */
  async get(varName: string): Promise<string | null> {
    if (!VAR_NAME_REGEX.test(varName)) return null
    const fromEnv = process.env[varName]
    if (typeof fromEnv === 'string' && fromEnv.trim().length >= 8) return fromEnv
    try {
      const raw = await fsp.readFile(SETTINGS_PATH, 'utf8')
      const data = JSON.parse(raw)
      const v = data?.env?.[varName]
      if (typeof v === 'string' && v.trim().length >= 8) return v
    } catch {
      /* missing */
    }
    return null
  }

  /**
   * Set a secret in settings.json (atomic write + backup).
   * Value is never logged.
   */
  async set(varName: string, value: string): Promise<void> {
    if (!VAR_NAME_REGEX.test(varName)) {
      throw new Error(`invalid env var name: ${varName}`)
    }
    if (typeof value !== 'string' || value.trim().length < 1) {
      throw new Error('empty value')
    }
    if (value.length > 10000) {
      throw new Error('value too long (>10k chars)')
    }

    // Read current
    let data: any = {}
    try {
      const raw = await fsp.readFile(SETTINGS_PATH, 'utf8')
      data = JSON.parse(raw)
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn('[secrets] settings.json read failed:', err.message)
      }
      // Start fresh
      data = {}
    }

    // Backup prima di scrivere (solo se file esiste già)
    if (fs.existsSync(SETTINGS_PATH)) {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        await fsp.copyFile(SETTINGS_PATH, `${SETTINGS_PATH}.backup-${ts}`)
      } catch (err) {
        logger.warn('[secrets] backup failed:', err)
      }
    }

    // Merge env section
    if (!data.env || typeof data.env !== 'object') data.env = {}
    data.env[varName] = value.trim()

    // Atomic write
    await fsp.mkdir(path.dirname(SETTINGS_PATH), { recursive: true })
    const tmpFile = `${SETTINGS_PATH}.tmp`
    await fsp.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8')
    await fsp.rename(tmpFile, SETTINGS_PATH)

    // chmod 0600 if Unix-like (user-only read/write)
    if (os.platform() !== 'win32') {
      try {
        await fsp.chmod(SETTINGS_PATH, 0o600)
      } catch {
        /* best effort */
      }
    }

    // Log senza rivelare valore
    logger.info(`[secrets] set ${varName} = ${maskValue(value)}`)

    // Aggiorna anche process.env per spawn correnti (senza restart)
    process.env[varName] = value.trim()
  }

  /**
   * Remove a secret from settings.json (keep backup).
   */
  async unset(varName: string): Promise<boolean> {
    if (!VAR_NAME_REGEX.test(varName)) return false
    try {
      const raw = await fsp.readFile(SETTINGS_PATH, 'utf8')
      const data = JSON.parse(raw)
      if (!data.env || typeof data.env !== 'object') return false
      if (!(varName in data.env)) return false

      // Backup
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      await fsp.copyFile(SETTINGS_PATH, `${SETTINGS_PATH}.backup-${ts}`)

      delete data.env[varName]
      const tmpFile = `${SETTINGS_PATH}.tmp`
      await fsp.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8')
      await fsp.rename(tmpFile, SETTINGS_PATH)

      logger.info(`[secrets] unset ${varName}`)
      delete process.env[varName]
      return true
    } catch {
      return false
    }
  }
}

export const secretsStore = new SecretsStore()
