/** Immutable Agent definitions, published versions, team compositions, and project bindings. */

import { isDeepStrictEqual } from 'node:util'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import { ProjectId, type ProjectId as ProjectIdType } from './brand.ts'
import { jsonValueSchema } from './schemas.ts'
import type { JsonValue } from './types.ts'

/** Identifies one logical Agent definition. */
export type AgentDefinitionId = Branded<'FutureCupAgentDefinitionId'>

/**
 * Brand an Agent definition id admitted by the registry parser.
 * @param value - validated definition id.
 * @returns the branded definition id.
 */
export function AgentDefinitionId(value: string): AgentDefinitionId {
  return brandString<AgentDefinitionId>(value)
}

/** Identifies one immutable Agent definition version. */
export type AgentVersionId = Branded<'FutureCupAgentVersionId'>

/**
 * Brand an Agent version id admitted by the registry parser.
 * @param value - validated version id.
 * @returns the branded version id.
 */
export function AgentVersionId(value: string): AgentVersionId {
  return brandString<AgentVersionId>(value)
}

/** Identifies one immutable Agent team version. */
export type AgentTeamVersionId = Branded<'FutureCupAgentTeamVersionId'>

/**
 * Brand a team version id admitted by the registry parser.
 * @param value - validated team version id.
 * @returns the branded team version id.
 */
export function AgentTeamVersionId(value: string): AgentTeamVersionId {
  return brandString<AgentTeamVersionId>(value)
}

/** Identifies one project's frozen team binding. */
export type ProjectTeamBindingId = Branded<'FutureCupProjectTeamBindingId'>

/**
 * Brand a project team binding id created by the registry.
 * @param value - generated binding id.
 * @returns the branded binding id.
 */
export function ProjectTeamBindingId(value: string): ProjectTeamBindingId {
  return brandString<ProjectTeamBindingId>(value)
}

/** Agent roles admitted by the controlled Future Cup role library. */
export const AGENT_REGISTRY_ROLES = [
  'planner',
  'ui-designer',
  'tester',
  'frontend',
  'integration',
  'verifier',
  'repair',
] as const

/** One controlled Agent role. */
export type AgentRegistryRole = typeof AGENT_REGISTRY_ROLES[number]

/** JSON Schema dialect accepted for Agent and team input/output descriptors. */
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema' as const

/** Whole-definition lifecycle in strict publication order. */
export const AGENT_LIFECYCLE_STATUSES = [
  'DRAFT',
  'VALIDATED',
  'PUBLISHED',
  'DEPRECATED',
] as const

/** Lifecycle of one Agent definition. */
export type AgentLifecycleStatus = typeof AGENT_LIFECYCLE_STATUSES[number]

/** Structured project-memory facts available to Agent versions. */
export type ProjectMemoryKind =
  | 'requirement'
  | 'design-decision'
  | 'failure-signature'
  | 'accepted-artifact-summary'

/** Project-memory access admitted for one Agent version. */
export type MemoryAccess = 'NONE' | 'READ' | 'WRITE'

/** One Agent version's project-memory permissions. */
export interface AgentMemoryPolicy {
  /** Highest project-memory operation this Agent may perform. */
  readonly access: MemoryAccess
  /** Structured project-memory kinds this Agent may touch. */
  readonly kinds: readonly ProjectMemoryKind[]
}

/** Stable identifier and JSON Schema document for one Agent input or output contract. */
export interface JsonSchemaDescriptor {
  /** Stable contract identity shared by producers and consumers. */
  readonly id: string
  /** Contract revision independent of the Agent version. */
  readonly version: string
  /** Exact JSON Schema dialect of {@link schema}. */
  readonly dialect: typeof JSON_SCHEMA_DIALECT
  /** Complete JSON Schema value. */
  readonly schema: JsonValue
}

/** User-facing metadata and lifecycle state for one logical Agent. */
export interface AgentDefinition {
  /** Stable logical Agent identity. */
  readonly id: AgentDefinitionId
  /** Human-readable Agent name. */
  readonly name: string
  /** Plain-language responsibility used for discovery and team recommendation. */
  readonly purpose: string
  /** Normalized tags used to narrow published-Agent discovery. */
  readonly discoveryTags: readonly string[]
  /** Current whole-definition lifecycle state. */
  readonly status: AgentLifecycleStatus
}

/** One immutable, executable configuration of a logical Agent. */
export interface AgentVersion {
  /** Stable immutable version identity. */
  readonly id: AgentVersionId
  /** Logical Agent that owns this version. */
  readonly definitionId: AgentDefinitionId
  /** Caller-owned semantic version. */
  readonly version: string
  /** Controlled Agent role. */
  readonly role: AgentRegistryRole
  /** Model route pinned by this version. */
  readonly model: string
  /** Complete role prompt pinned by this version. */
  readonly prompt: string
  /** Prompt revision retained separately for audit and rollback. */
  readonly promptVersion: string
  /** Capability weights in the inclusive range from zero to one. */
  readonly capabilities: Readonly<Record<string, number>>
  /** Exact tools this Agent may use. */
  readonly toolAllowlist: readonly string[]
  /** Structured project-memory permissions. */
  readonly memoryPolicy: AgentMemoryPolicy
  /** Maximum concurrent runs for one instance of this version. */
  readonly maxConcurrency: number
  /** Required task-input JSON contract. */
  readonly inputSchema: JsonSchemaDescriptor
  /** Produced result JSON contract. */
  readonly outputSchema: JsonSchemaDescriptor
}

/** Input needed to register one DRAFT Agent definition. */
export interface RegisterAgentDefinitionInput {
  /** Stable logical Agent identity. */
  readonly id: string
  /** Human-readable Agent name. */
  readonly name: string
  /** Plain-language responsibility. */
  readonly purpose: string
  /** Discovery tags. The registry sorts and de-duplicates them. */
  readonly discoveryTags: readonly string[]
}

/** Mutable metadata fields accepted before publication. */
export interface UpdateAgentDefinitionInput {
  /** Replacement human-readable name. */
  readonly name?: string | undefined
  /** Replacement plain-language responsibility. */
  readonly purpose?: string | undefined
  /** Replacement discovery tags. */
  readonly discoveryTags?: readonly string[] | undefined
}

/** Immutable configuration needed to add a version to a mutable definition. */
export interface RegisterAgentVersionInput {
  /** Optional explicit version identity; defaults to `<definitionId>@<version>`. */
  readonly id?: string | undefined
  /** Caller-owned semantic version. */
  readonly version: string
  /** Controlled Agent role. */
  readonly role: AgentRegistryRole
  /** Model route pinned by this version. */
  readonly model: string
  /** Complete role prompt. */
  readonly prompt: string
  /** Prompt revision retained separately for audit. */
  readonly promptVersion: string
  /** Capability weights in the inclusive range from zero to one. */
  readonly capabilities: Readonly<Record<string, number>>
  /** Exact tools this Agent may use. */
  readonly toolAllowlist: readonly string[]
  /** Structured project-memory permissions. */
  readonly memoryPolicy: AgentMemoryPolicy
  /** Maximum concurrent runs for one instance. */
  readonly maxConcurrency: number
  /** Required task-input JSON contract. */
  readonly inputSchema: JsonSchemaDescriptor
  /** Produced result JSON contract. */
  readonly outputSchema: JsonSchemaDescriptor
}

/** Filters for published-Agent discovery. */
export interface AgentDiscoveryQuery {
  /** Every named capability must meet its inclusive minimum weight. */
  readonly capabilities?: Readonly<Record<string, number>> | undefined
  /** Optional single-capability shorthand merged with {@link capabilities}. */
  readonly capability?: string | undefined
  /** Inclusive minimum for the single-capability shorthand. */
  readonly minimumCapability?: number | undefined
  /** Required controlled role. */
  readonly role?: AgentRegistryRole | undefined
  /** Every tag must be present. */
  readonly tags?: readonly string[] | undefined
}

/** One published definition paired with one currently published version. */
export interface PublishedAgent {
  /** Published logical Agent metadata. */
  readonly definition: AgentDefinition
  /** Exact version discovered for scheduling or composition. */
  readonly version: AgentVersion
}

/** Tool ceiling and requirements for one team composition. */
export interface TeamToolPolicy {
  /** Every member's tool allowlist must be a subset of this ceiling. */
  readonly allowedTools: readonly string[]
  /** Tools that at least one member must provide. */
  readonly requiredTools: readonly string[]
}

/** Project-memory ceiling and requirements for one team composition. */
export interface TeamMemoryPolicy {
  /** Highest project-memory operation any member may perform. */
  readonly allowedAccess: MemoryAccess
  /** Minimum project-memory access the full team must provide. */
  readonly requiredAccess: MemoryAccess
  /** Project-memory kinds any member may touch. */
  readonly allowedKinds: readonly ProjectMemoryKind[]
  /** Project-memory kinds the full team must cover. */
  readonly requiredKinds: readonly ProjectMemoryKind[]
}

/** One immutable Agent version reference and instance count in a team. */
export interface TeamMemberComposition {
  /** Published Agent version selected for the team. */
  readonly agentVersionId: string
  /** Number of independently schedulable instances. */
  readonly instanceCount: number
}

/** Input needed to validate and create one immutable team version. */
export interface CreateAgentTeamVersionInput {
  /** Optional explicit team version identity; defaults to a stable composition key. */
  readonly id?: string | undefined
  /** Human-readable team template name. */
  readonly name: string
  /** Caller-owned team semantic version. */
  readonly version: string
  /** Plain-language team responsibility. */
  readonly purpose: string
  /** Selected published Agent versions and instance counts. */
  readonly members: readonly TeamMemberComposition[]
  /** Capability thresholds across all member instances. */
  readonly requiredCapabilities: Readonly<Record<string, number>>
  /** Minimum aggregate concurrency required for the project workload. */
  readonly requiredConcurrency: number
  /** Tool ceiling and required team tools. */
  readonly toolPolicy: TeamToolPolicy
  /** Project-memory ceiling and required team memory access. */
  readonly memoryPolicy: TeamMemoryPolicy
  /** JSON contract accepted by the complete team. */
  readonly inputSchema: JsonSchemaDescriptor
  /** JSON contracts the complete team must produce. */
  readonly requiredOutputSchemas: readonly JsonSchemaDescriptor[]
}

/** Complete Agent definition and version snapshot retained by a team version. */
export interface AgentTeamMemberSnapshot {
  /** Number of independently schedulable instances. */
  readonly instanceCount: number
  /** Logical Agent metadata at team creation time. */
  readonly definition: AgentDefinition
  /** Exact immutable Agent version at team creation time. */
  readonly version: AgentVersion
}

/** One immutable, policy-validated team composition. */
export interface AgentTeamVersion {
  /** Stable immutable team version identity. */
  readonly id: AgentTeamVersionId
  /** Human-readable team template name. */
  readonly name: string
  /** Caller-owned team semantic version. */
  readonly version: string
  /** Plain-language team responsibility. */
  readonly purpose: string
  /** Complete member definition and version snapshots. */
  readonly members: readonly AgentTeamMemberSnapshot[]
  /** Capability thresholds validated against every member instance. */
  readonly requiredCapabilities: Readonly<Record<string, number>>
  /** Minimum aggregate concurrency requested for the team. */
  readonly requiredConcurrency: number
  /** Aggregate safe concurrency across all member instances. */
  readonly concurrencyCapacity: number
  /** Tool ceiling and required team tools. */
  readonly toolPolicy: TeamToolPolicy
  /** Project-memory ceiling and required team memory access. */
  readonly memoryPolicy: TeamMemoryPolicy
  /** JSON contract accepted by the complete team. */
  readonly inputSchema: JsonSchemaDescriptor
  /** JSON contracts produced by the complete team. */
  readonly outputSchemas: readonly JsonSchemaDescriptor[]
}

/** Project-start binding containing a complete immutable team snapshot. */
export interface ProjectTeamBinding {
  /** Stable project binding identity. */
  readonly id: ProjectTeamBindingId
  /** Future Cup project frozen to this team. */
  readonly projectId: ProjectIdType
  /** Exact team version selected at project start. */
  readonly teamVersion: AgentTeamVersion
  /** Direct member snapshot retained even if registry state later changes. */
  readonly members: readonly AgentTeamMemberSnapshot[]
}

/** Stable machine-readable Agent Registry failure code. */
export type AgentRegistryErrorCode =
  | 'INVALID_INPUT'
  | 'DUPLICATE_DEFINITION'
  | 'DEFINITION_NOT_FOUND'
  | 'DEFINITION_IMMUTABLE'
  | 'INVALID_TRANSITION'
  | 'DUPLICATE_VERSION'
  | 'DUPLICATE_VERSION_NUMBER'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_REQUIRED'
  | 'VERSION_VALIDATION_FAILED'
  | 'VERSION_NOT_VALIDATED'
  | 'VERSION_NOT_PUBLISHED'
  | 'DUPLICATE_TEAM_VERSION'
  | 'TEAM_VERSION_NOT_FOUND'
  | 'DUPLICATE_TEAM_MEMBER'
  | 'CAPABILITY_NOT_COVERED'
  | 'CONCURRENCY_INSUFFICIENT'
  | 'TOOL_POLICY_INVALID'
  | 'MEMORY_POLICY_INVALID'
  | 'OUTPUT_CONTRACT_INVALID'
  | 'PROJECT_ALREADY_BOUND'

/** Structured Agent Registry validation or transition failure. */
export class AgentRegistryError extends Error {
  /**
   * @param message - actionable failure description.
   * @param code - stable machine-readable failure code.
   * @param definitionId - optional logical Agent identity.
   * @param versionId - optional Agent version identity.
   * @param fromStatus - optional lifecycle source state.
   * @param toStatus - optional requested lifecycle target state.
   */
  constructor(
    message: string,
    readonly code: AgentRegistryErrorCode,
    readonly definitionId?: AgentDefinitionId,
    readonly versionId?: AgentVersionId,
    readonly fromStatus?: AgentLifecycleStatus,
    readonly toStatus?: AgentLifecycleStatus,
  ) {
    super(message)
    this.name = 'AgentRegistryError'
  }
}

const identifierSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u)

const tagSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u)

const capabilityNameSchema = z.string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u)

const toolNameSchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u)

const memoryAccessSchema = z.enum(['NONE', 'READ', 'WRITE'])
const projectMemoryKindSchema = z.enum([
  'requirement',
  'design-decision',
  'failure-signature',
  'accepted-artifact-summary',
])
const agentRoleSchema = z.enum(AGENT_REGISTRY_ROLES)

const capabilityMapSchema = z.record(
  capabilityNameSchema,
  z.number().min(0).max(1),
).refine(
  value => Object.keys(value).length <= 64,
  'an Agent supports at most 64 capabilities',
)

const agentMemoryPolicySchema = z.object({
  access: memoryAccessSchema,
  kinds: z.array(projectMemoryKindSchema).max(4).refine(
    values => new Set(values).size === values.length,
    'memory kinds must be unique',
  ),
}).strict().superRefine((value, context) => {
  if (value.access === 'NONE' && value.kinds.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['kinds'],
      message: 'memory kinds must be empty when access is NONE',
    })
  }
})

const jsonSchemaDescriptorSchema = z.object({
  id: identifierSchema,
  version: identifierSchema,
  dialect: z.literal(JSON_SCHEMA_DIALECT),
  schema: z.record(z.string(), jsonValueSchema),
}).strict()

export const registerAgentDefinitionInputSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(160),
  purpose: z.string().trim().min(1).max(4_000),
  discoveryTags: z.array(tagSchema).max(64),
}).strict()

export const updateAgentDefinitionInputSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  purpose: z.string().trim().min(1).max(4_000).optional(),
  discoveryTags: z.array(tagSchema).max(64).optional(),
}).strict()

export const registerAgentVersionInputSchema = z.object({
  id: identifierSchema.optional(),
  version: identifierSchema,
  role: agentRoleSchema,
  model: identifierSchema,
  prompt: z.string().trim().min(1).max(200_000),
  promptVersion: identifierSchema,
  capabilities: capabilityMapSchema,
  toolAllowlist: z.array(toolNameSchema).max(128),
  memoryPolicy: agentMemoryPolicySchema,
  maxConcurrency: z.number().int().positive().max(10_000),
  inputSchema: jsonSchemaDescriptorSchema,
  outputSchema: jsonSchemaDescriptorSchema,
}).strict()

export const agentDiscoveryQuerySchema = z.object({
  capabilities: capabilityMapSchema.optional(),
  capability: capabilityNameSchema.optional(),
  minimumCapability: z.number().min(0).max(1).optional(),
  role: agentRoleSchema.optional(),
  tags: z.array(tagSchema).max(64).optional(),
}).strict().superRefine((value, context) => {
  if (value.minimumCapability !== undefined && value.capability === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['minimumCapability'],
      message: 'minimumCapability requires capability',
    })
  }
})

const teamToolPolicySchema = z.object({
  allowedTools: z.array(toolNameSchema).max(128),
  requiredTools: z.array(toolNameSchema).max(128),
}).strict().superRefine((value, context) => {
  const allowed = new Set(value.allowedTools)
  for (const [index, tool] of value.requiredTools.entries()) {
    if (!allowed.has(tool)) {
      context.addIssue({
        code: 'custom',
        path: ['requiredTools', index],
        message: `required tool "${tool}" is outside allowedTools`,
      })
    }
  }
})

const teamMemoryPolicySchema = z.object({
  allowedAccess: memoryAccessSchema,
  requiredAccess: memoryAccessSchema,
  allowedKinds: z.array(projectMemoryKindSchema).max(4),
  requiredKinds: z.array(projectMemoryKindSchema).max(4),
}).strict().superRefine((value, context) => {
  const allowed = new Set(value.allowedKinds)
  for (const [index, kind] of value.requiredKinds.entries()) {
    if (!allowed.has(kind)) {
      context.addIssue({
        code: 'custom',
        path: ['requiredKinds', index],
        message: `required memory kind "${kind}" is outside allowedKinds`,
      })
    }
  }
  if (memoryRank(value.requiredAccess) > memoryRank(value.allowedAccess)) {
    context.addIssue({
      code: 'custom',
      path: ['requiredAccess'],
      message: 'requiredAccess must not exceed allowedAccess',
    })
  }
  if (value.allowedAccess === 'NONE' && value.allowedKinds.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['allowedKinds'],
      message: 'allowedKinds must be empty when allowedAccess is NONE',
    })
  }
  if (value.requiredAccess === 'NONE' && value.requiredKinds.length > 0) {
    context.addIssue({
      code: 'custom',
      path: ['requiredKinds'],
      message: 'requiredKinds must be empty when requiredAccess is NONE',
    })
  }
})

export const createAgentTeamVersionInputSchema = z.object({
  id: identifierSchema.optional(),
  name: z.string().trim().min(1).max(160),
  version: identifierSchema,
  purpose: z.string().trim().min(1).max(4_000),
  members: z.array(z.object({
    agentVersionId: identifierSchema,
    instanceCount: z.number().int().positive().max(100),
  }).strict()).min(1).max(64),
  requiredCapabilities: capabilityMapSchema,
  requiredConcurrency: z.number().int().positive().max(1_000_000),
  toolPolicy: teamToolPolicySchema,
  memoryPolicy: teamMemoryPolicySchema,
  inputSchema: jsonSchemaDescriptorSchema,
  requiredOutputSchemas: z.array(jsonSchemaDescriptorSchema).min(1).max(64),
}).strict()

const agentDefinitionSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(160),
  purpose: z.string().trim().min(1).max(4_000),
  discoveryTags: z.array(tagSchema).max(64),
  status: z.enum(AGENT_LIFECYCLE_STATUSES),
}).strict()

const agentVersionSchema = z.object({
  id: identifierSchema,
  definitionId: identifierSchema,
  version: identifierSchema,
  role: agentRoleSchema,
  model: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(30_000),
  promptVersion: identifierSchema,
  capabilities: capabilityMapSchema,
  toolAllowlist: z.array(toolNameSchema).max(100),
  memoryPolicy: agentMemoryPolicySchema,
  maxConcurrency: z.number().int().positive().max(1_000_000),
  inputSchema: jsonSchemaDescriptorSchema,
  outputSchema: jsonSchemaDescriptorSchema,
}).strict()

const agentTeamMemberSnapshotSchema = z.object({
  instanceCount: z.number().int().positive().max(100),
  definition: agentDefinitionSchema,
  version: agentVersionSchema,
}).strict()

const agentTeamVersionSchema = z.object({
  id: identifierSchema,
  name: z.string().trim().min(1).max(160),
  version: identifierSchema,
  purpose: z.string().trim().min(1).max(4_000),
  members: z.array(agentTeamMemberSnapshotSchema).min(1).max(64),
  requiredCapabilities: capabilityMapSchema,
  requiredConcurrency: z.number().int().positive().max(1_000_000),
  concurrencyCapacity: z.number().int().positive().max(100_000_000),
  toolPolicy: teamToolPolicySchema,
  memoryPolicy: teamMemoryPolicySchema,
  inputSchema: jsonSchemaDescriptorSchema,
  outputSchemas: z.array(jsonSchemaDescriptorSchema).min(1).max(64),
}).strict()

const projectTeamBindingSchema = z.object({
  id: identifierSchema,
  projectId: identifierSchema,
  teamVersion: agentTeamVersionSchema,
  members: z.array(agentTeamMemberSnapshotSchema).min(1).max(64),
}).strict()

/**
 * Validate one durable Agent definition.
 * @param value - decoded SQLite, PostgreSQL, or API value.
 * @returns a frozen Agent definition.
 */
export function parseStoredAgentDefinition(value: unknown): AgentDefinition {
  const parsed = agentDefinitionSchema.parse(value)
  return freezeAgentDefinition({
    ...parsed,
    id: AgentDefinitionId(parsed.id),
  })
}

/**
 * Validate one durable immutable Agent version.
 * @param value - decoded SQLite, PostgreSQL, or API value.
 * @returns a frozen Agent version.
 */
export function parseStoredAgentVersion(value: unknown): AgentVersion {
  const parsed = agentVersionSchema.parse(value)
  return freezeAgentVersion({
    ...parsed,
    id: AgentVersionId(parsed.id),
    definitionId: AgentDefinitionId(parsed.definitionId),
  })
}

/**
 * Validate one durable immutable team version.
 * @param value - decoded SQLite, PostgreSQL, or API value.
 * @returns a frozen team version.
 */
export function parseStoredAgentTeamVersion(value: unknown): AgentTeamVersion {
  const parsed = agentTeamVersionSchema.parse(value)
  return freezeAgentTeamVersion({
    ...parsed,
    id: AgentTeamVersionId(parsed.id),
    members: parsed.members.map(member => freezeTeamMember({
      ...member,
      definition: parseStoredAgentDefinition(member.definition),
      version: parseStoredAgentVersion(member.version),
    })),
  })
}

/**
 * Validate one durable frozen project team binding.
 * @param value - decoded SQLite, PostgreSQL, or API value.
 * @returns a frozen project binding.
 */
export function parseProjectTeamBinding(value: unknown): ProjectTeamBinding {
  const parsed = projectTeamBindingSchema.parse(value)
  return Object.freeze({
    id: ProjectTeamBindingId(parsed.id),
    projectId: ProjectId(parsed.projectId),
    teamVersion: parseStoredAgentTeamVersion(parsed.teamVersion),
    members: parsed.members.map(member => freezeTeamMember({
      ...member,
      definition: parseStoredAgentDefinition(member.definition),
      version: parseStoredAgentVersion(member.version),
    })),
  })
}

const MEMORY_ACCESS_RANK: Readonly<Record<MemoryAccess, number>> = Object.freeze({
  NONE: 0,
  READ: 1,
  WRITE: 2,
})

const ALLOWED_TRANSITIONS: Readonly<
  Record<AgentLifecycleStatus, readonly AgentLifecycleStatus[]>
> = Object.freeze({
  DRAFT: Object.freeze(['VALIDATED'] as const),
  VALIDATED: Object.freeze(['PUBLISHED'] as const),
  PUBLISHED: Object.freeze(['DEPRECATED'] as const),
  DEPRECATED: Object.freeze([] as const),
})

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function orderedUniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareStrings))
}

function freezeCapabilityMap(
  value: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const entries = Object.entries(value).sort(([left], [right]) => compareStrings(left, right))
  return Object.freeze(Object.fromEntries(entries))
}

function freezeJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    for (const child of value) freezeJsonValue(child)
    Object.freeze(value)
    return value
  }
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJsonValue(child)
    Object.freeze(value)
  }
  return value
}

function freezeJsonSchemaDescriptor(value: JsonSchemaDescriptor): JsonSchemaDescriptor {
  const schema = freezeJsonValue(structuredClone(value.schema))
  return Object.freeze({
    id: value.id,
    version: value.version,
    dialect: value.dialect,
    schema,
  })
}

function freezeAgentMemoryPolicy(value: AgentMemoryPolicy): AgentMemoryPolicy {
  return Object.freeze({
    access: value.access,
    kinds: Object.freeze([...value.kinds]),
  })
}

function freezeAgentDefinition(value: AgentDefinition): AgentDefinition {
  return Object.freeze({
    id: AgentDefinitionId(value.id),
    name: value.name,
    purpose: value.purpose,
    discoveryTags: orderedUniqueStrings(value.discoveryTags),
    status: value.status,
  })
}

function freezeAgentVersion(value: AgentVersion): AgentVersion {
  return Object.freeze({
    id: AgentVersionId(value.id),
    definitionId: AgentDefinitionId(value.definitionId),
    version: value.version,
    role: value.role,
    model: value.model,
    prompt: value.prompt,
    promptVersion: value.promptVersion,
    capabilities: freezeCapabilityMap(value.capabilities),
    toolAllowlist: orderedUniqueStrings(value.toolAllowlist),
    memoryPolicy: freezeAgentMemoryPolicy(value.memoryPolicy),
    maxConcurrency: value.maxConcurrency,
    inputSchema: freezeJsonSchemaDescriptor(value.inputSchema),
    outputSchema: freezeJsonSchemaDescriptor(value.outputSchema),
  })
}

function freezeTeamToolPolicy(value: TeamToolPolicy): TeamToolPolicy {
  return Object.freeze({
    allowedTools: orderedUniqueStrings(value.allowedTools),
    requiredTools: orderedUniqueStrings(value.requiredTools),
  })
}

function freezeTeamMemoryPolicy(value: TeamMemoryPolicy): TeamMemoryPolicy {
  return Object.freeze({
    allowedAccess: value.allowedAccess,
    requiredAccess: value.requiredAccess,
    allowedKinds: Object.freeze([...new Set(value.allowedKinds)].sort(compareStrings)),
    requiredKinds: Object.freeze([...new Set(value.requiredKinds)].sort(compareStrings)),
  })
}

function freezeTeamMember(value: AgentTeamMemberSnapshot): AgentTeamMemberSnapshot {
  return Object.freeze({
    instanceCount: value.instanceCount,
    definition: freezeAgentDefinition(value.definition),
    version: freezeAgentVersion(value.version),
  })
}

function compareSchemaDescriptors(
  left: JsonSchemaDescriptor,
  right: JsonSchemaDescriptor,
): number {
  return compareStrings(`${left.id}@${left.version}`, `${right.id}@${right.version}`)
}

function freezeAgentTeamVersion(value: AgentTeamVersion): AgentTeamVersion {
  const members = value.members.map(freezeTeamMember).sort((left, right) => (
    compareStrings(
      `${left.definition.id}@${left.version.version}`,
      `${right.definition.id}@${right.version.version}`,
    )
  ))
  const outputSchemas = value.outputSchemas
    .map(freezeJsonSchemaDescriptor)
    .sort(compareSchemaDescriptors)
  return Object.freeze({
    id: AgentTeamVersionId(value.id),
    name: value.name,
    version: value.version,
    purpose: value.purpose,
    members: Object.freeze(members),
    requiredCapabilities: freezeCapabilityMap(value.requiredCapabilities),
    requiredConcurrency: value.requiredConcurrency,
    concurrencyCapacity: value.concurrencyCapacity,
    toolPolicy: freezeTeamToolPolicy(value.toolPolicy),
    memoryPolicy: freezeTeamMemoryPolicy(value.memoryPolicy),
    inputSchema: freezeJsonSchemaDescriptor(value.inputSchema),
    outputSchemas: Object.freeze(outputSchemas),
  })
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? '<root>' : issue.path.join('.')
    return `${path}: ${issue.message}`
  }).join('; ')
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new AgentRegistryError(
      `Invalid ${label}: ${formatZodIssues(parsed.error)}`,
      'INVALID_INPUT',
    )
  }
  return parsed.data
}

function memoryRank(value: MemoryAccess): number {
  return MEMORY_ACCESS_RANK[value]
}

function memoryCovers(actual: MemoryAccess, required: MemoryAccess): boolean {
  return memoryRank(actual) >= memoryRank(required)
}

function schemaDeclaresObject(value: JsonValue): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const type = value.type
  return type === 'object' || (Array.isArray(type) && type.includes('object'))
}

function descriptorsEqual(left: JsonSchemaDescriptor, right: JsonSchemaDescriptor): boolean {
  return isDeepStrictEqual(left, right)
}

/**
 * In-memory owner of Agent lifecycle, immutable versions, team composition, and project freezing.
 * Every returned definition, version, team version, and binding object graph is frozen.
 */
export class AgentRegistry {
  private readonly definitions = new Map<AgentDefinitionId, AgentDefinition>()
  private readonly versions = new Map<AgentVersionId, AgentVersion>()
  private readonly versionsByDefinition = new Map<AgentDefinitionId, Map<AgentVersionId, AgentVersion>>()
  private readonly versionStatuses = new Map<AgentVersionId, AgentLifecycleStatus>()
  private readonly teamVersions = new Map<AgentTeamVersionId, AgentTeamVersion>()
  private readonly projectBindings = new Map<ProjectIdType, ProjectTeamBinding>()

  /**
   * Register one logical Agent in DRAFT.
   * @param input - stable metadata for the logical Agent.
   * @returns the frozen DRAFT definition.
   */
  registerDefinition(input: RegisterAgentDefinitionInput): AgentDefinition {
    const parsed = parseInput(registerAgentDefinitionInputSchema, input, 'Agent definition')
    const id = AgentDefinitionId(parsed.id)
    if (this.definitions.has(id)) {
      throw new AgentRegistryError(
        `Agent definition "${id}" is already registered`,
        'DUPLICATE_DEFINITION',
        id,
      )
    }
    const definition = freezeAgentDefinition({
      id,
      name: parsed.name,
      purpose: parsed.purpose,
      discoveryTags: parsed.discoveryTags,
      status: 'DRAFT',
    })
    this.definitions.set(id, definition)
    this.versionsByDefinition.set(id, new Map())
    return definition
  }

  /**
   * Update mutable metadata before publication.
   * @param definitionId - logical Agent to update.
   * @param input - replacement metadata fields.
   * @returns the frozen updated DRAFT or VALIDATED definition.
   */
  updateDefinition(
    definitionId: string,
    input: UpdateAgentDefinitionInput,
  ): AgentDefinition {
    const current = this.requireDefinition(definitionId)
    this.assertDefinitionMutable(current)
    const parsed = parseInput(updateAgentDefinitionInputSchema, input, 'Agent definition update')
    if (
      parsed.name === undefined
      && parsed.purpose === undefined
      && parsed.discoveryTags === undefined
    ) {
      return current
    }
    const updated = freezeAgentDefinition({
      ...current,
      name: parsed.name ?? current.name,
      purpose: parsed.purpose ?? current.purpose,
      discoveryTags: parsed.discoveryTags ?? current.discoveryTags,
    })
    this.definitions.set(updated.id, updated)
    return updated
  }

  /**
   * Register one immutable Agent version on a mutable definition.
   * @param definitionId - logical Agent that owns the version.
   * @param input - complete executable version configuration.
   * @returns the frozen Agent version.
   */
  registerVersion(
    definitionId: string,
    input: RegisterAgentVersionInput,
  ): AgentVersion {
    const definition = this.requireDefinition(definitionId)
    this.assertDefinitionAcceptsVersions(definition)
    const parsed = parseInput(registerAgentVersionInputSchema, input, 'Agent version')
    const definitionVersions = this.versionsByDefinition.get(definition.id)
    if (definitionVersions === undefined) {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" has no version store`,
        'DEFINITION_NOT_FOUND',
        definition.id,
      )
    }
    if ([...definitionVersions.values()].some(version => version.version === parsed.version)) {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" already has version "${parsed.version}"`,
        'DUPLICATE_VERSION_NUMBER',
        definition.id,
      )
    }
    const versionId = AgentVersionId(parsed.id ?? `${definition.id}@${parsed.version}`)
    if (this.versions.has(versionId)) {
      throw new AgentRegistryError(
        `Agent version "${versionId}" is already registered`,
        'DUPLICATE_VERSION',
        definition.id,
        versionId,
      )
    }
    const version = freezeAgentVersion({
      id: versionId,
      definitionId: definition.id,
      version: parsed.version,
      role: parsed.role,
      model: parsed.model,
      prompt: parsed.prompt,
      promptVersion: parsed.promptVersion,
      capabilities: parsed.capabilities,
      toolAllowlist: parsed.toolAllowlist,
      memoryPolicy: parsed.memoryPolicy,
      maxConcurrency: parsed.maxConcurrency,
      inputSchema: parsed.inputSchema,
      outputSchema: parsed.outputSchema,
    })
    definitionVersions.set(version.id, version)
    this.versions.set(version.id, version)
    this.versionStatuses.set(version.id, 'DRAFT')
    return version
  }

  /**
   * Validate one DRAFT version without changing a definition that is already published.
   * @param definitionId - logical Agent to validate.
   * @param versionId - optional version when the definition has exactly one version.
   * @returns the frozen current definition.
   */
  validate(definitionId: string, versionId?: string): AgentDefinition {
    const definition = this.requireDefinition(definitionId)
    if (definition.status === 'DEPRECATED') {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" cannot validate new versions after DEPRECATED`,
        'INVALID_TRANSITION',
        definition.id,
        versionId === undefined ? undefined : AgentVersionId(versionId),
        definition.status,
        'VALIDATED',
      )
    }
    const version = this.resolveVersion(definition, versionId)
    this.assertVersionTransition(version, 'VALIDATED')
    this.validateVersionSemantics(version)
    this.versionStatuses.set(version.id, 'VALIDATED')
    return definition.status === 'DRAFT'
      ? this.transition(definition, 'VALIDATED')
      : definition
  }

  /**
   * Publish one validated version while retaining every earlier published version.
   * @param definitionId - logical Agent to publish.
   * @param versionId - optional version when the definition has exactly one version.
   * @returns the frozen current definition.
   */
  publish(definitionId: string, versionId?: string): AgentDefinition {
    const definition = this.requireDefinition(definitionId)
    if (definition.status === 'DRAFT' || definition.status === 'DEPRECATED') {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" cannot publish a version from ${definition.status}`,
        'INVALID_TRANSITION',
        definition.id,
        undefined,
        definition.status,
        'PUBLISHED',
      )
    }
    const version = this.resolveVersion(definition, versionId)
    if (this.requireVersionStatus(version.id) === 'DRAFT') {
      throw new AgentRegistryError(
        `Agent version "${version.id}" has not passed validation`,
        'VERSION_NOT_VALIDATED',
        definition.id,
        version.id,
      )
    }
    this.assertVersionTransition(version, 'PUBLISHED')
    this.versionStatuses.set(version.id, 'PUBLISHED')
    return definition.status === 'VALIDATED'
      ? this.transition(definition, 'PUBLISHED')
      : definition
  }

  /**
   * Deprecate one published definition and remove its version from discovery.
   * @param definitionId - logical Agent to deprecate.
   * @returns the frozen DEPRECATED definition.
   */
  deprecate(definitionId: string): AgentDefinition {
    const definition = this.requireDefinition(definitionId)
    this.assertTransition(definition, 'DEPRECATED')
    const deprecated = this.transition(definition, 'DEPRECATED')
    for (const version of this.versionsByDefinition.get(definition.id)?.values() ?? []) {
      if (this.versionStatuses.get(version.id) === 'PUBLISHED') {
        this.versionStatuses.set(version.id, 'DEPRECATED')
      }
    }
    return deprecated
  }

  /**
   * Read one logical Agent definition.
   * @param definitionId - requested logical Agent.
   * @returns the frozen current definition.
   */
  getDefinition(definitionId: string): AgentDefinition {
    return this.requireDefinition(definitionId)
  }

  /**
   * List every logical Agent definition in stable identity order.
   * @returns frozen current definitions.
   */
  listDefinitions(): readonly AgentDefinition[] {
    const definitions = [...this.definitions.values()]
      .sort((left, right) => compareStrings(left.id, right.id))
    return Object.freeze(definitions)
  }

  /**
   * Read one immutable Agent version.
   * @param versionId - requested Agent version.
   * @returns the frozen Agent version.
   */
  getVersion(versionId: string): AgentVersion {
    return this.requireVersion(versionId)
  }

  /**
   * Read the lifecycle stage of one immutable Agent version.
   * @param versionId - requested Agent version.
   * @returns the current DRAFT, VALIDATED, PUBLISHED, or DEPRECATED stage.
   */
  getVersionStatus(versionId: string): AgentLifecycleStatus {
    const version = this.requireVersion(versionId)
    return this.requireVersionStatus(version.id)
  }

  /**
   * List every version registered under one logical Agent.
   * @param definitionId - logical Agent whose versions are requested.
   * @returns frozen versions sorted by semantic version and identity.
   */
  listVersions(definitionId: string): readonly AgentVersion[] {
    const definition = this.requireDefinition(definitionId)
    const versions = [...(this.versionsByDefinition.get(definition.id)?.values() ?? [])]
      .sort((left, right) => (
        compareStrings(left.version, right.version) || compareStrings(left.id, right.id)
      ))
    return Object.freeze(versions)
  }

  /**
   * Discover currently published Agent versions by capabilities, role, and tags.
   * @param query - optional capability thresholds and metadata filters.
   * @returns frozen published definition/version pairs in stable identity order.
   */
  discoverPublished(query: AgentDiscoveryQuery = {}): readonly PublishedAgent[] {
    const parsed = parseInput(agentDiscoveryQuerySchema, query, 'Agent discovery query')
    const capabilities: Record<string, number> = { ...parsed.capabilities }
    if (parsed.capability !== undefined) {
      capabilities[parsed.capability] = parsed.minimumCapability ?? 0
    }
    const tags = parsed.tags ?? []
    const published: PublishedAgent[] = []
    for (const definition of this.definitions.values()) {
      if (definition.status !== 'PUBLISHED') continue
      if (!tags.every(tag => definition.discoveryTags.includes(tag))) continue
      for (const version of this.versionsByDefinition.get(definition.id)?.values() ?? []) {
        if (this.requireVersionStatus(version.id) !== 'PUBLISHED') continue
        if (parsed.role !== undefined && version.role !== parsed.role) continue
        if (!Object.entries(capabilities).every(
          ([capability, weight]) => {
            const actual = version.capabilities[capability]
            return actual !== undefined && actual >= weight
          },
        )) {
          continue
        }
        published.push(Object.freeze({ definition, version }))
      }
    }
    published.sort((left, right) => (
      compareStrings(left.definition.name, right.definition.name)
      || compareStrings(left.definition.id, right.definition.id)
      || compareStrings(left.version.version, right.version.version)
    ))
    return Object.freeze(published)
  }

  /**
   * Discover published versions that meet one capability threshold.
   * @param capability - required capability name.
   * @param minimumCapability - inclusive minimum weight.
   * @returns frozen versions in stable identity order.
   */
  findPublishedVersionsByCapability(
    capability: string,
    minimumCapability = 0,
  ): readonly AgentVersion[] {
    return Object.freeze(this.discoverPublished({
      capability,
      minimumCapability,
    }).map(entry => entry.version))
  }

  /**
   * Validate one composition and create its immutable team version.
   * @param input - published member references, requirements, and policies.
   * @returns the frozen validated team version.
   */
  createTeamVersion(input: CreateAgentTeamVersionInput): AgentTeamVersion {
    const parsed = parseInput(createAgentTeamVersionInputSchema, input, 'Agent team composition')
    const teamVersionId = AgentTeamVersionId(
      parsed.id ?? `team:${parsed.name}:${parsed.version}`,
    )
    if (this.teamVersions.has(teamVersionId)) {
      throw new AgentRegistryError(
        `Agent team version "${teamVersionId}" is already registered`,
        'DUPLICATE_TEAM_VERSION',
        undefined,
        undefined,
      )
    }
    const members: AgentTeamMemberSnapshot[] = []
    const seenVersionIds = new Set<AgentVersionId>()
    for (const member of parsed.members) {
      const version = this.requireVersion(member.agentVersionId)
      if (seenVersionIds.has(version.id)) {
        throw new AgentRegistryError(
          `Agent version "${version.id}" appears more than once in the team`,
          'DUPLICATE_TEAM_MEMBER',
          version.definitionId,
          version.id,
        )
      }
      const definition = this.requireDefinition(version.definitionId)
      if (
        definition.status !== 'PUBLISHED'
        || this.requireVersionStatus(version.id) !== 'PUBLISHED'
      ) {
        throw new AgentRegistryError(
          `Agent version "${version.id}" is not currently published`,
          'VERSION_NOT_PUBLISHED',
          definition.id,
          version.id,
        )
      }
      seenVersionIds.add(version.id)
      members.push(freezeTeamMember({
        instanceCount: member.instanceCount,
        definition,
        version,
      }))
    }
    members.sort((left, right) => (
      compareStrings(left.definition.id, right.definition.id)
      || compareStrings(left.version.version, right.version.version)
    ))
    const frozenMembers = Object.freeze(members)
    const requiredCapabilities = freezeCapabilityMap(parsed.requiredCapabilities)
    const toolPolicy = freezeTeamToolPolicy(parsed.toolPolicy)
    const memoryPolicy = freezeTeamMemoryPolicy(parsed.memoryPolicy)
    const inputSchema = freezeJsonSchemaDescriptor(parsed.inputSchema)
    const outputSchemas = Object.freeze(
      parsed.requiredOutputSchemas
        .map(freezeJsonSchemaDescriptor)
        .sort(compareSchemaDescriptors),
    )
    this.validateTeamCapabilities(frozenMembers, requiredCapabilities)
    const concurrencyCapacity = this.validateTeamConcurrency(
      frozenMembers,
      parsed.requiredConcurrency,
    )
    this.validateTeamTools(frozenMembers, toolPolicy)
    this.validateTeamMemory(frozenMembers, memoryPolicy)
    this.validateTeamOutputs(frozenMembers, inputSchema, outputSchemas)

    const teamVersion = freezeAgentTeamVersion({
      id: teamVersionId,
      name: parsed.name,
      version: parsed.version,
      purpose: parsed.purpose,
      members: frozenMembers,
      requiredCapabilities,
      requiredConcurrency: parsed.requiredConcurrency,
      concurrencyCapacity,
      toolPolicy,
      memoryPolicy,
      inputSchema,
      outputSchemas,
    })
    this.teamVersions.set(teamVersion.id, teamVersion)
    return teamVersion
  }

  /**
   * Freeze one currently valid team version and complete member snapshots for a project.
   * @param projectId - Future Cup project starting execution.
   * @param teamVersionId - immutable team version selected at project start.
   * @returns the frozen project binding.
   */
  freezeTeamForProject(projectId: string, teamVersionId: string): ProjectTeamBinding {
    const parsedProjectId = parseInput(identifierSchema, projectId, 'project id')
    const parsedTeamVersionId = parseInput(identifierSchema, teamVersionId, 'team version id')
    const brandedProjectId = ProjectId(parsedProjectId)
    const brandedTeamVersionId = AgentTeamVersionId(parsedTeamVersionId)
    const existing = this.projectBindings.get(brandedProjectId)
    if (existing !== undefined) {
      if (existing.teamVersion.id === brandedTeamVersionId) return existing
      throw new AgentRegistryError(
        `Project "${brandedProjectId}" is already bound to team version "${existing.teamVersion.id}"`,
        'PROJECT_ALREADY_BOUND',
      )
    }
    const teamVersion = this.teamVersions.get(brandedTeamVersionId)
    if (teamVersion === undefined) {
      throw new AgentRegistryError(
        `Agent team version "${brandedTeamVersionId}" is not registered`,
        'TEAM_VERSION_NOT_FOUND',
      )
    }
    this.assertTeamMembersPublished(teamVersion)
    const frozenTeamVersion = freezeAgentTeamVersion(teamVersion)
    const binding = Object.freeze({
      id: ProjectTeamBindingId(`${brandedProjectId}:${frozenTeamVersion.id}`),
      projectId: brandedProjectId,
      teamVersion: frozenTeamVersion,
      members: frozenTeamVersion.members,
    })
    this.projectBindings.set(brandedProjectId, binding)
    return binding
  }

  /**
   * Read one immutable team version.
   * @param teamVersionId - requested team version.
   * @returns the frozen team version.
   */
  getTeamVersion(teamVersionId: string): AgentTeamVersion {
    const id = AgentTeamVersionId(teamVersionId)
    const teamVersion = this.teamVersions.get(id)
    if (teamVersion === undefined) {
      throw new AgentRegistryError(
        `Agent team version "${id}" is not registered`,
        'TEAM_VERSION_NOT_FOUND',
      )
    }
    return teamVersion
  }

  /**
   * List every immutable team version in stable identity order.
   * @returns frozen team versions.
   */
  listTeamVersions(): readonly AgentTeamVersion[] {
    const teamVersions = [...this.teamVersions.values()]
      .sort((left, right) => compareStrings(left.id, right.id))
    return Object.freeze(teamVersions)
  }

  /**
   * Read one project's frozen team binding.
   * @param projectId - Future Cup project identity.
   * @returns the frozen project binding.
   */
  getProjectBinding(projectId: string): ProjectTeamBinding {
    const id = ProjectId(projectId)
    const binding = this.projectBindings.get(id)
    if (binding === undefined) {
      throw new AgentRegistryError(
        `Project "${id}" has no frozen team binding`,
        'TEAM_VERSION_NOT_FOUND',
      )
    }
    return binding
  }

  /**
   * List every frozen project team binding in stable project order.
   * @returns frozen project bindings.
   */
  listProjectBindings(): readonly ProjectTeamBinding[] {
    const bindings = [...this.projectBindings.values()]
      .sort((left, right) => compareStrings(left.projectId, right.projectId))
    return Object.freeze(bindings)
  }

  private requireDefinition(definitionId: string): AgentDefinition {
    const id = AgentDefinitionId(definitionId)
    const definition = this.definitions.get(id)
    if (definition === undefined) {
      throw new AgentRegistryError(
        `Agent definition "${id}" is not registered`,
        'DEFINITION_NOT_FOUND',
        id,
      )
    }
    return definition
  }

  private requireVersion(versionId: string): AgentVersion {
    const id = AgentVersionId(versionId)
    const version = this.versions.get(id)
    if (version === undefined) {
      throw new AgentRegistryError(
        `Agent version "${id}" is not registered`,
        'VERSION_NOT_FOUND',
        undefined,
        id,
      )
    }
    return version
  }

  private requireVersionStatus(versionId: AgentVersionId): AgentLifecycleStatus {
    const status = this.versionStatuses.get(versionId)
    if (status === undefined) {
      throw new AgentRegistryError(
        `Agent version "${versionId}" has no lifecycle state`,
        'VERSION_NOT_FOUND',
        undefined,
        versionId,
      )
    }
    return status
  }

  private resolveVersion(definition: AgentDefinition, versionId?: string): AgentVersion {
    if (versionId !== undefined) {
      const version = this.requireVersion(versionId)
      if (version.definitionId !== definition.id) {
        throw new AgentRegistryError(
          `Agent version "${version.id}" does not belong to definition "${definition.id}"`,
          'VERSION_NOT_FOUND',
          definition.id,
          version.id,
        )
      }
      return version
    }
    const versions = [...(this.versionsByDefinition.get(definition.id)?.values() ?? [])]
    if (versions.length !== 1) {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" requires an explicit version id`,
        'VERSION_REQUIRED',
        definition.id,
      )
    }
    const onlyVersion = versions[0]
    if (onlyVersion === undefined) {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" has no versions`,
        'VERSION_REQUIRED',
        definition.id,
      )
    }
    return onlyVersion
  }

  private assertDefinitionMutable(definition: AgentDefinition): void {
    if (definition.status === 'PUBLISHED' || definition.status === 'DEPRECATED') {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" is immutable in ${definition.status}`,
        'DEFINITION_IMMUTABLE',
        definition.id,
      )
    }
  }

  private assertDefinitionAcceptsVersions(definition: AgentDefinition): void {
    if (definition.status === 'DEPRECATED') {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" is immutable in DEPRECATED`,
        'DEFINITION_IMMUTABLE',
        definition.id,
      )
    }
  }

  private assertTransition(
    definition: AgentDefinition,
    target: AgentLifecycleStatus,
  ): void {
    if (!ALLOWED_TRANSITIONS[definition.status].includes(target)) {
      throw new AgentRegistryError(
        `Agent definition "${definition.id}" cannot transition from ${definition.status} to ${target}`,
        'INVALID_TRANSITION',
        definition.id,
        undefined,
        definition.status,
        target,
      )
    }
  }

  private transition(
    definition: AgentDefinition,
    target: AgentLifecycleStatus,
  ): AgentDefinition {
    this.assertTransition(definition, target)
    const updated = freezeAgentDefinition({ ...definition, status: target })
    this.definitions.set(updated.id, updated)
    return updated
  }

  private assertVersionTransition(
    version: AgentVersion,
    target: AgentLifecycleStatus,
  ): void {
    const current = this.requireVersionStatus(version.id)
    if (!ALLOWED_TRANSITIONS[current].includes(target)) {
      throw new AgentRegistryError(
        `Agent version "${version.id}" cannot transition from ${current} to ${target}`,
        'INVALID_TRANSITION',
        version.definitionId,
        version.id,
        current,
        target,
      )
    }
  }

  private validateVersionSemantics(version: AgentVersion): void {
    if (!Object.values(version.capabilities).some(weight => weight > 0)) {
      throw new AgentRegistryError(
        `Agent version "${version.id}" must declare at least one positive capability`,
        'VERSION_VALIDATION_FAILED',
        version.definitionId,
        version.id,
      )
    }
    if (!schemaDeclaresObject(version.inputSchema.schema)) {
      throw new AgentRegistryError(
        `Agent version "${version.id}" input schema must declare an object`,
        'VERSION_VALIDATION_FAILED',
        version.definitionId,
        version.id,
      )
    }
    if (!schemaDeclaresObject(version.outputSchema.schema)) {
      throw new AgentRegistryError(
        `Agent version "${version.id}" output schema must declare an object`,
        'VERSION_VALIDATION_FAILED',
        version.definitionId,
        version.id,
      )
    }
  }

  private validateTeamCapabilities(
    members: readonly AgentTeamMemberSnapshot[],
    requiredCapabilities: Readonly<Record<string, number>>,
  ): void {
    const missing = Object.entries(requiredCapabilities).filter(([capability, required]) => {
      const capacity = members.reduce((total, member) => (
        total + (member.version.capabilities[capability] ?? 0) * member.instanceCount
      ), 0)
      return capacity < required
    }).map(([capability]) => capability)
    if (missing.length > 0) {
      throw new AgentRegistryError(
        `Team does not cover required capabilities: ${missing.join(', ')}`,
        'CAPABILITY_NOT_COVERED',
      )
    }
  }

  private validateTeamConcurrency(
    members: readonly AgentTeamMemberSnapshot[],
    requiredConcurrency: number,
  ): number {
    const capacity = members.reduce((total, member) => (
      total + member.version.maxConcurrency * member.instanceCount
    ), 0)
    if (capacity < requiredConcurrency) {
      throw new AgentRegistryError(
        `Team concurrency capacity ${capacity} is below required ${requiredConcurrency}`,
        'CONCURRENCY_INSUFFICIENT',
      )
    }
    return capacity
  }

  private validateTeamTools(
    members: readonly AgentTeamMemberSnapshot[],
    policy: TeamToolPolicy,
  ): void {
    const allowed = new Set(policy.allowedTools)
    const disallowed = members.flatMap(member => (
      member.version.toolAllowlist.filter(tool => !allowed.has(tool))
    ))
    if (disallowed.length > 0) {
      throw new AgentRegistryError(
        `Team members exceed the tool ceiling: ${orderedUniqueStrings(disallowed).join(', ')}`,
        'TOOL_POLICY_INVALID',
      )
    }
    const provided = new Set(members.flatMap(member => member.version.toolAllowlist))
    const missing = policy.requiredTools.filter(tool => !provided.has(tool))
    if (missing.length > 0) {
      throw new AgentRegistryError(
        `Team does not provide required tools: ${missing.join(', ')}`,
        'TOOL_POLICY_INVALID',
      )
    }
  }

  private validateTeamMemory(
    members: readonly AgentTeamMemberSnapshot[],
    policy: TeamMemoryPolicy,
  ): void {
    const allowedKinds = new Set(policy.allowedKinds)
    for (const member of members) {
      if (!memoryCovers(policy.allowedAccess, member.version.memoryPolicy.access)) {
        throw new AgentRegistryError(
          `Agent version "${member.version.id}" memory access ${member.version.memoryPolicy.access} exceeds team ceiling ${policy.allowedAccess}`,
          'MEMORY_POLICY_INVALID',
          member.definition.id,
          member.version.id,
        )
      }
      const disallowedKinds = member.version.memoryPolicy.kinds.filter(kind => !allowedKinds.has(kind))
      if (disallowedKinds.length > 0) {
        throw new AgentRegistryError(
          `Agent version "${member.version.id}" uses disallowed memory kinds: ${disallowedKinds.join(', ')}`,
          'MEMORY_POLICY_INVALID',
          member.definition.id,
          member.version.id,
        )
      }
    }
    const providers = members.filter(member => (
      memoryCovers(member.version.memoryPolicy.access, policy.requiredAccess)
    ))
    if (policy.requiredAccess !== 'NONE' && providers.length === 0) {
      throw new AgentRegistryError(
        `Team does not provide required memory access ${policy.requiredAccess}`,
        'MEMORY_POLICY_INVALID',
      )
    }
    const providedKinds = new Set(providers.flatMap(member => member.version.memoryPolicy.kinds))
    const missingKinds = policy.requiredKinds.filter(kind => !providedKinds.has(kind))
    if (missingKinds.length > 0) {
      throw new AgentRegistryError(
        `Team does not provide required memory kinds: ${missingKinds.join(', ')}`,
        'MEMORY_POLICY_INVALID',
      )
    }
  }

  private validateTeamOutputs(
    members: readonly AgentTeamMemberSnapshot[],
    inputSchema: JsonSchemaDescriptor,
    requiredOutputSchemas: readonly JsonSchemaDescriptor[],
  ): void {
    if (!schemaDeclaresObject(inputSchema.schema)) {
      throw new AgentRegistryError(
        'Team input schema must declare an object',
        'OUTPUT_CONTRACT_INVALID',
      )
    }
    for (const requiredSchema of requiredOutputSchemas) {
      if (!schemaDeclaresObject(requiredSchema.schema)) {
        throw new AgentRegistryError(
          `Required team output schema "${requiredSchema.id}" must declare an object`,
          'OUTPUT_CONTRACT_INVALID',
        )
      }
      if (!members.some(member => descriptorsEqual(member.version.outputSchema, requiredSchema))) {
        throw new AgentRegistryError(
          `No team member produces required output schema "${requiredSchema.id}@${requiredSchema.version}"`,
          'OUTPUT_CONTRACT_INVALID',
        )
      }
    }
  }

  private assertTeamMembersPublished(teamVersion: AgentTeamVersion): void {
    for (const member of teamVersion.members) {
      const definition = this.definitions.get(member.definition.id)
      const version = this.versions.get(member.version.id)
      if (
        definition?.status !== 'PUBLISHED'
        || version === undefined
        || this.requireVersionStatus(member.version.id) !== 'PUBLISHED'
      ) {
        throw new AgentRegistryError(
          `Agent version "${member.version.id}" is no longer publishable for project freezing`,
          'VERSION_NOT_PUBLISHED',
          member.definition.id,
          member.version.id,
        )
      }
    }
  }
}
