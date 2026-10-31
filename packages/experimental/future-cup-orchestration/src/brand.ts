/** Branded Future Cup orchestration identities. */

import { brandString, type Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one Future Cup project. */
export type ProjectId = Branded<'FutureCupProjectId'>

/**
 * Brand a project id admitted by the orchestration parser.
 * @param value - validated project id.
 * @returns the branded project id.
 */
export function ProjectId(value: string): ProjectId {
  return brandString<ProjectId>(value)
}

/** Identifies one task in a project DAG. */
export type TaskId = Branded<'FutureCupTaskId'>

/**
 * Brand a task id admitted by the orchestration parser.
 * @param value - validated task id.
 * @returns the branded task id.
 */
export function TaskId(value: string): TaskId {
  return brandString<TaskId>(value)
}

/** Identifies one configured Agent instance. */
export type AgentId = Branded<'FutureCupAgentId'>

/**
 * Brand an Agent id admitted by configuration.
 * @param value - validated Agent id.
 * @returns the branded Agent id.
 */
export function AgentId(value: string): AgentId {
  return brandString<AgentId>(value)
}

/** Identifies one durable Agent execution. */
export type ExecutionId = Branded<'FutureCupExecutionId'>

/**
 * Brand an execution id created by the repository.
 * @param value - generated execution id.
 * @returns the branded execution id.
 */
export function ExecutionId(value: string): ExecutionId {
  return brandString<ExecutionId>(value)
}

/** Identifies one durable verification report. */
export type VerificationReportId = Branded<'FutureCupVerificationReportId'>

/**
 * Brand a verification report id created by the repository.
 * @param value - generated verification report id.
 * @returns the branded report id.
 */
export function VerificationReportId(value: string): VerificationReportId {
  return brandString<VerificationReportId>(value)
}

/** Identifies one durable self-loop repair attempt. */
export type RepairRecordId = Branded<'FutureCupRepairRecordId'>

/**
 * Brand a repair record id created by the repository.
 * @param value - generated repair record id.
 * @returns the branded repair record id.
 */
export function RepairRecordId(value: string): RepairRecordId {
  return brandString<RepairRecordId>(value)
}

/** Identifies one durable project workflow run. */
export type WorkflowRunId = Branded<'FutureCupWorkflowRunId'>

/**
 * Brand a workflow run id created by the repository.
 * @param value - generated workflow run id.
 * @returns the branded workflow run id.
 */
export function WorkflowRunId(value: string): WorkflowRunId {
  return brandString<WorkflowRunId>(value)
}

/** Identifies one durable Future Cup project run. */
export type ProjectRunId = Branded<'FutureCupProjectRunId'>

/**
 * Brand a project-run id created by the platform repository.
 * @param value - generated project-run id.
 * @returns the branded project-run id.
 */
export function ProjectRunId(value: string): ProjectRunId {
  return brandString<ProjectRunId>(value)
}
