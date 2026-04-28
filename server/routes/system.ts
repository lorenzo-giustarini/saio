/**
 * V15.0 WS10 + WS19 — System checks (dipendenze runtime) + install endpoints.
 *
 * /api/system/deps-check (auth required, solo owner):
 *   ritorna {python, claudeCli, cloudflared, playwright, ...} con stato + version.
 *   Frontend mostra popup "Dipendenze runtime" se manca qualcosa di critical.
 *
 * /api/system/install-python-deps (WS19):
 *   crea venv `orchestrator/.venv` se mancante e installa requirements.txt.
 *   Stream stdout+stderr come text/plain.
 */
import { Router } from 'express'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { logger } from '../lib/logger'

// V15.0 WS19 — In-memory lock per prevenire doppio install Python deps
let pythonDepsInstallRunning = false

interface DepStatus {
  found: boolean
  version?: string
  category: 'CRITICAL' | 'CORE' | 'OPTIONAL'
  installCommand?: string
  installLink?: string
}

interface DepsReport {
  os: NodeJS.Platform
  deps: Record<string, DepStatus>
  allCriticalOk: boolean
  missingCritical: string[]
}

function checkCommand(cmd: string, args: string[] = ['--version']): Promise<string | null> {
  // V15.0 WS19 — su Windows usa shell:true per resolvere correttamente
  // .exe / .cmd / .bat / shim files (es. WinGet aliases).
  // Su POSIX shell:false è preferibile per safety.
  const isWin = platform() === 'win32'
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: isWin })
    let out = ''
    p.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf-8')
    })
    p.stderr.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf-8')
    })
    p.on('error', () => resolve(null))
    p.on('exit', (code) => {
      if (code === 0) resolve(out.trim().split('\n')[0] || 'detected')
      else resolve(null)
    })
    setTimeout(() => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
      resolve(null)
    }, 3000)
  })
}

async function buildReport(): Promise<DepsReport> {
  const os = platform()
  const isWin = os === 'win32'

  const [node, npmV, claude, cloudflared, py311, py3, py] = await Promise.all([
    checkCommand('node'),
    checkCommand('npm'),
    checkCommand('claude'),
    checkCommand('cloudflared'),
    checkCommand(isWin ? 'python' : 'python3.11'),
    checkCommand(isWin ? 'py' : 'python3'),
    checkCommand(isWin ? 'py' : 'python'),
  ])

  // Resolve Python: prefer 3.11+, fallback any python detected
  let pythonVer: string | null = null
  for (const v of [py311, py3, py]) {
    if (v && /3\.(1[1-9]|[2-9]\d)/.test(v)) {
      pythonVer = v
      break
    }
  }
  if (!pythonVer && (py311 || py3 || py)) {
    pythonVer = py311 || py3 || py // detected ma versione minore di 3.11
  }

  // Playwright check via node_modules
  const playwrightInstalled = await fileExists(
    path.join(process.cwd(), 'node_modules', 'playwright')
  )

  // V15.0 WS19+WS20 — Python orchestrator deps check (pywinpty/psutil/watchdog)
  // Uso findWorkingPython che prova candidati multipli (venv → PYTHON_EXE → python/py/python3)
  // → evita false-positive quando backend ha PATH stale o Python alt installato senza pywinpty.
  const { findWorkingPython } = await import('../lib/python-deps-check')
  const pyDeps = isWin ? ['psutil', 'watchdog', 'pywinpty'] : ['psutil', 'watchdog']
  const pyResult = await findWorkingPython(pyDeps)

  const deps: Record<string, DepStatus> = {
    node: {
      found: !!node,
      version: node || undefined,
      category: 'CRITICAL',
      installCommand: isWin ? 'winget install OpenJS.NodeJS.LTS' : 'brew install node',
    },
    npm: {
      found: !!npmV,
      version: npmV || undefined,
      category: 'CRITICAL',
      installCommand: '(included with Node.js)',
    },
    python: {
      found: !!pythonVer && /3\.(1[1-9]|[2-9]\d)/.test(pythonVer),
      version: pythonVer || undefined,
      category: 'CORE',
      installCommand: isWin ? 'winget install Python.Python.3.11' : 'brew install python@3.11',
    },
    claudeCli: {
      found: !!claude,
      version: claude || undefined,
      category: 'CRITICAL',
      installLink: 'https://docs.anthropic.com/cli',
    },
    cloudflared: {
      found: !!cloudflared,
      version: cloudflared || undefined,
      category: 'OPTIONAL',
      installCommand: isWin
        ? 'winget install Cloudflare.cloudflared'
        : 'brew install cloudflare/cloudflare/cloudflared',
    },
    playwright: {
      found: playwrightInstalled,
      version: playwrightInstalled ? 'in node_modules' : undefined,
      category: 'OPTIONAL',
      installCommand: 'npx playwright install',
    },
    pythonDeps: {
      found: pyResult.allOk,
      version: pyResult.allOk
        ? `${pyDeps.join(', ')} OK (via ${pyResult.exe})`
        : `Mancanti: ${pyResult.missing.join(', ')} (provati: ${pyResult.tried.map((t) => t.exe).join(', ')})`,
      category: 'CORE',
      installCommand: 'npm run setup:deps',
    } as DepStatus,
  }

  const missingCritical = Object.entries(deps)
    .filter(([, v]) => v.category === 'CRITICAL' && !v.found)
    .map(([k]) => k)

  return {
    os,
    deps,
    allCriticalOk: missingCritical.length === 0,
    missingCritical,
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

export function systemRouter(): Router {
  const router = Router()

  router.get('/deps-check', async (_req, res) => {
    try {
      const report = await buildReport()
      res.json(report)
    } catch (err) {
      res.status(500).json({ error: 'check_failed', message: (err as Error).message })
    }
  })

  // V15.0 WS18 — Guardrails antidistruttivi serviti al frontend
  router.get('/guardrails', async (_req, res) => {
    try {
      const { ANTIDESTRUCTIVE_GUARDRAILS, AUTH_RESET_FILES } = await import('../lib/safety-guardrails')
      res.json({
        guardrails: ANTIDESTRUCTIVE_GUARDRAILS,
        authResetFiles: AUTH_RESET_FILES,
      })
    } catch (err) {
      res.status(500).json({ error: 'load_failed', message: (err as Error).message })
    }
  })

  // V15.0 WS11 — Cloudflare tunnel status (per wizard)
  router.get('/tunnel-status', async (_req, res) => {
    try {
      const { detectCloudflared } = await import('../lib/cloudflared-detect')
      const status = await detectCloudflared()
      res.json({
        ...status,
        configuredUrl: process.env.DASHBOARD_AUTH_TUNNEL_URL || null,
      })
    } catch (err) {
      res.status(500).json({ error: 'check_failed', message: (err as Error).message })
    }
  })

  // V15.0 WS17 — Install Obsidian via package manager OS-detected
  router.post('/install-obsidian', async (_req, res) => {
    const { spawn } = await import('node:child_process')
    const { platform } = await import('node:os')
    const os = platform()
    let cmd: string, args: string[]
    if (os === 'win32') {
      cmd = 'winget'
      args = ['install', 'Obsidian.Obsidian', '--accept-source-agreements', '--accept-package-agreements']
    } else if (os === 'darwin') {
      cmd = 'brew'
      args = ['install', '--cask', 'obsidian']
    } else {
      res.status(501).json({ error: 'unsupported_platform', message: 'Linux: scarica manualmente da obsidian.md/download' })
      return
    }
    let out = ''
    let err = ''
    const proc = spawn(cmd, args, { shell: false })
    proc.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf-8')
    })
    proc.stderr.on('data', (c: Buffer) => {
      err += c.toString('utf-8')
    })
    proc.on('error', (e) => {
      res.status(500).type('text/plain').send(`Failed to spawn: ${e.message}\n${err}`)
    })
    proc.on('exit', (code) => {
      if (code === 0) {
        res.type('text/plain').send(`Install completato.\n\n${out}\n${err}`)
      } else {
        res.status(500).type('text/plain').send(`Install fallito (exit ${code}).\n\n${out}\n${err}`)
      }
    })
    // Timeout di sicurezza 5 min
    setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
    }, 5 * 60_000)
  })

  // V15.0 WS19 — Install Python deps (venv + pip install -r requirements.txt)
  // Concorrenza: lock in-memory previene doppi spawn. Streaming text/plain output.
  router.post('/install-python-deps', async (_req, res) => {
    if (pythonDepsInstallRunning) {
      res.status(409).json({ error: 'install_already_running' })
      return
    }
    pythonDepsInstallRunning = true
    res.type('text/plain; charset=utf-8')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Transfer-Encoding', 'chunked')

    const { fileURLToPath } = await import('node:url')
    const __filename = fileURLToPath(import.meta.url)
    const projectRoot = path.resolve(path.dirname(__filename), '..', '..')
    const venvPath = path.join(projectRoot, 'orchestrator', '.venv')
    const venvPython = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python')
    const venvPip = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'pip.exe')
      : path.join(venvPath, 'bin', 'pip')
    const reqFile = path.join(projectRoot, 'orchestrator', 'requirements.txt')

    // Helper streaming
    function writeLine(line: string): void {
      try {
        res.write(line + '\n')
      } catch {
        /* socket closed */
      }
    }

    function runStep(cmd: string, args: string[], label: string): Promise<number> {
      return new Promise((resolve) => {
        writeLine(`\n→ ${label}`)
        writeLine(`  $ ${cmd} ${args.join(' ')}`)
        const proc = spawn(cmd, args, {
          shell: process.platform === 'win32',
          cwd: projectRoot,
        })
        proc.stdout.on('data', (c: Buffer) => writeLine(c.toString('utf-8').trimEnd()))
        proc.stderr.on('data', (c: Buffer) => writeLine(c.toString('utf-8').trimEnd()))
        proc.on('error', (err) => {
          writeLine(`  ERRORE spawn: ${err.message}`)
          resolve(1)
        })
        proc.on('exit', (code) => {
          writeLine(`  exit=${code ?? 'null'}`)
          resolve(code ?? 1)
        })
        // Safety timeout 5 min per step
        setTimeout(() => {
          try { proc.kill() } catch { /* */ }
        }, 5 * 60_000)
      })
    }

    try {
      // Verifica requirements.txt esiste
      try {
        await fs.access(reqFile)
      } catch {
        writeLine(`ERRORE: ${reqFile} non trovato.`)
        res.end()
        return
      }

      // Step 1: crea venv se mancante
      let venvExists = false
      try {
        await fs.access(venvPython)
        venvExists = true
      } catch {
        /* not found */
      }

      if (!venvExists) {
        writeLine('Creazione venv Python...')
        // Trova python di sistema
        const sysPython = process.platform === 'win32' ? 'python' : 'python3'
        const venvCode = await runStep(sysPython, ['-m', 'venv', venvPath], 'Creazione venv')
        if (venvCode !== 0) {
          writeLine(`\nFAIL: creazione venv fallita (exit ${venvCode}). Verifica che Python sia installato e nel PATH.`)
          res.end()
          return
        }
      } else {
        writeLine(`venv già presente: ${venvPath}`)
      }

      // Step 2: upgrade pip
      const pipUpgradeCode = await runStep(
        venvPython,
        ['-m', 'pip', 'install', '--upgrade', 'pip'],
        'Upgrade pip nel venv'
      )
      if (pipUpgradeCode !== 0) {
        writeLine(`\nWARN: pip upgrade fallito (exit ${pipUpgradeCode}). Provo comunque l'install.`)
      }

      // Step 3: pip install -r requirements.txt
      const installCode = await runStep(
        venvPip,
        ['install', '-r', reqFile],
        'Install requirements.txt'
      )

      if (installCode === 0) {
        writeLine('\n✓ INSTALLAZIONE COMPLETATA')
        writeLine(`  venv: ${venvPath}`)
        writeLine(`  Riavvia il backend (Ctrl+C nel terminale + npm run dev:all) perché orchestrator-client risolva il nuovo venv.`)
        logger.info(`[install-python-deps] success venv=${venvPath}`)
      } else {
        writeLine(`\nFAIL: pip install fallito (exit ${installCode}).`)
        writeLine('Suggerimenti:')
        writeLine('  - Verifica connessione internet')
        writeLine('  - Su Windows assicurati di avere VS Build Tools per pywinpty')
        writeLine(`  - Manuale: ${venvPip} install -r ${reqFile}`)
      }
    } catch (err) {
      writeLine(`\nERRORE imprevisto: ${(err as Error).message}`)
      logger.error('[install-python-deps] unexpected error:', err)
    } finally {
      pythonDepsInstallRunning = false
      try { res.end() } catch { /* */ }
    }
  })

  // V15.0 WS11 — Set tunnel URL in .env.local
  router.post('/tunnel-url', async (req, res) => {
    try {
      const { z } = await import('zod')
      const { updateEnvLocal, setProcessEnv } = await import('../lib/auth/env-writer')
      const Schema = z.object({ url: z.string().url().max(2048) })
      const parsed = Schema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'invalid_url' })
        return
      }
      await updateEnvLocal({ DASHBOARD_AUTH_TUNNEL_URL: parsed.data.url })
      setProcessEnv({ DASHBOARD_AUTH_TUNNEL_URL: parsed.data.url })
      res.json({ ok: true, url: parsed.data.url })
    } catch (err) {
      res.status(500).json({ error: 'env_write_failed', message: (err as Error).message })
    }
  })

  return router
}
