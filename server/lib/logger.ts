type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }
const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const RESET = '\x1b[0m'

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'

function log(level: LogLevel, ...args: unknown[]) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) return
  const ts = new Date().toISOString().slice(11, 23)
  const color = LEVEL_COLORS[level]
  const tag = level.toUpperCase().padEnd(5)
  console.log(`${color}${ts} ${tag}${RESET}`, ...args)
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
}
