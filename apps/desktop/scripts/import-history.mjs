#!/usr/bin/env node
/**
 * Import Future Cup history created by a web deployment into the desktop data root.
 *
 * The platform records absolute run paths in `project_runs.workspace_path`,
 * `project_runs.preview_path`, and `verification_reports.report_json`. Copying
 * the SQLite database alone leaves those paths pointing at the old run root,
 * and the artifact server refuses to serve files outside its own root, so
 * screenshots and previews 404. This script copies the referenced artifacts
 * into the desktop run root and rewrites the three path-bearing columns.
 *
 * Run it with the desktop application closed:
 *
 *   node apps/desktop/scripts/import-history.mjs --dry-run
 *   node apps/desktop/scripts/import-history.mjs
 *
 * Portable installs keep their profile next to the executable; pass
 * `--target-data-root "<exe dir>/userdata/data"` for those.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const USAGE = `Usage: node apps/desktop/scripts/import-history.mjs [options]

Options:
  --target-data-root <dir>  Desktop data directory (default: %APPDATA%\\Future Cup\\data)
  --db <file>               SQLite file (default: <target-data-root>/platform.sqlite)
  --run-root <dir>          Desktop run root (default: <target-data-root>/runs)
  --dry-run                 Copy nothing and write nothing; report the plan
  --help                    Show this message
`

/** Owner directories are `<run root>/future-cup-run-<id>` or `<run root>/future-cup-drill-<id>`. */
const OWNER_PATTERN = /(?:^|[\\/])(future-cup-(?:run|drill)-[^\\/]+)(?=[\\/]|$)/i

/** Copy a directory tree without dependency or VCS directories. */
function copyTree(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (path) => {
      const name = basename(path)
      return name !== 'node_modules' && name !== '.git'
    },
  })
}

function parseArguments(argv) {
  const options = {
    targetDataRoot: join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Future Cup', 'data'),
    db: undefined,
    runRoot: undefined,
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    const next = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${argument} requires a value`)
      index += 1
      return value
    }
    switch (argument) {
      case '--target-data-root': options.targetDataRoot = next(); break
      case '--db': options.db = next(); break
      case '--run-root': options.runRoot = next(); break
      case '--dry-run': options.dryRun = true; break
      case '--help': process.stdout.write(USAGE); process.exit(0); break
      default: throw new Error(`Unknown argument: ${argument}\n\n${USAGE}`)
    }
  }
  options.targetDataRoot = resolve(options.targetDataRoot)
  options.db = resolve(options.db ?? join(options.targetDataRoot, 'platform.sqlite'))
  options.runRoot = resolve(options.runRoot ?? join(options.targetDataRoot, 'runs'))
  return options
}

/**
 * Split a recorded absolute path into its owner directory and the tail below it.
 * @returns `undefined` when the path does not name a run owner directory.
 */
function splitOwnerPath(path) {
  const match = OWNER_PATTERN.exec(path)
  if (match === null) return undefined
  const owner = match[1]
  const ownerEnd = match.index + match[0].length
  const ownerRoot = path.slice(0, ownerEnd)
  const tail = path.slice(ownerEnd).replace(/^[\\/]+/u, '')
  return { owner, ownerRoot, tail }
}

/** Map a recorded path into the desktop run root, or `undefined` when it is not a run artifact. */
function rebasePath(path, runRoot) {
  const split = splitOwnerPath(path)
  if (split === undefined) return undefined
  return { ...split, target: join(runRoot, split.owner, split.tail) }
}

function collectPlan(database, runRoot) {
  const owners = new Map()
  const add = (path) => {
    if (typeof path !== 'string' || path.trim() === '') return
    const rebased = rebasePath(path, runRoot)
    if (rebased === undefined) return
    let plan = owners.get(rebased.owner)
    if (plan === undefined) {
      plan = { owner: rebased.owner, ownerRoot: rebased.ownerRoot, tails: new Set() }
      owners.set(rebased.owner, plan)
    }
    if (rebased.tail !== '') plan.tails.add(rebased.tail)
  }

  const runs = database.prepare('SELECT id, workspace_path, preview_path FROM project_runs').all()
  for (const run of runs) {
    add(run.workspace_path)
    add(run.preview_path)
  }
  const reports = database.prepare('SELECT id, report_json FROM verification_reports').all()
  for (const report of reports) {
    for (const path of parseReport(report.report_json).screenshots) add(path)
  }
  return { owners, runs, reports }
}

function parseReport(json) {
  try {
    const parsed = JSON.parse(json)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { raw: undefined, screenshots: [] }
    }
    return {
      raw: parsed,
      screenshots: Array.isArray(parsed.screenshots) ? parsed.screenshots : [],
    }
  } catch {
    return { raw: undefined, screenshots: [] }
  }
}

/** Copy every directory a plan references, skipping dependency and VCS trees. */
function copyPlan(owners, runRoot, dryRun) {
  let copiedOwners = 0
  const missing = []
  for (const plan of owners.values()) {
    const tails = [...plan.tails]
    const needsScreenshots = tails.some(tail =>
      tail === 'screenshots' || tail.startsWith('screenshots' + '\\') || tail.startsWith('screenshots/'))
    const needsWorkspace = tails.some(tail =>
      tail === 'workspace' || tail.startsWith('workspace' + '\\') || tail.startsWith('workspace/'))
    const targets = []
    if (needsScreenshots) targets.push(['screenshots', join(plan.ownerRoot, 'screenshots')])
    if (needsWorkspace) targets.push(['workspace', join(plan.ownerRoot, 'workspace')])
    for (const [relative, source] of targets) {
      if (!existsSync(source)) {
        missing.push(source)
        continue
      }
      const destination = join(runRoot, plan.owner, relative)
      if (!dryRun) {
        mkdirSync(join(runRoot, plan.owner), { recursive: true })
        copyTree(source, destination)
      }
    }
    // Copy any referenced file outside the two standard directories.
    for (const tail of plan.tails) {
      const normalized = tail.replaceAll('\\', '/')
      if (normalized === 'screenshots' || normalized.startsWith('screenshots/')) continue
      if (normalized === 'workspace' || normalized.startsWith('workspace/')) continue
      const source = join(plan.ownerRoot, tail)
      if (!existsSync(source)) {
        missing.push(source)
        continue
      }
      const destination = join(runRoot, plan.owner, tail)
      if (dryRun) continue
      mkdirSync(dirname(destination), { recursive: true })
      cpSync(source, destination, { recursive: true, force: true, errorOnExist: false })
    }
    copiedOwners += 1
  }
  return { copiedOwners, missing }
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  if (!existsSync(options.db)) {
    throw new Error(`Database not found: ${options.db}`)
  }
  if (!existsSync(options.runRoot)) {
    // The artifact server resolves its root before serving, so an absent root
    // turns every screenshot into a 404 even after the paths are rewritten.
    if (!options.dryRun) mkdirSync(options.runRoot, { recursive: true })
  }

  const database = new DatabaseSync(options.db)
  try {
    // A consistent copy first: VACUUM INTO includes WAL contents and fails
    // loudly when another process holds a write transaction.
    if (!options.dryRun) {
      const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
      const backup = `${options.db}.bak-history-${stamp}`
      try {
        database.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`)
        process.stdout.write(`backup: ${backup}\n`)
      } catch (error) {
        process.stdout.write(`warning: could not back up the database (${error.message}); close the app and retry\n`)
        throw error
      }
    }

    const plan = collectPlan(database, options.runRoot)
    process.stdout.write(`scanned: ${plan.runs.length} runs, ${plan.reports.length} reports, ${plan.owners.size} run directories\n`)
    if (options.dryRun) process.stdout.write('dry run: no files copied, no rows written\n')
    const copy = copyPlan(plan.owners, options.runRoot, options.dryRun)
    if (copy.missing.length > 0) {
      process.stdout.write(`missing sources: ${copy.missing.length}\n`)
      for (const path of copy.missing.slice(0, 10)) process.stdout.write(`  ${path}\n`)
      if (copy.missing.length > 10) process.stdout.write(`  ... ${copy.missing.length - 10} more\n`)
    }

    let runUpdates = 0
    let reportUpdates = 0
    const skipped = []
    if (!options.dryRun) database.exec('BEGIN IMMEDIATE')
    try {
      const updateRun = options.dryRun ? undefined : database.prepare('UPDATE project_runs SET workspace_path = ?, preview_path = ? WHERE id = ?')
      for (const run of plan.runs) {
        const workspace = rewrite(run.workspace_path, options.runRoot, options.dryRun)
        const preview = run.preview_path === null ? null : rewrite(run.preview_path, options.runRoot, options.dryRun)
        if (workspace === undefined || (run.preview_path !== null && preview === undefined)) {
          skipped.push(run.id)
          continue
        }
        if (workspace.changed || preview?.changed === true) {
          if (updateRun !== undefined) updateRun.run(workspace.value, preview === null ? null : preview.value, run.id)
          runUpdates += 1
        }
      }

      const updateReport = options.dryRun ? undefined : database.prepare('UPDATE verification_reports SET report_json = ? WHERE id = ?')
      for (const report of plan.reports) {
        const parsed = parseReport(report.report_json)
        if (parsed.raw === undefined) {
          skipped.push(report.id)
          continue
        }
        let changed = false
        parsed.raw.screenshots = parsed.screenshots.map((path) => {
          const next = rewrite(path, options.runRoot, options.dryRun)
          if (next === undefined) return path
          if (next.changed) changed = true
          return next.value
        })
        if (changed) {
          if (updateReport !== undefined) updateReport.run(JSON.stringify(parsed.raw), report.id)
          reportUpdates += 1
        }
      }
      if (!options.dryRun) database.exec('COMMIT')
    } catch (error) {
      if (!options.dryRun) database.exec('ROLLBACK')
      throw error
    }

    process.stdout.write(`owners copied: ${copy.copiedOwners}\n`)
    process.stdout.write(`rows rewritten: runs=${runUpdates}, reports=${reportUpdates}\n`)
    if (skipped.length > 0) process.stdout.write(`skipped: ${skipped.join(', ')}\n`)
    process.stdout.write(options.dryRun ? 'dry run complete\n' : 'migration complete; restart the desktop app\n')
  } finally {
    database.close()
  }
}

/** Rewrite one recorded path when its destination exists; otherwise keep the original. */
function rewrite(path, runRoot, dryRun) {
  if (typeof path !== 'string' || path.trim() === '') return undefined
  const rebased = rebasePath(path, runRoot)
  if (rebased === undefined) return { value: path, changed: false }
  // A dry run copies nothing, so treat a copyable source as the destination.
  const available = existsSync(rebased.target) || (dryRun && existsSync(path))
  if (!available) return { value: path, changed: false }
  return { value: rebased.target, changed: resolve(rebased.target) !== resolve(path) }
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
