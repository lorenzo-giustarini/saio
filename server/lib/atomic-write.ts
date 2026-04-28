import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/**
 * Writes a file atomically via temp+rename pattern.
 * Prevents readers from seeing a half-written file.
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string | Buffer
): Promise<void> {
  const dir = path.dirname(targetPath)
  const base = path.basename(targetPath)
  const tmpPath = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`)
  try {
    await fs.writeFile(tmpPath, content)
    await fs.rename(tmpPath, targetPath)
  } catch (err) {
    try {
      await fs.unlink(tmpPath)
    } catch {
      /* ignore */
    }
    throw err
  }
}

/**
 * Creates a backup of an existing file before overwriting.
 */
export async function backupIfExists(
  filePath: string,
  backupDir: string
): Promise<string | null> {
  try {
    await fs.access(filePath)
  } catch {
    return null // file doesn't exist, no backup needed
  }
  await fs.mkdir(backupDir, { recursive: true })
  const base = path.basename(filePath)
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const backupPath = path.join(backupDir, `${base}.${ts}.bak`)
  await fs.copyFile(filePath, backupPath)
  return backupPath
}
