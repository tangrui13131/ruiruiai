/** Real Harness-backed Future Cup project-run launcher with durable leases and runs. */

import { randomUUID } from 'node:crypto'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  assertPositiveSafeInteger,
  agentProfilesFromTeamBinding,
  createHarnessAgentTeam,
  DagEngine,
  defaultAgentProfiles,
  ProjectId,
  TeamOrchestrator,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type {
  AgentProfile,
  ExecutionEventRecord,
  ExecutionId,
  ExecutionRecord,
  ExecutionStatus,
  HarnessAgentOptions,
  JsonValue,
  LeaseAcquisition,
  OrchestrationStore,
  OutboxClaim,
  PlatformProjectSummary,
  ProjectMemoryEntry,
  ProjectRecord,
  ProjectRunRecord,
  ProjectRunStatus,
  ProjectTeamBinding,
  ProductEvent,
  ProductEventDraft,
  RepairRecord,
  RepairRecordDraft,
  RepairStrategyDecisionRecord,
  SchedulerDecision,
  SelfLoopConfig,
  StoredAgentDefinition,
  StoredAgentTeam,
  StoredAgentTeamVersion,
  StoredAgentVersion,
  StoredWorkflowDefinition,
  TaskFailure,
  TaskJournalEntry,
  TaskJournalEventType,
  TaskSnapshot,
  TeamRunResult,
  VerificationReport,
  VerificationStatus,
  VerificationConfig,
  WorkflowControlEventRecord,
  WorkflowControlJournalEntry,
  WorkflowControlSnapshot,
  WorkflowControlStateRecord,
  WorkflowLeaseState,
  WorkflowRunRecord,
  WorkflowStatus,
  WorkflowWriteContext,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import type { ProjectRunLauncher } from './server-types.ts'

/** One running team retained by the launcher until terminal settlement. */
export interface FutureCupRunTeam {
  /**
   * Execute one complete project run.
   * @param requirement - user frontend requirement.
   * @param project - durable project identity and name.
   * @returns final generated project and verification evidence.
   */
  run(requirement: string, project: ProjectRecord): Promise<TeamRunResult>
  /** Close every Harness runtime owned by this run. */
  close(): Promise<void>
}

/** Inputs supplied to one injected team factory. */
export interface FutureCupRunTeamRequest {
  readonly project: PlatformProjectSummary
  readonly run: ProjectRunRecord
  readonly store: OrchestrationStore
  readonly runRoot: string
  readonly workspace: string
  readonly homeRoot: string
  readonly screenshotDir: string
  readonly profiles?: readonly AgentProfile[] | undefined
}

/** Creates one isolated team runtime for a project run. */
export type FutureCupRunTeamFactory = (
  request: FutureCupRunTeamRequest,
) => FutureCupRunTeam | Promise<FutureCupRunTeam>

class FencedOrchestrationStore implements OrchestrationStore {
  constructor(
    private readonly base: OrchestrationStore,
    private readonly write: WorkflowWriteContext,
  ) {}

  async createProject(
    project: ProjectRecord,
    tasks: readonly TaskSnapshot[],
    _write?: WorkflowWriteContext,
    binding?: ProjectTeamBinding,
    memoryEntries?: readonly ProjectMemoryEntry[],
  ): Promise<void> {
    await this.base.createProject(project, tasks, this.write, binding, memoryEntries)
  }

  async getProject(id: ProjectRecord['id']) {
    return await this.base.getProject(id)
  }

  async listProjects() {
    return await this.base.listProjects()
  }

  async deleteProject(projectId: string): Promise<boolean> {
    return await this.base.deleteProject(projectId)
  }

  async getProjectSnapshot(projectId: string, afterSeq: number, limit: number) {
    return await this.base.getProjectSnapshot(projectId, afterSeq, limit)
  }

  async appendProductEvent(draft: ProductEventDraft): Promise<ProductEvent> {
    return await this.base.appendProductEvent(draft, this.write)
  }

  async listProductEvents(projectId: string, afterSeq: number, limit: number) {
    return await this.base.listProductEvents(projectId, afterSeq, limit)
  }

  async listExecutionEvents(executionId: string): Promise<ExecutionEventRecord[]> {
    return await this.base.listExecutionEvents(executionId)
  }

  async createProjectRun(
    projectId: string,
    ownerId: string,
    fencingToken: bigint,
    workspacePath: string,
  ): Promise<ProjectRunRecord> {
    return await this.base.createProjectRun(
      projectId,
      ownerId,
      fencingToken,
      workspacePath,
      this.write,
    )
  }

  async finishProjectRun(
    runId: string,
    status: Exclude<ProjectRunStatus, 'RUNNING'>,
    previewPath?: string,
    error?: TaskFailure,
  ): Promise<ProjectRunRecord> {
    return await this.base.finishProjectRun(runId, status, previewPath, error, this.write)
  }

  async getProjectRun(runId: string) {
    return await this.base.getProjectRun(runId)
  }

  async listProjectRuns(projectId: string) {
    return await this.base.listProjectRuns(projectId)
  }

  async claimOutbox(ownerId: string, limit: number, claimDurationMs: number): Promise<OutboxClaim[]> {
    return await this.base.claimOutbox(ownerId, limit, claimDurationMs)
  }

  async markOutboxPublished(ownerId: string, eventIds: readonly string[]): Promise<void> {
    await this.base.markOutboxPublished(ownerId, eventIds)
  }

  async acquireWorkflowLease(
    resourceId: string,
    projectId: string,
    ownerId: string,
    leaseDurationMs: number,
  ): Promise<LeaseAcquisition> {
    return await this.base.acquireWorkflowLease(resourceId, projectId, ownerId, leaseDurationMs)
  }

  async getWorkflowLease(resourceId: string): Promise<WorkflowLeaseState | undefined> {
    return await this.base.getWorkflowLease(resourceId)
  }

  async heartbeatWorkflowLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
    leaseDurationMs: number,
  ): Promise<boolean> {
    return await this.base.heartbeatWorkflowLease(
      resourceId,
      ownerId,
      fencingToken,
      leaseDurationMs,
    )
  }

  async releaseWorkflowLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
  ): Promise<boolean> {
    return await this.base.releaseWorkflowLease(resourceId, ownerId, fencingToken)
  }

  async listAgentDefinitions(): Promise<StoredAgentDefinition[]> {
    return await this.base.listAgentDefinitions()
  }

  async saveAgentDefinition(record: StoredAgentDefinition): Promise<void> {
    await this.base.saveAgentDefinition(record)
  }

  async listAgentVersions(definitionId?: string): Promise<StoredAgentVersion[]> {
    return await this.base.listAgentVersions(definitionId)
  }

  async saveAgentVersion(record: StoredAgentVersion): Promise<void> {
    await this.base.saveAgentVersion(record)
  }

  async listAgentTeams(ownerId?: string): Promise<StoredAgentTeam[]> {
    return await this.base.listAgentTeams(ownerId)
  }

  async getAgentTeam(teamId: string): Promise<StoredAgentTeam | undefined> {
    return await this.base.getAgentTeam(teamId)
  }

  async saveAgentTeam(record: StoredAgentTeam): Promise<void> {
    await this.base.saveAgentTeam(record)
  }

  async listAgentTeamVersions(teamId?: string): Promise<StoredAgentTeamVersion[]> {
    return await this.base.listAgentTeamVersions(teamId)
  }

  async getAgentTeamVersion(teamVersionId: string): Promise<StoredAgentTeamVersion | undefined> {
    return await this.base.getAgentTeamVersion(teamVersionId)
  }

  async saveAgentTeamVersion(record: StoredAgentTeamVersion): Promise<void> {
    await this.base.saveAgentTeamVersion(record)
  }

  async publishAgentTeamVersion(record: StoredAgentTeamVersion): Promise<boolean> {
    return await this.base.publishAgentTeamVersion(record)
  }

  async deleteAgentTeamVersion(teamVersionId: string): Promise<boolean> {
    return await this.base.deleteAgentTeamVersion(teamVersionId)
  }

  async deleteAgentTeam(teamId: string): Promise<boolean> {
    return await this.base.deleteAgentTeam(teamId)
  }

  async listProjectTeamBindings(): Promise<ProjectTeamBinding[]> {
    return await this.base.listProjectTeamBindings()
  }

  async getProjectTeamBinding(projectId: string): Promise<ProjectTeamBinding | undefined> {
    return await this.base.getProjectTeamBinding(projectId)
  }

  async bindProjectTeam(binding: ProjectTeamBinding): Promise<void> {
    await this.base.bindProjectTeam(binding)
  }

  async saveProjectMemoryEntry(entry: ProjectMemoryEntry): Promise<void> {
    await this.base.saveProjectMemoryEntry(entry)
  }

  async listProjectMemoryEntries(projectId: string): Promise<ProjectMemoryEntry[]> {
    return await this.base.listProjectMemoryEntries(projectId)
  }

  async saveWorkflowDefinition(record: StoredWorkflowDefinition): Promise<void> {
    await this.base.saveWorkflowDefinition(record)
  }

  async getWorkflowDefinition(id: string, version: number): Promise<StoredWorkflowDefinition | undefined> {
    return await this.base.getWorkflowDefinition(id, version)
  }

  async saveWorkflowControlState(
    projectId: string,
    snapshot: WorkflowControlSnapshot,
    journal: readonly WorkflowControlJournalEntry[],
  ): Promise<void> {
    await this.base.saveWorkflowControlState(projectId, snapshot, journal, this.write)
  }

  async getWorkflowControlState(projectId: string): Promise<WorkflowControlStateRecord | undefined> {
    return await this.base.getWorkflowControlState(projectId)
  }

  async listWorkflowControlEvents(projectId: string): Promise<WorkflowControlEventRecord[]> {
    return await this.base.listWorkflowControlEvents(projectId)
  }

  async saveTask(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    reason?: string,
  ): Promise<void> {
    await this.base.saveTask(task, eventType, reason, this.write)
  }

  async saveTaskAndFinishExecution(
    task: TaskSnapshot,
    eventType: TaskJournalEventType,
    executionId: string,
    status: Exclude<ExecutionStatus, 'RUNNING'>,
    sessionId?: string,
    error?: TaskFailure,
  ): Promise<void> {
    await this.base.saveTaskAndFinishExecution(
      task,
      eventType,
      executionId,
      status,
      sessionId,
      error,
      this.write,
    )
  }

  async listTasks(projectId: string) {
    return await this.base.listTasks(projectId)
  }

  async listTaskJournal(projectId: string): Promise<TaskJournalEntry[]> {
    return await this.base.listTaskJournal(projectId)
  }

  async saveSchedulerDecision(decision: SchedulerDecision): Promise<void> {
    await this.base.saveSchedulerDecision(decision, this.write)
  }

  async listSchedulerDecisions(projectId: string) {
    return await this.base.listSchedulerDecisions(projectId)
  }

  async startExecution(projectId: string, taskId: string, agentId: string): Promise<ExecutionId> {
    return await this.base.startExecution(projectId, taskId, agentId, this.write)
  }

  async finishExecution(
    id: string,
    status: Exclude<ExecutionStatus, 'RUNNING'>,
    sessionId?: string,
    error?: TaskFailure,
  ): Promise<void> {
    await this.base.finishExecution(id, status, sessionId, error, this.write)
  }

  async appendExecutionEvent(
    executionId: string,
    eventType: string,
    payload: JsonValue,
  ): Promise<void> {
    await this.base.appendExecutionEvent(executionId, eventType, payload, this.write)
  }

  async listExecutions(projectId: string): Promise<ExecutionRecord[]> {
    return await this.base.listExecutions(projectId)
  }

  async historicalSuccessRates(projectId: string) {
    return await this.base.historicalSuccessRates(projectId)
  }

  async saveVerificationReport(
    projectId: string,
    status: VerificationStatus,
    report: JsonValue,
    taskId?: string,
    failureSignature?: string,
  ): Promise<VerificationReport> {
    return await this.base.saveVerificationReport(
      projectId,
      status,
      report,
      taskId,
      failureSignature,
      this.write,
    )
  }

  async listVerificationReports(projectId: string) {
    return await this.base.listVerificationReports(projectId)
  }

  async startWorkflowRun(projectId: string): Promise<WorkflowRunRecord> {
    return await this.base.startWorkflowRun(projectId, this.write)
  }

  async updateWorkflowRun(
    projectId: string,
    status: WorkflowStatus,
    repairRound: number,
    escalationReason?: WorkflowRunRecord['escalationReason'],
    escalationMessage?: string,
  ): Promise<WorkflowRunRecord> {
    return await this.base.updateWorkflowRun(
      projectId,
      status,
      repairRound,
      escalationReason,
      escalationMessage,
      this.write,
    )
  }

  async getWorkflowRun(projectId: string) {
    return await this.base.getWorkflowRun(projectId)
  }

  async saveRepairRecord(
    projectId: string,
    draft: RepairRecordDraft,
  ): Promise<RepairRecord> {
    return await this.base.saveRepairRecord(projectId, draft, this.write)
  }

  async listRepairRecords(projectId: string) {
    return await this.base.listRepairRecords(projectId)
  }

  async saveRepairStrategyDecision(
    record: RepairStrategyDecisionRecord,
  ): Promise<void> {
    await this.base.saveRepairStrategyDecision(record, this.write)
  }

  async finishRepairStrategyDecision(
    projectId: string,
    repairRound: number,
    outcome: JsonValue,
    repairRecordId?: string,
  ): Promise<void> {
    await this.base.finishRepairStrategyDecision(
      projectId,
      repairRound,
      outcome,
      repairRecordId,
      this.write,
    )
  }

  async listRepairStrategyDecisions(projectId: string) {
    return await this.base.listRepairStrategyDecisions(projectId)
  }

  async close(): Promise<void> {
    await this.base.close()
  }
}

/** Explicit launcher limits and real Harness launch settings. */
export interface FutureCupRunLauncherOptions {
  readonly store: OrchestrationStore
  readonly workspaceRoot: string
  readonly agentHomeRoot: string
  readonly profiles?: readonly AgentProfile[] | undefined
  readonly harness?: Omit<HarnessAgentOptions, 'workspace' | 'homeRoot'> | undefined
  readonly verification: Omit<VerificationConfig, 'screenshotDir'>
  readonly selfLoop: SelfLoopConfig
  readonly maxAgentRetries?: number | undefined
  readonly leaseDurationMs: number
  readonly heartbeatIntervalMs: number
  readonly settlementRetryMs: number
  readonly settlementWaitMs: number
  readonly createTeam?: FutureCupRunTeamFactory | undefined
  readonly onError?: ((error: unknown) => void) | undefined
}

/** Another run already owns this project. */
export class ProjectRunConflictError extends Error {
  /** Stable machine-readable concurrent-run failure code. */
  readonly code = 'PROJECT_RUN_ACTIVE'

  /** @param projectId - project with an active run. */
  constructor(readonly projectId: string) {
    super(`Project "${projectId}" already has an active run`)
    this.name = 'ProjectRunConflictError'
  }
}

/** The real team runtime could not be created. */
export class ProjectRunStartError extends Error {
  /** Stable machine-readable startup failure code. */
  readonly code = 'PROJECT_RUN_START_FAILED'

  /**
   * @param message - actionable start failure.
   * @param options - preserved cause.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProjectRunStartError'
  }
}

/** One terminal run settlement that cannot be completed by the current owner. */
export interface ProjectRunSettlementIssue {
  readonly projectId: string
  readonly runId: string
  readonly code: string
  readonly message: string
  readonly retryable: boolean
  readonly occurredAt: string
}

/** A project run remains RUNNING because settlement requires recovery. */
export class ProjectRunSettlementPendingError extends Error {
  /** Stable machine-readable pending-settlement code. */
  readonly code = 'PROJECT_RUN_SETTLEMENT_PENDING'
  /** HTTP-facing service-unavailable status. */
  readonly statusCode = 503

  /** @param issues - unresolved project-run settlements. */
  constructor(readonly issues: readonly ProjectRunSettlementIssue[]) {
    super(`Project-run settlement remains pending for ${issues.map(issue => issue.runId).join(', ')}`)
    this.name = 'ProjectRunSettlementPendingError'
  }
}

/** A bounded cancel or close wait elapsed while settlement was still retrying. */
export class ProjectRunSettlementTimeoutError extends Error {
  /** Stable machine-readable timeout code. */
  readonly code = 'PROJECT_RUN_SETTLEMENT_TIMEOUT'
  /** HTTP-facing gateway-timeout status. */
  readonly statusCode = 504

  /** @param projectIds - runs whose settlement wait exceeded its deadline. */
  constructor(readonly projectIds: readonly string[]) {
    super(`Project-run settlement timed out for ${projectIds.join(', ')}`)
    this.name = 'ProjectRunSettlementTimeoutError'
  }
}

interface ActiveRun {
  readonly project: PlatformProjectSummary
  readonly run: ProjectRunRecord
  readonly write: WorkflowWriteContext
  readonly team: FutureCupRunTeam
  readonly heartbeat: NodeJS.Timeout
  readonly job: Promise<void>
  cancelled: boolean
  settled: boolean
  settlementIssue?: ProjectRunSettlementIssue
}

/** Launches real Harness teams without exposing process-local state as durable truth. */
export class FutureCupRunLauncher implements ProjectRunLauncher {
  private readonly profiles: readonly AgentProfile[]
  private readonly active = new Map<string, ActiveRun>()
  private readonly starting = new Map<string, Promise<void>>()
  private readonly createTeam: FutureCupRunTeamFactory
  private readonly settlementFailures = new Map<string, ProjectRunSettlementIssue>()
  private closePromise: Promise<void> | undefined
  private closed = false

  /** @param options - store, private roots, Agent limits, and lease timing. */
  constructor(private readonly options: FutureCupRunLauncherOptions) {
    assertPositiveSafeInteger(options.leaseDurationMs, 'leaseDurationMs')
    assertPositiveSafeInteger(options.heartbeatIntervalMs, 'heartbeatIntervalMs')
    assertPositiveSafeInteger(options.settlementRetryMs, 'settlementRetryMs')
    assertPositiveSafeInteger(options.settlementWaitMs, 'settlementWaitMs')
    if (options.heartbeatIntervalMs >= options.leaseDurationMs) {
      throw new Error('heartbeatIntervalMs must be smaller than leaseDurationMs')
    }
    this.profiles = options.profiles ?? defaultAgentProfiles()
    this.createTeam = options.createTeam ?? (request => this.defaultTeam(request))
  }

  /** {@inheritDoc ProjectRunLauncher.start} */
  async start(project: PlatformProjectSummary): Promise<{ runId: string }> {
    if (this.closed) throw new Error('FutureCupRunLauncher is closed')
    if (this.active.has(project.id) || this.starting.has(project.id)) {
      throw new ProjectRunConflictError(project.id)
    }
    let finishStarting!: () => void
    const starting = new Promise<void>((resolve) => {
      finishStarting = resolve
    })
    this.starting.set(project.id, starting)
    const ownerId = `future-cup-run-${randomUUID()}`
    const resourceId = `workflow:${project.id}`
    let leaseToken: bigint | undefined
    let run: ProjectRunRecord | undefined
    let startupHeartbeat: NodeJS.Timeout | undefined
    try {
      const lease = await this.options.store.acquireWorkflowLease(
        resourceId,
        project.id,
        ownerId,
        this.options.leaseDurationMs,
      )
      if (!lease.acquired || lease.fencingToken === undefined) {
        throw new ProjectRunConflictError(project.id)
      }
      leaseToken = lease.fencingToken
      const fencingToken = lease.fencingToken
      startupHeartbeat = setInterval(() => {
        void this.renewLease(resourceId, ownerId, fencingToken)
      }, this.options.heartbeatIntervalMs)
      startupHeartbeat.unref()
      const write: WorkflowWriteContext = {
        resourceId,
        ownerId,
        fencingToken,
      }
      const fencedStore = new FencedOrchestrationStore(this.options.store, write)
      await this.reconcileInterruptedRun(project.id, fencedStore)
      this.settlementFailures.delete(project.id)
      this.throwIfClosed()
      const runRoot = resolve(this.options.workspaceRoot, ownerId)
      const workspace = resolve(runRoot, 'workspace')
      const homeRoot = resolve(this.options.agentHomeRoot, ownerId)
      const screenshotDir = resolve(runRoot, 'screenshots')
      await mkdir(workspace, { recursive: true, mode: 0o700 })
      await mkdir(homeRoot, { recursive: true, mode: 0o700 })
      await mkdir(screenshotDir, { recursive: true, mode: 0o700 })
      this.throwIfClosed()
      run = await fencedStore.createProjectRun(
        project.id,
        ownerId,
        leaseToken,
        workspace,
      )
      const team = await this.createTeam({
        project,
        run,
        store: fencedStore,
        runRoot,
        workspace,
        homeRoot,
        screenshotDir,
        profiles: await this.resolveProfiles(project.id),
      })
      if (this.isClosed()) {
        await team.close()
        throw new Error('FutureCupRunLauncher closed during startup')
      }
      clearInterval(startupHeartbeat)
      startupHeartbeat = undefined
      const heartbeat = setInterval(() => {
        void this.renew(project.id, ownerId, fencingToken)
      }, this.options.heartbeatIntervalMs)
      heartbeat.unref()
      const active = {
        project,
        run,
        write,
        team,
        heartbeat,
        cancelled: false,
        settled: false,
        job: Promise.resolve(),
      } satisfies ActiveRun
      active.job = this.execute(active, workspace).catch((error: unknown) => {
        this.options.onError?.(error)
      })
      this.active.set(project.id, active)
      return { runId: run.id }
    } catch (error: unknown) {
      if (run !== undefined && leaseToken !== undefined) {
        await this.failStart(run, error, {
          resourceId,
          ownerId,
          fencingToken: leaseToken,
        }, startupHeartbeat)
      } else {
        if (startupHeartbeat !== undefined) clearInterval(startupHeartbeat)
        if (leaseToken !== undefined) {
          await this.options.store.releaseWorkflowLease(resourceId, ownerId, leaseToken)
        }
      }
      if (error instanceof ProjectRunConflictError) throw error
      throw new ProjectRunStartError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      )
    } finally {
      finishStarting()
      this.starting.delete(project.id)
    }
  }

  /** {@inheritDoc ProjectRunLauncher.cancel} */
  async cancel(projectId: string): Promise<boolean> {
    const issue = this.settlementFailures.get(projectId)
    if (issue !== undefined) throw new ProjectRunSettlementPendingError([issue])
    const active = this.active.get(projectId)
    if (active === undefined) return false
    active.cancelled = true
    const teamClosed = await waitFor(active.team.close().catch((error: unknown) => {
      this.options.onError?.(error)
    }), this.options.settlementWaitMs)
    if (!teamClosed) throw new ProjectRunSettlementTimeoutError([projectId])
    const settled = await waitFor(active.job, this.options.settlementWaitMs)
    if (!settled) throw new ProjectRunSettlementTimeoutError([projectId])
    if (active.settlementIssue !== undefined) {
      throw new ProjectRunSettlementPendingError([active.settlementIssue])
    }
    return true
  }

  /** Cancel every active run and await their process cleanup. */
  async close(): Promise<void> {
    if (this.closePromise !== undefined) {
      await this.closePromise
      return
    }
    this.closed = true
    this.closePromise = this.closeActiveRuns().finally(() => {
      this.closePromise = undefined
    })
    await this.closePromise
  }

  /**
   * Snapshot unresolved settlement issues retained for recovery and reporting.
   * @returns the current unresolved settlement issues.
   */
  settlementIssues(): readonly ProjectRunSettlementIssue[] {
    return [...this.settlementFailures.values()]
  }

  private async closeActiveRuns(): Promise<void> {
    await Promise.all([...this.starting.values()])
    const active = [...this.active.values()]
    for (const run of active) {
      run.cancelled = true
    }
    const teamsClosed = await waitFor(
      Promise.all(active.map(async (run) => {
        await run.team.close().catch((error: unknown) => {
          this.options.onError?.(error)
        })
      })),
      this.options.settlementWaitMs,
    )
    if (!teamsClosed) {
      throw new ProjectRunSettlementTimeoutError(active.map(run => run.project.id))
    }
    const completed = await waitFor(
      Promise.all(active.map(async (run) => {
        await run.job
      })),
      this.options.settlementWaitMs,
    )
    if (!completed) {
      throw new ProjectRunSettlementTimeoutError(active.map(run => run.project.id))
    }
    const issues = this.settlementIssues()
    if (issues.length > 0) throw new ProjectRunSettlementPendingError(issues)
  }

  private async execute(active: ActiveRun, workspace: string): Promise<void> {
    let status: Exclude<ProjectRunStatus, 'RUNNING'> = 'FAILED'
    let previewPath: string | undefined
    let failure: TaskFailure | undefined
    try {
      const result = await active.team.run(active.project.requirement, active.project)
      if (active.cancelled) {
        status = 'CANCELLED'
      } else if (result.workflow.status === 'PASSED') {
        status = 'PASSED'
        previewPath = await existingDirectory(resolve(workspace, 'dist'))
      } else {
        status = 'ESCALATED'
      }
    } catch (error: unknown) {
      if (active.cancelled) {
        status = 'CANCELLED'
      } else {
        failure = launchFailure(error)
        this.options.onError?.(error)
      }
    } finally {
      await active.team.close().catch((error: unknown) => {
        this.options.onError?.(error)
      })
      await this.settleUntilTerminal(active, status, previewPath, failure)
    }
  }

  private async settleUntilTerminal(
    active: ActiveRun,
    status: Exclude<ProjectRunStatus, 'RUNNING'>,
    previewPath: string | undefined,
    failure: TaskFailure | undefined,
  ): Promise<void> {
    while (!active.settled) {
      try {
        await this.options.store.finishProjectRun(
          active.run.id,
          status,
          previewPath,
          failure,
          active.write,
        )
        active.settled = true
        this.settlementFailures.delete(active.project.id)
        await this.releaseActive(active)
        return
      } catch (error: unknown) {
        const reconciliation = await this.reconcileTerminalRun(active)
        if (reconciliation.terminal) {
          active.settled = true
          this.settlementFailures.delete(active.project.id)
          await this.releaseActive(active)
          return
        }
        const settlementError = reconciliation.error ?? error
        if (isRetryableSettlementError(settlementError)) {
          this.options.onError?.(settlementError)
          await new Promise(resolve => setTimeout(resolve, this.options.settlementRetryMs))
          continue
        }
        const issue = settlementIssue(active, settlementError)
        active.settlementIssue = issue
        active.settled = true
        this.settlementFailures.set(active.project.id, issue)
        this.options.onError?.(settlementError)
        await this.stopSettlement(active)
        return
      }
    }
  }

  private async reconcileTerminalRun(active: ActiveRun): Promise<{
    readonly terminal: boolean
    readonly error?: unknown
  }> {
    return await this.reconcileRun(active.run.id)
  }

  private async reconcileRun(runId: string): Promise<{
    readonly terminal: boolean
    readonly error?: unknown
  }> {
    try {
      const run = await this.options.store.getProjectRun(runId)
      if (run === undefined) {
        return {
          terminal: false,
          error: Object.assign(
            new Error(`Project run "${runId}" was not found during settlement reconciliation`),
            { code: 'PROJECT_RUN_NOT_FOUND' },
          ),
        }
      }
      return { terminal: run.status !== 'RUNNING' }
    } catch (error: unknown) {
      return { terminal: false, error }
    }
  }

  private async stopSettlement(active: ActiveRun): Promise<void> {
    clearInterval(active.heartbeat)
    try {
      await this.options.store.releaseWorkflowLease(
        `workflow:${active.project.id}`,
        active.run.ownerId,
        active.run.fencingToken,
      )
    } catch (error: unknown) {
      this.options.onError?.(error)
    }
    this.active.delete(active.project.id)
  }

  private async releaseActive(active: ActiveRun): Promise<void> {
    clearInterval(active.heartbeat)
    try {
      await this.options.store.releaseWorkflowLease(
        `workflow:${active.project.id}`,
        active.run.ownerId,
        active.run.fencingToken,
      )
    } finally {
      this.active.delete(active.project.id)
    }
  }

  private async renew(projectId: string, ownerId: string, fencingToken: bigint): Promise<void> {
    const active = this.active.get(projectId)
    if (active === undefined || active.settled) return
    try {
      const renewed = await this.renewLease(`workflow:${projectId}`, ownerId, fencingToken)
      if (!renewed) {
        active.cancelled = true
        await active.team.close()
      }
    } catch (error: unknown) {
      this.options.onError?.(error)
      active.cancelled = true
      await active.team.close().catch((closeError: unknown) => {
        this.options.onError?.(closeError)
      })
    }
  }

  private async renewLease(
    resourceId: string,
    ownerId: string,
    fencingToken: bigint,
  ): Promise<boolean> {
    return await this.options.store.heartbeatWorkflowLease(
      resourceId,
      ownerId,
      fencingToken,
      this.options.leaseDurationMs,
    )
  }

  private async failStart(
    run: ProjectRunRecord,
    error: unknown,
    write: WorkflowWriteContext,
    heartbeat: NodeJS.Timeout | undefined,
  ): Promise<boolean> {
    const deadline = Date.now() + this.options.settlementWaitMs
    let settlementError = error
    while (Date.now() <= deadline) {
      try {
        await this.options.store.finishProjectRun(
          run.id,
          'FAILED',
          undefined,
          launchFailure(error),
          write,
        )
        if (heartbeat !== undefined) clearInterval(heartbeat)
        await this.releaseLease(write)
        return true
      } catch (finishError: unknown) {
        const reconciliation = await this.reconcileRun(run.id)
        if (reconciliation.terminal) {
          if (heartbeat !== undefined) clearInterval(heartbeat)
          await this.releaseLease(write)
          return true
        }
        settlementError = reconciliation.error ?? finishError
        if (!isRetryableSettlementError(settlementError)) break
        this.options.onError?.(settlementError)
        await new Promise(resolve => setTimeout(resolve, this.options.settlementRetryMs))
      }
    }
    const issue = settlementIssueFor(run.projectId, run.id, settlementError)
    this.settlementFailures.set(run.projectId, issue)
    this.options.onError?.(settlementError)
    if (heartbeat !== undefined) clearInterval(heartbeat)
    await this.releaseLease(write)
    return false
  }

  private async releaseLease(write: WorkflowWriteContext): Promise<void> {
    try {
      await this.options.store.releaseWorkflowLease(
        write.resourceId,
        write.ownerId,
        write.fencingToken,
      )
    } catch (error: unknown) {
      this.options.onError?.(error)
    }
  }

  private async reconcileInterruptedRun(
    projectId: string,
    store: OrchestrationStore,
  ): Promise<void> {
    const interrupted = (await store.listProjectRuns(projectId))
      .find(run => run.status === 'RUNNING')
    if (interrupted === undefined) return
    const failure = interruptedRunFailure()
    const dag = await DagEngine.resume(store, ProjectId(projectId))
    const runningExecutions = (await store.listExecutions(projectId))
      .filter(execution => execution.status === 'RUNNING')
    const settledExecutionIds = new Set<string>()
    for (const task of dag.listTasks().filter(task => task.status === 'RUNNING')) {
      const execution = runningExecutions.find(candidate =>
        !settledExecutionIds.has(candidate.id)
        && candidate.taskId === task.id
        && candidate.agentId === task.assignedAgentId)
      await dag.failTask(
        task.id,
        failure,
        execution === undefined ? undefined : { executionId: execution.id },
      )
      if (execution !== undefined) settledExecutionIds.add(execution.id)
    }
    for (const task of dag.listTasks().filter(task =>
      task.status !== 'COMPLETED'
      && task.status !== 'FAILED'
      && task.status !== 'CANCELLED')) {
      await dag.cancelTask(task.id)
    }
    for (const execution of runningExecutions) {
      if (settledExecutionIds.has(execution.id)) continue
      await store.finishExecution(execution.id, 'FAILED', undefined, failure)
    }
    const runningTasks = (await store.listTasks(projectId))
      .filter(task => task.status === 'RUNNING')
    const remainingExecutions = (await store.listExecutions(projectId))
      .filter(execution => execution.status === 'RUNNING')
    if (runningTasks.length > 0 || remainingExecutions.length > 0) {
      throw new Error(`interrupted run "${interrupted.id}" still has RUNNING work`)
    }
    await store.finishProjectRun(
      interrupted.id,
      'FAILED',
      undefined,
      failure,
    )
  }

  private throwIfClosed(): void {
    if (this.closed) throw new Error('FutureCupRunLauncher closed during startup')
  }

  private isClosed(): boolean {
    return this.closed
  }

  private defaultTeam(request: FutureCupRunTeamRequest): FutureCupRunTeam {
    const profiles = request.profiles ?? this.profiles
    const invokers = createHarnessAgentTeam(profiles, {
      ...this.options.harness,
      workspace: request.workspace,
      homeRoot: request.homeRoot,
    })
    const orchestrator = new TeamOrchestrator({
      repository: request.store,
      invokers,
      profiles,
      workspace: request.workspace,
      verification: {
        ...this.options.verification,
        screenshotDir: request.screenshotDir,
      },
      selfLoop: this.options.selfLoop,
      ...this.options.maxAgentRetries === undefined
        ? {}
        : { maxAgentRetries: this.options.maxAgentRetries },
    })
    return {
      run: async (requirement, project) => await orchestrator.run(requirement, project),
      close: async () => { await orchestrator.close() },
    }
  }

  private async resolveProfiles(projectId: string): Promise<readonly AgentProfile[]> {
    const binding = await this.options.store.getProjectTeamBinding(projectId)
    return binding === undefined ? this.profiles : agentProfilesFromTeamBinding(binding)
  }
}

function launchFailure(error: unknown): TaskFailure {
  return {
    code: 'PROJECT_RUN_FAILED',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  }
}

function interruptedRunFailure(): TaskFailure {
  return {
    code: 'PROJECT_RUN_INTERRUPTED',
    message: 'The previous platform process ended before this run settled.',
    retryable: true,
  }
}

async function existingDirectory(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path)
    return info.isDirectory() ? path : undefined
  } catch (error: unknown) {
    if (typeof error === 'object'
      && error !== null
      && 'code' in error
      && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return undefined
    throw error
  }
}

function settlementIssue(active: ActiveRun, error: unknown): ProjectRunSettlementIssue {
  return settlementIssueFor(active.project.id, active.run.id, error)
}

function settlementIssueFor(
  projectId: string,
  runId: string,
  error: unknown,
): ProjectRunSettlementIssue {
  return {
    projectId,
    runId,
    code: errorCode(error) ?? 'PROJECT_RUN_SETTLEMENT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    retryable: isRetryableSettlementError(error),
    occurredAt: new Date().toISOString(),
  }
}

function isRetryableSettlementError(error: unknown): boolean {
  const code = errorCode(error)
  if (code !== undefined && RETRYABLE_SETTLEMENT_CODES.has(code)) return true
  if (error instanceof Error && error.message === 'serializable transaction retry exhausted') return true
  if (typeof error !== 'object' || error === null || !('cause' in error)) return false
  return isRetryableSettlementError(error.cause)
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  if ('cause' in error) return errorCode(error.cause)
  return undefined
}

async function waitFor<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => { resolve(false) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const RETRYABLE_SETTLEMENT_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
  'P2034',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'SQLITE_BUSY',
  'SQLITE_LOCKED',
])
