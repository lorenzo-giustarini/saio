import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { sanitizeProjectId } from '../lib/sanitize'
import { ptyManager } from '../lib/pty-manager'

// Strip ANSI for text display
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '').replace(/\r\n/g, '\n')
}

export function logsRouter(dataDir: string) {
  const router = Router()
  const logsDir = path.join(dataDir, 'logs')

  // Polling read (keeps backward compat with old LogDrawer)
  router.get('/:id/stream', async (req, res) => {
    try {
      const id = sanitizeProjectId(req.params.id)
      const fp = path.join(logsDir, `${id}.log`)

      // Prefer live PTY buffer if session is active (fresher)
      const session = ptyManager.get(id)
      if (session && session.buffer.length > 0) {
        const live = stripAnsi(session.buffer.join(''))
        return res.type('text/plain').send(live)
      }

      // Fallback to persisted log file
      try {
        const content = await fs.readFile(fp, 'utf8')
        res.type('text/plain').send(content || '(log vuoto)')
      } catch {
        res.type('text/plain').status(404).send('(nessun log per questa sessione)')
      }
    } catch (err) {
      res.status(400).json({ error: String(err) })
    }
  })

  // SSE tail — pushes new lines as they're written
  router.get('/:id/stream-sse', async (req, res) => {
    const id = req.params.id.replace(/[^a-zA-Z0-9_-]/g, '')
    if (!id) return res.status(400).end()

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders()

    const sendEvent = (type: string, payload: any) => {
      try {
        res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)
      } catch {
        /* socket closed */
      }
    }

    // Send initial buffer (PTY active or file)
    const session = ptyManager.get(id)
    if (session && session.buffer.length > 0) {
      sendEvent('initial', { source: 'pty', data: stripAnsi(session.buffer.join('')) })
    } else {
      try {
        const content = await fs.readFile(path.join(logsDir, `${id}.log`), 'utf8')
        sendEvent('initial', { source: 'file', data: content })
      } catch {
        sendEvent('initial', { source: 'empty', data: '' })
      }
    }

    // Live-subscribe to PTY listener if session exists
    let onData: ((d: string) => void) | null = null
    if (session) {
      onData = (d: string) => sendEvent('data', { data: stripAnsi(d) })
      session.listeners.add(onData)
    }

    // Heartbeat every 15s
    const heartbeat = setInterval(() => {
      try { res.write(`: ping ${Date.now()}\n\n`) } catch { /* ignore */ }
    }, 15_000)

    req.on('close', () => {
      clearInterval(heartbeat)
      if (session && onData) session.listeners.delete(onData)
    })
  })

  return router
}
