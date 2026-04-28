import { Router } from 'express'
import { ptyManager, hasClaudeHistory, lastSessionInfo } from '../lib/pty-manager'
import { vpsStateStore, KNOWN_CLIS } from '../lib/vps-state-store'
import { VPS_HOSTS } from '../lib/ssh-inventory'
import { logger } from '../lib/logger'

export function ptyRouter() {
  const router = Router()

  router.get('/sessions', (_req, res) => {
    res.json({ sessions: ptyManager.list() })
  })

  // Persistence info per progetto: last session, can resume, active
  router.get('/:projectId/info', (req, res) => {
    const id = req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) return res.status(400).json({ error: 'invalid id' })
    const cwd = ptyManager.workspaceDirFor(id)
    const canResume = hasClaudeHistory(cwd)
    const lastInfo = lastSessionInfo(cwd)
    const active = !!ptyManager.get(id)
    res.json({
      projectId: id,
      workspace: cwd,
      active,
      canResume,
      lastSession: lastInfo,
    })
  })

  router.delete('/:projectId', (req, res) => {
    const id = req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) return res.status(400).json({ error: 'invalid id' })
    const killed = ptyManager.kill(id)
    res.json({ ok: killed })
  })

  // V15.0 WS23 — GET /:projectId/buffer — ritorna ultimi 8KB del buffer PTY
  // Usato da DecisionInbox bottone "Vedi log" per mostrare contesto raw della
  // sessione prima che l'utente decida la scelta.
  router.get('/:projectId/buffer', (req, res) => {
    const id = req.params.projectId.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) return res.status(400).json({ error: 'invalid id' })
    const session = ptyManager.get(id)
    if (!session) {
      return res.status(404).json({ error: 'session_not_found', message: 'PTY session non attiva o terminata' })
    }
    const fullBuf = session.buffer.join('')
    res.json({
      projectId: id,
      buffer: fullBuf.slice(-8000),
      bufferSize: fullBuf.length,
      pid: session.proc?.pid,
    })
  })

  // ========================================================
  // V13-T1.4: Remote VPS endpoints
  // ========================================================

  /**
   * GET /api/pty/remote/:vpsId/probe
   * Probe which CLIs are installed on the VPS (fresh or cached).
   * Query: ?force=true to force re-probe (ignore 24h cache).
   */
  router.get('/remote/:vpsId/probe', async (req, res) => {
    const vpsId = String(req.params.vpsId).replace(/[^a-zA-Z0-9_-]/g, '')
    const vps = VPS_HOSTS.find((v) => v.id === vpsId)
    if (!vps) return res.status(404).json({ error: 'unknown vpsId' })

    try {
      const force = req.query.force === 'true'
      const state = force
        ? await vpsStateStore.probe(vps)
        : await vpsStateStore.ensureFresh(vps)
      res.json(state)
    } catch (err: any) {
      logger.error(`[pty/remote] probe ${vpsId} failed:`, err)
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  /**
   * GET /api/pty/remote/:vpsId/state — return cached state without probing
   */
  router.get('/remote/:vpsId/state', async (req, res) => {
    const vpsId = String(req.params.vpsId).replace(/[^a-zA-Z0-9_-]/g, '')
    const vps = VPS_HOSTS.find((v) => v.id === vpsId)
    if (!vps) return res.status(404).json({ error: 'unknown vpsId' })
    const state = await vpsStateStore.load(vpsId)
    res.json(state)
  })

  /**
   * POST /api/pty/remote/:vpsId/install
   * Body: { cli: string }
   * Install a CLI on the VPS (run install command via ssh).
   */
  router.post('/remote/:vpsId/install', async (req, res) => {
    const vpsId = String(req.params.vpsId).replace(/[^a-zA-Z0-9_-]/g, '')
    const vps = VPS_HOSTS.find((v) => v.id === vpsId)
    if (!vps) return res.status(404).json({ error: 'unknown vpsId' })

    const cli = String(req.body?.cli || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
    if (!cli) return res.status(400).json({ error: 'missing cli' })
    if (!KNOWN_CLIS.includes(cli as any)) {
      return res.status(400).json({ error: `unsupported cli: ${cli}`, supported: KNOWN_CLIS })
    }

    try {
      const ok = await vpsStateStore.installCli(vps, cli)
      const state = await vpsStateStore.load(vpsId)
      res.json({ ok, vpsId, cli, state })
    } catch (err: any) {
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  /**
   * POST /api/pty/remote/:vpsId/:projectId/spawn
   * Body: { cli: string, model?: string, permissionMode?: string }
   * Opens a PTY session wrapped in ssh to the VPS with the given CLI.
   * Runs daily update if first spawn of the day.
   * Auto-installs CLI if not present (optional via query ?autoInstall=true, default false).
   */
  router.post('/remote/:vpsId/:projectId/spawn', async (req, res) => {
    const vpsId = String(req.params.vpsId).replace(/[^a-zA-Z0-9_-]/g, '')
    const projectId = String(req.params.projectId).replace(/[^a-zA-Z0-9_-]/g, '')
    if (!vpsId || !projectId) return res.status(400).json({ error: 'invalid ids' })

    const vps = VPS_HOSTS.find((v) => v.id === vpsId)
    if (!vps) return res.status(404).json({ error: 'unknown vpsId' })

    const cli = String(req.body?.cli || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
    if (!cli) return res.status(400).json({ error: 'missing cli' })
    if (!KNOWN_CLIS.includes(cli as any)) {
      return res.status(400).json({ error: `unsupported cli: ${cli}`, supported: KNOWN_CLIS })
    }

    // V13.1 T7: autoInstall default=true (invert previous default)
    const autoInstall = req.query.autoInstall !== 'false'
    const model = typeof req.body?.model === 'string' ? req.body.model : undefined
    const permissionMode =
      typeof req.body?.permissionMode === 'string' ? req.body.permissionMode : undefined

    try {
      // Step 1: ensure state is fresh
      const state = await vpsStateStore.ensureFresh(vps)
      const cliStatus = state.clis[cli]

      // Step 2: if CLI not installed, auto-install (default ON)
      if (!cliStatus?.installed) {
        if (!autoInstall) {
          return res.status(409).json({
            error: 'cli_not_installed',
            cli,
            message: `${cli} not installed on ${vpsId}. Retry with ?autoInstall=true to install first.`,
          })
        }
        logger.info(`[pty/remote] ${vpsId}: auto-installing ${cli}`)
        const installed = await vpsStateStore.installCli(vps, cli)
        if (!installed) {
          const refresh = await vpsStateStore.load(vpsId)
          return res.status(500).json({
            error: 'install_failed',
            cli,
            installError: refresh.clis[cli]?.installError,
          })
        }
      }

      // Step 3: V13.1 T7 — weekly update check (was daily)
      let weeklyUpdateResult: any = null
      if (await vpsStateStore.isFirstRunThisWeek(vpsId)) {
        logger.info(`[pty/remote] ${vpsId}: weekly update check triggered for ${cli}`)
        weeklyUpdateResult = await vpsStateStore.runDailyUpdate(vps, [cli])
        await vpsStateStore.markFirstRunToday(vpsId)
      }
      const dailyUpdateResult = weeklyUpdateResult // preserve backward compat response field

      // Step 4: spawn PTY via ssh wrapper
      const session = await ptyManager.getOrCreate(projectId, {
        remote: { vpsId, cliName: cli },
        model,
        permissionMode: permissionMode as any,
      })
      if ('error' in session) {
        return res.status(500).json({ error: session.error })
      }

      res.json({
        ok: true,
        projectId,
        vpsId,
        cli,
        pid: session.proc.pid,
        dailyUpdate: dailyUpdateResult,
        state: await vpsStateStore.load(vpsId),
      })
    } catch (err: any) {
      logger.error(`[pty/remote] spawn failed:`, err)
      res.status(500).json({ error: err.message || String(err) })
    }
  })

  return router
}
