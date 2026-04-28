/**
 * build-sidecar.ts — Bundle Express server into a single JS file for Tauri sidecar
 * (V15.9 WS42 M11.3)
 *
 * Output: src-tauri/binaries/saio-server.cjs (single file, ~5 MB)
 *
 * The bundle is launched at runtime by a portable Node binary that Tauri ships
 * as `externalBin: ["binaries/node"]`. The lib.rs spawns it via:
 *     app.shell().sidecar("node").args(["resources/saio-server.cjs"]).spawn()
 *
 * Native modules (node-pty, bcrypt) are kept external. Their prebuilt .node
 * files are copied into the bundle.resources by tauri-action / cargo tauri build
 * via the `bundle.resources` glob in tauri.conf.json.
 */
import { build } from 'esbuild'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const REPO_ROOT = path.resolve(__dirname, '..')
const BIN_DIR = path.join(REPO_ROOT, 'src-tauri', 'binaries')

async function main(): Promise<void> {
  await fs.mkdir(BIN_DIR, { recursive: true })
  const outFile = path.join(BIN_DIR, 'saio-server.cjs')

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
      // Native modules with prebuilt .node bindings — keep external,
      // Tauri ships their parent dirs via bundle.resources
      'node-pty',
      'bcrypt',
    ],
    define: {
      'process.env.NODE_ENV': '"production"',
      // CJS shim: code uses `fileURLToPath(import.meta.url)`; replace with global var
      // that we initialize in banner.
      'import.meta.url': '__saio_meta_url',
    },
    banner: {
      js: 'var __saio_meta_url = require("url").pathToFileURL(__filename).href;',
    },
    // Resolve TypeScript paths
    tsconfig: path.join(REPO_ROOT, 'tsconfig.json'),
  })

  // Cleanup any old per-platform stub from V15.9 WS39 M2
  for (const stale of ['saio-server-x86_64-pc-windows-msvc.exe', 'saio-server-x86_64-pc-windows-msvc.exe.js']) {
    await fs.unlink(path.join(BIN_DIR, stale)).catch(() => {})
  }

  const stat = await fs.stat(outFile)
  console.log(`Bundle complete: ${outFile} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`)
  console.log('External native modules: node-pty, bcrypt (shipped via bundle.resources)')
  console.log('Run with: <node-portable> saio-server.cjs')
}

main().catch((err) => {
  console.error('[build-sidecar]', err)
  process.exit(1)
})
