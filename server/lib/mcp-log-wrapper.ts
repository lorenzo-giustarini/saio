import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'

/**
 * V15.0 WS2-2G — MCP server log wrapper.
 *
 * MCP servers chiamati da sessioni Claude Code sono già loggati nei .jsonl
 * (tool_use + tool_result). Questo wrapper è per MCP CRON-invoked (non da Claude session)
 * dove altrimenti perderemmo gli log.
 *
 * Lista MCP da MOC-Automations-Tools T6-T13:
 *   pabbly, brave-search, puppeteer, github, vercel, supabase, n8n, obsidian
 *
 * Output: <vault>/logs/mcp/<server>/<YYYY-MM-DD>.jsonl (append-only)
 */

const VAULT_MCP_LOGS = path.join(
  os.homedir(),
  '.claude',
  'projects',
  'C--Users-info-Desktop-CLAUDE-WORLD',
  'memory',
  'logs',
  'mcp',
)

export type McpServer =
  | 'pabbly'
  | 'brave-search'
  | 'puppeteer'
  | 'github'
  | 'vercel'
  | 'supabase'
  | 'n8n'
  | 'obsidian'
  | 'unknown'

export interface McpCallLog {
  ts: string
  server: McpServer
  method: string // es. 'tools/call', 'resources/read'
  params?: any // payload sanitized
  result?: any // truncated
  error?: string
  durationMs: number
  callerContext?: string
}

function sanitize(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') {
    return obj
      .replace(/(api[_-]?key|token|password|secret)[\s:='"]+\S+/gi, '$1=<REDACTED>')
      .replace(/(Bearer\s+)[\w.-]+/gi, '$1<REDACTED>')
      .replace(/sk-[a-zA-Z0-9_-]{20,}/g, '<REDACTED>')
      .slice(0, 500)
  }
  if (Array.isArray(obj)) return obj.slice(0, 10).map(sanitize)
  if (typeof obj === 'object') {
    const out: any = {}
    for (const k of Object.keys(obj).slice(0, 20)) {
      // skip noisy/sensitive keys
      if (/^(authorization|cookie|x-api-key|password|token|secret)$/i.test(k)) {
        out[k] = '<REDACTED>'
      } else {
        out[k] = sanitize(obj[k])
      }
    }
    return out
  }
  return obj
}

export async function logMcpCall(entry: Omit<McpCallLog, 'ts'>): Promise<void> {
  try {
    const ts = new Date().toISOString()
    const dir = path.join(VAULT_MCP_LOGS, entry.server)
    await fs.mkdir(dir, { recursive: true })
    const date = ts.slice(0, 10)
    const file = path.join(dir, `${date}.jsonl`)
    const sanitized: McpCallLog = {
      ts,
      ...entry,
      params: sanitize(entry.params),
      result: sanitize(entry.result),
      error: entry.error ? sanitize(entry.error) as string : undefined,
    }
    await fs.appendFile(file, JSON.stringify(sanitized) + '\n', 'utf-8')
  } catch (err: any) {
    logger.warn(`mcp-log-wrapper append failed: ${err.message}`)
  }
}

/**
 * Wrap async function chiamante MCP server. Logga durata + esito + errore.
 *
 * Usage:
 *   const result = await wrapMcpCall('github', 'tools/call', { tool: 'create_issue' },
 *     async () => githubMcp.createIssue({ ... }))
 */
export async function wrapMcpCall<T>(
  server: McpServer,
  method: string,
  params: any,
  fn: () => Promise<T>,
  callerContext?: string
): Promise<T> {
  const start = Date.now()
  try {
    const result = await fn()
    await logMcpCall({
      server,
      method,
      params,
      result: typeof result === 'object' ? '...truncated...' : result,
      durationMs: Date.now() - start,
      callerContext,
    })
    return result
  } catch (err: any) {
    await logMcpCall({
      server,
      method,
      params,
      error: err?.message || String(err),
      durationMs: Date.now() - start,
      callerContext,
    })
    throw err
  }
}

export function detectMcpServer(toolName: string): McpServer {
  const t = toolName.toLowerCase()
  if (t.includes('pabbly')) return 'pabbly'
  if (t.includes('brave')) return 'brave-search'
  if (t.includes('puppet')) return 'puppeteer'
  if (t.includes('github')) return 'github'
  if (t.includes('vercel')) return 'vercel'
  if (t.includes('supabase')) return 'supabase'
  if (t.includes('n8n')) return 'n8n'
  if (t.includes('obsidian')) return 'obsidian'
  return 'unknown'
}
