#!/usr/bin/env node
/**
 * check-vite-cache.mjs — Pre-dev validator cross-platform (V15.9 WS39)
 *
 * Cross-platform port di scripts/check-vite-cache.ps1 (V15.4 WS34).
 * Scansiona node_modules/.vite/deps/*.js per NULL byte prefix (corruzione
 * classica su Windows da kill durante optimizeDeps + cache stale browser).
 * Auto-clear cache se rileva corruzione.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const VITE_CACHE = path.resolve(__dirname, '..', 'node_modules', '.vite', 'deps')

if (!fs.existsSync(VITE_CACHE)) {
  console.log('[vite-cache] cache non esistente, skip (Vite la creera al boot)')
  process.exit(0)
}

const files = fs.readdirSync(VITE_CACHE).filter((f) => f.endsWith('.js'))
if (files.length === 0) {
  console.log('[vite-cache] cache vuota, OK')
  process.exit(0)
}

const corrupted = []
for (const f of files) {
  try {
    const fd = fs.openSync(path.join(VITE_CACHE, f), 'r')
    const buf = Buffer.alloc(16)
    const n = fs.readSync(fd, buf, 0, 16, 0)
    fs.closeSync(fd)
    if (n < 4) continue
    let nullCount = 0
    for (let i = 0; i < Math.min(n, 16); i++) if (buf[i] === 0) nullCount++
    if (buf[0] === 0 || nullCount >= 8) corrupted.push(f)
  } catch {
    /* skip */
  }
}

if (corrupted.length > 0) {
  console.log(`[vite-cache] CORRUZIONE rilevata in ${corrupted.length} file:`)
  for (const f of corrupted.slice(0, 5)) console.log(`  - ${f}`)
  if (corrupted.length > 5) console.log(`  ... e altri ${corrupted.length - 5}`)
  console.log('[vite-cache] AUTO-CLEAR cache...')
  const cacheRoot = path.resolve(__dirname, '..', 'node_modules', '.vite')
  fs.rmSync(cacheRoot, { recursive: true, force: true })
  console.log('[vite-cache] cache pulita, Vite ricostruira al prossimo dev')
} else {
  console.log(`[vite-cache] ${files.length} file OK, no corruption`)
}
process.exit(0)
