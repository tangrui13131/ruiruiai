/** SQLite schema bootstrap for the Future Cup orchestration repository. */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/** Physical SQLite layout version stored in `PRAGMA user_version`. */
export const ORCHESTRATION_SCHEMA_VERSION = 6

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
    if (version !== 0
      && version !== 1
      && version !== 2
      && version !== 3
      && version !== 4
      && version !== 5
      && version !== ORCHESTRATION_SCHEMA_VERSION) {
      throw new Error(
        `orchestration database at "${actual}" has schema version ${version}, expected ${ORCHESTRATION_SCHEMA_VERSION}`,
      )
    }
    if (version === 0) {
      createSchema(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 1) {
      migrateVersionOne(database)
      migrateVersionTwo(database)
      migrateVersionThree(database)
      migrateVersionFour(database)
      migrateVersionFive(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 2) {
      migrateVersionTwo(database)
      migrateVersionThree(database)
      migrateVersionFour(database)
      migrateVersionFive(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 3) {
      migrateVersionThree(database)
      migrateVersionFour(database)
      migrateVersionFive(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 4) {
      migrateVersionFour(database)
      migrateVersionFive(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 5) {
      migrateVersionFive(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    }
    return database
  } catch (error: unknown) {
    database.close()
    throw error
  }
}

/** Materialize the complete current schema. */
function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      requirement    TEXT NOT NULL,
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS tasks (
      project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      id            TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      revision      INTEGER NOT NULL,
      status        TEXT NOT NULL,
      position      INTEGER NOT NULL,
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

    CREATE TABLE IF NOT EXISTS project_runs (
      id             TEXT PRIMARY KEY,
      project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      status         TEXT NOT NULL,
      owner_id       TEXT NOT NULL,
      fencing_token  INTEGER NOT NULL,
      workspace_path TEXT NOT NULL,
      preview_path   TEXT,
      started_at     TEXT NOT NULL,
      completed_at   TEXT,
      error_json     TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS product_events (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      seq          INTEGER NOT NULL,
      type         TEXT NOT NULL,
      task_id      TEXT,
      agent_id     TEXT,
      payload_json TEXT NOT NULL,
      occurred_at  TEXT NOT NULL,
      UNIQUE (project_id, seq)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS outbox_events (
      event_id         TEXT PRIMARY KEY REFERENCES product_events(id) ON DELETE CASCADE,
      published_at     TEXT,
      claim_owner_id   TEXT,
      claim_token      TEXT,
      claimed_at       TEXT,
      claim_expires_at TEXT
    ) STRICT;

    CREATE TABLE IF NOT EXISTS workflow_leases (
      resource_id   TEXT PRIMARY KEY,
      project_id    TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      owner_id      TEXT,
      fencing_token INTEGER NOT NULL,
      heartbeat_at  TEXT NOT NULL,
      expires_at    TEXT NOT NULL
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
    CREATE INDEX IF NOT EXISTS project_runs_project_started
      ON project_runs(project_id, started_at);
    CREATE UNIQUE INDEX IF NOT EXISTS project_runs_one_active
      ON project_runs(project_id) WHERE status = 'RUNNING';
    CREATE INDEX IF NOT EXISTS product_events_project_seq
      ON product_events(project_id, seq);
    CREATE INDEX IF NOT EXISTS outbox_events_unpublished
      ON outbox_events(published_at);
    CREATE INDEX IF NOT EXISTS outbox_events_claim_expiry
      ON outbox_events(published_at, claim_expires_at);

    ${agentRegistryWorkflowSchemaSql('fresh')}
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

/** Add M4 platform events, Outbox delivery, and workflow leases. */
function migrateVersionTwo(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      ALTER TABLE projects
        ADD COLUMN last_event_seq INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE product_events (
        id           TEXT PRIMARY KEY,
        project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        seq          INTEGER NOT NULL,
        type         TEXT NOT NULL,
        task_id      TEXT,
        agent_id     TEXT,
        payload_json TEXT NOT NULL,
        occurred_at  TEXT NOT NULL,
        UNIQUE (project_id, seq)
      ) STRICT;

      CREATE TABLE outbox_events (
        event_id     TEXT PRIMARY KEY REFERENCES product_events(id) ON DELETE CASCADE,
        published_at TEXT
      ) STRICT;

      CREATE TABLE workflow_leases (
        resource_id   TEXT PRIMARY KEY,
        project_id    TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
        owner_id      TEXT,
        fencing_token INTEGER NOT NULL,
        heartbeat_at  TEXT NOT NULL,
        expires_at    TEXT NOT NULL
      ) STRICT;

      CREATE INDEX product_events_project_seq
        ON product_events(project_id, seq);
      CREATE INDEX outbox_events_unpublished
        ON outbox_events(published_at);
    `)
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v2 migration and rollback both failed')
    }
    throw error
  }
}

/** Add stable task positions, Outbox claim leases, and expired-claim recovery. */
function migrateVersionThree(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      ALTER TABLE tasks
        ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

      UPDATE tasks
      SET position = (
        SELECT COUNT(*)
        FROM tasks AS earlier
        WHERE earlier.project_id = tasks.project_id
          AND earlier.rowid < tasks.rowid
      );

      ALTER TABLE outbox_events
        ADD COLUMN claim_owner_id TEXT;
      ALTER TABLE outbox_events
        ADD COLUMN claim_token TEXT;
      ALTER TABLE outbox_events
        ADD COLUMN claimed_at TEXT;
      ALTER TABLE outbox_events
        ADD COLUMN claim_expires_at TEXT;

      CREATE INDEX outbox_events_claim_expiry
        ON outbox_events(published_at, claim_expires_at);
    `)
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v3 migration and rollback both failed')
    }
    throw error
  }
}

/** Add durable project launch attempts and enforce one active run per project. */
function migrateVersionFour(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE project_runs (
        id             TEXT PRIMARY KEY,
        project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status         TEXT NOT NULL,
        owner_id       TEXT NOT NULL,
        fencing_token  INTEGER NOT NULL,
        workspace_path TEXT NOT NULL,
        preview_path   TEXT,
        started_at     TEXT NOT NULL,
        completed_at   TEXT,
        error_json     TEXT
      ) STRICT;

      CREATE INDEX project_runs_project_started
        ON project_runs(project_id, started_at);
      CREATE UNIQUE INDEX project_runs_one_active
        ON project_runs(project_id) WHERE status = 'RUNNING';
    `)
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v4 migration and rollback both failed')
    }
    throw error
  }
}

/** Add the M5 Agent Registry, project memory, and workflow control tables. */
function migrateVersionFive(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(agentRegistryWorkflowSchemaSql('migration'))
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v5 migration and rollback both failed')
    }
    throw error
  }
}

/**
 * Build the v6 table and index DDL for a fresh database or an in-place upgrade.
 * @param mode - whether repeated objects should be ignored or treated as corruption.
 * @returns executable SQLite DDL.
 */
function agentRegistryWorkflowSchemaSql(mode: 'fresh' | 'migration'): string {
  const guard = mode === 'fresh' ? 'IF NOT EXISTS ' : ''
  return `
    CREATE TABLE ${guard}agent_definitions (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      purpose             TEXT NOT NULL,
      discovery_tags_json TEXT NOT NULL,
      status              TEXT NOT NULL,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    ) STRICT;

    CREATE TABLE ${guard}agent_definition_versions (
      id                  TEXT PRIMARY KEY,
      agent_definition_id TEXT NOT NULL
        REFERENCES agent_definitions(id) ON DELETE RESTRICT,
      version             INTEGER NOT NULL,
      spec_json           TEXT NOT NULL,
      checksum            TEXT NOT NULL,
      status              TEXT NOT NULL,
      created_at          TEXT NOT NULL,
      published_at        TEXT,
      deprecated_at       TEXT,
      UNIQUE (agent_definition_id, version)
    ) STRICT;

    CREATE TABLE ${guard}agent_team_versions (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      version      INTEGER NOT NULL,
      spec_json    TEXT NOT NULL,
      checksum     TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      published_at TEXT,
      UNIQUE (name, version)
    ) STRICT;

    CREATE TABLE ${guard}agent_team_members (
      team_version_id           TEXT NOT NULL
        REFERENCES agent_team_versions(id) ON DELETE CASCADE,
      member_id                 TEXT NOT NULL,
      agent_definition_version_id TEXT NOT NULL
        REFERENCES agent_definition_versions(id) ON DELETE RESTRICT,
      instance_count            INTEGER NOT NULL,
      position                  INTEGER NOT NULL,
      PRIMARY KEY (team_version_id, member_id)
    ) STRICT;

    CREATE TABLE ${guard}project_team_bindings (
      project_id      TEXT PRIMARY KEY
        REFERENCES projects(id) ON DELETE CASCADE,
      team_version_id TEXT NOT NULL
        REFERENCES agent_team_versions(id) ON DELETE RESTRICT,
      frozen_json     TEXT NOT NULL,
      created_at      TEXT NOT NULL
    ) STRICT;

    CREATE TABLE ${guard}project_memory_entries (
      id         TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind       TEXT NOT NULL,
      key        TEXT NOT NULL,
      value_json TEXT NOT NULL,
      source     TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, kind, key)
    ) STRICT;

    CREATE TABLE ${guard}workflow_definitions (
      id           TEXT NOT NULL,
      version      INTEGER NOT NULL,
      graph_json   TEXT NOT NULL,
      checksum     TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      published_at TEXT,
      PRIMARY KEY (id, version)
    ) STRICT;

    CREATE TABLE ${guard}workflow_control_runs (
      project_id         TEXT PRIMARY KEY
        REFERENCES projects(id) ON DELETE CASCADE,
      definition_id      TEXT NOT NULL,
      definition_version INTEGER NOT NULL,
      snapshot_json      TEXT NOT NULL,
      status             TEXT NOT NULL,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      FOREIGN KEY (definition_id, definition_version)
        REFERENCES workflow_definitions(id, version) ON DELETE RESTRICT
    ) STRICT;

    CREATE TABLE ${guard}workflow_control_events (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      entry_seq  INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, entry_seq)
    ) STRICT;

    CREATE INDEX ${guard}agent_definitions_status
      ON agent_definitions(status);
    CREATE INDEX ${guard}agent_definitions_discovery_tags
      ON agent_definitions(discovery_tags_json);
    CREATE INDEX ${guard}agent_definition_versions_status
      ON agent_definition_versions(status);
    CREATE INDEX ${guard}agent_team_versions_status
      ON agent_team_versions(status);
    CREATE INDEX ${guard}agent_team_members_definition_version
      ON agent_team_members(agent_definition_version_id);
    CREATE INDEX ${guard}project_team_bindings_team_version
      ON project_team_bindings(team_version_id);
    CREATE INDEX ${guard}workflow_definitions_status
      ON workflow_definitions(status);
    CREATE INDEX ${guard}workflow_control_runs_definition
      ON workflow_control_runs(definition_id, definition_version);
    CREATE INDEX ${guard}workflow_control_runs_status
      ON workflow_control_runs(status);
    CREATE INDEX ${guard}workflow_control_events_project_seq
      ON workflow_control_events(project_id, seq);
  `
}
