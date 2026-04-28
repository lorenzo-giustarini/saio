/**
 * Projects Store — single source of truth for project entries.
 *
 * Persistence: `data/projects.json` (atomic write via temp + rename).
 * Migration: at first boot (if file missing) → seed da SEED_PROJECTS hardcoded + backup timestamped.
 *
 * V11 schema (see shared/schemas.ts ProjectSchema):
 * - archived: boolean (default false)
 * - archivedAt: datetime string when archived
 * - folder: Unix-path string ("Clients/Herbalife/UK") or undefined for root
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'
import type { Project } from '../../shared/schemas'

/** Extended project with orchestrator-specific fields (not in shared schema but used internally) */
export interface ProjectEntry extends Project {
  // All fields come from ProjectSchema. Kept as alias for clarity in this module.
}

/**
 * Fallback seed — used only if `data/projects.json` is missing (first boot or fresh clone).
 * After first mutation the file is source of truth.
 *
 * Demo entries kept generic for OSS portability — replace via UI or by editing data/projects.json.
 */
export const SEED_PROJECTS: ProjectEntry[] = [
  {
    id: 'saio-dashboard',
    name: 'SAIO Dashboard',
    status: 'green',
    category: 'internal-tools',
    nextAction: 'Esplora la dashboard e configura il tuo primo progetto',
    tags: ['saio', 'dashboard', 'typescript'],
    hostUrl: 'http://127.0.0.1:3030',
    kickoffTemplate:
      'Sto lavorando sulla SAIO Dashboard. Analizza il codice e proponi miglioramenti.',
    folder: 'Internal/Tools',
    archived: false,
  },
  {
    id: 'demo-client-project',
    name: 'Demo Client Project',
    status: 'yellow',
    category: 'client',
    nextAction: 'Esempio entry — sostituisci con il tuo vero progetto cliente',
    tags: ['demo', 'placeholder'],
    folder: 'Clients/Demo',
    archived: false,
  },
  {
    id: 'demo-infrastructure',
    name: 'Demo Infrastructure',
    status: 'green',
    category: 'infrastructure',
    nextAction: 'Collega il tuo VPS in data/ssh-inventory.json',
    tags: ['infrastructure', 'vps', 'demo'],
    folder: 'Infrastructure',
    archived: false,
  },
]

class ProjectsStore {
  private dataDir = ''
  private storeFile = ''
  private cache: ProjectEntry[] | null = null
  private cacheTs = 0
  private readonly CACHE_TTL_MS = 5_000 // lightweight cache to avoid repeated reads; 5s

  setDataDir(dir: string) {
    this.dataDir = dir
    this.storeFile = path.join(dir, 'projects.json')
  }

  /** First-boot migration: write seed + backup marker if projects.json missing */
  async migrate(): Promise<void> {
    if (!this.storeFile) throw new Error('projects-store: dataDir not set')
    if (fs.existsSync(this.storeFile)) return

    logger.info(`[projects-store] first boot → seeding ${this.storeFile} with ${SEED_PROJECTS.length} items`)
    const payload = {
      version: 1,
      migratedAt: new Date().toISOString(),
      projects: SEED_PROJECTS,
    }
    await fsp.mkdir(this.dataDir, { recursive: true })
    await this.atomicWrite(payload)

    // Post-seed backup snapshot so users can roll back to the fresh-seed state
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    try {
      await fsp.copyFile(this.storeFile, path.join(this.dataDir, `projects.json.backup-${ts}`))
    } catch (err) {
      logger.warn('[projects-store] post-seed backup failed:', err)
    }
  }

  /** Atomic write: temp file + rename (no partial state on crash).
   *  V15.3 WS33: validate temp + rolling backup retain 5. */
  private async atomicWrite(payload: { version: number; migratedAt?: string; projects: ProjectEntry[] }): Promise<void> {
    const tempFile = `${this.storeFile}.tmp`
    const json = JSON.stringify(payload, null, 2)
    await fsp.writeFile(tempFile, json, 'utf8')

    // Validate temp before rename (prevent NULL-byte corruption)
    try {
      const verify = await fsp.readFile(tempFile, 'utf8')
      if (!verify || verify.length < json.length / 2) {
        throw new Error(`temp file size ${verify?.length ?? 0} < expected ${json.length}`)
      }
      JSON.parse(verify)
    } catch (err: any) {
      await fsp.unlink(tempFile).catch(() => {})
      throw new Error(`projects-store atomic write validation failed: ${err.message}`)
    }

    // Rolling backup pre-overwrite (retain ultimi 5)
    if (fs.existsSync(this.storeFile)) {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const backupFile = `${this.storeFile}.backup-${ts}`
        await fsp.copyFile(this.storeFile, backupFile)
        const dir = path.dirname(this.storeFile)
        const base = path.basename(this.storeFile)
        const entries = await fsp.readdir(dir)
        const backups = entries
          .filter((e) => e.startsWith(`${base}.backup-`))
          .sort()
          .reverse()
        for (let i = 5; i < backups.length; i++) {
          await fsp.unlink(path.join(dir, backups[i])).catch(() => {})
        }
      } catch (err: any) {
        logger.warn(`[projects-store] backup pre-overwrite failed (non-fatal): ${err?.message}`)
      }
    }

    await fsp.rename(tempFile, this.storeFile)
    this.invalidateCache()
  }

  invalidateCache() {
    this.cache = null
    this.cacheTs = 0
  }

  /** Load all projects. Uses 5s in-memory cache. Fallback to seed if file missing/corrupt. */
  async load(): Promise<ProjectEntry[]> {
    const now = Date.now()
    if (this.cache && now - this.cacheTs < this.CACHE_TTL_MS) return this.cache

    try {
      const raw = await fsp.readFile(this.storeFile, 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || !Array.isArray(parsed.projects)) {
        logger.warn('[projects-store] malformed projects.json → using seed fallback')
        return SEED_PROJECTS
      }
      this.cache = parsed.projects as ProjectEntry[]
      this.cacheTs = now
      return this.cache
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // First boot or deleted — migrate then retry
        await this.migrate()
        return this.load()
      }
      logger.error('[projects-store] load failed:', err)
      return SEED_PROJECTS
    }
  }

  /** Find single project by id. Returns null if not found (includes archived). */
  async findById(id: string): Promise<ProjectEntry | null> {
    const all = await this.load()
    return all.find((p) => p.id === id) || null
  }

  /** Update one project by id (partial). Returns updated entry or throws. */
  async update(id: string, patch: Partial<ProjectEntry>): Promise<ProjectEntry> {
    const all = await this.load()
    const idx = all.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error(`project not found: ${id}`)

    const updated = { ...all[idx], ...patch, id } as ProjectEntry
    const next = [...all]
    next[idx] = updated
    await this.atomicWrite({ version: 1, projects: next })
    return updated
  }

  /** Add a new project (duplicate id → throws) */
  async add(entry: ProjectEntry): Promise<ProjectEntry> {
    const all = await this.load()
    if (all.some((p) => p.id === entry.id)) throw new Error(`duplicate id: ${entry.id}`)
    const next: ProjectEntry[] = [...all, { ...entry, archived: entry.archived ?? false }]
    await this.atomicWrite({ version: 1, projects: next })
    return entry
  }

  /** Archive: sets archived=true + archivedAt. Lock check (session active) is route's responsibility. */
  async archive(id: string): Promise<ProjectEntry> {
    return this.update(id, { archived: true, archivedAt: new Date().toISOString() })
  }

  /** Restore: sets archived=false + unsets archivedAt */
  async restore(id: string): Promise<ProjectEntry> {
    const all = await this.load()
    const idx = all.findIndex((p) => p.id === id)
    if (idx === -1) throw new Error(`project not found: ${id}`)
    const { archivedAt: _ignored, ...rest } = all[idx]
    void _ignored
    const updated = { ...rest, archived: false } as ProjectEntry
    const next = [...all]
    next[idx] = updated
    await this.atomicWrite({ version: 1, projects: next })
    return updated
  }

  /** Move to folder (empty string or undefined = root) */
  async moveToFolder(id: string, folder: string | undefined): Promise<ProjectEntry> {
    return this.update(id, { folder: folder || undefined })
  }

  /**
   * V14.6 — Hard remove: cancella completamente il progetto dal store.
   * Ritorna true se rimosso, false se non trovato.
   * NOTA: per cancellazione "soft" preferire `archive()`.
   */
  async remove(id: string): Promise<boolean> {
    const all = await this.load()
    const next = all.filter((p) => p.id !== id)
    if (next.length === all.length) return false
    await this.atomicWrite({ version: 1, projects: next })
    return true
  }
}

export const projectsStore = new ProjectsStore()
