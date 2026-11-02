import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  openOrchestrationDatabase,
  ORCHESTRATION_SCHEMA_VERSION,
} from '../src/sqlite.ts'

const legacyVersions = [1, 2, 3, 4, 5, 6, 7] as const
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    try {
      rmSync(root, { recursive: true, force: true })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM') {
        continue
      }
      throw error
    }
  }
})

const expectedTables = [
  'agent_definition_versions',
  'agent_definitions',
  'agent_team_members',
  'agent_team_versions',
  'agent_teams',
  'execution_events',
  'executions',
  'outbox_events',
  'product_events',
  'project_memory_entries',
  'project_runs',
  'project_team_bindings',
  'projects',
  'repair_records',
  'repair_strategy_decisions',
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
  'agent_team_members_department_position',
  'agent_team_members_definition_version',
  'agent_team_versions_team',
  'agent_team_versions_status',
  'project_team_bindings_team_version',
  'repair_strategy_decisions_project_round',
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

    INSERT INTO agent_teams (
      id, owner_id, name, purpose, status, created_at, updated_at
    ) VALUES (
      'team-1',
      'user-1',
      'delivery-team',
      'Deliver the project',
      'ACTIVE',
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO agent_team_versions (
      id, team_id, name, version, spec_json, checksum, status, created_at
    ) VALUES (
      'team-version-1',
      'team-1',
      'delivery-team',
      1,
      '{"roles":["frontend"]}',
      'checksum-team-1',
      'PUBLISHED',
      '2026-11-01T08:00:00.000Z'
    );

    INSERT INTO agent_team_members (
      team_version_id, member_id, agent_definition_version_id,
      display_name, department_key, position
    ) VALUES (
      'team-version-1', 'frontend-1', 'agent-version-1',
      'Frontend 1', 'frontend-a', 1
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

    INSERT INTO repair_strategy_decisions (
      id, project_id, repair_round, failure_signature, strategy_id,
      decision_json, created_at, updated_at
    ) VALUES (
      'repair-strategy-1',
      'project-1',
      1,
      'signature',
      'typescript-context',
      '{"reason":"type error"}',
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:00:00.000Z'
    );
  `)
}

function downgradeToVersion(database: DatabaseSync, version: number): void {
  if (version <= 7) {
    database.exec(`
      DROP TABLE IF EXISTS agent_team_runtime_members;
      DROP INDEX IF EXISTS agent_team_members_department_position;

      CREATE TABLE agent_team_members_v7 (
        team_version_id            TEXT NOT NULL,
        member_id                  TEXT NOT NULL,
        agent_definition_version_id TEXT NOT NULL,
        instance_count             INTEGER NOT NULL,
        position                   INTEGER NOT NULL,
        PRIMARY KEY (team_version_id, member_id)
      ) STRICT;

      INSERT INTO agent_team_members_v7 (
        team_version_id, member_id, agent_definition_version_id, instance_count, position
      )
      SELECT
        team_version_id,
        member_id,
        agent_definition_version_id,
        1,
        position
      FROM agent_team_members;

      DROP TABLE agent_team_members;
      ALTER TABLE agent_team_members_v7 RENAME TO agent_team_members;

      CREATE TABLE agent_team_versions_v7 (
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

      INSERT INTO agent_team_versions_v7 (
        id, name, version, spec_json, checksum, status, created_at, published_at
      )
      SELECT id, name, version, spec_json, checksum, status, created_at, published_at
      FROM agent_team_versions;

      DROP TABLE agent_team_versions;
      ALTER TABLE agent_team_versions_v7 RENAME TO agent_team_versions;

      DROP TABLE IF EXISTS agent_teams;
    `)
  }

  if (version <= 6) {
    database.exec('DROP TABLE repair_strategy_decisions')
  }

  if (version <= 5) {
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
  }

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

describe('orchestration schema v8', () => {
  it('creates every fresh table, index, and foreign-key mode at schema version 8', () => {
    const database = openOrchestrationDatabase(':memory:', 'delete')
    try {
      expect(ORCHESTRATION_SCHEMA_VERSION).toBe(8)
      expect(database.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
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
          team_version_id, member_id, agent_definition_version_id,
          display_name, department_key, position
        ) VALUES ('team-version-1', 'frontend-copy', 'agent-version-1',
          'Frontend copy', 'frontend-a', 1)
      `)
      expectConstraintFailure(database, `
        INSERT INTO agent_team_members (
          team_version_id, member_id, agent_definition_version_id,
          display_name, department_key, position
        ) VALUES ('team-version-1', 'frontend-b', 'agent-version-1',
          'Frontend B', 'frontend-a', 1)
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
        INSERT INTO repair_strategy_decisions (
          id, project_id, repair_round, failure_signature, strategy_id,
          decision_json, created_at, updated_at
        ) VALUES (
          'repair-strategy-copy', 'project-1', 1, 'signature', 'copy',
          '{}', '2026-11-01T09:00:00.000Z', '2026-11-01T09:00:00.000Z'
        )
      `)

      expectConstraintFailure(database, `
        INSERT INTO agent_definition_versions (
          id, agent_definition_id, version, spec_json, checksum, status, created_at
        ) VALUES ('missing-definition', 'missing', 1, '{}', 'missing', 'DRAFT', '2026-11-01T09:00:00.000Z')
      `)
      expectConstraintFailure(database, `
        INSERT INTO agent_team_members (
          team_version_id, member_id, agent_definition_version_id,
          display_name, department_key, position
        ) VALUES ('team-version-1', 'missing', 'missing-version',
          'Missing', 'planning', 1)
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
        'repair_strategy_decisions',
        'workflow_control_events',
      ]) {
        expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get())
          .toEqual({ count: 0 })
      }
    } finally {
      database.close()
    }
  })

  it.each(legacyVersions)('migrates schema v%i to v8 without losing existing evidence', (version) => {
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
      expect(migrated.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 })
      expect(migrated.prepare('SELECT name FROM projects WHERE id = ?').get('project-legacy'))
        .toEqual({ name: 'Legacy' })
      expect(migrated.prepare('SELECT status FROM tasks WHERE id = ?').get('task-legacy'))
        .toEqual({ status: 'PENDING' })
      expect(migrated.prepare('SELECT status FROM verification_reports WHERE id = ?')
        .get('verification-legacy')).toEqual({ status: 'PASS' })
      expect(schemaNames(migrated, 'table')).toEqual(expectedTables)
      expect(schemaNames(migrated, 'index')).toEqual(expect.arrayContaining(requiredIndexes))
      const teamVersionForeignKeys = migrated.prepare(
        'PRAGMA foreign_key_list(agent_team_versions)',
      ).all() as Array<{ table: string }>
      expect(teamVersionForeignKeys.map(row => row.table)).toContain('agent_teams')
    } finally {
      migrated.close()
    }
  })

  it('expands v7 instance_count members into stable runtime rows and backfills team_id', () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-schema-v7-expand-'))
    temporaryRoots.push(root)
    const path = join(root, 'orchestration.sqlite')

    const current = openOrchestrationDatabase(path, 'delete')
    current.exec(`
      INSERT INTO projects (id, name, requirement, created_at)
      VALUES ('project-legacy', 'Legacy', 'Expand runtime members', '2026-11-01T08:00:00.000Z');

      INSERT INTO agent_definitions (
        id, name, purpose, discovery_tags_json, status, created_at, updated_at
      ) VALUES (
        'frontend',
        'Frontend Agent',
        'Build React pages',
        '["frontend"]',
        'PUBLISHED',
        '2026-11-01T08:00:00.000Z',
        '2026-11-01T08:00:00.000Z'
      );

      INSERT INTO agent_definition_versions (
        id, agent_definition_id, version, spec_json, checksum, status, created_at
      ) VALUES (
        'frontend-1.0.0',
        'frontend',
        1,
        '{"id":"frontend-1.0.0","definitionId":"frontend","version":"1.0.0","role":"frontend","model":"deepseek-flash","prompt":"Build.","promptVersion":"v1","capabilities":{"frontend":1},"toolAllowlist":["fs-read"],"memoryPolicy":{"access":"READ","kinds":["requirement"]},"maxConcurrency":1,"inputSchema":{"id":"in","version":"1.0.0","dialect":"https://json-schema.org/draft/2020-12/schema","schema":{"type":"object"}},"outputSchema":{"id":"out","version":"1.0.0","dialect":"https://json-schema.org/draft/2020-12/schema","schema":{"type":"object"}}}',
        'checksum-frontend',
        'PUBLISHED',
        '2026-11-01T08:00:00.000Z'
      );
    `)
    current.close()

    const legacy = new DatabaseSync(path)
    legacy.exec('PRAGMA foreign_keys = ON')
    downgradeToVersion(legacy, 7)

    const definition = {
      id: 'frontend',
      name: 'Frontend Agent',
      purpose: 'Build React pages',
      discoveryTags: ['frontend'],
      status: 'PUBLISHED',
    }
    const version = {
      id: 'frontend-1.0.0',
      definitionId: 'frontend',
      version: '1.0.0',
      role: 'frontend',
      model: 'deepseek-flash',
      prompt: 'Build.',
      promptVersion: 'v1',
      capabilities: { frontend: 1 },
      toolAllowlist: ['fs-read'],
      memoryPolicy: { access: 'READ', kinds: ['requirement'] },
      maxConcurrency: 1,
      inputSchema: {
        id: 'in',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      },
      outputSchema: {
        id: 'out',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      },
    }
    const legacySpec = {
      id: 'team-version-legacy',
      name: 'Legacy delivery team',
      version: '1.0.0',
      purpose: 'Ship.',
      members: [
        { instanceCount: 2, definition, version },
        { instanceCount: 1, definition, version },
      ],
      requiredCapabilities: { frontend: 1 },
      requiredConcurrency: 2,
      concurrencyCapacity: 2,
      toolPolicy: { allowedTools: ['fs-read'], requiredTools: ['fs-read'] },
      memoryPolicy: {
        allowedAccess: 'READ',
        requiredAccess: 'NONE',
        allowedKinds: ['requirement'],
        requiredKinds: [],
      },
      inputSchema: {
        id: 'in',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      },
      outputSchemas: [{
        id: 'out',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      }],
    }
    legacy.prepare(`
      INSERT INTO agent_team_versions (
        id, name, version, spec_json, checksum, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'team-version-legacy',
      'Legacy delivery team',
      1,
      JSON.stringify(legacySpec),
      'checksum-team-legacy',
      'PUBLISHED',
      '2026-11-01T08:00:00.000Z',
    )
    legacy.prepare(`
      INSERT INTO agent_team_members (
        team_version_id, member_id, agent_definition_version_id, instance_count, position
      ) VALUES (?, ?, ?, ?, ?)
    `).run('team-version-legacy', 'frontend-a', 'frontend-1.0.0', 2, 0)
    legacy.prepare(`
      INSERT INTO agent_team_members (
        team_version_id, member_id, agent_definition_version_id, instance_count, position
      ) VALUES (?, ?, ?, ?, ?)
    `).run('team-version-legacy', 'frontend-b', 'frontend-1.0.0', 1, 1)
    legacy.close()

    const migrated = openOrchestrationDatabase(path, 'delete')
    try {
      expect(migrated.prepare('SELECT team_id FROM agent_team_versions WHERE id = ?')
        .get('team-version-legacy')).toEqual({ team_id: 'legacy-team:team-version-legacy' })
      expect(migrated.prepare(`
        SELECT member_id, display_name, department_key, position
        FROM agent_team_members
        WHERE team_version_id = ?
        ORDER BY department_key, position
      `).all('team-version-legacy')).toEqual([
        {
          member_id: 'frontend-1.0.0:instance-1',
          display_name: 'Frontend Agent 1',
          department_key: 'frontend-a',
          position: 1,
        },
        {
          member_id: 'frontend-1.0.0:instance-3',
          display_name: 'Frontend Agent',
          department_key: 'frontend-a',
          position: 2,
        },
        {
          member_id: 'frontend-1.0.0:instance-2',
          display_name: 'Frontend Agent 2',
          department_key: 'frontend-b',
          position: 1,
        },
      ])
    } finally {
      migrated.close()
    }
  })

  it('groups same-name legacy versions under one logical team', () => {
    const root = mkdtempSync(join(tmpdir(), 'future-cup-schema-v7-group-'))
    temporaryRoots.push(root)
    const path = join(root, 'orchestration.sqlite')

    const current = openOrchestrationDatabase(path, 'delete')
    current.exec(`
      INSERT INTO agent_definitions (
        id, name, purpose, discovery_tags_json, status, created_at, updated_at
      ) VALUES (
        'frontend',
        'Frontend Agent',
        'Build React pages',
        '["frontend"]',
        'PUBLISHED',
        '2026-11-01T08:00:00.000Z',
        '2026-11-01T08:00:00.000Z'
      );

      INSERT INTO agent_definition_versions (
        id, agent_definition_id, version, spec_json, checksum, status, created_at
      ) VALUES (
        'frontend-1.0.0',
        'frontend',
        1,
        '{"model":"deepseek-flash"}',
        'checksum-frontend',
        'PUBLISHED',
        '2026-11-01T08:00:00.000Z'
      );
    `)
    current.close()

    const legacy = new DatabaseSync(path)
    legacy.exec('PRAGMA foreign_keys = ON')
    downgradeToVersion(legacy, 7)

    const definition = {
      id: 'frontend',
      name: 'Frontend Agent',
      purpose: 'Build React pages',
      discoveryTags: ['frontend'],
      status: 'PUBLISHED',
    }
    const version = {
      id: 'frontend-1.0.0',
      definitionId: 'frontend',
      version: '1.0.0',
      role: 'frontend',
      model: 'deepseek-flash',
      prompt: 'Build.',
      promptVersion: 'v1',
      capabilities: { frontend: 1 },
      toolAllowlist: ['fs-read'],
      memoryPolicy: { access: 'READ', kinds: ['requirement'] },
      maxConcurrency: 1,
      inputSchema: {
        id: 'in',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      },
      outputSchema: {
        id: 'out',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      },
    }
    const legacySpec = (id: string, semanticVersion: string) => ({
      id,
      name: 'Legacy delivery team',
      version: semanticVersion,
      purpose: 'Ship.',
      members: [{ instanceCount: 1, definition, version }],
      requiredCapabilities: { frontend: 1 },
      requiredConcurrency: 1,
      concurrencyCapacity: 1,
      toolPolicy: { allowedTools: ['fs-read'], requiredTools: ['fs-read'] },
      memoryPolicy: {
        allowedAccess: 'READ',
        requiredAccess: 'NONE',
        allowedKinds: ['requirement'],
        requiredKinds: [],
      },
      inputSchema: {
        id: 'in',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      },
      outputSchemas: [{
        id: 'out',
        version: '1.0.0',
        dialect: 'https://json-schema.org/draft/2020-12/schema',
        schema: { type: 'object' },
      }],
    })
    const insertVersion = legacy.prepare(`
      INSERT INTO agent_team_versions (
        id, name, version, spec_json, checksum, status, created_at, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insertVersion.run(
      'team-version-legacy-1.0.0',
      'Legacy delivery team',
      1,
      JSON.stringify(legacySpec('team-version-legacy-1.0.0', '1.0.0')),
      'checksum-1',
      'PUBLISHED',
      '2026-11-01T08:00:00.000Z',
      '2026-11-01T08:00:00.000Z',
    )
    insertVersion.run(
      'team-version-legacy-1.1.0',
      'Legacy delivery team',
      2,
      JSON.stringify(legacySpec('team-version-legacy-1.1.0', '1.1.0')),
      'checksum-2',
      'PUBLISHED',
      '2026-11-01T09:00:00.000Z',
      '2026-11-01T09:00:00.000Z',
    )
    legacy.close()

    const migrated = openOrchestrationDatabase(path, 'delete')
    try {
      expect(migrated.prepare(`
        SELECT id, name
        FROM agent_teams
        WHERE owner_id = 'legacy'
      `).all()).toEqual([{
        id: 'legacy-team:team-version-legacy-1.0.0',
        name: 'Legacy delivery team',
      }])
      expect(migrated.prepare(`
        SELECT id, team_id, version
        FROM agent_team_versions
        ORDER BY version
      `).all()).toEqual([
        {
          id: 'team-version-legacy-1.0.0',
          team_id: 'legacy-team:team-version-legacy-1.0.0',
          version: 1,
        },
        {
          id: 'team-version-legacy-1.1.0',
          team_id: 'legacy-team:team-version-legacy-1.0.0',
          version: 2,
        },
      ])
    } finally {
      migrated.close()
    }
  })
})
