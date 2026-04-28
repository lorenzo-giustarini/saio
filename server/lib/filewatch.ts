import chokidar from 'chokidar'
import path from 'node:path'
import { logger } from './logger'

export interface FileEvent {
  type: 'created' | 'updated' | 'deleted'
  kind: 'brief' | 'task' | 'project' | 'response' | 'feedback' | 'other'
  path: string
  filename: string
  timestamp: string
}

type EventCallback = (event: FileEvent) => void

export function setupFileWatch(dataDir: string, onEvent: EventCallback) {
  const watched = [
    path.join(dataDir, 'briefs'),
    path.join(dataDir, 'tasks'),
    path.join(dataDir, 'projects'),
    path.join(dataDir, 'responses'),
    path.join(dataDir, 'feedback'),
  ]

  const watcher = chokidar.watch(watched, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  })

  function kindFromPath(fp: string): FileEvent['kind'] {
    if (fp.includes('/briefs/') || fp.includes('\\briefs\\')) return 'brief'
    if (fp.includes('/tasks/') || fp.includes('\\tasks\\')) return 'task'
    if (fp.includes('/projects/') || fp.includes('\\projects\\')) return 'project'
    if (fp.includes('/responses/') || fp.includes('\\responses\\')) return 'response'
    if (fp.includes('/feedback/') || fp.includes('\\feedback\\')) return 'feedback'
    return 'other'
  }

  watcher
    .on('add', (p) => {
      const ev: FileEvent = {
        type: 'created',
        kind: kindFromPath(p),
        path: p,
        filename: path.basename(p),
        timestamp: new Date().toISOString(),
      }
      logger.debug('[watch] +', ev.kind, ev.filename)
      onEvent(ev)
    })
    .on('change', (p) => {
      const ev: FileEvent = {
        type: 'updated',
        kind: kindFromPath(p),
        path: p,
        filename: path.basename(p),
        timestamp: new Date().toISOString(),
      }
      logger.debug('[watch] ~', ev.kind, ev.filename)
      onEvent(ev)
    })
    .on('unlink', (p) => {
      const ev: FileEvent = {
        type: 'deleted',
        kind: kindFromPath(p),
        path: p,
        filename: path.basename(p),
        timestamp: new Date().toISOString(),
      }
      logger.debug('[watch] -', ev.kind, ev.filename)
      onEvent(ev)
    })
    .on('error', (err) => {
      logger.error('[watch] error:', err)
    })

  return watcher
}
