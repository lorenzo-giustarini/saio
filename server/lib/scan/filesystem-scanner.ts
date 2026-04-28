/**
 * V15.0 WS13 — Filesystem scanner sicuro.
 *
 * Walk directory limitato:
 *  - Whitelist root paths (~/, ~/Desktop, ~/Documents, custom)
 *  - Max depth 4 livelli (no recursion infinita)
 *  - Skip patterns: node_modules, .git interni (oltre root match), .venv,
 *    __pycache__, dist, build, .next, .nuxt, .turbo, target, .cache, vendor
 *  - Stop espansione subdirectory una volta trovata una match (es. trovi un git
 *    repo, non scendi più in profondità per evitare submodules e progetti interni)
 *  - Timeout globale 60s, abort se supera
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { detectAll, type Detected } from './detectors'

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.venv',
  '.env',
  'venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  'target',
  '.cache',
  'vendor',
  '.svelte-kit',
  '.vercel',
  '.netlify',
  'coverage',
  '.idea',
  '.vscode-server',
  'AppData',
  'Library',
  'Applications',
  'System',
  'Windows',
  'Program Files',
  'Program Files (x86)',
])

// V15.0 WS16 — 3 modalità scan
type ScanMode = 'quick' | 'deep' | 'targeted'

const MODE_CONFIG: Record<ScanMode, { maxDepth: number; maxDirs: number; timeoutMs: number }> = {
  quick: { maxDepth: 4, maxDirs: 5000, timeoutMs: 60_000 },
  deep: { maxDepth: 8, maxDirs: 10_000, timeoutMs: 15 * 60_000 }, // 15 min
  targeted: { maxDepth: 8, maxDirs: 10_000, timeoutMs: 5 * 60_000 }, // 5 min
}

export interface ScanRequest {
  rootPaths: string[]
  mode?: ScanMode
  targetNames?: string[] // solo per mode='targeted'
}

export interface ScanResult {
  found: Detected[]
  scannedDirs: number
  abortedReason?: 'timeout' | 'max_dirs'
  mode: ScanMode
}

export async function defaultRootPaths(): Promise<string[]> {
  const home = os.homedir()
  const candidates = [
    path.join(home, 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Projects'),
    path.join(home, 'workspace'),
    path.join(home, 'src'),
    path.join(home, 'code'),
    path.join(home, 'dev'),
    home, // depth 0 only
  ]
  const exists: string[] = []
  for (const c of candidates) {
    try {
      const st = await fs.stat(c)
      if (st.isDirectory()) exists.push(c)
    } catch {
      /* not exists */
    }
  }
  return exists
}

export async function scanFilesystem(req: ScanRequest): Promise<ScanResult> {
  const mode: ScanMode = req.mode || 'quick'
  const cfg = MODE_CONFIG[mode]
  const targetNamesLower = (req.targetNames || []).map((n) => n.toLowerCase())
  const startTime = Date.now()
  const found: Detected[] = []
  let scannedDirs = 0
  let aborted: 'timeout' | 'max_dirs' | undefined

  async function walk(dir: string, depth: number): Promise<void> {
    if (aborted) return
    if (Date.now() - startTime > cfg.timeoutMs) {
      aborted = 'timeout'
      return
    }
    if (scannedDirs >= cfg.maxDirs) {
      aborted = 'max_dirs'
      return
    }
    if (depth > cfg.maxDepth) return

    scannedDirs++

    // V15.0 WS16 — Targeted mode: skip detect se il nome cartella non matcha
    const dirName = path.basename(dir).toLowerCase()
    const isTargetMatch =
      mode !== 'targeted' ||
      targetNamesLower.length === 0 ||
      targetNamesLower.some((t) => dirName.includes(t))

    // Detect: se troviamo un git/vault/etc su questa cartella, fermiamo discesa
    const detected = isTargetMatch ? await detectAll(dir) : []
    if (detected.length > 0) {
      const existing = new Set(found.map((f) => f.path))
      for (const d of detected) {
        if (!existing.has(d.path)) found.push(d)
      }
      // Se è un repo git o vault, NON scendiamo più (no submodules / vault interni)
      if (detected.some((d) => d.kind === 'git' || d.kind === 'obsidian-vault')) {
        return
      }
    }

    // Continua walk solo se non abbiamo trovato match "terminator"
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name)) continue
      if (entry.name.startsWith('.') && entry.name !== '.claude') continue
      const subPath = path.join(dir, entry.name)
      await walk(subPath, depth + 1)
      if (aborted) return
    }
  }

  for (const root of req.rootPaths) {
    if (aborted) break
    const home = os.homedir()
    const abs = path.resolve(root)
    if (!abs.startsWith(home)) continue
    await walk(abs, 0)
  }

  return { found, scannedDirs, abortedReason: aborted, mode }
}
