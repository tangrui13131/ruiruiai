/** SQLite-backed durable repository for Future Cup DAGs, scheduling, and execution evidence. */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  AgentId,
  ExecutionId,
  ProjectId,
  ProjectRunId,
  RepairRecordId,
  TaskId,
  VerificationReportId,
  WorkflowRunId,
} from './brand.ts'
import {
  jsonValueSchema,
  schedulerDecisionSchema,
  taskFailureSchema,
  taskJournalEntrySchema,
  taskSnapshotSchema,
  verificationStatusSchema,
} from './schemas.ts'
import {
  executionProductEventPayload,
  executionProductEventType,
  productEventSchema,
  taskProductEventPayload,
  taskProductEventType,
} from './product-events.ts'
import {
  assertPositiveSafeInteger,
  WorkflowFenceError,
} from './platform-store.ts'
import { openOrchestrationDatabase, ORCHESTRATION_SCHEMA_VERSION } from './sqlite.ts'
import type {
  LeaseAcquisition,
  OrchestrationStore,
  OutboxClaim,
  PlatformProjectSnapshot,
  PlatformProjectSummary,
  ProductEventDraft,
  WorkflowLeaseState,
  WorkflowWriteContext,
} from './platform-store.ts'
import type {
  ExecutionEventRecord,
  ExecutionRecord,
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
import type { ProductEvent } from './product-events.ts'

interface RepositoryOptions {
  /** Override for deterministic test timestamps. */
  readonly now?: () => Date
  /** Override for deterministic execution and verification ids. */
  readonly createId?: () => string
  /** SQLite journal mode; tests use `delete` to avoid Windows WAL cleanup races. */
  readonly journalMode?: 'wal' | 'delete'
}

const projectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  requirement: z.string(),
  last_event_seq: z.number(),
  created_at: z.string(),
}).strict()

const taskRowSchema = z.object({
  snapshot_json: z.string(),
}).strict()

const journalRowSchema = z.object({
  seq: z.number(),
  project_id: z.string(),
  task_id: z.string(),
  revision: z.number(),
  event_type: z.string(),
  reason: z.string().nullable(),
  snapshot_json: z.string(),
  created_at: z.string(),
}).strict()

const schedulerDecisionRowSchema = z.object({
  decision_json: z.string(),
}).strict()

const executionRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  task_id: z.string(),
  agent_id: z.string(),
  session_id: z.string().nullable(),
  status: z.string(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  error_json: z.string().nullable(),
}).strict()

const executionEventRowSchema = z.object({
  seq: z.number(),
  execution_id: z.string(),
  event_type: z.string(),
  payload_json: z.string(),
  created_at: z.string(),
}).strict()

const verificationRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  task_id: z.string().nullable(),
  status: z.string(),
  failure_signature: z.string().nullable(),
  report_json: z.string(),
  created_at: z.string(),
}).strict()

const repairRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  repair_round: z.number(),
  verification_report_id: z.string(),
  repair_agent_id: z.string(),
  failure_signature: z.string(),
  error_summary: z.string(),
  change_summary: z.string(),
  diff: z.string(),
  before_status: z.string(),
  after_status: z.string(),
  started_at: z.string(),
  completed_at: z.string(),
}).strict()

const workflowRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  status: z.string(),
  repair_round: z.number(),
  escalation_reason: z.string().nullable(),
  escalation_message: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
}).strict()

const productEventRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  seq: z.number(),
  type: z.string(),
  task_id: z.string().nullable(),
  agent_id: z.string().nullable(),
  payload_json: z.string(),
  occurred_at: z.string(),
}).strict()

const workflowLeaseRowSchema = z.object({
  resource_id: z.string(),
  project_id: z.string(),
  owner_id: z.string().nullable(),
  fencing_token: z.number(),
  heartbeat_at: z.string(),
  expires_at: z.string(),
}).strict()

const projectRunRowSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  status: z.string(),
  owner_id: z.string(),
  fencing_token: z.number(),
  workspace_path: z.string(),
  preview_path: z.string().nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable(),
  error_json: z.string().nullable(),
}).strict()

/** Current persisted DAG state used by resume verification. */
export interface PersistedDag {
  readonly tasks: readonly TaskSnapshot[]
  readonly journal: readonly TaskJournalEntry[]
}

/**
 * Durable SQLite repository for one Future Cup orchestration database.
 * Call {@link close} exactly once when the owner finishes.
 */
export class OrchestrationRepository implements OrchestrationStore {
  private readonly database: DatabaseSync
  private readonly now: () => Date
  private readonly createId: () => string
  private closed = false

  /**
   * @param path - SQLite database path or `:memory:`.
   * @param options - deterministic clock and id overrides for tests.
   */
  constructor(path: string, options: RepositoryOptions = {}) {
    this.database = openOrchestrationDatabase(path, options.journalMode)
    this.now = options.now ?? (() => new Date())
    this.createId = options.createId ?? randomUUID
  }

  /** Physical schema version owned by this repository. */
  get schemaVersion(): number {
    return ORCHESTRATION_SCHEMA_VERSION
  }

  /**
   * Store one project and its initial task revisions in one transaction.
   * @param project - project identity and user requirement.
   * @param tasks - revision-one task snapshots in creation order.
   */
  createProject(
    project: ProjectRecord,
    tasks: readonly TaskSnapshot[],
    write?: WorkflowWriteContext,
  ): void {
    this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const existing = this.database.prepare(`
        SELECT id, name, requirement, created_at
        FROM projects
        WHERE id = ?
      `).get(project.id) as {
        id: string
        name: string
        requirement: string
        created_at: string
      } | undefined
      if (existing === undefined) {
        this.database.prepare(
          'INSERT INTO projects (id, name, requirement, created_at) VALUES (?, ?, ?, ?)',
        ).run(project.id, project.name, project.requirement, project.createdAt)
      } else if (existing.name !== project.name || existing.requirement !== project.requirement) {
        throw new Error(`project "${project.id}" already exists with a different name or requirement`)
      }
      const { count } = this.database.prepare(`
        SELECT COUNT(*) AS count
        FROM tasks
        WHERE project_id = ?
      `).get(project.id) as { count: number }
      if (tasks.length > 0 && count > 0) {
        throw new Error(`project "${project.id}" already has tasks`)
      }
      const taskStatement = this.database.prepare(`
        INSERT INTO tasks (project_id, id, snapshot_json, revision, status, position)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const dependencyStatement = this.database.prepare(`
        INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id)
        VALUES (?, ?, ?)
      `)
      for (const [position, task] of tasks.entries()) {
        taskStatement.run(
          task.projectId,
          task.id,
          JSON.stringify(task),
          task.revision,
          task.status,
          position,
        )
        for (const dependency of task.dependencies) {
          dependencyStatement.run(task.projectId, task.id, dependency)
        }
        this.appendTaskJournal(task, 'task/created')
        this.appendProductEventInTransaction({
          projectId: project.id,
          type: 'task.created',
          taskId: task.id,
          payload: taskProductEventPayload(task),
        })
      }
    })
  }

  /**
   * Read one project.
   * @param id - project identity.
   * @returns the stored project, or undefined when absent.
   */
  getProject(id: ProjectId): ProjectRecord | undefined {
    const raw = this.database.prepare(
      'SELECT id, name, requirement, last_event_seq, created_at FROM projects WHERE id = ?',
    ).get(id)
    if (raw === undefined) return undefined
    const row = projectRowSchema.parse(raw)
    return {
      id: ProjectId(row.id),
      name: row.name,
      requirement: row.requirement,
      createdAt: row.created_at,
    }
  }

  /**
   * List all projects with their current event cursor and workflow state.
   * @returns project summaries in creation order.
   */
  listProjects(): PlatformProjectSummary[] {
    const rows = projectRowSchema.extend({
      workflow_status: z.string().nullable(),
      latest_run_id: z.string().nullable(),
      latest_run_status: z.string().nullable(),
    }).array().parse(this.database.prepare(`
      SELECT
        p.id, p.name, p.requirement, p.last_event_seq, p.created_at,
        w.status AS workflow_status,
        r.id AS latest_run_id,
        r.status AS latest_run_status
      FROM projects p
      LEFT JOIN workflow_runs w ON w.project_id = p.id
      LEFT JOIN project_runs r ON r.id = (
        SELECT latest.id
        FROM project_runs latest
        WHERE latest.project_id = p.id
        ORDER BY latest.started_at DESC, latest.rowid DESC
        LIMIT 1
      )
      ORDER BY p.rowid
    `).all())
    return rows.map(row => ({
      id: ProjectId(row.id),
      name: row.name,
      requirement: row.requirement,
      lastEventSeq: row.last_event_seq,
      workflowStatus: row.workflow_status === null
        ? undefined
        : decodeWorkflowStatus(row.workflow_status),
      latestRunId: row.latest_run_id === null ? undefined : ProjectRunId(row.latest_run_id),
      latestRunStatus: row.latest_run_status === null
        ? undefined
        : decodeProjectRunStatus(row.latest_run_status),
      createdAt: row.created_at,
    }))
  }

  /**
   * Read the complete project state needed by an API snapshot.
   * @param projectId - owning project.
   * @param afterSeq - exclusive product-event cursor.
   * @param limit - maximum returned events.
   * @returns the project snapshot, or undefined when absent.
   */
  getProjectSnapshot(
    projectId: string,
    afterSeq: number,
    limit: number,
  ): PlatformProjectSnapshot | undefined {
    const project = this.listProjects().find(value => value.id === projectId)
    if (project === undefined) return undefined
    const id = ProjectId(projectId)
    return {
      project,
      tasks: this.listTasks(id),
      decisions: this.listSchedulerDecisions(id),
      executions: this.listExecutions(id),
      verificationReports: this.listVerificationReports(id),
      repairs: this.listRepairRecords(id),
      workflow: this.getWorkflowRun(id),
      runs: this.listProjectRuns(id),
      events: this.listProductEvents(projectId, afterSeq, limit),
      lastEventSeq: project.lastEventSeq,
    }
  }

  /**
   * Append one product event and Outbox row while advancing the project cursor.
   * @param draft - event identity and payload.
   * @param write - optional live workflow lease that authorizes the write.
   * @returns the committed event.
   */
  appendProductEvent(draft: ProductEventDraft, write?: WorkflowWriteContext): ProductEvent {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      return this.appendProductEventInTransaction(draft)
    })
  }

  /**
   * Read product events after one project sequence.
   * @param projectId - owning project.
   * @param afterSeq - exclusive lower bound.
   * @param limit - maximum events.
   * @returns ordered events.
   */
  listProductEvents(projectId: string, afterSeq: number, limit: number): ProductEvent[] {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('event limit must be a positive safe integer')
    const rows = productEventRowSchema.array().parse(this.database.prepare(`
      SELECT id, project_id, seq, type, task_id, agent_id, payload_json, occurred_at
      FROM product_events
      WHERE project_id = ? AND seq > ?
      ORDER BY seq
      LIMIT ?
    `).all(projectId, afterSeq, limit))
    return rows.map(decodeProductEvent)
  }

  /**
   * Claim unpublished or expired Outbox rows for one dispatcher.
   * @param ownerId - dispatcher identity.
   * @param limit - maximum rows.
   * @param claimDurationMs - positive duration before another dispatcher may reclaim.
   * @returns events awaiting realtime delivery.
   */
  claimOutbox(ownerId: string, limit: number, claimDurationMs: number): OutboxClaim[] {
    if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error('outbox limit must be a positive safe integer')
    assertClaimDuration(claimDurationMs)
    return this.transaction(() => {
      const now = this.now()
      const claimed = this.database.prepare(`
        SELECT o.event_id
        FROM outbox_events o
        JOIN product_events e ON e.id = o.event_id
        WHERE o.published_at IS NULL
          AND (o.claim_expires_at IS NULL OR o.claim_expires_at <= ?)
        ORDER BY e.rowid
        LIMIT ?
      `).all(now.toISOString(), limit) as { event_id: string }[]
      const expiresAt = new Date(now.getTime() + claimDurationMs).toISOString()
      const claimStatement = this.database.prepare(`
        UPDATE outbox_events
        SET claim_owner_id = ?, claim_token = ?, claimed_at = ?, claim_expires_at = ?
        WHERE event_id = ? AND published_at IS NULL
      `)
      for (const row of claimed) {
        claimStatement.run(ownerId, this.createId(), now.toISOString(), expiresAt, row.event_id)
      }
      if (claimed.length === 0) return []
      const placeholders = claimed.map(() => '?').join(', ')
      const rows = productEventRowSchema.extend({
        claim_token: z.string(),
        claim_expires_at: z.string(),
      }).array().parse(this.database.prepare(`
        SELECT
          e.id, e.project_id, e.seq, e.type, e.task_id, e.agent_id, e.payload_json, e.occurred_at,
          o.claim_token, o.claim_expires_at
        FROM outbox_events o
        JOIN product_events e ON e.id = o.event_id
        WHERE o.event_id IN (${placeholders}) AND o.claim_owner_id = ?
        ORDER BY e.rowid
      `).all(...claimed.map(row => row.event_id), ownerId))
      return rows.map(row => ({
        eventId: row.id,
        event: decodeProductEvent(row),
        claimToken: row.claim_token,
        expiresAt: row.claim_expires_at,
      }))
    })
  }

  /**
   * Mark this dispatcher's Outbox rows published after a broadcast attempt.
   * @param ownerId - dispatcher identity.
   * @param eventIds - durable event identities.
   */
  markOutboxPublished(ownerId: string, eventIds: readonly string[]): void {
    if (eventIds.length === 0) return
    const statement = this.database.prepare(
      `UPDATE outbox_events
       SET published_at = ?, claim_owner_id = NULL, claim_token = NULL,
           claimed_at = NULL, claim_expires_at = NULL
       WHERE event_id = ? AND published_at IS NULL AND claim_owner_id = ?`,
    )
    const publishedAt = this.timestamp()
    this.transaction(() => {
      for (const eventId of eventIds) statement.run(publishedAt, eventId, ownerId)
    })
  }

  /**
   * Acquire or take over one expired workflow lease.
   * @param resourceId - stable workflow resource identity.
   * @param projectId - owning project.
   * @param ownerId - worker identity.
   * @param leaseDurationMs - positive lease duration.
   * @returns fencing token and acquisition status.
   */
  acquireWorkflowLease(
    resourceId: string,
    projectId: string,
    ownerId: string,
    leaseDurationMs: number,
  ): LeaseAcquisition {
    assertLeaseDuration(leaseDurationMs)
    return this.transaction(() => {
      const now = this.now()
      const current = this.database.prepare(`
        SELECT resource_id, project_id, owner_id, fencing_token, heartbeat_at, expires_at
        FROM workflow_leases
        WHERE resource_id = ?
      `).get(resourceId)
      const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString()
      if (current === undefined) {
        this.database.prepare(`
          INSERT INTO workflow_leases (
            resource_id, project_id, owner_id, fencing_token, heartbeat_at, expires_at
          ) VALUES (?, ?, ?, 1, ?, ?)
        `).run(resourceId, projectId, ownerId, now.toISOString(), expiresAt)
        return { acquired: true, ownerId, fencingToken: 1n, expiresAt }
      }
      const row = workflowLeaseRowSchema.parse(current)
      if (row.owner_id !== null && Date.parse(row.expires_at) > now.getTime()) {
        return {
          acquired: false,
          ownerId: row.owner_id,
          fencingToken: BigInt(row.fencing_token),
          expiresAt: row.expires_at,
        }
      }
      const fencingToken = BigInt(row.fencing_token) + 1n
      this.database.prepare(`
        UPDATE workflow_leases
        SET owner_id = ?, fencing_token = ?, heartbeat_at = ?, expires_at = ?
        WHERE resource_id = ?
      `).run(ownerId, Number(fencingToken), now.toISOString(), expiresAt, resourceId)
      return { acquired: true, ownerId, fencingToken, expiresAt }
    })
  }

  /**
   * Read one workflow lease.
   * @param resourceId - stable workflow resource identity.
   * @returns lease state when present.
   */
  getWorkflowLease(resourceId: string): WorkflowLeaseState | undefined {
    const raw = this.database.prepare(`
      SELECT resource_id, project_id, owner_id, fencing_token, heartbeat_at, expires_at
      FROM workflow_leases
      WHERE resource_id = ?
    `).get(resourceId)
    if (raw === undefined) return undefined
    const row = workflowLeaseRowSchema.parse(raw)
    return {
      resourceId: row.resource_id,
      projectId: row.project_id,
      ownerId: row.owner_id ?? undefined,
      fencingToken: BigInt(row.fencing_token),
      heartbeatAt: row.heartbeat_at,
      expiresAt: row.expires_at,
    }
  }

  /**
   * Renew one currently owned workflow lease.
   * @param resourceId - stable workflow resource identity.
   * @param ownerId - worker identity.
   * @param fencingToken - token returned by acquisition.
   * @param leaseDurationMs - positive renewal duration.
   * @returns whether the lease matched and was renewed.
   */
  heartbeatWorkflowLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
    leaseDurationMs: number,
  ): boolean {
    assertLeaseDuration(leaseDurationMs)
    const now = this.now()
    const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString()
    const result = this.database.prepare(`
      UPDATE workflow_leases
      SET heartbeat_at = ?, expires_at = ?
      WHERE resource_id = ? AND owner_id = ? AND fencing_token = ? AND expires_at > ?
    `).run(now.toISOString(), expiresAt, resourceId, ownerId, Number(fencingToken), now.toISOString())
    return result.changes === 1
  }

  /**
   * Release one currently owned workflow lease.
   * @param resourceId - stable workflow resource identity.
   * @param ownerId - worker identity.
   * @param fencingToken - token returned by acquisition.
   * @returns whether the lease matched and was released.
   */
  releaseWorkflowLease(resourceId: string, ownerId: string, fencingToken: bigint): boolean {
    const result = this.database.prepare(`
      UPDATE workflow_leases
      SET owner_id = NULL, expires_at = ?, heartbeat_at = ?
      WHERE resource_id = ? AND owner_id = ? AND fencing_token = ?
    `).run(this.timestamp(), this.timestamp(), resourceId, ownerId, Number(fencingToken))
    return result.changes === 1
  }

  /**
   * Update one complete task snapshot and append its matching revision journal entry.
   * @param task - next task snapshot with revision already incremented.
   * @param eventType - mutation kind.
   * @param reason - optional scheduling or lifecycle explanation.
   */
  saveTask(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    reason?: string,
    write?: WorkflowWriteContext,
  ): void {
    this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      this.updateTaskRevision(task)
      this.appendTaskJournalAndProductEvent(task, eventType, reason)
    })
  }

  /**
   * Replace one task revision and settle its running execution in one transaction.
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
  ): void {
    this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      this.updateTaskRevision(task)
      this.appendTaskJournalAndProductEvent(task, eventType)
      const updatedExecution = this.database.prepare(`
        UPDATE executions
        SET status = ?, session_id = ?, completed_at = ?, error_json = ?
        WHERE id = ? AND project_id = ? AND task_id = ? AND agent_id = ? AND status = 'RUNNING'
      `).run(
        status,
        sessionId ?? null,
        this.timestamp(),
        error === undefined ? null : JSON.stringify(error),
        executionId,
        task.projectId,
        task.id,
        task.assignedAgentId ?? '',
      )
      if (updatedExecution.changes !== 1) {
        throw new Error(`cannot settle missing or mismatched execution "${executionId}"`)
      }
      const raw = this.database.prepare(`
        SELECT id, project_id, task_id, agent_id, session_id, status, started_at, completed_at, error_json
        FROM executions
        WHERE id = ?
      `).get(executionId)
      if (raw === undefined) throw new Error(`execution "${executionId}" disappeared after update`)
      this.appendExecutionProductEvent(decodeExecutionRow(executionRowSchema.parse(raw)))
    })
  }

  /**
   * Load current tasks in creation order.
   * @param projectId - owning project.
   * @returns validated task snapshots.
   */
  listTasks(projectId: ProjectId): TaskSnapshot[] {
    const rows = taskRowSchema.array().parse(this.database.prepare(`
      SELECT snapshot_json
      FROM tasks
      WHERE project_id = ?
      ORDER BY position
    `).all(projectId))
    return rows.map(row => decodeTask(JSON.parse(row.snapshot_json)))
  }

  /**
   * Load the complete task revision journal.
   * @param projectId - owning project.
   * @returns ordered validated journal entries.
   */
  listTaskJournal(projectId: ProjectId): TaskJournalEntry[] {
    const rows = journalRowSchema.array().parse(this.database.prepare(`
      SELECT seq, project_id, task_id, revision, event_type, reason, snapshot_json, created_at
      FROM task_journal
      WHERE project_id = ?
      ORDER BY seq
    `).all(projectId))
    return rows.map(row => decodeJournal(row))
  }

  /**
   * Persist one explainable scheduling decision.
   * @param decision - complete candidate and score record.
   */
  saveSchedulerDecision(
    decision: SchedulerDecision,
    write?: WorkflowWriteContext,
  ): void {
    this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      this.database.prepare(`
        INSERT INTO scheduler_decisions (id, project_id, task_id, decision_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        decision.id,
        decision.projectId,
        decision.taskId,
        JSON.stringify(decision),
        decision.createdAt,
      )
    })
  }

  /**
   * Read persisted scheduler decisions in insertion order.
   * @param projectId - owning project.
   * @returns validated scheduling decisions.
   */
  listSchedulerDecisions(projectId: ProjectId): SchedulerDecision[] {
    const rows = schedulerDecisionRowSchema.array().parse(this.database.prepare(`
      SELECT decision_json
      FROM scheduler_decisions
      WHERE project_id = ?
      ORDER BY seq
    `).all(projectId))
    return rows.map(row => decodeSchedulerDecision(JSON.parse(row.decision_json)))
  }

  /**
   * Start one durable execution record.
   * @param projectId - owning project.
   * @param taskId - task being executed.
   * @param agentId - assigned Agent.
   * @returns the execution identity.
   */
  startExecution(
    projectId: ProjectId,
    taskId: TaskId,
    agentId: AgentId,
    write?: WorkflowWriteContext,
  ): ExecutionId {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const id = ExecutionId(`execution-${this.createId()}`)
      const startedAt = this.timestamp()
      this.database.prepare(`
        INSERT INTO executions (
          id, project_id, task_id, agent_id, session_id, status, started_at, completed_at, error_json
        ) VALUES (?, ?, ?, ?, NULL, 'RUNNING', ?, NULL, NULL)
      `).run(id, projectId, taskId, agentId, startedAt)
      this.appendProductEventInTransaction({
        projectId,
        type: 'task.dispatched',
        taskId,
        agentId,
        payload: { executionId: id, taskId, agentId, status: 'RUNNING', startedAt },
      })
      this.appendProductEventInTransaction({
        projectId,
        type: 'agent.started',
        taskId,
        agentId,
        payload: { executionId: id, taskId, agentId, status: 'RUNNING', startedAt },
      })
      return id
    })
  }

  /**
   * Finish one execution with its real Harness Session and optional failure.
   * @param id - execution identity.
   * @param status - terminal execution status.
   * @param sessionId - real Harness Session identity.
   * @param error - structured failure when the execution did not succeed.
   */
  finishExecution(
    id: ExecutionId,
    status: Exclude<ExecutionStatus, 'RUNNING'>,
    sessionId: string | undefined,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): void {
    this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const completedAt = this.timestamp()
      const result = this.database.prepare(`
        UPDATE executions
        SET status = ?, session_id = ?, completed_at = ?, error_json = ?
        WHERE id = ? AND status = 'RUNNING'
      `).run(
        status,
        sessionId ?? null,
        completedAt,
        error === undefined ? null : JSON.stringify(error),
        id,
      )
      if (result.changes !== 1) throw new Error(`cannot finish missing or settled execution "${id}"`)
      const raw = this.database.prepare(`
        SELECT id, project_id, task_id, agent_id, session_id, status, started_at, completed_at, error_json
        FROM executions
        WHERE id = ?
      `).get(id)
      if (raw === undefined) throw new Error(`execution "${id}" disappeared after update`)
      this.appendExecutionProductEvent(decodeExecutionRow(executionRowSchema.parse(raw)))
    })
  }

  /**
   * Append one execution event.
   * @param executionId - owning execution.
   * @param eventType - event discriminator.
   * @param payload - JSON audit value.
   */
  appendExecutionEvent(
    executionId: ExecutionId,
    eventType: string,
    payload: JsonValue,
    write?: WorkflowWriteContext,
  ): void {
    this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      this.database.prepare(`
        INSERT INTO execution_events (execution_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(executionId, eventType, JSON.stringify(payload), this.timestamp())
      const raw = this.database.prepare(`
        SELECT id, project_id, task_id, agent_id, session_id, status, started_at, completed_at, error_json
        FROM executions
        WHERE id = ?
      `).get(executionId)
      if (raw === undefined) throw new Error(`cannot append event for missing execution "${executionId}"`)
      const row = executionRowSchema.parse(raw)
      if (eventType === 'repair/started') {
        this.appendProductEventInTransaction({
          projectId: row.project_id,
          type: 'repair.started',
          taskId: row.task_id,
          agentId: row.agent_id,
          payload,
        })
      } else if (eventType === 'agent/session-events') {
        const eventTypes = jsonValueSchema.parse(payload)
        if (!Array.isArray(eventTypes) || !eventTypes.includes('tool/call')) return
        this.appendProductEventInTransaction({
          projectId: row.project_id,
          type: 'agent.tool.called',
          taskId: row.task_id,
          agentId: row.agent_id,
          payload,
        })
      }
    })
  }

  /**
   * List executions in start order.
   * @param projectId - owning project.
   * @returns decoded execution records.
   */
  listExecutions(projectId: ProjectId): ExecutionRecord[] {
    const rows = executionRowSchema.array().parse(this.database.prepare(`
      SELECT id, project_id, task_id, agent_id, session_id, status, started_at, completed_at, error_json
      FROM executions
      WHERE project_id = ?
      ORDER BY rowid
    `).all(projectId))
    return rows.map(decodeExecutionRow)
  }

  /**
   * List events for one execution.
   * @param executionId - owning execution.
   * @returns ordered execution events.
   */
  listExecutionEvents(executionId: ExecutionId): ExecutionEventRecord[] {
    const rows = executionEventRowSchema.array().parse(this.database.prepare(`
      SELECT seq, execution_id, event_type, payload_json, created_at
      FROM execution_events
      WHERE execution_id = ?
      ORDER BY seq
    `).all(executionId))
    return rows.map(row => ({
      seq: row.seq,
      executionId: ExecutionId(row.execution_id),
      eventType: row.event_type,
      payload: jsonValueSchema.parse(JSON.parse(row.payload_json)),
      createdAt: row.created_at,
    }))
  }

  /**
   * Create one durable project run and append its product event atomically.
   * @param projectId - owning project.
   * @param ownerId - workflow lease owner.
   * @param fencingToken - current workflow lease token.
   * @param workspacePath - private run workspace.
   * @returns the committed project run.
   */
  createProjectRun(
    projectId: string,
    ownerId: string,
    fencingToken: bigint,
    workspacePath: string,
    write?: WorkflowWriteContext,
  ): ProjectRunRecord {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const run: ProjectRunRecord = {
        id: ProjectRunId(`run-${this.createId()}`),
        projectId: ProjectId(projectId),
        status: 'RUNNING',
        ownerId,
        fencingToken,
        workspacePath,
        startedAt: this.timestamp(),
      }
      this.database.prepare(`
        INSERT INTO project_runs (
          id, project_id, status, owner_id, fencing_token, workspace_path,
          preview_path, started_at, completed_at, error_json
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL)
      `).run(
        run.id,
        run.projectId,
        run.status,
        run.ownerId,
        Number(run.fencingToken),
        workspacePath,
        run.startedAt,
      )
      this.appendProductEventInTransaction({
        projectId,
        type: 'run.started',
        payload: { runId: run.id, status: run.status },
      })
      return run
    })
  }

  /**
   * Finish one running project run and append its terminal event atomically.
   * @param runId - project-run identity.
   * @param status - terminal status.
   * @param previewPath - private production build path.
   * @param error - structured failure.
   * @returns the committed project run.
   */
  finishProjectRun(
    runId: string,
    status: Exclude<ProjectRunStatus, 'RUNNING'>,
    previewPath?: string,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): ProjectRunRecord {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const completedAt = this.timestamp()
      const result = this.database.prepare(`
        UPDATE project_runs
        SET status = ?, preview_path = COALESCE(?, preview_path),
            completed_at = ?, error_json = ?
        WHERE id = ? AND status = 'RUNNING'
      `).run(
        status,
        previewPath ?? null,
        completedAt,
        error === undefined ? null : JSON.stringify(error),
        runId,
      )
      if (result.changes !== 1) {
        throw new Error(`cannot finish missing or settled project run "${runId}"`)
      }
      const run = this.getProjectRun(runId)
      if (run === undefined) throw new Error(`project run "${runId}" disappeared after update`)
      const type = status === 'CANCELLED'
        ? 'run.cancelled'
        : status === 'FAILED'
          ? 'run.failed'
          : 'run.completed'
      this.appendProductEventInTransaction({
        projectId: run.projectId,
        type,
        payload: { runId: run.id, status: run.status },
      })
      return run
    })
  }

  /**
   * Read one project run.
   * @param runId - project-run identity.
   * @returns the run when present.
   */
  getProjectRun(runId: string): ProjectRunRecord | undefined {
    const row = this.database.prepare(`
      SELECT
        id, project_id, status, owner_id, fencing_token, workspace_path,
        preview_path, started_at, completed_at, error_json
      FROM project_runs
      WHERE id = ?
    `).get(runId)
    return row === undefined ? undefined : decodeProjectRun(projectRunRowSchema.parse(row))
  }

  /**
   * List project runs in start order.
   * @param projectId - owning project.
   * @returns durable project runs.
   */
  listProjectRuns(projectId: string): ProjectRunRecord[] {
    const rows = projectRunRowSchema.array().parse(this.database.prepare(`
      SELECT
        id, project_id, status, owner_id, fencing_token, workspace_path,
        preview_path, started_at, completed_at, error_json
      FROM project_runs
      WHERE project_id = ?
      ORDER BY started_at, rowid
    `).all(projectId))
    return rows.map(decodeProjectRun)
  }

  /**
   * Derive historical Agent success rates from completed executions.
   * @param projectId - owning project.
   * @returns success rate by Agent id; unknown Agents are absent.
   */
  historicalSuccessRates(projectId: ProjectId): Readonly<Record<string, number>> {
    const rows = this.database.prepare(`
      SELECT agent_id, status, COUNT(*) AS count
      FROM executions
      WHERE project_id = ? AND status IN ('COMPLETED', 'FAILED', 'CANCELLED')
      GROUP BY agent_id, status
    `).all(projectId) as { agent_id: string; status: string; count: number }[]
    const totals = new Map<string, { success: number; total: number }>()
    for (const row of rows) {
      const value = totals.get(row.agent_id) ?? { success: 0, total: 0 }
      value.total += row.count
      if (row.status === 'COMPLETED') value.success += row.count
      totals.set(row.agent_id, value)
    }
    return Object.fromEntries([...totals].map(([agentId, value]) => [
      agentId,
      value.total === 0 ? 0 : value.success / value.total,
    ]))
  }

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
    projectId: ProjectId,
    status: VerificationStatus,
    report: JsonValue,
    taskId?: TaskId,
    failureSignature?: string,
    write?: WorkflowWriteContext,
  ): VerificationReport {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const id = VerificationReportId(`verification-${this.createId()}`)
      const createdAt = this.timestamp()
      this.database.prepare(`
        INSERT INTO verification_reports (
          id, project_id, task_id, status, failure_signature, report_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        projectId,
        taskId ?? null,
        status,
        failureSignature ?? null,
        JSON.stringify(report),
        createdAt,
      )
      const type = status === 'PASS'
        ? 'verification.passed'
        : status === 'INCOMPLETE'
          ? 'verification.incomplete'
          : 'verification.failed'
      this.appendProductEventInTransaction({
        projectId,
        type,
        ...taskId === undefined ? {} : { taskId },
        payload: jsonValueSchema.parse(JSON.parse(JSON.stringify({
          verificationReportId: id,
          status,
          failureSignature,
        }))),
      })
      return { id, projectId, taskId, status, failureSignature, report, createdAt }
    })
  }

  /**
   * List verification reports in insertion order.
   * @param projectId - owning project.
   * @returns decoded reports.
   */
  listVerificationReports(projectId: ProjectId): VerificationReport[] {
    const rows = verificationRowSchema.array().parse(this.database.prepare(`
      SELECT id, project_id, task_id, status, failure_signature, report_json, created_at
      FROM verification_reports
      WHERE project_id = ?
      ORDER BY rowid
    `).all(projectId))
    return rows.map(row => ({
      id: VerificationReportId(row.id),
      projectId: ProjectId(row.project_id),
      taskId: row.task_id === null ? undefined : TaskId(row.task_id),
      status: decodeVerificationStatus(row.status),
      failureSignature: row.failure_signature ?? undefined,
      report: jsonValueSchema.parse(JSON.parse(row.report_json)),
      createdAt: row.created_at,
    }))
  }

  /**
   * Start the one durable M3 workflow state for a project.
   * @param projectId - owning project.
   * @returns the initial running workflow record.
   */
  startWorkflowRun(
    projectId: ProjectId,
    write?: WorkflowWriteContext,
  ): WorkflowRunRecord {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const id = WorkflowRunId(`workflow-${this.createId()}`)
      const createdAt = this.timestamp()
      this.database.prepare(`
        INSERT INTO workflow_runs (
          id, project_id, status, repair_round, escalation_reason, escalation_message, created_at, updated_at
        ) VALUES (?, ?, 'RUNNING', 0, NULL, NULL, ?, ?)
      `).run(id, projectId, createdAt, createdAt)
      return {
        id,
        projectId,
        status: 'RUNNING',
        repairRound: 0,
        createdAt,
        updatedAt: createdAt,
      }
    })
  }

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
    projectId: ProjectId,
    status: WorkflowStatus,
    repairRound: number,
    escalationReason?: WorkflowRunRecord['escalationReason'],
    escalationMessage?: string,
    write?: WorkflowWriteContext,
  ): WorkflowRunRecord {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const updatedAt = this.timestamp()
      const result = this.database.prepare(`
        UPDATE workflow_runs
        SET status = ?, repair_round = ?, escalation_reason = ?, escalation_message = ?, updated_at = ?
        WHERE project_id = ?
      `).run(
        status,
        repairRound,
        escalationReason ?? null,
        escalationMessage ?? null,
        updatedAt,
        projectId,
      )
      if (result.changes !== 1) throw new Error(`cannot update missing workflow for project "${projectId}"`)
      const workflow = this.getWorkflowRun(projectId)
      if (workflow === undefined) throw new Error(`workflow for project "${projectId}" disappeared after update`)
      if (status === 'ESCALATED') {
        this.appendProductEventInTransaction({
          projectId,
          type: 'workflow.escalated',
          payload: jsonValueSchema.parse(JSON.parse(JSON.stringify(workflow))),
        })
      }
      return workflow
    })
  }

  /**
   * Read one project's workflow state.
   * @param projectId - owning project.
   * @returns the workflow record when it exists.
   */
  getWorkflowRun(projectId: ProjectId): WorkflowRunRecord | undefined {
    const raw = this.database.prepare(`
      SELECT id, project_id, status, repair_round, escalation_reason, escalation_message, created_at, updated_at
      FROM workflow_runs
      WHERE project_id = ?
    `).get(projectId)
    return raw === undefined ? undefined : decodeWorkflowRun(workflowRowSchema.parse(raw))
  }

  /**
   * Persist one completed repair attempt with its real code diff.
   * @param projectId - owning project.
   * @param draft - completion evidence from the self-loop.
   * @returns the durable repair record.
   */
  saveRepairRecord(
    projectId: ProjectId,
    draft: RepairRecordDraft,
    write?: WorkflowWriteContext,
  ): RepairRecord {
    return this.transaction(() => {
      this.assertWorkflowWriteFence(write)
      const record: RepairRecord = {
        id: RepairRecordId(`repair-${this.createId()}`),
        projectId,
        ...draft,
      }
      this.database.prepare(`
        INSERT INTO repair_records (
          id, project_id, repair_round, verification_report_id, repair_agent_id,
          failure_signature, error_summary, change_summary, diff,
          before_status, after_status, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.id,
        record.projectId,
        record.repairRound,
        record.verificationReportId,
        record.repairAgentId,
        record.failureSignature,
        record.errorSummary,
        record.changeSummary,
        record.diff,
        record.beforeStatus,
        record.afterStatus,
        record.startedAt,
        record.completedAt,
      )
      this.appendProductEventInTransaction({
        projectId,
        type: 'repair.completed',
        agentId: record.repairAgentId,
        payload: jsonValueSchema.parse(JSON.parse(JSON.stringify(record))),
      })
      return record
    })
  }

  /**
   * List repair attempts in round order.
   * @param projectId - owning project.
   * @returns validated repair records.
   */
  listRepairRecords(projectId: ProjectId): RepairRecord[] {
    const rows = repairRowSchema.array().parse(this.database.prepare(`
      SELECT
        id, project_id, repair_round, verification_report_id, repair_agent_id,
        failure_signature, error_summary, change_summary, diff,
        before_status, after_status, started_at, completed_at
      FROM repair_records
      WHERE project_id = ?
      ORDER BY repair_round
    `).all(projectId))
    return rows.map(row => ({
      id: RepairRecordId(row.id),
      projectId: ProjectId(row.project_id),
      repairRound: row.repair_round,
      verificationReportId: VerificationReportId(row.verification_report_id),
      repairAgentId: AgentId(row.repair_agent_id),
      failureSignature: row.failure_signature,
      errorSummary: row.error_summary,
      changeSummary: row.change_summary,
      diff: row.diff,
      beforeStatus: decodeVerificationStatus(row.before_status),
      afterStatus: decodeVerificationStatus(row.after_status),
      startedAt: row.started_at,
      completedAt: row.completed_at,
    }))
  }

  /** Close the SQLite connection. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  private updateTaskRevision(task: TaskSnapshot): void {
    const result = this.database.prepare(`
      UPDATE tasks
      SET snapshot_json = ?, revision = ?, status = ?
      WHERE project_id = ? AND id = ? AND revision = ?
    `).run(
      JSON.stringify(task),
      task.revision,
      task.status,
      task.projectId,
      task.id,
      task.revision - 1,
    )
    if (result.changes !== 1) {
      throw new Error(`cannot update missing or stale task "${task.id}" in project "${task.projectId}"`)
    }
  }

  private appendTaskJournalAndProductEvent(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    reason?: string,
  ): void {
    this.appendTaskJournal(task, eventType, reason)
    const productType = taskProductEventType(eventType, task)
    if (productType === undefined) return
    this.appendProductEventInTransaction({
      projectId: task.projectId,
      type: productType,
      taskId: task.id,
      ...task.assignedAgentId === undefined ? {} : { agentId: task.assignedAgentId },
      payload: taskProductEventPayload(task),
    })
  }

  private appendExecutionProductEvent(execution: ExecutionRecord): void {
    this.appendProductEventInTransaction({
      projectId: execution.projectId,
      type: executionProductEventType(terminalExecutionStatus(execution.status)),
      taskId: execution.taskId,
      agentId: execution.agentId,
      payload: executionProductEventPayload(execution),
    })
  }

  private appendTaskJournal(task: TaskSnapshot, eventType: TaskJournalEventType, reason?: string): void {
    this.database.prepare(`
      INSERT INTO task_journal (
        project_id, task_id, revision, event_type, reason, snapshot_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.projectId,
      task.id,
      task.revision,
      eventType,
      reason ?? null,
      JSON.stringify(task),
      task.updatedAt,
    )
  }

  private appendProductEventInTransaction(draft: ProductEventDraft): ProductEvent {
    const cursor = this.database.prepare(`
      UPDATE projects
      SET last_event_seq = last_event_seq + 1
      WHERE id = ?
      RETURNING last_event_seq
    `).get(draft.projectId) as { last_event_seq: number } | undefined
    if (cursor === undefined) throw new Error(`cannot append event for missing project "${draft.projectId}"`)
    const event = productEventSchema.parse({
      type: draft.type,
      projectId: draft.projectId,
      seq: cursor.last_event_seq,
      occurredAt: draft.occurredAt ?? this.timestamp(),
      ...draft.taskId === undefined ? {} : { taskId: draft.taskId },
      ...draft.agentId === undefined ? {} : { agentId: draft.agentId },
      payload: draft.payload,
    })
    const id = `event-${this.createId()}`
    this.database.prepare(`
      INSERT INTO product_events (
        id, project_id, seq, type, task_id, agent_id, payload_json, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      event.projectId,
      event.seq,
      event.type,
      event.taskId ?? null,
      event.agentId ?? null,
      JSON.stringify(event.payload),
      event.occurredAt,
    )
    this.database.prepare(
      'INSERT INTO outbox_events (event_id, published_at) VALUES (?, NULL)',
    ).run(id)
    return event
  }

  private assertWorkflowWriteFence(write: WorkflowWriteContext | undefined): void {
    if (write === undefined) return
    const raw = this.database.prepare(`
      SELECT resource_id, project_id, owner_id, fencing_token, heartbeat_at, expires_at
      FROM workflow_leases
      WHERE resource_id = ?
    `).get(write.resourceId)
    if (raw === undefined) throw new WorkflowFenceError(write.resourceId)
    const lease = workflowLeaseRowSchema.parse(raw)
    if (lease.owner_id !== write.ownerId
      || BigInt(lease.fencing_token) !== write.fencingToken
      || Date.parse(lease.expires_at) <= this.now().getTime()) {
      throw new WorkflowFenceError(write.resourceId)
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.database.exec('COMMIT')
      return value
    } catch (error: unknown) {
      try {
        this.database.exec('ROLLBACK')
      } catch (rollbackError: unknown) {
        throw new AggregateError([error, rollbackError], 'orchestration transaction and rollback both failed')
      }
      throw error
    }
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

/** Decode and brand one durable task snapshot. */
function decodeTask(value: unknown): TaskSnapshot {
  const parsed = taskSnapshotSchema.parse(value)
  const { assignedAgentId, ...task } = parsed
  return {
    ...task,
    id: TaskId(parsed.id),
    projectId: ProjectId(parsed.projectId),
    dependencies: parsed.dependencies.map(TaskId),
    excludedAgentIds: parsed.excludedAgentIds.map(AgentId),
    ...assignedAgentId === undefined
      ? {}
      : { assignedAgentId: AgentId(assignedAgentId) },
  }
}

/** Decode one execution row with branded identities and structured failure. */
function decodeExecutionRow(row: z.infer<typeof executionRowSchema>): ExecutionRecord {
  return {
    id: ExecutionId(row.id),
    projectId: ProjectId(row.project_id),
    taskId: TaskId(row.task_id),
    agentId: AgentId(row.agent_id),
    sessionId: row.session_id ?? undefined,
    status: decodeExecutionStatus(row.status),
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error_json === null ? undefined : taskFailureSchema.parse(JSON.parse(row.error_json)),
  }
}

/** Decode one journal row. */
function decodeJournal(row: z.infer<typeof journalRowSchema>): TaskJournalEntry {
  const parsed = taskJournalEntrySchema.parse({
    seq: row.seq,
    projectId: row.project_id,
    taskId: row.task_id,
    revision: row.revision,
    eventType: row.event_type,
    ...row.reason === null ? {} : { reason: row.reason },
    snapshot: jsonValueSchema.parse(JSON.parse(row.snapshot_json)),
    createdAt: row.created_at,
  })
  return {
    ...parsed,
    projectId: ProjectId(parsed.projectId),
    taskId: TaskId(parsed.taskId),
    snapshot: decodeTask(parsed.snapshot),
  }
}

/** Decode and brand one persisted scheduler decision. */
function decodeSchedulerDecision(value: unknown): SchedulerDecision {
  const parsed = schedulerDecisionSchema.parse(value)
  const { previousAgentId, ...decision } = parsed
  return {
    ...decision,
    projectId: ProjectId(parsed.projectId),
    taskId: TaskId(parsed.taskId),
    selectedAgentId: AgentId(parsed.selectedAgentId),
    candidates: parsed.candidates.map(candidate => ({
      ...candidate,
      agentId: AgentId(candidate.agentId),
    })),
    ...previousAgentId === undefined
      ? {}
      : { previousAgentId: AgentId(previousAgentId) },
  }
}

/** Decode one durable product event row. */
function decodeProductEvent(row: z.infer<typeof productEventRowSchema>): ProductEvent {
  return productEventSchema.parse({
    type: row.type,
    projectId: row.project_id,
    seq: row.seq,
    occurredAt: row.occurred_at,
    ...row.task_id === null ? {} : { taskId: row.task_id },
    ...row.agent_id === null ? {} : { agentId: row.agent_id },
    payload: jsonValueSchema.parse(JSON.parse(row.payload_json)),
  })
}

/** Validate a lease duration before touching durable rows. */
function assertLeaseDuration(leaseDurationMs: number): void {
  assertPositiveSafeInteger(leaseDurationMs, 'leaseDurationMs')
}

/** Validate one Outbox claim lease before touching durable rows. */
function assertClaimDuration(claimDurationMs: number): void {
  assertPositiveSafeInteger(claimDurationMs, 'claimDurationMs')
}

/** Decode a persisted execution status. */
function decodeExecutionStatus(value: string): ExecutionStatus {
  switch (value) {
    case 'RUNNING':
    case 'COMPLETED':
    case 'FAILED':
    case 'CANCELLED':
      return value
    default:
      throw new Error(`unknown execution status "${value}"`)
  }
}

function terminalExecutionStatus(
  status: ExecutionStatus,
): Exclude<ExecutionStatus, 'RUNNING'> {
  if (status === 'RUNNING') throw new Error('running execution has no terminal product event')
  return status
}

/** Decode a persisted verification status. */
function decodeVerificationStatus(value: string): VerificationStatus {
  return verificationStatusSchema.parse(value)
}

/** Decode one workflow row with stable terminal-state validation. */
function decodeWorkflowRun(row: z.infer<typeof workflowRowSchema>): WorkflowRunRecord {
  return {
    id: WorkflowRunId(row.id),
    projectId: ProjectId(row.project_id),
    status: decodeWorkflowStatus(row.status),
    repairRound: row.repair_round,
    escalationReason: row.escalation_reason === null
      ? undefined
      : decodeEscalationReason(row.escalation_reason),
    escalationMessage: row.escalation_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/** Decode one project-run row with branded identities and structured failure. */
function decodeProjectRun(row: z.infer<typeof projectRunRowSchema>): ProjectRunRecord {
  return {
    id: ProjectRunId(row.id),
    projectId: ProjectId(row.project_id),
    status: decodeProjectRunStatus(row.status),
    ownerId: row.owner_id,
    fencingToken: BigInt(row.fencing_token),
    workspacePath: row.workspace_path,
    previewPath: row.preview_path ?? undefined,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    error: row.error_json === null
      ? undefined
      : taskFailureSchema.parse(JSON.parse(row.error_json)),
  }
}

/** Decode one durable project-run status. */
function decodeProjectRunStatus(value: string): ProjectRunStatus {
  switch (value) {
    case 'RUNNING':
    case 'PASSED':
    case 'FAILED':
    case 'CANCELLED':
    case 'ESCALATED':
      return value
    default:
      throw new Error(`unknown project run status "${value}"`)
  }
}

/** Decode one durable workflow status. */
function decodeWorkflowStatus(value: string): WorkflowStatus {
  switch (value) {
    case 'RUNNING':
    case 'PASSED':
    case 'ESCALATED':
      return value
    default:
      throw new Error(`unknown workflow status "${value}"`)
  }
}

/** Decode one durable escalation reason. */
function decodeEscalationReason(value: string): NonNullable<WorkflowRunRecord['escalationReason']> {
  switch (value) {
    case 'MAX_REPAIR_ROUNDS':
    case 'REPEATED_FAILURE':
    case 'REPAIR_TIMEOUT':
    case 'REPAIR_FAILED':
    case 'VERIFIER_INCOMPLETE':
      return value
    default:
      throw new Error(`unknown escalation reason "${value}"`)
  }
}
