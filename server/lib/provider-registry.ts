/**
 * Provider Registry (V13-T2.1) — catalogo STATICO di tutti i provider AI supportati.
 *
 * Ogni provider dichiara quali mode supporta (plan/api/cli/playwright) e i relativi
 * parametri di default (CLI binary, env vars, URL Playwright, modelli disponibili).
 *
 * Utente può creare account concreti (accounts.json) che puntano a (providerId, mode).
 * Extensibile: aggiungere un nuovo provider = append a STATIC_PROVIDERS.
 * Utente può inoltre aggiungere provider custom via UI → `data/custom-providers.json`
 * (merged con STATIC_PROVIDERS al runtime — V13-T6.4).
 */

export type ProviderMode = 'plan' | 'api' | 'cli' | 'playwright'

export type ProviderCategory = 'text' | 'image' | 'video' | 'audio' | 'multimodal'

/**
 * V13.1: Install commands per OS + package manager.
 * Ordine di preferenza per OS:
 *   win32:  npm > winget > manual
 *   linux:  npm > apt > pip > cargo
 *   darwin: npm > brew > pip
 */
/**
 * Installer types (keys) — supportati cross-platform.
 * Ordine di preferenza (per OS): elencato nei `PM_PRIORITY_BY_OS` sotto.
 */
export interface InstallerMap {
  npm?: string
  winget?: string
  pip?: string
  cargo?: string
  brew?: string
  apt?: string
  manual?: string
}

export interface InstallCmds {
  win32?: InstallerMap
  linux?: InstallerMap
  darwin?: InstallerMap
}

// Preferred package manager order per OS — primo trovato viene usato
export const PM_PRIORITY_BY_OS: Record<string, (keyof InstallerMap)[]> = {
  win32: ['npm', 'winget', 'pip', 'cargo', 'manual'],
  linux: ['npm', 'apt', 'pip', 'cargo', 'manual'],
  darwin: ['npm', 'brew', 'pip', 'cargo', 'manual'],
}

/** Resolve install command for current platform. Returns first matching PM. */
export function resolveInstallCmd(
  cmds: InstallCmds | undefined,
  platform: string = process.platform
): { cmd: string; pm: string } | null {
  if (!cmds) return null
  const os = (platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux') as keyof InstallCmds
  const osCmds = cmds[os]
  if (!osCmds) return null
  const priority = PM_PRIORITY_BY_OS[os] || []
  for (const pm of priority) {
    const cmd = osCmds[pm]
    if (cmd) return { cmd, pm: String(pm) }
  }
  return null
}

export interface ModeConfig {
  plan?: {
    cliName: string
    loginCmd?: string // command to run first-time login (informational)
    installCmds?: InstallCmds
    notes?: string
  }
  api?: {
    envVars: string[] // required env var NAMES (values resolved at runtime)
    baseUrl?: string
    cliWrapper?: string // optional CLI that wraps the API (e.g. aichat for Moonshot)
    installCmds?: InstallCmds // install for the cliWrapper
    testCmd?: string // ES: 'claude --version' for health probe
    notes?: string
  }
  cli?: {
    cliName: string
    installCmd?: string // DEPRECATED — use installCmds
    installCmds?: InstallCmds
    loginCmd?: string // ES: 'aichat --config' (first-time setup)
    notes?: string
  }
  playwright?: {
    url: string // home/login URL
    chatUrl?: string // deep link to chat if different
    loginSelector?: string // CSS selector of login button on login page
    notes?: string
  }
}

export interface ProviderDefinition {
  id: string
  label: string
  category: ProviderCategory
  supportedModes: ProviderMode[]
  modeDefaults: ModeConfig
  availableModels?: string[]
  description?: string
  // Flag: if true this is a user-added custom provider (persisted in custom-providers.json)
  custom?: boolean
}

/** Static seed — 15 provider principali V13 */
export const STATIC_PROVIDERS: ProviderDefinition[] = [
  // ===== TEXT / CODING =====
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    category: 'text',
    supportedModes: ['plan', 'api', 'cli', 'playwright'],
    modeDefaults: {
      plan: {
        cliName: 'claude',
        loginCmd: 'claude login',
        installCmds: {
          win32: { npm: 'npm install -g @anthropic-ai/claude-code' },
          linux: { npm: 'npm install -g @anthropic-ai/claude-code' },
          darwin: { npm: 'npm install -g @anthropic-ai/claude-code' },
        },
        notes: 'Pro subscription via claude.ai',
      },
      api: {
        envVars: ['ANTHROPIC_API_KEY'],
        cliWrapper: 'claude',
        installCmds: {
          win32: { npm: 'npm install -g @anthropic-ai/claude-code' },
          linux: { npm: 'npm install -g @anthropic-ai/claude-code' },
          darwin: { npm: 'npm install -g @anthropic-ai/claude-code' },
        },
        testCmd: 'claude --version',
      },
      cli: {
        cliName: 'claude',
        installCmd: 'npm install -g @anthropic-ai/claude-code',
        installCmds: {
          win32: { npm: 'npm install -g @anthropic-ai/claude-code' },
          linux: { npm: 'npm install -g @anthropic-ai/claude-code' },
          darwin: { npm: 'npm install -g @anthropic-ai/claude-code' },
        },
      },
      playwright: { url: 'https://claude.ai/new', chatUrl: 'https://claude.ai/new' },
    },
    availableModels: [
      'claude-opus-4-7[1m]',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'claude-opus-4-5',
      'claude-sonnet-4-5',
    ],
    description: 'Claude — Opus/Sonnet/Haiku. Best-in-class reasoning + plan mode.',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT / Codex / Sora)',
    category: 'multimodal',
    supportedModes: ['api', 'cli', 'playwright'],
    modeDefaults: {
      api: {
        envVars: ['OPENAI_API_KEY'],
        baseUrl: 'https://api.openai.com/v1',
        cliWrapper: 'codex',
        installCmds: {
          win32: { npm: 'npm install -g @openai/codex' },
          linux: { npm: 'npm install -g @openai/codex' },
          darwin: { npm: 'npm install -g @openai/codex' },
        },
        testCmd: 'codex --version',
      },
      cli: {
        cliName: 'codex',
        installCmd: 'npm install -g @openai/codex',
        installCmds: {
          win32: { npm: 'npm install -g @openai/codex' },
          linux: { npm: 'npm install -g @openai/codex' },
          darwin: { npm: 'npm install -g @openai/codex' },
        },
      },
      playwright: { url: 'https://chatgpt.com', chatUrl: 'https://chatgpt.com' },
    },
    availableModels: ['o1', 'o1-mini', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'sora-2'],
    description: 'GPT family + Codex (coding agent CLI) + Sora (video).',
  },
  {
    id: 'google',
    label: 'Google (Gemini / NanaBanana)',
    category: 'multimodal',
    supportedModes: ['plan', 'api', 'cli', 'playwright'],
    modeDefaults: {
      plan: {
        cliName: 'gemini',
        loginCmd: 'gemini auth login',
        installCmds: {
          win32: { npm: 'npm install -g @google-ai/gemini' },
          linux: { npm: 'npm install -g @google-ai/gemini' },
          darwin: { npm: 'npm install -g @google-ai/gemini' },
        },
        notes: 'Google OAuth',
      },
      api: {
        envVars: ['GEMINI_API_KEY'],
        baseUrl: 'https://generativelanguage.googleapis.com',
        cliWrapper: 'gemini',
        installCmds: {
          win32: { npm: 'npm install -g @google-ai/gemini' },
          linux: { npm: 'npm install -g @google-ai/gemini' },
          darwin: { npm: 'npm install -g @google-ai/gemini' },
        },
        testCmd: 'gemini --version',
      },
      cli: {
        cliName: 'gemini',
        installCmd: 'npm install -g @google-ai/gemini',
        installCmds: {
          win32: { npm: 'npm install -g @google-ai/gemini' },
          linux: { npm: 'npm install -g @google-ai/gemini' },
          darwin: { npm: 'npm install -g @google-ai/gemini' },
        },
      },
      playwright: { url: 'https://gemini.google.com', chatUrl: 'https://gemini.google.com/app' },
    },
    availableModels: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash', 'nanobanana-pro'],
    description: 'Gemini (text/code) + NanaBanana Pro (image gen premium).',
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi K2)',
    category: 'text',
    supportedModes: ['api', 'cli', 'playwright'],
    modeDefaults: {
      api: {
        envVars: ['MOONSHOT_API_KEY'],
        baseUrl: 'https://api.moonshot.cn/v1',
        cliWrapper: 'aichat',
        installCmds: {
          win32: { winget: 'winget install sigoden.aichat', cargo: 'cargo install aichat' },
          linux: { cargo: 'cargo install aichat', apt: 'apt install aichat' },
          darwin: { brew: 'brew install aichat', cargo: 'cargo install aichat' },
        },
        testCmd: 'aichat --version',
      },
      cli: {
        cliName: 'aichat',
        installCmd: 'cargo install aichat',
        installCmds: {
          win32: { winget: 'winget install sigoden.aichat', cargo: 'cargo install aichat' },
          linux: { cargo: 'cargo install aichat' },
          darwin: { brew: 'brew install aichat' },
        },
        loginCmd: 'aichat --config',
        notes: 'aichat configured with Moonshot endpoint',
      },
      playwright: { url: 'https://kimi.moonshot.cn', chatUrl: 'https://kimi.moonshot.cn' },
    },
    availableModels: ['kimi-k2', 'kimi-k2-turbo', 'kimi-k1.5'],
    description: 'Kimi K2 — long context 200k+, strong for data analysis.',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    category: 'text',
    supportedModes: ['api', 'playwright'],
    modeDefaults: {
      api: { envVars: ['XAI_API_KEY'], baseUrl: 'https://api.x.ai/v1' },
      playwright: { url: 'https://x.ai', chatUrl: 'https://grok.com' },
    },
    availableModels: ['grok-4', 'grok-4-heavy', 'grok-3'],
    description: 'Grok by xAI — real-time data via X.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    category: 'text',
    supportedModes: ['api'],
    modeDefaults: {
      api: { envVars: ['DEEPSEEK_API_KEY'], baseUrl: 'https://api.deepseek.com/v1' },
    },
    availableModels: ['deepseek-v3.2', 'deepseek-r1', 'deepseek-coder-v2'],
    description: 'DeepSeek — cost-effective coding + reasoning.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    category: 'text',
    supportedModes: ['api'],
    modeDefaults: {
      api: { envVars: ['MISTRAL_API_KEY'], baseUrl: 'https://api.mistral.ai/v1' },
    },
    availableModels: ['mistral-large-2', 'mistral-medium-3', 'codestral-2'],
    description: 'Mistral Large + Codestral — EU-based, solid coding.',
  },

  // ===== AGGREGATORS / MEDIA GEN =====
  {
    id: 'fal',
    label: 'fal.ai (image/video aggregator)',
    category: 'multimodal',
    supportedModes: ['api', 'cli'],
    modeDefaults: {
      api: {
        envVars: ['FAL_KEY'],
        baseUrl: 'https://fal.run',
        cliWrapper: 'fal',
        installCmds: {
          win32: { pip: 'pip install fal-client fal' },
          linux: { pip: 'pip install fal-client fal' },
          darwin: { pip: 'pip install fal-client fal' },
        },
        testCmd: 'fal --version',
      },
      cli: {
        cliName: 'fal',
        installCmd: 'pip install fal',
        installCmds: {
          win32: { pip: 'pip install fal' },
          linux: { pip: 'pip install fal' },
          darwin: { pip: 'pip install fal' },
        },
      },
    },
    availableModels: [
      'flux-2-pro', 'flux-2-dev', 'flux-1-kontext',
      'sd-3.5-large',
      'nanobanana-pro', 'nanobanana-2',
      'ideogram-v3', 'recraft-v4',
      'runway-gen-4', 'kling-3', 'sora-2',
    ],
    description: 'Aggregator — FLUX, SD3.5, NanaBanana, Runway, Kling, Sora.',
  },
  {
    id: 'runway',
    label: 'Runway ML',
    category: 'video',
    supportedModes: ['api', 'playwright'],
    modeDefaults: {
      api: { envVars: ['RUNWAY_API_KEY'], baseUrl: 'https://api.dev.runwayml.com' },
      playwright: { url: 'https://app.runwayml.com', chatUrl: 'https://app.runwayml.com/video-tools' },
    },
    availableModels: ['gen-4', 'gen-4-turbo', 'act-two', 'gen-3-alpha'],
    description: 'Video gen — Gen-4 + Act-Two motion transfer.',
  },
  {
    id: 'kling',
    label: 'Kling AI',
    category: 'video',
    supportedModes: ['api', 'playwright'],
    modeDefaults: {
      api: { envVars: ['KLING_API_KEY'] },
      playwright: { url: 'https://klingai.com' },
    },
    availableModels: ['kling-3.0', 'kling-avatar-2'],
    description: 'Kling 3 — text-to-video + Avatar 2 talking head.',
  },
  {
    id: 'heygen',
    label: 'HeyGen',
    category: 'video',
    supportedModes: ['api', 'playwright'],
    modeDefaults: {
      api: { envVars: ['HEYGEN_API_KEY'] },
      playwright: { url: 'https://app.heygen.com' },
    },
    availableModels: ['heygen-avatar-3', 'heygen-avatar-2'],
    description: 'HeyGen — avatar video generation.',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    category: 'audio',
    supportedModes: ['api'],
    modeDefaults: {
      api: { envVars: ['ELEVEN_LABS_API_KEY'], baseUrl: 'https://api.elevenlabs.io' },
    },
    availableModels: ['eleven-v3', 'eleven-multilingual-v3'],
    description: 'Voice synthesis + voice cloning.',
  },
  {
    id: 'suno',
    label: 'Suno',
    category: 'audio',
    supportedModes: ['api', 'playwright'],
    modeDefaults: {
      api: { envVars: ['SUNO_API_KEY'] },
      playwright: { url: 'https://suno.com/create' },
    },
    availableModels: ['suno-v5', 'suno-v4.5'],
    description: 'Music generation.',
  },
  {
    id: 'ideogram',
    label: 'Ideogram',
    category: 'image',
    supportedModes: ['api', 'playwright'],
    modeDefaults: {
      api: { envVars: ['IDEOGRAM_API_KEY'] },
      playwright: { url: 'https://ideogram.ai' },
    },
    availableModels: ['ideogram-v3', 'ideogram-v2-turbo'],
    description: 'Typography + text-in-image specialist.',
  },
  {
    id: 'recraft',
    label: 'Recraft',
    category: 'image',
    supportedModes: ['api', 'playwright'],
    modeDefaults: {
      api: { envVars: ['RECRAFT_API_KEY'] },
      playwright: { url: 'https://recraft.ai' },
    },
    availableModels: ['recraft-v4', 'recraft-v3'],
    description: 'Vector + brand graphics + SVG output.',
  },
]

/**
 * Registry with support for custom providers merged from `data/custom-providers.json`.
 * Singleton pattern — loaded once at startup, re-readable via `reload()`.
 */
class ProviderRegistry {
  private custom: ProviderDefinition[] = []

  setCustom(custom: ProviderDefinition[]) {
    this.custom = custom.map((p) => ({ ...p, custom: true }))
  }

  /** All providers (static + custom) */
  list(): ProviderDefinition[] {
    return [...STATIC_PROVIDERS, ...this.custom]
  }

  /** Find by ID (static or custom) */
  get(id: string): ProviderDefinition | null {
    return this.list().find((p) => p.id === id) || null
  }

  /** Only statically-seeded providers */
  listStatic(): ProviderDefinition[] {
    return [...STATIC_PROVIDERS]
  }

  /** Only user-added custom providers */
  listCustom(): ProviderDefinition[] {
    return [...this.custom]
  }
}

export const providerRegistry = new ProviderRegistry()
