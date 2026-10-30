import { describe, expect, it } from 'vitest'
import { AgentId, ProjectId, TaskId } from '../src/brand.ts'
import { DagEngine, DagError } from '../src/dag-engine.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import type { TaskDefinition } from '../src/types.ts'

const NOW = () => new Date('2026-10-30T12:00:00.000Z')

function task(
  id: string,
  role: TaskDefinition['role'],
  dependencies: string[] = [],
  priority = 50,
): TaskDefinition {
  return {
    id: TaskId(id),
    title: id,
    description: `${id} description`,
    role,
    priority,
    dependencies: dependencies.map(TaskId),
    requiredCapabilities: role === 'frontend' ? { frontend: 0.6 } : {},
    writeScopes: [],
  }
}

function createProject(repository: OrchestrationRepository, tasks: readonly TaskDefinition[]): DagEngine {
  return DagEngine.create(
    repository,
    { id: ProjectId('project-m2'), name: 'M2', requirement: 'Build a dashboard' },
    tasks,
    { now: NOW },
  )
}

describe('DagEngine', () => {
  it('rejects cycles before writing any project state', () => {
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    try {
      expect(() => createProject(repository, [
        task('dashboard', 'frontend', ['integration']),
        task('integration', 'integration', ['dashboard']),
      ])).toThrow(expect.objectContaining<Partial<DagError>>({ code: 'CYCLE' }))
    } finally {
      repository.close()
    }
  })

  it('unlocks parallel frontend tasks only after design completes', () => {
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    try {
      const dag = createProject(repository, [
        task('design', 'ui-designer'),
        task('dashboard', 'frontend', ['design']),
        task('users', 'frontend', ['design']),
        task('integration', 'integration', ['dashboard', 'users']),
      ])
      expect(dag.readyTasks().map(value => value.id)).toEqual(['design'])

      dag.startTask(TaskId('design'), AgentId('ui-designer'))
      dag.completeTask(TaskId('design'), { ok: true })

      expect(dag.readyTasks().map(value => value.id)).toEqual(['dashboard', 'users'])
      expect(dag.getTask(TaskId('integration')).status).toBe('PENDING')
    } finally {
      repository.close()
    }
  })

  it('blocks every unfinished descendant after a prerequisite fails', () => {
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    try {
      const dag = createProject(repository, [
        task('design', 'ui-designer'),
        task('dashboard', 'frontend', ['design']),
        task('users', 'frontend', ['design']),
        task('integration', 'integration', ['dashboard', 'users']),
      ])
      dag.startTask(TaskId('design'), AgentId('ui-designer'))
      dag.completeTask(TaskId('design'), { ok: true })
      dag.startTask(TaskId('dashboard'), AgentId('frontend-a'))
      dag.startTask(TaskId('users'), AgentId('frontend-b'))
      dag.failTask(TaskId('dashboard'), {
        code: 'BUILD_FAILED',
        message: 'dashboard did not compile',
        retryable: true,
      })

      expect(dag.getTask(TaskId('dashboard')).status).toBe('FAILED')
      expect(dag.getTask(TaskId('integration')).status).toBe('BLOCKED')
      expect(dag.getTask(TaskId('users')).status).toBe('RUNNING')
    } finally {
      repository.close()
    }
  })

  it('requeues a failed task, excludes its previous Agent, and later unblocks descendants', () => {
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    try {
      const dag = createProject(repository, [
        task('dashboard', 'frontend'),
        task('integration', 'integration', ['dashboard']),
      ])
      dag.startTask(TaskId('dashboard'), AgentId('frontend-a'))
      dag.failTask(TaskId('dashboard'), {
        code: 'BUILD_FAILED',
        message: 'failed once',
        retryable: true,
      })
      expect(dag.getTask(TaskId('integration')).status).toBe('BLOCKED')

      const requeued = dag.requeueTask(TaskId('dashboard'), 'retry with another Agent')
      expect(requeued.status).toBe('READY')
      expect(requeued.retryCount).toBe(1)
      expect(requeued.excludedAgentIds).toEqual([AgentId('frontend-a')])

      dag.startTask(TaskId('dashboard'), AgentId('frontend-b'))
      dag.completeTask(TaskId('dashboard'), { ok: true })
      expect(dag.getTask(TaskId('integration')).status).toBe('READY')
    } finally {
      repository.close()
    }
  })

  it('allows the sole role instance to retry without a false unassignable state', () => {
    const repository = new OrchestrationRepository(':memory:', { now: NOW })
    try {
      const dag = createProject(repository, [task('design', 'ui-designer')])
      dag.startTask(TaskId('design'), AgentId('ui-designer'))
      dag.failTask(TaskId('design'), {
        code: 'MAX_TOKENS',
        message: 'the only designer produced no output',
        retryable: true,
      })
      const retried = dag.requeueTask(
        TaskId('design'),
        'retry the sole designer with a larger output bound',
        { excludePreviousAgent: false },
      )
      expect(retried.status).toBe('READY')
      expect(retried.excludedAgentIds).toEqual([])
    } finally {
      repository.close()
    }
  })
})
