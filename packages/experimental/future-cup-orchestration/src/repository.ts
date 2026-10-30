/** SQLite-backed durable repository for Future Cup DAGs, scheduling, and execution evidence. */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import {
  AgentId,
  ExecutionId,
  ProjectId,
  TaskId,
  VerificationReportId,
} from './brand.ts'
import {
  jsonValueSchema,
  schedulerDecisionSchema,
  taskFailureSchema,
  taskJournalEntrySchema,
  taskSnapshotSchema,
} from './schemas.ts'
import { openOrchestrationDatabase, ORCHESTRATION_SCHEMA_VERSION } from './sqlite.ts'
import type {
  ExecutionEventRecord,
  ExecutionRecord,
  ExecutionStatus,
  JsonValue,
  ProjectRecord,
  SchedulerDecision,
  TaskFailure,
  TaskJournalEntry,
  TaskJournalEventType,
  TaskSnapshot,
  VerificationReport,
  VerificationStatus,
} from './types.ts'

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
  report_json: z.string(),
  created_at: z.string(),
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
export class OrchestrationRepository {
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
  createProject(project: ProjectRecord, tasks: readonly TaskSnapshot[]): void {
    this.transaction(() => {
      this.database.prepare(
        'INSERT INTO projects (id, name, requirement, created_at) VALUES (?, ?, ?, ?)',
      ).run(project.id, project.name, project.requirement, project.createdAt)
      const taskStatement = this.database.prepare(`
        INSERT INTO tasks (project_id, id, snapshot_json, revision, status)
        VALUES (?, ?, ?, ?, ?)
      `)
      const dependencyStatement = this.database.prepare(`
        INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id)
        VALUES (?, ?, ?)
      `)
      for (const task of tasks) {
        taskStatement.run(task.projectId, task.id, JSON.stringify(task), task.revision, task.status)
        for (const dependency of task.dependencies) {
          dependencyStatement.run(task.projectId, task.id, dependency)
        }
        this.appendTaskJournal(task, 'task/created')
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
      'SELECT id, name, requirement, created_at FROM projects WHERE id = ?',
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
   * Update one complete task snapshot and append its matching revision journal entry.
   * @param task - next task snapshot with revision already incremented.
   * @param eventType - mutation kind.
   * @param reason - optional scheduling or lifecycle explanation.
   */
  saveTask(task: TaskSnapshot, eventType: TaskJournalEventType, reason?: string): void {
    this.transaction(() => {
      const result = this.database.prepare(`
        UPDATE tasks
        SET snapshot_json = ?, revision = ?, status = ?
        WHERE project_id = ? AND id = ?
      `).run(JSON.stringify(task), task.revision, task.status, task.projectId, task.id)
      if (result.changes !== 1) {
        throw new Error(`cannot update missing task "${task.id}" in project "${task.projectId}"`)
      }
      this.appendTaskJournal(task, eventType, reason)
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
      ORDER BY rowid
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
  saveSchedulerDecision(decision: SchedulerDecision): void {
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
  startExecution(projectId: ProjectId, taskId: TaskId, agentId: AgentId): ExecutionId {
    const id = ExecutionId(`execution-${this.createId()}`)
    this.database.prepare(`
      INSERT INTO executions (
        id, project_id, task_id, agent_id, session_id, status, started_at, completed_at, error_json
      ) VALUES (?, ?, ?, ?, NULL, 'RUNNING', ?, NULL, NULL)
    `).run(id, projectId, taskId, agentId, this.timestamp())
    return id
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
  ): void {
    const result = this.database.prepare(`
      UPDATE executions
      SET status = ?, session_id = ?, completed_at = ?, error_json = ?
      WHERE id = ?
    `).run(
      status,
      sessionId ?? null,
      this.timestamp(),
      error === undefined ? null : JSON.stringify(error),
      id,
    )
    if (result.changes !== 1) throw new Error(`cannot finish missing execution "${id}"`)
  }

  /**
   * Append one execution event.
   * @param executionId - owning execution.
   * @param eventType - event discriminator.
   * @param payload - JSON audit value.
   */
  appendExecutionEvent(executionId: ExecutionId, eventType: string, payload: JsonValue): void {
    this.database.prepare(`
      INSERT INTO execution_events (execution_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(executionId, eventType, JSON.stringify(payload), this.timestamp())
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
    return rows.map(row => ({
      id: ExecutionId(row.id),
      projectId: ProjectId(row.project_id),
      taskId: TaskId(row.task_id),
      agentId: AgentId(row.agent_id),
      sessionId: row.session_id ?? undefined,
      status: decodeExecutionStatus(row.status),
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      error: row.error_json === null ? undefined : taskFailureSchema.parse(JSON.parse(row.error_json)),
    }))
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
   * @returns the durable report identity.
   */
  saveVerificationReport(
    projectId: ProjectId,
    status: VerificationStatus,
    report: JsonValue,
    taskId?: TaskId,
  ): VerificationReport {
    const id = VerificationReportId(`verification-${this.createId()}`)
    const createdAt = this.timestamp()
    this.database.prepare(`
      INSERT INTO verification_reports (id, project_id, task_id, status, report_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, projectId, taskId ?? null, status, JSON.stringify(report), createdAt)
    return { id, projectId, taskId, status, report, createdAt }
  }

  /**
   * List verification reports in insertion order.
   * @param projectId - owning project.
   * @returns decoded reports.
   */
  listVerificationReports(projectId: ProjectId): VerificationReport[] {
    const rows = verificationRowSchema.array().parse(this.database.prepare(`
      SELECT id, project_id, task_id, status, report_json, created_at
      FROM verification_reports
      WHERE project_id = ?
      ORDER BY rowid
    `).all(projectId))
    return rows.map(row => ({
      id: VerificationReportId(row.id),
      projectId: ProjectId(row.project_id),
      taskId: row.task_id === null ? undefined : TaskId(row.task_id),
      status: decodeVerificationStatus(row.status),
      report: jsonValueSchema.parse(JSON.parse(row.report_json)),
      createdAt: row.created_at,
    }))
  }

  /** Close the SQLite connection. Idempotent. */
  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
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

/** Decode a persisted verification status. */
function decodeVerificationStatus(value: string): VerificationStatus {
  switch (value) {
    case 'PASS':
    case 'FAIL':
    case 'WARNING':
    case 'INCOMPLETE':
      return value
    default:
      throw new Error(`unknown verification status "${value}"`)
  }
}
