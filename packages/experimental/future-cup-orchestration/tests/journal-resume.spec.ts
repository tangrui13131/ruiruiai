import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { AgentId, ProjectId, TaskId } from '../src/brand.ts'
import { DagEngine, DagError } from '../src/dag-engine.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import type { TaskDefinition } from '../src/types.ts'

const NOW = () => new Date('2026-10-30T12:00:00.000Z')

function task(id: string, dependencies: string[] = []): TaskDefinition {
  return {
    id: TaskId(id),
    title: id,
    description: id,
    role: id === 'design' ? 'ui-designer' : id === 'integration' ? 'integration' : 'frontend',
    priority: 50,
    dependencies: dependencies.map(TaskId),
    requiredCapabilities: { frontend: 0.5 },
    writeScopes: [],
  }
}

describe('DAG journaling and resume', () => {
  it('replays every task revision after reopening the SQLite database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'future-cup-journal-'))
    const path = join(directory, 'orchestration.sqlite')
    const projectId = ProjectId('project-resume')
    try {
      const first = new OrchestrationRepository(path, { now: NOW, journalMode: 'delete' })
      const dag = DagEngine.create(
        first,
        { id: projectId, name: 'Resume', requirement: 'resume project' },
        [
          task('design'),
          task('dashboard', ['design']),
          task('integration', ['dashboard']),
        ],
        { now: NOW },
      )
      dag.startTask(TaskId('design'), AgentId('ui-designer'))
      dag.completeTask(TaskId('design'), { ok: true })
      expect(first.listTaskJournal(projectId).length).toBeGreaterThanOrEqual(5)
      first.close()

      const second = new OrchestrationRepository(path, { now: NOW, journalMode: 'delete' })
      try {
        const resumed = DagEngine.resume(second, projectId, { now: NOW })
        expect(resumed.getTask(TaskId('design')).status).toBe('COMPLETED')
        expect(resumed.getTask(TaskId('dashboard')).status).toBe('READY')
        expect(resumed.getTask(TaskId('integration')).status).toBe('PENDING')
      } finally {
        second.close()
      }
    } finally {
      // The OS temp owner reclaims this unique directory; Windows may retain
      // SQLite handles briefly after close.
    }
  })

  it('rejects current task rows that do not match the Journal replay', () => {
    const directory = mkdtempSync(join(tmpdir(), 'future-cup-journal-corrupt-'))
    const path = join(directory, 'orchestration.sqlite')
    const projectId = ProjectId('project-corrupt')
    try {
      const repository = new OrchestrationRepository(path, { now: NOW, journalMode: 'delete' })
      DagEngine.create(
        repository,
        { id: projectId, name: 'Corrupt', requirement: 'corrupt project' },
        [task('design')],
        { now: NOW },
      )
      repository.close()

      const corrupt = new OrchestrationRepository(path, { now: NOW, journalMode: 'delete' })
      try {
        corrupt.saveTask(
          {
            ...corrupt.listTasks(projectId)[0]!,
            revision: 100,
            status: 'FAILED',
          },
          'task/failed',
          'manual corruption',
        )
        expect(() => DagEngine.resume(corrupt, projectId, { now: NOW }))
          .toThrow(expect.objectContaining<Partial<DagError>>({ code: 'JOURNAL_INCONSISTENT' }))
      } finally {
        corrupt.close()
      }
    } finally {
      // The OS temp owner reclaims this unique directory; Windows may retain
      // SQLite handles briefly after close.
    }
  })

  it('migrates an M2 schema to M3 without dropping verification evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'future-cup-schema-v1-'))
    const path = join(directory, 'orchestration.sqlite')
    const projectId = ProjectId('project-v1')
    const raw = new DatabaseSync(path)
    raw.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        requirement TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE verification_reports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT,
        status TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO projects VALUES ('project-v1', 'V1', 'migrate', '2026-10-30T12:00:00.000Z');
      INSERT INTO verification_reports VALUES (
        'verification-existing',
        'project-v1',
        NULL,
        'PASS',
        '{"status":"PASS"}',
        '2026-10-30T12:00:00.000Z'
      );
    `)
    raw.close()

    const repository = new OrchestrationRepository(path, { now: NOW, journalMode: 'delete' })
    try {
      expect(repository.schemaVersion).toBe(2)
      const migrated = repository.listVerificationReports(projectId)
      expect(migrated).toHaveLength(1)
      expect(migrated[0]?.id).toBe('verification-existing')
      expect(migrated[0]?.failureSignature).toBeUndefined()
      const workflow = repository.startWorkflowRun(projectId)
      expect(workflow.status).toBe('RUNNING')
    } finally {
      repository.close()
    }
  })
})
