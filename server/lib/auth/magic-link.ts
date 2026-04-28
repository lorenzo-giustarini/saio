/**
 * V15.0 WS3 — Magic link store.
 * Token raw 32 byte hex (64 char). Salvato come sha256(raw) at rest.
 * Atomic create/consume; GC on every read.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { atomicWriteFile } from '../atomic-write'
import { authPath } from './constants'

export type MagicLinkPurpose = 'claim' | 'login' | 'invite'

export interface MagicLinkRecord {
  tokenHash: string // sha256(rawToken)
  email: string
  role: 'owner' | 'guest'
  purpose: MagicLinkPurpose
  issuedAt: string
  expiresAt: string
  consumed: boolean
  consumedAt?: string
  ip: string
  userAgentHash: string
}

interface PendingStore {
  version: 1
  links: MagicLinkRecord[]
}

const EMPTY: PendingStore = { version: 1, links: [] }

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex')
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

async function readStore(dataDir: string): Promise<PendingStore> {
  try {
    const txt = await fs.readFile(authPath(dataDir, 'pendingMagicLinks'), 'utf-8')
    const parsed = JSON.parse(txt) as PendingStore
    if (parsed.version !== 1 || !Array.isArray(parsed.links)) return { ...EMPTY }
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return { ...EMPTY }
    throw err
  }
}

async function writeStore(dataDir: string, store: PendingStore): Promise<void> {
  const file = authPath(dataDir, 'pendingMagicLinks')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(store, null, 2))
}

/**
 * GC: rimuovi link expired da troppo (>1h dopo expiresAt) e consumed da troppo (>5min).
 * Il piccolo ritardo permette replay-detection in caso di doppio click.
 */
function gc(store: PendingStore): PendingStore {
  const now = Date.now()
  const oneHourMs = 60 * 60_000
  const fiveMinMs = 5 * 60_000
  store.links = store.links.filter((r) => {
    const exp = new Date(r.expiresAt).getTime()
    if (r.consumed) {
      const consumed = r.consumedAt ? new Date(r.consumedAt).getTime() : exp
      return now - consumed < fiveMinMs
    }
    return now - exp < oneHourMs
  })
  return store
}

export async function createMagicLink(opts: {
  dataDir: string
  email: string
  role: 'owner' | 'guest'
  purpose: MagicLinkPurpose
  ip: string
  userAgentHash: string
  ttlMinutes: number
}): Promise<{ rawToken: string; expiresAt: string }> {
  const raw = generateRawToken()
  const record: MagicLinkRecord = {
    tokenHash: sha256Hex(raw),
    email: opts.email.toLowerCase(),
    role: opts.role,
    purpose: opts.purpose,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + opts.ttlMinutes * 60_000).toISOString(),
    consumed: false,
    ip: opts.ip,
    userAgentHash: opts.userAgentHash,
  }
  let store = await readStore(opts.dataDir)
  store = gc(store)
  store.links.push(record)
  await writeStore(opts.dataDir, store)
  return { rawToken: raw, expiresAt: record.expiresAt }
}

/**
 * Consume singolo link (atomic): trova match (hash + not consumed + not expired),
 * marca consumed, salva. Ritorna il record consumato o null se non valido.
 */
export async function consumeMagicLink(dataDir: string, rawToken: string): Promise<MagicLinkRecord | null> {
  let store = await readStore(dataDir)
  store = gc(store)
  const hash = sha256Hex(rawToken)
  const idx = store.links.findIndex(
    (r) => r.tokenHash === hash && !r.consumed && new Date(r.expiresAt).getTime() > Date.now()
  )
  if (idx === -1) {
    await writeStore(dataDir, store) // persist GC anyway
    return null
  }
  const link = store.links[idx]
  if (!link) return null
  link.consumed = true
  link.consumedAt = new Date().toISOString()
  store.links[idx] = link
  await writeStore(dataDir, store)
  return link
}
