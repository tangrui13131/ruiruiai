/** Product event contract shared by persistence, REST snapshots, and realtime streams. */

import { z } from 'zod'
import { jsonValueSchema } from './schemas.ts'

const identifierSchema = z.string().min(1).max(120)

/** Durable event names emitted by the Future Cup platform. */
export const PRODUCT_EVENT_TYPES = [
  'task.created',
  'task.planned',
  'task.dispatched',
  'task.completed',
  'task.failed',
  'agent.started',
  'agent.progress',
  'agent.tool.called',
  'agent.completed',
  'agent.failed',
  'verification.started',
  'verification.failed',
  'verification.passed',
  'repair.started',
  'repair.completed',
  'workflow.escalated',
] as const

/** Event name retained by the durable project event log and realtime transport. */
export type ProductEventType = typeof PRODUCT_EVENT_TYPES[number]

function eventSchema<T extends ProductEventType>(
  type: T,
  task: boolean,
  agent: boolean,
) {
  return z.object({
    type: z.literal(type),
    projectId: identifierSchema,
    seq: z.number().int().positive(),
    occurredAt: z.iso.datetime(),
    taskId: task ? identifierSchema : identifierSchema.optional(),
    agentId: agent ? identifierSchema : identifierSchema.optional(),
    payload: jsonValueSchema,
  }).strict()
}

/** One durable project event with a project-scoped monotonic sequence. */
export const productEventSchema = z.discriminatedUnion('type', [
  eventSchema('task.created', true, false),
  eventSchema('task.planned', true, false),
  eventSchema('task.dispatched', true, true),
  eventSchema('task.completed', true, false),
  eventSchema('task.failed', true, false),
  eventSchema('agent.started', true, true),
  eventSchema('agent.progress', true, true),
  eventSchema('agent.tool.called', true, true),
  eventSchema('agent.completed', true, true),
  eventSchema('agent.failed', true, true),
  eventSchema('verification.started', false, false),
  eventSchema('verification.failed', false, false),
  eventSchema('verification.passed', false, false),
  eventSchema('repair.started', false, true),
  eventSchema('repair.completed', false, true),
  eventSchema('workflow.escalated', false, false),
])

/** Validated realtime or replayed product event. */
export type ProductEvent = z.infer<typeof productEventSchema>

/** Client resume cursor: request events whose project sequence is greater than `afterSeq`. */
export const projectReplayCursorSchema = z.object({
  projectId: identifierSchema,
  afterSeq: z.number().int().nonnegative(),
}).strict()

/** Validated client resume cursor. */
export type ProjectReplayCursor = z.infer<typeof projectReplayCursorSchema>
