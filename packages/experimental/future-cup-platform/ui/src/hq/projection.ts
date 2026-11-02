/** Pure projection from persisted Future Cup snapshots and product events to the HQ display. */

import {
  executionSchema,
  projectSnapshotSchema,
  productEventSchema,
  repairSchema,
  taskSchema,
} from '../api/contracts.ts'
import type {
  AgentView,
  ProductEventView,
  ProjectSnapshotView,
  RepairView,
  TaskView,
  VerificationReportView,
} from '../api/contracts.ts'

/** Stable role-to-department mapping used by the seven real Agent workstations. */
export const HQ_DEPARTMENTS = [
  { key: 'planning', name: '规划部', english: 'PLANNER', color: '#ffb547' },
  { key: 'design', name: '设计部', english: 'UI DESIGN', color: '#ff7eb6' },
  { key: 'frontend-a', name: '页面 A 部', english: 'FRONTEND A', color: '#5cc8ff' },
  { key: 'frontend-b', name: '页面 B 部', english: 'FRONTEND B', color: '#7bdff2' },
  { key: 'integration', name: '集成部', english: 'INTEGRATION', color: '#84dcc6' },
  { key: 'verification', name: '验证部', english: 'VERIFY', color: '#c8e05a' },
  { key: 'repair', name: '自愈部', english: 'REPAIR', color: '#b8a1ff' },
] as const

/** One HQ department state derived from real tasks and Agents. */
export interface HqDepartmentProjection {
  readonly key: string
  readonly name: string
  readonly english: string
  readonly color: string
  readonly status: 'IDLE' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'FAILED'
  readonly progress: number
  readonly activeTaskIds: readonly string[]
  readonly completedTasks: number
  readonly failedTasks: number
  readonly totalTasks: number
}

/** One real Agent workstation state. */
export interface HqAgentProjection {
  readonly id: string
  readonly name: string
  readonly role: string
  readonly department: string
  readonly position?: number | undefined
  readonly capabilities: Readonly<Record<string, number>>
  readonly maxConcurrency: number
  readonly currentLoad: number
  readonly historicalSuccessRate: number
  readonly configuredAvailable: boolean
  readonly available: boolean
  readonly status: 'IDLE' | 'RUNNING' | 'FAILED' | 'OFFLINE'
  readonly activeTaskId?: string | undefined
}

/** One durable task rendered by the HQ DAG and department panels. */
export interface HqTaskProjection {
  readonly id: string
  readonly title: string
  readonly role: string
  readonly status: TaskView['status']
  readonly priority: number
  readonly assignedAgentId?: string | undefined
  readonly failure?: TaskView['failure'] | undefined
  readonly updatedAt: string
}

/** Latest verification state shown by the HQ warning surface. */
export interface HqVerificationProjection {
  readonly status: 'PENDING' | 'RUNNING' | 'PASS' | 'FAIL' | 'WARNING' | 'INCOMPLETE'
  readonly reportId?: string | undefined
  readonly failureSignature?: string | undefined
  readonly findings: number
}

/** One Self-Loop repair summary. */
export interface HqRepairProjection {
  readonly round: number
  readonly beforeStatus: string
  readonly afterStatus: string
  readonly failureSignature: string
  readonly completed: boolean
}

/** One realtime event rendered in the HQ activity log. */
export interface HqEventProjection {
  readonly seq: number
  readonly type: ProductEventView['type']
  readonly occurredAt: string
  readonly taskId?: string | undefined
  readonly agentId?: string | undefined
  readonly message: string
}

/** Complete browser-safe projection consumed by the HQ WebGL adapter. */
export interface HqProjection {
  readonly projectId: string
  readonly projectName: string
  readonly requirement: string
  readonly lastEventSeq: number
  readonly runStatus: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'ESCALATED'
  readonly workflowStatus: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED' | 'ESCALATED'
  readonly tasks: readonly HqTaskProjection[]
  readonly agents: readonly HqAgentProjection[]
  readonly departments: readonly HqDepartmentProjection[]
  readonly verification: HqVerificationProjection
  readonly repairs: readonly HqRepairProjection[]
  readonly events: readonly HqEventProjection[]
  readonly updatedAt: string
}

/** Build the initial HQ projection from the authoritative REST snapshot. */
export function createProjection(
  snapshot: ProjectSnapshotView,
  agents: readonly AgentView[],
): HqProjection {
  const tasks = snapshot.tasks.map(taskProjection)
  const projectedAgents = agents.map(agent => agentProjection(agent, tasks))
  const latestRun = snapshot.runs.at(-1)
  return {
    projectId: snapshot.project.id,
    projectName: snapshot.project.name,
    requirement: snapshot.project.requirement,
    lastEventSeq: snapshot.lastEventSeq,
    runStatus: latestRun?.status ?? 'PENDING',
    workflowStatus: snapshot.workflow?.status ?? 'PENDING',
    tasks,
    agents: projectedAgents,
    departments: departmentsFor(tasks, projectedAgents),
    verification: verificationProjection(snapshot.verificationReports.at(-1)),
    repairs: snapshot.repairs.map(repairProjection),
    events: snapshot.events.map(eventProjection),
    updatedAt: new Date().toISOString(),
  }
}

/** Apply one ordered product event without duplicating replayed events. */
export function applyProductEvent(
  projection: HqProjection,
  event: ProductEventView,
): HqProjection {
  if (event.projectId !== projection.projectId || event.seq <= projection.lastEventSeq) {
    return projection
  }
  let tasks = [...projection.tasks]
  let agents = [...projection.agents]
  let verification = projection.verification
  let repairs = [...projection.repairs]
  let runStatus = projection.runStatus
  let workflowStatus = projection.workflowStatus

  if (event.type.startsWith('task.')) {
    const parsed = taskSchema.safeParse(event.payload)
    if (parsed.success) {
      tasks = upsertTask(tasks, taskProjection(parsed.data))
    } else if (event.type === 'task.dispatched' && event.taskId !== undefined) {
      tasks = tasks.map(task => task.id === event.taskId
        ? { ...task, status: 'RUNNING', assignedAgentId: event.agentId ?? task.assignedAgentId }
        : task)
    }
  }
  if (event.type === 'agent.started' && event.taskId !== undefined) {
    tasks = tasks.map(task => task.id === event.taskId
      ? { ...task, status: 'RUNNING', assignedAgentId: event.agentId ?? task.assignedAgentId }
      : task)
  }
  if (event.type === 'agent.failed' && event.taskId !== undefined) {
    tasks = tasks.map(task => task.id === event.taskId
      ? task.status === 'FAILED'
        ? task
        : { ...task, status: 'FAILED', failure: { code: 'AGENT_FAILED', message: 'Agent execution failed', retryable: true } }
      : task)
  }
  if (event.type === 'agent.cancelled' && event.taskId !== undefined) {
    tasks = tasks.map(task => task.id === event.taskId
      ? task.status === 'CANCELLED' ? task : { ...task, status: 'CANCELLED' }
      : task)
  }
  if (event.type === 'verification.started') {
    verification = { status: 'RUNNING', findings: 0 }
  }
  if (event.type === 'verification.failed') {
    verification = {
      status: 'FAIL',
      reportId: readString(event.payload, 'verificationReportId'),
      failureSignature: readString(event.payload, 'failureSignature'),
      findings: 1,
    }
  }
  if (event.type === 'verification.incomplete') {
    verification = { status: 'INCOMPLETE', findings: 1 }
  }
  if (event.type === 'verification.passed') {
    verification = {
      status: 'PASS',
      reportId: readString(event.payload, 'verificationReportId'),
      findings: 0,
    }
  }
  if (event.type === 'repair.started') {
    repairs = upsertRepair(repairs, {
      round: repairs.length + 1,
      beforeStatus: 'FAIL',
      afterStatus: 'RUNNING',
      failureSignature: '',
      completed: false,
    })
  }
  if (event.type === 'repair.completed') {
    const parsed = repairSchema.safeParse(event.payload)
    if (parsed.success) repairs = upsertRepair(repairs, repairProjection(parsed.data))
  }
  if (event.type === 'run.started') runStatus = 'RUNNING'
  if (event.type === 'run.completed') {
    runStatus = readRunStatus(event.payload) ?? 'PASSED'
    if (runStatus === 'PASSED') workflowStatus = 'PASSED'
  }
  if (event.type === 'run.failed') runStatus = readRunStatus(event.payload) ?? 'FAILED'
  if (event.type === 'run.cancelled') runStatus = readRunStatus(event.payload) ?? 'CANCELLED'
  if (event.type === 'workflow.escalated') workflowStatus = 'ESCALATED'

  agents = agents.map(agent => refreshAgentProjection(agent, tasks))
  return {
    ...projection,
    lastEventSeq: event.seq,
    runStatus,
    workflowStatus,
    tasks,
    agents,
    departments: departmentsFor(tasks, agents),
    verification,
    repairs,
    events: [...projection.events, eventProjection(event)].slice(-100),
    updatedAt: event.occurredAt,
  }
}

/** Whether an event skipped one or more project sequence values and needs a snapshot resync. */
export function needsSnapshotResync(
  projection: HqProjection,
  event: ProductEventView,
): boolean {
  return event.projectId === projection.projectId && event.seq > projection.lastEventSeq + 1
}

/** Validate a Socket.IO snapshot before replacing the authoritative projection. */
export function parseSnapshot(value: unknown): ProjectSnapshotView | undefined {
  const parsed = projectSnapshotSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Validate one Socket.IO event before applying it. */
export function parseProductEvent(value: unknown): ProductEventView | undefined {
  const parsed = productEventSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

function taskProjection(task: TaskView): HqTaskProjection {
  return {
    id: task.id,
    title: task.title,
    role: task.role,
    status: task.status,
    priority: task.priority,
    ...task.assignedAgentId === undefined ? {} : { assignedAgentId: task.assignedAgentId },
    ...task.failure === undefined ? {} : { failure: task.failure },
    updatedAt: task.updatedAt,
  }
}

function agentProjection(agent: AgentView, tasks: readonly HqTaskProjection[]): HqAgentProjection {
  return refreshAgentProjection({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    department: agent.departmentKey ?? departmentForAgent(agent.id, agent.role),
    ...agent.position === undefined ? {} : { position: agent.position },
    capabilities: agent.capabilities,
    maxConcurrency: agent.maxConcurrency,
    currentLoad: agent.currentLoad,
    historicalSuccessRate: agent.historicalSuccessRate,
    configuredAvailable: agent.available || agent.currentLoad >= agent.maxConcurrency,
    available: agent.available,
    status: 'IDLE',
  }, tasks)
}

function refreshAgentProjection(
  agent: HqAgentProjection,
  tasks: readonly HqTaskProjection[],
): HqAgentProjection {
  const running = tasks.filter(task => task.status === 'RUNNING' && task.assignedAgentId === agent.id)
  const failed = tasks.some(task => task.status === 'FAILED' && task.assignedAgentId === agent.id)
  const available = agent.configuredAvailable && running.length < agent.maxConcurrency
  const status = running.length > 0
    ? 'RUNNING'
    : failed
      ? 'FAILED'
      : available ? 'IDLE' : 'OFFLINE'
  return {
    ...agent,
    currentLoad: running.length,
    available,
    status,
    activeTaskId: running[0]?.id,
  }
}

function departmentsFor(
  tasks: readonly HqTaskProjection[],
  agents: readonly HqAgentProjection[],
): readonly HqDepartmentProjection[] {
  return HQ_DEPARTMENTS.map((department) => {
    const departmentTasks = tasks.filter(task => departmentForTask(task, agents) === department.key)
    const activeTaskIds = departmentTasks.filter(task => task.status === 'RUNNING').map(task => task.id)
    const failedTasks = departmentTasks.filter(task => task.status === 'FAILED').length
    const completedTasks = departmentTasks.filter(task => task.status === 'COMPLETED').length
    const totalTasks = departmentTasks.length
    const status = failedTasks > 0
      ? 'FAILED'
      : activeTaskIds.length > 0
        ? 'ACTIVE'
        : totalTasks > 0 && completedTasks === totalTasks
          ? 'COMPLETED'
          : totalTasks > 0 ? 'READY' : 'IDLE'
    return {
      ...department,
      status,
      progress: totalTasks === 0 ? 0 : completedTasks / totalTasks,
      activeTaskIds,
      completedTasks,
      failedTasks,
      totalTasks,
    }
  })
}

function departmentForAgent(agentId: string, role: string): string {
  if (agentId === 'frontend-a') return 'frontend-a'
  if (agentId === 'frontend-b') return 'frontend-b'
  if (role === 'ui-designer') return 'design'
  if (role === 'integration') return 'integration'
  if (role === 'tester') return 'verification'
  if (role === 'repair') return 'repair'
  return 'planning'
}

function departmentForTask(task: HqTaskProjection, agents: readonly HqAgentProjection[]): string {
  const agent = agents.find(value => value.id === task.assignedAgentId)
  return agent?.department ?? departmentForAgent(task.assignedAgentId ?? task.role, task.role)
}

function verificationProjection(report: VerificationReportView | undefined): HqVerificationProjection {
  if (report === undefined) return { status: 'PENDING', findings: 0 }
  return {
    status: report.status,
    reportId: report.id,
    ...report.failureSignature === undefined ? {} : { failureSignature: report.failureSignature },
    findings: report.report.findings.length,
  }
}

function repairProjection(repair: RepairView): HqRepairProjection {
  return {
    round: repair.repairRound,
    beforeStatus: repair.beforeStatus,
    afterStatus: repair.afterStatus,
    failureSignature: repair.failureSignature,
    completed: true,
  }
}

function eventProjection(event: ProductEventView): HqEventProjection {
  const payload = record(event.payload)
  return {
    seq: event.seq,
    type: event.type,
    occurredAt: event.occurredAt,
    ...event.taskId === undefined ? {} : { taskId: event.taskId },
    ...event.agentId === undefined ? {} : { agentId: event.agentId },
    message: [
      event.type,
      event.taskId === undefined ? undefined : event.taskId,
      event.agentId === undefined ? undefined : event.agentId,
      payload === undefined ? undefined : readString(payload, 'message'),
    ].filter((value): value is string => value !== undefined).join(' · '),
  }
}

function upsertTask(
  tasks: readonly HqTaskProjection[],
  next: HqTaskProjection,
): HqTaskProjection[] {
  return tasks.some(task => task.id === next.id)
    ? tasks.map(task => task.id === next.id ? next : task)
    : [...tasks, next]
}

function upsertRepair(
  repairs: readonly HqRepairProjection[],
  next: HqRepairProjection,
): HqRepairProjection[] {
  return repairs.some(repair => repair.round === next.round)
    ? repairs.map(repair => repair.round === next.round ? next : repair)
    : [...repairs, next]
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

function readString(value: unknown, key: string): string | undefined {
  const object = record(value)
  const field = object?.[key]
  return typeof field === 'string' ? field : undefined
}

function readRunStatus(value: unknown): HqProjection['runStatus'] | undefined {
  const status = readString(value, 'status')
  return status === 'PENDING'
    || status === 'RUNNING'
    || status === 'PASSED'
    || status === 'FAILED'
    || status === 'CANCELLED'
    || status === 'ESCALATED'
    ? status
    : undefined
}

/** Parse one execution payload without exposing an unchecked cast to callers. */
export function parseExecution(value: unknown): ReturnType<typeof executionSchema.safeParse> {
  return executionSchema.safeParse(value)
}
