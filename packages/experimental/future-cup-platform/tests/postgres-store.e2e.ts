import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  AgentId,
  DagEngine,
  DEFAULT_AGENT_TEAM_ID,
  PersistentAgentRegistry,
  ProjectId,
  TaskId,
  taskDefinition,
  WorkflowControlCoordinator,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type { LeaseAcquisition } from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import { PostgresPlatformStore } from '../src/postgres-store.ts'

const databaseUrl = process.env.FUTURE_CUP_POSTGRES_URL

function spawnContender(resourceId: string, projectId: string, ownerId: string): Promise<LeaseAcquisition> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--import',
      'tsx',
      'tests/fixtures/postgres-lease-contender.ts',
      resourceId,
      projectId,
      ownerId,
    ], {
      cwd: import.meta.dirname + '/..',
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`lease contender exited ${String(code)}: ${stderr}`))
        return
      }
      const parsed = JSON.parse(stdout.trim()) as {
        acquired: boolean
        ownerId?: string
        fencingToken?: string
        expiresAt?: string
      }
      resolve({
        acquired: parsed.acquired,
        ownerId: parsed.ownerId,
        fencingToken: parsed.fencingToken === undefined ? undefined : BigInt(parsed.fencingToken),
        expiresAt: parsed.expiresAt,
      })
    })
  })
}

async function waitForExpiry(
  store: PostgresPlatformStore,
  resourceId: string,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const lease = await store.getWorkflowLease(resourceId)
    if (lease !== undefined && Date.parse(lease.expiresAt) <= Date.now()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('workflow lease did not expire before the test deadline')
}

describe.skipIf(databaseUrl === undefined || databaseUrl === '')('PostgreSQL platform store', () => {
  it('persists Agent Registry, frozen teams, memory, and workflow control', {
    timeout: 30_000,
  }, async () => {
    if (databaseUrl === undefined) throw new Error('FUTURE_CUP_POSTGRES_URL is required')
    const store = new PostgresPlatformStore(databaseUrl)
    const projectId = ProjectId(`project-pg-m5-${randomUUID()}`)
    try {
      const registry = new PersistentAgentRegistry(store)
      expect(await registry.ensureDefaultTeam()).toBe(DEFAULT_AGENT_TEAM_ID)
      const binding = await registry.freezeProject(projectId, DEFAULT_AGENT_TEAM_ID)
      const createdAt = new Date().toISOString()
      await store.createProject({
        id: projectId,
        name: 'Postgres M5',
        requirement: 'Persist the frozen team and workflow control',
        createdAt,
      }, [], undefined, binding, [{
        id: `memory-${projectId}`,
        projectId,
        kind: 'requirement',
        key: 'initial-requirement',
        value: { requirement: 'Persist the frozen team and workflow control' },
        source: 'postgres-e2e',
        createdAt,
      }])

      expect((await store.getProjectTeamBinding(projectId))?.teamVersion.id)
        .toBe(DEFAULT_AGENT_TEAM_ID)
      expect(await store.listProjectMemoryEntries(projectId)).toHaveLength(1)

      const control = new WorkflowControlCoordinator(store)
      let snapshot = await control.start(projectId)
      snapshot = await control.advance(projectId, {
        type: 'VERIFICATION_COMPLETED',
        instanceId: snapshot.activeNodes[0]!.instanceId,
        status: 'PASS',
      })
      snapshot = await control.advance(projectId, {
        type: 'TASK_COMPLETED',
        instanceId: snapshot.activeNodes[0]!.instanceId,
      })
      expect(snapshot.status).toBe('PASSED')
      expect((await store.getWorkflowControlState(projectId))?.snapshot.status).toBe('PASSED')
      expect((await store.listWorkflowControlEvents(projectId)).length).toBeGreaterThan(0)
    } finally {
      await store.close()
    }
  })

  it('persists events, Outbox, reconnect cursors, and cross-process fencing', {
    timeout: 30_000,
  }, async () => {
    if (databaseUrl === undefined) throw new Error('FUTURE_CUP_POSTGRES_URL is required')
    const store = new PostgresPlatformStore(databaseUrl)
    const projectId = ProjectId(`project-pg-${randomUUID()}`)
    const resourceId = `workflow:${projectId}`
    try {
      await store.createProject({
        id: projectId,
        name: 'Postgres platform',
        requirement: 'Validate the production store',
        createdAt: new Date().toISOString(),
      }, [])
      const dag = await DagEngine.create(store, {
        id: projectId,
        name: 'Postgres platform',
        requirement: 'Validate the production store',
      }, [
        taskDefinition({
          id: 'design',
          title: 'Design',
          description: 'Create the design system',
          role: 'ui-designer',
          priority: 50,
          dependencies: [],
          requiredCapabilities: { design: 1 },
          writeScopes: ['src/'],
        }),
      ])
      await dag.startTask(TaskId('design'), AgentId('ui-designer'))
      await dag.completeTask(TaskId('design'), { status: 'COMPLETE' })
      await store.saveSchedulerDecision({
        id: `decision-${randomUUID()}`,
        projectId,
        taskId: TaskId('design'),
        selectedAgentId: AgentId('ui-designer'),
        candidates: [{
          agentId: AgentId('ui-designer'),
          eligible: true,
          loadRatio: 0,
          score: 1,
          terms: {
            capabilityMatch: 1,
            capabilityContribution: 0.4,
            successContribution: 0.2,
            availabilityContribution: 0.2,
            priorityContribution: 0.2,
            loadPenaltyContribution: 0,
          },
        }],
        selectedReason: 'only eligible designer',
        createdAt: new Date().toISOString(),
      })
      const executionId = await store.startExecution(
        projectId,
        TaskId('design'),
        AgentId('ui-designer'),
      )
      await store.appendExecutionEvent(executionId, 'agent/started', { attempt: 1 })
      await store.finishExecution(executionId, 'COMPLETED', 'session-postgres')
      const verification = await store.saveVerificationReport(
        projectId,
        'PASS',
        { status: 'PASS' },
        TaskId('design'),
      )
      await store.saveRepairRecord(projectId, {
        repairRound: 1,
        verificationReportId: verification.id,
        repairAgentId: AgentId('repair'),
        failureSignature: 'signature',
        errorSummary: 'none',
        changeSummary: 'none',
        diff: '',
        beforeStatus: 'FAIL',
        afterStatus: 'PASS',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })
      await store.startWorkflowRun(projectId)
      await store.updateWorkflowRun(projectId, 'PASSED', 1)
      const [first, second] = await Promise.all([
        store.appendProductEvent({
          projectId,
          type: 'task.created',
          taskId: 'task-1',
          payload: { sequence: 1 },
        }),
        store.appendProductEvent({
          projectId,
          type: 'task.planned',
          taskId: 'task-1',
          payload: { sequence: 2 },
        }),
      ])
      expect(second.seq).toBe(first.seq + 1)

      const snapshot = await store.getProjectSnapshot(projectId, first.seq, 20)
      expect(snapshot?.lastEventSeq).toBe(second.seq)
      expect(snapshot?.events.map(event => event.seq)).toEqual([second.seq])
      expect(snapshot?.tasks).toEqual([expect.objectContaining({ id: 'design', status: 'COMPLETED' })])
      expect(snapshot?.decisions).toHaveLength(1)
      expect(snapshot?.executions).toEqual([
        expect.objectContaining({ id: executionId, sessionId: 'session-postgres' }),
      ])
      expect(await store.listExecutionEvents(executionId)).toEqual([
        expect.objectContaining({ executionId, eventType: 'agent/started' }),
      ])
      expect(snapshot?.verificationReports).toHaveLength(1)
      expect(snapshot?.repairs).toHaveLength(1)
      expect(snapshot?.workflow).toMatchObject({ status: 'PASSED', repairRound: 1 })

      const run = await store.createProjectRun(
        projectId,
        'worker-a',
        1n,
        'D:/future-cup/runs/run-a/workspace',
      )
      await expect(store.createProjectRun(
        projectId,
        'worker-b',
        2n,
        'D:/future-cup/runs/run-b/workspace',
      )).rejects.toThrow()
      const finishedRun = await store.finishProjectRun(
        run.id,
        'PASSED',
        'D:/future-cup/runs/run-a/workspace/dist',
      )
      expect(finishedRun).toMatchObject({
        status: 'PASSED',
        previewPath: 'D:/future-cup/runs/run-a/workspace/dist',
      })
      expect((await store.getProjectSnapshot(projectId, 0, 1))?.runs)
        .toEqual([expect.objectContaining({ id: run.id, status: 'PASSED' })])

      const owner = 'postgres-test-a'
      const outbox = await store.claimOutbox(owner, 100, 1_000)
      await store.markOutboxPublished(owner, outbox.map(item => item.eventId))
      expect((await store.listProductEvents(projectId, 0, 500)).length).toBeGreaterThan(2)

      const firstLease = await store.acquireWorkflowLease(resourceId, projectId, 'worker-a', 2_000)
      expect(firstLease).toMatchObject({ acquired: true, ownerId: 'worker-a', fencingToken: 1n })
      const staleRun = await store.createProjectRun(
        projectId,
        'worker-a',
        1n,
        'D:/future-cup/runs/stale/workspace',
        { resourceId, ownerId: 'worker-a', fencingToken: 1n },
      )
      expect(await store.acquireWorkflowLease(resourceId, projectId, 'worker-b', 2_000))
        .toMatchObject({ acquired: false, ownerId: 'worker-a' })
      await waitForExpiry(store, resourceId)
      const contenders = await Promise.all([
        spawnContender(resourceId, projectId, 'worker-b'),
        spawnContender(resourceId, projectId, 'worker-c'),
      ])
      expect(contenders.filter(value => value.acquired)).toHaveLength(1)
      const lease = await store.getWorkflowLease(resourceId)
      expect(lease?.fencingToken).toBe(2n)
      expect(lease?.ownerId).toBe(contenders.find(value => value.acquired)?.ownerId)
      await expect(store.finishProjectRun(
        staleRun.id,
        'FAILED',
        undefined,
        { code: 'STALE_WRITER', message: 'stale writer', retryable: false },
        { resourceId, ownerId: 'worker-a', fencingToken: 1n },
      )).rejects.toMatchObject({ code: 'WORKFLOW_FENCE_LOST' })
      expect(await store.finishProjectRun(
        staleRun.id,
        'FAILED',
        undefined,
        { code: 'PROJECT_RUN_INTERRUPTED', message: 'interrupted', retryable: true },
        {
          resourceId,
          ownerId: lease?.ownerId ?? '',
          fencingToken: lease?.fencingToken ?? 0n,
        },
      )).toMatchObject({ status: 'FAILED' })
      expect(await store.releaseWorkflowLease(resourceId, lease?.ownerId ?? '', lease?.fencingToken ?? 0n))
        .toBe(true)
    } finally {
      await store.close()
    }
  })
})
