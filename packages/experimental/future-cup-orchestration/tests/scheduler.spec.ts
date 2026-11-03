import { describe, expect, it } from 'vitest'
import { AgentId, ProjectId, TaskId } from '../src/brand.ts'
import { ExplainableScheduler, DEFAULT_SCHEDULER_WEIGHTS } from '../src/scheduler.ts'
import type { AgentProfile, TaskSnapshot } from '../src/types.ts'

const NOW = () => new Date('2026-10-30T12:00:00.000Z')
const PROJECT = ProjectId('project-m2')

function task(id: string, load = 0): TaskSnapshot {
  return {
    id: TaskId(id),
    projectId: PROJECT,
    title: id,
    description: id,
    role: 'frontend',
    priority: 80,
    dependencies: [],
    requiredCapabilities: { frontend: 0.8 },
    writeScopes: [],
    status: 'READY',
    revision: 2,
    retryCount: load,
    excludedAgentIds: [],
    createdAt: '2026-10-30T11:00:00.000Z',
    updatedAt: '2026-10-30T11:00:00.000Z',
  }
}

function frontend(id: string, currentLoad = 0, success = 0.8): AgentProfile {
  return {
    id: AgentId(id),
    name: id,
    role: 'frontend',
    capabilities: { frontend: 1 },
    maxConcurrency: 1,
    currentLoad,
    historicalSuccessRate: success,
    available: true,
  }
}

describe('ExplainableScheduler', () => {
  it('records every weighted score term and selects the highest eligible score', () => {
    const scheduler = new ExplainableScheduler(DEFAULT_SCHEDULER_WEIGHTS, {
      now: NOW,
      createDecisionId: () => 'decision-1',
    })
    const assignments = scheduler.schedule(PROJECT, [task('dashboard')], [
      frontend('frontend-weak', 0, 0.2),
      frontend('frontend-strong', 0, 0.9),
    ])

    expect(assignments[0]?.agent.id).toBe(AgentId('frontend-strong'))
    const decision = assignments[0]!.decision
    expect(decision.candidates.map(candidate => candidate.agentId)).toEqual([
      AgentId('frontend-strong'),
      AgentId('frontend-weak'),
    ])
    expect(decision.candidates[0]?.terms).toMatchObject({
      capabilityMatch: 1,
      capabilityContribution: 0.5,
      availabilityContribution: 0.15,
      priorityContribution: 0.12,
      loadPenaltyContribution: -0,
    })
    expect(decision.candidates[0]?.terms.successContribution).toBeCloseTo(0.18)
  })

  it('splits parallel frontend tasks across two instances by updating load after each assignment', () => {
    const scheduler = new ExplainableScheduler(DEFAULT_SCHEDULER_WEIGHTS, {
      now: NOW,
      createDecisionId: () => 'decision-load',
    })
    const assignments = scheduler.schedule(PROJECT, [
      task('dashboard'),
      task('users'),
    ], [
      frontend('frontend-a'),
      frontend('frontend-b'),
    ])

    expect(assignments.map(assignment => assignment.agent.id)).toEqual([
      AgentId('frontend-a'),
      AgentId('frontend-b'),
    ])
    expect(assignments[1]?.decision.candidates[0]?.loadRatio).toBe(0)
    expect(assignments[1]?.decision.candidates[1]?.loadRatio).toBe(1)
  })

  it('defers a capacity-limited task to the next scheduling round', () => {
    const scheduler = new ExplainableScheduler(DEFAULT_SCHEDULER_WEIGHTS, {
      now: NOW,
      createDecisionId: () => 'decision-capacity',
    })
    const assignments = scheduler.schedule(PROJECT, [
      task('dashboard'),
      task('users'),
    ], [
      frontend('frontend-a'),
    ])

    expect(assignments).toHaveLength(1)
    expect(assignments[0]?.task.id).toBe(TaskId('dashboard'))
    expect(assignments[0]?.agent.id).toBe(AgentId('frontend-a'))
  })

  it('reassigns a failed task while excluding the failed Agent', () => {
    const scheduler = new ExplainableScheduler(DEFAULT_SCHEDULER_WEIGHTS, {
      now: NOW,
      createDecisionId: () => 'decision-retry',
    })
    const retryTask: TaskSnapshot = {
      ...task('dashboard'),
      revision: 5,
      retryCount: 1,
      assignedAgentId: undefined,
      excludedAgentIds: [AgentId('frontend-a')],
      failure: { code: 'BUILD_FAILED', message: 'failed', retryable: true },
    }
    const [assignment] = scheduler.schedule(PROJECT, [retryTask], [
      frontend('frontend-a', 0, 1),
      frontend('frontend-b', 0, 0.5),
    ])

    expect(assignment?.agent.id).toBe(AgentId('frontend-b'))
    expect(assignment?.decision.candidates.find(candidate =>
      candidate.agentId === AgentId('frontend-a'),
    )?.rejectionReason).toContain('excluded')
    expect(assignment?.decision.reassignReason).toContain('BUILD_FAILED')
  })
})
