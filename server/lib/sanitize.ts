const PROJECT_ID_REGEX = /^[a-z0-9_-]{1,64}$/
const DECISION_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/

export function sanitizeProjectId(id: string): string {
  if (!PROJECT_ID_REGEX.test(id)) {
    throw new Error(`Invalid projectId: "${id}"`)
  }
  return id
}

export function sanitizeDecisionId(id: string): string {
  if (!DECISION_ID_REGEX.test(id)) {
    throw new Error(`Invalid decisionId: "${id}"`)
  }
  return id
}

export function sanitizeFilename(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9_.-]/g, '_')
  if (clean.length === 0 || clean.length > 255) {
    throw new Error(`Invalid filename: "${name}"`)
  }
  return clean
}

export function sanitizePathWithinRoot(filePath: string, rootDir: string): string {
  const path = require('node:path') as typeof import('node:path')
  const resolved = path.resolve(rootDir, filePath)
  if (!resolved.startsWith(path.resolve(rootDir))) {
    throw new Error(`Path traversal attempt blocked: "${filePath}"`)
  }
  return resolved
}
