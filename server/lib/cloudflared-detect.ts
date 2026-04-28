/**
 * V15.0 WS11 — Detect cloudflared CLI + tunnel status.
 * Subprocess minimi, timeout aggressivi (UX deve essere veloce).
 */
import { spawn } from 'node:child_process'

interface CloudflaredStatus {
  installed: boolean
  version?: string
  tunnels: Array<{ id: string; name: string; createdAt?: string }>
  loggedIn: boolean
  error?: string
}

function runCmd(cmd: string, args: string[], timeoutMs = 5000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { shell: false })
    let out = ''
    let err = ''
    p.stdout.on('data', (c: Buffer) => {
      out += c.toString('utf-8')
    })
    p.stderr.on('data', (c: Buffer) => {
      err += c.toString('utf-8')
    })
    p.on('error', () => resolve({ code: -1, out: '', err: 'spawn_error' }))
    p.on('exit', (code) => resolve({ code: code ?? 0, out, err }))
    setTimeout(() => {
      try {
        p.kill()
      } catch {
        /* ignore */
      }
      resolve({ code: -2, out: '', err: 'timeout' })
    }, timeoutMs)
  })
}

export async function detectCloudflared(): Promise<CloudflaredStatus> {
  // 1. installed?
  const ver = await runCmd('cloudflared', ['--version'])
  if (ver.code !== 0) {
    return { installed: false, tunnels: [], loggedIn: false, error: ver.err }
  }
  const version = (ver.out || ver.err).trim().split('\n')[0]

  // 2. tunnel list (mostra solo se l'utente è loggato)
  const list = await runCmd('cloudflared', ['tunnel', 'list', '--output', 'json'])
  if (list.code !== 0) {
    // Esce con errore se non loggato
    return { installed: true, version, tunnels: [], loggedIn: false }
  }
  let tunnels: Array<{ id: string; name: string; createdAt?: string }> = []
  try {
    const arr = JSON.parse(list.out) as Array<{ id: string; name: string; created_at?: string }>
    tunnels = arr.map((t) => ({ id: t.id, name: t.name, createdAt: t.created_at }))
  } catch {
    /* ignore parse error */
  }
  return { installed: true, version, tunnels, loggedIn: true }
}
