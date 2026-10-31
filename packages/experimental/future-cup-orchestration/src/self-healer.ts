/** Bounded verify, repair, and reverify control loop. */

import type { AgentInvoker } from './agent-contracts.ts'
import { buildStructuredPrompt } from './agent-contracts.ts'
import { TaskId } from './brand.ts'
import type { ProjectId as ProjectIdType } from './brand.ts'
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
  RepairOutput,
  SelfHealingResult,
  SelfLoopConfig,
  TesterOutput,
  VerificationReport,
  VerificationResult,
} from './types.ts'
import { createWorkspaceDiff, readWorkspaceSourceSnapshot } from './workspace-diff.ts'

/** Explicit self-loop dependencies and bounds. */
export interface SelfLoopControllerOptions {
  readonly repository: OrchestrationStore
  readonly invokers: ReadonlyMap<string, AgentInvoker>
  readonly profiles: readonly AgentProfile[]
  readonly workspace: string
  readonly config: SelfLoopConfig
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
  | { readonly ok: false; readonly reason: 'REPAIR_TIMEOUT' | 'REPAIR_FAILED' }

/** Own the only automatic repair loop for one generated project. */
export class SelfLoopController {
  private readonly verifier: NonNullable<SelfLoopControllerOptions['verifier']>
  private readonly now: () => Date

  /**
   * @param options - durable repository, real Agent invokers, workspace, and explicit bounds.
   */
  constructor(private readonly options: SelfLoopControllerOptions) {
    if (!Number.isSafeInteger(options.config.maxRepairRounds) || options.config.maxRepairRounds < 0) {
      throw new Error('maxRepairRounds must be a non-negative safe integer')
    }
    if (!Number.isSafeInteger(options.config.repairTimeoutMs) || options.config.repairTimeoutMs <= 0) {
      throw new Error('repairTimeoutMs must be a positive safe integer')
    }
    if (options.verifier === undefined) throw new Error('A complete verification function is required')
    this.verifier = options.verifier
    this.now = options.now ?? (() => new Date())
  }

  /**
   * Verify, repair, and reverify until pass, repetition, timeout, or the configured limit.
   * @param projectId - durable generated project identity.
   * @param spec - Tester-owned complete verification specification.
   * @returns the final report, all reports, repair diffs, and workflow terminal state.
   */
  async run(projectId: ProjectIdType, spec: TesterOutput): Promise<SelfHealingResult> {
    await this.options.repository.startWorkflowRun(projectId)
    let current = await this.verifyAndPersist(projectId, spec)
    if (current.status === 'PASS') {
      return this.completed(projectId, current, 0)
    }
    if (current.status === 'INCOMPLETE') {
      return this.escalate(
        projectId,
        current,
        0,
        'VERIFIER_INCOMPLETE',
        'Initial verification could not complete in this environment.',
      )
    }
    if (this.options.config.maxRepairRounds === 0) {
      return this.escalate(
        projectId,
        current,
        0,
        'MAX_REPAIR_ROUNDS',
        'Automatic repair is disabled by maxRepairRounds=0.',
      )
    }

    const seenSignatures = new Set<string>([requiredSignature(current)])
    for (let round = 1; round <= this.options.config.maxRepairRounds; round += 1) {
      const outcome = await this.runRepair(projectId, spec, current, round)
      if (!outcome.ok) {
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

      let next: VerificationReport
      try {
        next = await this.verifyAndPersist(projectId, spec)
      } catch (error: unknown) {
        return this.escalate(
          projectId,
          current,
          round,
          'VERIFIER_INCOMPLETE',
          error instanceof Error ? error.message : String(error),
        )
      }

      await this.options.repository.saveRepairRecord(projectId, {
        repairRound: round,
        verificationReportId: current.id,
        repairAgentId: repairProfile(this.options.profiles).id,
        failureSignature: requiredSignature(current),
        errorSummary: summarizeFindings(current),
        changeSummary: attempt.output.summary,
        diff: attempt.diff,
        beforeStatus: current.status,
        afterStatus: next.status,
        startedAt: attempt.startedAt,
        completedAt: this.timestamp(),
      })

      if (next.status === 'PASS') {
        return this.completed(projectId, next, round)
      }
      if (next.status === 'INCOMPLETE') {
        return this.escalate(
          projectId,
          next,
          round,
          'VERIFIER_INCOMPLETE',
          'Reverification could not complete after automatic repair.',
        )
      }

      const signature = requiredSignature(next)
      if (seenSignatures.has(signature)) {
        return this.escalate(
          projectId,
          next,
          round,
          'REPEATED_FAILURE',
          `Repair produced the equivalent failure signature ${signature}.`,
        )
      }
      seenSignatures.add(signature)
      current = next
    }

    return this.escalate(
      projectId,
      current,
      this.options.config.maxRepairRounds,
      'MAX_REPAIR_ROUNDS',
      `Automatic repair exhausted ${this.options.config.maxRepairRounds} rounds.`,
    )
  }

  /** Run one Repair Agent Session and apply its bounded file plan. */
  private async runRepair(
    projectId: ProjectIdType,
    spec: TesterOutput,
    report: VerificationReport,
    round: number,
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
      jsonValueSchema.parse({ round, failureSignature: requiredSignature(report) }),
    )

    try {
      const prompt = buildStructuredPrompt(
        'repair',
        REPAIR_INSTRUCTIONS,
        {
          verification: report.report,
          verificationSpec: spec,
          sources: selectRepairSources(before, report),
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
      const run = await withTimeout(
        invoker.run({ taskId: `repair-round-${round}`, prompt }, repairOutputSchema),
        this.options.config.repairTimeoutMs,
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
      await this.options.repository.saveRepairRecord(projectId, {
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
      return { ok: false, reason: timeout ? 'REPAIR_TIMEOUT' : 'REPAIR_FAILED' }
    }
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
  ): Promise<SelfHealingResult> {
    const workflow = await this.options.repository.updateWorkflowRun(projectId, 'PASSED', repairRound)
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

  private timestamp(): string {
    return this.now().toISOString()
  }
}

/** Resolve the configured Repair role and fail loudly when incomplete. */
function repairProfile(profiles: readonly AgentProfile[]): AgentProfile {
  const profile = profiles.find(value => value.role === 'repair')
  if (profile === undefined) throw new Error('Repair Agent profile is not configured')
  return profile
}

/** Select affected files first, then bounded surrounding source context. */
function selectRepairSources(
  sources: ReadonlyMap<string, string>,
  report: VerificationReport,
): { path: string; content: string }[] {
  const parsed = verificationReportDataSchema.parse(report.report)
  const targets = new Set<string>()
  for (const finding of parsed.findings) {
    const target = finding.target
    if (target !== undefined && target.startsWith('src/')) targets.add(target)
  }
  return [...sources]
    .sort(([left], [right]) => {
      const leftAffected = targets.has(left) ? 0 : 1
      const rightAffected = targets.has(right) ? 0 : 1
      return leftAffected - rightAffected || left.localeCompare(right)
    })
    .slice(0, 24)
    .map(([path, content]) => ({ path, content }))
}

/** Keep one bounded error summary for durable repair history. */
function summarizeFindings(report: VerificationReport): string {
  const parsed = verificationReportDataSchema.parse(report.report)
  if (parsed.findings.length === 0) return `Verification ${report.status}`
  return parsed.findings.slice(0, 12).map((finding) => {
    return `${finding.code}: ${finding.message}`
  }).join('\n').slice(0, 8_000)
}

/** Require a stable signature for every non-pass verification entering repair. */
function requiredSignature(report: VerificationReport): string {
  if (report.failureSignature === undefined || report.failureSignature === '') {
    throw new Error(`verification "${report.id}" did not retain a failure signature`)
  }
  return report.failureSignature
}

/** Bound one Agent invocation and reject with a typed timeout. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new RepairTimeoutError(timeoutMs))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
