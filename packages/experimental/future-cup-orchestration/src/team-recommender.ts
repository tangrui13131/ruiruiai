/** Deterministic project-profile extraction and published-Agent team recommendation. */

import { z } from 'zod'
import {
  AGENT_REGISTRY_ROLES,
  createAgentTeamVersionInputSchema,
  MAX_AGENT_TEAM_MEMBERS,
  type AgentMemoryPolicy,
  type AgentRegistryRole,
  type AgentTeamVersion,
  type CreateAgentTeamVersionInput,
  type JsonSchemaDescriptor,
  type MemoryAccess,
  type PublishedAgent,
  type TeamMemoryPolicy,
  type TeamToolPolicy,
} from './agent-registry.ts'
import { jsonValueSchema } from './schemas.ts'

/** Supported design-complexity levels for a project profile. */
export const PROJECT_DESIGN_COMPLEXITIES = ['low', 'medium', 'high'] as const

/** Supported quality levels for a project profile. */
export const PROJECT_QUALITY_LEVELS = ['basic', 'standard', 'high', 'critical'] as const

/** Supported delivery-risk levels for a project profile. */
export const PROJECT_RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const

/** Supported budget preferences for a project profile. */
export const PROJECT_BUDGET_PREFERENCES = ['low', 'medium', 'high'] as const

/** Supported time preferences for a project profile. */
export const PROJECT_TIME_PREFERENCES = ['fast', 'balanced', 'quality-first'] as const

/** Supported module-parallelism preferences for a project profile. */
export const PROJECT_PARALLELISM_PREFERENCES = ['serial', 'balanced', 'parallel'] as const

/** Tech stack assumed when a requirement does not state one explicitly. */
export const FUTURE_CUP_DEFAULT_TECH_STACK = Object.freeze([
  'React',
  'TypeScript',
  'Vite',
  'Ant Design',
])

const workloadCountSchema = z.number().int().min(1).max(64)
const nonEmptyTextSchema = z.string().trim().min(1).max(160)

/**
 * Validated project profile used to size a controlled Agent team.
 *
 * Declared fields are normalized for recommendation. Additional JSON fields are retained so a
 * model-extracted candidate can carry domain metadata without changing this module.
 */
export const projectProfileSchema = z.object({
  goal: z.string().trim().min(1).max(4_000),
  pageCount: workloadCountSchema.optional(),
  independentModuleCount: workloadCountSchema.optional(),
  designComplexity: z.enum(PROJECT_DESIGN_COMPLEXITIES).optional(),
  testingRequired: z.boolean().optional(),
  riskLevel: z.enum(PROJECT_RISK_LEVELS).optional(),
  qualityLevel: z.enum(PROJECT_QUALITY_LEVELS).optional(),
  budgetPreference: z.enum(PROJECT_BUDGET_PREFERENCES).optional(),
  timePreference: z.enum(PROJECT_TIME_PREFERENCES).optional(),
  moduleParallelism: z.enum(PROJECT_PARALLELISM_PREFERENCES).optional(),
  techStack: z.array(nonEmptyTextSchema).min(1).max(32).optional(),
}).catchall(jsonValueSchema)

/** Project profile inferred from {@link projectProfileSchema}. */
export type ProjectProfile = z.infer<typeof projectProfileSchema>

/** Candidate profile accepted from a model extractor; all declared fields remain optional. */
export const projectProfileCandidateSchema = projectProfileSchema.partial()

const parallelismOptionSchema = z.object({
  value: z.enum(PROJECT_PARALLELISM_PREFERENCES),
  label: nonEmptyTextSchema,
}).strict()

const qualityOptionSchema = z.object({
  value: z.enum(['basic', 'standard', 'high', 'critical']),
  label: nonEmptyTextSchema,
  testingRequired: z.boolean(),
  qualityLevel: z.enum(PROJECT_QUALITY_LEVELS),
  riskLevel: z.enum(PROJECT_RISK_LEVELS),
}).strict()

/** One structured clarification question needed before team sizing. */
export const projectClarificationQuestionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page-count'),
    prompt: nonEmptyTextSchema,
    minimum: workloadCountSchema,
    maximum: workloadCountSchema,
  }).strict(),
  z.object({
    type: z.literal('module-parallelism'),
    prompt: nonEmptyTextSchema,
    minimumModuleCount: workloadCountSchema,
    maximumModuleCount: workloadCountSchema,
    options: z.array(parallelismOptionSchema).min(1),
  }).strict(),
  z.object({
    type: z.literal('quality-verification'),
    prompt: nonEmptyTextSchema,
    options: z.array(qualityOptionSchema).min(1),
  }).strict(),
])

/** Structured clarification question. */
export type ProjectClarificationQuestion =
  z.infer<typeof projectClarificationQuestionSchema>

/** One structured answer returned by the caller for a clarification question. */
export const projectClarificationAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('page-count'),
    count: workloadCountSchema,
  }).strict(),
  z.object({
    type: z.literal('module-parallelism'),
    moduleCount: workloadCountSchema,
    parallelism: z.enum(PROJECT_PARALLELISM_PREFERENCES),
  }).strict(),
  z.object({
    type: z.literal('quality-verification'),
    level: z.enum(['basic', 'standard', 'high', 'critical']),
  }).strict(),
])

/** Structured answer to {@link ProjectClarificationQuestion}. */
export type ProjectClarificationAnswer =
  z.infer<typeof projectClarificationAnswerSchema>

/** Stable machine-readable team-recommender failure code. */
export type TeamRecommenderErrorCode =
  | 'INVALID_PROJECT_PROFILE'
  | 'PROFILE_NEEDS_CLARIFICATION'
  | 'DUPLICATE_CLARIFICATION'
  | 'INVALID_PUBLISHED_AGENT'
  | 'INCOMPLETE_TEAM'
  | 'INVALID_ADJUSTMENT'
  | 'UNSUPPORTED_ADJUSTMENT'
  | 'INSTANCE_LIMIT'

/** Structured failure raised when recommendation inputs or controlled adjustments are invalid. */
export class TeamRecommenderError extends Error {
  /**
   * @param message - actionable failure description.
   * @param code - stable machine-readable failure code.
   * @param questions - outstanding clarification questions for an incomplete profile.
   */
  constructor(
    message: string,
    readonly code: TeamRecommenderErrorCode,
    readonly questions?: readonly ProjectClarificationQuestion[],
  ) {
    super(message)
    this.name = 'TeamRecommenderError'
  }
}

/** Input accepted by {@link structureProjectProfile}. */
export interface StructureProjectProfileInput {
  /** Original natural-language requirement. */
  readonly requirement: string
  /** Optional model-extracted candidate validated before merge. */
  readonly candidate?: unknown
  /** Structured answers to earlier clarification questions. */
  readonly answers?: readonly ProjectClarificationAnswer[] | undefined
}

/** Structured profile and outstanding clarification questions. */
export interface StructuredProjectProfile {
  /** Canonical profile, including retained extra JSON fields. */
  readonly profile: ProjectProfile
  /** At most three questions required before team sizing. */
  readonly questions: readonly ProjectClarificationQuestion[]
  /** Whether the profile contains enough information for a recommendation. */
  readonly readyForRecommendation: boolean
}

/** One selected published Agent version and its instance count. */
export interface RecommendedTeamMember {
  /** Controlled Agent role. */
  readonly role: AgentRegistryRole
  /** Human-readable Agent name. */
  readonly name: string
  /** Logical Agent definition identity. */
  readonly definitionId: string
  /** Immutable Agent version identity. */
  readonly agentVersionId: string
  /** Caller-owned Agent definition version. */
  readonly definitionVersion: string
  /** Independently schedulable instances of this version. */
  readonly instanceCount: number
  /** Published capability weights copied from the selected version. */
  readonly capabilities: Readonly<Record<string, number>>
  /** Per-instance concurrency capacity. */
  readonly maxConcurrency: number
  /** Exact tools permitted for this version. */
  readonly toolAllowlist: readonly string[]
  /** Structured memory policy copied from the selected version. */
  readonly memoryPolicy: AgentMemoryPolicy
  /** Required input contract. */
  readonly inputSchema: JsonSchemaDescriptor
  /** Produced output contract. */
  readonly outputSchema: JsonSchemaDescriptor
}

/** Weighted capability coverage across selected member instances. */
export interface TeamCapabilityCoverage {
  /** Required capability name. */
  readonly capability: string
  /** Required aggregate weight. */
  readonly required: number
  /** Covered aggregate weight. */
  readonly covered: number
  /** Whether the requirement is covered. */
  readonly satisfied: boolean
  /** Per-version contributions to the aggregate. */
  readonly contributors: readonly {
    readonly role: AgentRegistryRole
    readonly agentVersionId: string
    readonly weight: number
    readonly instances: number
  }[]
}

/** Required capability not covered by the currently published Agent catalog. */
export interface MissingTeamCapability {
  /** Uncovered capability name. */
  readonly capability: string
  /** Required aggregate weight. */
  readonly required: number
  /** Covered aggregate weight. */
  readonly covered: number
  /** Why the capability could not be covered. */
  readonly reason: 'missing-role' | 'insufficient-capability'
}

/** Recommendation risk with a machine-readable discriminant. */
export type TeamRecommendationRisk =
  | {
    readonly kind: 'missing-role'
    readonly role: AgentRegistryRole
    readonly message: string
  }
  | {
    readonly kind: 'capability-gap'
    readonly capability: string
    readonly message: string
  }
  | {
    readonly kind: 'budget-tradeoff'
    readonly message: string
  }
  | {
    readonly kind: 'quality-tradeoff'
    readonly message: string
  }
  | {
    readonly kind: 'concurrency-limit'
    readonly requested: number
    readonly applied: number
    readonly message: string
  }
  | {
    readonly kind: 'unsupported-tech-stack'
    readonly technology: string
    readonly message: string
  }

/** Published team template selected as the recommendation basis. */
export interface RecommendationSourceTemplate {
  /** Immutable team version identity. */
  readonly id: string
  /** Human-readable team template name. */
  readonly name: string
  /** Caller-owned team version. */
  readonly version: string
}

/** Structured concurrency estimate for the recommended team. */
export interface TeamRecommendationConcurrency {
  /** Total independently schedulable instances. */
  readonly instanceCount: number
  /** Aggregate concurrency reported by selected Agent versions. */
  readonly aggregateCapacity: number
  /** Expected parallel work lanes. */
  readonly estimatedParallelism: number
  /** Minimum aggregate concurrency to request from Registry. */
  readonly requiredConcurrency: number
  /** Caller-selected practical parallelism ceiling. */
  readonly maximumParallelism: number
}

/**
 * Deterministic team recommendation.
 *
 * This structure is the source of truth; {@link summarizeAgentTeamRecommendation} only renders it.
 */
export interface AgentTeamRecommendation {
  /** Canonical profile used for every rule. */
  readonly profile: ProjectProfile
  /** Selected published versions in controlled role order. */
  readonly members: readonly RecommendedTeamMember[]
  /** Required capability coverage. */
  readonly capabilityCoverage: readonly TeamCapabilityCoverage[]
  /** Capabilities not covered by the published catalog. */
  readonly missingCapabilities: readonly MissingTeamCapability[]
  /** Capacity and practical parallelism estimate. */
  readonly concurrency: TeamRecommendationConcurrency
  /** Team tool ceiling and required shared tools. */
  readonly toolPolicy: TeamToolPolicy
  /** Team memory ceiling and required shared memory access. */
  readonly memoryPolicy: TeamMemoryPolicy
  /** Input contract accepted by the complete team. */
  readonly inputSchema: JsonSchemaDescriptor
  /** Output contracts produced by selected members. */
  readonly requiredOutputSchemas: readonly JsonSchemaDescriptor[]
  /** Human-readable reasons suitable for structured UI rendering. */
  readonly reasons: readonly string[]
  /** Deterministic risks and tradeoffs. */
  readonly risks: readonly TeamRecommendationRisk[]
  /** Published template used when one matched. */
  readonly sourceTemplate?: RecommendationSourceTemplate | undefined
}

/** Input accepted by {@link recommendAgentTeam}. */
export interface RecommendAgentTeamInput {
  /** Structured project profile. */
  readonly profile: ProjectProfile
  /** Live published Agent definition/version pairs. */
  readonly publishedAgents: readonly PublishedAgent[]
  /** Optional published team templates to prefer. */
  readonly teamTemplates?: readonly AgentTeamVersion[] | undefined
  /** Practical upper bound for expected parallel work lanes. */
  readonly maximumParallelism?: number | undefined
}

/** One controlled natural-language team adjustment. */
export const teamAdjustmentIntentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('add-role-instance'),
    role: z.enum(AGENT_REGISTRY_ROLES),
  }).strict(),
  z.object({
    type: z.literal('remove-role-instance'),
    role: z.enum(AGENT_REGISTRY_ROLES),
  }).strict(),
  z.object({
    type: z.literal('raise-quality'),
  }).strict(),
  z.object({
    type: z.literal('reduce-concurrency'),
    maximum: z.number().int().min(1).max(64).optional(),
  }).strict(),
  z.object({
    type: z.literal('reduce-scale'),
  }).strict(),
])

/** Controlled adjustment intent parsed from natural language. */
export type TeamAdjustmentIntent = z.infer<typeof teamAdjustmentIntentSchema>

/** One applied adjustment change. */
export type TeamAdjustmentChange =
  | {
    readonly kind: 'instance-count'
    readonly role: AgentRegistryRole
    readonly from: number
    readonly to: number
  }
  | {
    readonly kind: 'quality-level'
    readonly from: ProjectProfile['qualityLevel']
    readonly to: ProjectProfile['qualityLevel']
  }
  | {
    readonly kind: 'parallelism'
    readonly from: number
    readonly to: number
  }

/** Result of applying one controlled adjustment. */
export interface TeamAdjustmentResult {
  /** Recomputed structured recommendation. */
  readonly recommendation: AgentTeamRecommendation
  /** Intent that was applied. */
  readonly intent: TeamAdjustmentIntent
  /** Structured changes; an empty list means the valid floor prevented a change. */
  readonly changes: readonly TeamAdjustmentChange[]
  /** Human-readable explanation of the result. */
  readonly explanation: string
}

/** Optional metadata for conversion to a Registry team input. */
export interface CreateTeamInputMetadata {
  /** Optional explicit immutable team version identity. */
  readonly id?: string | undefined
  /** Human-readable team name. */
  readonly name?: string | undefined
  /** Caller-owned semantic version. */
  readonly version?: string | undefined
  /** Plain-language team responsibility. */
  readonly purpose?: string | undefined
}

const ROLE_ORDER: readonly AgentRegistryRole[] = Object.freeze([...AGENT_REGISTRY_ROLES])
const RUNTIME_ROLE_ORDER: readonly AgentRegistryRole[] = Object.freeze(
  ROLE_ORDER.filter(role => role !== 'verifier'),
)
const SCALING_ORDER: readonly AgentRegistryRole[] = Object.freeze([
  'frontend',
  'tester',
  'verifier',
  'repair',
  'ui-designer',
  'integration',
  'planner',
])
const CAPACITY_TRIM_ORDER: readonly AgentRegistryRole[] = Object.freeze([
  'tester',
  'verifier',
  'repair',
  'frontend',
  'ui-designer',
  'integration',
  'planner',
])
const DEFAULT_MAXIMUM_PARALLELISM = 4
const MAX_INSTANCES_PER_MEMBER = 100

const QUALITY_OPTIONS = Object.freeze([
  {
    value: 'basic',
    label: 'Basic prototype verification',
    testingRequired: false,
    qualityLevel: 'basic',
    riskLevel: 'low',
  },
  {
    value: 'standard',
    label: 'Standard tests and independent verification',
    testingRequired: true,
    qualityLevel: 'standard',
    riskLevel: 'medium',
  },
  {
    value: 'high',
    label: 'High-assurance tests and independent verification',
    testingRequired: true,
    qualityLevel: 'high',
    riskLevel: 'high',
  },
  {
    value: 'critical',
    label: 'Critical-delivery verification',
    testingRequired: true,
    qualityLevel: 'critical',
    riskLevel: 'critical',
  },
] as const)

const PARALLELISM_OPTIONS = Object.freeze([
  { value: 'serial', label: 'Serial delivery' },
  { value: 'balanced', label: 'Balanced parallelism' },
  { value: 'parallel', label: 'Maximum safe parallelism' },
] as const)

const UNSUPPORTED_TECHNOLOGIES = Object.freeze([
  'Vue',
  'Angular',
  'Svelte',
  'Next.js',
  'Nuxt',
])

const MEMORY_ACCESS_RANK: Readonly<Record<MemoryAccess, number>> = Object.freeze({
  NONE: 0,
  READ: 1,
  WRITE: 2,
})

/**
 * Extract and validate a project profile from natural-language text and an optional candidate.
 *
 * The function is deterministic, performs no model call, and preserves additional JSON fields
 * from the candidate. Questions are emitted only for page count, module parallelism, and
 * quality/verification information required for staffing.
 *
 * @param input - requirement, candidate profile, and optional clarification answers.
 * @returns the canonical profile and at most three outstanding questions.
 */
export function structureProjectProfile(
  input: StructureProjectProfileInput,
): StructuredProjectProfile {
  const requirement = z.string().trim().min(1).max(4_000).parse(input.requirement)
  const extracted = extractProjectProfile(requirement)
  const candidate = input.candidate === undefined
    ? undefined
    : parseCandidate(input.candidate)
  const merged = projectProfileSchema.parse({
    ...extracted,
    ...candidate,
    goal: candidate?.goal ?? extracted.goal,
    pageCount: candidate?.pageCount ?? extracted.pageCount,
    independentModuleCount:
      candidate?.independentModuleCount ?? extracted.independentModuleCount,
    designComplexity: candidate?.designComplexity ?? extracted.designComplexity,
    testingRequired: candidate?.testingRequired ?? extracted.testingRequired,
    riskLevel: candidate?.riskLevel ?? extracted.riskLevel,
    qualityLevel: candidate?.qualityLevel ?? extracted.qualityLevel,
    budgetPreference: candidate?.budgetPreference ?? extracted.budgetPreference,
    timePreference: candidate?.timePreference ?? extracted.timePreference,
    moduleParallelism: candidate?.moduleParallelism ?? extracted.moduleParallelism,
    techStack: candidate?.techStack ?? extracted.techStack,
  })
  const profile = input.answers === undefined
    ? merged
    : applyProjectClarificationAnswers(merged, input.answers)
  const questions = clarifyProjectProfile(profile)
  return Object.freeze({
    profile,
    questions,
    readyForRecommendation: questions.length === 0,
  })
}

/**
 * Return the limited clarification questions required before deterministic team sizing.
 * @param profile - validated project profile.
 * @returns zero to three structured questions in stable order.
 */
export function clarifyProjectProfile(
  profile: ProjectProfile,
): readonly ProjectClarificationQuestion[] {
  const parsed = projectProfileSchema.parse(profile)
  const questions: ProjectClarificationQuestion[] = []
  if (parsed.pageCount === undefined) {
    questions.push({
      type: 'page-count',
      prompt: 'How many pages should this project deliver?',
      minimum: 1,
      maximum: 64,
    })
  }
  if (
    parsed.independentModuleCount === undefined
    || (
      parsed.independentModuleCount >= 2
      && parsed.moduleParallelism === undefined
    )
  ) {
    questions.push({
      type: 'module-parallelism',
      prompt: 'How many independent modules exist, and how much may they run in parallel?',
      minimumModuleCount: 1,
      maximumModuleCount: 64,
      options: PARALLELISM_OPTIONS.map(option => ({ ...option })),
    })
  }
  if (
    parsed.testingRequired === undefined
    || parsed.qualityLevel === undefined
    || parsed.riskLevel === undefined
  ) {
    questions.push({
      type: 'quality-verification',
      prompt: 'What verification level does this delivery require?',
      options: QUALITY_OPTIONS.map(option => ({ ...option })),
    })
  }
  return Object.freeze(questions)
}

/**
 * Apply structured answers and revalidate the resulting project profile.
 *
 * Duplicate answers for one question are rejected instead of allowing last-write-wins behavior.
 *
 * @param profile - base profile.
 * @param answers - structured answers returned by the caller.
 * @returns a validated profile retaining additional JSON fields.
 */
export function applyProjectClarificationAnswers(
  profile: ProjectProfile,
  answers: readonly ProjectClarificationAnswer[],
): ProjectProfile {
  const parsedProfile = projectProfileSchema.parse(profile)
  const parsedAnswers = answers.map(answer => projectClarificationAnswerSchema.parse(answer))
  const answerTypes = new Set<ProjectClarificationAnswer['type']>()
  for (const answer of parsedAnswers) {
    if (answerTypes.has(answer.type)) {
      throw new TeamRecommenderError(
        `Clarification answer "${answer.type}" was returned more than once`,
        'DUPLICATE_CLARIFICATION',
      )
    }
    answerTypes.add(answer.type)
  }

  let pageCount = parsedProfile.pageCount
  let independentModuleCount = parsedProfile.independentModuleCount
  let moduleParallelism = parsedProfile.moduleParallelism
  let testingRequired = parsedProfile.testingRequired
  let qualityLevel = parsedProfile.qualityLevel
  let riskLevel = parsedProfile.riskLevel
  for (const answer of parsedAnswers) {
    switch (answer.type) {
      case 'page-count':
        pageCount = answer.count
        break
      case 'module-parallelism':
        independentModuleCount = answer.moduleCount
        moduleParallelism = answer.parallelism
        break
      case 'quality-verification': {
        const option = QUALITY_OPTIONS.find(value => value.value === answer.level)
        if (option === undefined) {
          throw new TeamRecommenderError(
            `Unsupported quality level "${answer.level}"`,
            'INVALID_ADJUSTMENT',
          )
        }
        testingRequired = option.testingRequired
        qualityLevel = option.qualityLevel
        riskLevel = option.riskLevel
        break
      }
      default:
        assertNever(answer)
    }
  }
  return projectProfileSchema.parse({
    ...parsedProfile,
    pageCount,
    independentModuleCount,
    moduleParallelism,
    testingRequired,
    qualityLevel,
    riskLevel,
  })
}

/**
 * Recommend a complete team from published Agent versions and optional published templates.
 *
 * The function never invents an Agent or selects a non-published definition. Missing roles remain
 * visible in the result; conversion to Registry input fails until those roles are published.
 *
 * @param input - profile, published catalog, optional templates, and parallel-work ceiling.
 * @returns a deterministic structured recommendation.
 * @throws TeamRecommenderError when the profile needs clarification or the catalog is invalid.
 */
export function recommendAgentTeam(
  input: RecommendAgentTeamInput,
): AgentTeamRecommendation {
  const profile = parseProjectProfile(input.profile)
  const questions = clarifyProjectProfile(profile)
  if (questions.length > 0) {
    throw new TeamRecommenderError(
      `Project profile needs ${String(questions.length)} clarification answer(s)`,
      'PROFILE_NEEDS_CLARIFICATION',
      questions,
    )
  }
  const maximumParallelism = parseMaximumParallelism(
    input.maximumParallelism ?? DEFAULT_MAXIMUM_PARALLELISM,
  )
  const catalog = publishedCatalog(input.publishedAgents)
  const templateMatch = findTemplateSelection(input.teamTemplates ?? [], catalog)
  const selected = new Map<AgentRegistryRole, PublishedAgent>()
  for (const role of RUNTIME_ROLE_ORDER) {
    const fromTemplate = templateMatch?.byRole.get(role)
    const selectedAgent = fromTemplate ?? bestAgentForRole(role, catalog)
    if (selectedAgent !== undefined) selected.set(role, selectedAgent)
  }
  const sources = new Map<AgentRegistryRole, TeamMemberSource>()
  for (const [role, agent] of selected) sources.set(role, memberSource(agent))
  const instanceCounts = new Map<AgentRegistryRole, number>()
  for (const [role, source] of sources) {
    instanceCounts.set(role, targetInstanceCount(role, profile, source))
  }
  return buildRecommendation({
    profile,
    sources,
    instanceCounts,
    maximumParallelism,
    sourceTemplate: templateMatch === undefined
      ? undefined
      : {
        id: templateMatch.template.id,
        name: templateMatch.template.name,
        version: templateMatch.template.version,
      },
  })
}

/**
 * Parse one supported natural-language adjustment into a closed controlled intent.
 * @param instruction - user instruction.
 * @returns the controlled adjustment intent.
 * @throws TeamRecommenderError when the instruction cannot be represented safely.
 */
export function parseTeamAdjustmentIntent(instruction: string): TeamAdjustmentIntent {
  const text = z.string().trim().min(1).max(2_000).parse(instruction)
  const normalized = text.toLowerCase()
  const role = roleFromInstruction(normalized)
  const remove = /(?:减少|减去|删掉|删除|去掉|移除|少一个|remove|decrease)/iu.test(normalized)
  const add = /(?:增加|添加|加一个|再加|多一个|add|increase)/iu.test(normalized)
  if (role !== undefined && remove) {
    return teamAdjustmentIntentSchema.parse({
      type: 'remove-role-instance',
      role,
    })
  }
  if (role !== undefined && add) {
    return teamAdjustmentIntentSchema.parse({
      type: 'add-role-instance',
      role,
    })
  }
  if (
    /(?:提高.*(?:质量|品质)|更高质量|加强.*(?:测试|验证)|raise.*quality|increase.*quality)/iu
      .test(normalized)
  ) {
    return teamAdjustmentIntentSchema.parse({ type: 'raise-quality' })
  }
  if (
    /(?:降低.*并发|减少.*并发|限制.*并发|lower.*concurrency|reduce.*concurrency)/iu
      .test(normalized)
  ) {
    const count = /(\d+)/u.exec(normalized)?.[1]
    return teamAdjustmentIntentSchema.parse({
      type: 'reduce-concurrency',
      ...(count === undefined ? {} : { maximum: Number(count) }),
    })
  }
  if (
    /(?:降低.*规模|缩小.*规模|减少.*规模|低预算|更省钱|精简|reduce.*(?:scale|budget))/iu
      .test(normalized)
  ) {
    return teamAdjustmentIntentSchema.parse({ type: 'reduce-scale' })
  }
  throw new TeamRecommenderError(
    `Unsupported team adjustment "${text}"`,
    'UNSUPPORTED_ADJUSTMENT',
  )
}

/**
 * Apply a controlled adjustment without writing Registry state.
 *
 * A valid floor of one instance per available role is retained so the full team remains complete.
 *
 * @param recommendation - recommendation to revise.
 * @param instruction - natural-language instruction or an already parsed intent.
 * @returns the revised recommendation and structured change explanation.
 */
export function applyTeamAdjustment(
  recommendation: AgentTeamRecommendation,
  instruction: string | TeamAdjustmentIntent,
): TeamAdjustmentResult {
  const intent = typeof instruction === 'string'
    ? parseTeamAdjustmentIntent(instruction)
    : teamAdjustmentIntentSchema.parse(instruction)
  const sources = new Map<AgentRegistryRole, TeamMemberSource>()
  const instanceCounts = new Map<AgentRegistryRole, number>()
  for (const member of recommendation.members) {
    sources.set(member.role, memberSourceFromRecommendation(member))
    instanceCounts.set(member.role, member.instanceCount)
  }
  let profile = recommendation.profile
  let maximumParallelism = recommendation.concurrency.maximumParallelism
  const changes: TeamAdjustmentChange[] = []
  switch (intent.type) {
    case 'add-role-instance': {
      const current = instanceCounts.get(intent.role)
      if (current === undefined) {
        throw new TeamRecommenderError(
          `No published ${intent.role} Agent is available to add`,
          'INCOMPLETE_TEAM',
        )
      }
      if (current >= MAX_INSTANCES_PER_MEMBER) {
        throw new TeamRecommenderError(
          `${intent.role} already has ${String(MAX_INSTANCES_PER_MEMBER)} instances`,
          'INSTANCE_LIMIT',
        )
      }
      const totalInstances = [...instanceCounts.values()].reduce((total, value) => total + value, 0)
      if (totalInstances >= MAX_AGENT_TEAM_MEMBERS) {
        throw new TeamRecommenderError(
          `Teams support at most ${String(MAX_AGENT_TEAM_MEMBERS)} runtime instances`,
          'INSTANCE_LIMIT',
        )
      }
      instanceCounts.set(intent.role, current + 1)
      changes.push({
        kind: 'instance-count',
        role: intent.role,
        from: current,
        to: current + 1,
      })
      break
    }
    case 'remove-role-instance': {
      const current = instanceCounts.get(intent.role)
      if (current === undefined) {
        throw new TeamRecommenderError(
          `No selected ${intent.role} Agent can be removed`,
          'INCOMPLETE_TEAM',
        )
      }
      if (current > 1) {
        instanceCounts.set(intent.role, current - 1)
        changes.push({
          kind: 'instance-count',
          role: intent.role,
          from: current,
          to: current - 1,
        })
      }
      break
    }
    case 'raise-quality': {
      const nextQuality = nextQualityLevel(profile.qualityLevel)
      changes.push({
        kind: 'quality-level',
        from: profile.qualityLevel,
        to: nextQuality,
      })
      profile = projectProfileSchema.parse({
        ...profile,
        testingRequired: true,
        qualityLevel: nextQuality,
        riskLevel: nextQuality === 'critical' ? 'critical' : 'high',
      })
      for (const role of ['tester', 'verifier'] as const) {
        const current = instanceCounts.get(role)
        if (current !== undefined && current < 2) {
          instanceCounts.set(role, 2)
          changes.push({
            kind: 'instance-count',
            role,
            from: current,
            to: 2,
          })
        }
      }
      break
    }
    case 'reduce-concurrency': {
      const requested = intent.maximum
        ?? Math.max(1, recommendation.concurrency.estimatedParallelism - 1)
      maximumParallelism = Math.max(
        1,
        Math.min(
          requested,
          maximumParallelism,
          recommendation.concurrency.estimatedParallelism,
        ),
      )
      break
    }
    case 'reduce-scale': {
      const scalableRole = SCALING_ORDER.find(role => (instanceCounts.get(role) ?? 0) > 1)
      if (scalableRole !== undefined) {
        const current = instanceCounts.get(scalableRole)
        if (current === undefined) {
          throw new TeamRecommenderError(
            `No selected ${scalableRole} Agent can be reduced`,
            'INCOMPLETE_TEAM',
          )
        }
        instanceCounts.set(scalableRole, current - 1)
        changes.push({
          kind: 'instance-count',
          role: scalableRole,
          from: current,
          to: current - 1,
        })
      }
      break
    }
    default:
      assertNever(intent)
  }

  const adjusted = buildRecommendation({
    profile,
    sources,
    instanceCounts,
    maximumParallelism,
    sourceTemplate: recommendation.sourceTemplate,
  })
  if (intent.type === 'reduce-concurrency') {
    const from = recommendation.concurrency.estimatedParallelism
    const to = adjusted.concurrency.estimatedParallelism
    if (to < from) changes.push({ kind: 'parallelism', from, to })
  }
  return Object.freeze({
    recommendation: adjusted,
    intent,
    changes: Object.freeze(changes),
    explanation: explainAdjustment(intent, changes),
  })
}

/**
 * Convert a structured recommendation into a Registry-valid team creation input.
 *
 * The function does not save or publish the team.
 *
 * @param recommendation - complete structured recommendation.
 * @param metadata - optional team identity and display metadata.
 * @returns validated input for `PersistentAgentRegistry.createTeamVersion`.
 * @throws TeamRecommenderError when missing roles or capabilities make the team incomplete.
 */
export function createAgentTeamVersionInputFromRecommendation(
  recommendation: AgentTeamRecommendation,
  metadata: CreateTeamInputMetadata = {},
): CreateAgentTeamVersionInput {
  if (
    recommendation.members.length !== RUNTIME_ROLE_ORDER.length
    || recommendation.missingCapabilities.length > 0
  ) {
    throw new TeamRecommenderError(
      'The recommendation is incomplete and cannot be saved as a team version',
      'INCOMPLETE_TEAM',
    )
  }
  if (recommendation.concurrency.instanceCount > MAX_AGENT_TEAM_MEMBERS) {
    throw new TeamRecommenderError(
      `The recommendation exceeds the ${String(MAX_AGENT_TEAM_MEMBERS)}-instance Team limit`,
      'INSTANCE_LIMIT',
    )
  }
  const input = {
    ...(metadata.id === undefined ? {} : { id: metadata.id }),
    name: metadata.name ?? 'future-cup-recommended-team',
    version: metadata.version ?? '1.0.0',
    purpose: metadata.purpose ?? recommendation.profile.goal,
    members: recommendation.members.map(member => ({
      agentVersionId: member.agentVersionId,
      instanceCount: member.instanceCount,
    })),
    requiredCapabilities: Object.fromEntries(
      recommendation.capabilityCoverage.map(coverage => [
        coverage.capability,
        coverage.required,
      ]),
    ),
    requiredConcurrency: recommendation.concurrency.requiredConcurrency,
    toolPolicy: recommendation.toolPolicy,
    memoryPolicy: recommendation.memoryPolicy,
    inputSchema: recommendation.inputSchema,
    requiredOutputSchemas: recommendation.requiredOutputSchemas,
  }
  return createAgentTeamVersionInputSchema.parse(input)
}

/**
 * Render a concise human-readable summary from the structured recommendation.
 * @param recommendation - structured source of truth.
 * @returns one summary line suitable for a result card or log.
 */
export function summarizeAgentTeamRecommendation(
  recommendation: AgentTeamRecommendation,
): string {
  const members = recommendation.members
    .map(member => `${member.role} x${String(member.instanceCount)}`)
    .join(', ')
  const missing = recommendation.missingCapabilities.length === 0
    ? 'none'
    : recommendation.missingCapabilities.map(value => value.capability).join(', ')
  return [
    `Recommended team: ${members || 'no published Agents'}.`,
    `Estimated parallelism: ${String(recommendation.concurrency.estimatedParallelism)}.`,
    `Instances: ${String(recommendation.concurrency.instanceCount)}.`,
    `Missing capabilities: ${missing}.`,
  ].join(' ')
}

interface TeamMemberSource {
  readonly role: AgentRegistryRole
  readonly name: string
  readonly definitionId: string
  readonly agentVersionId: string
  readonly definitionVersion: string
  readonly capabilities: Readonly<Record<string, number>>
  readonly maxConcurrency: number
  readonly toolAllowlist: readonly string[]
  readonly memoryPolicy: AgentMemoryPolicy
  readonly inputSchema: JsonSchemaDescriptor
  readonly outputSchema: JsonSchemaDescriptor
}

interface TemplateMatch {
  readonly template: AgentTeamVersion
  readonly byRole: ReadonlyMap<AgentRegistryRole, PublishedAgent>
}

interface BuildRecommendationInput {
  readonly profile: ProjectProfile
  readonly sources: ReadonlyMap<AgentRegistryRole, TeamMemberSource>
  readonly instanceCounts: ReadonlyMap<AgentRegistryRole, number>
  readonly maximumParallelism: number
  readonly sourceTemplate: RecommendationSourceTemplate | undefined
}

function extractProjectProfile(requirement: string): ProjectProfile {
  const normalized = requirement.toLowerCase()
  const pageCount = specialPageCount(normalized) ?? countFromPatterns(requirement, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*(?:个|张)?\s*(?:页面|页)/u,
  ])
  const independentModuleCount = countFromPatterns(requirement, [
    /([0-9]+|[一二两三四五六七八九十]+)\s*(?:个)?\s*(?:独立的?|可并行的?|并行的?)?\s*(?:业务|功能)?\s*模块/u,
  ])
  const designComplexity = phraseValue(normalized, {
    high: ['复杂', '丰富', '精细', '高端', 'complex', 'design-heavy'],
    low: ['简单', '基础', '极简', 'simple', 'minimal'],
  }) ?? (pageCount !== undefined && pageCount >= 4 ? 'high' : 'medium')
  const testingRequired = testingPreference(normalized)
  const qualityLevel = phraseValue(normalized, {
    critical: ['关键交付', 'critical', '生产级', '高可用'],
    high: ['高质量', '质量要求高', '严格验证', '高可靠', 'enterprise'],
    basic: ['原型', 'demo', '基础验证', '低成本'],
  })
  const riskLevel = riskPreference(normalized, qualityLevel)
  const budgetPreference = phraseValue(normalized, {
    low: ['低预算', '预算有限', '省钱', '低成本', 'low budget'],
    high: ['高预算', '预算充足', 'high budget'],
  }) ?? 'medium'
  const timePreference = phraseValue(normalized, {
    fast: ['尽快', '快速', '越快越好', 'urgent', 'deadline'],
    'quality-first': ['质量优先', '不赶时间', 'quality first'],
  }) ?? 'balanced'
  const moduleParallelism = phraseValue(normalized, {
    serial: ['串行', '顺序执行', '依次开发', 'serial'],
    parallel: ['并行', '同时开发', 'parallel'],
    balanced: ['平衡并发', '均衡并发', 'balanced'],
  })
  const techStack = detectedTechStack(requirement)
  return projectProfileSchema.parse({
    goal: requirement,
    pageCount,
    independentModuleCount,
    designComplexity,
    testingRequired,
    riskLevel,
    qualityLevel,
    budgetPreference,
    timePreference,
    moduleParallelism,
    techStack: techStack.length === 0 ? [...FUTURE_CUP_DEFAULT_TECH_STACK] : techStack,
  })
}

function parseCandidate(value: unknown): z.infer<typeof projectProfileCandidateSchema> {
  const parsed = projectProfileCandidateSchema.safeParse(value)
  if (!parsed.success) {
    throw new TeamRecommenderError(
      `Invalid project profile candidate: ${formatZodIssues(parsed.error.issues)}`,
      'INVALID_PROJECT_PROFILE',
    )
  }
  return parsed.data
}

function parseProjectProfile(value: ProjectProfile): ProjectProfile {
  const parsed = projectProfileSchema.safeParse(value)
  if (!parsed.success) {
    throw new TeamRecommenderError(
      `Invalid project profile: ${formatZodIssues(parsed.error.issues)}`,
      'INVALID_PROJECT_PROFILE',
    )
  }
  return parsed.data
}

function formatZodIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues.map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
}

function countFromPatterns(text: string, patterns: readonly RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const token = pattern.exec(text)?.[1]
    if (token !== undefined) return parseCountToken(token)
  }
  return undefined
}

function specialPageCount(text: string): number | undefined {
  if (/双页|两页/u.test(text)) return 2
  if (/单页|一页/u.test(text)) return 1
  return undefined
}

function parseCountToken(token: string): number | undefined {
  if (/^\d+$/u.test(token)) {
    const parsed = Number(token)
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 64 ? parsed : undefined
  }
  const digits: Readonly<Record<string, number>> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  if (token === '十') return 10
  const tenIndex = token.indexOf('十')
  if (tenIndex >= 0) {
    const tens = tenIndex === 0 ? 1 : digits[token.slice(0, tenIndex)]
    const ones = tenIndex === token.length - 1
      ? 0
      : digits[token.slice(tenIndex + 1)]
    if (tens === undefined || ones === undefined) return undefined
    const value = tens * 10 + ones
    return value >= 1 && value <= 64 ? value : undefined
  }
  return digits[token]
}

function testingPreference(text: string): boolean | undefined {
  if (/(?:无需|不需要|不要).*(?:测试|验证)|no\s+tests?/iu.test(text)) return false
  if (/(?:需要|必须|包含|开展).*(?:测试|验证)|测试|验收|端到端|playwright|e2e|tests?/iu.test(text)) {
    return true
  }
  return undefined
}

function riskPreference(
  text: string,
  qualityLevel: ProjectProfile['qualityLevel'],
): ProjectProfile['riskLevel'] {
  if (/关键风险|critical risk|支付|金融|医疗/iu.test(text)) return 'critical'
  if (/高风险|high risk|安全敏感/iu.test(text) || qualityLevel === 'high') return 'high'
  if (/低风险|low risk|原型|demo/iu.test(text) || qualityLevel === 'basic') return 'low'
  if (qualityLevel === 'critical') return 'critical'
  return undefined
}

function phraseValue<const T extends string>(
  text: string,
  phrases: Readonly<Record<T, readonly string[]>>,
): T | undefined {
  for (const [value, candidates] of Object.entries(phrases) as [T, readonly string[]][]) {
    if (candidates.some(candidate => text.includes(candidate))) return value
  }
  return undefined
}

function detectedTechStack(text: string): readonly string[] {
  const stack = new Set<string>()
  if (/\breact\b/iu.test(text)) stack.add('React')
  if (/\btypescript\b|ts\.tsx?/iu.test(text)) stack.add('TypeScript')
  if (/\bvite\b/iu.test(text)) stack.add('Vite')
  if (/ant\s*design|antd/iu.test(text)) stack.add('Ant Design')
  if (/\bvue\b/iu.test(text)) stack.add('Vue')
  if (/\bangular\b/iu.test(text)) stack.add('Angular')
  if (/\bsvelte\b/iu.test(text)) stack.add('Svelte')
  if (/\bnext\.js\b|\bnextjs\b/iu.test(text)) stack.add('Next.js')
  if (/\bnuxt\b/iu.test(text)) stack.add('Nuxt')
  return Object.freeze([...stack])
}

function publishedCatalog(entries: readonly PublishedAgent[]): readonly PublishedAgent[] {
  const seen = new Set<string>()
  const published: PublishedAgent[] = []
  for (const entry of entries) {
    if (entry.definition.status !== 'PUBLISHED') continue
    if (entry.definition.id !== entry.version.definitionId) {
      throw new TeamRecommenderError(
        `Agent version "${entry.version.id}" does not belong to definition "${entry.definition.id}"`,
        'INVALID_PUBLISHED_AGENT',
      )
    }
    if (seen.has(entry.version.id)) {
      throw new TeamRecommenderError(
        `Published Agent catalog repeats version "${entry.version.id}"`,
        'INVALID_PUBLISHED_AGENT',
      )
    }
    seen.add(entry.version.id)
    published.push(entry)
  }
  return Object.freeze(published)
}

function findTemplateSelection(
  templates: readonly AgentTeamVersion[],
  catalog: readonly PublishedAgent[],
): TemplateMatch | undefined {
  const byVersion = new Map(catalog.map(agent => [agent.version.id, agent]))
  const ordered = [...templates].sort((left, right) => compareStrings(left.id, right.id))
  for (const template of ordered) {
    const byRole = new Map<AgentRegistryRole, PublishedAgent>()
    const seenInstanceIds = new Set<string>()
    let valid = true
    for (const member of template.members) {
      const live = byVersion.get(member.version.id)
      if (
        live === undefined
        || live.definition.id !== member.definition.id
        || seenInstanceIds.has(member.instanceId)
      ) {
        valid = false
        break
      }
      seenInstanceIds.add(member.instanceId)
      const existing = byRole.get(live.version.role)
      if (existing !== undefined && existing.version.id !== live.version.id) {
        valid = false
        break
      }
      byRole.set(live.version.role, live)
    }
    if (valid && RUNTIME_ROLE_ORDER.every(role => byRole.has(role))) {
      return {
        template,
        byRole,
      }
    }
  }
  return undefined
}

function bestAgentForRole(
  role: AgentRegistryRole,
  catalog: readonly PublishedAgent[],
): PublishedAgent | undefined {
  const capability = capabilityForRole(role)
  return [...catalog]
    .filter(agent => agent.version.role === role)
    .sort((left, right) => (
      (right.version.capabilities[capability] ?? 0)
      - (left.version.capabilities[capability] ?? 0)
      || capabilityTotal(right) - capabilityTotal(left)
      || right.version.maxConcurrency - left.version.maxConcurrency
      || compareStrings(left.version.id, right.version.id)
      || compareStrings(left.definition.id, right.definition.id)
    ))[0]
}

function capabilityTotal(agent: PublishedAgent): number {
  return Object.values(agent.version.capabilities)
    .reduce((total, weight) => total + weight, 0)
}

function memberSource(agent: PublishedAgent): TeamMemberSource {
  return Object.freeze({
    role: agent.version.role,
    name: agent.definition.name,
    definitionId: agent.definition.id,
    agentVersionId: agent.version.id,
    definitionVersion: agent.version.version,
    capabilities: agent.version.capabilities,
    maxConcurrency: agent.version.maxConcurrency,
    toolAllowlist: agent.version.toolAllowlist,
    memoryPolicy: agent.version.memoryPolicy,
    inputSchema: agent.version.inputSchema,
    outputSchema: agent.version.outputSchema,
  })
}

function memberSourceFromRecommendation(
  member: RecommendedTeamMember,
): TeamMemberSource {
  return Object.freeze({
    role: member.role,
    name: member.name,
    definitionId: member.definitionId,
    agentVersionId: member.agentVersionId,
    definitionVersion: member.definitionVersion,
    capabilities: member.capabilities,
    maxConcurrency: member.maxConcurrency,
    toolAllowlist: member.toolAllowlist,
    memoryPolicy: member.memoryPolicy,
    inputSchema: member.inputSchema,
    outputSchema: member.outputSchema,
  })
}

function targetInstanceCount(
  role: AgentRegistryRole,
  profile: ProjectProfile,
  source: TeamMemberSource,
): number {
  if (role === 'frontend') {
    if (profile.budgetPreference === 'low') return 1
    const workload = Math.max(
      profile.pageCount ?? 1,
      profile.independentModuleCount ?? 1,
    )
    const preferenceLimit = profile.moduleParallelism === 'serial'
      ? 1
      : profile.moduleParallelism === 'parallel'
        ? 3
        : 2
    return Math.min(workload, preferenceLimit, source.maxConcurrency + 2)
  }
  if (
    (role === 'tester' || role === 'verifier')
    && highAssurance(profile)
  ) {
    return 2
  }
  return 1
}

function highAssurance(profile: ProjectProfile): boolean {
  return (
    profile.qualityLevel === 'high'
    || profile.qualityLevel === 'critical'
    || profile.riskLevel === 'high'
    || profile.riskLevel === 'critical'
  )
}

function buildRecommendation(
  input: BuildRecommendationInput,
): AgentTeamRecommendation {
  const requestedInstanceCounts = new Map(input.instanceCounts)
  const instanceCounts = trimToRuntimeLimit(input.instanceCounts, input.profile)
  const members: RecommendedTeamMember[] = []
  for (const role of RUNTIME_ROLE_ORDER) {
    const source = input.sources.get(role)
    if (source === undefined) continue
    members.push(Object.freeze({
      role,
      name: source.name,
      definitionId: source.definitionId,
      agentVersionId: source.agentVersionId,
      definitionVersion: source.definitionVersion,
      instanceCount: instanceCounts.get(role) ?? 1,
      capabilities: source.capabilities,
      maxConcurrency: source.maxConcurrency,
      toolAllowlist: source.toolAllowlist,
      memoryPolicy: source.memoryPolicy,
      inputSchema: source.inputSchema,
      outputSchema: source.outputSchema,
    }))
  }

  const capabilityCoverage = capabilityCoverageFor(members)
  const missingCapabilities = capabilityCoverage
    .filter(coverage => !coverage.satisfied)
    .map(coverage => Object.freeze({
      capability: coverage.capability,
      required: coverage.required,
      covered: coverage.covered,
      reason: members.some(member => capabilityForRole(member.role) === coverage.capability)
        ? 'insufficient-capability'
        : 'missing-role',
    } satisfies MissingTeamCapability))
  const aggregateCapacity = members.reduce(
    (total, member) => total + member.maxConcurrency * member.instanceCount,
    0,
  )
  const requestedFrontendCount = requestedInstanceCounts.get('frontend') ?? 0
  const frontendCount = members.find(member => member.role === 'frontend')?.instanceCount ?? 0
  const expectedParallelism = Math.max(
    1,
    requestedFrontendCount > 0
      ? requestedFrontendCount
      : Math.min(members.length, input.maximumParallelism),
  )
  const estimatedParallelism = Math.min(
    Math.max(1, frontendCount > 0 ? frontendCount : members.length),
    input.maximumParallelism,
  )
  const requiredConcurrency = Math.max(1, Math.min(estimatedParallelism, aggregateCapacity || 1))
  const toolPolicy = deriveToolPolicy(members)
  const memoryPolicy = deriveMemoryPolicy(members)
  const inputSchema = members.find(member => member.role === 'planner')?.inputSchema
    ?? members[0]?.inputSchema
    ?? DEFAULT_RECOMMENDATION_INPUT_SCHEMA
  const requiredOutputSchemas = uniqueDescriptors(members.map(member => member.outputSchema))
  const risks = recommendationRisks({
    profile: input.profile,
    members,
    missingCapabilities,
    expectedParallelism,
    estimatedParallelism,
  })
  const reasons = recommendationReasons(input, members)

  return Object.freeze({
    profile: input.profile,
    members: Object.freeze(members),
    capabilityCoverage,
    missingCapabilities: Object.freeze(missingCapabilities),
    concurrency: Object.freeze({
      instanceCount: members.reduce((total, member) => total + member.instanceCount, 0),
      aggregateCapacity,
      estimatedParallelism,
      requiredConcurrency,
      maximumParallelism: input.maximumParallelism,
    }),
    toolPolicy,
    memoryPolicy,
    inputSchema,
    requiredOutputSchemas,
    reasons,
    risks,
    ...(input.sourceTemplate === undefined ? {} : { sourceTemplate: input.sourceTemplate }),
  })
}

function trimToRuntimeLimit(
  counts: ReadonlyMap<AgentRegistryRole, number>,
  profile: ProjectProfile,
): ReadonlyMap<AgentRegistryRole, number> {
  const next = new Map(counts)
  let total = [...next.values()].reduce((sum, value) => sum + value, 0)
  const order = highAssurance(profile)
    ? ['frontend', ...CAPACITY_TRIM_ORDER] as const
    : CAPACITY_TRIM_ORDER
  for (const role of order) {
    while (total > MAX_AGENT_TEAM_MEMBERS && (next.get(role) ?? 0) > 1) {
      next.set(role, (next.get(role) ?? 1) - 1)
      total -= 1
    }
    if (total <= MAX_AGENT_TEAM_MEMBERS) break
  }
  return next
}

function capabilityCoverageFor(
  members: readonly RecommendedTeamMember[],
): readonly TeamCapabilityCoverage[] {
  const coverage = RUNTIME_ROLE_ORDER.map((role) => {
    const capability = capabilityForRole(role)
    const contributors = members
      .filter(member => member.capabilities[capability] !== undefined)
      .map(member => Object.freeze({
        role: member.role,
        agentVersionId: member.agentVersionId,
        weight: member.capabilities[capability] ?? 0,
        instances: member.instanceCount,
      }))
    const covered = contributors.reduce(
      (total, contributor) => total + contributor.weight * contributor.instances,
      0,
    )
    return Object.freeze({
      capability,
      required: 1,
      covered,
      satisfied: covered >= 1,
      contributors: Object.freeze(contributors),
    })
  })
  return Object.freeze(coverage)
}

function deriveToolPolicy(members: readonly RecommendedTeamMember[]): TeamToolPolicy {
  if (members.length === 0) {
    return Object.freeze({
      allowedTools: Object.freeze([]),
      requiredTools: Object.freeze([]),
    })
  }
  const sharedTools = members
    .slice(1)
    .reduce(
      (shared, member) => shared.filter(tool => member.toolAllowlist.includes(tool)),
      [...(members[0]?.toolAllowlist ?? [])],
    )
  const allowedTools = uniqueStrings(members.flatMap(member => member.toolAllowlist))
  return Object.freeze({
    allowedTools,
    requiredTools: uniqueStrings(sharedTools),
  })
}

function deriveMemoryPolicy(
  members: readonly RecommendedTeamMember[],
): TeamMemoryPolicy {
  if (members.length === 0) {
    return Object.freeze({
      allowedAccess: 'NONE',
      requiredAccess: 'NONE',
      allowedKinds: Object.freeze([]),
      requiredKinds: Object.freeze([]),
    })
  }
  const allowedAccess = members.reduce<MemoryAccess>(
    (highest, member) => (
      MEMORY_ACCESS_RANK[member.memoryPolicy.access] > MEMORY_ACCESS_RANK[highest]
        ? member.memoryPolicy.access
        : highest
    ),
    'NONE',
  )
  const allowedKinds = uniqueStrings(members.flatMap(member => member.memoryPolicy.kinds))
  const providers = members.filter(member => (
    MEMORY_ACCESS_RANK[member.memoryPolicy.access] >= MEMORY_ACCESS_RANK.READ
  ))
  return Object.freeze({
    allowedAccess,
    requiredAccess: providers.length === 0 ? 'NONE' : 'READ',
    allowedKinds,
    requiredKinds: providers.length === 0
      ? Object.freeze([])
      : uniqueStrings(providers.flatMap(provider => provider.memoryPolicy.kinds)),
  })
}

function recommendationRisks(input: {
  readonly profile: ProjectProfile
  readonly members: readonly RecommendedTeamMember[]
  readonly missingCapabilities: readonly MissingTeamCapability[]
  readonly expectedParallelism: number
  readonly estimatedParallelism: number
}): readonly TeamRecommendationRisk[] {
  const risks: TeamRecommendationRisk[] = []
  const selectedRoles = new Set(input.members.map(member => member.role))
  for (const role of RUNTIME_ROLE_ORDER) {
    if (!selectedRoles.has(role)) {
      risks.push({
        kind: 'missing-role',
        role,
        message: `No currently published ${role} Agent is available.`,
      })
    }
  }
  for (const missing of input.missingCapabilities) {
    risks.push({
      kind: 'capability-gap',
      capability: missing.capability,
      message: `Capability "${missing.capability}" is covered at ${String(missing.covered)} of ${String(missing.required)}.`,
    })
  }
  if (input.profile.budgetPreference === 'low') {
    risks.push({
      kind: 'budget-tradeoff',
      message: 'Low budget limits multi-instance roles and may reduce delivery parallelism.',
    })
  }
  if (highAssurance(input.profile)) {
    risks.push({
      kind: 'quality-tradeoff',
      message: 'High-assurance delivery adds dedicated testing and verification capacity.',
    })
  }
  if (input.expectedParallelism > input.estimatedParallelism) {
    risks.push({
      kind: 'concurrency-limit',
      requested: input.expectedParallelism,
      applied: input.estimatedParallelism,
      message: `Parallelism was limited from ${String(input.expectedParallelism)} to ${String(input.estimatedParallelism)}.`,
    })
  }
  for (const technology of UNSUPPORTED_TECHNOLOGIES) {
    if (input.profile.techStack?.some(value => value.toLowerCase() === technology.toLowerCase())) {
      risks.push({
        kind: 'unsupported-tech-stack',
        technology,
        message: `${technology} is outside the controlled React frontend delivery stack.`,
      })
    }
  }
  return Object.freeze(risks.map(risk => Object.freeze(risk)))
}

function recommendationReasons(
  input: BuildRecommendationInput,
  members: readonly RecommendedTeamMember[],
): readonly string[] {
  const reasons: string[] = []
  const frontendCount = members.find(member => member.role === 'frontend')?.instanceCount ?? 0
  reasons.push(
    `${String(frontendCount)} frontend instance(s) cover ${String(Math.max(
      input.profile.pageCount ?? 1,
      input.profile.independentModuleCount ?? 1,
    ))} project work unit(s).`,
  )
  if (highAssurance(input.profile)) {
    reasons.push('Quality mode adds dedicated Tester and Verifier instances.')
  }
  if (input.profile.budgetPreference === 'low') {
    reasons.push('Low budget trims optional multi-instance capacity.')
  }
  if (input.sourceTemplate !== undefined) {
    reasons.push(
      `Published template "${input.sourceTemplate.name}@${input.sourceTemplate.version}" supplied the Agent version basis.`,
    )
  }
  reasons.push('Every selected member version is currently published.')
  return Object.freeze(reasons)
}

function uniqueDescriptors(
  descriptors: readonly JsonSchemaDescriptor[],
): readonly JsonSchemaDescriptor[] {
  const seen = new Set<string>()
  const unique: JsonSchemaDescriptor[] = []
  for (const descriptor of descriptors) {
    const key = `${descriptor.id}@${descriptor.version}:${JSON.stringify(descriptor.schema)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(descriptor)
  }
  return Object.freeze(unique)
}

function uniqueStrings<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort(compareStrings))
}

function parseMaximumParallelism(value: number): number {
  return z.number().int().min(1).max(64).parse(value)
}

function roleFromInstruction(text: string): AgentRegistryRole | undefined {
  const aliases: readonly [AgentRegistryRole, RegExp][] = [
    ['planner', /planner|规划|计划/iu],
    ['ui-designer', /ui\s*designer|ui\s*设计|设计师|设计/iu],
    ['tester', /tester|测试/iu],
    ['frontend', /frontend|前端/iu],
    ['integration', /integration|集成/iu],
    ['verifier', /verifier|验证/iu],
    ['repair', /repair|修复/iu],
  ]
  return aliases.find(([, pattern]) => pattern.test(text))?.[0]
}

function nextQualityLevel(
  current: ProjectProfile['qualityLevel'],
): NonNullable<ProjectProfile['qualityLevel']> {
  switch (current) {
    case 'basic':
    case 'standard':
      return 'high'
    case 'high':
      return 'critical'
    case 'critical':
      return 'critical'
    case undefined:
      return 'high'
    default:
      return assertNever(current)
  }
}

function explainAdjustment(
  intent: TeamAdjustmentIntent,
  changes: readonly TeamAdjustmentChange[],
): string {
  if (changes.length === 0) {
    return `Adjustment "${intent.type}" made no change because the recommendation is already at its valid floor.`
  }
  return `Applied "${intent.type}" with ${String(changes.length)} structured change(s).`
}

function capabilityForRole(role: AgentRegistryRole): string {
  switch (role) {
    case 'planner':
      return 'planning'
    case 'ui-designer':
      return 'design'
    case 'tester':
      return 'testing'
    case 'verifier':
      return 'verification'
    default:
      return role
  }
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function assertNever(value: never): never {
  throw new Error(`Unexpected team recommender value: ${String(value)}`)
}

const DEFAULT_RECOMMENDATION_INPUT_SCHEMA: JsonSchemaDescriptor = Object.freeze({
  id: 'future-cup.team-input',
  version: '1.0.0',
  dialect: 'https://json-schema.org/draft/2020-12/schema',
  schema: Object.freeze({
    type: 'object',
    additionalProperties: true,
  }),
})
