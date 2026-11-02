/** Browser-safe Future Cup REST response contracts and public projections. */

import { z } from 'zod'
import type {
  PlatformProjectSnapshot,
  ProjectRunRecord,
  VerificationReport,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { readonly [key: string]: JsonValue }

const jsonPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  jsonPrimitiveSchema,
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))

const agentRoleSchema = z.enum([
  'planner',
  'ui-designer',
  'tester',
  'frontend',
  'integration',
  'verifier',
  'repair',
])
const designComplexitySchema = z.enum(['low', 'medium', 'high'])
const qualityLevelSchema = z.enum(['basic', 'standard', 'high', 'critical'])
const riskLevelSchema = z.enum(['low', 'medium', 'high', 'critical'])
const budgetPreferenceSchema = z.enum(['low', 'medium', 'high'])
const timePreferenceSchema = z.enum(['fast', 'balanced', 'quality-first'])
const parallelismPreferenceSchema = z.enum(['serial', 'balanced', 'parallel'])
const workloadCountSchema = z.number().int().min(1).max(64)
const shortTextSchema = z.string().trim().min(1).max(160)

const projectProfileSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  pageCount: workloadCountSchema.optional(),
  independentModuleCount: workloadCountSchema.optional(),
  designComplexity: designComplexitySchema.optional(),
  testingRequired: z.boolean().optional(),
  riskLevel: riskLevelSchema.optional(),
  qualityLevel: qualityLevelSchema.optional(),
  budgetPreference: budgetPreferenceSchema.optional(),
  timePreference: timePreferenceSchema.optional(),
  moduleParallelism: parallelismPreferenceSchema.optional(),
  techStack: z.array(shortTextSchema).min(1).max(32).optional(),
}).catchall(jsonValueSchema)

const projectClarificationQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page-count'),
    prompt: shortTextSchema,
    minimum: workloadCountSchema,
    maximum: workloadCountSchema,
  }).strict(),
  z.object({
    type: z.literal('module-parallelism'),
    prompt: shortTextSchema,
    minimumModuleCount: workloadCountSchema,
    maximumModuleCount: workloadCountSchema,
    options: z.array(z.object({
      value: parallelismPreferenceSchema,
      label: shortTextSchema,
    }).strict()).min(1),
  }).strict(),
  z.object({
    type: z.literal('quality-verification'),
    prompt: shortTextSchema,
    options: z.array(z.object({
      value: qualityLevelSchema,
      label: shortTextSchema,
      testingRequired: z.boolean(),
      qualityLevel: qualityLevelSchema,
      riskLevel: riskLevelSchema,
    }).strict()).min(1),
  }).strict(),
])

const projectClarificationAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page-count'),
    count: workloadCountSchema,
  }).strict(),
  z.object({
    type: z.literal('module-parallelism'),
    moduleCount: workloadCountSchema,
    parallelism: parallelismPreferenceSchema,
  }).strict(),
  z.object({
    type: z.literal('quality-verification'),
    level: qualityLevelSchema,
  }).strict(),
])

function roleAdjustmentSchema(
  type: 'add-role-instance' | 'remove-role-instance',
) {
  return z.object({
    type: z.literal(type),
    role: agentRoleSchema,
  }).strict()
}

function simpleAdjustmentSchema(type: 'raise-quality' | 'reduce-scale') {
  return z.object({ type: z.literal(type) }).strict()
}

const maximumParallelismAdjustmentSchema = z.object({
  type: z.literal('reduce-concurrency'),
  maximum: z.number().int().min(1).max(64).optional(),
}).strict()

const teamAdjustmentIntentSchema = z.discriminatedUnion('type', [
  roleAdjustmentSchema('add-role-instance'),
  roleAdjustmentSchema('remove-role-instance'),
  simpleAdjustmentSchema('raise-quality'),
  maximumParallelismAdjustmentSchema,
  simpleAdjustmentSchema('reduce-scale'),
])
const memoryAccessSchema = z.enum(['NONE', 'READ', 'WRITE'])
const memoryKindSchema = z.enum([
  'requirement',
  'design-decision',
  'failure-signature',
  'accepted-artifact-summary',
])
const capabilityMapSchema = z.record(z.string(), z.number())
const jsonSchemaDescriptorSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  dialect: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
}).strict()
const memoryPolicySchema = z.object({
  access: memoryAccessSchema,
  kinds: z.array(memoryKindSchema),
}).strict()

/** One selected published Agent version in a team recommendation. */
export const recommendedTeamMemberSchema = z.object({
  role: agentRoleSchema,
  name: z.string(),
  definitionId: z.string(),
  agentVersionId: z.string(),
  definitionVersion: z.string(),
  instanceCount: z.number().int().positive(),
  capabilities: capabilityMapSchema,
  maxConcurrency: z.number().int().positive(),
  toolAllowlist: z.array(z.string()),
  memoryPolicy: memoryPolicySchema,
  inputSchema: jsonSchemaDescriptorSchema,
  outputSchema: jsonSchemaDescriptorSchema,
}).strict()

/** Weighted coverage for one required team capability. */
export const teamCapabilityCoverageSchema = z.object({
  capability: z.string(),
  required: z.number(),
  covered: z.number(),
  satisfied: z.boolean(),
  contributors: z.array(z.object({
    role: agentRoleSchema,
    agentVersionId: z.string(),
    weight: z.number(),
    instances: z.number().int().positive(),
  }).strict()),
}).strict()

/** One required capability unavailable in the published catalog. */
export const missingTeamCapabilitySchema = z.object({
  capability: z.string(),
  required: z.number(),
  covered: z.number(),
  reason: z.enum(['missing-role', 'insufficient-capability']),
}).strict()

/** Structured risk attached to a recommended team. */
export const teamRecommendationRiskSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('missing-role'),
    role: agentRoleSchema,
    message: z.string(),
  }).strict(),
  z.object({
    kind: z.literal('capability-gap'),
    capability: z.string(),
    message: z.string(),
  }).strict(),
  z.object({
    kind: z.literal('budget-tradeoff'),
    message: z.string(),
  }).strict(),
  z.object({
    kind: z.literal('quality-tradeoff'),
    message: z.string(),
  }).strict(),
  z.object({
    kind: z.literal('concurrency-limit'),
    requested: z.number().int().positive(),
    applied: z.number().int().positive(),
    message: z.string(),
  }).strict(),
  z.object({
    kind: z.literal('unsupported-tech-stack'),
    technology: z.string(),
    message: z.string(),
  }).strict(),
])

/** Concurrency estimate and applied practical ceiling. */
export const teamRecommendationConcurrencySchema = z.object({
  instanceCount: z.number().int().positive(),
  aggregateCapacity: z.number().int().positive(),
  estimatedParallelism: z.number().int().positive(),
  requiredConcurrency: z.number().int().positive(),
  maximumParallelism: z.number().int().positive(),
}).strict()

/** Tool ceiling and shared-tool requirements for a recommended team. */
export const teamToolPolicySchema = z.object({
  allowedTools: z.array(z.string()),
  requiredTools: z.array(z.string()),
}).strict()

/** Project-memory ceiling and shared-memory requirements for a recommended team. */
export const teamMemoryPolicySchema = z.object({
  allowedAccess: memoryAccessSchema,
  requiredAccess: memoryAccessSchema,
  allowedKinds: z.array(memoryKindSchema),
  requiredKinds: z.array(memoryKindSchema),
}).strict()

/** Published team version used as a recommendation basis. */
export const recommendationSourceTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
}).strict()

/** Complete deterministic team recommendation returned to the browser. */
export const agentTeamRecommendationSchema = z.object({
  profile: projectProfileSchema,
  members: z.array(recommendedTeamMemberSchema),
  capabilityCoverage: z.array(teamCapabilityCoverageSchema),
  missingCapabilities: z.array(missingTeamCapabilitySchema),
  concurrency: teamRecommendationConcurrencySchema,
  toolPolicy: teamToolPolicySchema,
  memoryPolicy: teamMemoryPolicySchema,
  inputSchema: jsonSchemaDescriptorSchema,
  requiredOutputSchemas: z.array(jsonSchemaDescriptorSchema),
  reasons: z.array(z.string()),
  risks: z.array(teamRecommendationRiskSchema),
  sourceTemplate: recommendationSourceTemplateSchema.optional(),
}).strict()

/** One structured change produced by a controlled team adjustment. */
export const teamAdjustmentChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('instance-count'),
    role: agentRoleSchema,
    from: z.number().int().positive(),
    to: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal('quality-level'),
    from: z.enum(['basic', 'standard', 'high', 'critical']).optional(),
    to: z.enum(['basic', 'standard', 'high', 'critical']).optional(),
  }).strict(),
  z.object({
    kind: z.literal('parallelism'),
    from: z.number().int().positive(),
    to: z.number().int().positive(),
  }).strict(),
])

/** Controlled adjustment metadata without a duplicate recommendation payload. */
export const teamAdjustmentSummarySchema = z.object({
  intent: teamAdjustmentIntentSchema,
  changes: z.array(teamAdjustmentChangeSchema),
  explanation: z.string(),
}).strict()

/** Profile, clarification state, recommendation, and applied adjustment history. */
export const teamRecommendationPlanSchema = z.object({
  profile: projectProfileSchema,
  questions: z.array(projectClarificationQuestionSchema).max(3),
  readyForRecommendation: z.boolean(),
  recommendation: agentTeamRecommendationSchema.optional(),
  adjustments: z.array(teamAdjustmentSummarySchema),
}).strict()

/** Canonical profile and outstanding questions before recommendation. */
export const structuredProjectProfileSchema = z.object({
  profile: projectProfileSchema,
  questions: z.array(projectClarificationQuestionSchema).max(3),
  readyForRecommendation: z.boolean(),
}).strict()

/** Requirement structure request with optional model-extracted profile fields. */
export const teamProfileRequestSchema = z.object({
  requirement: z.string().trim().min(1).max(4_000),
  candidate: projectProfileSchema.partial().optional(),
  answers: z.array(projectClarificationAnswerSchema).max(3).default([]),
}).strict()

/** Stateless inputs from which the server rebuilds one controlled recommendation. */
export const teamRecommendationRequestSchema = z.object({
  requirement: z.string().trim().min(1).max(4_000),
  profile: projectProfileSchema.optional(),
  answers: z.array(projectClarificationAnswerSchema).max(3).default([]),
  adjustments: z.array(z.string().trim().min(1).max(2_000)).max(20).default([]),
  maximumParallelism: z.number().int().min(1).max(64).optional(),
}).strict()

/** Apply one or more controlled adjustments to a recommendation rebuilt from source inputs. */
export const teamAdjustmentRequestSchema = teamRecommendationRequestSchema.extend({
  adjustments: z.array(z.string().trim().min(1).max(2_000)).min(1).max(20),
}).strict()

/** Save one immutable team version derived from a recommendation. */
export const teamRecommendationSaveRequestSchema = teamRecommendationRequestSchema.extend({
  teamName: z.string().trim().min(1).max(160),
}).strict()

/** Save one immutable team version and freeze it to a new project. */
export const teamRecommendationAdoptRequestSchema = teamRecommendationRequestSchema.extend({
  projectName: z.string().trim().min(1).max(120),
}).strict()

/** Public summary of one saved immutable team version. */
export const savedAgentTeamVersionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  purpose: z.string(),
  concurrencyCapacity: z.number().int().positive(),
  memberCount: z.number().int().positive(),
}).strict()

/** Logical Team lifecycle exposed to the management client. */
export const agentTeamStatusSchema = z.enum(['ACTIVE', 'ARCHIVED'])

/** Immutable Team version publication state exposed to the management client. */
export const agentTeamVersionStatusSchema = z.enum(['DRAFT', 'PUBLISHED'])

/** Canonical HQ departments accepted for one runtime Team member. */
export const agentTeamDepartmentKeySchema = z.enum([
  'planning',
  'design',
  'frontend-a',
  'frontend-b',
  'integration',
  'verification',
  'repair',
])

/** Browser-safe identity and placement of one runtime Agent instance. */
export const publicTeamRuntimeMemberSchema = z.object({
  instanceId: z.string(),
  displayName: z.string(),
  role: agentRoleSchema,
  definitionId: z.string(),
  agentVersionId: z.string(),
  departmentKey: agentTeamDepartmentKeySchema,
  position: z.number().int().positive(),
}).strict()

/** Browser-safe immutable Team version. */
export const publicAgentTeamVersionSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  ownerId: z.string(),
  name: z.string(),
  version: z.string(),
  purpose: z.string(),
  status: agentTeamVersionStatusSchema,
  members: z.array(publicTeamRuntimeMemberSchema),
  requiredCapabilities: z.record(z.string(), z.number()),
  requiredConcurrency: z.number().int().positive(),
  concurrencyCapacity: z.number().int().nonnegative(),
  capabilityCoverage: z.array(teamCapabilityCoverageSchema).default([]),
}).strict()

/** Logical Team summary with its latest immutable version. */
export const agentTeamSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  name: z.string(),
  purpose: z.string(),
  status: agentTeamStatusSchema,
  latestVersion: publicAgentTeamVersionSchema.optional(),
  versionCount: z.number().int().nonnegative(),
  projectUsageCount: z.number().int().nonnegative(),
}).strict()

/** One paginated user-owned Team library page. */
export const agentTeamPageSchema = z.object({
  items: z.array(agentTeamSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
}).strict()

/** Create one user-owned logical Team. */
export const createAgentTeamRequestSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(160),
  purpose: z.string().trim().min(1).max(4_000),
}).strict()

/** One runtime instance selected for a custom Team draft. */
export const createTeamRuntimeMemberRequestSchema = z.object({
  agentVersionId: z.string().trim().min(1).max(160),
  instanceId: z.string().trim().min(1).max(160).optional(),
  displayName: z.string().trim().min(1).max(160).optional(),
  departmentKey: agentTeamDepartmentKeySchema,
  position: z.number().int().positive().max(64),
}).strict()

/** Create or replace one editable Team draft. */
export const createTeamDraftRequestSchema = z.object({
  version: z.string().trim().min(1).max(160),
  members: z.array(createTeamRuntimeMemberRequestSchema).max(7),
  requiredCapabilities: z.record(z.string(), z.number().min(0)).optional(),
  requiredConcurrency: z.number().int().positive().max(1_000_000).optional(),
  toolPolicy: teamToolPolicySchema.optional(),
  memoryPolicy: teamMemoryPolicySchema.optional(),
  inputSchema: jsonSchemaDescriptorSchema.optional(),
  requiredOutputSchemas: z.array(jsonSchemaDescriptorSchema).max(64).optional(),
}).strict()

/** Result of publishing one Team draft. */
export const publicTeamVersionResponseSchema = z.object({
  teamVersion: publicAgentTeamVersionSchema,
}).strict()

/** Result of saving a recommended team without creating a project. */
export const teamRecommendationSaveResponseSchema = z.object({
  teamVersion: savedAgentTeamVersionSchema,
}).strict()

/** Result of adopting a recommended team into a new bound project. */
export const teamRecommendationAdoptionResponseSchema = z.object({
  projectId: z.string(),
  teamVersion: savedAgentTeamVersionSchema,
}).strict()

/** Browser-safe team recommendation plan. */
export type TeamRecommendationPlan = z.infer<typeof teamRecommendationPlanSchema>

/** Browser-safe selected team member. */
export type RecommendedTeamMember = z.infer<typeof recommendedTeamMemberSchema>

/** Browser-safe role selected by team recommendation. */
export type RecommendedTeamRole = z.infer<typeof agentRoleSchema>

/** Stable public project-run lifecycle. */
export const projectRunStatusSchema = z.enum([
  'RUNNING',
  'PASSED',
  'FAILED',
  'CANCELLED',
  'ESCALATED',
])

/** One project run without private filesystem paths. */
export const publicProjectRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: projectRunStatusSchema,
  ownerId: z.string(),
  fencingToken: z.string(),
  hasWorkspace: z.boolean(),
  hasPreview: z.boolean(),
  startedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().optional(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }).optional(),
}).strict()

/** Public project run value returned by REST and Socket.IO. */
export type PublicProjectRun = z.infer<typeof publicProjectRunSchema>

/** One public project snapshot with sanitized project runs. */
export interface PublicProjectSnapshot extends Omit<PlatformProjectSnapshot, 'runs'> {
  readonly runs: readonly PublicProjectRun[]
}

/** One screenshot artifact address returned to the browser. */
export const screenshotArtifactSchema = z.object({
  name: z.string(),
  url: z.string(),
}).strict()

/** Final delivery summary without host paths. */
export const projectDeliverySchema = z.object({
  projectId: z.string(),
  runId: z.string().optional(),
  status: projectRunStatusSchema.optional(),
  workspacePath: z.string().optional(),
  previewUrl: z.string().optional(),
  screenshots: z.array(screenshotArtifactSchema),
}).strict()

/** Final delivery summary returned by REST. */
export type ProjectDelivery = z.infer<typeof projectDeliverySchema>

/** Accepted project-run response. */
export const projectRunStartSchema = z.object({
  runId: z.string(),
}).strict()

/** Cancellation response. */
export const projectRunCancelSchema = z.object({
  cancelled: z.boolean(),
}).strict()

/** Stable REST error response. */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  issues: z.array(z.unknown()).optional(),
}).strict()

/**
 * Convert one internal run to its public value.
 * @param run - durable run with private paths and bigint fencing token.
 * @returns browser-safe run fields.
 */
export function publicProjectRun(run: ProjectRunRecord): PublicProjectRun {
  return publicProjectRunSchema.parse({
    id: run.id,
    projectId: run.projectId,
    status: run.status,
    ownerId: run.ownerId,
    fencingToken: run.fencingToken.toString(),
    hasWorkspace: run.workspacePath !== undefined,
    hasPreview: run.previewPath !== undefined,
    startedAt: run.startedAt,
    ...run.completedAt === undefined ? {} : { completedAt: run.completedAt },
    ...run.error === undefined ? {} : { error: run.error },
  })
}

/**
 * Convert a complete snapshot to the public REST and Socket.IO value.
 * @param snapshot - internal snapshot with private run paths.
 * @returns snapshot whose runs contain no private filesystem values.
 */
export function publicProjectSnapshot(snapshot: PlatformProjectSnapshot): PublicProjectSnapshot {
  return {
    ...snapshot,
    runs: snapshot.runs.map(publicProjectRun),
    verificationReports: snapshot.verificationReports.map(publicVerificationReport),
  }
}

/**
 * Replace absolute screenshot paths in one verification report with file names.
 * @param report - durable verification report.
 * @returns a report safe for REST and Socket.IO delivery.
 */
export function publicVerificationReport(report: VerificationReport): VerificationReport {
  const value = report.report
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return report
  const screenshots = value.screenshots
  if (!Array.isArray(screenshots)
    || !screenshots.every(path => typeof path === 'string')) return report
  return {
    ...report,
    report: {
      ...value,
      screenshots: screenshots.map(path => fileName(path)),
    },
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? path
}
