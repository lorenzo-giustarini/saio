/**
 * V15.0 WS19 — Python deps check + venv resolution + PID alive verify.
 * Usato da orchestrator-client per pre-flight check prima di spawn detached.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

/**
 * Risolve l'eseguibile Python preferendo venv `orchestrator/.venv/Scripts/python.exe`
 * (Win) o `bin/python` (POSIX) se esistente, fallback a `process.env.PYTHON_EXE` o
 * 'python' di sistema.
 *
 * NOTA: usato da orchestrator-client.ts per spawn detached (preferenza venv).
 * Per il deps-check usa `findWorkingPython()` (più robusto, prova candidati multipli).
 */
export async function resolvePythonExe(): Promise<string> {
  const list = await resolvePythonCandidates()
  return list[0] || 'python'
}

/**
 * V15.0 WS20 — Lista ordinata di candidati Python da provare.
 * Priorità: venv > PYTHON_EXE env > python/py/python3 di sistema.
 * Usato da `findWorkingPython()` per detection robusto cross-Python.
 */
export async function resolvePythonCandidates(): Promise<string[]> {
  const candidates: string[] = []
  // Priorità 1: venv (cross-platform)
  const venvWin = path.join(PROJECT_ROOT, 'orchestrator', '.venv', 'Scripts', 'python.exe')
  const venvPosix = path.join(PROJECT_ROOT, 'orchestrator', '.venv', 'bin', 'python')
  for (const v of [venvWin, venvPosix]) {
    try {
      await fs.access(v)
      candidates.push(v)
      break
    } catch {
      /* not found */
    }
  }
  // Priorità 2: env override esplicito
  if (process.env.PYTHON_EXE && !candidates.includes(process.env.PYTHON_EXE)) {
    candidates.push(process.env.PYTHON_EXE)
  }
  // Priorità 3: candidati comuni cross-platform
  if (process.platform === 'win32') {
    candidates.push('python', 'py', 'python3')
  } else {
    candidates.push('python3', 'python3.11', 'python')
  }
  // De-dup mantenendo ordine
  return Array.from(new Set(candidates))
}

/**
 * Verifica che i moduli Python listati siano importabili dall'eseguibile dato.
 * NOTA: `pywinpty` PIP package esporta come modulo `winpty` (importante!).
 * Mappa pacchetti pip → nome modulo Python:
 */
const PIP_TO_MODULE: Record<string, string> = {
  pywinpty: 'winpty',
  psutil: 'psutil',
  watchdog: 'watchdog',
}

export async function checkPythonDeps(
  pyExe: string,
  pipPackages: string[]
): Promise<{ allOk: boolean; missing: string[]; details: Record<string, boolean> }> {
  const moduleNames = pipPackages.map((p) => PIP_TO_MODULE[p] || p)
  const result: Record<string, boolean> = {}
  const missing: string[] = []
  for (let i = 0; i < pipPackages.length; i++) {
    const pip = pipPackages[i]
    const mod = moduleNames[i]
    if (!pip || !mod) continue
    const ok = await runPythonImport(pyExe, mod)
    result[pip] = ok
    if (!ok) missing.push(pip)
  }
  return { allOk: missing.length === 0, missing, details: result }
}

/**
 * V15.0 WS20 — Trova il primo Python di sistema/venv che ha tutte le deps importabili.
 * Prova candidati in ordine (venv > PYTHON_EXE > python/py/python3).
 * Ritorna il primo OK; se nessuno OK ritorna il "least bad" (meno deps mancanti).
 * Usato da /api/system/deps-check per evitare false-positive quando il backend
 * gira con un PATH diverso e raggiunge un Python senza pywinpty.
 */
export interface FindPythonResult {
  exe: string
  allOk: boolean
  missing: string[]
  tried: Array<{ exe: string; missing: string[] }>
}

export async function findWorkingPython(pipPackages: string[]): Promise<FindPythonResult> {
  const candidates = await resolvePythonCandidates()
  const tried: Array<{ exe: string; missing: string[] }> = []
  let bestResult: { exe: string; missing: string[] } | null = null
  for (const exe of candidates) {
    const result = await checkPythonDeps(exe, pipPackages)
    tried.push({ exe, missing: result.missing })
    if (result.allOk) {
      return { exe, allOk: true, missing: [], tried }
    }
    if (!bestResult || result.missing.length < bestResult.missing.length) {
      bestResult = { exe, missing: result.missing }
    }
  }
  return {
    exe: bestResult?.exe || candidates[0] || 'python',
    allOk: false,
    missing: bestResult?.missing || pipPackages,
    tried,
  }
}

function runPythonImport(pyExe: string, moduleName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn(pyExe, ['-c', `import ${moduleName}`], { shell: false })
    proc.on('error', () => resolve(false))
    proc.on('exit', (code) => resolve(code === 0))
    setTimeout(() => {
      try {
        proc.kill()
      } catch {
        /* ignore */
      }
      resolve(false)
    }, 5000)
  })
}

/**
 * Verifica se un PID è ancora vivo (cross-platform).
 * Usa process.kill(pid, 0) — non manda davvero kill, solo signal probe.
 */
export function isPidAlive(pid: number | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
