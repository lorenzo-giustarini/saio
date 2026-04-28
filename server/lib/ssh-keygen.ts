import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

/**
 * V14.28 — wrapper ssh-keygen.exe per generare coppia ed25519 senza passphrase
 * (uso programmatico). Output in ~/.ssh/<keyName> + ~/.ssh/<keyName>.pub.
 * Commento finale tipo "saio@localhost-<vpsId>-<YYYYMMDD>"
 * (formato standard che provider tipo Hetzner/DigitalOcean si aspettano).
 */

export interface KeygenResult {
  privateKeyPath: string
  publicKeyPath: string
  publicKeyContent: string
  comment: string
  algorithm: 'ed25519'
}

const KEY_ID_REGEX = /^[a-zA-Z0-9._-]{3,64}$/

export async function generateSshKeyPair(opts: {
  keyName: string
  comment?: string
  email?: string
  vpsId?: string
}): Promise<KeygenResult> {
  if (!KEY_ID_REGEX.test(opts.keyName)) {
    throw new Error('keyName: 3-64 char alphanum/dot/underscore/dash')
  }

  const sshDir = path.join(os.homedir(), '.ssh')
  await fs.mkdir(sshDir, { recursive: true })

  const privateKeyPath = path.join(sshDir, opts.keyName)
  const publicKeyPath = `${privateKeyPath}.pub`

  // Verifica non esista già (no overwrite silenzioso)
  try {
    await fs.access(privateKeyPath)
    throw new Error(`Chiave già esistente: ${privateKeyPath}. Scegli un nome diverso o rimuovi prima.`)
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err
  }

  // Comment standard
  const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const baseEmail = opts.email || 'saio@localhost'
  const comment =
    opts.comment ||
    (opts.vpsId ? `${baseEmail}-${opts.vpsId}-${ts}` : `${baseEmail}-${ts}`)

  // ssh-keygen -t ed25519 -f <path> -N "" -C "<comment>"
  // -N "" = no passphrase, -C = comment, -t ed25519 = algoritmo moderno
  try {
    await execFileAsync(
      'ssh-keygen',
      ['-t', 'ed25519', '-f', privateKeyPath, '-N', '', '-C', comment],
      { encoding: 'utf-8', timeout: 15_000 }
    )
  } catch (err: any) {
    logger.error(`ssh-keygen failed: ${err.message}`)
    throw new Error(`ssh-keygen non riuscito: ${err.message}`)
  }

  // Lettura pubblica (privata MAI letta)
  const publicKeyContent = (await fs.readFile(publicKeyPath, 'utf-8')).trim()

  // Su Linux/Mac chmod 600. Su Windows ssh-keygen gestisce ACL automaticamente.
  if (process.platform !== 'win32') {
    try {
      await fs.chmod(privateKeyPath, 0o600)
    } catch {
      /* best-effort */
    }
  }

  return {
    privateKeyPath,
    publicKeyPath,
    publicKeyContent,
    comment,
    algorithm: 'ed25519',
  }
}

/**
 * Test SSH connection con timeout breve. Non salva nulla, solo verifica connettività.
 */
export interface SshTestResult {
  ok: boolean
  latencyMs?: number
  hostname?: string
  error?: string
}

export async function testSshConnection(opts: {
  ip: string
  user: string
  keyName: string
  timeoutSec?: number
}): Promise<SshTestResult> {
  const sshDir = path.join(os.homedir(), '.ssh')
  const keyPath = path.join(sshDir, opts.keyName)

  // Verifica chiave esista
  try {
    await fs.access(keyPath)
  } catch {
    return { ok: false, error: `Chiave non trovata: ${keyPath}` }
  }

  const timeout = opts.timeoutSec || 8
  const start = Date.now()

  // ssh con StrictHostKeyChecking=accept-new per non bloccarsi sul prompt
  // -o BatchMode=yes per non chiedere password (fallisce subito se key non funziona)
  // -o ConnectTimeout per timeout TCP
  // Esegue `hostname` remoto per verifica
  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-i', keyPath,
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        '-o', `ConnectTimeout=${timeout}`,
        '-o', 'ServerAliveInterval=3',
        `${opts.user}@${opts.ip}`,
        'hostname',
      ],
      { encoding: 'utf-8', timeout: (timeout + 5) * 1000 }
    )
    const latencyMs = Date.now() - start
    return { ok: true, latencyMs, hostname: stdout.trim() }
  } catch (err: any) {
    const latencyMs = Date.now() - start
    const stderr = err.stderr || err.message || 'unknown error'
    return {
      ok: false,
      latencyMs,
      error: String(stderr).slice(0, 300),
    }
  }
}
