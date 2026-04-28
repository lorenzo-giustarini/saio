/**
 * V15.0 WS3-3B — TOTP secrets store + enroll/verify + recovery codes.
 *
 * - secret base32 in totp-secrets.json[email] (mai returned dopo enroll)
 * - QR code dataURL via qrcode pkg per scan con Google Authenticator/Authy
 * - 10 recovery codes (16 hex chars) hashed con bcryptjs cost 10. Plaintext shown
 *   ONCE al primo enroll, mai più recuperabili. Single-use per code.
 */
import { generateSecret, generateURI, verifySync } from 'otplib'
import qrcode from 'qrcode'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { authPath } from './constants'
import { setTotpEnrolledAt } from './allowlist'

// otplib v13 functional API. tolerance: [past, future] in seconds
const VERIFY_TOLERANCE: [number, number] = [30, 30] // ±1 step (30s)

export interface TotpRecord {
  email: string
  secret: string // base32 otplib
  enrolledAt: string | null // null = pending confirmation
}

interface TotpStore {
  version: 1
  secrets: Record<string, TotpRecord>
}

interface RecoveryCodeStored {
  hash: string
  used: boolean
  usedAt?: string
}

interface RecoveryStore {
  version: 1
  codes: Record<string, RecoveryCodeStored[]>
}

const EMPTY_TOTP: TotpStore = { version: 1, secrets: {} }
const EMPTY_REC: RecoveryStore = { version: 1, codes: {} }

async function readTotpStore(dataDir: string): Promise<TotpStore> {
  try {
    const txt = await fs.readFile(authPath(dataDir, 'totpSecrets'), 'utf-8')
    const parsed = JSON.parse(txt) as TotpStore
    if (parsed.version !== 1 || typeof parsed.secrets !== 'object') return { ...EMPTY_TOTP }
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return { ...EMPTY_TOTP }
    throw err
  }
}

async function writeTotpStore(dataDir: string, store: TotpStore): Promise<void> {
  const file = authPath(dataDir, 'totpSecrets')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(store, null, 2))
}

async function readRecoveryStore(dataDir: string): Promise<RecoveryStore> {
  try {
    const txt = await fs.readFile(authPath(dataDir, 'recoveryCodes'), 'utf-8')
    const parsed = JSON.parse(txt) as RecoveryStore
    if (parsed.version !== 1 || typeof parsed.codes !== 'object') return { ...EMPTY_REC }
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return { ...EMPTY_REC }
    throw err
  }
}

async function writeRecoveryStore(dataDir: string, store: RecoveryStore): Promise<void> {
  const file = authPath(dataDir, 'recoveryCodes')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(store, null, 2))
}

function generateRecoveryCodes(count: number): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(8).toString('hex'))
  }
  return codes
}

export async function getTotpRecord(dataDir: string, email: string): Promise<TotpRecord | null> {
  const store = await readTotpStore(dataDir)
  const norm = email.toLowerCase()
  return store.secrets[norm] || null
}

export async function deleteTotpRecord(dataDir: string, email: string): Promise<void> {
  const store = await readTotpStore(dataDir)
  const norm = email.toLowerCase()
  delete store.secrets[norm]
  await writeTotpStore(dataDir, store)
  const recStore = await readRecoveryStore(dataDir)
  delete recStore.codes[norm]
  await writeRecoveryStore(dataDir, recStore)
}

/**
 * Inizia enroll: genera nuovo secret + 10 recovery codes (hashed at rest).
 * Plaintext recovery codes ritornati UNA volta. enrolledAt = null finché confermato.
 */
export async function startEnroll(
  dataDir: string,
  email: string
): Promise<{ secret: string; qrCodeDataUrl: string; recoveryCodes: string[] }> {
  const norm = email.toLowerCase()
  const secret = generateSecret()
  const otpauthUrl = generateURI({ issuer: 'SAIO Dashboard', label: norm, secret })
  const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl, { errorCorrectionLevel: 'M', margin: 1, scale: 6 })
  const codes = generateRecoveryCodes(10)
  const hashed: RecoveryCodeStored[] = codes.map((c) => ({ hash: bcrypt.hashSync(c, 10), used: false }))

  // Persist (sovrascrive eventuali secret in pending-confirmation)
  const store = await readTotpStore(dataDir)
  store.secrets[norm] = { email: norm, secret, enrolledAt: null }
  await writeTotpStore(dataDir, store)

  const recStore = await readRecoveryStore(dataDir)
  recStore.codes[norm] = hashed
  await writeRecoveryStore(dataDir, recStore)

  return { secret, qrCodeDataUrl, recoveryCodes: codes }
}

/**
 * Confirm enroll: verifica codice TOTP, marca enrolledAt = now, aggiorna allowlist.
 */
export async function confirmEnroll(dataDir: string, email: string, code: string): Promise<boolean> {
  const norm = email.toLowerCase()
  const store = await readTotpStore(dataDir)
  const rec = store.secrets[norm]
  if (!rec || rec.enrolledAt) return false
  const result = verifySync({ token: code, secret: rec.secret, epochTolerance: VERIFY_TOLERANCE })
  if (!result.valid) return false
  const now = new Date().toISOString()
  rec.enrolledAt = now
  store.secrets[norm] = rec
  await writeTotpStore(dataDir, store)
  await setTotpEnrolledAt(dataDir, norm, now)
  return true
}

/**
 * Verifica TOTP code OR recovery code. Recovery codes single-use.
 */
export async function verifyTotpOrRecovery(
  dataDir: string,
  email: string,
  code: string
): Promise<{ ok: boolean; usedRecovery?: boolean }> {
  const norm = email.toLowerCase()
  const store = await readTotpStore(dataDir)
  const rec = store.secrets[norm]
  if (!rec || !rec.enrolledAt) return { ok: false }
  // TOTP attempt
  const totpResult = verifySync({ token: code, secret: rec.secret, epochTolerance: VERIFY_TOLERANCE })
  if (totpResult.valid) {
    return { ok: true }
  }
  // Recovery attempt
  const recStore = await readRecoveryStore(dataDir)
  const codes = recStore.codes[norm] || []
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]
    if (!c) continue
    if (c.used) continue
    if (bcrypt.compareSync(code, c.hash)) {
      c.used = true
      c.usedAt = new Date().toISOString()
      codes[i] = c
      recStore.codes[norm] = codes
      await writeRecoveryStore(dataDir, recStore)
      return { ok: true, usedRecovery: true }
    }
  }
  return { ok: false }
}
