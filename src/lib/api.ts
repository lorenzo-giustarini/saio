import type { Brief, Response as ResponsePayload, TaskStatus, Project, Decision, Account } from './types'

const BASE = '/api'

async function request<T>(path: string, init?: RequestInit, isRetry = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include', // V15.0 WS3 — auth cookies httpOnly
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })

  // V15.0 WS3-3C — 401 silent refresh logic
  // Skip su /auth/* (loop), su retry (già provato), o su 410 (already_claimed)
  if (
    res.status === 401 &&
    !isRetry &&
    !path.startsWith('/auth/refresh') &&
    !path.startsWith('/auth/me') &&
    !path.startsWith('/auth/logout') &&
    !path.startsWith('/auth/claim')
  ) {
    try {
      const refreshRes = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      })
      if (refreshRes.ok) {
        return request<T>(path, init, true)
      }
    } catch {
      /* fall through */
    }
    // Refresh fallito → redirect login (esclude se siamo già su /claim o /login)
    if (!['/login', '/claim', '/magic-sent', '/enroll-totp', '/verify-totp'].some((p) => window.location.pathname.startsWith(p))) {
      window.location.href = '/login'
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${res.status}: ${text || res.statusText}`)
  }
  return res.json()
}

export const api = {
  briefs: {
    list: (opts?: { pending?: boolean; projectId?: string }) => {
      const params = new URLSearchParams()
      if (opts?.pending) params.set('pending', 'true')
      if (opts?.projectId) params.set('projectId', opts.projectId)
      const qs = params.toString()
      return request<{ briefs: Brief[]; count: number }>(`/briefs${qs ? `?${qs}` : ''}`)
    },
    get: (id: string) => request<Brief>(`/briefs/${encodeURIComponent(id)}`),
    postInSessionDecision: (payload: {
      projectId: string
      sessionId?: string
      decision: Omit<Decision, 'id'> & { id?: string }
    }) =>
      request<{ ok: boolean; briefId: string; decisionId: string; path: string }>(
        '/briefs/decision',
        { method: 'POST', body: JSON.stringify(payload) }
      ),
    // V13.1 T9: zombie cleanup
    cleanupZombies: (olderThanDays = 7) =>
      request<{ ok: boolean; olderThanDays: number; scanned: number; archived: number; briefIds: string[] }>(
        '/briefs/cleanup-zombies',
        { method: 'POST', body: JSON.stringify({ olderThanDays }) }
      ),
    resolve: (
      id: string,
      payload?: {
        resolvedVia?: 'chat' | 'manual' | 'external'
        resolution?: string
        resolvedBy?: 'user' | 'claude'
      }
    ) =>
      request<{
        ok: boolean
        briefId: string
        archivedTo: string
        sidecar: string
        resolvedVia: string
      }>(`/briefs/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }),
  },
  responses: {
    submit: (payload: ResponsePayload) =>
      request<{ ok: boolean; savedTo: string; markdownTo: string; orchestrator: unknown }>(
        '/responses',
        { method: 'POST', body: JSON.stringify(payload) }
      ),
  },
  // V14.1: orchestrator endpoints
  orchestrator: {
    /** Killa la finestra cmd.exe esterna spawnata da spawn_single.py per il progetto */
    killExternal: (projectId: string) =>
      request<{
        ok: boolean
        killedPid?: number
        projectId: string
        reason?: string
        stdout?: string
        stderr?: string
      }>(`/orchestrator/kill/${encodeURIComponent(projectId)}`, { method: 'DELETE' }),
  },
  tasks: {
    list: () => request<{ tasks: TaskStatus[] }>('/tasks'),
    get: (id: string) => request<TaskStatus>(`/tasks/${encodeURIComponent(id)}`),
    sendCommand: (id: string, type: 'pause' | 'resume' | 'kill') =>
      request<{ ok: boolean; commandId: string }>(`/tasks/${encodeURIComponent(id)}/command`, {
        method: 'POST',
        body: JSON.stringify({ type }),
      }),
    complete: (id: string, note?: string) =>
      request<{ ok: boolean; completedAt: string; markerFile: string }>(
        `/tasks/${encodeURIComponent(id)}/complete`,
        { method: 'POST', body: JSON.stringify({ note }) }
      ),
  },
  projects: {
    list: () => request<{ projects: Project[] }>('/projects'),
    get: (id: string) =>
      request<
        Project & {
          github?: string
          vercel?: string
          vps?: string
          mocPath?: string
          kickoffTemplate?: string
        }
      >(`/projects/${encodeURIComponent(id)}`),
    archive: (id: string) =>
      request<Project>(`/projects/${encodeURIComponent(id)}/archive`, { method: 'POST' }),
    restore: (id: string) =>
      request<Project>(`/projects/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
    move: (id: string, folder: string | undefined) =>
      request<Project>(`/projects/${encodeURIComponent(id)}/move`, {
        method: 'POST',
        body: JSON.stringify({ folder }),
      }),
    patch: (id: string, patch: Partial<Project>) =>
      request<Project>(`/projects/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    /** V14.8 — Hard delete: progetto archiviato + tutti i file correlati. Body { confirm: 'DELETE' } */
    deleteHard: (id: string) =>
      request<{
        ok: boolean
        id: string
        removedFromStore: boolean
        deletedFiles: string[]
        errors: string[]
      }>(`/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        body: JSON.stringify({ confirm: 'DELETE' }),
      }),
  },
  archive: {
    list: () =>
      request<{ entries: Array<{ filename: string; path: string; date: string; size: number }> }>(
        '/archive'
      ),
    // V14.23 — delete singolo entry
    deleteItem: (path: string) =>
      request<{ ok: boolean; deleted: string }>('/archive/item', {
        method: 'DELETE',
        body: JSON.stringify({ path }),
      }),
    // V14.23 — clear all (richiede confirm DELETE-ALL)
    clearAll: () =>
      request<{ ok: boolean; deletedCount: number; deleted: string[]; errors: string[] }>(
        '/archive/clear',
        { method: 'POST', body: JSON.stringify({ confirm: 'DELETE-ALL' }) }
      ),
  },
  metrics: {
    tokens: () =>
      request<{ series: Array<{ date: string; tokens: number }>; updatedAt: string }>(
        '/metrics/tokens'
      ),
    tokensDetailed: () =>
      request<{
        series: Array<{
          date: string
          byModel: Record<string, {
            input: number
            output: number
            cache_read: number
            cache_5m: number
            cache_1h: number
            messages: number
            costUSD: number
            hasPricing: boolean
          }>
          total: {
            input: number
            output: number
            cache_read: number
            cache_5m: number
            cache_1h: number
            messages: number
            costUSD: number
          }
        }>
        modelsSeen: string[]
        pricingDb: number
        totalCostUSD: number
        updatedAt: string
        disclaimer: string
      }>('/metrics/tokens/detailed'),
    feedback: () => request<{ items: Array<{ id: string; ts: string; text: string; tags: string[] }> }>('/metrics/feedback'),
    feedbackAdd: (text: string) =>
      request<{ ok: boolean; id: string; ts: string }>('/metrics/feedback', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    // V14.19 — feedback AI 2-step processing
    feedbackPendingCount: () =>
      request<{ pending: number; total: number }>('/metrics/feedback/pending-count'),
    feedbackProcess: (cliBinary?: string) =>
      request<{ jobId: string; queued: boolean }>('/metrics/feedback/process-all', {
        method: 'POST',
        body: JSON.stringify(cliBinary ? { cliBinary } : {}),
      }),
    feedbackProcessStatus: () =>
      request<{
        jobId?: string
        status: 'idle' | 'queued' | 'running' | 'done' | 'error'
        startedAt?: string
        finishedAt?: string
        total?: number
        processed?: number
        errors?: number
        briefPath?: string
        errorMessage?: string
      }>('/metrics/feedback/process-status'),
    vaultHealth: () =>
      request<{ score: number; brokenLinks: number; staleNotes: number; orphans: number }>(
        '/metrics/vault-health'
      ),
  },
  mcp: {
    status: () =>
      request<{
        mcps: Array<{ name: string; status: string; latencyMs?: number; lastCheck: string }>
        checkedAt: string
      }>('/mcp/status'),
  },
  health: () =>
    request<{ status: string; ts: string; version: string; dataDir: string }>('/health'),

  // V13: Accounts + Providers
  accounts: {
    list: () => request<{ accounts: Account[]; activeId: string | null }>('/accounts'),
    get: (id: string) => request<Account>(`/accounts/${encodeURIComponent(id)}`),
    getActive: () => request<{ active: Account | null }>('/accounts/active'),
    select: (id: string | null) =>
      request<{ ok: boolean; active: Account | null }>('/accounts/select', {
        method: 'POST',
        body: JSON.stringify({ id }),
      }),
    create: (account: Account) =>
      request<Account>('/accounts', { method: 'POST', body: JSON.stringify(account) }),
    update: (id: string, patch: Partial<Account>) =>
      request<Account>(`/accounts/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    remove: (id: string) =>
      request<{ ok: boolean; id: string }>(`/accounts/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
    health: (id: string, refresh = false) =>
      request<any>(`/accounts/${encodeURIComponent(id)}/health${refresh ? '?refresh=true' : ''}`),
    healthAll: () =>
      request<{ results: any[]; count: number }>('/accounts/health/all'),
    autodetect: () =>
      request<{ proposals: any[]; count: number }>('/accounts/autodetect'),
    autodetectApply: (proposals: any[]) =>
      request<{ ok: boolean; added: Account[]; count: number }>(
        '/accounts/autodetect/apply',
        { method: 'POST', body: JSON.stringify({ proposals }) }
      ),
    // V13.1 T2 secrets
    setSecret: (id: string, value: string) =>
      request<{ ok: boolean; envVarRef: string }>(
        `/accounts/${encodeURIComponent(id)}/set-secret`,
        { method: 'POST', body: JSON.stringify({ value }) }
      ),
    hasSecret: (id: string) =>
      request<{ present: boolean; envVarRef: string; reason?: string }>(
        `/accounts/${encodeURIComponent(id)}/has-secret`
      ),
    unsetSecret: (id: string) =>
      request<{ ok: boolean }>(`/accounts/${encodeURIComponent(id)}/secret`, {
        method: 'DELETE',
      }),
    // V13.1 T5 install
    install: (id: string) =>
      request<{ opened: boolean; pid?: number; chain: string }>(
        `/accounts/${encodeURIComponent(id)}/install`,
        { method: 'POST' }
      ),
    // V13.3-T8 + V14: locations tracking + auth states + currentTarget
    locations: (id: string, opts: { probeAuth?: boolean } = {}) =>
      request<{
        accountId: string
        currentTarget: string | null
        local: { everUsed: boolean; lastLocalUseAt: string | null }
        vps: Array<{
          vpsId: string
          effectiveLabel: string
          userLabel?: string
          hardcodedLabel?: string
          ip?: string
          category?: string
          firstUsedAt?: string
          lastUsedAt?: string
        }>
        authStates: Record<string, { authOk: boolean; cliInstalled: boolean; online: boolean; error?: string }>
        knownVps: Array<{ id: string; ip: string; label: string; category: string }>
      }>(`/accounts/${encodeURIComponent(id)}/locations${opts.probeAuth ? '?probeAuth=true' : ''}`),
    // V14: forza re-probe del target (post-login)
    probeTarget: (id: string, target?: string) =>
      request<{
        accountId: string
        target: string
        cliInstalled?: boolean
        cliVersion?: string
        authOk?: boolean
        online?: boolean
        error?: string
        checkedAt?: string
        // Local-mode response shape (HealthResult)
        health?: string
        message?: string
      }>(`/accounts/${encodeURIComponent(id)}/probe-target`, {
        method: 'POST',
        body: JSON.stringify(target ? { target } : {}),
      }),
  },
  // V13.3-T8: VPS user-editable labels
  vps: {
    listResolved: () =>
      request<{
        vps: Array<{
          id: string
          ip: string
          hostname?: string
          label: string
          effectiveLabel: string
          userLabel?: string
          userNotes?: string
          userUpdatedAt?: string
          category: string
          keyName: string
          usedByAccounts: string[]
          accountUsage?: Record<string, { firstUsedAt: string; lastUsedAt: string }>
          probedAt: string | null
        }>
      }>('/vps'),
    patch: (id: string, body: { userLabel?: string | null; notes?: string | null }) =>
      request<{
        ok: boolean
        vpsId: string
        userLabel?: string
        notes?: string
        effectiveLabel: string
      }>(`/vps/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },
  providers: {
    list: () => request<{ providers: any[] }>('/accounts/providers'),
    get: (id: string) => request<any>(`/accounts/providers/${encodeURIComponent(id)}`),
  },
  taskTypes: {
    list: () => request<{ taskTypes: any[] }>('/task-types'),
    get: (id: string) => request<any>(`/task-types/${encodeURIComponent(id)}`),
    create: (payload: any) =>
      request<any>('/task-types', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, patch: any) =>
      request<any>(`/task-types/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    remove: (id: string) =>
      request<any>(`/task-types/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    scanSkills: () =>
      request<{ ok: boolean; scanned: number; added: number; newTypes: any[] }>(
        '/task-types/scan-skills',
        { method: 'POST' }
      ),
  },

  // V15.0 WS3 — Auth endpoints (single-owner self-hosted)
  auth: {
    setupStatus: () =>
      request<{ configured: boolean; provider: 'smtp' | 'resend' | 'debug' | null; claimed: boolean }>(
        '/auth/setup-status'
      ),
    setupEmail: (
      payload:
        | {
            provider: 'smtp'
            smtpHost: string
            smtpPort: number
            smtpUser: string
            smtpPass: string
            fromEmail: string
          }
        | { provider: 'resend'; resendApiKey: string; fromEmail: string }
        | { provider: 'debug' }
    ) =>
      request<{ ok: boolean; configured: boolean; provider: string }>('/auth/setup-email', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    validateSmtp: (payload: {
      smtpHost: string
      smtpPort: number
      smtpUser: string
      smtpPass: string
    }) =>
      request<{ valid: boolean; error?: string }>('/auth/validate-smtp', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    claimStatus: () => request<{ claimed: boolean }>('/auth/claim/status'),
    claimStart: (token: string, email: string) =>
      request<{ ok: boolean; message: string }>('/auth/claim/start', {
        method: 'POST',
        body: JSON.stringify({ token, email }),
      }),
    requestLink: (email: string) =>
      request<{ ok: boolean; message: string }>('/auth/request-link', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    me: () =>
      request<{ email: string; role: 'owner' | 'guest'; sid: string; authBypass: boolean }>('/auth/me'),
    logout: () =>
      request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  },

  // V15.0 WS3-3H — Admin access (owner-only invite/revoke)
  admin: {
    access: {
      list: () =>
        request<{
          entries: Array<{
            email: string
            role: 'owner' | 'guest'
            invitedAt: string
            invitedBy?: string
            totpEnrolledAt: string | null
          }>
        }>('/admin/access'),
      invite: (email: string) =>
        request<{ ok: boolean; email: string; warning?: string }>('/admin/access/invite', {
          method: 'POST',
          body: JSON.stringify({ email }),
        }),
      revoke: (email: string) =>
        request<{ ok: boolean; email: string; sessionsRevoked: number }>(
          `/admin/access/${encodeURIComponent(email)}`,
          { method: 'DELETE' }
        ),
    },
  },
}
