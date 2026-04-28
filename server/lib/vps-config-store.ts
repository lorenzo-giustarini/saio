/**
 * VPS Config Store — user-editable custom labels + notes per VPS (V13.3-T8).
 *
 * Purpose: allow user to rename VPS in UI ("Cliente Herbalife Prod" invece di "rm3-prod")
 * senza toccare l'hardcoded VPS_HOSTS whitelist.
 *
 * Storage: `data/vps-config.json`, atomic write (temp+rename).
 * Validation: userLabel max 100 chars, alphanumeric + spazi + `-_.,:`.
 */
import fsSync from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'

const LABEL_RE = /^[\p{L}\p{N}\s\-_.,:()'"&]+$/u
const MAX_LABEL = 100
const MAX_NOTES = 500

export interface VpsUserConfig {
  userLabel?: string
  notes?: string
  updatedAt?: string
}

export interface VpsConfigFile {
  version: number
  vps: Record<string, VpsUserConfig>
  updatedAt?: string
}

function emptyFile(): VpsConfigFile {
  return { version: 1, vps: {} }
}

function validateLabel(label: string): void {
  if (label.length > MAX_LABEL) throw new Error(`userLabel troppo lungo (max ${MAX_LABEL} char)`)
  if (!LABEL_RE.test(label)) throw new Error('userLabel contiene caratteri non consentiti')
}

function validateNotes(notes: string): void {
  if (notes.length > MAX_NOTES) throw new Error(`notes troppo lungo (max ${MAX_NOTES} char)`)
}

class VpsConfigStore {
  private dataDir = ''
  private file = ''
  private cache: VpsConfigFile | null = null
  private cacheTs = 0
  private readonly TTL_MS = 5_000

  setDataDir(dir: string) {
    this.dataDir = dir
    this.file = path.join(dir, 'vps-config.json')
    try {
      fsSync.mkdirSync(dir, { recursive: true })
    } catch {
      /* ignore */
    }
  }

  private invalidate() {
    this.cache = null
    this.cacheTs = 0
  }

  async load(): Promise<VpsConfigFile> {
    const now = Date.now()
    if (this.cache && now - this.cacheTs < this.TTL_MS) return this.cache
    try {
      const raw = await fsp.readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw) as VpsConfigFile
      if (!parsed || typeof parsed !== 'object' || !parsed.vps) {
        logger.warn('[vps-config] malformed file, returning empty')
        return emptyFile()
      }
      this.cache = parsed
      this.cacheTs = now
      return parsed
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        logger.warn(`[vps-config] load failed: ${err.message}`)
      }
      return emptyFile()
    }
  }

  private async save(data: VpsConfigFile): Promise<void> {
    data.updatedAt = new Date().toISOString()
    const tmp = `${this.file}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await fsp.rename(tmp, this.file)
    this.invalidate()
  }

  async get(vpsId: string): Promise<VpsUserConfig | null> {
    const file = await this.load()
    return file.vps[vpsId] || null
  }

  async getAll(): Promise<Record<string, VpsUserConfig>> {
    const file = await this.load()
    return file.vps
  }

  async setLabel(vpsId: string, userLabel: string | null): Promise<VpsUserConfig> {
    const file = await this.load()
    const entry: VpsUserConfig = file.vps[vpsId] || {}
    if (userLabel === null || userLabel === '') {
      delete entry.userLabel
    } else {
      validateLabel(userLabel)
      entry.userLabel = userLabel.trim()
    }
    entry.updatedAt = new Date().toISOString()
    file.vps[vpsId] = entry
    await this.save(file)
    logger.info(`[vps-config] set userLabel ${vpsId} -> ${userLabel}`)
    return entry
  }

  async setNotes(vpsId: string, notes: string | null): Promise<VpsUserConfig> {
    const file = await this.load()
    const entry: VpsUserConfig = file.vps[vpsId] || {}
    if (notes === null || notes === '') {
      delete entry.notes
    } else {
      validateNotes(notes)
      entry.notes = notes
    }
    entry.updatedAt = new Date().toISOString()
    file.vps[vpsId] = entry
    await this.save(file)
    return entry
  }
}

export const vpsConfigStore = new VpsConfigStore()
