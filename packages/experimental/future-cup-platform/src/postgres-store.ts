/** Prisma-managed PostgreSQL implementation of the Future Cup platform store. */

import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  AgentId,
  ExecutionId,
  ProjectId,
  ProjectRunId,
  RepairRecordId,
  TaskId,
  VerificationReportId,
  WorkflowRunId,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type {
  LeaseAcquisition,
  OrchestrationStore,
  OutboxClaim,
  PlatformProjectSnapshot,
  PlatformProjectSummary,
  ProductEvent,
  ProductEventDraft,
  ProjectRecord,
  ProjectRunRecord,
  ProjectRunStatus,
  ExecutionEventRecord,
  ExecutionRecord,
  ExecutionStatus,
  JsonValue,
  RepairRecordDraft,
  RepairRecord,
  SchedulerDecision,
  TaskFailure,
  TaskJournalEntry,
  TaskJournalEventType,
  TaskSnapshot,
  VerificationReport,
  VerificationStatus,
  WorkflowRunRecord,
  WorkflowLeaseState,
  WorkflowStatus,
  WorkflowWriteContext,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import {
  assertPositiveSafeInteger,
  executionProductEventPayload,
  executionProductEventType,
  jsonValueSchema,
  productEventSchema,
  schedulerDecisionSchema,
  taskFailureSchema,
  taskJournalEntrySchema,
  taskProductEventPayload,
  taskProductEventType,
  taskSnapshotSchema,
  verificationStatusSchema,
  WorkflowFenceError,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import { Prisma, PrismaClient } from './generated/client/client.ts'

interface OutboxRawRow {
  readonly id: string
  readonly projectId: string
  readonly seq: number
  readonly type: string
  readonly taskId: string | null
  readonly agentId: string | null
  readonly payloadJson: Prisma.JsonValue
  readonly occurredAt: Date
}

/**
 * PostgreSQL platform storage over a Prisma schema and migration history.
 * Call {@link close} after the owning server finishes.
 */
export class PostgresPlatformStore implements OrchestrationStore {
  private readonly prisma: PrismaClient
  private closed = false

  /** @param connectionString - PostgreSQL connection URL. */
  constructor(connectionString: string) {
    this.prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    })
  }

  /** {@inheritDoc PlatformStore.createProject} */
  async createProject(
    project: ProjectRecord,
    tasks: readonly TaskSnapshot[],
    write?: WorkflowWriteContext,
  ): Promise<void> {
    await retrySerializable(async () => {
      await this.prisma.$transaction(async (tx) => {
        await assertWorkflowWriteFence(tx, write)
        const existing = await tx.project.findUnique({ where: { id: project.id } })
        if (existing === null) {
          await tx.project.create({
            data: {
              id: project.id,
              name: project.name,
              requirement: project.requirement,
              createdAt: new Date(project.createdAt),
            },
          })
        } else if (existing.name !== project.name || existing.requirement !== project.requirement) {
          throw new Error(`project "${project.id}" already exists with a different name or requirement`)
        }
        const taskCount = await tx.task.count({ where: { projectId: project.id } })
        if (tasks.length > 0 && taskCount > 0) {
          throw new Error(`project "${project.id}" already has tasks`)
        }
        for (const [position, task] of tasks.entries()) {
          await tx.task.create({
            data: {
              projectId: task.projectId,
              id: task.id,
              title: task.title,
              description: task.description,
              role: task.role,
              priority: task.priority,
              requiredCapabilities: json(task.requiredCapabilities),
              writeScopes: json(task.writeScopes),
              pageId: task.pageId ?? null,
              snapshotJson: json(task),
              revision: task.revision,
              status: task.status,
              retryCount: task.retryCount,
              assignedAgentId: task.assignedAgentId ?? null,
              position,
              createdAt: new Date(task.createdAt),
              updatedAt: new Date(task.updatedAt),
            },
          })
        }
        for (const task of tasks) {
          for (const dependency of task.dependencies) {
            await tx.taskDependency.create({
              data: {
                projectId: task.projectId,
                taskId: task.id,
                dependsOnTaskId: dependency,
              },
            })
          }
          await tx.taskJournal.create({
            data: {
              projectId: task.projectId,
              taskId: task.id,
              revision: task.revision,
              eventType: 'task/created',
              snapshotJson: json(task),
              createdAt: new Date(task.createdAt),
            },
          })
          await appendProductEventInTransaction(tx, {
            projectId: task.projectId,
            type: 'task.created',
            taskId: task.id,
            payload: taskProductEventPayload(task),
          })
        }
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 10_000,
      })
    })
  }

  /** {@inheritDoc PlatformStore.getProject} */
  async getProject(id: ProjectRecord['id']): Promise<ProjectRecord | undefined> {
    const row = await this.prisma.project.findUnique({ where: { id } })
    return row === null ? undefined : projectRecord(row)
  }

  /** {@inheritDoc PlatformStore.listProjects} */
  async listProjects(): Promise<PlatformProjectSummary[]> {
    const rows = await this.prisma.project.findMany({
      include: {
        workflow: true,
        runs: { orderBy: { startedAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((row) => {
      const latestRun = row.runs[0]
      return {
        ...projectRecord(row),
        lastEventSeq: row.lastEventSeq,
        workflowStatus: row.workflow?.status as WorkflowStatus | undefined,
        latestRunId: latestRun === undefined ? undefined : ProjectRunId(latestRun.id),
        latestRunStatus: latestRun === undefined
          ? undefined
          : decodeProjectRunStatus(latestRun.status),
      }
    })
  }

  /** {@inheritDoc PlatformStore.getProjectSnapshot} */
  async getProjectSnapshot(
    projectId: string,
    afterSeq: number,
    limit: number,
  ): Promise<PlatformProjectSnapshot | undefined> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { workflow: true },
    })
    if (project === null) return undefined
    const [tasks, decisions, executions, verificationReports, repairs, runs, events] = await Promise.all([
      this.prisma.task.findMany({
        where: { projectId },
        orderBy: { position: 'asc' },
      }),
      this.prisma.schedulerDecision.findMany({ where: { projectId }, orderBy: { seq: 'asc' } }),
      this.prisma.execution.findMany({ where: { projectId }, orderBy: { startedAt: 'asc' } }),
      this.prisma.verificationReport.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.repairRecord.findMany({ where: { projectId }, orderBy: { repairRound: 'asc' } }),
      this.prisma.projectRun.findMany({
        where: { projectId },
        orderBy: { startedAt: 'asc' },
      }),
      this.prisma.productEvent.findMany({
        where: { projectId, seq: { gt: afterSeq } },
        orderBy: { seq: 'asc' },
        take: limit,
      }),
    ])
    return {
      project: {
        ...projectRecord(project),
        lastEventSeq: project.lastEventSeq,
        workflowStatus: project.workflow?.status as WorkflowStatus | undefined,
      },
      tasks: tasks.map(row => decodeTask(row.snapshotJson)),
      decisions: decisions.map(row => decodeDecision(row.decisionJson)),
      executions: executions.map(row => decodeExecutionRow(row)),
      verificationReports: verificationReports.map(row => decodeVerificationRow(row)),
      repairs: repairs.map(row => decodeRepairRow(row)),
      workflow: project.workflow === null ? undefined : decodeWorkflowRow(project.workflow),
      runs: runs.map(row => decodeProjectRunRow(row)),
      events: events.map(decodeProductEventRow),
      lastEventSeq: project.lastEventSeq,
    }
  }

  /** {@inheritDoc PlatformStore.appendProductEvent} */
  async appendProductEvent(
    draft: ProductEventDraft,
    write?: WorkflowWriteContext,
  ): Promise<ProductEvent> {
    return await retrySerializable(async () => await this.prisma.$transaction(
      async (tx) => {
        await assertWorkflowWriteFence(tx, write)
        return await appendProductEventInTransaction(tx, draft)
      },
      {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 10_000,
      },
    ))
  }

  /** {@inheritDoc PlatformStore.listProductEvents} */
  async listProductEvents(projectId: string, afterSeq: number, limit: number): Promise<ProductEvent[]> {
    const rows = await this.prisma.productEvent.findMany({
      where: { projectId, seq: { gt: afterSeq } },
      orderBy: { seq: 'asc' },
      take: limit,
    })
    return rows.map(decodeProductEventRow)
  }

  /** {@inheritDoc PlatformStore.claimOutbox} */
  async claimOutbox(ownerId: string, limit: number, claimDurationMs: number): Promise<OutboxClaim[]> {
    assertClaimDuration(claimDurationMs)
    if (!Number.isSafeInteger(limit) || limit <= 0) {
      throw new Error('outbox limit must be a positive safe integer')
    }
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      const now = new Date()
      const rows = await tx.$queryRaw<OutboxRawRow[]>`
        SELECT
          e."id",
          e."project_id" AS "projectId",
          e."seq",
          e."type",
          e."task_id" AS "taskId",
          e."agent_id" AS "agentId",
          e."payload_json" AS "payloadJson",
          e."occurred_at" AS "occurredAt"
        FROM "outbox_events" o
        JOIN "product_events" e ON e."id" = o."event_id"
        WHERE o."published_at" IS NULL
          AND (o."claim_expires_at" IS NULL OR o."claim_expires_at" <= now())
        ORDER BY e."created_at", e."seq"
        FOR UPDATE OF o SKIP LOCKED
        LIMIT ${limit}
      `
      const expiresAt = new Date(now.getTime() + claimDurationMs)
      const claims: OutboxClaim[] = []
      for (const row of rows) {
        const claimToken = randomUUID()
        await tx.outboxEvent.update({
          where: { eventId: row.id },
          data: {
            claimOwnerId: ownerId,
            claimToken,
            claimedAt: now,
            claimExpiresAt: expiresAt,
          },
        })
        claims.push({
          eventId: row.id,
          event: decodeProductEventRow({
            type: row.type,
            projectId: row.projectId,
            seq: row.seq,
            taskId: row.taskId,
            agentId: row.agentId,
            payloadJson: row.payloadJson,
            occurredAt: row.occurredAt,
          }),
          claimToken,
          expiresAt: expiresAt.toISOString(),
        })
      }
      return claims
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc PlatformStore.markOutboxPublished} */
  async markOutboxPublished(ownerId: string, eventIds: readonly string[]): Promise<void> {
    if (eventIds.length === 0) return
    await this.prisma.outboxEvent.updateMany({
      where: {
        eventId: { in: [...eventIds] },
        publishedAt: null,
        claimOwnerId: ownerId,
      },
      data: {
        publishedAt: new Date(),
        claimOwnerId: null,
        claimToken: null,
        claimedAt: null,
        claimExpiresAt: null,
      },
    })
  }

  /** {@inheritDoc PlatformStore.acquireWorkflowLease} */
  async acquireWorkflowLease(
    resourceId: string,
    projectId: string,
    ownerId: string,
    leaseDurationMs: number,
  ): Promise<LeaseAcquisition> {
    assertLeaseDuration(leaseDurationMs)
    const rows = await this.prisma.$queryRaw<Array<{
      ownerId: string
      fencingToken: bigint
      expiresAt: Date
    }>>`
      INSERT INTO "workflow_leases" (
        "resource_id", "project_id", "owner_id", "fencing_token", "heartbeat_at", "expires_at"
      ) VALUES (
        ${resourceId}, ${projectId}, ${ownerId}, 1, now(),
        now() + (${leaseDurationMs} * interval '1 millisecond')
      )
      ON CONFLICT ("resource_id") DO UPDATE SET
        "owner_id" = EXCLUDED."owner_id",
        "fencing_token" = "workflow_leases"."fencing_token" + 1,
        "heartbeat_at" = now(),
        "expires_at" = EXCLUDED."expires_at"
      WHERE "workflow_leases"."owner_id" IS NULL
         OR "workflow_leases"."expires_at" <= now()
      RETURNING "owner_id" AS "ownerId", "fencing_token" AS "fencingToken", "expires_at" AS "expiresAt"
    `
    const acquired = rows[0]
    if (acquired !== undefined) {
      return {
        acquired: true,
        ownerId: acquired.ownerId,
        fencingToken: acquired.fencingToken,
        expiresAt: acquired.expiresAt.toISOString(),
      }
    }
    const current = await this.prisma.workflowLease.findUnique({ where: { resourceId } })
    if (current === null) return { acquired: false }
    return {
      acquired: false,
      ownerId: current.ownerId ?? undefined,
      fencingToken: current.fencingToken,
      expiresAt: current.expiresAt.toISOString(),
    }
  }

  /** {@inheritDoc PlatformStore.getWorkflowLease} */
  async getWorkflowLease(resourceId: string): Promise<WorkflowLeaseState | undefined> {
    const row = await this.prisma.workflowLease.findUnique({ where: { resourceId } })
    if (row === null) return undefined
    return {
      resourceId: row.resourceId,
      projectId: row.projectId,
      ownerId: row.ownerId ?? undefined,
      fencingToken: row.fencingToken,
      heartbeatAt: row.heartbeatAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }
  }

  /** {@inheritDoc PlatformStore.heartbeatWorkflowLease} */
  async heartbeatWorkflowLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
    leaseDurationMs: number,
  ): Promise<boolean> {
    assertLeaseDuration(leaseDurationMs)
    const rows = await this.prisma.$queryRaw<Array<{ resourceId: string }>>`
      UPDATE "workflow_leases"
      SET "heartbeat_at" = now(),
          "expires_at" = now() + (${leaseDurationMs} * interval '1 millisecond')
      WHERE "resource_id" = ${resourceId}
        AND "owner_id" = ${ownerId}
        AND "fencing_token" = ${fencingToken}
        AND "expires_at" > now()
      RETURNING "resource_id" AS "resourceId"
    `
    return rows.length === 1
  }

  /** {@inheritDoc PlatformStore.releaseWorkflowLease} */
  async releaseWorkflowLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ resourceId: string }>>`
      UPDATE "workflow_leases"
      SET "owner_id" = NULL, "heartbeat_at" = now(), "expires_at" = now()
      WHERE "resource_id" = ${resourceId}
        AND "owner_id" = ${ownerId}
        AND "fencing_token" = ${fencingToken}
      RETURNING "resource_id" AS "resourceId"
    `
    return rows.length === 1
  }

  /** {@inheritDoc OrchestrationStore.saveTask} */
  async saveTask(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    reason?: string,
    write?: WorkflowWriteContext,
  ): Promise<void> {
    await this.withWorkflowTransaction(write, async (tx) => {
      await saveTaskInTransaction(tx, task, eventType, reason)
    })
  }

  /** {@inheritDoc OrchestrationStore.saveTaskAndFinishExecution} */
  async saveTaskAndFinishExecution(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    executionId: string,
    status: Exclude<ExecutionStatus, 'RUNNING'>,
    sessionId?: string,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): Promise<void> {
    await this.withWorkflowTransaction(write, async (tx) => {
      await saveTaskInTransaction(tx, task, eventType)
      const updatedExecution = await tx.execution.updateMany({
        where: {
          id: executionId,
          projectId: task.projectId,
          taskId: task.id,
          agentId: task.assignedAgentId ?? '',
          status: 'RUNNING',
        },
        data: {
          status,
          sessionId: sessionId ?? null,
          completedAt: new Date(),
          errorJson: error === undefined ? Prisma.DbNull : json(error),
        },
      })
      if (updatedExecution.count !== 1) {
        throw new Error(`cannot settle missing or mismatched execution "${executionId}"`)
      }
      const row = await tx.execution.findUnique({ where: { id: executionId } })
      if (row === null) throw new Error(`execution "${executionId}" disappeared after update`)
      const execution = decodeExecutionRow(row)
      await appendProductEventInTransaction(tx, {
        projectId: task.projectId,
        type: executionProductEventType(status),
        taskId: task.id,
        agentId: execution.agentId,
        payload: executionProductEventPayload(execution),
      })
    })
  }

  /** {@inheritDoc OrchestrationStore.listTasks} */
  async listTasks(projectId: string): Promise<TaskSnapshot[]> {
    const rows = await this.prisma.task.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
      select: { snapshotJson: true },
    })
    return rows.map(row => decodeTask(row.snapshotJson))
  }

  /** {@inheritDoc OrchestrationStore.listTaskJournal} */
  async listTaskJournal(projectId: string): Promise<TaskJournalEntry[]> {
    const rows = await this.prisma.taskJournal.findMany({
      where: { projectId },
      orderBy: { seq: 'asc' },
    })
    return rows.map((row) => {
      const parsed = taskJournalEntrySchema.parse({
        seq: Number(row.seq),
        projectId: row.projectId,
        taskId: row.taskId,
        revision: row.revision,
        eventType: row.eventType,
        reason: row.reason ?? undefined,
        snapshot: row.snapshotJson,
        createdAt: row.createdAt.toISOString(),
      })
      return {
        ...parsed,
        projectId: ProjectId(parsed.projectId),
        taskId: TaskId(parsed.taskId),
        snapshot: decodeTask(parsed.snapshot),
      }
    })
  }

  /** {@inheritDoc OrchestrationStore.saveSchedulerDecision} */
  async saveSchedulerDecision(
    decision: SchedulerDecision,
    write?: WorkflowWriteContext,
  ): Promise<void> {
    await retrySerializable(async () => {
      await this.prisma.$transaction(async (tx) => {
        await assertWorkflowWriteFence(tx, write)
        await tx.schedulerDecision.create({
          data: {
            id: decision.id,
            projectId: decision.projectId,
            taskId: decision.taskId,
            decisionJson: json(decision),
            createdAt: new Date(decision.createdAt),
          },
        })
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 10_000,
      })
    })
  }

  /** {@inheritDoc OrchestrationStore.listSchedulerDecisions} */
  async listSchedulerDecisions(projectId: string): Promise<SchedulerDecision[]> {
    const rows = await this.prisma.schedulerDecision.findMany({
      where: { projectId },
      orderBy: { seq: 'asc' },
      select: { decisionJson: true },
    })
    return rows.map(row => decodeDecision(row.decisionJson))
  }

  /** {@inheritDoc OrchestrationStore.startExecution} */
  async startExecution(
    projectId: string,
    taskId: string,
    agentId: string,
    write?: WorkflowWriteContext,
  ): Promise<ExecutionId> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      const id = ExecutionId(`execution-${randomUUID()}`)
      const startedAt = new Date()
      await tx.execution.create({
        data: {
          id,
          projectId,
          taskId,
          agentId,
          status: 'RUNNING',
          startedAt,
        },
      })
      const payload = {
        executionId: id,
        taskId,
        agentId,
        status: 'RUNNING',
        startedAt: startedAt.toISOString(),
      }
      await appendProductEventInTransaction(tx, {
        projectId,
        type: 'task.dispatched',
        taskId,
        agentId,
        payload,
      })
      await appendProductEventInTransaction(tx, {
        projectId,
        type: 'agent.started',
        taskId,
        agentId,
        payload,
      })
      return id
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc OrchestrationStore.finishExecution} */
  async finishExecution(
    id: string,
    status: Exclude<ExecutionStatus, 'RUNNING'>,
    sessionId?: string,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): Promise<void> {
    await this.withWorkflowTransaction(write, async (tx) => {
      const updated = await tx.execution.updateMany({
        where: { id, status: 'RUNNING' },
        data: {
          status,
          sessionId: sessionId ?? null,
          completedAt: new Date(),
          errorJson: error === undefined ? Prisma.DbNull : json(error),
        },
      })
      if (updated.count !== 1) throw new Error(`cannot finish missing or settled execution "${id}"`)
      const row = await tx.execution.findUnique({ where: { id } })
      if (row === null) throw new Error(`execution "${id}" disappeared after update`)
      const execution = decodeExecutionRow(row)
      await appendProductEventInTransaction(tx, {
        projectId: row.projectId,
        type: executionProductEventType(status),
        taskId: row.taskId,
        agentId: row.agentId,
        payload: executionProductEventPayload(execution),
      })
    })
  }

  /** {@inheritDoc OrchestrationStore.appendExecutionEvent} */
  async appendExecutionEvent(
    executionId: string,
    eventType: string,
    payload: JsonValue,
    write?: WorkflowWriteContext,
  ): Promise<void> {
    await retrySerializable(async () => {
      await this.prisma.$transaction(async (tx) => {
        await assertWorkflowWriteFence(tx, write)
        await tx.executionEvent.create({
          data: {
            executionId,
            eventType,
            payloadJson: json(payload),
            createdAt: new Date(),
          },
        })
        const row = await tx.execution.findUnique({ where: { id: executionId } })
        if (row === null) throw new Error(`cannot append event for missing execution "${executionId}"`)
        if (eventType === 'repair/started') {
          await appendProductEventInTransaction(tx, {
            projectId: row.projectId,
            type: 'repair.started',
            taskId: row.taskId,
            agentId: row.agentId,
            payload,
          })
        } else if (eventType === 'agent/session-events') {
          const eventTypes = jsonValueSchema.parse(payload)
          if (Array.isArray(eventTypes) && eventTypes.includes('tool/call')) {
            await appendProductEventInTransaction(tx, {
              projectId: row.projectId,
              type: 'agent.tool.called',
              taskId: row.taskId,
              agentId: row.agentId,
              payload,
            })
          }
        }
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5_000,
        timeout: 10_000,
      })
    })
  }

  /** {@inheritDoc OrchestrationStore.listExecutions} */
  async listExecutions(projectId: string): Promise<PlatformProjectSnapshot['executions'][number][]> {
    const rows = await this.prisma.execution.findMany({
      where: { projectId },
      orderBy: { startedAt: 'asc' },
    })
    return rows.map(row => decodeExecutionRow(row))
  }

  /** {@inheritDoc OrchestrationStore.listExecutionEvents} */
  async listExecutionEvents(executionId: string): Promise<ExecutionEventRecord[]> {
    const rows = await this.prisma.executionEvent.findMany({
      where: { executionId },
      orderBy: { seq: 'asc' },
    })
    return rows.map(row => ({
      seq: Number(row.seq),
      executionId: ExecutionId(row.executionId),
      eventType: row.eventType,
      payload: jsonValueSchema.parse(row.payloadJson),
      createdAt: row.createdAt.toISOString(),
    }))
  }

  /** {@inheritDoc PlatformStore.createProjectRun} */
  async createProjectRun(
    projectId: string,
    ownerId: string,
    fencingToken: bigint,
    workspacePath: string,
    write?: WorkflowWriteContext,
  ): Promise<ProjectRunRecord> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      const row = await tx.projectRun.create({
        data: {
          id: ProjectRunId(`run-${randomUUID()}`),
          projectId,
          status: 'RUNNING',
          ownerId,
          fencingToken,
          workspacePath,
          startedAt: new Date(),
        },
      })
      await appendProductEventInTransaction(tx, {
        projectId,
        type: 'run.started',
        payload: { runId: row.id, status: row.status },
      })
      return decodeProjectRunRow(row)
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc PlatformStore.finishProjectRun} */
  async finishProjectRun(
    runId: string,
    status: Exclude<ProjectRunStatus, 'RUNNING'>,
    previewPath?: string,
    error?: TaskFailure,
    write?: WorkflowWriteContext,
  ): Promise<ProjectRunRecord> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      const updated = await tx.projectRun.updateMany({
        where: { id: runId, status: 'RUNNING' },
        data: {
          status,
          ...previewPath === undefined ? {} : { previewPath },
          completedAt: new Date(),
          errorJson: error === undefined ? Prisma.DbNull : json(error),
        },
      })
      if (updated.count !== 1) {
        throw new Error(`cannot finish missing or settled project run "${runId}"`)
      }
      const row = await tx.projectRun.findUnique({ where: { id: runId } })
      if (row === null) throw new Error(`project run "${runId}" disappeared after update`)
      const type = status === 'CANCELLED'
        ? 'run.cancelled'
        : status === 'FAILED'
          ? 'run.failed'
          : 'run.completed'
      await appendProductEventInTransaction(tx, {
        projectId: row.projectId,
        type,
        payload: { runId: row.id, status: row.status },
      })
      return decodeProjectRunRow(row)
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc PlatformStore.getProjectRun} */
  async getProjectRun(runId: string): Promise<ProjectRunRecord | undefined> {
    const row = await this.prisma.projectRun.findUnique({ where: { id: runId } })
    return row === null ? undefined : decodeProjectRunRow(row)
  }

  /** {@inheritDoc PlatformStore.listProjectRuns} */
  async listProjectRuns(projectId: string): Promise<ProjectRunRecord[]> {
    const rows = await this.prisma.projectRun.findMany({
      where: { projectId },
      orderBy: { startedAt: 'asc' },
    })
    return rows.map(row => decodeProjectRunRow(row))
  }

  /** {@inheritDoc OrchestrationStore.historicalSuccessRates} */
  async historicalSuccessRates(projectId: string): Promise<Readonly<Record<string, number>>> {
    const rows = await this.prisma.execution.findMany({
      where: { projectId, status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] } },
      select: { agentId: true, status: true },
    })
    const totals = new Map<string, { success: number; total: number }>()
    for (const row of rows) {
      const value = totals.get(row.agentId) ?? { success: 0, total: 0 }
      value.total += 1
      if (row.status === 'COMPLETED') value.success += 1
      totals.set(row.agentId, value)
    }
    return Object.fromEntries([...totals].map(([agentId, value]) => [
      agentId,
      value.total === 0 ? 0 : value.success / value.total,
    ]))
  }

  /** {@inheritDoc OrchestrationStore.saveVerificationReport} */
  async saveVerificationReport(
    projectId: string,
    status: VerificationStatus,
    report: JsonValue,
    taskId?: string,
    failureSignature?: string,
    write?: WorkflowWriteContext,
  ): Promise<VerificationReport> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      const row = await tx.verificationReport.create({
        data: {
          id: VerificationReportId(`verification-${randomUUID()}`),
          projectId,
          taskId: taskId ?? null,
          status,
          failureSignature: failureSignature ?? null,
          reportJson: json(report),
          createdAt: new Date(),
        },
      })
      const type = status === 'PASS'
        ? 'verification.passed'
        : status === 'INCOMPLETE'
          ? 'verification.incomplete'
          : 'verification.failed'
      await appendProductEventInTransaction(tx, {
        projectId,
        type,
        ...taskId === undefined ? {} : { taskId },
        payload: jsonValueSchema.parse(json({
          verificationReportId: row.id,
          status,
          failureSignature,
        })),
      })
      return decodeVerificationRow(row)
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc OrchestrationStore.listVerificationReports} */
  async listVerificationReports(projectId: string): Promise<VerificationReport[]> {
    const rows = await this.prisma.verificationReport.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map(row => decodeVerificationRow(row))
  }

  /** {@inheritDoc OrchestrationStore.startWorkflowRun} */
  async startWorkflowRun(
    projectId: string,
    write?: WorkflowWriteContext,
  ): Promise<WorkflowRunRecord> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      const existing = await tx.workflowRun.findUnique({ where: { projectId } })
      if (existing !== null) {
        throw new Error(`workflow for project "${projectId}" already exists`)
      }
      const now = new Date()
      const row = await tx.workflowRun.create({
        data: {
          id: WorkflowRunId(`workflow-${randomUUID()}`),
          projectId,
          status: 'RUNNING',
          repairRound: 0,
          createdAt: now,
          updatedAt: now,
        },
      })
      return decodeWorkflowRow(row)
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc OrchestrationStore.updateWorkflowRun} */
  async updateWorkflowRun(
    projectId: string,
    status: WorkflowStatus,
    repairRound: number,
    escalationReason?: WorkflowRunRecord['escalationReason'],
    escalationMessage?: string,
    write?: WorkflowWriteContext,
  ): Promise<WorkflowRunRecord> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      const row = await tx.workflowRun.update({
        where: { projectId },
        data: {
          status,
          repairRound,
          escalationReason: escalationReason ?? null,
          escalationMessage: escalationMessage ?? null,
          updatedAt: new Date(),
        },
      })
      const workflow = decodeWorkflowRow(row)
      if (status === 'ESCALATED') {
        await appendProductEventInTransaction(tx, {
          projectId,
          type: 'workflow.escalated',
          payload: jsonValueSchema.parse(json(workflow)),
        })
      }
      return workflow
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc OrchestrationStore.getWorkflowRun} */
  async getWorkflowRun(projectId: string): Promise<WorkflowRunRecord | undefined> {
    const row = await this.prisma.workflowRun.findUnique({ where: { projectId } })
    return row === null ? undefined : decodeWorkflowRow(row)
  }

  /** {@inheritDoc OrchestrationStore.saveRepairRecord} */
  async saveRepairRecord(
    projectId: string,
    draft: RepairRecordDraft,
    write?: WorkflowWriteContext,
  ): Promise<RepairRecord> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      const row = await tx.repairRecord.create({
        data: {
          id: RepairRecordId(`repair-${randomUUID()}`),
          projectId,
          repairRound: draft.repairRound,
          verificationReportId: draft.verificationReportId,
          repairAgentId: draft.repairAgentId,
          failureSignature: draft.failureSignature,
          errorSummary: draft.errorSummary,
          changeSummary: draft.changeSummary,
          diff: draft.diff,
          beforeStatus: draft.beforeStatus,
          afterStatus: draft.afterStatus,
          startedAt: new Date(draft.startedAt),
          completedAt: new Date(draft.completedAt),
        },
      })
      const repair = decodeRepairRow(row)
      await appendProductEventInTransaction(tx, {
        projectId,
        type: 'repair.completed',
        agentId: repair.repairAgentId,
        payload: jsonValueSchema.parse(json(repair)),
      })
      return repair
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc OrchestrationStore.listRepairRecords} */
  async listRepairRecords(projectId: string): Promise<RepairRecord[]> {
    const rows = await this.prisma.repairRecord.findMany({
      where: { projectId },
      orderBy: { repairRound: 'asc' },
    })
    return rows.map(row => decodeRepairRow(row))
  }

  private async withWorkflowTransaction<T>(
    write: WorkflowWriteContext | undefined,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return await retrySerializable(async () => await this.prisma.$transaction(async (tx) => {
      await assertWorkflowWriteFence(tx, write)
      return await operation(tx)
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 10_000,
    }))
  }

  /** {@inheritDoc PlatformStore.close} */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.prisma.$disconnect()
  }
}

/** Persist one task revision, journal entry, and matching product event. */
async function saveTaskInTransaction(
  tx: Prisma.TransactionClient,
  task: TaskSnapshot,
  eventType: TaskJournalEventType,
  reason?: string,
): Promise<void> {
  const updated = await tx.task.updateMany({
    where: {
      projectId: task.projectId,
      id: task.id,
      revision: task.revision - 1,
    },
    data: {
      snapshotJson: json(task),
      revision: task.revision,
      status: task.status,
      retryCount: task.retryCount,
      assignedAgentId: task.assignedAgentId ?? null,
      updatedAt: new Date(task.updatedAt),
    },
  })
  if (updated.count !== 1) {
    throw new Error(`cannot update missing or stale task "${task.id}" in project "${task.projectId}"`)
  }
  await tx.taskJournal.create({
    data: {
      projectId: task.projectId,
      taskId: task.id,
      revision: task.revision,
      eventType,
      reason: reason ?? null,
      snapshotJson: json(task),
      createdAt: new Date(task.updatedAt),
    },
  })
  const productType = taskProductEventType(eventType, task)
  if (productType === undefined) return
  await appendProductEventInTransaction(tx, {
    projectId: task.projectId,
    type: productType,
    taskId: task.id,
    ...task.assignedAgentId === undefined ? {} : { agentId: task.assignedAgentId },
    payload: taskProductEventPayload(task),
  })
}

function projectRecord(row: {
  id: string
  name: string
  requirement: string
  createdAt: Date
}): ProjectRecord {
  return {
    id: ProjectId(row.id),
    name: row.name,
    requirement: row.requirement,
    createdAt: row.createdAt.toISOString(),
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  const normalized: unknown = JSON.parse(JSON.stringify(value))
  return jsonValueSchema.parse(normalized) as Prisma.InputJsonValue
}

function decodeTask(value: Prisma.JsonValue): TaskSnapshot {
  const parsed = taskSnapshotSchema.parse(value)
  return {
    ...parsed,
    id: TaskId(parsed.id),
    projectId: ProjectId(parsed.projectId),
    dependencies: parsed.dependencies.map(TaskId),
    excludedAgentIds: parsed.excludedAgentIds.map(AgentId),
    assignedAgentId: parsed.assignedAgentId === undefined ? undefined : AgentId(parsed.assignedAgentId),
  }
}

function decodeDecision(value: Prisma.JsonValue): SchedulerDecision {
  const parsed = schedulerDecisionSchema.parse(value)
  return {
    ...parsed,
    projectId: ProjectId(parsed.projectId),
    taskId: TaskId(parsed.taskId),
    selectedAgentId: AgentId(parsed.selectedAgentId),
    candidates: parsed.candidates.map(candidate => ({
      ...candidate,
      agentId: AgentId(candidate.agentId),
    })),
    previousAgentId: parsed.previousAgentId === undefined
      ? undefined
      : AgentId(parsed.previousAgentId),
  }
}

function decodeProductEventRow(row: {
  type: string
  projectId: string
  seq: number
  taskId: string | null
  agentId: string | null
  payloadJson: Prisma.JsonValue
  occurredAt: Date
}): ProductEvent {
  return productEventSchema.parse({
    type: row.type,
    projectId: row.projectId,
    seq: row.seq,
    taskId: row.taskId ?? undefined,
    agentId: row.agentId ?? undefined,
    payload: jsonValueSchema.parse(row.payloadJson),
    occurredAt: row.occurredAt.toISOString(),
  })
}

async function appendProductEventInTransaction(
  tx: Prisma.TransactionClient,
  draft: ProductEventDraft,
): Promise<ProductEvent> {
  const project = await tx.project.update({
    where: { id: draft.projectId },
    data: { lastEventSeq: { increment: 1 } },
    select: { lastEventSeq: true },
  })
  const event = productEventSchema.parse({
    type: draft.type,
    projectId: draft.projectId,
    seq: project.lastEventSeq,
    occurredAt: draft.occurredAt ?? new Date().toISOString(),
    ...draft.taskId === undefined ? {} : { taskId: draft.taskId },
    ...draft.agentId === undefined ? {} : { agentId: draft.agentId },
    payload: draft.payload,
  })
  const row = await tx.productEvent.create({
    data: {
      id: `event-${randomUUID()}`,
      projectId: event.projectId,
      seq: event.seq,
      type: event.type,
      taskId: event.taskId ?? null,
      agentId: event.agentId ?? null,
      payloadJson: json(event.payload),
      occurredAt: new Date(event.occurredAt),
    },
  })
  await tx.outboxEvent.create({ data: { eventId: row.id } })
  return event
}

async function assertWorkflowWriteFence(
  tx: Prisma.TransactionClient,
  write: WorkflowWriteContext | undefined,
): Promise<void> {
  if (write === undefined) return
  const lease = await tx.workflowLease.findUnique({ where: { resourceId: write.resourceId } })
  if (lease === null
    || lease.ownerId !== write.ownerId
    || lease.fencingToken !== write.fencingToken
    || lease.expiresAt.getTime() <= Date.now()) {
    throw new WorkflowFenceError(write.resourceId)
  }
}

function decodeProjectRunRow(row: {
  id: string
  projectId: string
  status: string
  ownerId: string
  fencingToken: bigint
  workspacePath: string
  previewPath: string | null
  startedAt: Date
  completedAt: Date | null
  errorJson: Prisma.JsonValue | null
}): ProjectRunRecord {
  return {
    id: ProjectRunId(row.id),
    projectId: ProjectId(row.projectId),
    status: decodeProjectRunStatus(row.status),
    ownerId: row.ownerId,
    fencingToken: row.fencingToken,
    workspacePath: row.workspacePath,
    previewPath: row.previewPath ?? undefined,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    error: row.errorJson === null ? undefined : taskFailureSchema.parse(row.errorJson),
  }
}

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

function decodeExecutionRow(row: {
  id: string
  projectId: string
  taskId: string
  agentId: string
  sessionId: string | null
  status: string
  startedAt: Date
  completedAt: Date | null
  errorJson: Prisma.JsonValue | null
}): ExecutionRecord {
  return {
    id: ExecutionId(row.id),
    projectId: ProjectId(row.projectId),
    taskId: TaskId(row.taskId),
    agentId: AgentId(row.agentId),
    sessionId: row.sessionId ?? undefined,
    status: decodeExecutionStatus(row.status),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString(),
    error: row.errorJson === null ? undefined : taskFailureSchema.parse(row.errorJson),
  }
}

function decodeVerificationRow(row: {
  id: string
  projectId: string
  taskId: string | null
  status: string
  failureSignature: string | null
  reportJson: Prisma.JsonValue
  createdAt: Date
}): VerificationReport {
  return {
    id: VerificationReportId(row.id),
    projectId: ProjectId(row.projectId),
    taskId: row.taskId === null ? undefined : TaskId(row.taskId),
    status: verificationStatusSchema.parse(row.status),
    failureSignature: row.failureSignature ?? undefined,
    report: jsonValueSchema.parse(row.reportJson),
    createdAt: row.createdAt.toISOString(),
  }
}

function decodeRepairRow(row: {
  id: string
  projectId: string
  repairRound: number
  verificationReportId: string
  repairAgentId: string
  failureSignature: string
  errorSummary: string
  changeSummary: string
  diff: string
  beforeStatus: string
  afterStatus: string
  startedAt: Date
  completedAt: Date
}): RepairRecord {
  return {
    id: RepairRecordId(row.id),
    projectId: ProjectId(row.projectId),
    repairRound: row.repairRound,
    verificationReportId: VerificationReportId(row.verificationReportId),
    repairAgentId: AgentId(row.repairAgentId),
    failureSignature: row.failureSignature,
    errorSummary: row.errorSummary,
    changeSummary: row.changeSummary,
    diff: row.diff,
    beforeStatus: verificationStatusSchema.parse(row.beforeStatus),
    afterStatus: verificationStatusSchema.parse(row.afterStatus),
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt.toISOString(),
  }
}

function decodeWorkflowRow(row: {
  id: string
  projectId: string
  status: string
  repairRound: number
  escalationReason: string | null
  escalationMessage: string | null
  createdAt: Date
  updatedAt: Date
}): WorkflowRunRecord {
  return {
    id: WorkflowRunId(row.id),
    projectId: ProjectId(row.projectId),
    status: decodeWorkflowStatus(row.status),
    repairRound: row.repairRound,
    escalationReason: decodeEscalationReason(row.escalationReason),
    escalationMessage: row.escalationMessage ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

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

function decodeEscalationReason(
  value: string | null,
): WorkflowRunRecord['escalationReason'] {
  switch (value) {
    case null:
      return undefined
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

function assertLeaseDuration(leaseDurationMs: number): void {
  assertPositiveSafeInteger(leaseDurationMs, 'leaseDurationMs')
}

/** Validate one Outbox claim lease before touching durable rows. */
function assertClaimDuration(claimDurationMs: number): void {
  assertPositiveSafeInteger(claimDurationMs, 'claimDurationMs')
}

async function retrySerializable<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await operation()
    } catch (error: unknown) {
      if (!hasErrorCode(error, 'P2034')) throw error
    }
  }
  throw new Error('serializable transaction retry exhausted')
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === code
}
