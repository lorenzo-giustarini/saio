import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { logger } from './logger'

const execFileAsync = promisify(execFile)

const SSH_KEY = path.join(os.homedir(), '.ssh', 'claude_vps')
const SSH_TIMEOUT_MS = 12_000
const CACHE_TTL_MS = 30_000

// Unified probe script — one SSH call collects everything
const PROBE_SCRIPT = `
echo '===UPTIME==='; uptime
echo '===LOADAVG==='; cat /proc/loadavg 2>/dev/null
echo '===MEM==='; free -m
echo '===SWAP==='; swapon --show --bytes 2>/dev/null || echo none
echo '===DISK==='; df -h --output=target,size,used,avail,pcent,ipcent 2>/dev/null || df -h
echo '===CPU==='; top -bn1 2>/dev/null | head -5
echo '===NET==='; cat /proc/net/dev 2>/dev/null | tail -n +3
echo '===DOCKER_PS==='; docker ps --format '{{.Names}}|{{.Status}}|{{.Image}}' 2>/dev/null || echo none
echo '===DOCKER_STATS==='; docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemPerc}}|{{.NetIO}}' 2>/dev/null || echo none
echo '===TOP_PROCS==='; ps -eo pcpu,pmem,comm --sort=-pcpu 2>/dev/null | head -6
echo '===KERNEL==='; uname -sr
echo '===END==='
`.trim()

/**
 * V14.28 Step 1 — classifica errori SSH per UI hint specifico (auth-failed →
 * mostra istruzioni autorizzazione chiave; unreachable → mostra connettività).
 */
export type SshErrorType = 'auth-failed' | 'unreachable' | 'unknown'

export function classifySshError(stderr: string): SshErrorType {
  const s = (stderr || '').toLowerCase()
  if (
    s.includes('permission denied') ||
    s.includes('publickey') ||
    s.includes('authentication failed') ||
    s.includes('no supported authentication methods')
  ) return 'auth-failed'
  if (
    s.includes('connection refused') ||
    s.includes('no route to host') ||
    s.includes('connection timed out') ||
    s.includes('host is down') ||
    s.includes('network is unreachable') ||
    s.includes('etimedout')
  ) return 'unreachable'
  return 'unknown'
}

export interface VpsStats {
  id: string
  ip: string
  online: boolean
  fetchedAt: string
  cached?: boolean
  error?: string
  errorType?: SshErrorType
  uptime?: string
  load?: { one: number; five: number; fifteen: number }
  memory?: { totalMB: number; usedMB: number; freeMB: number; cachedMB: number; usedPct: number }
  swap?: { totalMB: number; usedMB: number }
  disks?: Array<{ mount: string; size: string; used: string; avail: string; usePct: number; inodesPct: number }>
  cpu?: { user: number; system: number; idle: number; iowait: number }
  network?: Array<{ iface: string; rxBytes: number; txBytes: number; rxPackets: number; txPackets: number }>
  docker?: {
    count: number
    containers: Array<{ name: string; status: string; image: string; cpuPct?: number; memPct?: number; netIO?: string }>
  }
  topProcs?: Array<{ cpu: number; mem: number; cmd: string }>
  kernel?: string
}

const cache = new Map<string, { stats: VpsStats; ts: number }>()

function section(content: string, marker: string): string {
  const start = `===${marker}===`
  const idx = content.indexOf(start)
  if (idx === -1) return ''
  const rest = content.slice(idx + start.length)
  const endIdx = rest.search(/===[A-Z_]+===/)
  return (endIdx === -1 ? rest : rest.slice(0, endIdx)).trim()
}

function parseProbeOutput(stdout: string, id: string, ip: string): VpsStats {
  const now = new Date().toISOString()
  const stats: VpsStats = { id, ip, online: true, fetchedAt: now }

  // UPTIME
  const uptimeLine = section(stdout, 'UPTIME')
  if (uptimeLine) {
    const m = uptimeLine.match(/up\s+(.+?),\s+\d+\s+user/) || uptimeLine.match(/up\s+(.+?),/)
    if (m) stats.uptime = m[1].trim()
  }

  // LOADAVG
  const loadLine = section(stdout, 'LOADAVG')
  if (loadLine) {
    const parts = loadLine.split(/\s+/)
    if (parts.length >= 3) {
      stats.load = {
        one: parseFloat(parts[0]) || 0,
        five: parseFloat(parts[1]) || 0,
        fifteen: parseFloat(parts[2]) || 0,
      }
    }
  }

  // MEM
  const memBlock = section(stdout, 'MEM')
  if (memBlock) {
    const memLine = memBlock.split('\n').find((l) => l.toLowerCase().startsWith('mem:'))
    if (memLine) {
      const tok = memLine.split(/\s+/)
      const total = parseInt(tok[1]) || 0
      const used = parseInt(tok[2]) || 0
      const free = parseInt(tok[3]) || 0
      const cached = parseInt(tok[5]) || 0
      stats.memory = {
        totalMB: total,
        usedMB: used,
        freeMB: free,
        cachedMB: cached,
        usedPct: total > 0 ? Math.round((used / total) * 100) : 0,
      }
    }
  }

  // SWAP
  const swapBlock = section(stdout, 'SWAP')
  if (swapBlock && !swapBlock.toLowerCase().includes('none')) {
    const lines = swapBlock.split('\n').filter((l) => !l.toLowerCase().includes('name'))
    if (lines.length > 0) {
      const tok = lines[0].split(/\s+/)
      const totalBytes = parseInt(tok[2]) || 0
      const usedBytes = parseInt(tok[3]) || 0
      stats.swap = {
        totalMB: Math.round(totalBytes / 1024 / 1024),
        usedMB: Math.round(usedBytes / 1024 / 1024),
      }
    }
  }

  // DISK
  const diskBlock = section(stdout, 'DISK')
  if (diskBlock) {
    stats.disks = []
    for (const line of diskBlock.split('\n').slice(1)) {
      const tok = line.trim().split(/\s+/)
      if (tok.length < 5) continue
      const mount = tok[0]
      if (!mount || mount === 'Filesystem') continue
      const pctRaw = (tok[4] || '').replace('%', '')
      const ipctRaw = (tok[5] || '').replace('%', '')
      stats.disks.push({
        mount,
        size: tok[1],
        used: tok[2],
        avail: tok[3],
        usePct: parseInt(pctRaw) || 0,
        inodesPct: parseInt(ipctRaw) || 0,
      })
    }
  }

  // CPU (from top)
  const cpuBlock = section(stdout, 'CPU')
  if (cpuBlock) {
    const cpuLine = cpuBlock.split('\n').find((l) => l.toLowerCase().includes('cpu'))
    if (cpuLine) {
      const m = cpuLine.match(/(\d+\.?\d*)\s*us.*?(\d+\.?\d*)\s*sy.*?(\d+\.?\d*)\s*id.*?(\d+\.?\d*)\s*wa/)
      if (m) {
        stats.cpu = {
          user: parseFloat(m[1]),
          system: parseFloat(m[2]),
          idle: parseFloat(m[3]),
          iowait: parseFloat(m[4]),
        }
      }
    }
  }

  // NET
  const netBlock = section(stdout, 'NET')
  if (netBlock) {
    stats.network = []
    for (const line of netBlock.split('\n')) {
      const m = line.match(/^\s*([a-zA-Z0-9]+):\s*(\d+)\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)\s+(\d+)/)
      if (m && m[1] !== 'lo') {
        stats.network.push({
          iface: m[1],
          rxBytes: parseInt(m[2]),
          rxPackets: parseInt(m[3]),
          txBytes: parseInt(m[4]),
          txPackets: parseInt(m[5]),
        })
      }
    }
  }

  // DOCKER
  const dockerPs = section(stdout, 'DOCKER_PS')
  const dockerStats = section(stdout, 'DOCKER_STATS')
  if (dockerPs && !dockerPs.toLowerCase().includes('none')) {
    const containers: NonNullable<VpsStats['docker']>['containers'] = []
    const statsMap = new Map<string, { cpu: number; mem: number; net: string }>()
    if (dockerStats && !dockerStats.toLowerCase().includes('none')) {
      for (const line of dockerStats.split('\n').filter(Boolean)) {
        const [name, cpuStr, memStr, netIO] = line.split('|')
        if (name) {
          statsMap.set(name.trim(), {
            cpu: parseFloat((cpuStr || '0').replace('%', '')) || 0,
            mem: parseFloat((memStr || '0').replace('%', '')) || 0,
            net: (netIO || '').trim(),
          })
        }
      }
    }
    for (const line of dockerPs.split('\n').filter(Boolean)) {
      const [name, status, image] = line.split('|')
      if (name) {
        const s = statsMap.get(name.trim())
        containers.push({
          name: name.trim(),
          status: (status || '').trim(),
          image: (image || '').trim(),
          cpuPct: s?.cpu,
          memPct: s?.mem,
          netIO: s?.net,
        })
      }
    }
    stats.docker = { count: containers.length, containers }
  } else {
    stats.docker = { count: 0, containers: [] }
  }

  // TOP_PROCS
  const topBlock = section(stdout, 'TOP_PROCS')
  if (topBlock) {
    stats.topProcs = []
    for (const line of topBlock.split('\n').slice(1)) {
      const tok = line.trim().split(/\s+/)
      if (tok.length < 3) continue
      stats.topProcs.push({
        cpu: parseFloat(tok[0]) || 0,
        mem: parseFloat(tok[1]) || 0,
        cmd: tok.slice(2).join(' '),
      })
    }
  }

  // KERNEL
  stats.kernel = section(stdout, 'KERNEL').trim() || undefined

  return stats
}

export async function probeVps(id: string, ip: string): Promise<VpsStats> {
  // Validate IP format strictly
  if (!/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(ip)) {
    return { id, ip, online: false, fetchedAt: new Date().toISOString(), error: 'invalid IP format' }
  }

  // Check cache
  const cached = cache.get(id)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.stats, cached: true }
  }

  try {
    const { stdout } = await execFileAsync(
      'ssh',
      [
        '-i', SSH_KEY,
        '-o', 'ConnectTimeout=5',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'BatchMode=yes',
        '-o', 'ServerAliveInterval=3',
        `root@${ip}`,
        PROBE_SCRIPT,
      ],
      { timeout: SSH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }
    )

    const stats = parseProbeOutput(stdout, id, ip)
    cache.set(id, { stats, ts: Date.now() })
    return stats
  } catch (err: any) {
    logger.warn(`VPS probe failed ${id} ${ip}: ${err.message || err}`)
    const stderrText = String(err.stderr || err.message || '')
    const errorMessage = err.code === 'ETIMEDOUT' ? 'timeout' : stderrText || err.message || 'probe failed'
    const offline: VpsStats = {
      id,
      ip,
      online: false,
      fetchedAt: new Date().toISOString(),
      error: errorMessage.slice(0, 300),
      errorType: classifySshError(stderrText || (err.code === 'ETIMEDOUT' ? 'connection timed out' : '')),
    }
    // Cache short-lived offline too to avoid hammering down host
    cache.set(id, { stats: offline, ts: Date.now() - (CACHE_TTL_MS - 10_000) })
    return offline
  }
}
