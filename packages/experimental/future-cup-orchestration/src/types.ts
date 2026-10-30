/** Public types for durable Future Cup DAG, scheduling, Agent execution, and verification. */

import type {
  AgentId,
  ExecutionId,
  ProjectId,
  RepairRecordId,
  TaskId,
  VerificationReportId,
  WorkflowRunId,
} from './brand.ts'
import type { AGENT_ROLES, TASK_STATUSES } from './domain.ts'

/** One JSON-compatible value retained in a task, report, or event payload. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

/** Durable task state. */
export type TaskStatus = typeof TASK_STATUSES[number]

/** Agent role in the M3 team. */
export type AgentRole = typeof AGENT_ROLES[number]

/** Agent roles that can appear as executable DAG tasks. */
export type TaskRole = Exclude<AgentRole, 'planner' | 'repair'>

/** Immutable input needed to create one DAG node. */
export interface TaskDefinition {
  readonly id: TaskId
  readonly title: string
  readonly description: string
  readonly role: TaskRole
  readonly priority: number
  readonly dependencies: readonly TaskId[]
  readonly requiredCapabilities: Readonly<Record<string, number>>
  readonly writeScopes: readonly string[]
  readonly pageId?: string | undefined
}

/** Structured task failure retained for scheduling and repair decisions. */
export interface TaskFailure {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

/** Whole durable task snapshot; every mutation increments {@link revision}. */
export interface TaskSnapshot extends TaskDefinition {
  readonly projectId: ProjectId
  readonly status: TaskStatus
  readonly revision: number
  readonly retryCount: number
  readonly excludedAgentIds: readonly AgentId[]
  readonly assignedAgentId?: AgentId | undefined
  readonly result?: JsonValue | undefined
  readonly failure?: TaskFailure | undefined
  readonly createdAt: string
  readonly updatedAt: string
}

/** Durable project input and identity. */
export interface ProjectRecord {
  readonly id: ProjectId
  readonly name: string
  readonly requirement: string
  readonly createdAt: string
}

/** Kinds of task mutations retained in the append-only journal. */
export type TaskJournalEventType =
  | 'task/created'
  | 'task/ready'
  | 'task/blocked'
  | 'task/assigned'
  | 'task/completed'
  | 'task/failed'
  | 'task/requeued'
  | 'task/cancelled'

/** One append-only task revision. */
export interface TaskJournalEntry {
  readonly seq: number
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly revision: number
  readonly eventType: TaskJournalEventType
  readonly reason?: string | undefined
  readonly snapshot: TaskSnapshot
  readonly createdAt: string
}

/** Configurable weights for the explainable scheduler formula. */
export interface SchedulerWeights {
  readonly capability: number
  readonly success: number
  readonly availability: number
  readonly priority: number
  readonly loadPenalty: number
}

/** Runtime capacity and historical performance for one Agent instance. */
export interface AgentProfile {
  readonly id: AgentId
  readonly name: string
  readonly role: AgentRole
  readonly capabilities: Readonly<Record<string, number>>
  readonly maxConcurrency: number
  readonly currentLoad: number
  readonly historicalSuccessRate: number
  readonly available: boolean
}

/** One weighted contribution to a candidate score. */
export interface SchedulerScoreTerms {
  readonly capabilityMatch: number
  readonly capabilityContribution: number
  readonly successContribution: number
  readonly availabilityContribution: number
  readonly priorityContribution: number
  readonly loadPenaltyContribution: number
}

/** One candidate considered for a task assignment. */
export interface SchedulerCandidate {
  readonly agentId: AgentId
  readonly eligible: boolean
  readonly rejectionReason?: string | undefined
  readonly loadRatio: number
  readonly score: number
  readonly terms: SchedulerScoreTerms
}

/** Durable explanation for one task assignment. */
export interface SchedulerDecision {
  readonly id: string
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly selectedAgentId: AgentId
  readonly candidates: readonly SchedulerCandidate[]
  readonly selectedReason: string
  readonly previousAgentId?: AgentId | undefined
  readonly reassignReason?: string | undefined
  readonly createdAt: string
}

/** One task-to-Agent assignment produced by a scheduling round. */
export interface ScheduledAssignment {
  readonly task: TaskSnapshot
  readonly agent: AgentProfile
  readonly decision: SchedulerDecision
}

/** Durable execution lifecycle. */
export type ExecutionStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED'

/** One Agent task execution. */
export interface ExecutionRecord {
  readonly id: ExecutionId
  readonly projectId: ProjectId
  readonly taskId: TaskId
  readonly agentId: AgentId
  readonly sessionId?: string | undefined
  readonly status: ExecutionStatus
  readonly startedAt: string
  readonly completedAt?: string | undefined
  readonly error?: TaskFailure | undefined
}

/** One ordered execution event captured from the Agent runtime. */
export interface ExecutionEventRecord {
  readonly seq: number
  readonly executionId: ExecutionId
  readonly eventType: string
  readonly payload: JsonValue
  readonly createdAt: string
}

/** Verification verdicts retained for independent acceptance. */
export type VerificationStatus = 'PASS' | 'FAIL' | 'WARNING' | 'INCOMPLETE'

/** One independently attributable verification failure or warning. */
export interface VerificationFinding {
  readonly category: 'structure' | 'dependency' | 'typescript' | 'build' | 'server' | 'browser' | 'console' | 'network'
  readonly code: string
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly target?: string | undefined
}

/** One deterministic verification stage outcome. */
export interface VerificationCheck {
  readonly name: string
  readonly status: 'PASS' | 'FAIL' | 'WARNING' | 'SKIPPED'
  readonly summary: string
}

/** Complete report persisted before a repair decision. */
export interface VerificationReportData {
  readonly verifier: 'future-cup-m3'
  readonly status: VerificationStatus
  readonly failureSignature: string | null
  readonly checks: readonly VerificationCheck[]
  readonly findings: readonly VerificationFinding[]
  readonly routes: readonly string[]
  readonly viewports: readonly string[]
  readonly screenshots: readonly string[]
}

/** Independent verification result before repository identity is assigned. */
export interface VerificationResult {
  readonly status: VerificationStatus
  readonly report: VerificationReportData
}

/** One durable build or browser verification report. */
export interface VerificationReport {
  readonly id: VerificationReportId
  readonly projectId: ProjectId
  readonly taskId?: TaskId | undefined
  readonly status: VerificationStatus
  readonly failureSignature?: string | undefined
  readonly report: JsonValue
  readonly createdAt: string
}

/** Terminal state of one project's M3 workflow. */
export type WorkflowStatus = 'RUNNING' | 'PASSED' | 'ESCALATED'

/** Reasons that stop automatic repair and require a human decision. */
export type EscalationReason =
  | 'MAX_REPAIR_ROUNDS'
  | 'REPEATED_FAILURE'
  | 'REPAIR_TIMEOUT'
  | 'REPAIR_FAILED'
  | 'VERIFIER_INCOMPLETE'

/** Durable project workflow state and visible manual escalation. */
export interface WorkflowRunRecord {
  readonly id: WorkflowRunId
  readonly projectId: ProjectId
  readonly status: WorkflowStatus
  readonly repairRound: number
  readonly escalationReason?: EscalationReason | undefined
  readonly escalationMessage?: string | undefined
  readonly createdAt: string
  readonly updatedAt: string
}

/** One completed automatic repair attempt. */
export interface RepairRecord {
  readonly id: RepairRecordId
  readonly projectId: ProjectId
  readonly repairRound: number
  readonly verificationReportId: VerificationReportId
  readonly repairAgentId: AgentId
  readonly failureSignature: string
  readonly errorSummary: string
  readonly changeSummary: string
  readonly diff: string
  readonly beforeStatus: VerificationStatus
  readonly afterStatus: VerificationStatus
  readonly startedAt: string
  readonly completedAt: string
}

/** Repository-owned fields needed to persist one completed repair attempt. */
export interface RepairRecordDraft {
  readonly repairRound: number
  readonly verificationReportId: VerificationReportId
  readonly repairAgentId: AgentId
  readonly failureSignature: string
  readonly errorSummary: string
  readonly changeSummary: string
  readonly diff: string
  readonly beforeStatus: VerificationStatus
  readonly afterStatus: VerificationStatus
  readonly startedAt: string
  readonly completedAt: string
}

/** One page the Planner expects the frontend team to build. */
export interface PlannedPage {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly path: string
  readonly route: string
  readonly navigationLabel: string
}

/** One task emitted by the Planner. */
export interface PlannedTask {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly role: TaskRole
  readonly dependencies: readonly string[]
  readonly requiredCapabilities: Readonly<Record<string, number>>
  readonly writeScopes: readonly string[]
  readonly priority: number
  readonly pageId?: string | undefined
}

/** Planner structured output. */
export interface PlannerOutput {
  readonly projectName: string
  readonly pages: readonly PlannedPage[]
  readonly tasks: readonly PlannedTask[]
}

/** One validated source file proposed by an Agent. */
export interface FilePlan {
  readonly path: string
  readonly content: string
}

/** UI Designer structured output. */
export interface UiDesignTokens {
  readonly background: string
  readonly surface: string
  readonly text: string
  readonly muted: string
  readonly accent: string
  readonly border: string
  readonly danger: string
  readonly fontFamily: string
  readonly cardRadius: number
  readonly spacingUnit: number
}

/** UI Designer structured output. */
export interface UiDesignerOutput {
  readonly summary: string
  readonly designSpec: string
  readonly tokens: UiDesignTokens
}

/** Frontend Agent structured output. */
export interface FrontendOutput {
  readonly pageId: string
  readonly summary: string
  readonly files: readonly FilePlan[]
}

/** Integration Agent structured output. */
export interface IntegrationOutput {
  readonly summary: string
  readonly files: readonly FilePlan[]
}

/** One expected page assertion generated by the Tester Agent. */
export interface TesterPageSpec {
  readonly pageId: string
  readonly route: string
  readonly navigationLabel: string
  readonly requiredText: readonly string[]
}

/** One cross-page navigation interaction generated by the Tester Agent. */
export interface TesterInteraction {
  readonly fromRoute: string
  readonly clickText: string
  readonly expectedRoute: string
  readonly expectedText: string
}

/** Tester structured output consumed by frontend, integration, and Verifier. */
export interface TesterOutput {
  readonly summary: string
  readonly pages: readonly TesterPageSpec[]
  readonly interactions: readonly TesterInteraction[]
}

/** Repair Agent structured output containing bounded source-file replacements. */
export interface RepairOutput {
  readonly diagnosis: string
  readonly summary: string
  readonly files: readonly FilePlan[]
}

/** Explicit bounds owned by the self-loop controller. */
export interface SelfLoopConfig {
  readonly maxRepairRounds: number
  readonly repairTimeoutMs: number
}

/** One completed generation phase before independent verification. */
export interface GeneratedProject {
  readonly projectId: ProjectId
  readonly planner: PlannerOutput
  readonly verificationSpec: TesterOutput
  readonly tasks: readonly TaskSnapshot[]
  readonly decisions: readonly SchedulerDecision[]
  readonly executions: readonly ExecutionRecord[]
  readonly workspace: string
}

/** Verification and repair outcome for one generated project. */
export interface SelfHealingResult {
  readonly verification: VerificationReport
  readonly verificationReports: readonly VerificationReport[]
  readonly repairs: readonly RepairRecord[]
  readonly workflow: WorkflowRunRecord
}

/** Final outcome of one complete M3 project run. */
export interface TeamRunResult {
  readonly projectId: ProjectId
  readonly planner: PlannerOutput
  readonly verificationSpec: TesterOutput
  readonly tasks: readonly TaskSnapshot[]
  readonly decisions: readonly SchedulerDecision[]
  readonly executions: readonly ExecutionRecord[]
  readonly verification: VerificationReport
  readonly verificationReports: readonly VerificationReport[]
  readonly repairs: readonly RepairRecord[]
  readonly workflow: WorkflowRunRecord
  readonly workspace: string
}
