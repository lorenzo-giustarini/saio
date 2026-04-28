/**
 * V15.0 WS3-3D — Cron bypass per endpoint legacy che usano X-Cron-Token.
 *
 * Mantiene UNCHANGED il flow `verifyCronToken` esistente di
 * server/routes/error-pipeline.ts (che si auto-protegge), e per /api/cron/* aggiunge
 * un combinato: accept X-Cron-Token OR (JWT + role:owner).
 *
 * Setta req.skipAuth=true se X-Cron-Token valido, così l'umbrella requireAuth
 * può saltare. Se token mancante, prosegue → cadrà su requireAuth → 401.
 */
import type { Request, Response, NextFunction } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'

declare module 'express-serve-static-core' {
  interface Request {
    skipAuth?: boolean
  }
}

let cachedToken: string | null = null

async function getCronToken(): Promise<string | null> {
  if (cachedToken) return cachedToken
  // Same path used by server/routes/error-pipeline.ts:17
  const tokenFile = path.join(process.cwd(), 'data', '.cron-token')
  try {
    const content = await fs.readFile(tokenFile, 'utf-8')
    const trimmed = content.trim()
    if (trimmed.length > 0) {
      cachedToken = trimmed
      return cachedToken
    }
  } catch {
    /* file missing → not yet generated */
  }
  return null
}

/**
 * Marca request come "auth bypassed" se X-Cron-Token combacia col token su disco.
 * NON ritorna 401 da solo: lascia eventuale fallback a requireAuth (per /api/cron
 * con utente owner loggato).
 */
export async function cronTokenOrAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const headerToken = req.headers['x-cron-token']
  if (typeof headerToken === 'string' && headerToken.length > 0) {
    const stored = await getCronToken()
    if (stored && headerToken === stored) {
      req.skipAuth = true
    }
  }
  next()
}
