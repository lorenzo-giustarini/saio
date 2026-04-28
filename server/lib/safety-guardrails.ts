/**
 * V15.0 WS18 — Antidistruzione: vincoli centralizzati + helper backup.
 *
 * Tutti i brief generators (Obsidian autoconfig, future autoconfig modules,
 * task spawn da UI) DEVONO injectare ANTIDESTRUCTIVE_GUARDRAILS nel
 * soluzioneProposta del brief. La costante è anche servita al frontend via
 * /api/system/guardrails per mostrare in UI cosa SAIO promette di non fare.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import archiver from 'archiver'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { logger } from './logger'

/**
 * Vincoli anti-distruttivi che ogni sessione orchestrator DEVE rispettare.
 * Vengono inseriti nel kickoff brief e mostrati in UI a utente prima di approvare.
 */
export const ANTIDESTRUCTIVE_GUARDRAILS = `
## 🛡️ VINCOLI ANTIDISTRUTTIVI (mandatori)

Le sessioni Claude orchestrate da SAIO devono rispettare questi vincoli:

1. **NESSUN comando distruttivo automatico**: NIENTE \`rm -rf\`, \`git clean -fd\`,
   \`git reset --hard\`, \`DROP TABLE\`, \`TRUNCATE\`, \`del /S /Q\` senza conferma
   utente esplicita richiesta nel brief stesso.
2. **Backup pre-modifica**: prima di operazioni > 10 file modificati, verifica
   che esista un backup (snapshot git, copia .bak, o ZIP esterno). Se non c'è,
   creane uno PRIMA di procedere.
3. **Conferma per azioni massive**: > 10 file modificati / spostati / eliminati
   in singola operazione richiede pausa con messaggio "Confermi N modifiche?"
   in chat con l'utente.
4. **Working dir constraint**: lavora solo nella sotto-cartella indicata nel
   brief (di solito \`_saio-autoconfig/\` o path explicit). NON toccare file
   fuori da quella zona senza esplicita richiesta.
5. **Preservazione dati utente**: NON modificare/eliminare:
   - File con frontmatter YAML (sono note Obsidian con metadata)
   - File \`.git/\`, \`.obsidian/\` esistenti
   - \`.env*\` file
   - Cartelle node_modules, .venv, etc. (sono cache locali, ma non sono tue)
6. **Rollback su errore**: se un comando fallisce a metà operazione massiva,
   ROLLBACK alla checkpoint precedente + segnala il problema, NON tentare
   "fix" creativi che potrebbero peggiorare.
7. **Limite token/tempo**: se la sessione passa 4h consecutive o consuma 1M
   token, interrompi proattivamente con un sommario di cosa hai fatto.

Se uno qualsiasi di questi vincoli ti impedisce di completare il task, fermati
e chiedi all'utente come procedere. La sicurezza dei dati prevale sul completamento.
`.trim()

/**
 * V15.0 WS18 — ZIP backup di un path arbitrario in data/backups/.
 * Usato pre-autoconfig vault Obsidian o per snapshot pre-orchestrator session.
 */
export async function backupDirectory(opts: {
  sourcePath: string
  dataDir: string
  label: string // es. 'obsidian-pre-autoconfig'
}): Promise<{ backupPath: string; sizeBytes: number; entries: number }> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupDir = path.join(opts.dataDir, 'backups')
  await fs.mkdir(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, `${opts.label}-${ts}.zip`)

  return new Promise((resolve, reject) => {
    const output = createWriteStream(backupPath)
    const archive = archiver('zip', { zlib: { level: 6 } })
    let entries = 0
    archive.on('entry', () => {
      entries++
    })
    archive.on('error', (err) => reject(err))
    output.on('close', () => {
      const sizeBytes = archive.pointer()
      logger.info(`[backup] zipped ${opts.sourcePath} → ${backupPath} (${sizeBytes} bytes, ${entries} entries)`)
      resolve({ backupPath, sizeBytes, entries })
    })
    archive.pipe(output)
    archive.directory(opts.sourcePath, false)
    void archive.finalize()
  })
}

/**
 * V15.0 WS18 — Snapshot git pre-orchestrator session.
 * Salva output `git status --porcelain` + `git log -1 --format=%H` in
 * data/sessions/<sid>/pre-state.txt. Se il progetto NON è git repo, ritorna null.
 */
export async function captureGitSnapshot(opts: {
  projectPath: string
  dataDir: string
  sid: string
}): Promise<{ commitHash: string; statusLines: string[]; snapshotPath: string } | null> {
  // Verifica che sia un git repo
  try {
    await fs.access(path.join(opts.projectPath, '.git'))
  } catch {
    return null
  }

  function runGit(args: string[]): Promise<string> {
    return new Promise((resolve) => {
      const p = spawn('git', args, { cwd: opts.projectPath, shell: false })
      let out = ''
      p.stdout.on('data', (c: Buffer) => {
        out += c.toString('utf-8')
      })
      p.on('error', () => resolve(''))
      p.on('exit', () => resolve(out.trim()))
      setTimeout(() => {
        try {
          p.kill()
        } catch {
          /* ignore */
        }
        resolve(out)
      }, 5000)
    })
  }

  const [hash, status] = await Promise.all([
    runGit(['log', '-1', '--format=%H']),
    runGit(['status', '--porcelain']),
  ])

  const sessionDir = path.join(opts.dataDir, 'sessions', opts.sid)
  await fs.mkdir(sessionDir, { recursive: true })
  const snapshotPath = path.join(sessionDir, 'pre-state.txt')
  const content = `# SAIO pre-orchestrator git snapshot
# Generated: ${new Date().toISOString()}
# Project: ${opts.projectPath}

[commit hash]
${hash}

[git status --porcelain]
${status || '(clean working tree)'}
`
  await fs.writeFile(snapshotPath, content, 'utf-8')

  return {
    commitHash: hash,
    statusLines: status.split('\n').filter(Boolean),
    snapshotPath,
  }
}

/**
 * V15.0 WS18 — Lista file in data/auth/ che possono essere safe-deleted via
 * auth:reset script. Definita centralmente per coerenza tra script + README.
 */
export const AUTH_RESET_FILES = [
  'owner.json',
  'totp-secrets.json',
  'recovery-codes.json',
  'sessions.json',
  'allowed-emails.json',
  'claim-state.json',
  'CLAIM-TOKEN.txt',
  'pending-magic-links.json',
  'revoked-tokens.json',
] as const
