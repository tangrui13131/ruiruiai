import { z } from 'zod'
import {
  projectDeliverySchema,
  projectRunCancelSchema,
  projectRunStartSchema,
  publicProjectRunSchema,
} from '../../../src/api-contracts.ts'

const identifierSchema = z.string().min(1)
const isoDateSchema = z.string().min(1)

export const taskStatusSchema = z.enum([
  'PENDING',
  'READY',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'BLOCKED',
  'CANCELLED',
])

export const projectRunStatusSchema = publicProjectRunSchema.shape.status

export const workflowStatusSchema = z.enum([
  'RUNNING',
  'PASSED',
  'FAILED',
  'CANCELLED',
  'ESCALATED',
])

export const verificationStatusSchema = z.enum(['PASS', 'FAIL', 'WARNING', 'INCOMPLETE'])

export const taskFailureSchema = z.looseObject({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
})

export const taskSchema = z.looseObject({
  id: identifierSchema,
  projectId: identifierSchema,
  title: z.string(),
  description: z.string(),
  role: z.string(),
  priority: z.number(),
  dependencies: z.array(identifierSchema),
  requiredCapabilities: z.record(z.string(), z.number()),
  writeScopes: z.array(z.string()),
  pageId: z.string().optional(),
  status: taskStatusSchema,
  revision: z.number(),
  retryCount: z.number(),
  excludedAgentIds: z.array(identifierSchema),
  assignedAgentId: z.string().optional(),
  result: z.unknown().optional(),
  failure: taskFailureSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

export const projectSchema = z.looseObject({
  id: identifierSchema,
  name: z.string(),
  requirement: z.string(),
  createdAt: isoDateSchema,
  lastEventSeq: z.number(),
  workflowStatus: workflowStatusSchema.optional(),
  latestRunStatus: projectRunStatusSchema.optional(),
})

export const agentSchema = z.looseObject({
  id: identifierSchema,
  name: z.string(),
  role: z.string(),
  capabilities: z.record(z.string(), z.number()),
  maxConcurrency: z.number(),
  currentLoad: z.number(),
  historicalSuccessRate: z.number(),
  available: z.boolean(),
})

export const schedulerScoreTermsSchema = z.looseObject({
  capabilityMatch: z.number(),
  capabilityContribution: z.number(),
  successContribution: z.number(),
  availabilityContribution: z.number(),
  priorityContribution: z.number(),
  loadPenaltyContribution: z.number(),
})

export const schedulerCandidateSchema = z.looseObject({
  agentId: identifierSchema,
  eligible: z.boolean(),
  rejectionReason: z.string().optional(),
  loadRatio: z.number(),
  score: z.number(),
  terms: schedulerScoreTermsSchema,
})

export const schedulerDecisionSchema = z.looseObject({
  id: identifierSchema,
  projectId: identifierSchema,
  taskId: identifierSchema,
  selectedAgentId: identifierSchema,
  candidates: z.array(schedulerCandidateSchema),
  selectedReason: z.string(),
  previousAgentId: z.string().optional(),
  reassignReason: z.string().optional(),
  createdAt: isoDateSchema,
})

export const executionSchema = z.looseObject({
  id: identifierSchema,
  projectId: identifierSchema,
  taskId: identifierSchema,
  agentId: identifierSchema,
  sessionId: z.string().optional(),
  status: z.enum(['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  startedAt: isoDateSchema,
  completedAt: z.string().optional(),
  error: taskFailureSchema.optional(),
})

export const verificationCheckSchema = z.looseObject({
  name: z.string(),
  status: z.enum(['PASS', 'FAIL', 'WARNING', 'SKIPPED']),
  summary: z.string(),
})

export const verificationFindingSchema = z.looseObject({
  category: z.string(),
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  message: z.string(),
  target: z.string().optional(),
})

export const verificationReportDataSchema = z.looseObject({
  verifier: z.string(),
  status: verificationStatusSchema,
  failureSignature: z.string().nullable(),
  checks: z.array(verificationCheckSchema),
  findings: z.array(verificationFindingSchema),
  routes: z.array(z.string()),
  viewports: z.array(z.string()),
  screenshots: z.array(z.string()),
})

export const verificationReportSchema = z.looseObject({
  id: identifierSchema,
  projectId: identifierSchema,
  taskId: z.string().optional(),
  status: verificationStatusSchema,
  failureSignature: z.string().optional(),
  report: verificationReportDataSchema,
  createdAt: isoDateSchema,
})

export const repairSchema = z.looseObject({
  id: identifierSchema,
  projectId: identifierSchema,
  repairRound: z.number(),
  verificationReportId: identifierSchema,
  repairAgentId: identifierSchema,
  failureSignature: z.string(),
  errorSummary: z.string(),
  changeSummary: z.string(),
  diff: z.string(),
  beforeStatus: verificationStatusSchema,
  afterStatus: verificationStatusSchema,
  startedAt: isoDateSchema,
  completedAt: isoDateSchema,
})

export const workflowSchema = z.looseObject({
  id: identifierSchema,
  projectId: identifierSchema,
  status: workflowStatusSchema,
  repairRound: z.number(),
  escalationReason: z.string().optional(),
  escalationMessage: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

export const productEventSchema = z.looseObject({
  type: z.string(),
  projectId: identifierSchema,
  seq: z.number().int().positive(),
  occurredAt: isoDateSchema,
  taskId: z.string().optional(),
  agentId: z.string().optional(),
  payload: z.unknown(),
})

export const projectRunSchema = publicProjectRunSchema

export const deliverySchema = projectDeliverySchema

export const projectSnapshotSchema = z.looseObject({
  project: projectSchema,
  tasks: z.array(taskSchema),
  decisions: z.array(schedulerDecisionSchema),
  executions: z.array(executionSchema),
  verificationReports: z.array(verificationReportSchema),
  repairs: z.array(repairSchema),
  workflow: workflowSchema.optional(),
  runs: z.array(projectRunSchema),
  delivery: deliverySchema.optional(),
  events: z.array(productEventSchema),
  lastEventSeq: z.number(),
})

export const apiErrorSchema = z.looseObject({
  code: z.string(),
  message: z.string(),
})

export const runStartResponseSchema = projectRunStartSchema

export const cancelRunResponseSchema = projectRunCancelSchema

export type TaskView = z.infer<typeof taskSchema>
export type TaskStatus = z.infer<typeof taskStatusSchema>
export type ProjectView = z.infer<typeof projectSchema>
export type AgentView = z.infer<typeof agentSchema>
export type SchedulerDecisionView = z.infer<typeof schedulerDecisionSchema>
export type ExecutionView = z.infer<typeof executionSchema>
export type VerificationStatus = z.infer<typeof verificationStatusSchema>
export type VerificationReportView = z.infer<typeof verificationReportSchema>
export type RepairView = z.infer<typeof repairSchema>
export type WorkflowView = z.infer<typeof workflowSchema>
export type ProductEventView = z.infer<typeof productEventSchema>
export type ProjectRunView = z.infer<typeof projectRunSchema>
export type DeliveryView = z.infer<typeof deliverySchema>
export type ProjectSnapshotView = z.infer<typeof projectSnapshotSchema>
export type ProjectRunStatus = z.infer<typeof projectRunStatusSchema>
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>
