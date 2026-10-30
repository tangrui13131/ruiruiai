import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
})
