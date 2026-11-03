/** Bounded verify, repair, and reverify control loop. */

import { setTimeout as delay } from 'node:timers/promises'
import { SessionTurnError } from '@deepseek-ai/dsh-sdk-client'
import type { AgentInvocation, AgentInvoker, AgentRun } from './agent-contracts.ts'
import { buildStructuredPrompt } from './agent-contracts.ts'
import {
  selectRepairContext,
  selectRepairStrategy,
  type RepairStrategyDecision,
} from './adaptive-repair.ts'
import { TaskId } from './brand.ts'
import type { ProjectId as ProjectIdType } from './brand.ts'
import type { ExecutionId } from './brand.ts'
import { requireAgentInvoker } from './harness-agents.ts'
import { REPAIR_INSTRUCTIONS } from './prompts.ts'
import { writeScopedFiles } from './project-scaffold.ts'
import type { OrchestrationStore } from './platform-store.ts'
import {
  jsonValueSchema,
  repairOutputSchema,
  verificationReportDataSchema,
} from './schemas.ts'
import type {
  AgentProfile,
  JsonValue,
  RepairOutput,
  SelfHealingResult,
  SelfLoopConfig,
  TesterOutput,
  VerificationReport,
  VerificationResult,
} from './types.ts'
import {
  WorkflowControlCoordinator,
} from './workflow-control-coordinator.ts'
import type {
  WorkflowControlSnapshot,
} from './workflow-control.ts'
import {
  createFutureCupWorkflowControlDefinition,
  WORKFLOW_CONTROL_MAX_LOOP_ITERATIONS,
} from './workflow-control.ts'
import { createWorkspaceDiff, readWorkspaceSourceSnapshot } from './workspace-diff.ts'

/** Explicit self-loop dependencies and bounds. */
export interface SelfLoopControllerOptions {
  readonly repository: OrchestrationStore
  readonly invokers: ReadonlyMap<string, AgentInvoker>
  readonly profiles: readonly AgentProfile[]
  readonly workspace: string
  readonly config: SelfLoopConfig
  readonly maxAgentRetries?: number | undefined
  readonly verifier?: (workspace: string, spec: TesterOutput) => Promise<VerificationResult>
  readonly now?: () => Date
}

/** Repair timeout distinguished from model and verifier failures. */
export class RepairTimeoutError extends Error {
  /** @param timeoutMs - configured repair deadline. */
  constructor(timeoutMs: number) {
    super(`Repair Agent exceeded the ${timeoutMs} ms deadline`)
    this.name = 'RepairTimeoutError'
  }
}

interface RepairAttempt {
  readonly output: RepairOutput
  readonly diff: string
  readonly startedAt: string
}

type RepairOutcome =
  | { readonly ok: true; readonly attempt: RepairAttempt }
  | {
    readonly ok: false
    readonly reason: 'REPAIR_TIMEOUT' | 'REPAIR_FAILED'
    readonly repairRecordId: string
  }

/** Own the only automatic repair loop for one generated project. */
export class SelfLoopController {
  private readonly verifier: NonNullable<SelfLoopControllerOptions['verifier']>
  private readonly now: () => Date
  private readonly maxAgentRetries: number
  private readonly control: WorkflowControlCoordinator

  /**
   * @param options - durable repository, real Agent invokers, workspace, and explicit bounds.
   */
  constructor(private readonly options: SelfLoopControllerOptions) {
    if (!Number.isSafeInteger(options.config.maxRepairRounds) || options.config.maxRepairRounds < 0) {
      throw new Error('maxRepairRounds must be a non-negative safe integer')
    }
    if (options.config.maxRepairRounds > WORKFLOW_CONTROL_MAX_LOOP_ITERATIONS) {
      throw new Error(
        `maxRepairRounds must not exceed ${String(WORKFLOW_CONTROL_MAX_LOOP_ITERATIONS)}`,
      )
    }
    if (!Number.isSafeInteger(options.config.repairTimeoutMs) || options.config.repairTimeoutMs <= 0) {
      throw new Error('repairTimeoutMs must be a positive safe integer')
    }
    if (options.maxAgentRetries !== undefined
      && (!Number.isSafeInteger(options.maxAgentRetries) || options.maxAgentRetries < 0)) {
      throw new Error('maxAgentRetries must be a non-negative safe integer')
    }
    if (options.verifier === undefined) throw new Error('A complete verification function is required')
    this.verifier = options.verifier
    this.now = options.now ?? (() => new Date())
    this.maxAgentRetries = options.maxAgentRetries ?? 0
    this.control = new WorkflowControlCoordinator(
      options.repository,
      createFutureCupWorkflowControlDefinition(
        Math.max(1, options.config.maxRepairRounds),
      ),
      this.now,
    )
  }

  /**
   * Verify, repair, and reverify until pass, repetition, timeout, or the configured limit.
   * @param projectId - durable generated project identity.
   * @param spec - Tester-owned complete verification specification.
   * @returns the final report, all reports, repair diffs, and workflow terminal state.
   */
  async run(projectId: ProjectIdType, spec: TesterOutput): Promise<SelfHealingResult> {
    let control = await this.control.start(projectId)
    await this.options.repository.startWorkflowRun(projectId)
    let current = await this.verifyAndPersist(projectId, spec)
    control = await this.recordVerification(projectId, control, current)
    if (current.status === 'PASS') {
      return this.completed(projectId, current, 0, control)
    }
    if (current.status === 'INCOMPLETE') {
      await this.control.escalate(projectId, 'VERIFIER_INCOMPLETE')
      return this.escalate(
        projectId,
        current,
        0,
        'VERIFIER_INCOMPLETE',
        'Initial verification could not complete in this environment.',
      )
    }
    if (this.options.config.maxRepairRounds === 0) {
      await this.control.escalate(projectId, 'MAX_REPAIR_ROUNDS')
      return this.escalate(
        projectId,
        current,
        0,
        'MAX_REPAIR_ROUNDS',
        'Automatic repair is disabled by maxRepairRounds=0.',
      )
    }

    let strategy = await this.planStrategy(projectId, current, 1)
    if (strategy.selectedStrategy === undefined) {
      await this.recordStrategyDecision(projectId, 1, strategy)
      await this.finishStrategyDecision(projectId, 1, {
        status: 'ESCALATED',
        nextAction: 'NO_ELIGIBLE_STRATEGY',
        reason: strategy.selectedReason,
      })
      await this.control.escalate(projectId, 'REPAIR_STRATEGY_UNAVAILABLE')
      return this.escalate(
        projectId,
        current,
        0,
        'REPAIR_STRATEGY_UNAVAILABLE',
        strategy.selectedReason,
      )
    }
    let selectedStrategy = strategy.selectedStrategy

    const seenSignatures = new Set<string>([requiredSignature(current)])
    for (let round = 1; ; round += 1) {
      await this.recordStrategyDecision(projectId, round, strategy)
      const outcome = await this.runRepair(
        projectId,
        spec,
        current,
        round,
        strategy,
        selectedStrategy,
      )
      if (!outcome.ok) {
        await this.finishStrategyDecision(projectId, round, {
          status: outcome.reason,
          nextAction: 'ESCALATE',
        }, outcome.repairRecordId)
        await this.control.escalate(projectId, outcome.reason)
        return this.escalate(
          projectId,
          current,
          round,
          outcome.reason,
          outcome.reason === 'REPAIR_TIMEOUT'
            ? `Repair round ${round} exceeded its deadline.`
            : `Repair round ${round} failed before completing.`,
        )
      }
      const attempt = outcome.attempt
      control = await this.control.advance(projectId, {
        type: 'TASK_COMPLETED',
        instanceId: activeControlTask(control, 'repair'),
        summary: attempt.output.summary,
      })

      let next: VerificationReport
      try {
        next = await this.verifyAndPersist(projectId, spec)
      } catch (error: unknown) {
        const repairRecord = await this.saveRepairAttempt(
          projectId,
          current,
          attempt,
          round,
          'INCOMPLETE',
        )
        await this.finishStrategyDecision(projectId, round, {
          status: 'VERIFIER_INCOMPLETE',
          nextAction: 'ESCALATE',
          reason: error instanceof Error ? error.message : String(error),
        }, repairRecord.id)
        await this.control.escalate(projectId, 'VERIFIER_INCOMPLETE')
        return this.escalate(
          projectId,
          current,
          round,
          'VERIFIER_INCOMPLETE',
          error instanceof Error ? error.message : String(error),
        )
      }
      const nextStrategy = next.status === 'PASS'
        || next.status === 'INCOMPLETE'
        || round >= this.options.config.maxRepairRounds
        ? undefined
        : await this.planStrategy(projectId, next, round + 1)
      control = await this.recordVerification(
        projectId,
        control,
        next,
        nextStrategy?.nextRoundExpectation === 'SWITCHED_STRATEGY',
      )

      const repairRecord = await this.saveRepairAttempt(
        projectId,
        current,
        attempt,
        round,
        next.status,
      )
      const signature = next.status === 'PASS' || next.status === 'INCOMPLETE'
        ? undefined
        : requiredSignature(next)
      const repeated = signature !== undefined && seenSignatures.has(signature)
      const maxExhausted = round >= this.options.config.maxRepairRounds
      await this.finishStrategyDecision(projectId, round, {
        status: next.status,
        nextAction: next.status === 'PASS'
          ? 'COMPLETE'
          : next.status === 'INCOMPLETE'
            ? 'ESCALATE_VERIFIER_INCOMPLETE'
            : maxExhausted
              ? 'ESCALATE_MAX_REPAIR_ROUNDS'
              : repeated && nextStrategy?.selectedStrategy !== undefined
                ? 'SWITCH_STRATEGY'
                : repeated
                  ? 'ESCALATE_REPEATED_FAILURE'
                  : nextStrategy?.selectedStrategy === undefined
                    ? 'ESCALATE_STRATEGY_UNAVAILABLE'
                    : 'CONTINUE_REPAIR',
        failureSignature: signature ?? null,
        nextStrategyId: nextStrategy?.selectedStrategy?.id ?? null,
      }, repairRecord.id)
      await this.options.repository.saveProjectMemoryEntry({
        id: `memory-${projectId}-repair-${String(round)}`,
        projectId,
        kind: 'failure-signature',
        key: `repair-round-${String(round)}`,
        value: jsonValueSchema.parse({
          failureSignature: requiredSignature(current),
          diagnosis: attempt.output.diagnosis,
          summary: attempt.output.summary,
          fileCount: attempt.output.files.length,
          afterStatus: next.status,
        }),
        source: `task:repair-round-${String(round)}`,
        createdAt: this.timestamp(),
      })

      if (next.status === 'PASS') {
        return this.completed(projectId, next, round, control)
      }
      if (next.status === 'INCOMPLETE') {
        if (control.status !== 'ESCALATED') {
          await this.control.escalate(projectId, 'VERIFIER_INCOMPLETE')
        }
        return this.escalate(
          projectId,
          next,
          round,
          'VERIFIER_INCOMPLETE',
          'Reverification could not complete after automatic repair.',
        )
      }

      if (maxExhausted) {
        return this.escalate(
          projectId,
          next,
          round,
          'MAX_REPAIR_ROUNDS',
          `Automatic repair exhausted ${this.options.config.maxRepairRounds} rounds.`,
        )
      }
      if (repeated && nextStrategy?.selectedStrategy === undefined) {
        return this.escalate(
          projectId,
          next,
          round,
          'REPEATED_FAILURE',
          `Repair produced the equivalent failure signature ${signature}.`,
        )
      }
      const followingStrategy = requireStrategyDecision(nextStrategy)
      const followingSelection = followingStrategy.selectedStrategy
      if (followingSelection === undefined) {
        await this.control.escalate(projectId, 'REPAIR_STRATEGY_UNAVAILABLE')
        return this.escalate(
          projectId,
          next,
          round,
          'REPAIR_STRATEGY_UNAVAILABLE',
          followingStrategy.selectedReason,
        )
      }
      if (!repeated) seenSignatures.add(requiredSignature(next))
      current = next
      strategy = followingStrategy
      selectedStrategy = followingSelection
    }
  }

  /** Run one Repair Agent Session and apply its bounded file plan. */
  private async runRepair(
    projectId: ProjectIdType,
    spec: TesterOutput,
    report: VerificationReport,
    round: number,
    strategy: RepairStrategyDecision,
    selectedStrategy: NonNullable<RepairStrategyDecision['selectedStrategy']>,
  ): Promise<RepairOutcome> {
    const profile = repairProfile(this.options.profiles)
    const invoker = requireAgentInvoker(this.options.invokers, profile.id)
    const startedAt = this.timestamp()
    const before = await readWorkspaceSourceSnapshot(this.options.workspace)
    const executionId = await this.options.repository.startExecution(
      projectId,
      TaskId(`repair-round-${round}`),
      profile.id,
    )
    await this.options.repository.appendExecutionEvent(
      executionId,
      'repair/started',
      jsonValueSchema.parse({
        round,
        failureSignature: requiredSignature(report),
        strategyId: selectedStrategy.id,
        strategyReason: strategy.selectedReason,
      }),
    )

    try {
      const prompt = buildStructuredPrompt(
        'repair',
        [
          profile.instructions ?? REPAIR_INSTRUCTIONS,
          selectedStrategy.promptFragment,
        ].join('\n\n'),
        {
          verification: report.report,
          verificationSpec: spec,
          repairStrategy: strategy,
          sources: selectRepairContext(strategy, [...before].map(([path, content]) => ({
            path,
            content,
          }))),
          priorRepairs: (await this.options.repository.listRepairRecords(projectId)).map(record => ({
            round: record.repairRound,
            failureSignature: record.failureSignature,
            errorSummary: record.errorSummary,
            changeSummary: record.changeSummary,
            diff: record.diff,
          })),
        },
        repairOutputSchema,
      )
      const run = await this.invokeRepairAgent(
        executionId,
        invoker,
        { taskId: `repair-round-${round}`, prompt },
      )
      await this.options.repository.appendExecutionEvent(
        executionId,
        'agent/session-events',
        jsonValueSchema.parse(run.eventTypes),
      )
      await this.options.repository.appendExecutionEvent(
        executionId,
        'agent/structured-output',
        jsonValueSchema.parse(run.output),
      )
      writeScopedFiles(this.options.workspace, run.output.files, ['src/'])
      const after = await readWorkspaceSourceSnapshot(this.options.workspace)
      const diff = createWorkspaceDiff(before, after)
      await this.options.repository.finishExecution(executionId, 'COMPLETED', run.sessionId)
      return { ok: true, attempt: { output: run.output, diff, startedAt } }
    } catch (error: unknown) {
      const timeout = error instanceof RepairTimeoutError
      await this.options.repository.finishExecution(executionId, 'FAILED', undefined, {
        code: timeout ? 'REPAIR_TIMEOUT' : 'REPAIR_FAILED',
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      })
      await this.options.repository.appendExecutionEvent(
        executionId,
        'agent/error',
        jsonValueSchema.parse({
          code: timeout ? 'REPAIR_TIMEOUT' : 'REPAIR_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }),
      )
      const repairRecord = await this.options.repository.saveRepairRecord(projectId, {
        repairRound: round,
        verificationReportId: report.id,
        repairAgentId: profile.id,
        failureSignature: requiredSignature(report),
        errorSummary: summarizeFindings(report),
        changeSummary: timeout
          ? 'Repair Agent timed out before producing an applicable change.'
          : 'Repair Agent failed before producing an applicable change.',
        diff: '',
        beforeStatus: report.status,
        afterStatus: 'INCOMPLETE',
        startedAt,
        completedAt: this.timestamp(),
      })
      return {
        ok: false,
        reason: timeout ? 'REPAIR_TIMEOUT' : 'REPAIR_FAILED',
        repairRecordId: repairRecord.id,
      }
    }
  }

  /**
   * Run one Repair turn and retry only provider failures that the SDK marks as transient.
   * @param executionId - durable execution receiving retry evidence.
   * @param invoker - Repair Agent runtime.
   * @param invocation - complete structured Repair prompt.
   * @returns the successful structured Repair output.
   */
  private async invokeRepairAgent(
    executionId: ExecutionId,
    invoker: AgentInvoker,
    invocation: AgentInvocation,
  ): Promise<AgentRun<RepairOutput>> {
    let retries = 0
    for (;;) {
      try {
        return await withTimeout(
          invoker.run(invocation, repairOutputSchema),
          this.options.config.repairTimeoutMs,
        )
      } catch (error: unknown) {
        if (!(error instanceof SessionTurnError)
          || !error.retryable
          || retries >= this.maxAgentRetries) {
          throw error
        }
        retries += 1
        await this.options.repository.appendExecutionEvent(
          executionId,
          'agent/retry',
          jsonValueSchema.parse({
            attempt: retries,
            code: error.code,
            message: error.message,
          }),
        )
      }
    }
  }

  /** Select a strategy from the current report and durable strategy history. */
  private async planStrategy(
    projectId: ProjectIdType,
    report: VerificationReport,
    repairRound: number,
  ): Promise<RepairStrategyDecision> {
    const profile = repairProfile(this.options.profiles)
    const priorStrategies = (await this.options.repository.listRepairStrategyDecisions(projectId))
      .filter(record => record.strategyId !== 'none')
      .map(record => ({
        repairRound: record.repairRound,
        failureSignature: record.failureSignature,
        strategyId: record.strategyId,
      }))
    return selectRepairStrategy({
      report: verificationReportDataSchema.parse(report.report),
      repairRound,
      maxRepairRounds: this.options.config.maxRepairRounds,
      availableTools: profile.toolAllowlist === undefined ? ['fs-read'] : [...profile.toolAllowlist],
      priorStrategies,
    })
  }

  /** Persist one Repair Agent attempt with its before/after verification state. */
  private async saveRepairAttempt(
    projectId: ProjectIdType,
    report: VerificationReport,
    attempt: RepairAttempt,
    round: number,
    afterStatus: VerificationReport['status'],
  ) {
    return await this.options.repository.saveRepairRecord(projectId, {
      repairRound: round,
      verificationReportId: report.id,
      repairAgentId: repairProfile(this.options.profiles).id,
      failureSignature: requiredSignature(report),
      errorSummary: summarizeFindings(report),
      changeSummary: attempt.output.summary,
      diff: attempt.diff,
      beforeStatus: report.status,
      afterStatus,
      startedAt: attempt.startedAt,
      completedAt: this.timestamp(),
    })
  }

  /** Persist strategy selection before the Repair Agent can modify source. */
  private async recordStrategyDecision(
    projectId: ProjectIdType,
    repairRound: number,
    decision: RepairStrategyDecision,
  ): Promise<void> {
    const timestamp = this.timestamp()
    await this.options.repository.saveRepairStrategyDecision({
      id: `repair-strategy-${projectId}-${String(repairRound)}`,
      projectId,
      repairRound,
      failureSignature: decision.failureSignature,
      strategyId: decision.selectedStrategy?.id ?? 'none',
      decision: jsonValueSchema.parse(decision),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  /** Attach a durable outcome to one strategy decision. */
  private async finishStrategyDecision(
    projectId: ProjectIdType,
    repairRound: number,
    outcome: JsonValue,
    repairRecordId?: string,
  ): Promise<void> {
    await this.options.repository.finishRepairStrategyDecision(
      projectId,
      repairRound,
      jsonValueSchema.parse(outcome),
      repairRecordId,
    )
  }

  /** Execute one full verification stage and commit its report. */
  private async verifyAndPersist(
    projectId: ProjectIdType,
    spec: TesterOutput,
  ): Promise<VerificationReport> {
    const result = await this.verifier(this.options.workspace, spec)
    return await this.options.repository.saveVerificationReport(
      projectId,
      result.status,
      jsonValueSchema.parse(result.report),
      undefined,
      result.report.failureSignature ?? undefined,
    )
  }

  /** Commit a successful workflow and assemble all current evidence. */
  private async completed(
    projectId: ProjectIdType,
    verification: VerificationReport,
    repairRound: number,
    control: WorkflowControlSnapshot,
  ): Promise<SelfHealingResult> {
    const workflow = await this.options.repository.updateWorkflowRun(projectId, 'PASSED', repairRound)
    await this.control.advance(projectId, {
      type: 'TASK_COMPLETED',
      instanceId: activeControlTask(control, 'delivery'),
      summary: 'Delivery accepted after independent verification.',
    })
    return {
      verification,
      verificationReports: await this.options.repository.listVerificationReports(projectId),
      repairs: await this.options.repository.listRepairRecords(projectId),
      workflow,
    }
  }

  /** Commit a visible terminal state that requires a human decision. */
  private async escalate(
    projectId: ProjectIdType,
    verification: VerificationReport,
    repairRound: number,
    reason: NonNullable<Awaited<ReturnType<OrchestrationStore['getWorkflowRun']>>>['escalationReason'],
    message: string,
  ): Promise<SelfHealingResult> {
    const workflow = await this.options.repository.updateWorkflowRun(
      projectId,
      'ESCALATED',
      repairRound,
      reason,
      message,
    )
    return {
      verification,
      verificationReports: await this.options.repository.listVerificationReports(projectId),
      repairs: await this.options.repository.listRepairRecords(projectId),
      workflow,
    }
  }

  private async recordVerification(
    projectId: ProjectIdType,
    snapshot: WorkflowControlSnapshot,
    report: VerificationReport,
    strategySwitchAvailable = false,
  ): Promise<WorkflowControlSnapshot> {
    return await this.control.advance(projectId, {
      type: 'VERIFICATION_COMPLETED',
      instanceId: activeControlTask(snapshot, 'verification'),
      status: report.status === 'WARNING' ? 'FAIL' : report.status,
      ...report.failureSignature === undefined
        ? {}
        : { failureSignature: report.failureSignature },
      ...strategySwitchAvailable ? { strategySwitchAvailable: true } : {},
    })
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

/**
 * Resolve the active workflow-control instance for one task reference.
 * @param snapshot - current quiescent control snapshot.
 * @param taskRef - required active task reference.
 * @returns the active instance identity.
 * @throws Error when the snapshot does not contain the required active task.
 */
export function activeControlTask(
  snapshot: WorkflowControlSnapshot,
  taskRef: string,
): string {
  const active = snapshot.activeNodes.find(node => node.taskRef === taskRef)
  if (active === undefined) {
    throw new Error(`workflow control has no active task "${taskRef}"`)
  }
  return active.instanceId
}

/**
 * Resolve the configured Repair role and fail loudly when incomplete.
 * @param profiles - complete project Agent roster.
 * @returns the Repair Agent profile.
 * @throws Error when no Repair Agent is configured.
 */
export function repairProfile(profiles: readonly AgentProfile[]): AgentProfile {
  const profile = profiles.find(value => value.role === 'repair')
  if (profile === undefined) throw new Error('Repair Agent profile is not configured')
  return profile
}

/**
 * Keep one bounded error summary for durable repair history.
 * @param report - verification report entering repair.
 * @returns a bounded line-oriented finding summary.
 */
export function summarizeFindings(report: VerificationReport): string {
  const parsed = verificationReportDataSchema.parse(report.report)
  if (parsed.findings.length === 0) return `Verification ${report.status}`
  return parsed.findings.slice(0, 12).map((finding) => {
    return `${finding.code}: ${finding.message}`
  }).join('\n').slice(0, 8_000)
}

/**
 * Require a stable signature for every non-pass verification entering repair.
 * @param report - durable verification report.
 * @returns the stable SHA-256 failure signature.
 * @throws Error when the report has no retained signature.
 */
export function requiredSignature(report: VerificationReport): string {
  if (report.failureSignature === undefined || report.failureSignature === '') {
    throw new Error(`verification "${report.id}" did not retain a failure signature`)
  }
  return report.failureSignature
}

/**
 * Require a following strategy decision after a continuing failure.
 * @param decision - strategy plan produced for the next repair round.
 * @returns the present strategy plan.
 * @throws Error when control flow supplied no plan for a continuing repair.
 */
export function requireStrategyDecision(
  decision: RepairStrategyDecision | undefined,
): RepairStrategyDecision {
  if (decision === undefined) {
    throw new Error('continuing repair round has no strategy decision')
  }
  return decision
}

/** Bound one Agent invocation and reject with a typed timeout. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    delay(timeoutMs, undefined, { ref: false }).then(() => {
      throw new RepairTimeoutError(timeoutMs)
    }),
  ])
}
