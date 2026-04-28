import { Router } from 'express'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { VPS_HOSTS, addVpsHost, removeVpsHost, validateVpsInput, getVpsById, type VpsHost } from '../lib/ssh-inventory'
import { probeVps } from '../lib/ssh-probe'
import { logger } from '../lib/logger'
import { vpsConfigStore } from '../lib/vps-config-store'
import { vpsStateStore } from '../lib/vps-state-store'
import { generateSshKeyPair, testSshConnection } from '../lib/ssh-keygen'

export function vpsRouter() {
  const router = Router()

  router.get('/list', async (_req, res) => {
    res.json({ hosts: VPS_HOSTS })
  })

  /**
   * V13.3-T8: GET /api/vps — lista VPS con userLabel + usedByAccounts resolved.
   * Unisce VPS_HOSTS (hardcoded whitelist) + vps-config.json (user labels) + vps-state (tracking).
   */
  router.get('/', async (_req, res) => {
    try {
      const cfg = await vpsConfigStore.getAll()
      const enriched = await Promise.all(VPS_HOSTS.map(async (host) => {
        const userCfg = cfg[host.id] || {}
        const state = await vpsStateStore.load(host.id)
        return {
          ...host,
          // Label effettiva: userLabel se presente, altrimenti label hardcoded
          effectiveLabel: userCfg.userLabel || host.label,
          userLabel: userCfg.userLabel,
          userNotes: userCfg.notes,
          userUpdatedAt: userCfg.updatedAt,
          usedByAccounts: state.usedByAccounts || [],
          accountUsage: state.accountUsage || {},
          probedAt: state.probedAt,
        }
      }))
      res.json({ vps: enriched })
    } catch (err: any) {
      logger.error('[vps] list resolved failed:', err)
      res.status(500).json({ error: err.message })
    }
  })

  /**
   * V13.3-T8: PATCH /api/vps/:id — update userLabel + notes.
   * Body: { userLabel?: string | null, notes?: string | null }
   */
  router.patch('/:id', async (req, res) => {
    try {
      const id = req.params.id
      const host = VPS_HOSTS.find((h) => h.id === id)
      if (!host) return res.status(404).json({ error: 'VPS not found' })

      const { userLabel, notes } = req.body || {}
      if (userLabel !== undefined) {
        if (userLabel !== null && typeof userLabel !== 'string') {
          return res.status(400).json({ error: 'userLabel must be string or null' })
        }
        await vpsConfigStore.setLabel(id, userLabel)
      }
      if (notes !== undefined) {
        if (notes !== null && typeof notes !== 'string') {
          return res.status(400).json({ error: 'notes must be string or null' })
        }
        await vpsConfigStore.setNotes(id, notes)
      }

      const cfg = await vpsConfigStore.get(id) || {}
      res.json({
        ok: true,
        vpsId: id,
        userLabel: cfg.userLabel,
        notes: cfg.notes,
        effectiveLabel: cfg.userLabel || host.label,
      })
    } catch (err: any) {
      logger.warn(`[vps] PATCH ${req.params.id} failed: ${err.message}`)
      res.status(400).json({ error: err.message })
    }
  })

  router.get('/:id/stats', async (req, res) => {
    const host = VPS_HOSTS.find((h) => h.id === req.params.id)
    if (!host) return res.status(404).json({ error: 'VPS not found' })
    const stats = await probeVps(host.id, host.ip)
    const userCfg = (await vpsConfigStore.get(host.id)) || {}
    res.json({
      ...stats,
      label: host.label,
      effectiveLabel: userCfg.userLabel || host.label,
      userLabel: userCfg.userLabel,
      hostname: host.hostname,
      category: host.category,
    })
  })

  router.post('/:id/open-cmd', async (req, res) => {
    const host = VPS_HOSTS.find((h) => h.id === req.params.id)
    if (!host) return res.status(404).json({ error: 'VPS not found' })
    try {
      // V15.9 WS39: cross-platform via PAL (Win cmd.exe /k start, Unix open Terminal)
      const { getPlatform } = await import('../lib/platform')
      const pal = getPlatform()
      const title = `SSH-${host.id}`
      const keyPath = path.join(pal.paths.sshDir(), host.keyName)
      const sshCmd = `ssh -i "${keyPath}" root@${host.ip}`

      let child: ReturnType<typeof spawn>
      if (pal.platform === 'win32') {
        const args = ['/c', 'start', `"${title}"`, 'cmd.exe', '/k', sshCmd]
        child = spawn('cmd.exe', args, { shell: false, detached: true, stdio: 'ignore', windowsHide: false })
      } else if (pal.platform === 'darwin') {
        // macOS: open new Terminal window with SSH command
        const script = `tell application "Terminal" to do script "${sshCmd.replace(/"/g, '\\"')}"`
        child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' })
      } else {
        // Linux: try common terminal emulators
        const terms = [
          ['gnome-terminal', ['--', 'bash', '-c', `${sshCmd}; exec bash`]],
          ['konsole', ['--', 'bash', '-c', `${sshCmd}; exec bash`]],
          ['xterm', ['-e', `${sshCmd}; exec bash`]],
        ] as const
        let ok = false
        let lastErr: Error | null = null
        for (const [term, args] of terms) {
          try {
            child = spawn(term, [...args], { detached: true, stdio: 'ignore' })
            child.unref()
            ok = true
            break
          } catch (err: unknown) {
            lastErr = err as Error
          }
        }
        if (!ok) throw lastErr || new Error('No terminal emulator found (gnome-terminal/konsole/xterm)')
        return res.json({ ok: true, title })
      }
      child.unref()
      res.json({ ok: true, pid: child.pid, title })
    } catch (err: unknown) {
      const e = err as Error
      logger.error('VPS open-cmd failed:', e)
      res.status(500).json({ error: e.message })
    }
  })

  /**
   * V14.28 — POST /api/vps — registra una nuova VPS nel registry.
   * Body: { id, ip, label, keyName, category?, notes?, hostname? }
   */
  router.post('/', async (req, res) => {
    try {
      const body = req.body || {}
      const host: VpsHost = {
        id: String(body.id || '').trim(),
        ip: String(body.ip || '').trim(),
        label: String(body.label || '').trim(),
        keyName: String(body.keyName || '').trim(),
        category: body.category || 'unknown',
        hostname: body.hostname ? String(body.hostname).trim() : undefined,
        notes: body.notes ? String(body.notes).trim() : undefined,
      }
      const err = validateVpsInput(host)
      if (err) return res.status(400).json({ error: err })

      const created = await addVpsHost(host)
      res.status(201).json({ ok: true, vps: created })
    } catch (err: any) {
      logger.warn(`[vps] POST failed: ${err.message}`)
      res.status(409).json({ error: err.message })
    }
  })

  /**
   * V14.28 — DELETE /api/vps/:id — rimuove VPS dal registry.
   * NON cancella server reale né chiavi SSH (queste vanno gestite separatamente).
   * Cleanup vps-config + vps-state best-effort.
   */
  router.delete('/:id', async (req, res) => {
    try {
      const id = String(req.params.id)
      const host = getVpsById(id)
      if (!host) return res.status(404).json({ error: 'VPS not found' })

      await removeVpsHost(id)
      // Cleanup config + state best-effort (non blocca su errore)
      try { await vpsConfigStore.setLabel(id, null) } catch { /* ignore */ }
      try { await vpsConfigStore.setNotes(id, null) } catch { /* ignore */ }
      res.json({ ok: true, removed: id })
    } catch (err: any) {
      logger.warn(`[vps] DELETE ${req.params.id} failed: ${err.message}`)
      res.status(400).json({ error: err.message })
    }
  })

  /**
   * V14.28 — POST /api/vps/ssh-keygen — genera coppia chiave ed25519.
   * Body: { keyName, vpsId?, comment?, email? }
   * Output: { publicKey, publicKeyPath, privateKeyPath, comment }
   */
  router.post('/ssh-keygen', async (req, res) => {
    try {
      const { keyName, vpsId, comment, email } = req.body || {}
      if (!keyName || typeof keyName !== 'string') {
        return res.status(400).json({ error: 'keyName required' })
      }
      const result = await generateSshKeyPair({ keyName, vpsId, comment, email })
      res.json({
        ok: true,
        publicKey: result.publicKeyContent,
        publicKeyPath: result.publicKeyPath,
        privateKeyPath: result.privateKeyPath,
        comment: result.comment,
        algorithm: result.algorithm,
      })
    } catch (err: any) {
      logger.warn(`[vps] ssh-keygen failed: ${err.message}`)
      res.status(400).json({ error: err.message })
    }
  })

  /**
   * V14.28 Step 1 — GET public key di una VPS (per UI hint "autorizza chiave").
   * Legge ~/.ssh/<keyName>.pub. Mai privata. Path validato via getVpsById.
   */
  router.get('/:id/public-key', async (req, res) => {
    try {
      const id = String(req.params.id)
      const host = getVpsById(id)
      if (!host) return res.status(404).json({ error: 'VPS not found' })
      const pubPath = path.join(os.homedir(), '.ssh', `${host.keyName}.pub`)
      const content = await fs.readFile(pubPath, 'utf-8').catch((err) => {
        if (err.code === 'ENOENT') {
          throw new Error(`Chiave pubblica non trovata: ${pubPath}`)
        }
        throw err
      })
      res.json({
        publicKey: content.trim(),
        publicKeyPath: pubPath,
        keyName: host.keyName,
        ip: host.ip,
      })
    } catch (err: any) {
      res.status(404).json({
        error: err.message,
        hint: 'Verifica che la chiave SSH sia stata generata via wizard "Aggiungi VPS" o che il file .pub esista in ~/.ssh/',
      })
    }
  })

  /**
   * V14.28 — POST /api/vps/test — test SSH connection (no save).
   * Body: { ip, user, keyName, timeoutSec? }
   */
  router.post('/test', async (req, res) => {
    try {
      const { ip, user, keyName, timeoutSec } = req.body || {}
      if (!ip || !user || !keyName) {
        return res.status(400).json({ error: 'ip, user, keyName required' })
      }
      const result = await testSshConnection({ ip, user, keyName, timeoutSec })
      res.json(result)
    } catch (err: any) {
      logger.warn(`[vps] test failed: ${err.message}`)
      res.status(400).json({ error: err.message })
    }
  })

  return router
}
