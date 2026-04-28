import { WebSocketServer, WebSocket } from 'ws'
import type { Server as HttpServer, IncomingMessage } from 'node:http'
import { ptyManager, type SpawnOptions } from './pty-manager'
import { logger } from './logger'

const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:3030',
  'http://127.0.0.1:3031',
  'http://localhost:3030',
  'http://localhost:3031',
])

/**
 * Parse SpawnOptions from WebSocket upgrade request URL query.
 *
 * Supported params:
 *   model=<id>               — override model
 *   permissionMode=<mode>    — default/plan/acceptEdits/bypassPermissions
 *   forceNew=true            — force new session (no --continue)
 *   accountId=<id>           — V13: account profile for provider/mode resolution
 *   vpsId=<id>               — V13: remote VPS via ssh (requires cliName)
 *   cliName=<name>           — V13: CLI binary on remote VPS (claude|codex|gemini|aichat)
 *   taskType=<id>            — V13: macro-task routing hint
 */
function parseSpawnOptions(rawUrl: string): SpawnOptions {
  const opts: SpawnOptions = {}
  try {
    const qIdx = rawUrl.indexOf('?')
    if (qIdx === -1) return opts
    const params = new URLSearchParams(rawUrl.slice(qIdx + 1))

    if (params.get('forceNew') === 'true') opts.forceNew = true

    const model = params.get('model')
    if (model && /^[a-zA-Z0-9._\-[\]]{1,64}$/.test(model)) opts.model = model

    const perm = params.get('permissionMode')
    if (perm && ['default', 'acceptEdits', 'bypassPermissions', 'plan'].includes(perm)) {
      opts.permissionMode = perm as any
    }

    const accountId = params.get('accountId')
    if (accountId && /^[a-zA-Z0-9_-]{1,64}$/.test(accountId)) opts.accountId = accountId

    const vpsId = params.get('vpsId')
    const cliName = params.get('cliName')
    if (
      vpsId && /^[a-zA-Z0-9_-]{1,64}$/.test(vpsId) &&
      cliName && /^[a-zA-Z0-9_-]{1,32}$/.test(cliName)
    ) {
      opts.remote = { vpsId, cliName }
    }

    const taskType = params.get('taskType')
    if (taskType && /^[a-z0-9_-]{1,64}$/.test(taskType)) opts.taskType = taskType
  } catch (err) {
    logger.warn('[ws-pty] parseSpawnOptions failed:', err)
  }
  return opts
}

export function attachPtyWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    try {
      const url = req.url || ''
      const match = url.match(/^\/api\/pty\/([a-zA-Z0-9_-]{1,64})(\?.*)?$/)
      if (!match) {
        socket.destroy()
        return
      }
      const origin = req.headers.origin
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        logger.warn(`[ws] rejected origin: ${origin}`)
        socket.destroy()
        return
      }
      const projectId = match[1]
      const spawnOpts = parseSpawnOptions(url)
      if (Object.keys(spawnOpts).length > 0) {
        logger.info(`[ws-pty] ${projectId} spawn opts from query: ${JSON.stringify(spawnOpts)}`)
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        handleConnection(ws, req, projectId, spawnOpts).catch((err) => {
          logger.error('[ws-pty] handleConnection failed:', err)
          try { ws.close(1011, 'handler error') } catch { /* ignore */ }
        })
      })
    } catch (err) {
      logger.error('ws upgrade err:', err)
      socket.destroy()
    }
  })
}

async function handleConnection(
  ws: WebSocket,
  _req: IncomingMessage,
  projectId: string,
  spawnOpts: SpawnOptions = {}
) {
  const session = await ptyManager.getOrCreate(projectId, spawnOpts)
  if ('error' in session) {
    ws.send(JSON.stringify({ type: 'error', error: session.error }))
    ws.close()
    return
  }

  // Replay buffer to newly connected client
  if (session.buffer.length > 0) {
    ws.send(JSON.stringify({ type: 'data', data: session.buffer.join('') }))
  }

  // Forward pty → client
  const onData = (data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data }))
    }
  }
  session.listeners.add(onData)

  const onExit = (code: number) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'exit', code }))
      ws.close()
    }
  }
  session.exitHandlers.add(onExit)

  // Forward client → pty
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'data' && typeof msg.data === 'string') {
        ptyManager.write(projectId, msg.data)
      } else if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
        ptyManager.resize(projectId, msg.cols, msg.rows)
      } else if (msg.type === 'kill') {
        ptyManager.kill(projectId)
      }
    } catch {
      /* malformed */
    }
  })

  ws.on('close', () => {
    session.listeners.delete(onData)
    session.exitHandlers.delete(onExit)
    // NOTE: PTY session stays alive across client disconnects — user can reconnect
  })

  // Tell client ready
  ws.send(JSON.stringify({ type: 'ready', projectId, pid: session.proc.pid }))
}
