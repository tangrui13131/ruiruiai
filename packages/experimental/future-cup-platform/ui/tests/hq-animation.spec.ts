import { describe, expect, it } from 'vitest'
import type { ProductEventView } from '../src/api/contracts.ts'
import {
  animationActionsForEvent,
  animationActionsForTransition,
} from '../src/hq/animation.ts'
import type { HqAgentProjection, HqProjection, HqTaskProjection } from '../src/hq/projection.ts'

function agent(id: string, department: string): HqAgentProjection {
  return {
    id,
    name: id,
    role: id,
    department,
    capabilities: {},
    maxConcurrency: 1,
    currentLoad: 0,
    historicalSuccessRate: 1,
    configuredAvailable: true,
    available: true,
    status: 'IDLE',
  }
}

function task(id: string, status: HqTaskProjection['status'], assignedAgentId: string): HqTaskProjection {
  return {
    id,
    title: id,
    role: 'frontend',
    status,
    priority: 80,
    assignedAgentId,
    updatedAt: '2026-11-01T10:00:00.000Z',
  }
}

function projection(runStatus: HqProjection['runStatus'] = 'RUNNING'): HqProjection {
  return {
    projectId: 'project-hq',
    projectName: 'HQ',
    requirement: 'Build',
    lastEventSeq: 3,
    runStatus,
    workflowStatus: 'RUNNING',
    tasks: [task('frontend-a', 'RUNNING', 'frontend-a')],
    agents: [
      agent('planner', 'planning'),
      agent('frontend-a', 'frontend-a'),
      agent('tester', 'verification'),
      agent('repair', 'repair'),
    ],
    departments: [],
    verification: { status: 'PENDING', findings: 0 },
    repairs: [],
    events: [],
    updatedAt: '2026-11-01T10:00:00.000Z',
  }
}

describe('HQ realtime animation mapping', () => {
  it('routes a dispatched task from planning to its assigned Agent department', () => {
    const actions = animationActionsForEvent({
      type: 'task.dispatched',
      projectId: 'project-hq',
      seq: 4,
      occurredAt: '2026-11-01T10:00:04.000Z',
      taskId: 'frontend-a',
      agentId: 'frontend-a',
      payload: {},
    }, projection())

    expect(actions).toEqual([expect.objectContaining({
      kind: 'flow',
      fromDepartment: 'planning',
      toDepartment: 'frontend-a',
      tone: 'active',
    })])
  })

  it('maps tools, verification, and repair events to distinct scene actions', () => {
    const source = projection()
    const tool = {
      type: 'agent.tool.called',
      projectId: 'project-hq',
      seq: 4,
      occurredAt: '2026-11-01T10:00:04.000Z',
      taskId: 'frontend-a',
      agentId: 'frontend-a',
      payload: {},
    } satisfies ProductEventView
    const verification = {
      type: 'verification.failed',
      projectId: 'project-hq',
      seq: 5,
      occurredAt: '2026-11-01T10:00:05.000Z',
      payload: {},
    } satisfies ProductEventView
    const repair = {
      type: 'repair.started',
      projectId: 'project-hq',
      seq: 6,
      occurredAt: '2026-11-01T10:00:06.000Z',
      agentId: 'repair',
      payload: {},
    } satisfies ProductEventView

    expect(animationActionsForEvent(tool, source)[0]).toMatchObject({
      kind: 'agent',
      agentId: 'frontend-a',
      tone: 'info',
    })
    expect(animationActionsForEvent(verification, source)[0]).toMatchObject({
      kind: 'department',
      department: 'verification',
      tone: 'error',
    })
    expect(animationActionsForEvent(repair, source)).toMatchObject([
      { kind: 'flow', fromDepartment: 'verification', toDepartment: 'repair' },
      { kind: 'department', department: 'repair', tone: 'active' },
    ])
  })

  it('keeps ESCALATED terminal events visible as a warning', () => {
    const actions = animationActionsForEvent({
      type: 'run.completed',
      projectId: 'project-hq',
      seq: 7,
      occurredAt: '2026-11-01T10:00:07.000Z',
      payload: { status: 'ESCALATED' },
    }, projection('ESCALATED'))

    expect(actions).toEqual([expect.objectContaining({
      kind: 'terminal',
      tone: 'warning',
      label: '项目运行结束 · 已升级',
    })])
  })

  it('does not animate a duplicated projection transition', () => {
    const source = projection()
    const event = {
      type: 'verification.passed',
      projectId: 'project-hq',
      seq: 4,
      occurredAt: '2026-11-01T10:00:04.000Z',
      payload: {},
    } satisfies ProductEventView

    expect(animationActionsForTransition(source, source, event)).toEqual([])
  })
})
