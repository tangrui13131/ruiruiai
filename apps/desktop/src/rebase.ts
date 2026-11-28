/** Rebase stored artifact paths when a portable profile moves to another drive or folder. */
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { appendLog } from './log.js'
import { dataRoot } from './paths.js'
import { isPortableMode } from './portable.js'

/** Portable paths live under `<app root>\userdata\data\...`. */
const DATA_MARKER = '\\userdata\\data\\'

/**
 * Rewrite recorded run paths from the previous portable root to the current
 * one. Windows assigns a different drive letter to the same removable disk on
 * some machines, while `project_runs` and verification reports store absolute
 * paths. Without this rewrite the artifact server rejects those paths as
 * outside its run root and history screenshots and previews return 404.
 *
 * The rewrite only runs in portable mode, only when a recorded prefix differs
 * from the running executable's directory, and only after backing the database
 * up. A no-op leaves the database untouched.
 */
export function rebasePortablePaths(): void {
  if (!isPortableMode()) return
  const databasePath = join(dataRoot(), 'platform.sqlite')
  if (!existsSync(databasePath)) return

  const currentRoot = dirname(process.execPath)
  const database = new DatabaseSync(databasePath)
  try {
    const hasRuns = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_runs'",
    ).get()
    if (hasRuns === undefined) return

    database.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const sample = database.prepare(
      'SELECT workspace_path FROM project_runs WHERE workspace_path IS NOT NULL LIMIT 1',
    ).get() as { workspace_path?: unknown } | undefined
    const recorded = typeof sample?.workspace_path === 'string' ? sample.workspace_path : undefined
    if (recorded === undefined) return

    const markerAt = recorded.toLowerCase().indexOf(DATA_MARKER)
    if (markerAt <= 0) return
    const storedRoot = recorded.slice(0, markerAt)
    if (storedRoot.toLowerCase() === currentRoot.toLowerCase()) return

    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    copyFileSync(databasePath, `${databasePath}.bak-drive-${stamp}`)
    appendLog(`rebase: ${storedRoot} -> ${currentRoot}`)

    const variants = (value: string): string[] => [
      value,
      value.replaceAll('\\', '\\\\'),
      value.replaceAll('\\', '/'),
    ]
    const oldValues = variants(storedRoot)
    const newValues = variants(currentRoot)
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all() as { name: string }[]

    let changed = 0
    database.exec('BEGIN')
    try {
      for (const table of tables) {
        const columns = database.prepare(`PRAGMA table_info("${table.name}")`).all() as {
          name: string
          type: string
        }[]
        for (const column of columns) {
          if (!/TEXT|CHAR|CLOB|^$/iu.test(column.type)) continue
          for (let index = 0; index < oldValues.length; index += 1) {
            const result = database.prepare(
              `UPDATE "${table.name}" SET "${column.name}" = REPLACE("${column.name}", ?, ?) WHERE "${column.name}" LIKE ?`,
            ).run(oldValues[index], newValues[index], `%${oldValues[index]}%`)
            changed += Number(result.changes)
          }
        }
      }
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    appendLog(`rebase: ${changed} row(s) updated`)
  } finally {
    database.close()
  }
}
