/** SQLite schema bootstrap for the Future Cup orchestration repository. */

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { parseStoredAgentTeamVersion } from './agent-registry.ts'

/** Physical SQLite layout version stored in `PRAGMA user_version`. */
export const ORCHESTRATION_SCHEMA_VERSION = 9

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
      && version !== 6
      && version !== 7
      && version !== 8
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
      migrateVersionSix(database)
      migrateVersionSeven(database)
      migrateVersionEight(database)
      migrateVersionNine(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 2) {
      migrateVersionTwo(database)
      migrateVersionThree(database)
      migrateVersionFour(database)
      migrateVersionFive(database)
      migrateVersionSix(database)
      migrateVersionSeven(database)
      migrateVersionEight(database)
      migrateVersionNine(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 3) {
      migrateVersionThree(database)
      migrateVersionFour(database)
      migrateVersionFive(database)
      migrateVersionSix(database)
      migrateVersionSeven(database)
      migrateVersionEight(database)
      migrateVersionNine(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 4) {
      migrateVersionFour(database)
      migrateVersionFive(database)
      migrateVersionSix(database)
      migrateVersionSeven(database)
      migrateVersionEight(database)
      migrateVersionNine(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 5) {
      migrateVersionFive(database)
      migrateVersionSix(database)
      migrateVersionSeven(database)
      migrateVersionEight(database)
      migrateVersionNine(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 6) {
      migrateVersionSix(database)
      migrateVersionSeven(database)
      migrateVersionEight(database)
      migrateVersionNine(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 7) {
      migrateVersionSeven(database)
      migrateVersionEight(database)
      migrateVersionNine(database)
      database.exec(`PRAGMA user_version = ${ORCHESTRATION_SCHEMA_VERSION}`)
    } else if (version === 8) {
      migrateVersionNine(database)
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
      created_at     TEXT NOT NULL,
      source_project_id   TEXT,
      source_project_name TEXT,
      source_run_id       TEXT,
      derivation_mode     TEXT,
      change_request      TEXT
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
    CREATE INDEX IF NOT EXISTS projects_source_project
      ON projects(source_project_id);
    CREATE UNIQUE INDEX IF NOT EXISTS project_runs_one_active
      ON project_runs(project_id) WHERE status = 'RUNNING';
    CREATE INDEX IF NOT EXISTS product_events_project_seq
      ON product_events(project_id, seq);
    CREATE INDEX IF NOT EXISTS outbox_events_unpublished
      ON outbox_events(published_at);
    CREATE INDEX IF NOT EXISTS outbox_events_claim_expiry
      ON outbox_events(published_at, claim_expires_at);

    ${agentRegistryWorkflowSchemaSql('fresh')}
    ${repairStrategySchemaSql('fresh')}
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

/** Add explainable adaptive repair strategy decisions. */
function migrateVersionSix(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(repairStrategySchemaSql('migration'))
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v6 migration and rollback both failed')
    }
    throw error
  }
}

/** Add logical Team ownership and one-row-per-runtime-instance member storage. */
function migrateVersionSeven(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS agent_teams (
        id         TEXT PRIMARY KEY,
        owner_id   TEXT NOT NULL,
        name       TEXT NOT NULL,
        purpose    TEXT NOT NULL,
        status     TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, name)
      ) STRICT;
    `)
    if (!hasColumn(database, 'agent_team_versions', 'team_id')) {
      database.exec('ALTER TABLE agent_team_versions ADD COLUMN team_id TEXT;')
    }
    database.exec(`
      INSERT OR IGNORE INTO agent_teams (
        id, owner_id, name, purpose, status, created_at, updated_at
      )
      SELECT
        'legacy-team:' || grouped.min_id,
        'legacy',
        grouped.name,
        COALESCE(json_extract(canonical.spec_json, '$.purpose'), 'Legacy Agent team'),
        'ACTIVE',
        grouped.min_created_at,
        grouped.max_updated_at
      FROM (
        SELECT
          name,
          MIN(id) AS min_id,
          MIN(created_at) AS min_created_at,
          MAX(COALESCE(published_at, created_at)) AS max_updated_at
        FROM agent_team_versions
        GROUP BY name
      ) AS grouped
      JOIN agent_team_versions AS canonical
        ON canonical.name = grouped.name AND canonical.id = grouped.min_id;

      UPDATE agent_team_versions
      SET team_id = (
        SELECT 'legacy-team:' || MIN(peer.id)
        FROM agent_team_versions AS peer
        WHERE peer.name = agent_team_versions.name
      )
      WHERE team_id IS NULL;

      CREATE INDEX IF NOT EXISTS agent_team_versions_team
        ON agent_team_versions(team_id);
    `)
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v7 migration and rollback both failed')
    }
    throw error
  }
}

/**
 * Collapse the legacy aggregate and duplicate runtime member tables into one
 * per-instance table, and enforce the Team ordinal and HQ placement keys.
 */
function migrateVersionEight(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.exec('BEGIN IMMEDIATE')
    const needsMemberRebuild = hasColumn(database, 'agent_team_members', 'instance_count')
      || !hasIndex(database, 'agent_team_members', 'agent_team_members_department_position')
    database.exec(`
      DROP TABLE IF EXISTS agent_team_runtime_members;
      DROP INDEX IF EXISTS agent_team_runtime_members_definition_version;
      DROP INDEX IF EXISTS agent_team_members_department_position;
    `)

    if (needsMemberRebuild) {
      database.exec(`
        CREATE TABLE agent_team_members_next (
          team_version_id            TEXT NOT NULL,
          member_id                  TEXT NOT NULL,
          agent_definition_version_id TEXT NOT NULL,
          display_name               TEXT NOT NULL,
          department_key             TEXT NOT NULL,
          position                   INTEGER NOT NULL,
          PRIMARY KEY (team_version_id, member_id),
          UNIQUE (team_version_id, department_key, position),
          FOREIGN KEY (team_version_id)
            REFERENCES agent_team_versions(id) ON DELETE CASCADE,
          FOREIGN KEY (agent_definition_version_id)
            REFERENCES agent_definition_versions(id) ON DELETE RESTRICT
        ) STRICT;
      `)

      const memberStatement = database.prepare(`
        INSERT INTO agent_team_members_next (
          team_version_id, member_id, agent_definition_version_id,
          display_name, department_key, position
        ) VALUES (?, ?, ?, ?, ?, ?)
      `)
      const versionRows = database.prepare(`
        SELECT id, spec_json
        FROM agent_team_versions
      `).all() as Array<{ id: string; spec_json: string }>
      for (const row of versionRows) {
        const teamVersion = parseStoredAgentTeamVersion(JSON.parse(row.spec_json))
        for (const member of teamVersion.members) {
          memberStatement.run(
            row.id,
            member.instanceId,
            member.version.id,
            member.displayName,
            member.departmentKey,
            member.position,
          )
        }
      }

      database.exec(`
        DROP TABLE agent_team_members;
        ALTER TABLE agent_team_members_next RENAME TO agent_team_members;
      `)
    }

    database.exec(`
      CREATE INDEX IF NOT EXISTS agent_team_members_definition_version
        ON agent_team_members(agent_definition_version_id);
      CREATE INDEX IF NOT EXISTS agent_team_members_department_position
        ON agent_team_members(team_version_id, department_key, position);
    `)

    // Replace the legacy (name, version) key with the logical Team ordinal.
    database.exec(`
      DROP INDEX IF EXISTS agent_team_versions_team;
      CREATE TABLE agent_team_versions_next (
        id           TEXT PRIMARY KEY,
        team_id      TEXT NOT NULL REFERENCES agent_teams(id) ON DELETE RESTRICT,
        name         TEXT NOT NULL,
        version      INTEGER NOT NULL,
        spec_json    TEXT NOT NULL,
        checksum     TEXT NOT NULL,
        status       TEXT NOT NULL,
        created_at   TEXT NOT NULL,
        published_at TEXT,
        UNIQUE (team_id, version)
      ) STRICT;

      INSERT INTO agent_team_versions_next (
        id, team_id, name, version, spec_json, checksum, status, created_at, published_at
      )
      SELECT id, team_id, name, version, spec_json, checksum, status, created_at, published_at
      FROM agent_team_versions;

      DROP TABLE agent_team_versions;
      ALTER TABLE agent_team_versions_next RENAME TO agent_team_versions;

      CREATE INDEX IF NOT EXISTS agent_team_versions_team
        ON agent_team_versions(team_id);
      CREATE INDEX IF NOT EXISTS agent_team_versions_status
        ON agent_team_versions(status);
    `)
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v8 migration and rollback both failed')
    }
    throw error
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}

/** Add project derivation lineage for creating upgrade successors without mutating history. */
function migrateVersionNine(database: DatabaseSync): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    if (!hasColumn(database, 'projects', 'source_project_id')) {
      database.exec('ALTER TABLE projects ADD COLUMN source_project_id TEXT;')
    }
    if (!hasColumn(database, 'projects', 'source_project_name')) {
      database.exec('ALTER TABLE projects ADD COLUMN source_project_name TEXT;')
    }
    if (!hasColumn(database, 'projects', 'source_run_id')) {
      database.exec('ALTER TABLE projects ADD COLUMN source_run_id TEXT;')
    }
    if (!hasColumn(database, 'projects', 'derivation_mode')) {
      database.exec('ALTER TABLE projects ADD COLUMN derivation_mode TEXT;')
    }
    if (!hasColumn(database, 'projects', 'change_request')) {
      database.exec('ALTER TABLE projects ADD COLUMN change_request TEXT;')
    }
    database.exec(`
      CREATE INDEX IF NOT EXISTS projects_source_project
        ON projects(source_project_id);
    `)
    database.exec('COMMIT')
  } catch (error: unknown) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError: unknown) {
      throw new AggregateError([error, rollbackError], 'v9 migration and rollback both failed')
    }
    throw error
  }
}

function hasColumn(database: DatabaseSync, table: string, column: string): boolean {
  return database.prepare(`PRAGMA table_info(${table})`).all()
    .some(row => (
      'name' in row
      && row.name === column
    ))
}

function hasIndex(database: DatabaseSync, table: string, index: string): boolean {
  return database.prepare(`PRAGMA index_list(${table})`).all()
    .some(row => (
      'name' in row
      && row.name === index
    ))
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

    CREATE TABLE ${guard}agent_teams (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL,
      name       TEXT NOT NULL,
      purpose    TEXT NOT NULL,
      status     TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (owner_id, name)
    ) STRICT;

    CREATE TABLE ${guard}agent_team_versions (
      id           TEXT PRIMARY KEY,
      team_id      TEXT NOT NULL REFERENCES agent_teams(id) ON DELETE RESTRICT,
      name         TEXT NOT NULL,
      version      INTEGER NOT NULL,
      spec_json    TEXT NOT NULL,
      checksum     TEXT NOT NULL,
      status       TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      published_at TEXT,
      UNIQUE (team_id, version)
    ) STRICT;

    CREATE TABLE ${guard}agent_team_members (
      team_version_id           TEXT NOT NULL
        REFERENCES agent_team_versions(id) ON DELETE CASCADE,
      member_id                 TEXT NOT NULL,
      agent_definition_version_id TEXT NOT NULL
        REFERENCES agent_definition_versions(id) ON DELETE RESTRICT,
      display_name              TEXT NOT NULL,
      department_key            TEXT NOT NULL,
      position                  INTEGER NOT NULL,
      PRIMARY KEY (team_version_id, member_id),
      UNIQUE (team_version_id, department_key, position)
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
    CREATE INDEX ${guard}agent_team_versions_team
      ON agent_team_versions(team_id);
    CREATE INDEX ${guard}agent_team_members_definition_version
      ON agent_team_members(agent_definition_version_id);
    CREATE INDEX ${guard}agent_team_members_department_position
      ON agent_team_members(team_version_id, department_key, position);
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

function repairStrategySchemaSql(mode: 'fresh' | 'migration'): string {
  const guard = mode === 'fresh' ? 'IF NOT EXISTS ' : ''
  return `
    CREATE TABLE ${guard}repair_strategy_decisions (
      id                 TEXT PRIMARY KEY,
      project_id         TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      repair_round       INTEGER NOT NULL,
      failure_signature  TEXT NOT NULL,
      strategy_id        TEXT NOT NULL,
      decision_json      TEXT NOT NULL,
      outcome_json       TEXT,
      repair_record_id   TEXT REFERENCES repair_records(id),
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      UNIQUE (project_id, repair_round)
    ) STRICT;

    CREATE INDEX ${guard}repair_strategy_decisions_project_round
      ON repair_strategy_decisions(project_id, repair_round);
  `
}
