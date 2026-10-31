/** Product event contract shared by persistence, REST snapshots, and realtime streams. */

import { z } from 'zod'
import { jsonValueSchema } from './schemas.ts'
import type {
  ExecutionRecord,
  ExecutionStatus,
  JsonValue,
  TaskJournalEventType,
  TaskSnapshot,
} from './types.ts'

const identifierSchema = z.string().min(1).max(120)

/** Durable event names emitted by the Future Cup platform. */
export const PRODUCT_EVENT_TYPES = [
  'task.created',
  'task.planned',
  'task.ready',
  'task.blocked',
  'task.cancelled',
  'task.dispatched',
  'task.completed',
  'task.failed',
  'agent.started',
  'agent.progress',
  'agent.tool.called',
  'agent.completed',
  'agent.failed',
  'agent.cancelled',
  'verification.started',
  'verification.failed',
  'verification.passed',
  'verification.incomplete',
  'repair.started',
  'repair.completed',
  'workflow.escalated',
  'run.started',
  'run.completed',
  'run.failed',
  'run.cancelled',
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
  eventSchema('task.ready', true, false),
  eventSchema('task.blocked', true, false),
  eventSchema('task.cancelled', true, false),
  eventSchema('task.dispatched', true, true),
  eventSchema('task.completed', true, false),
  eventSchema('task.failed', true, false),
  eventSchema('agent.started', true, true),
  eventSchema('agent.progress', true, true),
  eventSchema('agent.tool.called', true, true),
  eventSchema('agent.completed', true, true),
  eventSchema('agent.failed', true, true),
  eventSchema('agent.cancelled', true, true),
  eventSchema('verification.started', false, false),
  eventSchema('verification.failed', false, false),
  eventSchema('verification.passed', false, false),
  eventSchema('verification.incomplete', false, false),
  eventSchema('repair.started', false, true),
  eventSchema('repair.completed', false, true),
  eventSchema('workflow.escalated', false, false),
  eventSchema('run.started', false, false),
  eventSchema('run.completed', false, false),
  eventSchema('run.failed', false, false),
  eventSchema('run.cancelled', false, false),
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

/**
 * Map one task-journal mutation to its public product event.
 * @param eventType - durable task mutation kind.
 * @param _task - committed task snapshot.
 * @returns the public event type, or undefined when the mutation has no product event.
 */
export function taskProductEventType(
  eventType: TaskJournalEventType,
  _task: TaskSnapshot,
): ProductEventType | undefined {
  switch (eventType) {
    case 'task/created':
      return 'task.created'
    case 'task/ready':
    case 'task/requeued':
      return 'task.ready'
    case 'task/blocked':
      return 'task.blocked'
    case 'task/assigned':
      return undefined
    case 'task/completed':
      return 'task.completed'
    case 'task/failed':
      return 'task.failed'
    case 'task/cancelled':
      return 'task.cancelled'
    default:
      return undefined
  }
}

/**
 * Map one terminal execution status to its public Agent event.
 * @param status - committed terminal execution status.
 * @returns the corresponding Agent product event.
 */
export function executionProductEventType(
  status: Exclude<ExecutionStatus, 'RUNNING'>,
): 'agent.completed' | 'agent.cancelled' | 'agent.failed' {
  switch (status) {
    case 'COMPLETED':
      return 'agent.completed'
    case 'CANCELLED':
      return 'agent.cancelled'
    case 'FAILED':
      return 'agent.failed'
  }
}

/**
 * Normalize one task snapshot for a JSON product-event payload.
 * @param task - committed task snapshot.
 * @returns a JSON-compatible snapshot.
 */
export function taskProductEventPayload(task: TaskSnapshot): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(task)))
}

/**
 * Normalize one execution record for a JSON product-event payload.
 * @param execution - committed execution record.
 * @returns a JSON-compatible execution snapshot.
 */
export function executionProductEventPayload(execution: ExecutionRecord): JsonValue {
  return jsonValueSchema.parse(JSON.parse(JSON.stringify(execution)))
}
