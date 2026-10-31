import { describe, expect, it } from 'vitest'
import { AgentId, ProjectId, TaskId } from '../src/brand.ts'
import { DagEngine, taskDefinition } from '../src/dag-engine.ts'
import { OrchestrationRepository } from '../src/repository.ts'
import { WorkflowFenceError } from '../src/platform-store.ts'

const projectId = ProjectId('project-platform-store')

describe('SQLite platform store', () => {
  it('persists ordered product events, Outbox rows, and reconnect snapshots', () => {
    let nowMs = Date.parse('2026-10-31T08:00:00.000Z')
    const repository = new OrchestrationRepository(':memory:', {
      now: () => new Date(nowMs),
      createId: (() => {
        let serial = 0
        return () => String(++serial)
      })(),
      journalMode: 'delete',
    })
    try {
      repository.createProject({
        id: projectId,
        name: 'Platform',
        requirement: 'Show realtime state',
        createdAt: new Date(nowMs).toISOString(),
      }, [])
      const first = repository.appendProductEvent({
        projectId,
        type: 'task.created',
        taskId: 'task-1',
        payload: { title: 'Planner' },
      })
      nowMs += 1_000
      const second = repository.appendProductEvent({
        projectId,
        type: 'task.planned',
        taskId: 'task-1',
        payload: { revision: 1 },
      })
      expect([first.seq, second.seq]).toEqual([1, 2])
      expect(repository.listProjects()).toHaveLength(1)
      expect(repository.listProjects()[0]?.lastEventSeq).toBe(2)

      const snapshot = repository.getProjectSnapshot(projectId, 1, 10)
      expect(snapshot?.lastEventSeq).toBe(2)
      expect(snapshot?.events.map(event => event.seq)).toEqual([2])

      const outbox = repository.claimOutbox('dispatcher-a', 10, 1_000)
      expect(outbox.map(item => item.event.seq)).toEqual([1, 2])
      expect(outbox.every(item => item.claimToken.length > 0)).toBe(true)
      repository.markOutboxPublished('dispatcher-a', [outbox[0]!.eventId])
      expect(repository.claimOutbox('dispatcher-b', 10, 1_000)).toEqual([])
      nowMs += 2_000
      expect(repository.claimOutbox('dispatcher-b', 10, 1_000).map(item => item.event.seq))
        .toEqual([2])
    } finally {
      repository.close()
    }
  })

  it('enforces lease ownership, heartbeat, release, expiry, and fencing', () => {
    let nowMs = Date.parse('2026-10-31T08:00:00.000Z')
    const repository = new OrchestrationRepository(':memory:', {
      now: () => new Date(nowMs),
      journalMode: 'delete',
    })
    try {
      repository.createProject({
        id: projectId,
        name: 'Lease',
        requirement: 'Own one workflow',
        createdAt: new Date(nowMs).toISOString(),
      }, [])
      const first = repository.acquireWorkflowLease('workflow', projectId, 'worker-a', 1_000)
      expect(first).toMatchObject({ acquired: true, ownerId: 'worker-a', fencingToken: 1n })
      expect(repository.acquireWorkflowLease('workflow', projectId, 'worker-b', 1_000))
        .toMatchObject({ acquired: false, ownerId: 'worker-a' })
      expect(repository.heartbeatWorkflowLease('workflow', 'worker-a', 1n, 1_000)).toBe(true)
      expect(repository.releaseWorkflowLease('workflow', 'worker-a', 2n)).toBe(false)
      expect(repository.releaseWorkflowLease('workflow', 'worker-a', 1n)).toBe(true)

      const second = repository.acquireWorkflowLease('workflow', projectId, 'worker-b', 1_000)
      expect(second).toMatchObject({ acquired: true, ownerId: 'worker-b', fencingToken: 2n })
      nowMs += 2_000
      const third = repository.acquireWorkflowLease('workflow', projectId, 'worker-c', 5_000)
      expect(third).toMatchObject({ acquired: true, ownerId: 'worker-c', fencingToken: 3n })
      expect(repository.heartbeatWorkflowLease('workflow', 'worker-b', 2n, 5_000)).toBe(false)
      expect(repository.heartbeatWorkflowLease('workflow', 'worker-c', 3n, 5_000)).toBe(true)
    } finally {
      repository.close()
    }
  })

  it('rejects a stale task revision instead of overwriting newer DAG state', async () => {
    const repository = new OrchestrationRepository(':memory:', {
      now: () => new Date('2026-10-31T08:00:00.000Z'),
      journalMode: 'delete',
    })
    try {
      await DagEngine.create(repository, {
        id: projectId,
        name: 'Revision guard',
        requirement: 'Reject stale task writes',
      }, [
        taskDefinition({
          id: 'design',
          title: 'Design',
          description: 'Design',
          role: 'ui-designer',
          priority: 50,
          dependencies: [],
          requiredCapabilities: { design: 1 },
          writeScopes: ['src/'],
        }),
      ])
      const current = repository.listTasks(projectId)[0]!
      const next = { ...current, revision: current.revision + 1 }
      repository.saveTask(next, 'task/ready', 'first writer')
      expect(() => {
        repository.saveTask(next, 'task/ready', 'stale writer')
      })
        .toThrow(/stale task/)
      expect(repository.listTasks(projectId)[0]?.id).toBe(TaskId('design'))
    } finally {
      repository.close()
    }
  })

  it('persists one active project run, emits run events, and exposes the latest status', () => {
    const repository = new OrchestrationRepository(':memory:', {
      now: () => new Date('2026-10-31T08:00:00.000Z'),
      journalMode: 'delete',
    })
    try {
      repository.createProject({
        id: projectId,
        name: 'Run state',
        requirement: 'Track launch attempts',
        createdAt: new Date().toISOString(),
      }, [])
      const run = repository.createProjectRun(
        projectId,
        'worker-a',
        1n,
        'D:/runs/run-a/workspace',
      )
      expect(repository.listProjects()[0]).toMatchObject({
        latestRunId: run.id,
        latestRunStatus: 'RUNNING',
        lastEventSeq: 1,
      })
      expect(() => repository.createProjectRun(
        projectId,
        'worker-b',
        2n,
        'D:/runs/run-b/workspace',
      )).toThrow()
      const finished = repository.finishProjectRun(run.id, 'PASSED', 'D:/runs/run-a/workspace/dist')
      expect(finished).toMatchObject({
        status: 'PASSED',
        previewPath: 'D:/runs/run-a/workspace/dist',
      })
      expect(repository.listProjects()[0]?.latestRunStatus).toBe('PASSED')
      expect(repository.listProductEvents(projectId, 0, 10).map(event => event.type))
        .toEqual(['run.started', 'run.completed'])
    } finally {
      repository.close()
    }
  })

  it('settles a task revision and its execution in one event-producing operation', async () => {
    const repository = new OrchestrationRepository(':memory:', {
      now: () => new Date('2026-10-31T08:00:00.000Z'),
      journalMode: 'delete',
    })
    try {
      const dag = await DagEngine.create(repository, {
        id: projectId,
        name: 'Atomic settlement',
        requirement: 'Settle task and execution together',
      }, [
        taskDefinition({
          id: 'design',
          title: 'Design',
          description: 'Design',
          role: 'ui-designer',
          priority: 50,
          dependencies: [],
          requiredCapabilities: { design: 1 },
          writeScopes: ['src/'],
        }),
      ])
      await dag.startTask(TaskId('design'), AgentId('ui-designer'))
      const executionId = repository.startExecution(
        projectId,
        TaskId('design'),
        AgentId('ui-designer'),
      )
      await dag.completeTask(TaskId('design'), { ok: true }, {
        executionId,
        sessionId: 'session-atomic',
      })
      expect(repository.listTasks(projectId)[0]?.status).toBe('COMPLETED')
      expect(repository.listExecutions(projectId)[0]).toMatchObject({
        id: executionId,
        status: 'COMPLETED',
        sessionId: 'session-atomic',
      })
      const types = repository.listProductEvents(projectId, 0, 20).map(event => event.type)
      expect(types.filter(type => type === 'task.dispatched')).toHaveLength(1)
      expect(types.filter(type => type === 'agent.started')).toHaveLength(1)
      expect(types.filter(type => type === 'task.completed')).toHaveLength(1)
      expect(types.filter(type => type === 'agent.completed')).toHaveLength(1)
    } finally {
      repository.close()
    }
  })

  it('rejects writes from a stale workflow owner after lease takeover', () => {
    let nowMs = Date.parse('2026-10-31T08:00:00.000Z')
    const repository = new OrchestrationRepository(':memory:', {
      now: () => new Date(nowMs),
      journalMode: 'delete',
    })
    try {
      repository.createProject({
        id: projectId,
        name: 'Fencing',
        requirement: 'Reject stale writers',
        createdAt: new Date(nowMs).toISOString(),
      }, [])
      const resourceId = `workflow:${projectId}`
      const first = repository.acquireWorkflowLease(resourceId, projectId, 'worker-a', 1_000)
      const staleWrite = {
        resourceId,
        ownerId: 'worker-a',
        fencingToken: first.fencingToken!,
      }
      const run = repository.createProjectRun(
        projectId,
        'worker-a',
        first.fencingToken!,
        'D:/runs/stale/workspace',
        staleWrite,
      )
      nowMs += 2_000
      const second = repository.acquireWorkflowLease(resourceId, projectId, 'worker-b', 1_000)
      expect(second).toMatchObject({
        acquired: true,
        ownerId: 'worker-b',
        fencingToken: 2n,
      })
      const eventsBefore = repository.listProductEvents(projectId, 0, 20)
      expect(() => repository.appendProductEvent({
        projectId,
        type: 'agent.progress',
        taskId: 'task-1',
        agentId: 'worker-a',
        payload: { stale: true },
      }, staleWrite)).toThrow(expect.objectContaining({
        code: 'WORKFLOW_FENCE_LOST',
      }))
      expect(repository.listProductEvents(projectId, 0, 20)).toEqual(eventsBefore)
      expect(() => repository.finishProjectRun(
        run.id,
        'PASSED',
        undefined,
        undefined,
        staleWrite,
      )).toThrow(WorkflowFenceError)
      expect(repository.finishProjectRun(
        run.id,
        'PASSED',
        undefined,
        undefined,
        {
          resourceId,
          ownerId: 'worker-b',
          fencingToken: 2n,
        },
      ).status).toBe('PASSED')
    } finally {
      repository.close()
    }
  })
})
