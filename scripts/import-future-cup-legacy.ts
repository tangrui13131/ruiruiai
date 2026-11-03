/** Import durable project data from a newer compatible Future Cup SQLite database. */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { OrchestrationRepository } from '../packages/experimental/future-cup-orchestration/src/index.ts'

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    source: { type: 'string' },
    target: { type: 'string' },
    force: { type: 'boolean', default: false },
  },
  strict: true,
})

if (values.source === undefined || values.target === undefined) {
  throw new Error('Usage: import-future-cup-legacy.ts --source <legacy.sqlite> --target <local.sqlite>')
}

const sourcePath = resolve(values.source)
const targetPath = resolve(values.target)
if (!existsSync(sourcePath)) throw new Error(`Legacy database not found: ${sourcePath}`)
if (sourcePath === targetPath) throw new Error('Source and target databases must differ')

const targetRepository = new OrchestrationRepository(targetPath, { journalMode: 'wal' })
targetRepository.close()

const copyOrder = [
  'projects',
  'workflow_definitions',
  'workflow_runs',
  'workflow_control_runs',
  'workflow_control_events',
  'tasks',
  'task_dependencies',
  'task_journal',
  'scheduler_decisions',
  'executions',
  'execution_events',
  'verification_reports',
  'repair_records',
  'project_memory_entries',
  'project_runs',
  'product_events',
] as const

const source = new DatabaseSync(sourcePath, { readOnly: true })
const target = new DatabaseSync(targetPath)
const imported: Record<string, number> = {}

try {
  target.prepare('ATTACH DATABASE ? AS legacy').run(sourcePath)
  const existingProjects = target.prepare('SELECT COUNT(*) AS count FROM projects').get() as { count: number }
  if (existingProjects.count > 0 && !values.force) {
    console.log(JSON.stringify({ imported: false, reason: 'target already contains projects', imported }))
    process.exitCode = 0
  } else {
    target.exec('PRAGMA foreign_keys = OFF')
    target.exec('BEGIN IMMEDIATE')
    try {
      for (const table of [...copyOrder].reverse()) target.exec(`DELETE FROM "${table}"`)
      for (const table of copyOrder) {
        if (!hasTable(source, table)) continue
        const sourceColumns = tableColumns(source, table)
        const targetColumnNames = new Set(tableColumns(target, table))
        const columns = sourceColumns.filter(column => targetColumnNames.has(column))
        if (columns.length === 0) continue
        const quoted = columns.map(column => `"${column}"`).join(', ')
        const result = target.prepare(`
          INSERT OR REPLACE INTO "${table}" (${quoted})
          SELECT ${quoted} FROM legacy."${table}"
        `).run()
        imported[table] = Number(result.changes)
      }
      target.exec('COMMIT')
    } catch (error: unknown) {
      target.exec('ROLLBACK')
      throw error
    } finally {
      target.exec('PRAGMA foreign_keys = ON')
    }
    console.log(JSON.stringify({ imported: true, imported }))
  }
} finally {
  try {
    target.exec('DETACH DATABASE legacy')
  } catch {
    // The target may not have attached the source before a setup failure.
  }
  source.close()
  target.close()
}

function hasTable(database: DatabaseSync, table: string): boolean {
  return database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table) !== undefined
}

function tableColumns(database: DatabaseSync, table: string): string[] {
  return database.prepare(`PRAGMA table_info("${table}")`).all()
    .map(row => (row as { name: string }).name)
}
