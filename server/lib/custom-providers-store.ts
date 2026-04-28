/**
 * Custom Providers Store (V13-T6.4)
 * Provider AI aggiunti manualmente dall'utente dalla UI.
 * Vengono mergiati col registry statico (provider-registry.ts) al runtime.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { logger } from './logger'
import type { CustomProvider, CustomProvidersFile } from '../../shared/schemas'
import { providerRegistry } from './provider-registry'

class CustomProvidersStore {
  private dataDir = ''
  private storeFile = ''

  setDataDir(dir: string) {
    this.dataDir = dir
    this.storeFile = path.join(dir, 'custom-providers.json')
  }

  async ensureLoaded() {
    // Load current file into providerRegistry.setCustom()
    const list = await this.list()
    providerRegistry.setCustom(list as any)
  }

  async load(): Promise<CustomProvidersFile> {
    try {
      const raw = await fsp.readFile(this.storeFile, 'utf8')
      return JSON.parse(raw) as CustomProvidersFile
    } catch {
      return { version: 1, providers: [] }
    }
  }

  async list(): Promise<CustomProvider[]> {
    return (await this.load()).providers
  }

  private async atomicWrite(payload: CustomProvidersFile): Promise<void> {
    if (!this.storeFile) throw new Error('custom-providers: dataDir not set')
    const tempFile = `${this.storeFile}.tmp`
    payload.updatedAt = new Date().toISOString()
    await fsp.mkdir(this.dataDir, { recursive: true })
    await fsp.writeFile(tempFile, JSON.stringify(payload, null, 2), 'utf8')
    await fsp.rename(tempFile, this.storeFile)
    // refresh registry
    providerRegistry.setCustom(payload.providers as any)
  }

  async add(p: CustomProvider): Promise<CustomProvider> {
    const file = await this.load()
    if (file.providers.some((x) => x.id === p.id)) throw new Error(`duplicate id: ${p.id}`)
    // Also check collision with static registry
    if (providerRegistry.listStatic().some((s) => s.id === p.id)) {
      throw new Error(`id ${p.id} collides with built-in provider`)
    }
    file.providers.push(p)
    await this.atomicWrite(file)
    logger.info(`[custom-providers] added ${p.id}`)
    return p
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.load()
    const before = file.providers.length
    file.providers = file.providers.filter((x) => x.id !== id)
    if (file.providers.length === before) return false
    await this.atomicWrite(file)
    return true
  }
}

export const customProvidersStore = new CustomProvidersStore()
