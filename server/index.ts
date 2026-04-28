// V15.0 WS7 — carica .env.local al boot (priorità) + .env (fallback) PRIMA di qualunque
// import che legga process.env. Senza questo, il wizard scrive .env.local ma al restart
// il backend non rivede le credenziali → setup-status torna configured:false.
import dotenv from 'dotenv'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirnameBoot = path.dirname(fileURLToPath(import.meta.url))
const projectRootBoot = path.resolve(__dirnameBoot, '..')
dotenv.config({ path: path.join(projectRootBoot, '.env.local') })
dotenv.config({ path: path.join(projectRootBoot, '.env') })

import express, { type Request, type Response, type NextFunction } from 'express'
import helmet from 'helmet'
import fs from 'node:fs'
import { briefsRouter } from './routes/briefs'
import { responsesRouter } from './routes/responses'
import { tasksRouter } from './routes/tasks'
import { projectsRouter, getProjectById } from './routes/projects'
import { newProjectRouter } from './routes/new-project'
import { orchestratorRouter } from './routes/orchestrator'
import { archiveRouter } from './routes/archive'
import { metricsRouter } from './routes/metrics'
import { mcpRouter } from './routes/mcp'
import { credentialsRouter } from './routes/credentials'
import { sshRouter } from './routes/ssh'
import { vpsRouter } from './routes/vps'
import { mcpDiscoveryRouter } from './routes/mcp-discovery'
import { deepResearchRouter } from './routes/deep-research'
import { ptyRouter } from './routes/pty'
import { attachPtyWebSocket } from './lib/ws-pty'
import { ptyManager } from './lib/pty-manager'
import { projectsStore } from './lib/projects-store'
import { vpsStateStore } from './lib/vps-state-store'
import { vpsConfigStore } from './lib/vps-config-store'
import { accountsStore } from './lib/accounts-store'
import { setHealthDataDir } from './lib/account-health'
import { taskTypesStore } from './lib/task-types-store'
import { customProvidersStore } from './lib/custom-providers-store'
import { createServer } from 'node:http'
import { cronRouter } from './routes/cron'
import { recipesRouter } from './routes/recipes'
import { errorPipelineRouter } from './routes/error-pipeline'
import { toolsSnapshotRouter } from './routes/tools-snapshot'
import { patternAdoptionRouter } from './routes/pattern-adoption'
import { accountsRouter } from './routes/accounts'
import { taskTypesRouter } from './routes/task-types'
import { logsRouter } from './routes/logs'
import { vaultRouter } from './routes/vault'
import { eventsRouter, broadcastEvent } from './routes/sse'
import { setupFileWatch } from './lib/filewatch'
import { ensureDataDirs } from './lib/datadirs'
import { logger } from './lib/logger'
import { setAuditDataDir } from './lib/auth/audit'
import { setBanStoreDataDir } from './lib/auth/ban-store'
import { bootstrapAuth } from './lib/auth/bootstrap'
import { authRouter } from './routes/auth'
import { adminAccessRouter } from './routes/admin-access'
import { systemRouter } from './routes/system'
import { perfRouter } from './routes/perf'
import { onboardingRouter } from './routes/onboarding'
import { scanRouter } from './routes/scan'
import { authLimiter, checkBanlist } from './middleware/rate-limit'
import { makeRequireAuth, requireOwner } from './middleware/require-auth'
import { cronTokenOrAuth } from './middleware/cron-bypass'
import cookieParser from 'cookie-parser'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.DASHBOARD_DATA_DIR || path.join(PROJECT_ROOT, 'data')
const PORT = Number(process.env.SERVER_PORT || 3031)
const HOST = '127.0.0.1'

ensureDataDirs(DATA_DIR)
ptyManager.setDataDir(DATA_DIR)
projectsStore.setDataDir(DATA_DIR)
// Kick off V11 migration asynchronously — non-blocking
projectsStore.migrate().catch((err) => logger.error('[projects-store] migrate failed:', err))
// V13: VPS state store init
vpsStateStore.setDataDir(DATA_DIR)
// V13.3-T8: VPS user-editable config store (custom labels)
vpsConfigStore.setDataDir(DATA_DIR)
// V13: Accounts store — autodetect + seed on first boot
accountsStore.setDataDir(DATA_DIR)
accountsStore.migrate().catch((err) => logger.error('[accounts-store] migrate failed:', err))
setHealthDataDir(DATA_DIR)
taskTypesStore.setDataDir(DATA_DIR)
taskTypesStore.migrate().catch((err) => logger.error('[task-types-store] migrate failed:', err))
customProvidersStore.setDataDir(DATA_DIR)
customProvidersStore.ensureLoaded().catch((err) => logger.error('[custom-providers] init failed:', err))

// V15.0 WS3-3D — Auth-related store init (ban-store + audit log).
setBanStoreDataDir(DATA_DIR)
setAuditDataDir(DATA_DIR)

// V15.0 WS3-3G — Bootstrap claim flow: stampa banner stdout se owner.json mancante.
// Idempotente, safe da chiamare ad ogni avvio.
bootstrapAuth(DATA_DIR).catch((err) => logger.error('[auth] bootstrap failed:', err))

const app = express()

// V15.0 WS3-3E — Production-ready security: HSTS + strict CSP + CORS allowlist
const IS_PROD = process.env.NODE_ENV === 'production'
const ALLOWED_ORIGINS = (process.env.DASHBOARD_ALLOWED_ORIGINS || 'http://127.0.0.1:3030,http://localhost:3030')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// V15.0 WS3-3D — Tunnel URL (Cloudflare/Reverse-proxy) per CORS allowlist + magic-link absolute URL
const TUNNEL_URL = (process.env.DASHBOARD_AUTH_TUNNEL_URL || '').trim()
if (TUNNEL_URL && !ALLOWED_ORIGINS.includes(TUNNEL_URL)) ALLOWED_ORIGINS.push(TUNNEL_URL)

// V15.0 WS3-3D — Trust proxy SOLO da localhost (cloudflared gira sulla stessa VPS e
// inoltra a 127.0.0.1, settando X-Forwarded-For + CF-Connecting-IP). Senza questo,
// req.ip sarebbe sempre 127.0.0.1 e i rate-limit per-IP non funzionerebbero su VPS.
app.set('trust proxy', '127.0.0.1')

// ============================================================
// Security middlewares
// ============================================================
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Vite dev HMR richiede 'unsafe-inline' + 'unsafe-eval'. In build prod le rimuoviamo.
        scriptSrc: IS_PROD ? ["'self'"] : ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind inline + Radix style props
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'http://127.0.0.1:3030', 'http://127.0.0.1:3031', 'ws://127.0.0.1:3030', 'ws://127.0.0.1:3031', ...ALLOWED_ORIGINS],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        ...(IS_PROD ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    // Cloudflare Tunnel termina HTTPS al edge — HSTS sempre on (anche in dev locale è no-op se HTTP)
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' },
  })
)

// V15.0 WS3-3E — CORS strict da env allowlist (con dev fallback)
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Cron-Token,X-Requested-With')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true, limit: '2mb' }))
app.use(cookieParser())

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`)
  next()
})

// ============================================================
// Health
// ============================================================
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    ts: new Date().toISOString(),
    version: '1.0.0',
    dataDir: DATA_DIR,
  })
})

// ============================================================
// V15.0 WS3 — Mount order:
//  1. /api/auth/*           PUBLIC (rate-limited + banlist)
//  2. /api/error-pipeline   X-Cron-Token only (verifyCronToken self-protected)
//  3. /api/cron             X-Cron-Token OR (JWT + role:owner)
//  4. /api/* umbrella JWT   gates everything below
//  5. /api/admin/access     requireOwner additional gate (in 3H)
// ============================================================
app.use('/api/auth', checkBanlist, authLimiter, authRouter(DATA_DIR))

// CRON-protected routes (X-Cron-Token gate, bypass JWT)
app.use('/api/error-pipeline', errorPipelineRouter())
app.use('/api/cron', cronTokenOrAuth, cronRouter())

// JWT umbrella — tutte le rotte dopo richiedono auth (a meno che req.skipAuth)
const requireAuth = makeRequireAuth(DATA_DIR)
app.use('/api', requireAuth)

// Routes (esistenti, ora protette)
app.use('/api/briefs', briefsRouter(DATA_DIR))
app.use('/api/responses', responsesRouter(DATA_DIR))
app.use('/api/tasks', tasksRouter(DATA_DIR))
app.use('/api/projects', projectsRouter(DATA_DIR))
app.use('/api/new-project', newProjectRouter(DATA_DIR))
app.use('/api/orchestrator', orchestratorRouter(DATA_DIR, getProjectById))
app.use('/api/archive', archiveRouter(DATA_DIR))
app.use('/api/metrics', metricsRouter(DATA_DIR))
app.use('/api/mcp', mcpRouter())
app.use('/api/credentials', credentialsRouter())
app.use('/api/ssh', sshRouter())
app.use('/api/vps', vpsRouter())
app.use('/api/mcp-discovery', mcpDiscoveryRouter(DATA_DIR))
app.use('/api/deep-research', deepResearchRouter())
app.use('/api/pty', ptyRouter())
app.use('/api/recipes', recipesRouter())
app.use('/api/tools-snapshot', toolsSnapshotRouter())
app.use('/api/pattern-adoption', patternAdoptionRouter())
app.use('/api/accounts', accountsRouter())
app.use('/api/task-types', taskTypesRouter())
app.use('/api/logs', logsRouter(DATA_DIR))
app.use('/api/vault', vaultRouter())
app.use('/api/events', eventsRouter())

// V15.0 WS3-3H — Admin access (owner-only)
app.use('/api/admin/access', requireOwner, adminAccessRouter(DATA_DIR))

// V15.0 WS10 — System checks (deps, tunnel status). Auth gated da umbrella.
app.use('/api/system', systemRouter())

// V15.0 WS22 — Performance snapshot per CPU monitor (alert >100% sostenuto)
app.use('/api/perf', perfRouter())

// V15.0 WS12 — Onboarding (first-login wizard state)
app.use('/api/onboarding', onboardingRouter(DATA_DIR))

// V15.0 WS13 — Filesystem scan + import progetti
app.use('/api/scan', scanRouter(DATA_DIR))

// V15.0 WS11 — Static PDF docs (es. SAIO-cloudflare-setup-guide.pdf).
// Auth required (post-login). Per dev locale, Vite proxy /docs → backend.
const docsPath = path.join(PROJECT_ROOT, 'docs')
if (fs.existsSync(docsPath)) {
  app.use('/docs', express.static(docsPath, { fallthrough: true, maxAge: '1d' }))
}

// ============================================================
// File watch → SSE broadcast
// ============================================================
setupFileWatch(DATA_DIR, (event) => broadcastEvent(event))

// ============================================================
// Error handler
// ============================================================
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', err)
  res.status(500).json({ error: err.message })
})

// ============================================================
// Start
// ============================================================
const httpServer = createServer(app)
attachPtyWebSocket(httpServer)
httpServer.listen(PORT, HOST, () => {
  logger.info(`🚀 Dashboard server running on http://${HOST}:${PORT}`)
  logger.info(`🔌 WebSocket PTY endpoint: ws://${HOST}:${PORT}/api/pty/:projectId`)
  logger.info(`📁 Data dir: ${DATA_DIR}`)
})

// ============================================================
// Graceful shutdown
// ============================================================
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  process.exit(0)
})
process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
  process.exit(0)
})
