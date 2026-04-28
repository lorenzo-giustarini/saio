/**
 * Accounts Store — user-configured AI account profiles (V13-T2.2).
 *
 * Persistence: `data/accounts.json` (atomic write temp+rename) + backup.
 * Migration: al primo boot, chiama autodetect-service per seed automatico.
 *
 * NO SECRETS IN FILE: solo `envVarRef` (nome variabile). Valore risolto a runtime.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'
import type { Account, AccountsFile } from '../../shared/schemas'
import { detectAccounts, type AutodetectProposal } from './autodetect-service'

class AccountsStore {
  private dataDir = ''
  private storeFile = ''
  private cache: AccountsFile | null = null
  private cacheTs = 0
  private readonly CACHE_TTL_MS = 5_000

  setDataDir(dir: string) {
    this.dataDir = dir
    this.storeFile = path.join(dir, 'accounts.json')
  }

  /** Migrazione iniziale: se file non esiste → autodetect + seed */
  async migrate(): Promise<void> {
    if (!this.storeFile) throw new Error('accounts-store: dataDir not set')
    if (fs.existsSync(this.storeFile)) return

    logger.info(`[accounts-store] first boot → running autodetect for seed`)
    let seed: Account[] = []
    try {
      const proposals = await detectAccounts()
      seed = proposals.map((p) => this.proposalToAccount(p, 'autodetect'))
      logger.info(`[accounts-store] autodetect found ${seed.length} providers to seed`)
    } catch (err) {
      logger.warn('[accounts-store] autodetect failed, starting empty:', err)
    }

    const activeId = seed.find((a) => a.providerId === 'anthropic' && a.mode === 'plan')?.id
      || seed[0]?.id
      || null

    const payload: AccountsFile = {
      version: 1,
      accounts: seed,
      activeId: activeId as any,
      updatedAt: new Date().toISOString(),
    }

    await fsp.mkdir(this.dataDir, { recursive: true })
    await this.atomicWrite(payload)
    logger.info(`[accounts-store] seeded ${seed.length} accounts, active=${activeId || 'none'}`)
  }

  /** Convert AutodetectProposal to Account with metadata. */
  proposalToAccount(p: AutodetectProposal, createdBy: 'user' | 'autodetect' | 'seed' = 'user'): Account {
    const now = new Date().toISOString()
    return {
      id: p.suggestedId,
      providerId: p.providerId,
      mode: p.mode,
      label: p.suggestedLabel,
      cliName: p.cliName,
      envVarRef: p.envVarRef,
      defaultModel: p.defaultModel,
      createdAt: now,
      createdBy,
      status: {
        health: 'unknown' as const,
        lastCheck: undefined,
        notes: p.reason,
      },
    }
  }

  private async atomicWrite(payload: AccountsFile): Promise<void> {
    const tempFile = `${this.storeFile}.tmp`
    payload.updatedAt = new Date().toISOString()
    const json = JSON.stringify(payload, null, 2)
    await fsp.writeFile(tempFile, json, 'utf8')

    // V15.3 WS33: validate temp file before rename (prevent NULL-byte corruption
    // observed 2026-04-27 dove un crash atomic-write ha lasciato accounts.json
    // a 2749 byte di NULL → vault perso).
    try {
      const verify = await fsp.readFile(tempFile, 'utf8')
      if (!verify || verify.length < json.length / 2) {
        throw new Error(`temp file size ${verify?.length ?? 0} < expected ${json.length}`)
      }
      JSON.parse(verify) // throws on invalid
    } catch (err: any) {
      await fsp.unlink(tempFile).catch(() => {})
      throw new Error(`accounts-store atomic write validation failed: ${err.message}`)
    }

    // V15.3 WS33: rolling backup pre-overwrite (retain ultimi 5 per recovery)
    if (fs.existsSync(this.storeFile)) {
      try {
        const ts = new Date().toISOString().replace(/[:.]/g, '-')
        const backupFile = `${this.storeFile}.backup-${ts}`
        await fsp.copyFile(this.storeFile, backupFile)
        const dir = path.dirname(this.storeFile)
        const base = path.basename(this.storeFile)
        const entries = await fsp.readdir(dir)
        const backups = entries
          .filter((e) => e.startsWith(`${base}.backup-`))
          .sort()
          .reverse()
        for (let i = 5; i < backups.length; i++) {
          await fsp.unlink(path.join(dir, backups[i])).catch(() => {})
        }
      } catch (err: any) {
        logger.warn(`[accounts-store] backup pre-overwrite failed (non-fatal): ${err?.message}`)
      }
    }

    await fsp.rename(tempFile, this.storeFile)
    this.invalidateCache()
  }

  invalidateCache() {
    this.cache = null
    this.cacheTs = 0
  }

  async load(): Promise<AccountsFile> {
    const now = Date.now()
    if (this.cache && now - this.cacheTs < this.CACHE_TTL_MS) return this.cache

    try {
      const raw = await fsp.readFile(this.storeFile, 'utf8')
      const parsed = JSON.parse(raw) as AccountsFile
      if (!parsed || !Array.isArray(parsed.accounts)) {
        logger.warn('[accounts-store] malformed file, returning empty')
        return { version: 1, accounts: [], activeId: null }
      }
      this.cache = parsed
      this.cacheTs = now
      return parsed
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        await this.migrate()
        return this.load()
      }
      logger.error('[accounts-store] load failed:', err)
      return { version: 1, accounts: [], activeId: null }
    }
  }

  async list(): Promise<Account[]> {
    return (await this.load()).accounts
  }

  async findById(id: string): Promise<Account | null> {
    const all = await this.list()
    return all.find((a) => a.id === id) || null
  }

  async add(account: Account): Promise<Account> {
    const file = await this.load()
    if (file.accounts.some((a) => a.id === account.id)) {
      throw new Error(`duplicate account id: ${account.id}`)
    }
    file.accounts.push({
      ...account,
      createdAt: account.createdAt || new Date().toISOString(),
    })
    // If this is the first account, set as active
    if (!file.activeId) file.activeId = account.id
    await this.atomicWrite(file)
    return account
  }

  async update(id: string, patch: Partial<Account>): Promise<Account> {
    const file = await this.load()
    const idx = file.accounts.findIndex((a) => a.id === id)
    if (idx === -1) throw new Error(`account not found: ${id}`)
    const updated: Account = { ...file.accounts[idx], ...patch, id }
    file.accounts[idx] = updated
    await this.atomicWrite(file)
    return updated
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.load()
    const before = file.accounts.length
    file.accounts = file.accounts.filter((a) => a.id !== id)
    if (file.accounts.length === before) return false
    // If we removed the active one, pick a new active
    if (file.activeId === id) {
      file.activeId = file.accounts[0]?.id || null
    }
    await this.atomicWrite(file)
    return true
  }

  async setActive(id: string | null): Promise<void> {
    const file = await this.load()
    if (id !== null) {
      const exists = file.accounts.some((a) => a.id === id)
      if (!exists) throw new Error(`account not found: ${id}`)
    }
    file.activeId = id
    await this.atomicWrite(file)
  }

  async getActive(): Promise<Account | null> {
    const file = await this.load()
    if (!file.activeId) return null
    return file.accounts.find((a) => a.id === file.activeId) || null
  }

  /** Resolve account for spawn: by id, else active, else null */
  async resolveForSpawn(accountId?: string): Promise<Account | null> {
    if (accountId) return this.findById(accountId)
    return this.getActive()
  }

  /**
   * V13.3-T8: mark account as used locally (non-remote) at given timestamp.
   * Idempotent, fire-and-forget. Does not throw (logs on failure).
   */
  async touchLocalUse(accountId: string): Promise<void> {
    try {
      const file = await this.load()
      const idx = file.accounts.findIndex((a) => a.id === accountId)
      if (idx === -1) return
      file.accounts[idx] = {
        ...file.accounts[idx],
        lastLocalUseAt: new Date().toISOString(),
      }
      await this.atomicWrite(file)
    } catch (err) {
      logger.warn(`[accounts-store] touchLocalUse(${accountId}) failed:`, err)
    }
  }

  /** Re-run autodetect and return ONLY NEW proposals not yet added as accounts */
  async rerunAutodetect(): Promise<AutodetectProposal[]> {
    const all = await detectAccounts()
    const existing = (await this.list()).map((a) => ({ providerId: a.providerId, mode: a.mode }))
    return all.filter(
      (p) => !existing.some((acc) => acc.providerId === p.providerId && acc.mode === p.mode)
    )
  }

  /** Bulk add from a list of proposals (used after autodetect confirm) */
  async addFromProposals(proposals: AutodetectProposal[]): Promise<Account[]> {
    const added: Account[] = []
    const file = await this.load()
    for (const p of proposals) {
      const acct = this.proposalToAccount(p, 'autodetect')
      // Skip if already present (by id OR provider+mode)
      if (
        file.accounts.some(
          (a) => a.id === acct.id || (a.providerId === p.providerId && a.mode === p.mode)
        )
      ) {
        continue
      }
      file.accounts.push(acct)
      added.push(acct)
    }
    if (!file.activeId && file.accounts.length > 0) file.activeId = file.accounts[0].id
    if (added.length > 0) await this.atomicWrite(file)
    return added
  }
}

export const accountsStore = new AccountsStore()
