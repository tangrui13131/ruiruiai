/** Append-only desktop diagnostics log under the application's userData directory. */
import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let logFile: string | undefined

function resolveLogFile(): string {
  if (logFile === undefined) {
    const directory = join(app.getPath('userData'), 'logs')
    mkdirSync(directory, { recursive: true })
    logFile = join(directory, 'desktop.log')
  }
  return logFile
}

/**
 * Append one diagnostic line.
 * @param message - text to record; logging failures never interrupt startup.
 */
export function appendLog(message: string): void {
  try {
    appendFileSync(resolveLogFile(), `[${new Date().toISOString()}] ${message}\n`)
  } catch (_error) {
    // Diagnostics are best-effort; a read-only userData directory must not stop the app.
  }
}
