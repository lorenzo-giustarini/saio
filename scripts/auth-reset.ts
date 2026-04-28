#!/usr/bin/env tsx
/**
 * V15.0 WS18 — Auth reset SAFE script.
 *
 * Cancella SOLO i file auth listati in AUTH_RESET_FILES (centralized in
 * lib/safety-guardrails.ts). Tutto il resto di data/ resta intatto:
 *  - data/projects.json (progetti importati) ← preservato
 *  - data/briefs/ (brief schedulati) ← preservato
 *  - data/tasks/ (sessioni live) ← preservato
 *  - data/audit/ (audit log) ← preservato
 *
 * Uso:  npm run auth:reset       # interattivo, chiede conferma
 *       npm run auth:reset --yes # accetta tutto
 *
 * Mostra ESPLICITAMENTE i file che cancellerà PRIMA di farlo, poi richiede yes.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs/promises'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

dotenv.config({ path: path.join(projectRoot, '.env.local') })
dotenv.config({ path: path.join(projectRoot, '.env') })

const { AUTH_RESET_FILES } = await import('../server/lib/safety-guardrails.js').catch(() =>
  import('../server/lib/safety-guardrails')
)

const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(projectRoot, 'data')
const authDir = path.join(DATA_DIR, 'auth')

const autoYes = process.argv.includes('--yes') || process.argv.includes('-y')

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════════════')
  console.log('  SAIO Auth Reset (SAFE)')
  console.log('═══════════════════════════════════════════════════════════════════════════')
  console.log(`  Data dir: ${DATA_DIR}`)
  console.log(`  Auth dir: ${authDir}`)
  console.log('')

  // Lista files che esistono
  const existing: string[] = []
  for (const filename of AUTH_RESET_FILES) {
    const fp = path.join(authDir, filename)
    if (await fileExists(fp)) existing.push(fp)
  }

  if (existing.length === 0) {
    console.log('✓ Nessun file auth da cancellare. Stato già fresh.')
    return
  }

  console.log('Verranno cancellati SOLO questi file:')
  for (const fp of existing) {
    console.log(`  - ${path.relative(projectRoot, fp)}`)
  }
  console.log('')
  console.log('I seguenti file NON verranno toccati:')
  console.log('  - data/projects.json (progetti importati)')
  console.log('  - data/briefs/ (brief schedulati)')
  console.log('  - data/tasks/ (sessioni live)')
  console.log('  - data/audit/ (audit log)')
  console.log('  - data/auth/.jwt-secret (preservato — non in lista reset)')
  console.log('  - data/auth/banned-ips.json (preservato — manualmente editabile)')
  console.log('  - data/auth/audit.log (preservato — append-only)')
  console.log('  - data/auth/totp-secrets.json (preservato — vedi nota)')
  console.log('')

  if (!autoYes) {
    const rl = readline.createInterface({ input, output })
    const answer = await rl.question("Confermi reset? Scrivi 'yes' per procedere: ")
    rl.close()
    if (answer.trim().toLowerCase() !== 'yes') {
      console.log('Aborted.')
      process.exit(0)
    }
  }

  // Backup pre-reset (atomic, even if reset is destructive intent — let's be safe)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupDir = path.join(DATA_DIR, 'backups', `auth-pre-reset-${ts}`)
  await fs.mkdir(backupDir, { recursive: true })
  for (const fp of existing) {
    const dest = path.join(backupDir, path.basename(fp))
    await fs.copyFile(fp, dest)
  }
  console.log(`📦 Backup pre-reset salvato in: ${backupDir}`)
  console.log('')

  // Delete
  let deleted = 0
  for (const fp of existing) {
    try {
      await fs.unlink(fp)
      console.log(`  ✓ removed ${path.relative(projectRoot, fp)}`)
      deleted++
    } catch (err) {
      console.error(`  ✗ failed: ${fp} — ${(err as Error).message}`)
    }
  }
  console.log('')
  console.log(`✓ Reset completato: ${deleted} file cancellati.`)
  console.log('')
  console.log('Prossimi step:')
  console.log('  1. Restart server:  pm2 restart  /  systemctl restart  /  Ctrl+C+npm run dev:all')
  console.log('  2. Banner CLAIM TOKEN apparirà in stdout')
  console.log('  3. Visita /claim?token=<TOKEN> per re-claimare')
  console.log('')
}

main().catch((err: unknown) => {
  console.error('❌ Reset fallito:', err)
  process.exit(1)
})
