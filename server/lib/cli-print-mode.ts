/**
 * V15.0 WS24 — Spawn CLI in non-interactive print mode (claude -p, gemini -p).
 *
 * Usato per generare AI summary on-demand sfruttando l'abbonamento dell'utente
 * (account.mode='plan') invece di consumare API REST tokens. L'utente paga
 * l'abbonamento mensile (Claude Plan, Gemini Pro), così le chiamate AI per
 * il summarize non aggiungono costo extra.
 *
 * Caratteristiche:
 * - NO PTY: usa spawn + stdout capture + timeout (short-lived, no persist)
 * - NON appare in ptyManager.list() — invisibile rispetto alle sessioni utente
 * - Coerente con descrizione utente "progetto in background invisibile"
 * - shell:true su Windows per resolution PATHEXT (.cmd / .bat / WinGet shims)
 */
import { spawn } from 'node:child_process'
import { logger } from './logger'

export interface CliPrintResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  error?: string
  durationMs: number
}

export interface CliPrintOptions {
  cli: string                  // 'claude' | 'gemini' | 'codex'
  prompt: string
  model?: string
  extraArgs?: string[]
  timeoutMs?: number
  cwd?: string
}

export async function spawnCliPrintMode(opts: CliPrintOptions): Promise<CliPrintResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const args: string[] = ['-p', opts.prompt]
    if (opts.model) {
      args.push('--model', opts.model)
    }
    if (opts.extraArgs && opts.extraArgs.length > 0) {
      args.push(...opts.extraArgs)
    }

    let stdout = ''
    let stderr = ''
    let timedOut = false

    const proc = spawn(opts.cli, args, {
      shell: process.platform === 'win32',
      cwd: opts.cwd,
      windowsHide: true,
    })

    const timeout = setTimeout(() => {
      timedOut = true
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs || 30_000)

    proc.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString('utf-8')
    })
    proc.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString('utf-8')
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      resolve({
        ok: false,
        stdout,
        stderr,
        exitCode: null,
        error: err.message,
        durationMs: Date.now() - start,
      })
    })

    proc.on('exit', (code) => {
      clearTimeout(timeout)
      resolve({
        ok: !timedOut && code === 0,
        stdout,
        stderr,
        exitCode: code,
        error: timedOut ? 'timeout' : code !== 0 ? `exit_${code}` : undefined,
        durationMs: Date.now() - start,
      })
    })
  })
}

/**
 * Mappa providerId → CLI name + cheap model id per print mode summarize.
 *
 * Selezione modello: il più economico disponibile per il provider, scelto da
 * provider-registry.ts:availableModels. Cost-effective per task semplici come
 * il summary di una scelta runtime.
 *
 * @returns null se il provider non supporta print mode (es. Codex CLI di OpenAI
 *          non ha un flag `-p` standard affidabile per JSON output).
 */
export function resolveCheapModelForPlan(
  providerId: string
): { cli: string; model: string } | null {
  switch (providerId) {
    case 'anthropic':
      return { cli: 'claude', model: 'claude-haiku-4-5-20251001' }
    case 'google':
      return { cli: 'gemini', model: 'gemini-2.0-flash-lite' }
    case 'openai':
      // Codex CLI non ha print mode JSON-friendly affidabile. API REST is preferred.
      return null
    default:
      return null
  }
}

/**
 * Helper: parse JSON da output CLI con cleanup di markdown fence eventuali.
 * Claude/Gemini print mode talvolta wrappa JSON in ```json...``` blocks.
 */
export function parseCliJsonOutput<T = unknown>(stdout: string): T | null {
  const cleaned = stdout
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim()
  if (!cleaned) return null
  try {
    return JSON.parse(cleaned) as T
  } catch (err) {
    logger.warn(`[cli-print-mode] JSON parse failed: ${(err as Error).message}, stdout head: ${cleaned.slice(0, 200)}`)
    return null
  }
}
