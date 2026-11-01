/** Platform persistence contract for project queries, realtime events, and workflow leases. */

import type { ProductEvent, ProductEventType } from './product-events.ts'
import type { ExecutionId } from './brand.ts'
import type {
  AgentDefinition,
  AgentLifecycleStatus,
  AgentTeamVersion,
  AgentVersion,
  ProjectMemoryKind,
  ProjectTeamBinding,
} from './agent-registry.ts'
import type {
  WorkflowControlJournalEntry,
  WorkflowControlSnapshot,
  WorkflowDefinition,
} from './workflow-control.ts'
import type {
  ExecutionRecord,
  ExecutionEventRecord,
  ExecutionStatus,
  JsonValue,
  ProjectRecord,
  ProjectRunRecord,
  ProjectRunStatus,
  RepairRecord,
  RepairRecordDraft,
  SchedulerDecision,
  TaskFailure,
  TaskJournalEntry,
  TaskJournalEventType,
  TaskSnapshot,
  VerificationReport,
  VerificationStatus,
  WorkflowRunRecord,
  WorkflowStatus,
} from './types.ts'

/** Synchronous SQLite results and asynchronous PostgreSQL results share one contract. */
export type Awaitable<T> = T | Promise<T>

/** One live workflow lease identity that authorizes durable domain writes. */
export interface WorkflowWriteContext {
  readonly resourceId: string
  readonly ownerId: string
  readonly fencingToken: bigint
}

/** A write was attempted by an expired or superseded workflow owner. */
export class WorkflowFenceError extends Error {
  /** Stable machine-readable fence failure code. */
  readonly code = 'WORKFLOW_FENCE_LOST'

  /** @param resourceId - workflow resource whose fence was lost. */
  constructor(readonly resourceId: string) {
    super(`Workflow lease fence was lost for "${resourceId}"`)
    this.name = 'WorkflowFenceError'
  }
}

/**
 * Reject non-positive or unsafe integer bounds before a durable or network operation.
 * @param value - value to validate.
 * @param name - field name used in the actionable error.
 */
export function assertPositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

/** One project row plus its latest event cursor and workflow disposition. */
export interface PlatformProjectSummary extends ProjectRecord {
  readonly lastEventSeq: number
  readonly workflowStatus?: WorkflowStatus | undefined
  readonly latestRunId?: ProjectRunRecord['id'] | undefined
  readonly latestRunStatus?: ProjectRunStatus | undefined
}

/** One validated product event ready to append to a project stream. */
export interface ProductEventDraft {
  readonly projectId: string
  readonly type: ProductEventType
  readonly taskId?: string | undefined
  readonly agentId?: string | undefined
  readonly payload: JsonValue
  readonly occurredAt?: string | undefined
}

/** Complete project state plus the ordered events after a client cursor. */
export interface PlatformProjectSnapshot {
  readonly project: PlatformProjectSummary
  readonly tasks: readonly TaskSnapshot[]
  readonly decisions: readonly SchedulerDecision[]
  readonly executions: readonly ExecutionRecord[]
  readonly verificationReports: readonly VerificationReport[]
  readonly repairs: readonly RepairRecord[]
  readonly workflow?: WorkflowRunRecord | undefined
  readonly runs: readonly ProjectRunRecord[]
  readonly events: readonly ProductEvent[]
  readonly lastEventSeq: number
}

/** One unpublished Outbox row and its validated event value. */
export interface OutboxClaim {
  readonly eventId: string
  readonly event: ProductEvent
  readonly claimToken: string
  readonly expiresAt: string
}

/** Result of one compare-and-acquire workflow lease attempt. */
export interface LeaseAcquisition {
  readonly acquired: boolean
  readonly ownerId?: string | undefined
  readonly fencingToken?: bigint | undefined
  readonly expiresAt?: string | undefined
}

/** Current durable workflow lease state. */
export interface WorkflowLeaseState {
  readonly resourceId: string
  readonly projectId: string
  readonly ownerId?: string | undefined
  readonly fencingToken: bigint
  readonly heartbeatAt: string
  readonly expiresAt: string
}

/** One durable Agent definition plus persistence timestamps. */
export interface StoredAgentDefinition {
  readonly definition: AgentDefinition
  readonly createdAt: string
  readonly updatedAt: string
}

/** One immutable Agent version with its independently mutable lifecycle state. */
export interface StoredAgentVersion {
  readonly version: AgentVersion
  /** Monotonic database ordering within the owning definition. */
  readonly ordinal: number
  readonly checksum: string
  readonly status: AgentLifecycleStatus
  readonly createdAt: string
  readonly updatedAt: string
  readonly publishedAt?: string | undefined
  readonly deprecatedAt?: string | undefined
}

/** One immutable team version retained for project binding. */
export interface StoredAgentTeamVersion {
  readonly teamVersion: AgentTeamVersion
  /** Monotonic database ordering for this team template. */
  readonly ordinal: number
  readonly checksum: string
  readonly status: 'PUBLISHED'
  readonly createdAt: string
  readonly publishedAt: string
}

/** One structured project-memory fact permitted by Agent memory policies. */
export interface ProjectMemoryEntry {
  readonly id: string
  readonly projectId: string
  readonly kind: ProjectMemoryKind
  readonly key: string
  readonly value: JsonValue
  readonly source: string
  readonly createdAt: string
}

/** One immutable versioned workflow definition. */
export interface StoredWorkflowDefinition {
  readonly definition: WorkflowDefinition
  readonly checksum: string
  readonly status: 'PUBLISHED'
  readonly createdAt: string
  readonly publishedAt: string
}

/** Complete durable state for one project's workflow control run. */
export interface WorkflowControlStateRecord {
  readonly projectId: string
  readonly definitionId: string
  readonly definitionVersion: number
  readonly snapshot: WorkflowControlSnapshot
  readonly createdAt: string
  readonly updatedAt: string
}

/** One persisted workflow-control journal entry. */
export interface WorkflowControlEventRecord {
  readonly seq: number
  readonly projectId: string
  readonly entry: WorkflowControlJournalEntry
  readonly createdAt: string
}

/** Durable operations consumed by the platform API and realtime dispatcher. */
export interface PlatformStore {
  /**
   * Store one project and its initial task revision set atomically. A project previously registered without tasks
   * may be initialized with the matching requirement and name; existing tasks or project fields reject the write.
   * @param project - project identity and requirement.
   * @param tasks - initial task snapshots.
   */
  createProject(
    project: ProjectRecord,
    tasks: readonly TaskSnapshot[],
    write?: WorkflowWriteContext,
    binding?: ProjectTeamBinding,
    memoryEntries?: readonly ProjectMemoryEntry[],
  ): Awaitable<void>
  /**
   * Read one project.
   * @param id - project identity.
   * @returns the project when present.
   */
  getProject(id: ProjectRecord['id']): Awaitable<ProjectRecord | undefined>
  /** List projects in creation order. */
  listProjects(): Awaitable<PlatformProjectSummary[]>
  /**
   * Read one complete project snapshot.
   * @param projectId - owning project.
   * @param afterSeq - event cursor; only greater sequence values are returned.
   * @param limit - maximum returned events.
   * @returns current project state, or undefined when absent.
   */
  getProjectSnapshot(
    projectId: string,
    afterSeq: number,
    limit: number,
  ): Awaitable<PlatformProjectSnapshot | undefined>
  /**
   * Append one product event and its Outbox obligation.
   * @param draft - event identity and payload.
   * @param write - optional live workflow lease that authorizes the write.
   * @returns the committed event with its assigned project sequence.
   */
  appendProductEvent(
    draft: ProductEventDraft,
    write?: WorkflowWriteContext,
  ): Awaitable<ProductEvent>
  /**
   * Read project events after a cursor.
   * @param projectId - owning project.
   * @param afterSeq - exclusive lower bound.
   * @param limit - maximum returned events.
   * @returns ordered validated events.
   */
  listProductEvents(
    projectId: string,
    afterSeq: number,
    limit: number,
  ): Awaitable<ProductEvent[]>
  /**
   * List events for one execution.
   * @param executionId - owning execution.
   * @returns ordered execution events.
   */
  listExecutionEvents(executionId: string): Awaitable<ExecutionEventRecord[]>
  /**
   * Derive historical Agent success rates from completed executions.
   * @param projectId - owning project.
   * @returns success rate by Agent id; unknown Agents are absent.
   */
  historicalSuccessRates(projectId: string): Awaitable<Readonly<Record<string, number>>>
  /**
   * Create one durable project run and enforce one active run per project.
   * @param projectId - owning project.
   * @param ownerId - worker identity holding the workflow lease.
   * @param fencingToken - current workflow lease token.
   * @param workspacePath - private absolute run workspace retained by the server.
   * @returns the committed project run.
   */
  createProjectRun(
    projectId: string,
    ownerId: string,
    fencingToken: bigint,
    workspacePath: string,
    write?: WorkflowWriteContext,
  ): Awaitable<ProjectRunRecord>
  /**
   * Finish one running project run.
   * @param runId - project-run identity.
   * @param status - terminal run status.
   * @param previewPath - private absolute production build path when available.
   * @param error - structured launch or execution failure.
   * @returns the committed project run.
   */
  finishProjectRun(
    runId: string,
    status: Exclude<ProjectRunStatus, 'RUNNING'>,
    previewPath?: string,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): Awaitable<ProjectRunRecord>
  /**
   * Read one project run.
   * @param runId - project-run identity.
   * @returns the project run when present.
   */
  getProjectRun(runId: string): Awaitable<ProjectRunRecord | undefined>
  /**
   * List project runs in start order.
   * @param projectId - owning project.
   * @returns durable project runs.
   */
  listProjectRuns(projectId: string): Awaitable<ProjectRunRecord[]>
  /**
   * Claim unpublished or expired Outbox rows in sequence order.
   * @param ownerId - dispatcher identity receiving the bounded claim.
   * @param limit - maximum rows to return.
   * @param claimDurationMs - positive duration before another dispatcher may reclaim the rows.
   * @returns claimed rows with their event values and claim identity.
   */
  claimOutbox(ownerId: string, limit: number, claimDurationMs: number): Awaitable<OutboxClaim[]>
  /**
   * Mark this owner's delivered Outbox rows published. Rows claimed by another dispatcher remain unchanged.
   * @param ownerId - dispatcher identity that owns the claims.
   * @param eventIds - durable event identities.
   */
  markOutboxPublished(ownerId: string, eventIds: readonly string[]): Awaitable<void>
  /**
   * Acquire or take over one workflow lease.
   * @param resourceId - stable workflow resource identity.
   * @param projectId - owning project.
   * @param ownerId - worker identity.
   * @param leaseDurationMs - positive lease duration.
   * @returns acquisition result and monotonic fencing token.
   */
  acquireWorkflowLease(
    resourceId: string,
    projectId: string,
    ownerId: string,
    leaseDurationMs: number,
  ): Awaitable<LeaseAcquisition>
  /**
   * Read one workflow lease.
   * @param resourceId - stable workflow resource identity.
   * @returns the current lease, or undefined when absent.
   */
  getWorkflowLease(resourceId: string): Awaitable<WorkflowLeaseState | undefined>
  /**
   * Renew one currently owned lease.
   * @param resourceId - stable workflow resource identity.
   * @param ownerId - worker identity.
   * @param fencingToken - token returned by acquisition.
   * @param leaseDurationMs - positive renewal duration.
   * @returns whether the lease still matched and was renewed.
   */
  heartbeatWorkflowLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
    leaseDurationMs: number,
  ): Awaitable<boolean>
  /**
   * Release one currently owned lease.
   * @param resourceId - stable workflow resource identity.
   * @param ownerId - worker identity.
   * @param fencingToken - token returned by acquisition.
   * @returns whether the lease matched and was released.
   */
  releaseWorkflowLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
  ): Awaitable<boolean>
  /** List every logical Agent definition in creation order. */
  listAgentDefinitions(): Awaitable<StoredAgentDefinition[]>
  /**
   * Persist one definition metadata/status revision.
   * @param record - complete definition state.
   */
  saveAgentDefinition(record: StoredAgentDefinition): Awaitable<void>
  /**
   * List immutable Agent versions, optionally narrowed to one definition.
   * @param definitionId - optional owning definition.
   */
  listAgentVersions(definitionId?: string): Awaitable<StoredAgentVersion[]>
  /**
   * Persist one immutable Agent version and its current lifecycle state.
   * @param record - complete version state.
   */
  saveAgentVersion(record: StoredAgentVersion): Awaitable<void>
  /** List immutable team versions in creation order. */
  listAgentTeamVersions(): Awaitable<StoredAgentTeamVersion[]>
  /**
   * Read one immutable team version.
   * @param teamVersionId - team version identity.
   */
  getAgentTeamVersion(teamVersionId: string): Awaitable<StoredAgentTeamVersion | undefined>
  /**
   * Persist one immutable published team version and its member references.
   * @param record - complete team version state.
   */
  saveAgentTeamVersion(record: StoredAgentTeamVersion): Awaitable<void>
  /** List every frozen project team binding. */
  listProjectTeamBindings(): Awaitable<ProjectTeamBinding[]>
  /**
   * Read one project's frozen team binding.
   * @param projectId - owning project.
   */
  getProjectTeamBinding(projectId: string): Awaitable<ProjectTeamBinding | undefined>
  /**
   * Freeze one published team version to a project.
   * @param binding - complete immutable member snapshot.
   */
  bindProjectTeam(binding: ProjectTeamBinding): Awaitable<void>
  /**
   * Insert or replace one structured project-memory fact.
   * @param entry - complete project memory value.
   */
  saveProjectMemoryEntry(entry: ProjectMemoryEntry): Awaitable<void>
  /**
   * List project-memory entries in creation order.
   * @param projectId - owning project.
   */
  listProjectMemoryEntries(projectId: string): Awaitable<ProjectMemoryEntry[]>
  /**
   * Persist one immutable workflow definition.
   * @param record - complete versioned workflow definition.
   */
  saveWorkflowDefinition(record: StoredWorkflowDefinition): Awaitable<void>
  /**
   * Read one immutable workflow definition.
   * @param id - workflow definition identity.
   * @param version - numeric definition version.
   */
  getWorkflowDefinition(id: string, version: number): Awaitable<StoredWorkflowDefinition | undefined>
  /**
   * Persist one workflow-control snapshot and append newly committed journal entries.
   * @param projectId - owning project.
   * @param snapshot - complete current executor state.
   * @param journal - newly committed entries not already stored.
   */
  saveWorkflowControlState(
    projectId: string,
    snapshot: WorkflowControlSnapshot,
    journal: readonly WorkflowControlJournalEntry[],
    write?: WorkflowWriteContext,
  ): Awaitable<void>
  /**
   * Read one project's durable workflow-control state.
   * @param projectId - owning project.
   */
  getWorkflowControlState(projectId: string): Awaitable<WorkflowControlStateRecord | undefined>
  /**
   * List project workflow-control journal entries in commit order.
   * @param projectId - owning project.
   */
  listWorkflowControlEvents(projectId: string): Awaitable<WorkflowControlEventRecord[]>
  /** Close owned database resources. */
  close(): Awaitable<void>
}

/** Complete durable operations required by the DAG, team orchestrator, and self-loop. */
export interface OrchestrationStore extends PlatformStore {
  /**
   * Replace one complete task snapshot and append its matching revision Journal entry.
   * @param task - next task snapshot with revision already incremented.
   * @param eventType - mutation kind.
   * @param reason - optional scheduling or lifecycle explanation.
   */
  saveTask(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    reason?: string,
    write?: WorkflowWriteContext,
  ): Awaitable<void>
  /**
   * Replace one task snapshot, append its Journal entry, and settle its execution atomically.
   * @param task - next task snapshot with revision already incremented.
   * @param eventType - task mutation kind.
   * @param executionId - running execution to settle.
   * @param status - terminal execution status.
   * @param sessionId - real Harness Session identity.
   * @param error - structured failure when the execution did not succeed.
   */
  saveTaskAndFinishExecution(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    executionId: string,
    status: Exclude<ExecutionStatus, 'RUNNING'>,
    sessionId?: string,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): Awaitable<void>
  /**
   * Load current tasks in creation order.
   * @param projectId - owning project.
   * @returns validated task snapshots.
   */
  listTasks(projectId: string): Awaitable<TaskSnapshot[]>
  /**
   * Load the complete task revision journal.
   * @param projectId - owning project.
   * @returns ordered validated journal entries.
   */
  listTaskJournal(projectId: string): Awaitable<TaskJournalEntry[]>
  /**
   * Persist one explainable scheduling decision.
   * @param decision - complete candidate and score record.
   */
  saveSchedulerDecision(
    decision: SchedulerDecision,
    write?: WorkflowWriteContext,
  ): Awaitable<void>
  /**
   * Read persisted scheduler decisions in insertion order.
   * @param projectId - owning project.
   * @returns validated scheduling decisions.
   */
  listSchedulerDecisions(projectId: string): Awaitable<SchedulerDecision[]>
  /**
   * Start one durable execution record.
   * @param projectId - owning project.
   * @param taskId - task being executed.
   * @param agentId - assigned Agent.
   * @returns the execution identity.
   */
  startExecution(
    projectId: string,
    taskId: string,
    agentId: string,
    write?: WorkflowWriteContext,
  ): Awaitable<ExecutionId>
  /**
   * Finish one execution with its real Harness Session and optional failure.
   * @param id - execution identity.
   * @param status - terminal execution status.
   * @param sessionId - real Harness Session identity.
   * @param error - structured failure when the execution did not succeed.
   */
  finishExecution(
    id: string,
    status: Exclude<ExecutionStatus, 'RUNNING'>,
    sessionId?: string,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): Awaitable<void>
  /**
   * Append one execution event.
   * @param executionId - owning execution.
   * @param eventType - event discriminator.
   * @param payload - JSON audit value.
   */
  appendExecutionEvent(
    executionId: string,
    eventType: string,
    payload: JsonValue,
    write?: WorkflowWriteContext,
  ): Awaitable<void>
  /**
   * List executions in start order.
   * @param projectId - owning project.
   * @returns decoded execution records.
   */
  listExecutions(projectId: string): Awaitable<ExecutionRecord[]>
  /**
   * Persist one verification report.
   * @param projectId - owning project.
   * @param status - verification verdict.
   * @param report - complete evidence.
   * @param taskId - optional task whose result was verified.
   * @param failureSignature - stable repeated-failure identity when findings exist.
   * @returns the durable report identity.
   */
  saveVerificationReport(
    projectId: string,
    status: VerificationStatus,
    report: JsonValue,
    taskId?: string,
    failureSignature?: string,
    write?: WorkflowWriteContext,
  ): Awaitable<VerificationReport>
  /**
   * List verification reports in insertion order.
   * @param projectId - owning project.
   * @returns decoded reports.
   */
  listVerificationReports(projectId: string): Awaitable<VerificationReport[]>
  /**
   * Start the one durable workflow state for a project.
   * @param projectId - owning project.
   * @returns the initial running workflow record.
   */
  startWorkflowRun(projectId: string, write?: WorkflowWriteContext): Awaitable<WorkflowRunRecord>
  /**
   * Publish one workflow commit point.
   * @param projectId - owning project.
   * @param status - running, passed, or escalated.
   * @param repairRound - latest attempted repair round.
   * @param escalationReason - stable manual-intervention reason.
   * @param escalationMessage - visible operator explanation.
   * @returns the committed workflow state.
   */
  updateWorkflowRun(
    projectId: string,
    status: WorkflowStatus,
    repairRound: number,
    escalationReason?: WorkflowRunRecord['escalationReason'],
    escalationMessage?: string,
    write?: WorkflowWriteContext,
  ): Awaitable<WorkflowRunRecord>
  /**
   * Read one project's workflow state.
   * @param projectId - owning project.
   * @returns the workflow record when it exists.
   */
  getWorkflowRun(projectId: string): Awaitable<WorkflowRunRecord | undefined>
  /**
   * Persist one completed repair attempt with its real code diff.
   * @param projectId - owning project.
   * @param draft - completion evidence from the self-loop.
   * @returns the durable repair record.
   */
  saveRepairRecord(
    projectId: string,
    draft: RepairRecordDraft,
    write?: WorkflowWriteContext,
  ): Awaitable<RepairRecord>
  /**
   * List repair attempts in round order.
   * @param projectId - owning project.
   * @returns validated repair records.
   */
  listRepairRecords(projectId: string): Awaitable<RepairRecord[]>
}
