import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

interface CredentialInfo {
  name: string
  scope: string
  source: 'settings.json env' | 'Windows env' | 'VPS .env' | 'vault reference' | 'file'
  configured: boolean
  notes?: string
}

async function loadSettingsEnv(): Promise<CredentialInfo[]> {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
  try {
    const raw = await fs.readFile(settingsPath, 'utf8')
    const parsed = JSON.parse(raw)
    const env = parsed.env || {}
    return Object.keys(env).map((k) => ({
      name: k,
      scope: scopeForKey(k),
      source: 'settings.json env' as const,
      configured: !!env[k],
    }))
  } catch {
    return []
  }
}

function scopeForKey(key: string): string {
  const map: Record<string, string> = {
    GITHUB_TOKEN: 'GitHub · repo + workflow + hooks + packages',
    GITHUB_TOKEN_RM: 'GitHub secondary account · repo + workflow + read:org',
    SUPABASE_ACCESS_TOKEN: 'Supabase CLI',
    GOOGLE_ADS_CLIENT_ID: 'Google Ads OAuth client',
    GOOGLE_ADS_CLIENT_SECRET: 'Google Ads OAuth secret',
    GOOGLE_SHEETS_REFRESH_TOKEN: 'Google Sheets + Drive API (CLI tool)',
    OPENAI_API_KEY: 'OpenAI API (GPT models)',
    ANTHROPIC_API_KEY: 'Anthropic API (Claude direct)',
    PADDLE_API_KEY: 'Paddle Billing (Merchant of Record)',
    PADDLE_WEBHOOK_SECRET: 'Paddle webhook verification',
    FAL_KEY: 'fal.ai (FLUX / NanaBanana / SD3.5)',
    RUNWAY_API_KEY: 'Runway Gen-4 video',
    KLING_API_KEY: 'Kling 3.0 video',
    ELEVEN_LABS_API_KEY: 'ElevenLabs v3 audio',
    SUNO_API_KEY: 'Suno music generation',
    HEYGEN_API_KEY: 'HeyGen avatar videos',
    NAMECHEAP_API_KEY: 'Namecheap domain purchase',
    VERCEL_TOKEN: 'Vercel deploy + project mgmt',
    N8N_API_KEY: 'n8n workflows API',
    SSH_CLAUDE_VPS: 'SSH key for VPS (loaded from data/ssh-inventory.json)',
  }
  return map[key] || key.toLowerCase().replace(/_/g, ' ')
}

const WINDOWS_ENV_EXPECTED = [
  'GITHUB_TOKEN_RM',
  'SUPABASE_ACCESS_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_SHEETS_REFRESH_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'FAL_KEY',
  'RUNWAY_API_KEY',
  'ELEVEN_LABS_API_KEY',
  'KLING_API_KEY',
  'SUNO_API_KEY',
  'HEYGEN_API_KEY',
  'NAMECHEAP_API_KEY',
  'VERCEL_TOKEN',
]

// V15.9 WS43.2 — generic placeholders only. Per-installation customization
// happens via settings.json + .env, never inlined in this file.
const VAULT_REFERENCES: Array<{ name: string; scope: string; source: CredentialInfo['source'] }> = [
  { name: 'n8n MCP JWT', scope: 'configured via settings.json mcpServers (no expiry)', source: 'settings.json env' },
  { name: 'SSH VPS key', scope: 'SSH key configured via data/ssh-inventory.json (gitignored)', source: 'file' },
  { name: 'Supabase admin secret', scope: 'configured via local secrets folder (gitignored)', source: 'file' },
  { name: 'Supabase anon key', scope: 'configured via local secrets folder (gitignored)', source: 'file' },
  { name: 'Supabase service role', scope: 'configured via local secrets folder (gitignored)', source: 'file' },
  { name: 'MCP bridge token', scope: 'configured via settings.json mcpServers', source: 'settings.json env' },
]

function loadWindowsEnv(): CredentialInfo[] {
  return WINDOWS_ENV_EXPECTED.map((name) => ({
    name,
    scope: scopeForKey(name),
    source: 'Windows env' as const,
    configured: !!process.env[name],
  }))
}

export function credentialsRouter() {
  const router = Router()

  router.get('/', async (_req, res) => {
    const settingsEnv = await loadSettingsEnv()
    const winEnv = loadWindowsEnv()
    // Dedup: prefer settings.json source
    const map = new Map<string, CredentialInfo>()
    for (const c of [...settingsEnv, ...winEnv]) {
      const existing = map.get(c.name)
      if (!existing) {
        map.set(c.name, c)
      } else if (!existing.configured && c.configured) {
        map.set(c.name, c)
      }
    }
    const items: CredentialInfo[] = [...map.values(), ...VAULT_REFERENCES.map((r) => ({
      name: r.name,
      scope: r.scope,
      source: r.source,
      configured: true,
    }))]
    // Sort: configured first, then alpha
    items.sort((a, b) => {
      if (a.configured !== b.configured) return a.configured ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    const stats = {
      total: items.length,
      configured: items.filter((i) => i.configured).length,
      missing: items.filter((i) => !i.configured).length,
    }
    res.json({ items, stats, updatedAt: new Date().toISOString() })
  })

  return router
}
