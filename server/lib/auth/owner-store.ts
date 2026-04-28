/**
 * V15.0 WS3 — Owner store.
 * data/auth/owner.json esiste = bootstrap completato (single-owner immutabile).
 * Mai sovrascritto dal codice. Reset solo via SSH (rm).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { atomicWriteFile } from '../atomic-write'
import { authPath } from './constants'

export interface Owner {
  email: string
  claimedAt: string
  claimIp: string
}

export async function readOwner(dataDir: string): Promise<Owner | null> {
  try {
    const txt = await fs.readFile(authPath(dataDir, 'ownerJson'), 'utf-8')
    const parsed = JSON.parse(txt) as Owner
    if (typeof parsed.email !== 'string' || !parsed.email) return null
    return parsed
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') return null
    throw err
  }
}

export async function writeOwner(dataDir: string, owner: Owner): Promise<void> {
  const file = authPath(dataDir, 'ownerJson')
  await fs.mkdir(path.dirname(file), { recursive: true })
  await atomicWriteFile(file, JSON.stringify(owner, null, 2))
}

export async function isClaimed(dataDir: string): Promise<boolean> {
  return (await readOwner(dataDir)) !== null
}
