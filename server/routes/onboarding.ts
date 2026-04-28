/**
 * V15.0 WS12 — Onboarding endpoints (auth required).
 *
 * GET  /api/onboarding/status                         → state corrente
 * POST /api/onboarding/choices  {obsidian?, cloudflare?, anthropicApi?}  → patch
 * POST /api/onboarding/complete                       → marca firstLoginCompletedAt = now
 * POST /api/onboarding/set-vault-path  {path}         → patch VAULT_PATH in .env.local
 * POST /api/onboarding/set-anthropic-key  {apiKey}    → patch ANTHROPIC_API_KEY in .env.local
 */
import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  markCompleted,
  patchChoices,
  readOnboardingState,
} from '../lib/auth/onboarding-store'
import { setProcessEnv, updateEnvLocal } from '../lib/auth/env-writer'
import { audit } from '../lib/auth/audit'
import { getClientIp, hashUserAgent } from '../lib/auth/ip-trust'
import { ANTIDESTRUCTIVE_GUARDRAILS, backupDirectory } from '../lib/safety-guardrails'
import { logger } from '../lib/logger'

const ChoicesSchema = z.object({
  obsidian: z.enum(['have-it', 'install-later', 'skip']).optional(),
  cloudflare: z.enum(['now', 'later', 'skip']).optional(),
  anthropicApi: z.enum(['configured', 'will-configure', 'skip']).optional(),
})

const VaultPathSchema = z.object({
  path: z.string().min(1).max(2048),
})

const AnthropicKeySchema = z.object({
  apiKey: z.string().min(8).max(256),
})

const ObsidianAutoconfigSchema = z.object({
  actions: z.object({
    moc: z.boolean(),
    taxonomy: z.boolean(),
    plugins: z.boolean(),
    index: z.boolean(),
    folderStructure: z.boolean(),
  }),
})

export function onboardingRouter(dataDir: string): Router {
  const router = Router()

  router.get('/status', async (_req, res) => {
    const state = await readOnboardingState(dataDir)
    res.json(state)
  })

  router.post('/choices', async (req: Request, res: Response): Promise<void> => {
    const parsed = ChoicesSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' })
      return
    }
    const state = await patchChoices(dataDir, parsed.data)
    res.json(state)
  })

  router.post('/complete', async (req: Request, res: Response): Promise<void> => {
    const state = await markCompleted(dataDir)
    await audit({
      type: 'session.created', // riusiamo evento audit esistente
      email: req.user?.email || 'unknown',
      ip: getClientIp(req),
      userAgentHash: hashUserAgent(req),
      meta: { onboardingCompleted: true, choices: state.choices },
    })
    res.json(state)
  })

  router.post('/set-vault-path', async (req: Request, res: Response): Promise<void> => {
    const parsed = VaultPathSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' })
      return
    }
    const vaultPath = parsed.data.path.trim()
    // Verifica esistenza prima di salvare
    try {
      const stat = await fs.stat(vaultPath)
      if (!stat.isDirectory()) {
        res.status(400).json({ error: 'not_a_directory', message: 'Il path indicato non è una directory.' })
        return
      }
    } catch {
      res.status(400).json({ error: 'path_not_found', message: 'Path non esistente sul filesystem.' })
      return
    }
    try {
      await updateEnvLocal({ VAULT_PATH: vaultPath })
      setProcessEnv({ VAULT_PATH: vaultPath })
      await patchChoices(dataDir, { obsidian: 'have-it' })
      res.json({ ok: true, vaultPath })
    } catch (err) {
      res.status(500).json({ error: 'env_write_failed', message: (err as Error).message })
    }
  })

  // V15.0 WS17 — Avvia autoconfig Obsidian generando brief per orchestrator
  router.post('/start-obsidian-autoconfig', async (req: Request, res: Response): Promise<void> => {
    const parsed = ObsidianAutoconfigSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' })
      return
    }
    const vaultPath = (process.env.VAULT_PATH || '').trim()
    if (!vaultPath) {
      res.status(409).json({ error: 'no_vault', message: 'VAULT_PATH non configurato. Setta path vault prima.' })
      return
    }
    // Leggi data/projects.json per integrare progetti rilevati nel brief
    const projectsFile = path.join(dataDir, 'projects.json')
    let projects: Array<{ name: string; path: string; kind: string }> = []
    try {
      const txt = await fs.readFile(projectsFile, 'utf-8')
      const p = JSON.parse(txt)
      projects = p.projects || []
    } catch {
      /* no projects */
    }
    const githubConfigured = !!process.env.GITHUB_TOKEN

    // V15.0 WS18 — Backup vault PRIMA di generare brief autoconfig.
    // Se backup fallisce, il brief NON viene creato (fail-safe).
    let backupInfo: { backupPath: string; sizeBytes: number; entries: number } | null = null
    try {
      backupInfo = await backupDirectory({
        sourcePath: vaultPath,
        dataDir,
        label: 'obsidian-pre-autoconfig',
      })
      logger.info(`[onboarding] Vault backup creato: ${backupInfo.backupPath} (${backupInfo.entries} files, ${Math.round(backupInfo.sizeBytes / 1024)}KB)`)
    } catch (err) {
      logger.error('[onboarding] backup vault fallito, abort autoconfig:', err)
      res.status(500).json({
        error: 'backup_failed',
        message: `Backup vault fallito: ${(err as Error).message}. Autoconfig NON avviato per sicurezza dei tuoi dati.`,
      })
      return
    }

    // Genera brief auto
    const briefId = `brief-obsidian-autoconfig-${Date.now()}`
    const actions = parsed.data.actions
    const actionsList = [
      actions.moc && '- **MOC (Map of Content)**: crea un file MOC.md per ogni progetto rilevato con link a sotto-note.',
      actions.taxonomy && '- **Tag taxonomy hierarchical**: introduci #cliente/X, #dominio/Y, #stato/active per filtri Dataview.',
      actions.plugins && '- **Plugins community**: configura plugin raccomandati Dataview, Calendar, Templater, Tag Wrangler, Excalidraw nel file `.obsidian/community-plugins.json`.',
      actions.index && '- **_INDEX.md root**: crea homepage del vault con lista progetti + dashboard live (Dataview).',
      actions.folderStructure && '- **Folder structure**: riordina cartelle vault per dominio/cliente, mantieni i .md esistenti (no perdita dati).',
    ]
      .filter(Boolean)
      .join('\n')

    const brief = {
      id: briefId,
      type: 'adhoc' as const,
      createdAt: new Date().toISOString(),
      title: 'Autoconfig Obsidian (onboarding)',
      summary: 'Sessione orchestrator-generata per ottimizzare il vault Obsidian con i progetti rilevati durante l\'onboarding.',
      decisions: [
        {
          id: 'obsidian-autoconfig',
          projectTarget: 'obsidian',
          priority: 'normal' as const,
          title: 'Ottimizza vault Obsidian',
          causa: `L'utente ha completato l'onboarding e vuole organizzare automaticamente il proprio vault Obsidian (path: ${vaultPath}) integrando ${projects.length} progetti rilevati ${githubConfigured ? '+ repo GitHub' : '(scan disco only)'}.`,
          effetto: {
            si: `Il vault sarà arricchito con: ${actionsList.replace(/\*\*/g, '').replace(/\n/g, ' / ')}.`,
            no: 'Vault resta com\'è. L\'utente può configurare manualmente.',
          },
          rischi: [
            { desc: 'La sessione potrebbe richiedere ore se molti progetti', probabilita: 0.4, severita: 'medium' as const },
            { desc: 'Possibile consumo token / minuti del piano AI', probabilita: 0.6, severita: 'low' as const },
          ],
          soluzioneProposta: `Spawno una sessione Claude (orchestrator) che analizza ${projects.length} progetti + GitHub (se configurato) e applica le ottimizzazioni selezionate.

## Azioni richieste
${actionsList}

## Progetti rilevati
${projects
  .slice(0, 30)
  .map((p) => `- ${p.kind}: ${p.name} (${p.path})`)
  .join('\n')}${projects.length > 30 ? `\n... e altri ${projects.length - 30}` : ''}

## Vault target
${vaultPath}

## ✅ Backup pre-autoconfig (già creato da SAIO)
${backupInfo ? `- ZIP: \`${backupInfo.backupPath}\`\n- Files: ${backupInfo.entries}\n- Size: ${Math.round(backupInfo.sizeBytes / 1024)}KB\n- Per rollback: estrarre lo ZIP nel vault path` : '(backup non disponibile)'}

${ANTIDESTRUCTIVE_GUARDRAILS}

## Vincoli specifici Obsidian
- NON eliminare file \`.md\` esistenti
- Preservare YAML frontmatter e link \`[[wiki]]\`
- Le modifiche NUOVE vanno in cartella \`_saio-autoconfig/\`
- Tempi: pochi minuti se <10 progetti, fino a varie ore con 50+ progetti grandi`,
          tags: ['onboarding', 'obsidian', 'autoconfig'],
        },
      ],
    }

    const briefPath = path.join(dataDir, 'briefs', `${briefId}.json`)
    await fs.mkdir(path.dirname(briefPath), { recursive: true })
    await fs.writeFile(briefPath, JSON.stringify(brief, null, 2))

    await audit({
      type: 'session.created',
      email: req.user?.email || 'unknown',
      ip: getClientIp(req),
      userAgentHash: hashUserAgent(req),
      meta: {
        obsidianAutoconfig: true,
        briefId,
        projectsCount: projects.length,
        actions,
        backupPath: backupInfo?.backupPath,
        backupSizeKB: backupInfo ? Math.round(backupInfo.sizeBytes / 1024) : null,
      },
    })

    await patchChoices(dataDir, { obsidian: 'have-it' })
    res.json({
      ok: true,
      briefId,
      backupPath: backupInfo?.backupPath,
      backupSizeKB: backupInfo ? Math.round(backupInfo.sizeBytes / 1024) : null,
      message: 'Brief autoconfig creato + backup vault salvato. Apri /inbox per approvare e avviare la sessione.',
    })
  })

  router.post('/set-anthropic-key', async (req: Request, res: Response): Promise<void> => {
    const parsed = AnthropicKeySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' })
      return
    }
    try {
      await updateEnvLocal({ ANTHROPIC_API_KEY: parsed.data.apiKey })
      setProcessEnv({ ANTHROPIC_API_KEY: parsed.data.apiKey })
      await patchChoices(dataDir, { anthropicApi: 'configured' })
      res.json({ ok: true })
    } catch (err) {
      res.status(500).json({ error: 'env_write_failed', message: (err as Error).message })
    }
  })

  return router
}
