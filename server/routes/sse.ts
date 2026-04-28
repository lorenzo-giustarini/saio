import { Router, type Response } from 'express'
import type { FileEvent } from '../lib/filewatch'
import { logger } from '../lib/logger'

const clients = new Set<Response>()

export function broadcastEvent(event: FileEvent) {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of clients) {
    try {
      client.write(data)
    } catch {
      clients.delete(client)
    }
  }
}

export function eventsRouter() {
  const router = Router()

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`)

    clients.add(res)
    logger.debug(`[SSE] Client connected, total: ${clients.size}`)

    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`)
      } catch {
        clearInterval(heartbeat)
      }
    }, 15_000)

    req.on('close', () => {
      clearInterval(heartbeat)
      clients.delete(res)
      logger.debug(`[SSE] Client disconnected, total: ${clients.size}`)
    })
  })

  return router
}
