/**
 * V15.0 WS19 — Diagnostic CLI per orchestrator pipeline.
 *
 * Uso:
 *   npm run diag:orchestrator
 *
 * Output:
 *   - Python interpreter risolto (venv vs sistema)
 *   - Status import: psutil, watchdog, pywinpty (Win)
 *   - Lista ultimi 5 log spawn orchestrator + tail
 *   - Suggerimento fix concreto
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')

const REQUIRED_DEPS = process.platform === 'win32'
  ? ['psutil', 'watchdog', 'pywinpty']
  : ['psutil', 'watchdog']

const PIP_TO_MODULE: Record<string, string> = {
  pywinpty: 'winpty',
  psutil: 'psutil',
  watchdog: 'watchdog',
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function resolvePythonExe(): Promise<{ exe: string; source: string }> {
  const venvWin = path.join(PROJECT_ROOT, 'orchestrator', '.venv', 'Scripts', 'python.exe')
  const venvPosix = path.join(PROJECT_ROOT, 'orchestrator', '.venv', 'bin', 'python')
  if (await fileExists(venvWin)) return { exe: venvWin, source: 'venv (Windows)' }
  if (await fileExists(venvPosix)) return { exe: venvPosix, source: 'venv (POSIX)' }
  if (process.env.PYTHON_EXE) return { exe: process.env.PYTHON_EXE, source: 'env PYTHON_EXE' }
  return { exe: 'python', source: 'PATH (sistema)' }
}

function checkImport(pyExe: string, moduleName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(pyExe, ['-c', `import ${moduleName}`], { shell: false })
    proc.on('error', () => resolve(false))
    proc.on('exit', (code) => resolve(code === 0))
    setTimeout(() => {
      try { proc.kill() } catch { /* */ }
      resolve(false)
    }, 5000)
  })
}

function getPythonVersion(pyExe: string): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    const proc = spawn(pyExe, ['--version'], { shell: false })
    proc.stdout.on('data', (c: Buffer) => (out += c.toString('utf-8')))
    proc.stderr.on('data', (c: Buffer) => (out += c.toString('utf-8')))
    proc.on('error', () => resolve('error'))
    proc.on('exit', () => resolve(out.trim() || 'unknown'))
    setTimeout(() => {
      try { proc.kill() } catch { /* */ }
      resolve('timeout')
    }, 3000)
  })
}

interface LogEntry {
  file: string
  mtime: Date
  size: number
}

async function listSpawnLogs(): Promise<LogEntry[]> {
  const logsDir = path.join(PROJECT_ROOT, 'data', 'logs')
  try {
    const files = await fs.readdir(logsDir)
    const orchLogs = files.filter((f) => f.startsWith('orchestrator-spawn-'))
    const entries = await Promise.all(
      orchLogs.map(async (f) => {
        const fp = path.join(logsDir, f)
        const stat = await fs.stat(fp)
        return { file: fp, mtime: stat.mtime, size: stat.size }
      })
    )
    return entries.sort((a, b) => b.mtime.getTime() - a.mtime.getTime()).slice(0, 5)
  } catch {
    return []
  }
}

async function main(): Promise<void> {
  console.log('')
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('  SAIO Orchestrator Diagnostic — V15.0 WS19')
  console.log('═══════════════════════════════════════════════════════════════════════')
  console.log('')

  // ─────── 1. Python resolve ───────
  const { exe, source } = await resolvePythonExe()
  console.log(`Python interpreter: ${exe}`)
  console.log(`  Source: ${source}`)
  const pyVer = await getPythonVersion(exe)
  console.log(`  Version: ${pyVer}`)
  console.log('')

  // ─────── 2. Import checks ───────
  console.log(`Required dependencies (${REQUIRED_DEPS.length}):`)
  let allOk = true
  const missing: string[] = []
  for (const pip of REQUIRED_DEPS) {
    const mod = PIP_TO_MODULE[pip] || pip
    const ok = await checkImport(exe, mod)
    const icon = ok ? '✓' : '✗'
    const note = pip !== mod ? ` (pip=${pip}, import=${mod})` : ''
    console.log(`  ${icon} ${pip}${note}`)
    if (!ok) {
      allOk = false
      missing.push(pip)
    }
  }
  console.log('')

  // ─────── 3. Last 5 spawn logs ───────
  const logs = await listSpawnLogs()
  if (logs.length === 0) {
    console.log('Spawn logs: (nessuno trovato in data/logs/orchestrator-spawn-*.log)')
  } else {
    console.log(`Last ${logs.length} spawn logs:`)
    for (const log of logs) {
      console.log(`  ${log.mtime.toISOString()} (${log.size}b) ${path.basename(log.file)}`)
    }
    console.log('')
    console.log('Tail of latest spawn log:')
    console.log('─'.repeat(70))
    const latest = logs[0]!
    try {
      const content = await fs.readFile(latest.file, 'utf-8')
      const tail = content.slice(-500)
      console.log(tail || '(empty)')
    } catch (err) {
      console.log(`  cannot read: ${(err as Error).message}`)
    }
    console.log('─'.repeat(70))
  }
  console.log('')

  // ─────── 4. Suggested fix ───────
  if (allOk) {
    console.log('✓ Tutte le dipendenze Python sono importabili.')
    console.log('')
    console.log('Se l\'orchestrator ancora non funziona:')
    console.log('  - Riavvia il backend (Ctrl+C + npm run dev:all)')
    console.log('  - Verifica che data/orchestrator.health sia recente (< 60s)')
    console.log('  - Lancia: cat data/orchestrator.health')
  } else {
    console.log(`✗ Mancano ${missing.length} deps: ${missing.join(', ')}`)
    console.log('')
    console.log('Fix:')
    console.log('  1. npm run setup:deps                     # auto-install via venv')
    console.log('     OPPURE')
    console.log('  2. Tramite UI: Inbox → banner giallo → "Installa Python deps automaticamente"')
    console.log('     OPPURE')
    console.log('  3. Manuale:')
    console.log(`     python -m venv ${path.join(PROJECT_ROOT, 'orchestrator', '.venv')}`)
    if (process.platform === 'win32') {
      console.log(`     ${path.join(PROJECT_ROOT, 'orchestrator', '.venv', 'Scripts', 'pip.exe')} install -r ${path.join(PROJECT_ROOT, 'orchestrator', 'requirements.txt')}`)
    } else {
      console.log(`     ${path.join(PROJECT_ROOT, 'orchestrator', '.venv', 'bin', 'pip')} install -r ${path.join(PROJECT_ROOT, 'orchestrator', 'requirements.txt')}`)
    }
    console.log('')
    console.log('Dopo install: riavvia backend (Ctrl+C + npm run dev:all)')
  }
  console.log('')

  process.exit(allOk ? 0 : 1)
}

main().catch((err) => {
  console.error('Diagnostic error:', err)
  process.exit(2)
})
