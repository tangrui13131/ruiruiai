/** Portable-mode detection for a drive-local userData directory. */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Resolve the drive-local userData directory when a `portable.flag` sits next to the executable.
 * @returns the portable userData path, or `undefined` for a normal installation.
 */
export function portableUserDataPath(): string | undefined {
  if (!app.isPackaged) return undefined
  const executableDirectory = dirname(process.execPath)
  return existsSync(join(executableDirectory, 'portable.flag'))
    ? join(executableDirectory, 'userdata')
    : undefined
}

/** Whether the application is running in portable mode. */
export function isPortableMode(): boolean {
  return portableUserDataPath() !== undefined
}
