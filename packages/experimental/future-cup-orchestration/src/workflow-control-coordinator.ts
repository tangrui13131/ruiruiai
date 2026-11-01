/** Durable coordinator for versioned workflow-control snapshots and journals. */

import { checksumJson } from './content-checksum.ts'
import type {
  PlatformStore,
  WorkflowControlEventRecord,
  WorkflowControlStateRecord,
} from './platform-store.ts'
import { jsonValueSchema } from './schemas.ts'
import {
  FUTURE_CUP_WORKFLOW_CONTROL_DEFINITION,
  WorkflowControlExecutor,
  type WorkflowControlEvent,
  type WorkflowControlSnapshot,
  type WorkflowDefinition,
  type WorkflowEscalationReason,
} from './workflow-control.ts'

/** Coordinates deterministic workflow execution with durable snapshots and journal rows. */
export class WorkflowControlCoordinator {
  /**
   * @param store - shared SQLite or PostgreSQL persistence.
   * @param definition - versioned control graph; defaults to the fixed Future Cup workflow.
   * @param now - deterministic clock override.
   */
  constructor(
    private readonly store: PlatformStore,
    private readonly definition: WorkflowDefinition = FUTURE_CUP_WORKFLOW_CONTROL_DEFINITION,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Create or return the project's durable control run.
   * @param projectId - owning Future Cup project.
   * @returns the current quiescent control snapshot.
   */
  async start(projectId: string): Promise<WorkflowControlSnapshot> {
    const existing = await this.store.getWorkflowControlState(projectId)
    if (existing !== undefined) return existing.snapshot
    const timestamp = this.timestamp()
    await this.store.saveWorkflowDefinition({
      definition: this.definition,
      checksum: checksumJson(jsonValueSchema.parse(this.definition)),
      status: 'PUBLISHED',
      createdAt: timestamp,
      publishedAt: timestamp,
    })
    const snapshot = WorkflowControlExecutor.start(this.definition).snapshot()
    await this.store.saveWorkflowControlState(projectId, snapshot, snapshot.journal)
    return snapshot
  }

  /**
   * Advance one durable control run by one external completion or verification event.
   * @param projectId - owning project.
   * @param event - completion or verification result.
   * @returns the next quiescent snapshot.
   */
  async advance(
    projectId: string,
    event: WorkflowControlEvent,
  ): Promise<WorkflowControlSnapshot> {
    return await this.transition(
      projectId,
      executor => executor.advance(event),
    )
  }

  /**
   * Escalate one running control graph after an external runtime failure.
   * @param projectId - owning project.
   * @param reason - stable manual-intervention reason.
   * @returns the persisted terminal snapshot.
   */
  async escalate(
    projectId: string,
    reason: WorkflowEscalationReason,
  ): Promise<WorkflowControlSnapshot> {
    return await this.transition(
      projectId,
      executor => executor.escalate(reason),
    )
  }

  private async transition(
    projectId: string,
    operation: (executor: WorkflowControlExecutor) => WorkflowControlSnapshot,
  ): Promise<WorkflowControlSnapshot> {
    const state = await this.store.getWorkflowControlState(projectId)
    if (state === undefined) throw new Error(`workflow control for "${projectId}" has not started`)
    const executor = WorkflowControlExecutor.resume(state.snapshot)
    const previousJournalLength = state.snapshot.journal.length
    const next = operation(executor)
    await this.store.saveWorkflowControlState(
      projectId,
      next,
      next.journal.slice(previousJournalLength),
    )
    return next
  }

  /**
   * Read one project's durable control state.
   * @param projectId - owning project.
   * @returns current record when present.
   */
  async get(projectId: string): Promise<WorkflowControlStateRecord | undefined> {
    return await this.store.getWorkflowControlState(projectId)
  }

  /**
   * List the durable control journal in commit order.
   * @param projectId - owning project.
   * @returns persisted journal rows.
   */
  async events(projectId: string): Promise<WorkflowControlEventRecord[]> {
    return await this.store.listWorkflowControlEvents(projectId)
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}
