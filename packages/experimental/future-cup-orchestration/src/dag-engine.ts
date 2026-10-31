/** Durable DAG state transitions with cycle validation, Journaling, and resume verification. */

import { isDeepStrictEqual } from 'node:util'
import { TaskId } from './brand.ts'
import type {
  AgentId as AgentIdType,
  ExecutionId as ExecutionIdType,
  ProjectId as ProjectIdType,
  TaskId as TaskIdType,
} from './brand.ts'
import type { OrchestrationStore } from './platform-store.ts'
import type {
  JsonValue,
  ProjectRecord,
  TaskDefinition,
  TaskFailure,
  TaskJournalEventType,
  TaskSnapshot,
} from './types.ts'

/** Stable DAG failure codes. */
export type DagErrorCode =
  | 'TASK_NOT_FOUND'
  | 'DUPLICATE_TASK'
  | 'MISSING_DEPENDENCY'
  | 'CYCLE'
  | 'INVALID_TRANSITION'
  | 'JOURNAL_INCONSISTENT'
  | 'PROJECT_NOT_FOUND'

/** Typed DAG validation or transition failure. */
export class DagError extends Error {
  /**
   * @param message - actionable failure description.
   * @param code - stable machine-readable code.
   */
  constructor(message: string, readonly code: DagErrorCode) {
    super(message)
    this.name = 'DagError'
  }
}

interface DagOptions {
  /** Override for deterministic test timestamps. */
  readonly now?: () => Date
}

interface RequeueOptions {
  /** Exclude the previous Agent only when another instance can take the retry. */
  readonly excludePreviousAgent?: boolean
}

interface ExecutionSettlement {
  readonly executionId: ExecutionIdType
  readonly sessionId?: string | undefined
}

/**
 * Topologically sort DAG nodes with Kahn's algorithm.
 * @param tasks - task definitions or current snapshots.
 * @returns task ids in deterministic topological order.
 * @throws {DagError} for duplicate ids, missing dependencies, or a cycle.
 */
export function topologicalTaskIds(
  tasks: readonly UnderlyingTask[],
): TaskIdType[] {
  const byId = new Map<TaskIdType, UnderlyingTask>()
  const indegree = new Map<TaskIdType, number>()
  const consumers = new Map<TaskIdType, TaskIdType[]>()
  for (const task of tasks) {
    if (byId.has(task.id)) throw new DagError(`duplicate task id "${task.id}"`, 'DUPLICATE_TASK')
    byId.set(task.id, task)
    indegree.set(task.id, task.dependencies.length)
    consumers.set(task.id, [])
  }
  for (const task of tasks) {
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) {
        throw new DagError(`task "${task.id}" depends on missing task "${dependency}"`, 'MISSING_DEPENDENCY')
      }
      consumers.get(dependency)?.push(task.id)
    }
  }
  const ready = [...byId.keys()].filter(id => indegree.get(id) === 0).sort(compareTaskIds)
  const ordered: TaskIdType[] = []
  while (ready.length > 0) {
    const id = ready.shift()
    if (id === undefined) break
    ordered.push(id)
    for (const consumer of (consumers.get(id) ?? []).sort(compareTaskIds)) {
      const next = (indegree.get(consumer) ?? 0) - 1
      indegree.set(consumer, next)
      if (next === 0) {
        ready.push(consumer)
        ready.sort(compareTaskIds)
      }
    }
  }
  if (ordered.length !== tasks.length) {
    const cycleNodes = [...indegree].filter(([, count]) => count > 0).map(([id]) => id)
    throw new DagError(`task DAG contains a cycle involving ${cycleNodes.join(', ')}`, 'CYCLE')
  }
  return ordered
}

type UnderlyingTask = Pick<TaskDefinition, 'id' | 'dependencies'>

/** Mutable durable DAG owner for one project. */
export class DagEngine {
  private readonly tasksById: Map<TaskIdType, TaskSnapshot>
  private readonly now: () => Date
  private mutationTail: Promise<void> = Promise.resolve()

  private constructor(
    private readonly repository: OrchestrationStore,
    readonly project: ProjectRecord,
    tasks: readonly TaskSnapshot[],
    options: DagOptions,
  ) {
    this.now = options.now ?? (() => new Date())
    this.tasksById = new Map(tasks.map(task => [task.id, task]))
  }

  /**
   * Create one durable project DAG.
   * @param repository - orchestration persistence owner.
   * @param project - project identity and requirement.
   * @param definitions - complete task set.
   * @param options - deterministic clock override.
   * @returns the ready DAG owner.
   */
  static async create(
    repository: OrchestrationStore,
    project: Omit<ProjectRecord, 'createdAt'>,
    definitions: readonly TaskDefinition[],
    options: DagOptions = {},
  ): Promise<DagEngine> {
    const now = options.now ?? (() => new Date())
    topologicalTaskIds(definitions)
    const timestamp = now().toISOString()
    const projectRecord: ProjectRecord = { ...project, createdAt: timestamp }
    const snapshots = definitions.map((definition): TaskSnapshot => ({
      ...definition,
      projectId: projectRecord.id,
      status: 'PENDING',
      revision: 1,
      retryCount: 0,
      excludedAgentIds: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    await repository.createProject(projectRecord, snapshots)
    const engine = new DagEngine(repository, projectRecord, snapshots, options)
    await engine.syncReadiness()
    return engine
  }

  /**
   * Resume a DAG from current task rows and verify their revision Journal.
   * @param repository - orchestration persistence owner.
   * @param projectId - project to resume.
   * @param options - deterministic clock override.
   * @returns the reconstructed DAG owner.
   */
  static async resume(
    repository: OrchestrationStore,
    projectId: ProjectIdType,
    options: DagOptions = {},
  ): Promise<DagEngine> {
    const project = await repository.getProject(projectId)
    if (project === undefined) {
      throw new DagError(`project "${projectId}" does not exist`, 'PROJECT_NOT_FOUND')
    }
    const tasks = await repository.listTasks(projectId)
    const journal = await repository.listTaskJournal(projectId)
    const replayed = new Map<TaskIdType, TaskSnapshot>()
    for (const entry of journal) {
      const previous = replayed.get(entry.taskId)
      if (entry.revision === 1) {
        if (previous !== undefined) {
          throw new DagError(`task "${entry.taskId}" restarted revision at 1`, 'JOURNAL_INCONSISTENT')
        }
      } else if (previous === undefined || entry.revision !== previous.revision + 1) {
        throw new DagError(
          `task "${entry.taskId}" journal jumped to revision ${entry.revision}`,
          'JOURNAL_INCONSISTENT',
        )
      }
      replayed.set(entry.taskId, entry.snapshot)
    }
    if (replayed.size !== tasks.length
      || tasks.some(task => !isDeepStrictEqual(replayed.get(task.id), task))) {
      throw new DagError('task rows do not match the replayed Journal', 'JOURNAL_INCONSISTENT')
    }
    topologicalTaskIds(tasks)
    return new DagEngine(repository, project, tasks, options)
  }

  /**
   * List current task snapshots in creation order.
   * @returns detached task snapshots.
   */
  listTasks(): TaskSnapshot[] {
    return [...this.tasksById.values()].map(task => ({ ...task }))
  }

  /**
   * Read one task.
   * @param taskId - task identity.
   * @returns detached task snapshot.
   */
  getTask(taskId: TaskIdType): TaskSnapshot {
    const task = this.tasksById.get(taskId)
    if (task === undefined) throw new DagError(`task "${taskId}" does not exist`, 'TASK_NOT_FOUND')
    return { ...task }
  }

  /**
   * Compute deterministic topological task order.
   * @returns task ids in dependency order.
   */
  topologicalOrder(): TaskIdType[] {
    return topologicalTaskIds([...this.tasksById.values()])
  }

  /**
   * List READY tasks ordered by priority and stable id.
   * @returns detached READY task snapshots.
   */
  readyTasks(): TaskSnapshot[] {
    return [...this.tasksById.values()]
      .filter(task => task.status === 'READY')
      .sort((left, right) => right.priority - left.priority || compareTaskIds(left.id, right.id))
      .map(task => ({ ...task }))
  }

  /** Transition every dependency-resolved PENDING/BLOCKED task to READY. */
  async syncReadiness(): Promise<void> {
    await this.withMutationLock(async () => {
      await this.syncReadinessLocked()
    })
  }

  private async syncReadinessLocked(): Promise<void> {
    for (const taskId of this.topologicalOrder()) {
      const task = this.requireTask(taskId)
      if (task.status !== 'PENDING' && task.status !== 'BLOCKED') continue
      const dependencyStates = task.dependencies.map(id => this.requireTask(id).status)
      if (dependencyStates.some(status => status === 'FAILED' || status === 'CANCELLED' || status === 'BLOCKED')) {
        if (task.status !== 'BLOCKED') {
          await this.replaceTask(task, { status: 'BLOCKED' }, 'task/blocked', 'dependency is not viable')
        }
        continue
      }
      if (dependencyStates.every(status => status === 'COMPLETED')) {
        await this.replaceTask(task, { status: 'READY' }, 'task/ready', 'all dependencies completed')
      }
    }
  }

  /**
   * Assign and start one READY task.
   * @param taskId - READY task.
   * @param agentId - selected Agent.
   * @returns the committed RUNNING task.
   */
  async startTask(taskId: TaskIdType, agentId: AgentIdType): Promise<TaskSnapshot> {
    return await this.withMutationLock(async () => {
      const task = this.requireStatus(taskId, 'READY')
      return await this.replaceTask(
        task,
        { status: 'RUNNING', assignedAgentId: agentId },
        'task/assigned',
        `assigned to ${agentId}`,
      )
    })
  }

  /**
   * Complete one RUNNING task.
   * @param taskId - running task.
   * @param result - durable structured result.
   * @param execution - optional running execution settled in the same transaction.
   * @returns the committed COMPLETED task.
   */
  async completeTask(
    taskId: TaskIdType,
    result: JsonValue,
    execution?: ExecutionSettlement,
  ): Promise<TaskSnapshot> {
    return await this.withMutationLock(async () => {
      const task = this.requireStatus(taskId, 'RUNNING')
      const completed = await this.replaceTask(
        task,
        { status: 'COMPLETED', result, failure: undefined },
        'task/completed',
        undefined,
        execution === undefined
          ? undefined
          : {
            executionId: execution.executionId,
            status: 'COMPLETED',
            sessionId: execution.sessionId,
          },
      )
      await this.syncReadinessLocked()
      return completed
    })
  }

  /**
   * Fail one RUNNING task and automatically block every unfinished descendant.
   * @param taskId - running task.
   * @param failure - structured failure.
   * @param execution - optional running execution settled in the same transaction.
   * @returns the committed FAILED task.
   */
  async failTask(
    taskId: TaskIdType,
    failure: TaskFailure,
    execution?: Pick<ExecutionSettlement, 'executionId'>,
  ): Promise<TaskSnapshot> {
    return await this.withMutationLock(async () => {
      const task = this.requireStatus(taskId, 'RUNNING')
      const failed = await this.replaceTask(
        task,
        { status: 'FAILED', failure },
        'task/failed',
        failure.message,
        execution === undefined
          ? undefined
          : {
            executionId: execution.executionId,
            status: 'FAILED',
            error: failure,
          },
      )
      await this.blockDownstream(taskId, `dependency ${taskId} failed`)
      return failed
    })
  }

  /**
   * Requeue a FAILED or CANCELLED task for one bounded retry.
   * @param taskId - failed task.
   * @param reason - reassignment explanation.
   * @param options - whether to exclude the previous Agent from the retry.
   * @returns the committed READY or BLOCKED task.
   */
  async requeueTask(
    taskId: TaskIdType,
    reason: string,
    options: RequeueOptions = {},
  ): Promise<TaskSnapshot> {
    return await this.withMutationLock(async () => {
      const task = this.requireTask(taskId)
      if (task.status !== 'FAILED' && task.status !== 'CANCELLED') {
        throw new DagError(`task "${taskId}" cannot be requeued from ${task.status}`, 'INVALID_TRANSITION')
      }
      const excludePreviousAgent = options.excludePreviousAgent ?? true
      const excluded = task.assignedAgentId === undefined
        ? task.excludedAgentIds
        : excludePreviousAgent
          ? task.excludedAgentIds.includes(task.assignedAgentId)
            ? task.excludedAgentIds
            : [...task.excludedAgentIds, task.assignedAgentId]
          : task.excludedAgentIds.filter(agentId => agentId !== task.assignedAgentId)
      const requeued = await this.replaceTask(
        task,
        {
          status: 'PENDING',
          assignedAgentId: undefined,
          retryCount: task.retryCount + 1,
          excludedAgentIds: excluded,
        },
        'task/requeued',
        reason,
      )
      await this.syncReadinessLocked()
      return this.getTask(requeued.id)
    })
  }

  /**
   * Cancel one unfinished task and block its descendants.
   * @param taskId - task to cancel.
   * @returns the committed CANCELLED task.
   */
  async cancelTask(taskId: TaskIdType): Promise<TaskSnapshot> {
    return await this.withMutationLock(async () => {
      const task = this.requireTask(taskId)
      if (task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'CANCELLED') {
        throw new DagError(`task "${taskId}" cannot be cancelled from ${task.status}`, 'INVALID_TRANSITION')
      }
      const cancelled = await this.replaceTask(task, { status: 'CANCELLED' }, 'task/cancelled')
      await this.blockDownstream(taskId, `dependency ${taskId} was cancelled`)
      return cancelled
    })
  }

  /**
   * Check whether every task reached a terminal state.
   * @returns whether all tasks are terminal.
   */
  isComplete(): boolean {
    return [...this.tasksById.values()].every(task =>
      task.status === 'COMPLETED' || task.status === 'FAILED' || task.status === 'CANCELLED',
    )
  }

  private async blockDownstream(taskId: TaskIdType, reason: string): Promise<void> {
    const queue = [taskId]
    const visited = new Set<TaskIdType>()
    while (queue.length > 0) {
      const current = queue.shift()
      if (current === undefined) break
      if (visited.has(current)) continue
      visited.add(current)
      for (const task of this.tasksById.values()) {
        if (!task.dependencies.includes(current)) continue
        if (task.status === 'PENDING' || task.status === 'READY') {
          await this.replaceTask(task, { status: 'BLOCKED' }, 'task/blocked', reason)
        }
        queue.push(task.id)
      }
    }
  }

  private requireTask(taskId: TaskIdType): TaskSnapshot {
    const task = this.tasksById.get(taskId)
    if (task === undefined) throw new DagError(`task "${taskId}" does not exist`, 'TASK_NOT_FOUND')
    return task
  }

  private requireStatus(taskId: TaskIdType, status: TaskSnapshot['status']): TaskSnapshot {
    const task = this.requireTask(taskId)
    if (task.status !== status) {
      throw new DagError(`task "${taskId}" must be ${status}, got ${task.status}`, 'INVALID_TRANSITION')
    }
    return task
  }

  private async replaceTask(
    task: TaskSnapshot,
    changes: Partial<Pick<TaskSnapshot, 'status' | 'assignedAgentId' | 'result' | 'failure' | 'retryCount' | 'excludedAgentIds'>>,
    eventType: TaskJournalEventType,
    reason?: string,
    execution?: {
      readonly executionId: ExecutionIdType
      readonly status: 'COMPLETED' | 'FAILED' | 'CANCELLED'
      readonly sessionId?: string | undefined
      readonly error?: TaskFailure | undefined
    },
  ): Promise<TaskSnapshot> {
    const next: TaskSnapshot = {
      ...task,
      ...changes,
      revision: task.revision + 1,
      updatedAt: this.now().toISOString(),
    }
    if (execution === undefined) {
      await this.repository.saveTask(next, eventType, reason)
    } else {
      await this.repository.saveTaskAndFinishExecution(
        next,
        eventType,
        execution.executionId,
        execution.status,
        execution.sessionId,
        execution.error,
      )
    }
    this.tasksById.set(next.id, next)
    return next
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release: () => void = () => {}
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}

/** Stable task id ordering independent of locale. */
function compareTaskIds(left: TaskIdType, right: TaskIdType): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Convert validated planner strings into a durable task definition.
 * @param input - validated planner task fields.
 * @returns branded durable task definition.
 */
export function taskDefinition(input: {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly role: TaskDefinition['role']
  readonly priority: number
  readonly dependencies: readonly string[]
  readonly requiredCapabilities: Readonly<Record<string, number>>
  readonly writeScopes: readonly string[]
  readonly pageId?: string | undefined
}): TaskDefinition {
  return {
    ...input,
    id: TaskId(input.id),
    dependencies: input.dependencies.map(TaskId),
  }
}
