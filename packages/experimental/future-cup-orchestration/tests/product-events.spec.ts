import { describe, expect, it } from 'vitest'
import { PRODUCT_EVENT_TYPES, productEventSchema, projectReplayCursorSchema } from '../src/product-events.ts'

const base = {
  projectId: 'project-1',
  seq: 1,
  occurredAt: '2026-10-31T08:00:00.000Z',
  payload: { status: 'READY' },
}

describe('product event contract', () => {
  it('requires task and agent identity for agent events', () => {
    expect(productEventSchema.safeParse({
      ...base,
      type: 'agent.tool.called',
      taskId: 'task-1',
      agentId: 'frontend-a',
    }).success).toBe(true)
    expect(productEventSchema.safeParse({
      ...base,
      type: 'agent.tool.called',
      taskId: 'task-1',
    }).success).toBe(false)
  })

  it('allows project-level verification events without task or agent identity', () => {
    expect(productEventSchema.safeParse({
      ...base,
      type: 'verification.passed',
    }).success).toBe(true)
  })

  it('rejects unknown event names and invalid resume cursors', () => {
    expect(productEventSchema.safeParse({ ...base, type: 'task.unknown' }).success).toBe(false)
    expect(projectReplayCursorSchema.safeParse({ projectId: 'project-1', afterSeq: -1 }).success).toBe(false)
    expect(PRODUCT_EVENT_TYPES).toContain('workflow.escalated')
  })
})
