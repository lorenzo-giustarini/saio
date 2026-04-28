/**
 * V15.0 WS13 — Detector per identificare tipo di progetto/risorsa in una cartella.
 * Ogni detector è async e ritorna metadata se matcha, null altrimenti.
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export type DetectedKind =
  | 'git'
  | 'obsidian-vault'
  | 'node-project'
  | 'python-project'
  | 'claude-agents'
  | 'mcp-config'

export interface Detected {
  kind: DetectedKind
  path: string
  name: string
  meta: Record<string, unknown>
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function readJsonSafe<T = unknown>(p: string): Promise<T | null> {
  try {
    const txt = await fs.readFile(p, 'utf-8')
    return JSON.parse(txt) as T
  } catch {
    return null
  }
}

/**
 * Esegue tutti i detector sulla cartella e ritorna le risorse trovate.
 * Una cartella può matchare più tipi (es. node-project + git contemporaneamente).
 */
export async function detectAll(dirPath: string): Promise<Detected[]> {
  const found: Detected[] = []
  const name = path.basename(dirPath)

  // git
  if (await fileExists(path.join(dirPath, '.git'))) {
    found.push({ kind: 'git', path: dirPath, name, meta: {} })
  }

  // obsidian vault
  if (await fileExists(path.join(dirPath, '.obsidian'))) {
    found.push({ kind: 'obsidian-vault', path: dirPath, name, meta: {} })
  }

  // node project
  const pkgPath = path.join(dirPath, 'package.json')
  if (await fileExists(pkgPath)) {
    const pkg = await readJsonSafe<{ name?: string; description?: string; scripts?: Record<string, string> }>(pkgPath)
    if (pkg) {
      found.push({
        kind: 'node-project',
        path: dirPath,
        name: pkg.name || name,
        meta: {
          description: pkg.description,
          scripts: pkg.scripts ? Object.keys(pkg.scripts) : [],
        },
      })
    }
  }

  // python project
  if (
    (await fileExists(path.join(dirPath, 'pyproject.toml'))) ||
    (await fileExists(path.join(dirPath, 'requirements.txt'))) ||
    (await fileExists(path.join(dirPath, 'setup.py')))
  ) {
    found.push({
      kind: 'python-project',
      path: dirPath,
      name,
      meta: {
        hasPyproject: await fileExists(path.join(dirPath, 'pyproject.toml')),
        hasRequirements: await fileExists(path.join(dirPath, 'requirements.txt')),
      },
    })
  }

  // claude agents (cartella .claude/ con agents/skills)
  if (await fileExists(path.join(dirPath, '.claude'))) {
    const agentsPath = path.join(dirPath, '.claude', 'agents')
    const skillsPath = path.join(dirPath, '.claude', 'skills')
    let agentCount = 0
    let skillCount = 0
    try {
      const entries = await fs.readdir(agentsPath, { withFileTypes: true })
      agentCount = entries.filter((e) => e.isFile() && e.name.endsWith('.md')).length
    } catch {
      /* no agents dir */
    }
    try {
      const entries = await fs.readdir(skillsPath, { withFileTypes: true })
      skillCount = entries.filter((e) => e.isDirectory()).length
    } catch {
      /* no skills dir */
    }
    if (agentCount > 0 || skillCount > 0) {
      found.push({
        kind: 'claude-agents',
        path: dirPath,
        name,
        meta: { agentCount, skillCount },
      })
    }
  }

  // mcp config
  if (await fileExists(path.join(dirPath, '.mcp.json'))) {
    const mcp = await readJsonSafe<{ mcpServers?: Record<string, unknown> }>(
      path.join(dirPath, '.mcp.json')
    )
    if (mcp) {
      found.push({
        kind: 'mcp-config',
        path: dirPath,
        name,
        meta: { servers: Object.keys(mcp.mcpServers || {}) },
      })
    }
  }

  return found
}
