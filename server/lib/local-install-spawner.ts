/**
 * Local Install Spawner (V13.1-T5)
 *
 * Apre una finestra CMD indipendente (CREATE_NEW_CONSOLE) per installare CLI
 * + eventualmente eseguire login chain (per mode=plan). L'utente vede install
 * in tempo reale e può interrompere.
 *
 * Pattern: `cmd.exe /c start "Title" cmd.exe /K "chain"`
 * - `/c start` apre nuova window detached
 * - `/K` keep window open after chain completes (user può chiuderla manualmente)
 * - chain: "installCmd && echo OK && loginCmd?"
 *
 * Safety: comando passato solo dal registry (no injection utente).
 */
import { spawn } from 'node:child_process'
import os from 'node:os'
import { logger } from './logger'
import type { Account } from '../../shared/schemas'
import { providerRegistry, resolveInstallCmd, type InstallCmds } from './provider-registry'

const CMD_SAFE_REGEX = /^[a-zA-Z0-9 @/._\-:=]+$/

export interface InstallSpawnResult {
  opened: boolean
  pid?: number
  chain: string
  pm?: string
  error?: string
}

/**
 * Resolve install command for an account based on its mode.
 */
function resolveAccountInstallCmd(account: Account): {
  cliName: string
  installCmds?: InstallCmds
  loginCmd?: string
} | null {
  const provider = providerRegistry.get(account.providerId)
  if (!provider) return null

  switch (account.mode) {
    case 'plan': {
      const cfg = provider.modeDefaults.plan
      if (!cfg) return null
      return {
        cliName: cfg.cliName,
        installCmds: cfg.installCmds,
        loginCmd: cfg.loginCmd,
      }
    }
    case 'api': {
      const cfg = provider.modeDefaults.api
      if (!cfg) return null
      return {
        cliName: cfg.cliWrapper || provider.modeDefaults.cli?.cliName || 'unknown',
        installCmds: cfg.installCmds,
      }
    }
    case 'cli': {
      const cfg = provider.modeDefaults.cli
      if (!cfg) return null
      return {
        cliName: cfg.cliName,
        installCmds: cfg.installCmds,
        loginCmd: cfg.loginCmd,
      }
    }
    default:
      return null
  }
}

/**
 * Open a CMD window with install + optional login chain.
 * Returns immediately — user watches install in new window.
 */
export function openInstallConsole(account: Account): InstallSpawnResult {
  if (os.platform() !== 'win32') {
    return {
      opened: false,
      chain: '',
      error: 'Local install spawner is Windows-only for V13.1',
    }
  }

  const resolved = resolveAccountInstallCmd(account)
  if (!resolved) {
    return {
      opened: false,
      chain: '',
      error: `No install config for ${account.providerId}/${account.mode}`,
    }
  }

  const installInfo = resolveInstallCmd(resolved.installCmds)
  if (!installInfo) {
    return {
      opened: false,
      chain: '',
      error: `No install command for win32 in ${account.providerId}/${account.mode}`,
    }
  }

  // Validate install command whitelist
  if (!CMD_SAFE_REGEX.test(installInfo.cmd)) {
    return {
      opened: false,
      chain: '',
      error: `Install command failed safety regex: ${installInfo.cmd}`,
    }
  }

  // Build chain: installCmd && echo OK && (loginCmd if plan mode)
  const loginPart =
    account.mode === 'plan' && resolved.loginCmd && CMD_SAFE_REGEX.test(resolved.loginCmd)
      ? `&& ${resolved.loginCmd}`
      : ''
  const chain = `${installInfo.cmd} && echo. && echo ============ && echo SAIO: Install completato ${loginPart ? '- ora eseguo login' : ''} && echo ============ ${loginPart}`

  // Escape quotes for CMD
  const title = `SAIO Install ${resolved.cliName}`

  try {
    // spawn cmd.exe /c start "title" cmd.exe /K "chain"
    const child = spawn(
      'cmd.exe',
      ['/c', 'start', title, 'cmd.exe', '/K', chain],
      {
        detached: true,
        shell: false,
        stdio: 'ignore',
        windowsHide: false,
      }
    )
    child.unref()

    logger.info(`[local-install] opened CMD for ${account.id}: ${resolved.cliName} via ${installInfo.pm}`)
    return {
      opened: true,
      pid: child.pid,
      chain,
      pm: installInfo.pm,
    }
  } catch (err: any) {
    logger.error(`[local-install] spawn failed:`, err)
    return {
      opened: false,
      chain,
      error: err.message || String(err),
    }
  }
}
