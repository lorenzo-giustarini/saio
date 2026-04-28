import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SSH_DIR = path.join(os.homedir(), '.ssh')

export interface SshKey {
  name: string
  type: 'private' | 'public'
  algorithm?: string
  size: number
  mtime: string
}

export interface VpsHost {
  id: string
  ip: string
  hostname?: string
  label: string
  keyName: string
  category: 'production' | 'staging' | 'experimental' | 'unknown'
  notes?: string
}

const SKIP_FILES = new Set(['known_hosts', 'known_hosts.old', 'authorized_keys', 'config'])

export async function listSshKeys(): Promise<SshKey[]> {
  try {
    const entries = await fs.readdir(SSH_DIR, { withFileTypes: true })
    const keys: SshKey[] = []
    for (const e of entries) {
      if (!e.isFile()) continue
      if (SKIP_FILES.has(e.name)) continue
      if (e.name.startsWith('.')) continue
      const full = path.join(SSH_DIR, e.name)
      const stat = await fs.stat(full)
      // ONLY metadata — NEVER read content of private keys
      const isPub = e.name.endsWith('.pub')
      keys.push({
        name: e.name,
        type: isPub ? 'public' : 'private',
        algorithm: inferAlgorithm(e.name),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      })
    }
    return keys.sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

function inferAlgorithm(name: string): string | undefined {
  const lower = name.toLowerCase()
  if (lower.includes('ed25519')) return 'ed25519'
  if (lower.includes('rsa')) return 'rsa'
  if (lower.includes('ecdsa')) return 'ecdsa'
  if (lower.includes('dsa')) return 'dsa'
  return undefined
}

/**
 * VPS whitelist — loaded from `data/ssh-inventory.json` (gitignored, user-specific).
 * Fallback to `data/ssh-inventory.example.json` (committed) for onboarding demo.
 * If neither exists, returns empty array (UI shows empty VPS list).
 *
 * File format:
 * ```json
 * { "vps": [ { "id": "my-vps", "ip": "1.2.3.4", "label": "...", "keyName": "id_ed25519", "category": "production" } ] }
 * ```
 *
 * V14.28 — il registro è ora dinamico: `addVpsHost`/`removeVpsHost`/`updateVpsHost`
 * fanno atomic write su `data/ssh-inventory.json` e invalidano la cache.
 * `VPS_HOSTS` è esposto come Proxy live per back-compat: ogni accesso forza
 * reload se cache scaduta. I consumer esistenti (9 file) continuano a funzionare.
 */

function getInventoryFile(): string {
  const dataDir = process.env.DASHBOARD_DATA_DIR || path.join(process.cwd(), 'data')
  return path.join(dataDir, 'ssh-inventory.json')
}

function getExampleFile(): string {
  const dataDir = process.env.DASHBOARD_DATA_DIR || path.join(process.cwd(), 'data')
  return path.join(dataDir, 'ssh-inventory.example.json')
}

function loadVpsHosts(): VpsHost[] {
  for (const candidate of [getInventoryFile(), getExampleFile()]) {
    try {
      if (!fsSync.existsSync(candidate)) continue
      const raw = fsSync.readFileSync(candidate, 'utf8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed?.vps)) return parsed.vps as VpsHost[]
    } catch {
      /* swallow and try next */
    }
  }
  return []
}

let _cache: VpsHost[] | null = null
let _cacheLoadedAt = 0
const CACHE_TTL_MS = 5_000

function getCached(): VpsHost[] {
  if (_cache && Date.now() - _cacheLoadedAt < CACHE_TTL_MS) {
    return _cache
  }
  _cache = loadVpsHosts()
  _cacheLoadedAt = Date.now()
  return _cache
}

export function invalidateVpsCache(): void {
  _cache = null
  _cacheLoadedAt = 0
}

export function getVpsHosts(): VpsHost[] {
  return getCached()
}

export function getVpsById(id: string): VpsHost | undefined {
  return getCached().find((h) => h.id === id)
}

/**
 * V14.28 — Atomic write del registro. Solo scrive `ssh-inventory.json` (mai
 * sovrascrive l'example). Validazione strict per id/IP/keyName.
 */
async function writeInventory(hosts: VpsHost[]): Promise<void> {
  const file = getInventoryFile()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify({ vps: hosts }, null, 2), 'utf-8')
  await fs.rename(tmp, file)
  invalidateVpsCache()
}

const ID_REGEX = /^[a-z0-9-]{3,32}$/
const IP_REGEX = /^([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|(\d{1,3}\.){3}\d{1,3})$/
const KEYNAME_REGEX = /^[a-zA-Z0-9._-]{1,64}$/

export function validateVpsInput(input: Partial<VpsHost>): string | null {
  if (!input.id || !ID_REGEX.test(input.id)) return 'id: 3-32 char lowercase/digit/dash'
  if (!input.ip || !IP_REGEX.test(input.ip)) return 'ip: hostname o IPv4 valido'
  if (!input.keyName || !KEYNAME_REGEX.test(input.keyName)) return 'keyName: alphanum/dash/underscore/dot, max 64'
  if (!input.label || input.label.length < 1 || input.label.length > 100) return 'label: 1-100 char'
  if (input.category && !['production', 'staging', 'experimental', 'unknown'].includes(input.category)) {
    return 'category: production|staging|experimental|unknown'
  }
  return null
}

export async function addVpsHost(host: VpsHost): Promise<VpsHost> {
  const err = validateVpsInput(host)
  if (err) throw new Error(err)
  const all = getCached()
  if (all.some((h) => h.id === host.id)) {
    throw new Error(`VPS id "${host.id}" already exists`)
  }
  const next = [...all, host]
  await writeInventory(next)
  return host
}

export async function removeVpsHost(id: string): Promise<void> {
  if (!ID_REGEX.test(id)) throw new Error('invalid id')
  const all = getCached()
  const next = all.filter((h) => h.id !== id)
  if (next.length === all.length) throw new Error(`VPS id "${id}" not found`)
  await writeInventory(next)
}

export async function updateVpsHost(id: string, patch: Partial<VpsHost>): Promise<VpsHost> {
  if (!ID_REGEX.test(id)) throw new Error('invalid id')
  const all = getCached()
  const idx = all.findIndex((h) => h.id === id)
  if (idx < 0) throw new Error(`VPS id "${id}" not found`)
  const merged: VpsHost = { ...all[idx], ...patch, id: all[idx].id } // id immutabile
  const err = validateVpsInput(merged)
  if (err) throw new Error(err)
  const next = [...all]
  next[idx] = merged
  await writeInventory(next)
  return merged
}

/**
 * V14.28 — Proxy live per back-compat. I 9 consumer esistenti accedono a
 * VPS_HOSTS come array; il Proxy ricarica al volo da disco con TTL.
 * Mutation diretta NON supportata (use addVpsHost/removeVpsHost).
 */
export const VPS_HOSTS: VpsHost[] = new Proxy([] as VpsHost[], {
  get(_target, prop) {
    const live = getCached()
    return Reflect.get(live, prop, live)
  },
  has(_target, prop) {
    return prop in getCached()
  },
  ownKeys() {
    return Reflect.ownKeys(getCached())
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Object.getOwnPropertyDescriptor(getCached(), prop)
  },
  set() {
    throw new Error('VPS_HOSTS is immutable; use addVpsHost/removeVpsHost/updateVpsHost')
  },
})

export async function getKnownHosts(): Promise<number> {
  try {
    const content = await fs.readFile(path.join(SSH_DIR, 'known_hosts'), 'utf8')
    return content.split('\n').filter((l) => l.trim() && !l.startsWith('#')).length
  } catch {
    return 0
  }
}
