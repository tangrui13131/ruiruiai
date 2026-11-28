/** Runtime-closure and writable-data locations for the desktop shell. */
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** Directory holding the SQLite database, agent runs, and agent homes. */
export function dataRoot(): string {
  return join(app.getPath('userData'), 'data')
}

/** Private dsh home owned by the desktop application. */
export function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
}

function hasRuntimeEntry(root: string): boolean {
  return existsSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
}

/**
 * Resolve the production runtime closure.
 *
 * An explicit `DSH_DESKTOP_CLOSURE` wins for development; a packaged application
 * uses `resources/runtime/app`, and a development checkout may prepare
 * `apps/desktop/runtime/app` in place.
 * @returns the closure root containing `node_modules/@deepseek-ai/dsh`.
 */
export function resolveRuntimeRoot(): string {
  const candidates: string[] = []
  const explicit = process.env.DSH_DESKTOP_CLOSURE?.trim()
  if (explicit !== undefined && explicit !== '') {
    candidates.push(explicit, join(explicit, 'app'))
  }
  if (app.isPackaged) candidates.push(join(process.resourcesPath, 'runtime', 'app'))
  candidates.push(join(app.getAppPath(), 'runtime', 'app'))
  for (const candidate of candidates) {
    if (hasRuntimeEntry(candidate)) return candidate
  }
  throw new Error(
    `找不到桌面运行时闭包。已检查：\n${candidates.join('\n')}\n`
    + '请先运行 pnpm --filter @deepseek-ai/dsh-desktop-shell run prepare:runtime',
  )
}
