#!/usr/bin/env node
/**
 * V15.0 WS10 — Cross-platform dispatcher per setup-deps.
 *
 * Eseguito da `npm install` via `postinstall` hook in package.json.
 * - Windows  → invoke setup-deps.ps1 (PowerShell)
 * - macOS/Linux → invoke setup-deps.sh (bash)
 *
 * Skip: env SAIO_SKIP_DEPS_CHECK=true (CI, devs esperti).
 * Modalità default --check-only quando lanciato da postinstall (no auto-install
 * forzato durante npm install — solo report). User esegue manuale dopo:
 *   npm run setup:deps
 */
import { spawn } from 'node:child_process'
import { platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

if (process.env.SAIO_SKIP_DEPS_CHECK === 'true') {
  console.log('[setup-deps] SAIO_SKIP_DEPS_CHECK=true → skip')
  process.exit(0)
}

const args = process.argv.slice(2)
const isPostinstall = process.env.npm_lifecycle_event === 'postinstall'
const checkOnly = isPostinstall || args.includes('--check-only')
const autoYes = args.includes('--yes') || args.includes('-y')

const isWindows = platform() === 'win32'
const scriptName = isWindows ? 'setup-deps.ps1' : 'setup-deps.sh'
const scriptPath = path.join(__dirname, scriptName)

let cmd, scriptArgs
if (isWindows) {
  cmd = 'pwsh'
  scriptArgs = ['-NoProfile', '-File', scriptPath]
  if (checkOnly) scriptArgs.push('-CheckOnly')
  if (autoYes) scriptArgs.push('-AutoYes')
} else {
  cmd = 'bash'
  scriptArgs = [scriptPath]
  if (checkOnly) scriptArgs.push('--check-only')
  if (autoYes) scriptArgs.push('--yes')
}

const child = spawn(cmd, scriptArgs, { stdio: 'inherit', shell: false })
child.on('error', (err) => {
  // Se pwsh/bash mancanti, non fallire postinstall (informativo only)
  if (isPostinstall) {
    console.warn('[setup-deps] check skipped:', err.message)
    process.exit(0)
  }
  console.error('[setup-deps] failed to spawn:', err.message)
  process.exit(1)
})
child.on('exit', (code) => {
  process.exit(code || 0)
})
