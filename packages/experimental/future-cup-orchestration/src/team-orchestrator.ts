/** Real Harness Agent-team orchestration over the durable DAG and scheduler. */

import { randomUUID } from 'node:crypto'
import { posix } from 'node:path'
import { z } from 'zod'
import type { AgentInvocation, AgentInvoker } from './agent-contracts.ts'
import { buildStructuredPrompt, StructuredOutputError } from './agent-contracts.ts'
import { ProjectId, TaskId } from './brand.ts'
import type { ProjectId as ProjectIdType, TaskId as TaskIdType } from './brand.ts'
import { DagEngine, taskDefinition } from './dag-engine.ts'
import { requireAgentInvoker } from './harness-agents.ts'
import {
  FRONTEND_INSTRUCTIONS,
  INTEGRATION_INSTRUCTIONS,
  PLANNER_INSTRUCTIONS,
  TESTER_INSTRUCTIONS,
  UI_DESIGNER_INSTRUCTIONS,
} from './prompts.ts'
import { renderDesignStylesheet, writeProjectScaffold, writeScopedFiles } from './project-scaffold.ts'
import type { OrchestrationStore } from './platform-store.ts'
import {
  frontendOutputSchema,
  integrationOutputSchema,
  jsonValueSchema,
  plannerOutputSchema,
  testerOutputSchema,
  uiDesignerOutputSchema,
} from './schemas.ts'
import { SelfLoopController } from './self-healer.ts'
import {
  ExplainableScheduler,
  withHistoricalSuccessRates,
} from './scheduler.ts'
import type {
  AgentProfile,
  GeneratedProject,
  PlannerOutput,
  ProjectRecord,
  SelfHealingResult,
  SelfLoopConfig,
  TaskFailure,
  TaskSnapshot,
  TeamRunResult,
  TesterOutput,
  VerificationResult,
} from './types.ts'
import { verifyProject } from './verification.ts'
import type { VerificationConfig } from './verification.ts'

/** Inputs owned by the M3 team orchestrator. */
export interface TeamOrchestratorOptions {
  readonly repository: OrchestrationStore
  readonly invokers: ReadonlyMap<string, AgentInvoker>
  readonly profiles: readonly AgentProfile[]
  readonly workspace: string
  /** Keep a copied source snapshot instead of replacing scaffold files. */
  readonly preserveExistingWorkspace?: boolean
  readonly scheduler?: ExplainableScheduler
  readonly verification: VerificationConfig
  readonly selfLoop: SelfLoopConfig
  readonly projectVerifier?: (workspace: string, spec: TesterOutput) => Promise<VerificationResult>
  readonly maxAgentRetries?: number
}

/** One execution under way, used to retain failure context before task settlement. */
interface RunningExecution {
  readonly task: TaskSnapshot
  readonly agent: AgentProfile
  readonly executionId: Awaited<ReturnType<OrchestrationStore['startExecution']>>
}

interface FailedAssignment {
  readonly ok: false
  readonly taskId: TaskIdType
  readonly retryable: boolean
  readonly message: string
}

/** Orchestrates Planner, UI Designer, Tester, two Frontend Agents, Integration, and Repair. */
export class TeamOrchestrator {
  private readonly scheduler: ExplainableScheduler
  private readonly projectVerifier: NonNullable<TeamOrchestratorOptions['projectVerifier']>
  private readonly maxAgentRetries: number
  private closed = false

  /**
   * @param options - repository, real or test Agent invokers, profiles, and workspace.
   */
  constructor(private readonly options: TeamOrchestratorOptions) {
    this.scheduler = options.scheduler ?? new ExplainableScheduler()
    this.projectVerifier = options.projectVerifier
      ?? (async (workspace, spec) => await verifyProject(workspace, spec, options.verification))
    this.maxAgentRetries = options.maxAgentRetries ?? 1
    if (!Number.isSafeInteger(this.maxAgentRetries) || this.maxAgentRetries < 0) {
      throw new Error('maxAgentRetries must be a non-negative safe integer')
    }
  }

  /**
   * Run the complete M3 team workflow from one user requirement.
   * @param requirement - frontend project requirement.
   * @param project - optional platform-registered project to populate.
   * @returns the persisted DAG, decisions, executions, verification, and workspace.
   */
  async run(requirement: string, project?: ProjectRecord): Promise<TeamRunResult> {
    const generated = await this.generate(requirement, project)
    const selfHealing = await this.verifyAndRepair(generated)
    return {
      ...generated,
      executions: await this.options.repository.listExecutions(generated.projectId),
      ...selfHealing,
    }
  }

  /**
   * Generate the project and complete its DAG without running final verification.
   * @param requirement - frontend project requirement.
   * @param registeredProject - optional platform project identity and user-facing name.
   * @returns the generated workspace and all generation evidence.
   */
  async generate(requirement: string, registeredProject?: ProjectRecord): Promise<GeneratedProject> {
    if (this.closed) throw new Error('TeamOrchestrator is closed')
    const projectId = registeredProject?.id ?? ProjectId(`project-${randomUUID()}`)
    const project: ProjectRecord = registeredProject ?? {
      id: projectId,
      name: requirement.slice(0, 120),
      requirement,
      createdAt: new Date().toISOString(),
    }
    const runRequirement = await requirementForRun(
      this.options.repository,
      project,
      requirement,
    )
    await this.options.repository.createProject(project, [])
    writeProjectScaffold(this.options.workspace, {
      overwrite: !this.options.preserveExistingWorkspace,
    })

    const planner = await this.runPlanner(projectId, runRequirement)
    const taskDefinitions = planner.tasks.map(task => taskDefinition(task))
    const dag = await DagEngine.create(
      this.options.repository,
      project,
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
      const rates = await this.options.repository.historicalSuccessRates(projectId)
      const assignments = this.scheduler.schedule(
        projectId,
        ready,
        withHistoricalSuccessRates(this.options.profiles, rates),
      )
      if (assignments.length === 0) {
        throw new Error(
          `Scheduler deferred every READY task: ${ready.map(task => task.id).join(', ')}`,
        )
      }
      const running: RunningExecution[] = []
      for (const assignment of assignments) {
        await this.options.repository.saveSchedulerDecision(assignment.decision)
        const executionId = await this.options.repository.startExecution(
          projectId,
          assignment.task.id,
          assignment.agent.id,
        )
        await dag.startTask(assignment.task.id, assignment.agent.id)
        running.push({
          task: dag.getTask(assignment.task.id),
          agent: assignment.agent,
          executionId,
        })
      }

      const settled = await Promise.all(running.map(execution =>
        this.executeAssignment(dag, runRequirement, planner, outputs, execution),
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
          await dag.requeueTask(current.id, retryableFailure.message, {
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
    const testerTask = planner.tasks.find(task => task.role === 'tester')
    if (testerTask === undefined) throw new Error('Planner did not produce a Tester task')
    const verificationSpec = testerOutputSchema.parse(outputs.get(TaskId(testerTask.id)))
    validateTesterOutput(planner, verificationSpec)
    return {
      projectId,
      planner,
      verificationSpec,
      tasks: finalTasks,
      decisions: await this.options.repository.listSchedulerDecisions(projectId),
      executions: await this.options.repository.listExecutions(projectId),
      workspace: this.options.workspace,
    }
  }

  /**
   * Run bounded independent verification and automatic repair on generated output.
   * @param generated - completed generation phase.
   * @returns final verification, all reports, repair diffs, and workflow state.
   */
  async verifyAndRepair(generated: GeneratedProject): Promise<SelfHealingResult> {
    const selfLoop = new SelfLoopController({
      repository: this.options.repository,
      invokers: this.options.invokers,
      profiles: this.options.profiles,
      workspace: generated.workspace,
      config: this.options.selfLoop,
      maxAgentRetries: this.maxAgentRetries,
      verifier: this.projectVerifier,
    })
    return await selfLoop.run(generated.projectId, generated.verificationSpec)
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
    const executionId = await this.options.repository.startExecution(
      projectId,
      TaskId('planner'),
      profile.id,
    )
    try {
      const prompt = buildStructuredPrompt(
        'planner',
        profile.instructions ?? PLANNER_INSTRUCTIONS,
        { requirement },
        plannerOutputSchema,
      )
      await this.options.repository.appendExecutionEvent(
        executionId,
        'agent/started',
        jsonValueSchema.parse({ taskId: 'planner', agentId: profile.id }),
      )
      const result = await this.invoke(invoker, TaskId('planner'), prompt, plannerOutputSchema)
      await this.options.repository.appendExecutionEvent(
        executionId,
        'agent/structured-output',
        jsonValueSchema.parse(result.output),
      )
      await this.options.repository.appendExecutionEvent(
        executionId,
        'agent/session-events',
        jsonValueSchema.parse(result.eventTypes),
      )
      await this.options.repository.finishExecution(executionId, 'COMPLETED', result.sessionId)
      return result.output
    } catch (error: unknown) {
      const failure = taskFailure('PLANNER_FAILED', error)
      await this.options.repository.finishExecution(executionId, 'FAILED', undefined, failure)
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
      const invocation = this.invocationForTask(
        running.task,
        running.agent,
        requirement,
        planner,
        outputs,
      )
      await this.options.repository.appendExecutionEvent(
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
      await this.options.repository.appendExecutionEvent(
        running.executionId,
        'agent/session-events',
        jsonValueSchema.parse(result.eventTypes),
      )
      await this.options.repository.appendExecutionEvent(
        running.executionId,
        'agent/structured-output',
        jsonValueSchema.parse(result.output),
      )
      await this.applyOutput(running.task, result.output)
      outputs.set(running.task.id, result.output)
      await dag.completeTask(running.task.id, jsonValueSchema.parse(result.output), {
        executionId: running.executionId,
        sessionId: result.sessionId,
      })
      return { ok: true }
    } catch (error: unknown) {
      if (dag.getTask(running.task.id).status === 'COMPLETED') throw error
      const failure = taskFailure(`${running.task.role.toUpperCase()}_FAILED`, error)
      await this.options.repository.appendExecutionEvent(
        running.executionId,
        'agent/error',
        jsonValueSchema.parse({ code: failure.code, message: failure.message }),
      )
      await dag.failTask(running.task.id, failure, {
        executionId: running.executionId,
      })
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
    profile: AgentProfile,
    requirement: string,
    planner: PlannerOutput,
    outputs: Map<TaskIdType, unknown>,
  ): { prompt: string; schema: z.ZodType } {
    const designTask = planner.tasks.find(value => value.role === 'ui-designer')
    const design = designTask === undefined ? undefined : outputs.get(TaskId(designTask.id))
    const testerTask = planner.tasks.find(value => value.role === 'tester')
    const verificationSpec = testerTask === undefined
      ? undefined
      : outputs.get(TaskId(testerTask.id))
    switch (task.role) {
      case 'ui-designer':
        return {
          prompt: buildStructuredPrompt(
            'ui-designer',
            profile.instructions ?? UI_DESIGNER_INSTRUCTIONS,
            { requirement, pages: planner.pages },
            uiDesignerOutputSchema,
          ),
          schema: uiDesignerOutputSchema,
        }
      case 'frontend': {
        const page = planner.pages.find(value => value.id === task.pageId)
        if (page === undefined) throw new Error(`frontend task "${task.id}" has no planned page`)
        const parsedSpec = testerOutputSchema.parse(verificationSpec)
        const pageSpec = parsedSpec.pages.find(value => value.pageId === page.id)
        if (pageSpec === undefined) {
          throw new Error(`Tester output does not declare page "${page.id}"`)
        }
        return {
          prompt: buildStructuredPrompt(
            'frontend',
            profile.instructions ?? FRONTEND_INSTRUCTIONS,
            {
              task: task.description,
              page,
              pageSpec,
              design,
              expectedPageId: page.id,
              expectedPath: page.path,
            },
            frontendOutputSchema,
          ),
          schema: frontendOutputSchema,
        }
      }
      case 'tester':
        return {
          prompt: buildStructuredPrompt(
            'tester',
            profile.instructions ?? TESTER_INSTRUCTIONS,
            { requirement, pages: planner.pages, design },
            testerOutputSchema,
          ),
          schema: testerOutputSchema,
        }
      case 'integration':
        return {
          prompt: buildStructuredPrompt(
            'integration',
            profile.instructions ?? INTEGRATION_INSTRUCTIONS,
            {
              pages: planner.pages,
              verificationSpec: testerOutputSchema.parse(verificationSpec),
              design,
              frontendOutputs: planner.tasks
                .filter(value => value.role === 'frontend')
                .map(value => outputs.get(TaskId(value.id))),
            },
            integrationOutputSchema,
          ),
          schema: integrationOutputSchema,
        }
      default:
        return assertNever(task.role)
    }
  }

  private async applyOutput(task: TaskSnapshot, output: unknown): Promise<void> {
    switch (task.role) {
      case 'ui-designer': {
        const design = uiDesignerOutputSchema.parse(output)
        writeScopedFiles(this.options.workspace, [
          { path: 'src/design.css', content: renderDesignStylesheet(design.tokens) },
        ], ['src/'])
        await this.saveTaskMemory(task, 'design-decision', 'design-system', {
          summary: design.summary,
          designSpec: design.designSpec,
          tokens: design.tokens,
        })
        return
      }
      case 'tester': {
        const tester = testerOutputSchema.parse(output)
        await this.saveTaskMemory(task, 'design-decision', 'verification-spec', {
          summary: tester.summary,
          pages: tester.pages.map(page => page.pageId),
          interactions: tester.interactions.length,
        })
        return
      }
      case 'frontend': {
        const page = frontendOutputSchema.parse(output)
        if (page.pageId !== task.pageId) {
          throw new StructuredOutputError(
            `frontend task "${task.id}" returned pageId "${page.pageId}", expected "${task.pageId}"`,
          )
        }
        validateFrontendImports(page.files)
        writeScopedFiles(this.options.workspace, page.files, ['src/pages/'])
        await this.saveTaskMemory(task, 'accepted-artifact-summary', `page-${page.pageId}`, {
          summary: page.summary,
          files: page.files.map(file => file.path),
        })
        return
      }
      case 'integration': {
        const integration = integrationOutputSchema.parse(output)
        writeScopedFiles(
          this.options.workspace,
          integration.files,
          ['src/'],
        )
        await this.saveTaskMemory(task, 'accepted-artifact-summary', 'integrated-application', {
          summary: integration.summary,
          files: integration.files.map(file => file.path),
        })
        return
      }
      default:
        assertNever(task.role)
    }
  }

  private async saveTaskMemory(
    task: TaskSnapshot,
    kind: 'design-decision' | 'accepted-artifact-summary',
    key: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    await this.options.repository.saveProjectMemoryEntry({
      id: `memory-${task.projectId}-${key}`,
      projectId: task.projectId,
      kind,
      key,
      value: jsonValueSchema.parse(value),
      source: `task:${task.id}`,
      createdAt: new Date().toISOString(),
    })
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

async function requirementForRun(
  repository: OrchestrationStore,
  project: ProjectRecord,
  requirement: string,
): Promise<string> {
  if (project.derivationMode !== 'UPGRADE') return requirement
  const changeRequest = project.changeRequest?.trim()
  if (changeRequest === undefined || changeRequest === '') return requirement
  const sourceSnapshot = project.sourceProjectId === undefined
    ? undefined
    : await repository.getProjectSnapshot(project.sourceProjectId, 0, 1)
  const sourceSpec = sourceSnapshot?.tasks.find(task =>
    task.role === 'tester'
    && task.status === 'COMPLETED'
    && task.result !== undefined,
  )?.result
  return [
    requirement,
    '',
    'UPGRADE REQUEST:',
    changeRequest,
    '',
    `This project is a successor of "${project.sourceProjectName ?? String(project.sourceProjectId ?? 'an earlier project')}".`,
    'The workspace already contains the previous verified application source.',
    'Inspect the existing source before planning and preserve behavior that the upgrade request does not replace.',
    'Extend or update the existing application instead of treating this as a blank generation.',
    ...sourceSpec === undefined
      ? []
      : [
        'SOURCE VERIFICATION SPEC:',
        JSON.stringify(sourceSpec).slice(0, 20_000),
        'Preserve every source route and interaction unless the upgrade request explicitly replaces it.',
      ],
  ].join('\n')
}

/** Require page-local imports to resolve to files returned by the same frontend task. */
function validateFrontendImports(files: readonly { path: string; content: string }[]): void {
  const paths = new Set(files.map(file => file.path))
  for (const file of files) {
    const pattern = /(?:from\s+|import\s*)['"](\.[^'"]+)['"]/gu
    for (const match of file.content.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier === undefined) continue
      const imported = posix.normalize(posix.join(posix.dirname(file.path), specifier))
      const candidates = [
        imported,
        `${imported}.ts`,
        `${imported}.tsx`,
        posix.join(imported, 'index.ts'),
        posix.join(imported, 'index.tsx'),
      ]
      if (!candidates.some(candidate => paths.has(candidate))) {
        throw new StructuredOutputError(
          `frontend file "${file.path}" imports unreturned local module "${specifier}"`,
        )
      }
    }
  }
}

/** Require Tester assertions to close over the Planner's pages and routes. */
function validateTesterOutput(planner: PlannerOutput, spec: TesterOutput): void {
  const planned = new Map(planner.pages.map(page => [page.id, page]))
  if (spec.pages.length !== planned.size) {
    throw new Error('Tester output must declare exactly one assertion per planned page')
  }
  for (const page of spec.pages) {
    const expected = planned.get(page.pageId)
    if (expected === undefined) throw new Error(`Tester declared unknown page "${page.pageId}"`)
    if (page.route !== expected.route) {
      throw new Error(`Tester route for "${page.pageId}" does not match the Planner route`)
    }
    if (page.navigationLabel !== expected.navigationLabel) {
      throw new Error(`Tester navigation label for "${page.pageId}" does not match the Planner`)
    }
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
