import { z } from 'zod'

// ============================================================
// Risks inside a decision
// ============================================================
export const RiskSchema = z.object({
  desc: z.string().min(1).max(500),
  probabilita: z.number().min(0).max(1),
  severita: z.enum(['low', 'medium', 'high', 'critical']),
})
export type Risk = z.infer<typeof RiskSchema>

// ============================================================
// Decision
// ============================================================
export const DecisionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().min(1).max(200),
  projectTarget: z.string().regex(/^[a-z0-9_-]{1,64}$/).optional(),
  causa: z.string().min(1).max(2000),
  effetto: z.object({
    si: z.string().min(1).max(1000),
    no: z.string().min(1).max(1000),
  }),
  rischi: z.array(RiskSchema).max(10),
  soluzioneProposta: z.string().min(1).max(3000),
  tags: z.array(z.string()).max(20).optional(),
  referenceUrls: z.array(z.string().url()).max(10).optional(),
  deadline: z.string().datetime().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
})
export type Decision = z.infer<typeof DecisionSchema>

// ============================================================
// Brief (input da Claude)
// ============================================================
export const BriefSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.enum(['morning', 'eod', 'adhoc', 'urgent']),
  createdAt: z.string().datetime(),
  author: z.string().default('claude'),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  decisions: z.array(DecisionSchema).min(1).max(50),
  metadata: z.record(z.unknown()).optional(),
  // V11-01: source of this brief. 'brief' = traditional Morning/EOD/Adhoc.
  // 'in-session' = posted by Claude during an active session on a project.
  // 'cron' = auto-generated from scheduled tasks (MCP discovery, vault health, etc.).
  source: z.enum(['brief', 'in-session', 'cron']).default('brief'),
  // V11-01: when source='in-session', the project the session is running on.
  projectId: z.string().regex(/^[a-z0-9_-]{1,64}$/).optional(),
  // V11-01: session id origin (for traceability — links card to a specific PTY session if known)
  sessionId: z.string().max(128).optional(),
})
export type Brief = z.infer<typeof BriefSchema>

/**
 * Payload to create a standalone in-session decision card.
 * Backend wraps into a minimal Brief with type='adhoc' source='in-session'.
 */
export const InSessionDecisionSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  sessionId: z.string().max(128).optional(),
  decision: DecisionSchema.omit({ id: true }).extend({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(), // auto-gen if missing
  }),
})
export type InSessionDecision = z.infer<typeof InSessionDecisionSchema>

// ============================================================
// Response (output user dashboard)
// ============================================================
export const ResponseEntrySchema = z.object({
  decisionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  answer: z.enum(['yes', 'no', 'skip', 'comment-only']),
  comment: z.string().max(5000).default(''),
  voiceUsed: z.boolean().default(false),
})
export type ResponseEntry = z.infer<typeof ResponseEntrySchema>

export const ResponseSchema = z.object({
  briefId: z.string().min(1).max(128),
  submittedAt: z.string().datetime(),
  globalComment: z.string().max(5000).default(''),
  entries: z.array(ResponseEntrySchema).min(1),
})
export type Response = z.infer<typeof ResponseSchema>

// ============================================================
// Task status (live)
// ============================================================
export const TaskStatusSchema = z.object({
  projectId: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  title: z.string().min(1).max(200),
  status: z.enum(['idle', 'pending', 'running', 'waiting_user', 'paused', 'done', 'failed']),
  // Session outcome: disambigua tra "chiusa dall'utente" e "completata esplicitamente".
  // null = mai partita o ancora in corso; 'completed' = marker file presente; 'terminated' = PID morto senza marker.
  sessionOutcome: z.enum(['completed', 'terminated', 'failed']).nullable().optional(),
  progress: z.number().min(0).max(1).default(0),
  tokensUsed: z.number().int().min(0).default(0),
  tokensEstimated: z.number().int().min(0).optional(),
  etaSeconds: z.number().int().min(0).optional(),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  pid: z.number().int().optional(),
  terminalTitle: z.string().max(200).optional(),
  logFile: z.string().max(500).optional(),
  relatedDecisionIds: z.array(z.string()).optional(),
  currentStep: z.string().max(500).optional(),
  errorMessage: z.string().max(2000).optional(),
  history: z
    .array(
      z.object({
        ts: z.string().datetime(),
        event: z.string().max(200),
      })
    )
    .default([]),
})
export type TaskStatus = z.infer<typeof TaskStatusSchema>

// ============================================================
// Project (cache di vault MOC + git VPS)
// ============================================================
// Folder path: Unix-like ("Clients/Herbalife/UK"). Empty string or undefined = root.
// Char whitelist rejects path traversal + special chars; no leading/trailing slash.
const FolderPathSchema = z
  .string()
  .max(200)
  .regex(/^(?:[a-zA-Z0-9 _-]+(?:\/[a-zA-Z0-9 _-]+)*)?$/, 'Folder path invalido')
  .optional()

export const ProjectSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  name: z.string().min(1).max(200),
  status: z.enum(['green', 'yellow', 'red', 'paused', 'unknown']),
  category: z.string().max(100).optional(),
  lastUpdate: z.string().datetime().optional(),
  nextAction: z.string().max(500).optional(),
  owner: z.string().max(100).optional(),
  mocLink: z.string().max(500).optional(),
  mocPath: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string()).max(20).optional(),
  github: z.string().max(500).optional(),
  vercel: z.string().max(500).optional(),
  vps: z.string().max(500).optional(),
  hostUrl: z.string().max(500).optional(),
  kickoffTemplate: z.string().max(2000).optional(),
  externalCwd: z.string().max(500).optional(),
  // V11 — lifecycle & hierarchy
  folder: FolderPathSchema,
  archived: z.boolean().optional().default(false),
  archivedAt: z.string().datetime().optional(),
  // V13 — per-project AI account override
  accountOverride: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable().optional(),
  modelOverride: z.string().max(100).nullable().optional(),
  // V14 — spawn target: 'local' | <vpsId>. Override del target dell'account.
  // Se assente o null → eredita da account.target → fallback 'local'.
  spawnTarget: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable().optional(),
  // V14.5 — Path al file kickoff brief (markdown) generato alla creazione (LEGACY,
  // backward compat. V14.14 preferisce `pendingKickoffText` sotto)
  pendingKickoffPath: z.string().max(500).nullable().optional(),
  // V14.14 — Testo del brief già stylized pronto da inviare come user message all'AI.
  // L'EmbeddedChat al primo ready invia `pendingKickoffText` via sendText (no slash command,
  // testo plain) e poi PATCH a null. `/read` non è un comando valido in Claude Code CLI.
  pendingKickoffText: z.string().max(8000).nullable().optional(),
})
export type Project = z.infer<typeof ProjectSchema>

// PATCH body: partial update schema for PATCH /api/projects/:id
export const ProjectPatchSchema = ProjectSchema.partial().omit({ id: true })
export type ProjectPatch = z.infer<typeof ProjectPatchSchema>

// ============================================================
// Orchestrator command (queue)
// ============================================================
export const OrchestratorCommandSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['start', 'pause', 'resume', 'kill', 'send_input']),
  projectId: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  payload: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
})
export type OrchestratorCommand = z.infer<typeof OrchestratorCommandSchema>

// ============================================================
// Feedback (for self-improvement)
// ============================================================
export const FeedbackSchema = z.object({
  id: z.string().min(1),
  ts: z.string().datetime(),
  context: z.string().max(200),
  rating: z.number().int().min(1).max(5).optional(),
  text: z.string().max(5000),
  tags: z.array(z.string()).max(20).default([]),
  source: z.enum(['user', 'system', 'agent']).default('user'),
})
export type Feedback = z.infer<typeof FeedbackSchema>

// ============================================================
// V13 — Provider Mode matrix (account schema)
// ============================================================
export const ProviderModeSchema = z.enum(['plan', 'api', 'cli', 'playwright'])
export type ProviderMode = z.infer<typeof ProviderModeSchema>

export const AccountSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  providerId: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  mode: ProviderModeSchema,
  label: z.string().min(1).max(200),
  // Mode-specific optional config:
  cliName: z.string().max(64).optional(), // override default CLI per mode
  cliArgs: z.array(z.string().max(200)).max(20).optional(), // extra args prepended to spawns
  envVarRef: z.string().max(100).optional(), // for api mode, reference to env var NAME
  playwrightProfile: z.string().max(100).optional(), // profile name for session persistence
  defaultModel: z.string().max(100).optional(),
  createdAt: z.string().datetime().optional(),
  createdBy: z.enum(['user', 'autodetect', 'seed']).default('user').optional(),
  // V13.3-T8: last local spawn timestamp (populated by pty-manager on LOCAL spawn)
  lastLocalUseAt: z.string().datetime().optional(),
  // V14 — Activation target: 'local' | <vpsId>. Determina dove spawnare PTY e dove fare health probe.
  // undefined = UNCONFIGURED → utente deve scegliere prima di poter usare l'account.
  target: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  targetConfiguredAt: z.string().datetime().optional(),
  // Runtime status (populated by health check — do not persist across runs beyond cache)
  status: z
    .object({
      health: z.enum(['ready', 'not-configured', 'not-installed', 'error', 'unknown', 'unconfigured']).default('unknown'),
      lastCheck: z.string().datetime().optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
})
export type Account = z.infer<typeof AccountSchema>

export const AccountPatchSchema = AccountSchema.partial().omit({ id: true })
export type AccountPatch = z.infer<typeof AccountPatchSchema>

// Container file schema
export const AccountsFileSchema = z.object({
  version: z.number().int().default(1),
  accounts: z.array(AccountSchema).default([]),
  activeId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable().optional(),
  updatedAt: z.string().datetime().optional(),
})
export type AccountsFile = z.infer<typeof AccountsFileSchema>

// ============================================================
// V13 — Custom Provider (user-added via UI)
// ============================================================
const ModeConfigSchema = z.object({
  plan: z
    .object({ cliName: z.string().max(64), loginCmd: z.string().max(200).optional(), notes: z.string().max(500).optional() })
    .optional(),
  api: z
    .object({
      envVars: z.array(z.string().max(100)).min(1).max(5),
      baseUrl: z.string().url().optional(),
      cliWrapper: z.string().max(64).optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
  cli: z
    .object({
      cliName: z.string().max(64),
      installCmd: z.string().max(200).optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
  playwright: z
    .object({
      url: z.string().url(),
      chatUrl: z.string().url().optional(),
      loginSelector: z.string().max(200).optional(),
      notes: z.string().max(500).optional(),
    })
    .optional(),
})

export const CustomProviderSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  label: z.string().min(1).max(200),
  category: z.enum(['text', 'image', 'video', 'audio', 'multimodal']),
  supportedModes: z.array(ProviderModeSchema).min(1),
  modeDefaults: ModeConfigSchema,
  availableModels: z.array(z.string().max(100)).max(50).optional(),
  description: z.string().max(1000).optional(),
})
export type CustomProvider = z.infer<typeof CustomProviderSchema>

export const CustomProvidersFileSchema = z.object({
  version: z.number().int().default(1),
  providers: z.array(CustomProviderSchema).default([]),
  updatedAt: z.string().datetime().optional(),
})
export type CustomProvidersFile = z.infer<typeof CustomProvidersFileSchema>

// ============================================================
// V13 — Task-Types routing table
// ============================================================
export const TaskTypeSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  label: z.string().min(1).max(200),
  category: z.enum(['dev', 'strategy', 'creative', 'content', 'data', 'ops', 'research', 'other']).default('other'),
  description: z.string().max(500).optional(),
  suggestedProviders: z.array(z.string()).max(10).optional(),
  accountId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).nullable().optional(),
  model: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  source: z.enum(['seed', 'skill-scan', 'user', 'cron']).default('user').optional(),
  pendingAssignment: z.boolean().default(false).optional(),
})
export type TaskType = z.infer<typeof TaskTypeSchema>

export const TaskTypesFileSchema = z.object({
  version: z.number().int().default(1),
  taskTypes: z.array(TaskTypeSchema).default([]),
  updatedAt: z.string().datetime().optional(),
})
export type TaskTypesFile = z.infer<typeof TaskTypesFileSchema>

// ============================================================
// MCP status (for add-on panel)
// ============================================================
export const MCPStatusSchema = z.object({
  name: z.string(),
  url: z.string().optional(),
  status: z.enum(['healthy', 'degraded', 'down', 'unknown']),
  latencyMs: z.number().int().optional(),
  lastCheck: z.string().datetime(),
  error: z.string().optional(),
})
export type MCPStatus = z.infer<typeof MCPStatusSchema>
