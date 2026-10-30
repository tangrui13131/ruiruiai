/** SQLite schema bootstrap for the Future Cup orchestration repository. */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Physical SQLite layout version stored in `PRAGMA user_version`. */
export const ORCHESTRATION_SCHEMA_VERSION = 2

/** SQLite journal modes used by the orchestration repository. */
export type OrchestrationJournalMode = 'wal' | 'delete'

/**
 * Open one orchestration database and ensure its complete schema.
 * @param path - database path or `:memory:`.
 * @param journalMode - durability journal mode; tests use `delete` for prompt Windows cleanup.
 * @returns the configured SQLite connection.
 */
export function openOrchestrationDatabase(
  path: string,
  journalMode: OrchestrationJournalMode = 'wal',
): DatabaseSync {
  const actual = path === ':memory:' ? path : resolve(path)
  if (actual !== ':memory:') mkdirSync(dirname(actual), { recursive: true, mode: 0o700 })
  const database = new DatabaseSync(actual)
  try {
    database.exec('PRAGMA foreign_keys = ON')
    database.exec(`PRAGMA journal_mode = ${journalMode.toUpperCase()}`)
    database.exec('PRAGMA busy_timeout = 5000')
    const { user_version: version } = database.prepare('PRAGMA user_version').get() as { user_version: number }
    if (version !== 0 && version !== 1 && version !== ORCHESTRATION_SCHEMA_VERSION) {
      throw new Error(
        `orchestration database at "${actual}" has schema version ${version}, expected ${ORCHESTRATION_SCHEMA_VERSION}`,
      )
    }
    if (version === 0) {
      createSchema(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 1) {
      migrateVersionOne(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    }
    return database
  } catch (error: unknown) {
    database.close()
    throw error
  }
}

/** Materialize every M3 table in one fresh-schema transaction. */
function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      requirement  TEXT NOT NULL,
      created_at   TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS tasks (
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      id            TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      revision      INTEGER NOT NULL,
      status        TEXT NOT NULL,
      PRIMARY KEY (project_id, id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS task_dependencies (
      project_id          TEXT NOT NULL,
      task_id             TEXT NOT NULL,
      depends_on_task_id  TEXT NOT NULL,
      PRIMARY KEY (project_id, task_id, depends_on_task_id),
      FOREIGN KEY (project_id, task_id)
        REFERENCES tasks(project_id, id) ON DELETE CASCADE,
      FOREIGN KEY (project_id, depends_on_task_id)
        REFERENCES tasks(project_id, id) ON DELETE CASCADE
    ) STRICT;

    CREATE TABLE IF NOT EXISTS task_journal (
      seq           INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    TEXT NOT NULL,
      task_id       TEXT NOT NULL,
      revision      INTEGER NOT NULL,
      event_type    TEXT NOT NULL,
      reason        TEXT,
      snapshot_json TEXT NOT NULL,
      created_at    TEXT NOT NULL,
      UNIQUE (project_id, task_id, revision)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS scheduler_decisions (
      seq           INTEGER PRIMARY KEY AUTOINCREMENT,
      id            TEXT NOT NULL UNIQUE,
      project_id    TEXT NOT NULL,
      task_id       TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      created_at    TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS executions (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      task_id      TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      session_id   TEXT,
      status       TEXT NOT NULL,
      started_at   TEXT NOT NULL,
      completed_at TEXT,
      error_json   TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS execution_events (
      seq          INTEGER PRIMARY KEY AUTOINCREMENT,
      execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
      event_type   TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at   TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS verification_reports (
      id                TEXT PRIMARY KEY,
      project_id        TEXT NOT NULL,
      task_id           TEXT,
      status            TEXT NOT NULL,
      failure_signature TEXT,
      report_json       TEXT NOT NULL,
      created_at        TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS repair_records (
      id                   TEXT PRIMARY KEY,
      project_id           TEXT NOT NULL,
      repair_round         INTEGER NOT NULL,
      verification_report_id TEXT NOT NULL REFERENCES verification_reports(id),
      repair_agent_id      TEXT NOT NULL,
      failure_signature    TEXT NOT NULL,
      error_summary        TEXT NOT NULL,
      change_summary       TEXT NOT NULL,
      diff                 TEXT NOT NULL,
      before_status        TEXT NOT NULL,
      after_status         TEXT NOT NULL,
      started_at           TEXT NOT NULL,
      completed_at         TEXT NOT NULL,
      UNIQUE (project_id, repair_round)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id                 TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      status             TEXT NOT NULL,
      repair_round       INTEGER NOT NULL,
      escalation_reason  TEXT,
      escalation_message TEXT,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS task_journal_project_seq
      ON task_journal(project_id, seq);
    CREATE INDEX IF NOT EXISTS scheduler_decisions_project_seq
      ON scheduler_decisions(project_id, seq);
    CREATE INDEX IF NOT EXISTS executions_project_task
      ON executions(project_id, task_id);
    CREATE INDEX IF NOT EXISTS execution_events_execution_seq
      ON execution_events(execution_id, seq);
    CREATE INDEX IF NOT EXISTS verification_reports_project
      ON verification_reports(project_id, created_at);
    CREATE INDEX IF NOT EXISTS repair_records_project_round
      ON repair_records(project_id, repair_round);
    CREATE INDEX IF NOT EXISTS workflow_runs_project
      ON workflow_runs(project_id);
  `)
}

/** Upgrade one M2 database without rebuilding or discarding committed evidence. */
function migrateVersionOne(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      ALTER TABLE verification_reports ADD COLUMN failure_signature TEXT;

      CREATE TABLE repair_records (
        id                     TEXT PRIMARY KEY,
        project_id             TEXT NOT NULL,
        repair_round           INTEGER NOT NULL,
        verification_report_id TEXT NOT NULL REFERENCES verification_reports(id),
        repair_agent_id        TEXT NOT NULL,
        failure_signature      TEXT NOT NULL,
        error_summary          TEXT NOT NULL,
        change_summary         TEXT NOT NULL,
        diff                   TEXT NOT NULL,
        before_status          TEXT NOT NULL,
        after_status           TEXT NOT NULL,
        started_at             TEXT NOT NULL,
        completed_at           TEXT NOT NULL,
        UNIQUE (project_id, repair_round)
      ) STRICT;

      CREATE TABLE workflow_runs (
        id                 TEXT PRIMARY KEY,
        project_id         TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        status             TEXT NOT NULL,
        repair_round       INTEGER NOT NULL,
        escalation_reason  TEXT,
        escalation_message TEXT,
        created_at         TEXT NOT NULL,
        updated_at         TEXT NOT NULL
      ) STRICT;

      CREATE INDEX repair_records_project_round
        ON repair_records(project_id, repair_round);
      CREATE INDEX workflow_runs_project
        ON workflow_runs(project_id);
    `)
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'schema migration and rollback both failed')
    }
    throw error
  }
}
