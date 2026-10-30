/** Real Harness Agent-team orchestration over the durable DAG and scheduler. */

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AgentInvocation, AgentInvoker } from './agent-contracts.ts'
import { buildStructuredPrompt, StructuredOutputError } from './agent-contracts.ts'
import { ProjectId, TaskId } from './brand.ts'
import type { ProjectId as ProjectIdType, TaskId as TaskIdType } from './brand.ts'
import { verifyProjectBuild } from './build-verifier.ts'
import type { BuildVerification } from './build-verifier.ts'
import { DagEngine, taskDefinition } from './dag-engine.ts'
import { requireAgentInvoker } from './harness-agents.ts'
import {
  FRONTEND_INSTRUCTIONS,
  INTEGRATION_INSTRUCTIONS,
  PLANNER_INSTRUCTIONS,
  UI_DESIGNER_INSTRUCTIONS,
} from './prompts.ts'
import { renderDesignStylesheet, writeProjectScaffold, writeScopedFiles } from './project-scaffold.ts'
import type { OrchestrationRepository } from './repository.ts'
import {
  frontendOutputSchema,
  integrationOutputSchema,
  jsonValueSchema,
  plannerOutputSchema,
  uiDesignerOutputSchema,
} from './schemas.ts'
import {
  ExplainableScheduler,
  withHistoricalSuccessRates,
} from './scheduler.ts'
import type {
  AgentProfile,
  PlannerOutput,
  TaskFailure,
  TaskSnapshot,
  TeamRunResult,
} from './types.ts'

/** Inputs owned by the M2 team orchestrator. */
export interface TeamOrchestratorOptions {
  readonly repository: OrchestrationRepository
  readonly invokers: ReadonlyMap<string, AgentInvoker>
  readonly profiles: readonly AgentProfile[]
  readonly workspace: string
  readonly scheduler?: ExplainableScheduler
  readonly verifier?: (workspace: string) => Promise<BuildVerification>
  readonly maxAgentRetries?: number
}

/** One execution under way, used to retain failure context before task settlement. */
interface RunningExecution {
  readonly task: TaskSnapshot
  readonly agent: AgentProfile
  readonly executionId: ReturnType<OrchestrationRepository['startExecution']>
}

interface FailedAssignment {
  readonly ok: false
  readonly taskId: TaskIdType
  readonly retryable: boolean
  readonly message: string
}

/** Orchestrates Planner, UI Designer, two Frontend Agents, and Integration. */
export class TeamOrchestrator {
  private readonly scheduler: ExplainableScheduler
  private readonly verifier: (workspace: string) => Promise<BuildVerification>
  private readonly maxAgentRetries: number
  private closed = false

  /**
   * @param options - repository, real or test Agent invokers, profiles, and workspace.
   */
  constructor(private readonly options: TeamOrchestratorOptions) {
    this.scheduler = options.scheduler ?? new ExplainableScheduler()
    this.verifier = options.verifier ?? (workspace => verifyProjectBuild(workspace))
    this.maxAgentRetries = options.maxAgentRetries ?? 1
    if (!Number.isSafeInteger(this.maxAgentRetries) || this.maxAgentRetries < 0) {
      throw new Error('maxAgentRetries must be a non-negative safe integer')
    }
  }

  /**
   * Run the complete M2 team workflow from one user requirement.
   * @param requirement - frontend project requirement.
   * @returns the persisted DAG, decisions, executions, verification, and workspace.
   */
  async run(requirement: string): Promise<TeamRunResult> {
    if (this.closed) throw new Error('TeamOrchestrator is closed')
    const projectId = ProjectId(`project-${randomUUID()}`)
    writeProjectScaffold(this.options.workspace)

    const planner = await this.runPlanner(projectId, requirement)
    const taskDefinitions = planner.tasks.map(task => taskDefinition(task))
    const dag = DagEngine.create(
      this.options.repository,
      { id: projectId, name: planner.projectName, requirement },
      taskDefinitions,
    )

    const outputs = new Map<TaskIdType, unknown>()
    while (!dag.isComplete()) {
      const ready = dag.readyTasks()
      if (ready.length === 0) {
        const unfinished = dag.listTasks().filter(task =>
          task.status !== 'COMPLETED' && task.status !== 'FAILED' && task.status !== 'CANCELLED',
        )
        throw new Error(`DAG cannot progress; unfinished tasks: ${unfinished.map(task => `${task.id}:${task.status}`).join(', ')}`)
      }
      const rates = this.options.repository.historicalSuccessRates(projectId)
      const assignments = this.scheduler.schedule(
        projectId,
        ready,
        withHistoricalSuccessRates(this.options.profiles, rates),
      )
      const running: RunningExecution[] = []
      for (const assignment of assignments) {
        this.options.repository.saveSchedulerDecision(assignment.decision)
        const executionId = this.options.repository.startExecution(
          projectId,
          assignment.task.id,
          assignment.agent.id,
        )
        dag.startTask(assignment.task.id, assignment.agent.id)
        running.push({
          task: dag.getTask(assignment.task.id),
          agent: assignment.agent,
          executionId,
        })
      }

      const settled = await Promise.all(running.map(execution =>
        this.executeAssignment(dag, requirement, planner, outputs, execution),
      ))
      const failures: FailedAssignment[] = settled.filter(
        (result): result is FailedAssignment => !result.ok,
      )
      const retryableFailure = failures.find(result => result.retryable)
      if (retryableFailure !== undefined) {
        const current = dag.getTask(retryableFailure.taskId)
        if (current.retryCount < this.maxAgentRetries) {
          const hasAlternativeAgent = this.options.profiles.some(profile =>
            profile.role === current.role
              && profile.available
              && profile.id !== current.assignedAgentId,
          )
          dag.requeueTask(current.id, retryableFailure.message, {
            excludePreviousAgent: hasAlternativeAgent,
          })
          continue
        }
      }
      const failure = failures[0]
      if (failure !== undefined) {
        throw new Error(`Agent task "${failure.taskId}" failed: ${failure.message}`)
      }
    }

    const finalTasks = dag.listTasks()
    const build = await this.verifier(this.options.workspace)
    const verification = this.options.repository.saveVerificationReport(
      projectId,
      build.status,
      build.report,
    )
    if (build.status !== 'PASS') {
      throw new Error(`generated project verification failed: ${JSON.stringify(build.report)}`)
    }
    return {
      projectId,
      planner,
      tasks: finalTasks,
      decisions: this.options.repository.listSchedulerDecisions(projectId),
      executions: this.options.repository.listExecutions(projectId),
      verification,
      workspace: this.options.workspace,
    }
  }

  /** Close every Agent-owned runtime. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const failures: unknown[] = []
    for (const invoker of this.options.invokers.values()) {
      try {
        await invoker.close()
      } catch (error: unknown) {
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Agent team disposal failed')
  }

  private async runPlanner(projectId: ProjectIdType, requirement: string): Promise<PlannerOutput> {
    const profile = this.options.profiles.find(value => value.role === 'planner')
    if (profile === undefined) throw new Error('Planner profile is not configured')
    const invoker = requireAgentInvoker(this.options.invokers, profile.id)
    const executionId = this.options.repository.startExecution(
      projectId,
      TaskId('planner'),
      profile.id,
    )
    try {
      const prompt = buildStructuredPrompt(
        'planner',
        PLANNER_INSTRUCTIONS,
        { requirement },
        plannerOutputSchema,
      )
      this.options.repository.appendExecutionEvent(
        executionId,
        'agent/started',
        jsonValueSchema.parse({ taskId: 'planner', agentId: profile.id }),
      )
      const result = await this.invoke(invoker, TaskId('planner'), prompt, plannerOutputSchema)
      this.options.repository.appendExecutionEvent(
        executionId,
        'agent/structured-output',
        jsonValueSchema.parse(result.output),
      )
      this.options.repository.appendExecutionEvent(
        executionId,
        'agent/session-events',
        jsonValueSchema.parse(result.eventTypes),
      )
      this.options.repository.finishExecution(executionId, 'COMPLETED', result.sessionId)
      return result.output
    } catch (error: unknown) {
      const failure = taskFailure('PLANNER_FAILED', error)
      this.options.repository.finishExecution(executionId, 'FAILED', undefined, failure)
      throw error
    }
  }

  private async executeAssignment(
    dag: DagEngine,
    requirement: string,
    planner: PlannerOutput,
    outputs: Map<TaskIdType, unknown>,
    running: RunningExecution,
  ): Promise<{ ok: true } | { ok: false; taskId: TaskIdType; retryable: boolean; message: string }> {
    try {
      const invoker = requireAgentInvoker(this.options.invokers, running.agent.id)
      const invocation = this.invocationForTask(running.task, requirement, planner, outputs)
      this.options.repository.appendExecutionEvent(
        running.executionId,
        'agent/started',
        jsonValueSchema.parse({ taskId: running.task.id, agentId: running.agent.id }),
      )
      const result = await this.invoke(
        invoker,
        running.task.id,
        invocation.prompt,
        invocation.schema,
      )
      this.options.repository.appendExecutionEvent(
        running.executionId,
        'agent/session-events',
        jsonValueSchema.parse(result.eventTypes),
      )
      this.options.repository.appendExecutionEvent(
        running.executionId,
        'agent/structured-output',
        jsonValueSchema.parse(result.output),
      )
      this.options.repository.finishExecution(
        running.executionId,
        'COMPLETED',
        result.sessionId,
      )
      outputs.set(running.task.id, result.output)
      this.applyOutput(running.task, result.output)
      dag.completeTask(running.task.id, jsonValueSchema.parse(result.output))
      return { ok: true }
    } catch (error: unknown) {
      const failure = taskFailure(`${running.task.role.toUpperCase()}_FAILED`, error)
      this.options.repository.appendExecutionEvent(
        running.executionId,
        'agent/error',
        jsonValueSchema.parse({ code: failure.code, message: failure.message }),
      )
      this.options.repository.finishExecution(
        running.executionId,
        'FAILED',
        undefined,
        failure,
      )
      dag.failTask(running.task.id, failure)
      return {
        ok: false,
        taskId: running.task.id,
        retryable: failure.retryable,
        message: failure.message,
      }
    }
  }

  private invocationForTask(
    task: TaskSnapshot,
    requirement: string,
    planner: PlannerOutput,
    outputs: Map<TaskIdType, unknown>,
  ): { prompt: string; schema: z.ZodType } {
    const designTask = planner.tasks.find(value => value.role === 'ui-designer')
    const design = designTask === undefined ? undefined : outputs.get(TaskId(designTask.id))
    switch (task.role) {
      case 'ui-designer':
        return {
          prompt: buildStructuredPrompt(
            'ui-designer',
            UI_DESIGNER_INSTRUCTIONS,
            { requirement, pages: planner.pages },
            uiDesignerOutputSchema,
          ),
          schema: uiDesignerOutputSchema,
        }
      case 'frontend': {
        const page = planner.pages.find(value => value.id === task.pageId)
        if (page === undefined) throw new Error(`frontend task "${task.id}" has no planned page`)
        return {
          prompt: buildStructuredPrompt(
            'frontend',
            FRONTEND_INSTRUCTIONS,
            {
              task: task.description,
              page,
              design,
              expectedPageId: page.id,
              expectedPath: page.path,
            },
            frontendOutputSchema,
          ),
          schema: frontendOutputSchema,
        }
      }
      case 'integration':
        return {
          prompt: buildStructuredPrompt(
            'integration',
            INTEGRATION_INSTRUCTIONS,
            {
              pages: planner.pages,
              design,
              frontendOutputs: planner.tasks
                .filter(value => value.role === 'frontend')
                .map(value => outputs.get(TaskId(value.id))),
            },
            integrationOutputSchema,
          ),
          schema: integrationOutputSchema,
        }
      case 'planner':
        throw new Error('Planner cannot appear as a DAG execution task')
      default:
        return assertNever(task.role)
    }
  }

  private applyOutput(task: TaskSnapshot, output: unknown): void {
    switch (task.role) {
      case 'ui-designer': {
        const design = uiDesignerOutputSchema.parse(output)
        writeScopedFiles(this.options.workspace, [
          { path: 'src/design.css', content: renderDesignStylesheet(design.tokens) },
        ], ['src/'])
        return
      }
      case 'frontend': {
        const page = frontendOutputSchema.parse(output)
        if (page.pageId !== task.pageId) {
          throw new StructuredOutputError(
            `frontend task "${task.id}" returned pageId "${page.pageId}", expected "${task.pageId}"`,
          )
        }
        writeScopedFiles(this.options.workspace, page.files, ['src/pages/'])
        return
      }
      case 'integration':
        writeScopedFiles(
          this.options.workspace,
          integrationOutputSchema.parse(output).files,
          ['src/'],
        )
        return
      case 'planner':
        throw new Error('Planner cannot apply task output')
      default:
        assertNever(task.role)
    }
  }

  private async invoke<T>(
    invoker: AgentInvoker,
    taskId: TaskIdType,
    prompt: string,
    schema: z.ZodType<T>,
  ) {
    const invocation: AgentInvocation = { taskId, prompt }
    return await invoker.run(invocation, schema)
  }
}

/** Create a structured task failure while retaining actionable error text. */
function taskFailure(code: string, error: unknown): TaskFailure {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  }
}

/** Prove a closed role union remains exhaustive. */
function assertNever(value: never): never {
  throw new Error(`unexpected Agent role: ${String(value)}`)
}
