/** Runtime constants and predicates for the Future Cup orchestration domain. */

import type { TaskSnapshot } from './types.ts'

/** Every durable DAG task state. */
export const TASK_STATUSES = [
  'PENDING',
  'READY',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
] as const

/** Roles implemented by the M3 Agent team. */
export const AGENT_ROLES = [
  'planner',
  'ui-designer',
  'tester',
  'frontend',
  'integration',
  'repair',
] as const

/** States that no longer change without an explicit retry or operator action. */
export const TERMINAL_TASK_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const

/**
 * Whether a task state is terminal for readiness propagation.
 * @param status - task state to classify.
 * @returns whether the state is terminal.
 */
export function isTerminalTaskStatus(status: TaskSnapshot['status']): boolean {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status)
}
