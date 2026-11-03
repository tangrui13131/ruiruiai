import { describe, expect, it } from 'vitest'
import type {
  AgentView,
  ProductEventView,
  ProjectSnapshotView,
  TaskView,
  VerificationReportView,
} from '../src/api/contracts.ts'
import {
  applyProductEvent,
  createProjection,
  needsSnapshotResync,
  parseProductEvent,
  parseSnapshot,
} from '../src/hq/projection.ts'

function realAgent(
  id: string,
  role: string,
  currentLoad = 0,
  departmentKey?: AgentView['departmentKey'],
): AgentView {
  return {
    id,
    name: id,
    role,
    capabilities: { [role]: 1 },
    maxConcurrency: 1,
    currentLoad,
    historicalSuccessRate: 0.9,
    historicalSuccessCount: 0,
    historicalExecutionCount: 0,
    available: currentLoad < 1,
    ...departmentKey === undefined ? {} : { departmentKey },
  }
}

function realTask(
  id: string,
  role: string,
  status: TaskView['status'],
  assignedAgentId?: string,
): TaskView {
  return {
    id,
    projectId: 'project-hq',
    title: id,
    description: id,
    role,
    priority: 80,
    dependencies: [],
    requiredCapabilities: { [role]: 1 },
    writeScopes: ['src/'],
    status,
    revision: 2,
    retryCount: 0,
    excludedAgentIds: [],
    ...assignedAgentId === undefined ? {} : { assignedAgentId },
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:01.000Z',
  }
}

function realSnapshot(): ProjectSnapshotView {
  const verification: VerificationReportView = {
    id: 'verification-hq',
    projectId: 'project-hq',
    status: 'FAIL',
    failureSignature: 'failure-hq',
    report: {
      verifier: 'independent',
      status: 'FAIL',
      failureSignature: 'failure-hq',
      checks: [],
      findings: [{
        category: 'browser',
        code: 'BROWSER_ASSERTION_FAILED',
        severity: 'error',
        message: 'Users page is missing',
      }],
      routes: ['/'],
      viewports: ['desktop'],
      screenshots: [],
    },
    createdAt: '2026-11-01T10:00:02.000Z',
  }
  return {
    project: {
      id: 'project-hq',
      name: 'HQ project',
      requirement: 'Build a dashboard',
      createdAt: '2026-11-01T10:00:00.000Z',
      lastEventSeq: 3,
    },
    tasks: [
      realTask('planner', 'planner', 'COMPLETED', 'planner'),
      realTask('design', 'ui-designer', 'RUNNING', 'ui-designer'),
      realTask('frontend-a', 'frontend', 'READY', 'frontend-a'),
      realTask('frontend-b', 'frontend', 'RUNNING', 'frontend-b'),
      realTask('integration', 'integration', 'PENDING'),
    ],
    decisions: [],
    executions: [],
    verificationReports: [verification],
    repairs: [],
    repairStrategies: [],
    workflow: {
      id: 'workflow-hq',
      projectId: 'project-hq',
      status: 'RUNNING',
      repairRound: 0,
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-01T10:00:02.000Z',
    },
    runs: [{
      id: 'run-hq',
      projectId: 'project-hq',
      status: 'RUNNING',
      ownerId: 'owner-hq',
      fencingToken: '1',
      hasWorkspace: true,
      hasPreview: false,
      startedAt: '2026-11-01T10:00:00.000Z',
    }],
    events: [],
    lastEventSeq: 3,
  }
}

describe('HQ realtime projection', () => {
  it.each([1, 5, 7])('keeps the HQ population equal to the frozen roster (%i)', (count) => {
    const departments = [
      'planning',
      'design',
      'frontend-a',
      'frontend-b',
      'integration',
      'verification',
      'repair',
    ] as const
    const agents = Array.from({ length: count }, (_, index) => (
      realAgent(
        `runtime-${String(index + 1)}`,
        index === 0 ? 'planner' : 'frontend',
        0,
        departments[index % departments.length],
      )
    ))

    const projection = createProjection(realSnapshot(), agents)

    expect(projection.agents).toHaveLength(count)
    expect(projection.agents.map(agent => agent.department)).toEqual(
      agents.map(agent => agent.departmentKey),
    )
  })

  it('maps the seven Agent roles, live load, verification, and departments', () => {
    const projection = createProjection(realSnapshot(), [
      realAgent('planner', 'planner'),
      realAgent('ui-designer', 'ui-designer', 1),
      realAgent('frontend-a', 'frontend'),
      realAgent('frontend-b', 'frontend', 1),
      realAgent('integration', 'integration'),
      realAgent('tester', 'tester'),
      realAgent('repair', 'repair'),
    ])

    expect(projection.runStatus).toBe('RUNNING')
    expect(projection.agents).toHaveLength(7)
    expect(projection.agents.find(agent => agent.id === 'frontend-b')).toMatchObject({
      department: 'frontend-b',
      currentLoad: 1,
      status: 'RUNNING',
      activeTaskId: 'frontend-b',
    })
    expect(projection.departments.find(department => department.key === 'design')).toMatchObject({
      status: 'ACTIVE',
      progress: 0,
      activeTaskIds: ['design'],
    })
    expect(projection.verification).toMatchObject({
      status: 'FAIL',
      findings: 1,
      failureSignature: 'failure-hq',
    })
  })

  it('applies ordered events, settles a repair, and deduplicates replay', () => {
    const initial = createProjection(realSnapshot(), [
      realAgent('planner', 'planner'),
      realAgent('ui-designer', 'ui-designer', 1),
      realAgent('frontend-a', 'frontend'),
      realAgent('frontend-b', 'frontend', 1),
      realAgent('integration', 'integration'),
      realAgent('tester', 'tester'),
      realAgent('repair', 'repair'),
    ])
    const event: ProductEventView = {
      type: 'verification.passed',
      projectId: 'project-hq',
      seq: 4,
      occurredAt: '2026-11-01T10:00:04.000Z',
      payload: { verificationReportId: 'verification-pass', status: 'PASS' },
    }
    const applied = applyProductEvent(initial, event)
    expect(applied.lastEventSeq).toBe(4)
    expect(applied.verification.status).toBe('PASS')
    expect(applyProductEvent(applied, event)).toBe(applied)
  })

  it('recomputes Agent load after completion and preserves an escalated run', () => {
    let projection = createProjection(realSnapshot(), [
      realAgent('planner', 'planner'),
      realAgent('ui-designer', 'ui-designer', 1),
      realAgent('frontend-a', 'frontend'),
      realAgent('frontend-b', 'frontend', 1),
      realAgent('integration', 'integration'),
      realAgent('tester', 'tester'),
      realAgent('repair', 'repair'),
    ])
    projection = applyProductEvent(projection, {
      type: 'task.completed',
      projectId: 'project-hq',
      seq: 4,
      occurredAt: '2026-11-01T10:00:04.000Z',
      taskId: 'frontend-b',
      payload: realTask('frontend-b', 'frontend', 'COMPLETED', 'frontend-b'),
    })

    expect(projection.agents.find(agent => agent.id === 'frontend-b')).toMatchObject({
      currentLoad: 0,
      available: true,
      status: 'IDLE',
    })
    expect(projection.agents.find(agent => agent.id === 'frontend-b')?.activeTaskId).toBeUndefined()

    projection = applyProductEvent(projection, {
      type: 'run.completed',
      projectId: 'project-hq',
      seq: 5,
      occurredAt: '2026-11-01T10:00:05.000Z',
      payload: { runId: 'run-hq', status: 'ESCALATED' },
    })
    expect(projection.runStatus).toBe('ESCALATED')
  })

  it('validates snapshots and events at the socket boundary', () => {
    expect(parseSnapshot(realSnapshot())?.project.id).toBe('project-hq')
    expect(parseProductEvent({
      type: 'run.completed',
      projectId: 'project-hq',
      seq: 5,
      occurredAt: '2026-11-01T10:00:05.000Z',
      payload: { status: 'PASSED' },
    })?.type).toBe('run.completed')
    expect(parseProductEvent({
      type: 'unknown.event',
      projectId: 'project-hq',
      seq: 6,
      occurredAt: '2026-11-01T10:00:06.000Z',
      payload: {},
    })).toBeUndefined()
  })

  it('detects a sequence gap across the realtime replay boundary', () => {
    const projection = createProjection(realSnapshot(), [])
    const event: ProductEventView = {
      type: 'verification.passed',
      projectId: 'project-hq',
      seq: 5,
      occurredAt: '2026-11-01T10:00:05.000Z',
      payload: { status: 'PASS' },
    }

    expect(needsSnapshotResync(projection, event)).toBe(true)
    expect(needsSnapshotResync(projection, { ...event, seq: 4 })).toBe(false)
    expect(needsSnapshotResync(projection, { ...event, projectId: 'other-project' })).toBe(false)
  })

  it('keeps the structured task failure when the Agent failure event follows', () => {
    const failed = realTask('frontend-b', 'frontend', 'FAILED', 'frontend-b')
    failed.failure = {
      code: 'FRONTEND_FAILED',
      message: 'Build output was missing',
      retryable: true,
    }
    let projection = createProjection(realSnapshot(), [
      realAgent('frontend-b', 'frontend', 1),
    ])
    projection = applyProductEvent(projection, {
      type: 'task.failed',
      projectId: 'project-hq',
      seq: 4,
      occurredAt: '2026-11-01T10:00:04.000Z',
      taskId: 'frontend-b',
      agentId: 'frontend-b',
      payload: failed,
    })
    projection = applyProductEvent(projection, {
      type: 'agent.failed',
      projectId: 'project-hq',
      seq: 5,
      occurredAt: '2026-11-01T10:00:05.000Z',
      taskId: 'frontend-b',
      agentId: 'frontend-b',
      payload: { executionId: 'execution-frontend-b', status: 'FAILED' },
    })

    expect(projection.tasks.find(task => task.id === 'frontend-b')?.failure).toEqual({
      code: 'FRONTEND_FAILED',
      message: 'Build output was missing',
      retryable: true,
    })
  })
})
