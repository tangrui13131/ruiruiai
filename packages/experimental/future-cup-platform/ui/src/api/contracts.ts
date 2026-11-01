import { z } from 'zod'
import {
  projectDeliverySchema,
  projectRunCancelSchema,
  projectRunStartSchema,
  publicProjectRunSchema,
  structuredProjectProfileSchema,
  teamRecommendationAdoptionResponseSchema,
  teamRecommendationAdoptRequestSchema,
  teamRecommendationPlanSchema,
  teamRecommendationRequestSchema,
  teamRecommendationSaveRequestSchema,
  teamRecommendationSaveResponseSchema,
} from '../../../src/api-contracts.ts'
import { productEventSchema } from '@deepseek-ai/dsh-experimental-future-cup-orchestration/src/product-events.ts'
import {
  repairStrategyDecisionSchema as adaptiveRepairStrategyDecisionSchema,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration/src/adaptive-repair.ts'

export { productEventSchema }
export {
  structuredProjectProfileSchema,
  teamRecommendationAdoptionResponseSchema,
  teamRecommendationAdoptRequestSchema,
  teamRecommendationPlanSchema,
  teamRecommendationRequestSchema,
  teamRecommendationSaveRequestSchema,
  teamRecommendationSaveResponseSchema,
}

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
  definitionVersionId: z.string().optional(),
  model: z.string().optional(),
  toolAllowlist: z.array(z.string()).optional(),
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

export const repairStrategyDecisionSchema = z.looseObject({
  id: identifierSchema,
  projectId: identifierSchema,
  repairRound: z.number(),
  failureSignature: z.string(),
  strategyId: identifierSchema,
  decision: adaptiveRepairStrategyDecisionSchema,
  outcome: z.looseObject({
    status: z.string(),
    nextAction: z.string(),
    failureSignature: z.string().nullable().optional(),
    nextStrategyId: z.string().nullable().optional(),
    reason: z.string().optional(),
  }).optional(),
  repairRecordId: z.string().optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
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

export const workflowControlNodeSchema = z.looseObject({
  id: identifierSchema,
  label: z.string(),
  type: z.enum([
    'TASK',
    'SEQUENCE',
    'PARALLEL',
    'CONDITION',
    'LOOP',
    'SUBWORKFLOW',
    'TERMINAL',
  ]),
  taskRef: z.string().optional(),
  expectedResult: z.enum(['COMPLETION', 'VERIFICATION']).optional(),
  graphId: z.string().optional(),
  joinNodeId: z.string().optional(),
  subject: z.string().optional(),
  maxIterations: z.number().optional(),
  status: z.enum(['PASSED', 'ESCALATED']).optional(),
})

export const workflowControlEdgeSchema = z.looseObject({
  id: identifierSchema,
  from: identifierSchema,
  to: identifierSchema,
  condition: z.looseObject({
    kind: z.enum(['ALWAYS', 'VERIFICATION_STATUS', 'LOOP_RESULT']),
    status: verificationStatusSchema.optional(),
    result: z.enum(['CONTINUE', 'EXHAUSTED']).optional(),
  }),
})

export const workflowControlGraphSchema = z.looseObject({
  id: identifierSchema,
  label: z.string(),
  entryNodeId: identifierSchema,
  nodes: z.array(workflowControlNodeSchema),
  edges: z.array(workflowControlEdgeSchema),
})

export const workflowControlDefinitionSchema = z.looseObject({
  version: z.number(),
  id: identifierSchema,
  label: z.string(),
  entryGraphId: identifierSchema,
  graphs: z.array(workflowControlGraphSchema),
})

export const workflowControlJournalEntrySchema = z.looseObject({
  seq: z.number(),
  type: z.string(),
  graphId: z.string().optional(),
  nodeId: z.string().optional(),
  nodeType: z.string().optional(),
  status: z.string().optional(),
  escalationReason: z.string().optional(),
})

export const workflowControlSnapshotSchema = z.looseObject({
  snapshotVersion: z.number(),
  definition: workflowControlDefinitionSchema,
  status: z.enum(['RUNNING', 'PASSED', 'ESCALATED']),
  revision: z.number(),
  activeNodes: z.array(z.looseObject({
    instanceId: z.string(),
    graphId: z.string(),
    nodeId: z.string(),
    taskRef: z.string(),
    expectedResult: z.enum(['COMPLETION', 'VERIFICATION']),
  })),
  loopStates: z.array(z.looseObject({
    graphId: z.string(),
    nodeId: z.string(),
    iterations: z.number(),
    maxIterations: z.number(),
  })),
  lastVerification: z.looseObject({
    status: verificationStatusSchema,
    failureSignature: z.string().optional(),
    repeated: z.boolean(),
  }).optional(),
  escalationReason: z.string().optional(),
  journal: z.array(workflowControlJournalEntrySchema),
})

export const workflowControlStateSchema = z.looseObject({
  projectId: identifierSchema,
  definitionId: identifierSchema,
  definitionVersion: z.number(),
  snapshot: workflowControlSnapshotSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
})

export const workflowControlEventSchema = z.looseObject({
  seq: z.number(),
  projectId: identifierSchema,
  entry: workflowControlJournalEntrySchema,
  createdAt: isoDateSchema,
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
  repairStrategies: z.array(repairStrategyDecisionSchema).default([]),
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
export type RepairStrategyDecisionView = z.infer<typeof repairStrategyDecisionSchema>
export type WorkflowView = z.infer<typeof workflowSchema>
export type WorkflowControlStateView = z.infer<typeof workflowControlStateSchema>
export type WorkflowControlEventView = z.infer<typeof workflowControlEventSchema>
export type WorkflowControlNodeView = z.infer<typeof workflowControlNodeSchema>
export type WorkflowControlEdgeView = z.infer<typeof workflowControlEdgeSchema>
type ProductEventInput = z.input<typeof productEventSchema>
type OptionalUndefined<T> = T extends unknown
  ? {
    [K in keyof T as undefined extends T[K] ? never : K]: T[K]
  } & {
    [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
  }
  : never
type RelaxProductEvent<T> = T extends unknown
  ? OptionalUndefined<Omit<T, 'payload'> & { payload: unknown }>
  : never

export type ProductEventView = RelaxProductEvent<ProductEventInput>
export type ProjectRunView = z.infer<typeof projectRunSchema>
export type DeliveryView = z.infer<typeof deliverySchema>
export interface ProjectSnapshotView {
  project: ProjectView
  tasks: TaskView[]
  decisions: SchedulerDecisionView[]
  executions: ExecutionView[]
  verificationReports: VerificationReportView[]
  repairs: RepairView[]
  repairStrategies: RepairStrategyDecisionView[]
  workflow?: WorkflowView
  runs: ProjectRunView[]
  delivery?: DeliveryView
  events: ProductEventView[]
  lastEventSeq: number
}
export type ProjectRunStatus = z.infer<typeof projectRunStatusSchema>
export type WorkflowStatus = z.infer<typeof workflowStatusSchema>
export type StructuredProjectProfileView = z.infer<typeof structuredProjectProfileSchema>
export type TeamRecommendationPlanView = z.infer<typeof teamRecommendationPlanSchema>
export type TeamRecommendationRequestView = z.input<typeof teamRecommendationRequestSchema>
export type TeamRecommendationSaveRequestView = z.input<typeof teamRecommendationSaveRequestSchema>
export type TeamRecommendationAdoptRequestView = z.input<typeof teamRecommendationAdoptRequestSchema>
export type TeamRecommendationSaveResponseView =
  z.infer<typeof teamRecommendationSaveResponseSchema>
export type TeamRecommendationAdoptionResponseView =
  z.infer<typeof teamRecommendationAdoptionResponseSchema>
