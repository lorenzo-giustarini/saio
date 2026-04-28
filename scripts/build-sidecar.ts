/**
 * build-sidecar.ts — Bundle Express server come single-file binary per Tauri sidecar
 * (V15.9 WS39 Microtask 9)
 *
 * Output: src-tauri/binaries/saio-server-{platform}{ext}
 *   - Win:   src-tauri/binaries/saio-server-x86_64-pc-windows-msvc.exe
 *   - Linux: src-tauri/binaries/saio-server-x86_64-unknown-linux-gnu
 *   - macOS: src-tauri/binaries/saio-server-aarch64-apple-darwin (Apple Silicon)
 *           src-tauri/binaries/saio-server-x86_64-apple-darwin (Intel)
 *
 * Pattern: esbuild bundle TS+deps in un single .js, poi pkg/Node-SEA produce eseguibile.
 * Per ora stub: usiamo Node runtime portable + bundle .js (più semplice, +30MB ma funziona).
 */
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(REPO_ROOT, 'src-tauri', 'binaries')

async function main(): Promise<void> {
  await fs.mkdir(OUT_DIR, { recursive: true })

  const platform = process.platform
  const triplet = getTriplet(platform)
  const ext = platform === 'win32' ? '.exe' : ''
  const outFile = path.join(OUT_DIR, `saio-server-${triplet}${ext}.js`)

  console.log(`Bundling Express server → ${outFile}`)

  await build({
    entryPoints: [path.join(REPO_ROOT, 'server', 'index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: outFile,
    minify: false,
    sourcemap: false,
    external: [
      // node-pty richiede native binding, NO bundle
      'node-pty',
      // bcrypt native
      'bcryptjs',
      // multer native
      'multer',
    ],
    define: { 'process.env.NODE_ENV': '"production"' },
  })

  // Crea wrapper script che lancia Node + il bundle
  const wrapper = `#!/usr/bin/env node\nrequire('./saio-server-${triplet}${ext}.js')\n`
  const wrapperFile = path.join(OUT_DIR, `saio-server-${triplet}${ext}`)
  await fs.writeFile(wrapperFile, wrapper, { mode: 0o755 })

  console.log(`Bundle complete: ${outFile}`)
  console.log(`Wrapper: ${wrapperFile}`)
  console.log('Note: requires Node.js installed on target system OR bundle node-portable separately')
}

function getTriplet(platform: NodeJS.Platform): string {
  const arch = process.arch
  switch (platform) {
    case 'win32':
      return arch === 'x64' ? 'x86_64-pc-windows-msvc' : 'i686-pc-windows-msvc'
    case 'linux':
      return arch === 'x64' ? 'x86_64-unknown-linux-gnu' : 'aarch64-unknown-linux-gnu'
    case 'darwin':
      return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

main().catch((err) => {
  console.error('[build-sidecar]', err)
  process.exit(1)
})
