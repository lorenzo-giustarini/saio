/**
 * Accounts routes (V13-T2.3) — CRUD + autodetect + active switcher.
 *
 * Endpoints:
 *  GET  /api/accounts                 — list all accounts
 *  GET  /api/accounts/active          — currently active account
 *  GET  /api/accounts/:id             — single account detail
 *  POST /api/accounts                 — create new
 *  PATCH /api/accounts/:id            — partial update
 *  DELETE /api/accounts/:id           — remove
 *  POST /api/accounts/select          — body {id|null} set active
 *  GET  /api/accounts/autodetect      — list proposals not yet existing
 *  POST /api/accounts/autodetect/apply — body {proposals: [...]} bulk-add
 *  GET  /api/providers                — list all providers (static+custom)
 *  GET  /api/providers/:id            — single provider detail
 */
import { Router } from 'express'
import { accountsStore } from '../lib/accounts-store'
import { providerRegistry } from '../lib/provider-registry'
import { AccountSchema, AccountPatchSchema, CustomProviderSchema } from '../../shared/schemas'
import { checkAccount, checkAllAccounts, clearHealthCache } from '../lib/account-health'
import { customProvidersStore } from '../lib/custom-providers-store'
import { secretsStore } from '../lib/secrets-store'
import { openInstallConsole } from '../lib/local-install-spawner'
import { vpsStateStore } from '../lib/vps-state-store'
import { vpsConfigStore } from '../lib/vps-config-store'
import { VPS_HOSTS } from '../lib/ssh-inventory'
import { probeAuthOnVps, invalidateAuthProbeCache } from '../lib/ssh-auth-probe'
import { logger } from '../lib/logger'

export function accountsRouter() {
  const router = Router()

  // ===== Provider registry =====
  router.get('/providers', (_req, res) => {
    res.json({ providers: providerRegistry.list() })
  })
  router.get('/providers/:id', (req, res) => {
    const id = String(req.params.id).replace(/[^a-z0-9_-]/g, '')
    const p = providerRegistry.get(id)
    if (!p) return res.status(404).json({ error: 'provider not found' })
    res.json(p)
  })

  // Custom providers (user-added via UI)
  router.post('/providers/custom', async (req, res) => {
    const parsed = CustomProviderSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid', details: parsed.error.issues })
    }
    try {
      const added = await customProvidersStore.add(parsed.data)
      res.status(201).json(added)
    } catch (err: any) {
      res.status(409).json({ error: err.message })
    }
  })
  router.delete('/providers/custom/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-z0-9_-]/g, '')
    const ok = await customProvidersStore.remove(id)
    if (!ok) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true, id })
  })

  // ===== Autodetect =====
  router.get('/autodetect', async (_req, res) => {
    try {
      const proposals = await accountsStore.rerunAutodetect()
      res.json({ proposals, count: proposals.length })
    } catch (err: any) {
      logger.error('[accounts] autodetect failed:', err)
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  router.post('/autodetect/apply', async (req, res) => {
    const proposals = Array.isArray(req.body?.proposals) ? req.body.proposals : []
    if (proposals.length === 0) return res.status(400).json({ error: 'no proposals provided' })
    try {
      const added = await accountsStore.addFromProposals(proposals)
      res.json({ ok: true, added, count: added.length })
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  // ===== Active switcher =====
  router.get('/active', async (_req, res) => {
    const active = await accountsStore.getActive()
    res.json({ active })
  })

  router.post('/select', async (req, res) => {
    const id = req.body?.id
    if (id !== null && typeof id !== 'string') {
      return res.status(400).json({ error: 'id must be string or null' })
    }
    if (id !== null && !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
      return res.status(400).json({ error: 'invalid id format' })
    }
    try {
      await accountsStore.setActive(id)
      const active = await accountsStore.getActive()
      res.json({ ok: true, active })
    } catch (err: any) {
      res.status(404).json({ error: err.message || String(err) })
    }
  })

  // ===== V13.1-T2.2 Secrets (API keys) =====
  router.post('/:id/set-secret', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const account = await accountsStore.findById(id)
    if (!account) return res.status(404).json({ error: 'account not found' })
    if (!account.envVarRef) {
      return res.status(400).json({ error: 'account has no envVarRef — cannot store secret' })
    }
    const value = req.body?.value
    if (typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: 'missing or empty value' })
    }
    try {
      await secretsStore.set(account.envVarRef, value)
      // Invalidate health cache for this account
      const { clearHealthCache } = await import('../lib/account-health')
      clearHealthCache(id)
      res.json({ ok: true, envVarRef: account.envVarRef })
    } catch (err: any) {
      logger.error(`[accounts] set-secret failed:`, err.message || err)
      res.status(500).json({ error: err.message || 'failed' })
    }
  })

  router.get('/:id/has-secret', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const account = await accountsStore.findById(id)
    if (!account) return res.status(404).json({ error: 'account not found' })
    if (!account.envVarRef) return res.json({ present: false, reason: 'no envVarRef' })
    const present = await secretsStore.has(account.envVarRef)
    res.json({ present, envVarRef: account.envVarRef })
  })

  // V13.1 T5: Local install endpoint
  router.post('/:id/install', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const account = await accountsStore.findById(id)
    if (!account) return res.status(404).json({ error: 'account not found' })
    const result = openInstallConsole(account)
    if (!result.opened) {
      return res.status(result.error ? 400 : 500).json(result)
    }
    // V13.1 BUG1b fix: invalidate health cache so next poll shows fresh status
    clearHealthCache(id)
    res.json(result)
  })

  router.delete('/:id/secret', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const account = await accountsStore.findById(id)
    if (!account) return res.status(404).json({ error: 'account not found' })
    if (!account.envVarRef) return res.status(400).json({ error: 'no envVarRef' })
    const removed = await secretsStore.unset(account.envVarRef)
    const { clearHealthCache } = await import('../lib/account-health')
    clearHealthCache(id)
    res.json({ ok: removed })
  })

  // ===== Health check =====
  router.get('/health/all', async (_req, res) => {
    const accounts = await accountsStore.list()
    const results = await checkAllAccounts(accounts)
    res.json({ results, count: results.length })
  })

  router.get('/:id/health', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const a = await accountsStore.findById(id)
    if (!a) return res.status(404).json({ error: 'not found' })
    if (req.query.refresh === 'true') clearHealthCache(id)
    const result = await checkAccount(a)
    res.json(result)
  })

  /**
   * V13.3-T8 + V14: GET /api/accounts/:id/locations
   * Ritorna dove un account è stato attivato: Local (lastLocalUseAt) + lista VPS.
   * Query `?probeAuth=true` esegue probe SSH parallelo per ogni VPS conosciuto e
   * marca `authOk` per ogni location (utile a TargetSelectorDialog).
   */
  router.get('/:id/locations', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const account = await accountsStore.findById(id)
    if (!account) return res.status(404).json({ error: 'account not found' })
    const probeAuth = req.query.probeAuth === 'true'
    try {
      const vpsHits = await vpsStateStore.vpsUsedByAccount(id)
      const vpsConfig = await vpsConfigStore.getAll()
      const vps = vpsHits.map((hit) => {
        const host = VPS_HOSTS.find((h) => h.id === hit.vpsId)
        const cfg = vpsConfig[hit.vpsId] || {}
        return {
          vpsId: hit.vpsId,
          effectiveLabel: cfg.userLabel || host?.label || hit.vpsId,
          userLabel: cfg.userLabel,
          hardcodedLabel: host?.label,
          ip: host?.ip,
          category: host?.category,
          firstUsedAt: hit.firstUsedAt,
          lastUsedAt: hit.lastUsedAt,
        }
      })

      // V14 — probe auth opzionale per tutti i VPS conosciuti (non solo quelli usati prima)
      let authStates: Record<string, { authOk: boolean; cliInstalled: boolean; online: boolean; error?: string }> = {}
      if (probeAuth && account.cliName) {
        const probes = await Promise.all(
          VPS_HOSTS.map(async (h) => {
            const r = await probeAuthOnVps(h.id, account.cliName!)
            return [h.id, { authOk: r.authOk, cliInstalled: r.cliInstalled, online: r.online, error: r.error }] as const
          })
        )
        authStates = Object.fromEntries(probes)
      }

      res.json({
        accountId: id,
        currentTarget: account.target || null,
        local: {
          everUsed: !!account.lastLocalUseAt,
          lastLocalUseAt: account.lastLocalUseAt || null,
        },
        vps,
        authStates,
        knownVps: VPS_HOSTS.map((h) => ({
          id: h.id,
          ip: h.ip,
          label: vpsConfig[h.id]?.userLabel || h.label,
          category: h.category,
        })),
      })
    } catch (err: any) {
      logger.error(`[accounts] locations(${id}) failed:`, err.message)
      res.status(500).json({ error: err.message })
    }
  })

  /**
   * V14: POST /api/accounts/:id/probe-target
   * Forza un re-check health-target-aware (utile dopo login completato).
   * Body opzionale: { target?: string } per probare un target diverso da quello salvato.
   */
  router.post('/:id/probe-target', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const account = await accountsStore.findById(id)
    if (!account) return res.status(404).json({ error: 'account not found' })
    const targetOverride = typeof req.body?.target === 'string' ? req.body.target : undefined
    const target = targetOverride || account.target
    if (!target) return res.status(400).json({ error: 'no target configured' })

    // Bust caches
    clearHealthCache(id)
    if (target !== 'local' && account.cliName) invalidateAuthProbeCache(target, account.cliName)

    if (target === 'local') {
      const result = await checkAccount(account)
      return res.json(result)
    } else {
      const cliName = account.cliName || 'claude'
      const probe = await probeAuthOnVps(target, cliName, { force: true })
      return res.json({
        accountId: id,
        target,
        cliInstalled: probe.cliInstalled,
        cliVersion: probe.cliVersion,
        authOk: probe.authOk,
        online: probe.online,
        error: probe.error,
        checkedAt: probe.fetchedAt,
      })
    }
  })

  // ===== Accounts CRUD =====
  router.get('/', async (_req, res) => {
    const accounts = await accountsStore.list()
    const active = await accountsStore.getActive()
    res.json({ accounts, activeId: active?.id || null })
  })

  router.get('/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const a = await accountsStore.findById(id)
    if (!a) return res.status(404).json({ error: 'not found' })
    res.json(a)
  })

  router.post('/', async (req, res) => {
    const parsed = AccountSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid payload', details: parsed.error.issues })
    }
    // Validate providerId exists
    if (!providerRegistry.get(parsed.data.providerId)) {
      return res.status(400).json({ error: `unknown providerId: ${parsed.data.providerId}` })
    }
    try {
      const added = await accountsStore.add(parsed.data)
      res.status(201).json(added)
    } catch (err: any) {
      res.status(409).json({ error: err.message || String(err) })
    }
  })

  router.patch('/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const parsed = AccountPatchSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid patch', details: parsed.error.issues })
    }
    if (parsed.data.providerId && !providerRegistry.get(parsed.data.providerId)) {
      return res.status(400).json({ error: `unknown providerId: ${parsed.data.providerId}` })
    }
    try {
      const updated = await accountsStore.update(id, parsed.data)
      res.json(updated)
    } catch (err: any) {
      res.status(404).json({ error: err.message || String(err) })
    }
  })

  router.delete('/:id', async (req, res) => {
    const id = String(req.params.id).replace(/[^a-zA-Z0-9_-]/g, '')
    const ok = await accountsStore.remove(id)
    if (!ok) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true, id })
  })

  return router
}
