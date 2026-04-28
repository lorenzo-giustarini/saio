#!/usr/bin/env tsx
/**
 * V15.0 WS9 — Reissue claim token senza restartare il server.
 *
 * Uso: `npm run claim:reissue` (richiede tsx in devDependencies)
 *
 * Cosa fa:
 *  1. Carica .env.local (per ereditare DASHBOARD_DATA_DIR / CLAIM_TTL_MIN custom)
 *  2. Verifica che owner.json NON esista (dashboard non claimato)
 *  3. Cancella claim-state.json + CLAIM-TOKEN.txt esistenti
 *  4. Chiama bootstrapAuth() che genera nuovo token + stampa banner
 *
 * Side effect: il server in esecuzione vedrà il nuovo claim alla prossima
 * lettura di claim-state.json (ogni POST /claim/start re-legge da disco).
 * NON serve restart del server.
 */
import dotenv from 'dotenv'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')

// Carica .env.local prima di qualunque import che legga process.env
dotenv.config({ path: path.join(projectRoot, '.env.local') })
dotenv.config({ path: path.join(projectRoot, '.env') })

// Import dopo dotenv per ereditare env vars
const { bootstrapAuth } = await import('../server/lib/auth/bootstrap.js').catch(() =>
  import('../server/lib/auth/bootstrap')
)
const { isClaimed } = await import('../server/lib/auth/owner-store.js').catch(() =>
  import('../server/lib/auth/owner-store')
)
const { authPath } = await import('../server/lib/auth/constants.js').catch(() =>
  import('../server/lib/auth/constants')
)

const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(projectRoot, 'data')

async function main(): Promise<void> {
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════════════')
  console.log('  SAIO Claim Reissue')
  console.log('═══════════════════════════════════════════════════════════════════════════')
  console.log(`  Data dir: ${DATA_DIR}`)
  console.log('')

  // Pre-check: dashboard non claimato
  if (await isClaimed(DATA_DIR)) {
    console.error('❌ Dashboard già claimato. Reissue NON è permesso post-bootstrap.')
    console.error('   Per reset completo: rm data/auth/owner.json + restart server.')
    process.exit(1)
  }

  // Cleanup claim-state + CLAIM-TOKEN.txt esistenti
  const filesToRemove = [
    authPath(DATA_DIR, 'claimState'),
    authPath(DATA_DIR, 'claimTokenTxt'),
  ]
  for (const f of filesToRemove) {
    try {
      await fs.unlink(f)
      console.log(`  ✓ rimosso ${path.basename(f)}`)
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') throw err
      // ENOENT = già non esiste, ok
    }
  }
  console.log('')

  // Genera nuovo token
  await bootstrapAuth(DATA_DIR)
  console.log('')
  console.log('💡 Il server in esecuzione (se attivo) leggerà il nuovo claim-state.json')
  console.log('   alla prossima richiesta /api/auth/claim/start. NON serve restart.')
  console.log('')
}

main().catch((err: unknown) => {
  console.error('❌ Reissue fallito:', err)
  process.exit(1)
})
