/** Pure mapping from committed Future Cup project events to HQ scene actions. */

import type { ProductEventView } from '../api/contracts.ts'
import type { HqProjection } from './projection.ts'

/** Visual severity used by the HQ renderer. */
export type HqAnimationTone = 'info' | 'active' | 'success' | 'warning' | 'error'

/** One scene action derived from a realtime project event. */
export type HqAnimationAction =
  | {
    readonly kind: 'flow'
    readonly eventType: ProductEventView['type']
    readonly tone: HqAnimationTone
    readonly label: string
    readonly fromDepartment: string
    readonly toDepartment: string
    readonly taskId?: string | undefined
  }
  | {
    readonly kind: 'agent'
    readonly eventType: ProductEventView['type']
    readonly tone: HqAnimationTone
    readonly label: string
    readonly agentId: string
    readonly taskId?: string | undefined
  }
  | {
    readonly kind: 'department'
    readonly eventType: ProductEventView['type']
    readonly tone: HqAnimationTone
    readonly label: string
    readonly department: string
    readonly taskId?: string | undefined
  }
  | {
    readonly kind: 'terminal'
    readonly eventType: ProductEventView['type']
    readonly tone: HqAnimationTone
    readonly label: string
  }

/**
 * Return actions only when an event changed the projection.
 * @param previous - projection before applying the event.
 * @param next - projection after applying the event.
 * @param event - validated event received from Socket.IO.
 * @returns no actions for duplicates; otherwise the event's visual actions.
 */
export function animationActionsForTransition(
  previous: HqProjection,
  next: HqProjection,
  event: ProductEventView,
): readonly HqAnimationAction[] {
  return next === previous ? [] : animationActionsForEvent(event, next)
}

/**
 * Map one committed event to visual actions after its projection has been applied.
 * @param event - validated product event received from Socket.IO.
 * @param projection - projection after applying the event.
 * @returns ordered actions for the HQ animation adapter.
 */
export function animationActionsForEvent(
  event: ProductEventView,
  projection: HqProjection,
): readonly HqAnimationAction[] {
  const task = event.taskId === undefined
    ? undefined
    : projection.tasks.find(value => value.id === event.taskId)
  const agent = event.agentId === undefined
    ? undefined
    : projection.agents.find(value => value.id === event.agentId)
  const assignedAgent = task?.assignedAgentId === undefined
    ? undefined
    : projection.agents.find(value => value.id === task.assignedAgentId)
  const department = agent?.department ?? assignedAgent?.department
  const taskLabel = task?.title ?? event.taskId ?? '任务'

  switch (event.type) {
    case 'task.created':
    case 'task.planned':
      return [{
        kind: 'department',
        eventType: event.type,
        tone: 'info',
        label: `规划 · ${taskLabel}`,
        department: 'planning',
        taskId: event.taskId,
      }]
    case 'task.ready':
      return [departmentAction(event, department, 'active', `就绪 · ${taskLabel}`)]
    case 'task.blocked':
      return [departmentAction(event, department, 'warning', `阻断 · ${taskLabel}`)]
    case 'task.cancelled':
      return [departmentAction(event, department, 'warning', `取消 · ${taskLabel}`)]
    case 'task.dispatched':
      return [{
        kind: 'flow',
        eventType: event.type,
        tone: 'active',
        label: `调度 · ${taskLabel}`,
        fromDepartment: 'planning',
        toDepartment: department ?? 'planning',
        taskId: event.taskId,
      }]
    case 'task.completed':
      return [{
        kind: 'flow',
        eventType: event.type,
        tone: 'success',
        label: `完成 · ${taskLabel}`,
        fromDepartment: department ?? 'planning',
        toDepartment: 'delivery',
        taskId: event.taskId,
      }]
    case 'task.failed':
      return [departmentAction(event, department, 'error', `失败 · ${taskLabel}`)]
    case 'agent.started':
      return [agentAction(event, agent?.id, 'active', `开始执行 · ${taskLabel}`)]
    case 'agent.progress':
      return [agentAction(event, agent?.id, 'active', `执行中 · ${taskLabel}`)]
    case 'agent.tool.called':
      return [agentAction(event, agent?.id, 'info', `调用工具 · ${taskLabel}`)]
    case 'agent.completed':
      return [agentAction(event, agent?.id, 'success', `执行完成 · ${taskLabel}`)]
    case 'agent.failed':
      return [agentAction(event, agent?.id, 'error', `执行失败 · ${taskLabel}`)]
    case 'agent.cancelled':
      return [agentAction(event, agent?.id, 'warning', `执行取消 · ${taskLabel}`)]
    case 'verification.started':
      return [departmentAction(event, 'verification', 'active', '开始独立验证')]
    case 'verification.failed':
      return [departmentAction(event, 'verification', 'error', '验证失败 · 进入修复')]
    case 'verification.passed':
      return [departmentAction(event, 'verification', 'success', '验证通过')]
    case 'verification.incomplete':
      return [departmentAction(event, 'verification', 'warning', '验证证据不完整')]
    case 'repair.started':
      return [
        {
          kind: 'flow',
          eventType: event.type,
          tone: 'warning',
          label: '失败报告 · 送往自愈部',
          fromDepartment: 'verification',
          toDepartment: 'repair',
        },
        departmentAction(event, 'repair', 'active', '修复 Agent 开始诊断'),
      ]
    case 'repair.completed':
      return [
        {
          kind: 'flow',
          eventType: event.type,
          tone: 'info',
          label: '修复结果 · 返回验证部',
          fromDepartment: 'repair',
          toDepartment: 'verification',
        },
        departmentAction(event, 'repair', 'success', '修复完成 · 重新验证'),
      ]
    case 'workflow.escalated':
      return [{
        kind: 'terminal',
        eventType: event.type,
        tone: 'error',
        label: '自动修复耗尽 · 需要人工介入',
      }]
    case 'run.started':
      return [{
        kind: 'terminal',
        eventType: event.type,
        tone: 'info',
        label: '项目运行开始',
      }]
    case 'run.completed':
      return [{
        kind: 'terminal',
        eventType: event.type,
        tone: projection.runStatus === 'PASSED' ? 'success' : 'warning',
        label: projection.runStatus === 'PASSED' ? '项目验证通过 · 交付归档' : '项目运行结束 · 已升级',
      }]
    case 'run.failed':
      return [{
        kind: 'terminal',
        eventType: event.type,
        tone: 'error',
        label: '项目运行失败',
      }]
    case 'run.cancelled':
      return [{
        kind: 'terminal',
        eventType: event.type,
        tone: 'warning',
        label: '项目运行已取消',
      }]
  }
}

function departmentAction(
  event: ProductEventView,
  department: string | undefined,
  tone: HqAnimationTone,
  label: string,
): HqAnimationAction {
  return {
    kind: 'department',
    eventType: event.type,
    tone,
    label,
    department: department ?? 'planning',
    taskId: event.taskId,
  }
}

function agentAction(
  event: ProductEventView,
  agentId: string | undefined,
  tone: HqAnimationTone,
  label: string,
): HqAnimationAction {
  return {
    kind: 'agent',
    eventType: event.type,
    tone,
    label,
    agentId: agentId ?? event.agentId ?? 'planner',
    taskId: event.taskId,
  }
}
