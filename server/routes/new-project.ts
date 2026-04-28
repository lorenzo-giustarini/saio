import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../lib/atomic-write'
import { sanitizeFilename } from '../lib/sanitize'
import { projectsStore } from '../lib/projects-store'
import { logger } from '../lib/logger'

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/markdown',
])
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB
const MAX_FILES = 10

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `proj-${Date.now()}`
}

export function newProjectRouter(dataDir: string) {
  const router = Router()
  // V14.6: persistence ora via projectsStore (data/projects.json) — single source of truth.
  // Legacy `data/projects/user-projects.json` non più scritto qui (ma vecchi file
  // vengono ancora importati da projects.ts:importLegacyUserProjects al boot).

  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        const tmp = path.join(dataDir, 'tmp-uploads')
        try {
          await fs.mkdir(tmp, { recursive: true })
          cb(null, tmp)
        } catch (err) {
          cb(err as Error, tmp)
        }
      },
      filename: (_req, file, cb) => {
        const safe = sanitizeFilename(file.originalname)
        cb(null, `${Date.now()}-${safe}`)
      },
    }),
    limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error(`MIME not allowed: ${file.mimetype}`))
      }
      cb(null, true)
    },
  })

  router.get('/', async (_req, res) => {
    try {
      const all = await projectsStore.load()
      res.json({ projects: all })
    } catch {
      res.json({ projects: [] })
    }
  })

  router.post('/', upload.array('attachments', MAX_FILES), async (req, res) => {
    try {
      const body = req.body as {
        name?: string
        category?: string
        brief?: string
        tags?: string
        spawnTarget?: string
      }
      if (!body.name || body.name.length < 2 || body.name.length > 100) {
        return res.status(400).json({ error: 'name 2-100 chars required' })
      }
      if (!body.brief || body.brief.length < 10 || body.brief.length > 5000) {
        return res.status(400).json({ error: 'brief 10-5000 chars required' })
      }
      const id = slugify(body.name)
      const projectDir = path.join(dataDir, `new-project-${id}`)
      const attachDir = path.join(projectDir, 'attachments')
      await fs.mkdir(attachDir, { recursive: true })

      const files = (req.files as Express.Multer.File[]) || []
      const attachments: Array<{ name: string; size: number; mime: string; path: string }> = []
      for (const f of files) {
        const dest = path.join(attachDir, f.filename)
        await fs.rename(f.path, dest)
        attachments.push({ name: f.originalname, size: f.size, mime: f.mimetype, path: dest })
      }

      const categoryClean = (body.category || 'internal').replace(/[^a-z0-9-_]/gi, '').slice(0, 40) || 'internal'
      const tagsClean = (body.tags || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8)
      // V14: spawnTarget — sanitize (alnum + dash/underscore, max 64) o undefined per ereditare
      const spawnTargetClean = body.spawnTarget && /^[a-zA-Z0-9_-]{1,64}$/.test(body.spawnTarget)
        ? body.spawnTarget
        : undefined
      // V14.5: render kickoff brief TS-native (no più dipendenza da Python spawner)
      const kickoffsDir = path.join(dataDir, 'kickoffs')
      await fs.mkdir(kickoffsDir, { recursive: true })
      const kickoffTimestamp = Math.floor(Date.now() / 1000)
      const kickoffFilename = `kickoff-${id}-${kickoffTimestamp}.md`
      const kickoffAbsPath = path.join(kickoffsDir, kickoffFilename)
      const attachmentsBlock = attachments.length
        ? attachments.map((a) => `- \`${a.name}\` (${a.mime}, ${Math.round(a.size / 1024)}KB) → \`${a.path.replace(/\\/g, '/')}\``).join('\n')
        : '_Nessun allegato_'
      const kickoffBody = [
        `# Kickoff — ${body.name}`,
        '',
        `**Project ID**: \`${id}\``,
        `**Categoria**: ${categoryClean}`,
        `**Creato**: ${new Date().toISOString()}`,
        tagsClean.length ? `**Tags**: ${tagsClean.map((t) => `#${t}`).join(' ')}` : '',
        '',
        '## 🎯 Obiettivo sessione',
        '',
        `Sei una sessione AI dedicata al progetto **${body.name}**. Leggi questo brief, analizza eventuali allegati, poi proponi un piano di esecuzione e attendi conferma utente.`,
        '',
        '## 📝 Brief utente',
        '',
        body.brief,
        '',
        `## 📎 Attachments (${attachments.length})`,
        '',
        attachmentsBlock,
        '',
      ].filter((l) => l !== undefined).join('\n')
      await atomicWriteFile(kickoffAbsPath, kickoffBody)

      // V14.17: invio SOLO il brief raw, senza preambolo né wrapper.
      // L'utente ha già scritto il brief in modo intenzionale, non lo riformuliamo.
      const attachInfoLine = attachments.length
        ? `\n\nAllegati (${attachments.length}): ${path.join(projectDir, 'attachments').replace(/\\/g, '/')}`
        : ''
      const kickoffText = `${body.brief}${attachInfoLine}`

      const project = {
        id,
        name: body.name,
        status: 'green' as const,
        category: categoryClean,
        nextAction: 'Appena creato — attende prima sessione AI (brief in carica)',
        mocPath: `data/new-project-${id}/brief.md`,
        tags: tagsClean,
        createdAt: new Date().toISOString(),
        attachments,
        spawnTarget: spawnTargetClean,
        // V14.14: testo da iniettare come user message via sendText (singolo bulk write,
        // pattern che funziona — stesso della ChatInputBar).
        pendingKickoffText: kickoffText,
        // V14.5 LEGACY: path al file kickoff (mantenuto per backward compat ma non più usato dall'auto-inject)
        pendingKickoffPath: kickoffAbsPath.replace(/\\/g, '/'),
        kickoffTemplate: `Nuovo progetto "${body.name}" — categoria: ${categoryClean}. Brief utente:\n\n${body.brief}\n\nAttachments (${attachments.length}):\n${attachments.map((a) => `- ${a.name} (${a.mime}, ${Math.round(a.size / 1024)}KB) → ${a.path}`).join('\n')}`,
      }

      // Write brief.md for reference
      const briefMd = `# ${body.name}\n\n**Categoria**: ${categoryClean}\n**Creato**: ${new Date().toLocaleString('it-IT')}\n${tagsClean.length ? `**Tags**: ${tagsClean.map((t) => `#${t}`).join(' ')}\n` : ''}\n## Brief\n\n${body.brief}\n\n## Attachments\n\n${attachments.length ? attachments.map((a) => `- [${a.name}](${a.path.replace(/\\/g, '/')}) · ${a.mime} · ${Math.round(a.size / 1024)}KB`).join('\n') : '_Nessun allegato_'}\n`
      await atomicWriteFile(path.join(projectDir, 'brief.md'), briefMd)

      // V14.6: persist via projectsStore (single source of truth, data/projects.json)
      try {
        await projectsStore.add(project as any)
      } catch (err: any) {
        if (String(err?.message || '').includes('duplicate id')) {
          await projectsStore.update(project.id, project as any)
        } else {
          throw err
        }
      }

      // V14.5: NO spawn cmd.exe esterno. Il PTY embedded auto-spawnerà alla
      // navigazione del progetto in /projects/<id>, e l'EmbeddedChat invierà
      // /read <pendingKickoffPath> alla prima sessione ready.

      res.json({
        ok: true,
        id,
        name: body.name,
        attachments,
        projectDir,
        pendingKickoffPath: project.pendingKickoffPath,
        pendingKickoffText: project.pendingKickoffText,
      })
    } catch (err: any) {
      logger.error('New project failed:', err)
      res.status(500).json({ error: err.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-z0-9-_]/gi, '')
    if (!id) return res.status(400).json({ error: 'invalid id' })
    try {
      const ok = await projectsStore.remove(id)
      res.json({ ok, removed: ok ? id : null })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  return router
}
