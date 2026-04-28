/**
 * Task-Types Store (V13-T6.1)
 * Tabella routing macro-task → provider+modello.
 * Seed iniziale basato su macro-task comuni + opzionale scan di skill registries.
 * Persistenza: data/task-types.json (atomic write).
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'
import type { TaskType, TaskTypesFile } from '../../shared/schemas'

const SEED_TASK_TYPES: TaskType[] = [
  {
    id: 'coding',
    label: 'Coding / Refactor',
    category: 'dev',
    description: 'Modifiche multi-file, architettura, feature implementation',
    suggestedProviders: ['anthropic', 'openai', 'deepseek'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'planning',
    label: 'Plan mode / Strategia',
    category: 'strategy',
    description: 'Pianificazione estesa, decision trees, architectural planning',
    suggestedProviders: ['anthropic'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'code-review',
    label: 'Code review / Audit',
    category: 'dev',
    description: 'Review PR, security audit, refactoring proposals',
    suggestedProviders: ['anthropic', 'openai'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'long-context-analysis',
    label: 'Long-context analysis (>200k tokens)',
    category: 'data',
    description: 'Data analysis, summarization of massive datasets',
    suggestedProviders: ['moonshot', 'anthropic'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'legal-writing',
    label: 'Legal content (T&C, Privacy, Policies)',
    category: 'content',
    description: 'Pagine legali, contratti, compliance documents',
    suggestedProviders: ['anthropic'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'image-gen-persona',
    label: 'Image generation — persona/portrait',
    category: 'creative',
    description: 'Portrait photorealistic, avatar, ritratti',
    suggestedProviders: ['fal', 'google'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'image-gen-product',
    label: 'Image generation — product shot',
    category: 'creative',
    description: 'E-commerce photo, lifestyle, ambient product',
    suggestedProviders: ['fal'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'image-gen-typography',
    label: 'Image generation — typography/logo',
    category: 'creative',
    description: 'Logo design, poster con testo, brand graphics',
    suggestedProviders: ['ideogram', 'recraft', 'fal'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'video-gen',
    label: 'Video generation',
    category: 'creative',
    description: 'Text-to-video, image-to-video, motion transfer',
    suggestedProviders: ['runway', 'kling', 'fal'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'voice-over',
    label: 'Voice-over / TTS',
    category: 'creative',
    description: 'Narrazione, doppiaggio, character voices',
    suggestedProviders: ['elevenlabs'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'music-gen',
    label: 'Music / jingle generation',
    category: 'creative',
    description: 'Background music, theme songs',
    suggestedProviders: ['suno'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'avatar-video',
    label: 'Avatar talking head',
    category: 'creative',
    description: 'Virtual presenter, spokesperson',
    suggestedProviders: ['heygen', 'kling'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'research-web',
    label: 'Web research / deep research',
    category: 'research',
    description: 'Multi-source research con citation',
    suggestedProviders: ['anthropic', 'xai'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'copywriting',
    label: 'Copywriting / marketing',
    category: 'content',
    description: 'Landing pages, email sequences, ads copy',
    suggestedProviders: ['anthropic', 'openai'],
    source: 'seed',
    pendingAssignment: true,
  },
  {
    id: 'translation',
    label: 'Translation / localization',
    category: 'content',
    description: 'Multilingual content adaptation',
    suggestedProviders: ['anthropic', 'google', 'deepseek'],
    source: 'seed',
    pendingAssignment: true,
  },
]

class TaskTypesStore {
  private dataDir = ''
  private storeFile = ''
  private cache: TaskTypesFile | null = null
  private cacheTs = 0
  private readonly CACHE_TTL_MS = 5_000

  setDataDir(dir: string) {
    this.dataDir = dir
    this.storeFile = path.join(dir, 'task-types.json')
  }

  async migrate(): Promise<void> {
    if (!this.storeFile) throw new Error('task-types-store: dataDir not set')
    if (fs.existsSync(this.storeFile)) return

    logger.info(`[task-types-store] first boot → seeding ${SEED_TASK_TYPES.length} task types`)
    const payload: TaskTypesFile = {
      version: 1,
      taskTypes: SEED_TASK_TYPES,
      updatedAt: new Date().toISOString(),
    }
    await fsp.mkdir(this.dataDir, { recursive: true })
    await this.atomicWrite(payload)
  }

  private async atomicWrite(payload: TaskTypesFile): Promise<void> {
    const tempFile = `${this.storeFile}.tmp`
    payload.updatedAt = new Date().toISOString()
    await fsp.writeFile(tempFile, JSON.stringify(payload, null, 2), 'utf8')
    await fsp.rename(tempFile, this.storeFile)
    this.invalidateCache()
  }

  invalidateCache() {
    this.cache = null
    this.cacheTs = 0
  }

  async load(): Promise<TaskTypesFile> {
    const now = Date.now()
    if (this.cache && now - this.cacheTs < this.CACHE_TTL_MS) return this.cache

    try {
      const raw = await fsp.readFile(this.storeFile, 'utf8')
      const parsed = JSON.parse(raw) as TaskTypesFile
      if (!parsed || !Array.isArray(parsed.taskTypes)) {
        return { version: 1, taskTypes: SEED_TASK_TYPES }
      }
      this.cache = parsed
      this.cacheTs = now
      return parsed
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        await this.migrate()
        return this.load()
      }
      logger.error('[task-types-store] load failed:', err)
      return { version: 1, taskTypes: SEED_TASK_TYPES }
    }
  }

  async list(): Promise<TaskType[]> {
    return (await this.load()).taskTypes
  }

  async findById(id: string): Promise<TaskType | null> {
    return (await this.list()).find((t) => t.id === id) || null
  }

  async add(tt: TaskType): Promise<TaskType> {
    const file = await this.load()
    if (file.taskTypes.some((t) => t.id === tt.id)) throw new Error(`duplicate id: ${tt.id}`)
    file.taskTypes.push(tt)
    await this.atomicWrite(file)
    return tt
  }

  async update(id: string, patch: Partial<TaskType>): Promise<TaskType> {
    const file = await this.load()
    const idx = file.taskTypes.findIndex((t) => t.id === id)
    if (idx === -1) throw new Error(`task type not found: ${id}`)
    const updated = { ...file.taskTypes[idx], ...patch, id }
    file.taskTypes[idx] = updated
    await this.atomicWrite(file)
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.load()
    const before = file.taskTypes.length
    file.taskTypes = file.taskTypes.filter((t) => t.id !== id)
    if (file.taskTypes.length === before) return false
    await this.atomicWrite(file)
    return true
  }

  /**
   * Scan ~/.claude/plugins/ for SKILL.md metadata files and extract declared
   * task-types or skill names. Returns new task types found (not in current store).
   */
  async scanSkillRegistry(): Promise<TaskType[]> {
    const home = os.homedir()
    const skillsRoot = path.join(home, '.claude', 'plugins', 'cache')
    if (!fs.existsSync(skillsRoot)) {
      logger.info('[task-types-store] skills registry not found, skipping scan')
      return []
    }

    const found: TaskType[] = []
    const existing = await this.list()
    const existingIds = new Set(existing.map((t) => t.id))

    try {
      const walkSkills = (dir: string, depth = 0) => {
        if (depth > 5) return
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const e of entries) {
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            walkSkills(full, depth + 1)
          } else if (e.name === 'SKILL.md') {
            try {
              const content = fs.readFileSync(full, 'utf8').slice(0, 2000)
              // Extract skill name from frontmatter `name:` or first H1
              const nameMatch = content.match(/^name:\s*([a-z0-9_-]+)/im) ||
                content.match(/^#\s+(.+)$/m)
              if (!nameMatch) continue
              const skillName = nameMatch[1].trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 64)
              if (!skillName || existingIds.has(skillName)) continue
              found.push({
                id: skillName,
                label: skillName.replace(/[-_]/g, ' '),
                category: 'other',
                source: 'skill-scan',
                pendingAssignment: true,
                notes: `auto-scan da ${path.relative(skillsRoot, full)}`,
              })
              existingIds.add(skillName)
            } catch {
              /* skip malformed */
            }
          }
        }
      }
      walkSkills(skillsRoot)
    } catch (err) {
      logger.error('[task-types-store] skill scan failed:', err)
    }

    return found
  }

  /** Bulk-add new types found by skill scan */
  async applyScanResults(newTypes: TaskType[]): Promise<TaskType[]> {
    if (newTypes.length === 0) return []
    const file = await this.load()
    const existing = new Set(file.taskTypes.map((t) => t.id))
    const added: TaskType[] = []
    for (const t of newTypes) {
      if (existing.has(t.id)) continue
      file.taskTypes.push(t)
      added.push(t)
    }
    if (added.length > 0) await this.atomicWrite(file)
    return added
  }
}

export const taskTypesStore = new TaskTypesStore()
