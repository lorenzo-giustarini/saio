import fs from 'node:fs'
import path from 'node:path'
import { logger } from './logger'

const SUBDIRS = [
  'briefs',
  'responses',
  'tasks',
  'locks',
  'archive',
  'logs',
  'projects',
  'metrics',
  'feedback',
  'commands',
  'kickoffs',
  'auth', // V15.0 WS3 — single-owner auth state (claim, sessions, totp, recovery codes, audit)
]

export function ensureDataDirs(dataDir: string) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    logger.info(`Created data dir: ${dataDir}`)
  }
  for (const sub of SUBDIRS) {
    const p = path.join(dataDir, sub)
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true })
    }
  }
}
