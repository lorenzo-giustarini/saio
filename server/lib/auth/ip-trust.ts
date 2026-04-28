/**
 * V15.0 WS3-3D — Client IP detection dietro Cloudflare Tunnel.
 *
 * cloudflared gira sulla stessa VPS e inoltra a 127.0.0.1, settando:
 *  - CF-Connecting-IP: IP reale del client (preferito)
 *  - X-Forwarded-For: catena, primo elemento = client
 *
 * Senza questa logica, req.ip sarebbe sempre 127.0.0.1 e i rate-limit per-IP
 * non funzionerebbero su VPS in produzione.
 */
import type { Request } from 'express'
import crypto from 'node:crypto'
import { trustCloudflare } from './constants'

export function getClientIp(req: Request): string {
  if (trustCloudflare()) {
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf.length > 0) return cf.trim()
  }
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]
    if (first) return first.trim()
  }
  return req.socket.remoteAddress || '127.0.0.1'
}

/**
 * Hash User-Agent per evitare di salvarlo in chiaro nei log auth (privacy).
 * Tronca a 32 char per leggibilità nei dump JSON.
 */
export function hashUserAgent(req: Request): string {
  const ua = (req.headers['user-agent'] || '').toString()
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 32)
}
