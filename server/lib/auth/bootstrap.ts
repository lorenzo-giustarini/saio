/**
 * V15.0 WS3-3G — Bootstrap auth (claim flow).
 *
 * Logica idempotente al server start:
 *  - se owner.json esiste → log info "claim disabled", return
 *  - altrimenti:
 *      • se claim-state.json già esistente e non scaduto → re-stampa banner col token salvato
 *      • altrimenti rigenera nuovo claim token (32 byte hex), TTL configurabile
 *      • write claim-state.json (con tokenHash) + CLAIM-TOKEN.txt (raw, 0600 POSIX)
 *      • PRINT banner stdout con istruzioni
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { authPath, CLAIM_TTL_MIN } from './constants'
import { sha256Hex, generateRawToken } from './magic-link'
import { isClaimed } from './owner-store'
import { logger } from '../logger'

export type ClaimState =
  | { claimed: false; tokenHash: string; issuedAt: string; expiresAt: string }
  | { claimed: true; claimedAt: string; ownerEmail: string }

async function readClaimState(dataDir: string): Promise<ClaimState | null> {
  try {
    const txt = await fs.readFile(authPath(dataDir, 'claimState'), 'utf-8')
    return JSON.parse(txt) as ClaimState
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null
    throw err
  }
}

export async function writeClaimState(dataDir: string, state: ClaimState): Promise<void> {
  const file = authPath(dataDir, 'claimState')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(state, null, 2))
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export async function deleteClaimToken(dataDir: string): Promise<void> {
  try {
    await fs.unlink(authPath(dataDir, 'claimTokenTxt'))
  } catch {
    /* already gone */
  }
}

function printBanner(rawToken: string, expiresAt: string, dataDir: string): void {
  const tunnelUrl = (process.env.DASHBOARD_AUTH_TUNNEL_URL || '').trim()
  const baseHint = tunnelUrl
    ? `${tunnelUrl}/claim?token=${rawToken}`
    : `<your-public-url>/claim?token=${rawToken}`
  const sep = '═'.repeat(75)
  logger.info(sep)
  logger.info('  SAIO DASHBOARD — FIRST RUN CLAIM TOKEN')
  logger.info(sep)
  logger.info('  Open this URL from your Cloudflare Tunnel (or public host):')
  logger.info('      ' + baseHint)
  logger.info('')
  logger.info('  Token (also saved in data/auth/CLAIM-TOKEN.txt):')
  logger.info('      ' + rawToken)
  logger.info('')
  logger.info(`  Expires at: ${expiresAt}`)
  logger.info(`  Data dir: ${dataDir}`)
  logger.info(sep)
}

/**
 * Da chiamare nello startup di server/index.ts dopo ensureDataDirs.
 */
export async function bootstrapAuth(dataDir: string): Promise<void> {
  // Se già claimato → nulla da fare
  if (await isClaimed(dataDir)) {
    logger.info('[auth] owner.json present → claim disabled')
    // Cleanup difensivo: se per errore CLAIM-TOKEN.txt è rimasto, eliminiamo
    if (await fileExists(authPath(dataDir, 'claimTokenTxt'))) {
      await deleteClaimToken(dataDir)
    }
    return
  }

  // Se claim-state.json già esiste e non scaduto, riusiamolo (token salvato in CLAIM-TOKEN.txt)
  const existing = await readClaimState(dataDir)
  const ttlMs = CLAIM_TTL_MIN * 60_000
  const now = Date.now()
  if (existing && existing.claimed === false && new Date(existing.expiresAt).getTime() > now) {
    const txtPath = authPath(dataDir, 'claimTokenTxt')
    if (await fileExists(txtPath)) {
      const raw = (await fs.readFile(txtPath, 'utf-8')).trim()
      if (raw && sha256Hex(raw) === existing.tokenHash) {
        printBanner(raw, existing.expiresAt, dataDir)
        return
      }
    }
    // tokenHash non corrisponde a nessun raw → rigeneriamo
  }

  // Genera nuovo claim
  const raw = generateRawToken()
  const tokenHash = sha256Hex(raw)
  const issuedAt = new Date().toISOString()
  const expiresAt = new Date(now + ttlMs).toISOString()
  const state: ClaimState = { claimed: false, tokenHash, issuedAt, expiresAt }
  await writeClaimState(dataDir, state)
  const txtPath = authPath(dataDir, 'claimTokenTxt')
  await fs.mkdir(path.dirname(txtPath), { recursive: true })
  await atomicWriteFile(txtPath, raw)
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(txtPath, 0o600)
    } catch {
      /* ignore */
    }
  }
  printBanner(raw, expiresAt, dataDir)
}

export async function readClaimStatePublic(dataDir: string): Promise<ClaimState | null> {
  return readClaimState(dataDir)
}
