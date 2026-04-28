/**
 * Resolve spawn account info for orchestrator Python script (V13.1 BUG1a fix).
 *
 * Dato projectId (o account esplicito), restituisce cliName/cliArgs/envOverrides
 * da passare al Python spawner via stdin JSON.
 *
 * Resolution chain:
 *  1. projectOverride (project.accountOverride/modelOverride)
 *  2. activeAccount globale
 *  3. fallback claude (CLI default)
 */
import { accountsStore } from './accounts-store'
import { projectsStore } from './projects-store'
import { providerRegistry } from './provider-registry'
import { resolveAccountEnv, buildCliArgsForAccount } from './pty-manager'
import { logger } from './logger'

export interface SpawnAccountResolved {
  accountId: string | null
  cliName: string
  cliArgs: string[]
  envOverrides: Record<string, string>
  model: string | null
}

export async function resolveSpawnAccount(
  projectId: string
): Promise<SpawnAccountResolved> {
  // Step 1: project override
  let accountId: string | null = null
  let modelOverride: string | null = null
  try {
    const project = await projectsStore.findById(projectId)
    if (project?.accountOverride) accountId = project.accountOverride
    if (project?.modelOverride) modelOverride = project.modelOverride
  } catch {
    /* no project → fallthrough */
  }

  // Step 2: active global (if no override)
  if (!accountId) {
    const active = await accountsStore.getActive()
    if (active) accountId = active.id
  }

  // Step 3: resolve or fallback
  if (!accountId) {
    logger.info(`[resolve-spawn] ${projectId}: no account → fallback claude CLI`)
    return { accountId: null, cliName: 'claude', cliArgs: [], envOverrides: {}, model: null }
  }

  const account = await accountsStore.findById(accountId)
  if (!account) {
    logger.warn(`[resolve-spawn] ${projectId}: accountId ${accountId} missing → fallback claude`)
    return { accountId: null, cliName: 'claude', cliArgs: [], envOverrides: {}, model: null }
  }

  const provider = providerRegistry.get(account.providerId)
  if (!provider) {
    logger.warn(`[resolve-spawn] ${projectId}: provider ${account.providerId} missing → fallback claude`)
    return { accountId, cliName: 'claude', cliArgs: [], envOverrides: {}, model: account.defaultModel || null }
  }

  // Determine CLI binary for mode
  let cliName: string
  switch (account.mode) {
    case 'plan':
      cliName = account.cliName || provider.modeDefaults.plan?.cliName || 'claude'
      break
    case 'api':
      cliName = account.cliName || provider.modeDefaults.api?.cliWrapper || provider.modeDefaults.cli?.cliName || 'claude'
      break
    case 'cli':
      cliName = account.cliName || provider.modeDefaults.cli?.cliName || 'claude'
      break
    case 'playwright':
      // Playwright not supported in external CMD spawn — fallback to claude
      logger.warn(`[resolve-spawn] ${projectId}: playwright mode not supported for external CMD spawn, using claude`)
      return {
        accountId,
        cliName: 'claude',
        cliArgs: [],
        envOverrides: await resolveAccountEnv(account),
        model: modelOverride || account.defaultModel || null,
      }
    default:
      cliName = 'claude'
  }

  const model = modelOverride || account.defaultModel
  const cliArgs = [
    ...(account.cliArgs || []),
    ...buildCliArgsForAccount(cliName, { model: model ?? undefined }),
  ]
  const envOverrides = await resolveAccountEnv(account)

  logger.info(
    `[resolve-spawn] ${projectId}: account=${accountId} cli=${cliName} args=[${cliArgs.join(' ')}] env=[${Object.keys(envOverrides).join(',')}]`
  )

  return {
    accountId,
    cliName,
    cliArgs,
    envOverrides,
    model: model || null,
  }
}
