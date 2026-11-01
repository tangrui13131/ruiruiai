import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openOrchestrationDatabase,
  ORCHESTRATION_SCHEMA_VERSION,
} from '../src/sqlite.ts'

const legacyVersions = [1, 2, 3, 4, 5] as const
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const expectedTables = [
  'agent_definition_versions',
  'agent_definitions',
  'agent_team_members',
  'agent_team_versions',
  'execution_events',
  'executions',
  'outbox_events',
  'product_events',
  'project_memory_entries',
  'project_runs',
  'project_team_bindings',
  'projects',
  'repair_records',
  'scheduler_decisions',
  'task_dependencies',
  'task_journal',
  'tasks',
  'verification_reports',
  'workflow_control_events',
  'workflow_control_runs',
  'workflow_definitions',
  'workflow_leases',
  'workflow_runs',
]

const requiredIndexes = [
  'agent_definition_versions_status',
  'agent_definitions_discovery_tags',
  'agent_definitions_status',
  'agent_team_members_definition_version',
  'agent_team_versions_status',
  'project_team_bindings_team_version',
  'workflow_control_events_project_seq',
  'workflow_control_runs_definition',
  'workflow_control_runs_status',
  'workflow_definitions_status',
]

function schemaNames(database: DatabaseSync, type: 'table' | 'index'): string[] {
  return (database.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = ? AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all(type) as Array<{ name: string }>).map(row => row.name)
}

function expectConstraintFailure(
  database: DatabaseSync,
  sql: string,
  ...values: Array<string | number>
): void {
  expect(() => database.prepare(sql).run(...values)).toThrow(/constraint failed/i)
}

function insertSchemaRows(database: DatabaseSync): void {
  database.exec(`
    INSERT INTO projects (id, name, requirement, created_at)
    VALUES ('project-1', 'Schema', 'Verify constraints', '2026-11-01T08:00:00.000Z');

    INSERT INTO agent_definitions (
      id, name, purpose, discovery_tags_json, status, created_at, updated_at
    ) VALUES (
      'agent-1',
      'Frontend',
      'Build React pages',
      '["frontend","react"]',
      'PUBLISHED',
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO agent_definition_versions (
      id, agent_definition_id, version, spec_json, checksum, status, created_at
    ) VALUES (
      'agent-version-1',
      'agent-1',
      1,
      '{"model":"deepseek-flash"}',
      'checksum-agent-1',
      'PUBLISHED',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO agent_team_versions (
      id, name, version, spec_json, checksum, status, created_at
    ) VALUES (
      'team-version-1',
      'delivery-team',
      1,
      '{"roles":["frontend"]}',
      'checksum-team-1',
      'PUBLISHED',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO agent_team_members (
      team_version_id, member_id, agent_definition_version_id, instance_count, position
    ) VALUES (
      'team-version-1', 'frontend', 'agent-version-1', 1, 0
    );

    INSERT INTO project_team_bindings (
      project_id, team_version_id, frozen_json, created_at
    ) VALUES (
      'project-1', 'team-version-1', '{"members":["frontend"]}', '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO project_memory_entries (
      id, project_id, kind, key, value_json, source, created_at
    ) VALUES (
      'memory-1',
      'project-1',
      'requirement',
      'stack',
      '["react"]',
      'planner',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO workflow_definitions (
      id, version, graph_json, checksum, status, created_at
    ) VALUES (
      'workflow-1',
      1,
      '{"nodes":["verify","repair"]}',
      'checksum-workflow-1',
      'PUBLISHED',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO workflow_control_runs (
      project_id, definition_id, definition_version, snapshot_json, status, created_at, updated_at
    ) VALUES (
      'project-1',
      'workflow-1',
      1,
      '{"node":"verify"}',
      'RUNNING',
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO workflow_control_events (
      project_id, entry_seq, event_type, event_json, created_at
    ) VALUES (
      'project-1',
      1,
      'workflow.entered',
      '{"node":"verify"}',
      '2026-11-01T08:00:00.000Z'
    );
  `)
}

function downgradeToVersion(database: DatabaseSync, version: number): void {
  database.exec(`
    DROP TABLE workflow_control_events;
    DROP TABLE workflow_control_runs;
    DROP TABLE project_memory_entries;
    DROP TABLE project_team_bindings;
    DROP TABLE agent_team_members;
    DROP TABLE agent_definition_versions;
    DROP TABLE agent_team_versions;
    DROP TABLE workflow_definitions;
    DROP TABLE agent_definitions;
  `)

  if (version < 5) {
    database.exec('DROP TABLE project_runs')
  }
  if (version < 4) {
    database.exec(`
      DROP INDEX outbox_events_claim_expiry;
      ALTER TABLE outbox_events DROP COLUMN claim_expires_at;
      ALTER TABLE outbox_events DROP COLUMN claimed_at;
      ALTER TABLE outbox_events DROP COLUMN claim_token;
      ALTER TABLE outbox_events DROP COLUMN claim_owner_id;
      ALTER TABLE tasks DROP COLUMN position;
    `)
  }
  if (version < 3) {
    database.exec(`
      DROP TABLE outbox_events;
      DROP TABLE product_events;
      DROP TABLE workflow_leases;
      ALTER TABLE projects DROP COLUMN last_event_seq;
    `)
  }
  if (version < 2) {
    database.exec(`
      DROP TABLE repair_records;
      DROP TABLE workflow_runs;
      ALTER TABLE verification_reports DROP COLUMN failure_signature;
    `)
  }

  database.exec(`PRAGMA user_version = ${version}`)
}

describe('orchestration schema v6', () => {
  it('creates every fresh table, index, and foreign-key mode at schema version 6', () => {
    const database = openOrchestrationDatabase(':memory:', 'delete')
    try {
      expect(ORCHESTRATION_SCHEMA_VERSION).toBe(6)
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 })
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
      expect(schemaNames(database, 'table')).toEqual(expectedTables)
      expect(schemaNames(database, 'index')).toEqual(expect.arrayContaining(requiredIndexes))
    } finally {
      database.close()
    }
  })

  it('enforces the new unique keys, composite keys, and foreign keys', () => {
    const database = openOrchestrationDatabase(':memory:', 'delete')
    try {
      insertSchemaRows(database)

      expectConstraintFailure(database, `
        INSERT INTO agent_definition_versions (
          id, agent_definition_id, version, spec_json, checksum, status, created_at
        ) VALUES ('agent-version-copy', 'agent-1', 1, '{}', 'copy', 'DRAFT', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, `
        INSERT INTO agent_team_versions (
          id, name, version, spec_json, checksum, status, created_at
        ) VALUES ('team-version-copy', 'delivery-team', 1, '{}', 'copy', 'DRAFT', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, `
        INSERT INTO agent_team_members (
          team_version_id, member_id, agent_definition_version_id, instance_count, position
        ) VALUES ('team-version-1', 'frontend', 'agent-version-1', 2, 1)
      `)
      expectConstraintFailure(database, `
        INSERT INTO project_memory_entries (
          id, project_id, kind, key, value_json, source, created_at
        ) VALUES ('memory-copy', 'project-1', 'requirement', 'stack', '[]', 'planner', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, `
        INSERT INTO workflow_definitions (
          id, version, graph_json, checksum, status, created_at
        ) VALUES ('workflow-1', 1, '{}', 'copy', 'DRAFT', '2026-11-01T09:00:00.000Z')
      `)

      expectConstraintFailure(database, `
        INSERT INTO agent_definition_versions (
          id, agent_definition_id, version, spec_json, checksum, status, created_at
        ) VALUES ('missing-definition', 'missing', 1, '{}', 'missing', 'DRAFT', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, `
        INSERT INTO agent_team_members (
          team_version_id, member_id, agent_definition_version_id, instance_count, position
        ) VALUES ('team-version-1', 'missing', 'missing-version', 1, 1)
      `)
      expectConstraintFailure(database, `
        INSERT INTO project_team_bindings (
          project_id, team_version_id, frozen_json, created_at
        ) VALUES ('missing-project', 'team-version-1', '{}', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, `
        INSERT INTO project_memory_entries (
          id, project_id, kind, key, value_json, source, created_at
        ) VALUES ('missing-memory', 'missing-project', 'requirement', 'stack', '[]', 'planner', '2026-11-01T09:00:00.000Z')
      `)

      database.exec(`
        INSERT INTO projects (id, name, requirement, created_at)
        VALUES ('project-2', 'Schema 2', 'Verify workflow FK', '2026-11-01T08:00:00.000Z');
      `)
      expectConstraintFailure(database, `
        INSERT INTO workflow_control_runs (
          project_id, definition_id, definition_version, snapshot_json, status, created_at, updated_at
        ) VALUES ('project-2', 'workflow-1', 2, '{}', 'RUNNING', '2026-11-01T09:00:00.000Z', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, `
        INSERT INTO workflow_control_events (
          project_id, entry_seq, event_type, event_json, created_at
        ) VALUES ('missing-project', 2, 'workflow.entered', '{}', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, "DELETE FROM agent_definitions WHERE id = 'agent-1'")

      database.prepare('DELETE FROM projects WHERE id = ?').run('project-1')
      for (const table of [
        'project_team_bindings',
        'project_memory_entries',
        'workflow_control_runs',
        'workflow_control_events',
      ]) {
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get())
          .toEqual({ count: 0 })
      }
    } finally {
      database.close()
    }
  })

  it.each(legacyVersions)('migrates schema v%i to v6 without losing existing evidence', (version) => {
    const root = mkdtempSync(join(tmpdir(), `future-cup-schema-v${version}-`))
    temporaryRoots.push(root)
    const path = join(root, 'orchestration.sqlite')

    const current = openOrchestrationDatabase(path, 'delete')
    current.exec(`
      INSERT INTO projects (id, name, requirement, created_at)
      VALUES ('project-legacy', 'Legacy', 'Preserve evidence', '2026-11-01T08:00:00.000Z');

      INSERT INTO tasks (project_id, id, snapshot_json, revision, status, position)
      VALUES (
        'project-legacy',
        'task-legacy',
        '{"id":"task-legacy","status":"PENDING"}',
        1,
        'PENDING',
        0
      );

      INSERT INTO verification_reports (
        id, project_id, task_id, status, failure_signature, report_json, created_at
      ) VALUES (
        'verification-legacy',
        'project-legacy',
        'task-legacy',
        'PASS',
        'legacy-signature',
        '{"status":"PASS"}',
        '2026-11-01T08:00:00.000Z'
      );
    `)
    current.close()

    const legacy = new DatabaseSync(path)
    legacy.exec('PRAGMA foreign_keys = ON')
    downgradeToVersion(legacy, version)
    legacy.close()

    const migrated = openOrchestrationDatabase(path, 'delete')
    try {
      expect(migrated.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 })
      expect(migrated.prepare('SELECT name FROM projects WHERE id = ?').get('project-legacy'))
        .toEqual({ name: 'Legacy' })
      expect(migrated.prepare('SELECT status FROM tasks WHERE id = ?').get('task-legacy'))
        .toEqual({ status: 'PENDING' })
      expect(migrated.prepare('SELECT status FROM verification_reports WHERE id = ?')
        .get('verification-legacy')).toEqual({ status: 'PASS' })
      expect(schemaNames(migrated, 'table')).toEqual(expectedTables)
    } finally {
      migrated.close()
    }
  })
})
