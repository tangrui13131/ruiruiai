import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type {
  AgentView,
  ProductEventView,
  ProjectSnapshotView,
} from '../src/api/contracts.ts'
import {
  animationActionsForEvent,
  animationActionsForTransition,
} from '../src/hq/animation.ts'
import type { HqAnimationAction } from '../src/hq/animation.ts'
import {
  applyProductEvent,
  createProjection,
  parseProductEvent,
} from '../src/hq/projection.ts'
import type { HqProjection } from '../src/hq/projection.ts'

const fixtureSchema = z.object({
  sourceProjectId: z.string().min(1),
  sourceLastEventSeq: z.number().int().positive(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/u),
  events: z.array(z.unknown()),
}).strict()

const fixture = fixtureSchema.parse(JSON.parse(readFileSync(
  resolve(import.meta.dirname, 'fixtures/m42-real-run-events.json'),
  'utf8',
)))

const agents: AgentView[] = [
  agent('planner', 'planner'),
  agent('ui-designer', 'ui-designer'),
  agent('frontend-a', 'frontend'),
  agent('frontend-b', 'frontend'),
  agent('integration', 'integration'),
  agent('tester', 'tester'),
  agent('repair', 'repair'),
]

function agent(id: string, role: string): AgentView {
  return {
    id,
    name: id,
    role,
    capabilities: { [role]: 1 },
    maxConcurrency: 1,
    currentLoad: 0,
    historicalSuccessRate: 0.9,
    available: true,
  }
}

function initialSnapshot(projectId: string): ProjectSnapshotView {
  return {
    project: {
      id: projectId,
      name: 'M4.2 Final Real Run',
      requirement: 'Recorded Future Cup administration dashboard run',
      createdAt: '2026-10-31T15:19:33.941Z',
      lastEventSeq: 0,
    },
    tasks: [],
    decisions: [],
    executions: [],
    verificationReports: [],
    repairs: [],
    repairStrategies: [],
    workflow: {
      id: 'workflow-recorded-run',
      projectId,
      status: 'RUNNING',
      repairRound: 0,
      createdAt: '2026-10-31T15:19:33.941Z',
      updatedAt: '2026-10-31T15:19:33.941Z',
    },
    runs: [],
    events: [],
    lastEventSeq: 0,
  }
}

function actionKind(action: HqAnimationAction): HqAnimationAction['kind'] {
  return action.kind
}

describe('HQ recorded M4.2 real-run replay', () => {
  it('replays all 53 committed events into final state and complete action coverage', () => {
    expect(fixture.sourceHash).toBe('af8a707467d9be90d4ce5b207d452db9243b451c139978b1db3284f60a15bcda')
    expect(fixture.events).toHaveLength(fixture.sourceLastEventSeq)

    let projection: HqProjection = createProjection(initialSnapshot(fixture.sourceProjectId), agents)
    const kinds = new Map<string, number>()

    fixture.events.forEach((raw, index) => {
      const event = parseProductEvent(raw)
      expect(event, `event ${String(index + 1)} must validate`).toBeDefined()
      if (event === undefined) return
      expect(event.seq).toBe(index + 1)

      const next = applyProductEvent(projection, event)
      expect(next).not.toBe(projection)
      const actions = animationActionsForEvent(event, next)
      expect(actions.length, `${event.type} must have a scene action`).toBeGreaterThan(0)
      for (const action of actions) kinds.set(actionKind(action), (kinds.get(actionKind(action)) ?? 0) + 1)
      projection = next
    })

    expect(projection.lastEventSeq).toBe(53)
    expect(projection.tasks).toHaveLength(5)
    expect(projection.tasks.every(task => task.status === 'COMPLETED')).toBe(true)
    expect(projection.agents).toHaveLength(7)
    expect(projection.agents.every(value => value.currentLoad === 0)).toBe(true)
    expect(projection.verification.status).toBe('PASS')
    expect(projection.repairs).toHaveLength(2)
    expect(projection.workflowStatus).toBe('PASSED')
    expect(projection.runStatus).toBe('PASSED')
    expect(Object.fromEntries(kinds)).toEqual({
      agent: 21,
      department: 17,
      flow: 17,
      terminal: 2,
    })
  })

  it('keeps the final recorded event idempotent', () => {
    let projection: HqProjection = createProjection(initialSnapshot(fixture.sourceProjectId), agents)
    let finalEvent: ProductEventView | undefined
    for (const raw of fixture.events) {
      const event = parseProductEvent(raw)
      if (event === undefined) throw new Error('recorded event failed validation')
      projection = applyProductEvent(projection, event)
      finalEvent = event
    }
    if (finalEvent === undefined) throw new Error('recorded fixture has no events')

    const duplicate = applyProductEvent(projection, finalEvent)
    expect(duplicate).toBe(projection)
    expect(animationActionsForTransition(projection, duplicate, finalEvent)).toEqual([])
  })
})
