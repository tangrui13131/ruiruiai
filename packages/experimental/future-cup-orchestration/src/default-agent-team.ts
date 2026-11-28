/** Controlled seed registry for the real Future Cup delivery team. */

import { z } from 'zod'
import {
  AgentRegistry,
  AGENT_REGISTRY_ROLES,
  JSON_SCHEMA_DIALECT,
  type AgentMemoryPolicy,
  type AgentRegistryRole,
  type AgentTeamVersion,
  type CreateAgentTeamVersionInput,
  type JsonSchemaDescriptor,
  type RegisterAgentVersionInput,
} from './agent-registry.ts'
import {
  FRONTEND_INSTRUCTIONS,
  INTEGRATION_INSTRUCTIONS,
  PLANNER_INSTRUCTIONS,
  REPAIR_INSTRUCTIONS,
  TESTER_INSTRUCTIONS,
  UI_DESIGNER_INSTRUCTIONS,
} from './prompts.ts'
import {
  frontendOutputSchema,
  integrationOutputSchema,
  jsonValueSchema,
  plannerOutputSchema,
  repairOutputSchema,
  testerOutputSchema,
  uiDesignerOutputSchema,
} from './schemas.ts'

/** Stable identity of the default published team. */
export const DEFAULT_AGENT_TEAM_ID = 'future-cup-default-team-2.0.0'

/** Stable identity of the revised default team used for new projects. */
export const DEFAULT_AGENT_TEAM_REVISION_ID = 'future-cup-default-team-2.0.1'

/** Stable identity of the legacy published team retained as a selectable default. */
export const LEGACY_AGENT_TEAM_ID = 'future-cup-default-team-1.0.0'

/** Display name of the legacy team; Team names are unique per owner. */
const LEGACY_AGENT_TEAM_NAME = 'future-cup-default-team-1.0.0'

/** Logical parent of both 2.0 team versions. */
const DEFAULT_AGENT_TEAM_TEAM_ID = 'team:future-cup-default-team'

const VERSION = '1.0.0'
const TEAM_VERSION = '2.0.0'
const TEAM_REVISION_VERSION = '2.0.1'
const LEGACY_TEAM_VERSION = '1.0.0'
const MODEL = 'deepseek-flash'
const commonInputSchema = descriptor(
  'future-cup.agent-task-input',
  z.object({
    requirement: z.string().min(1),
    task: z.record(z.string(), z.unknown()),
    priorArtifacts: z.array(z.record(z.string(), z.unknown())).optional(),
  }),
)
const verifierOutputSchema = z.object({
  status: z.enum(['PASS', 'FAIL', 'INCOMPLETE']),
  summary: z.string().min(1),
  failureSignature: z.string().min(1).optional(),
})

const OUTPUT_SCHEMAS = {
  planner: descriptor('future-cup.planner-output', plannerOutputSchema),
  'ui-designer': descriptor('future-cup.ui-designer-output', uiDesignerOutputSchema),
  tester: descriptor('future-cup.tester-output', testerOutputSchema),
  frontend: descriptor('future-cup.frontend-output', frontendOutputSchema),
  integration: descriptor('future-cup.integration-output', integrationOutputSchema),
  verifier: descriptor('future-cup.verifier-output', verifierOutputSchema),
  repair: descriptor('future-cup.repair-output', repairOutputSchema),
} as const satisfies Readonly<Record<AgentRegistryRole, JsonSchemaDescriptor>>

const PROMPTS = {
  planner: PLANNER_INSTRUCTIONS,
  'ui-designer': UI_DESIGNER_INSTRUCTIONS,
  tester: TESTER_INSTRUCTIONS,
  frontend: FRONTEND_INSTRUCTIONS,
  integration: INTEGRATION_INSTRUCTIONS,
  verifier: [
    'Independently inspect the supplied verification evidence.',
    'Never claim PASS when required deterministic or browser evidence is missing.',
    'Return one structured verification verdict.',
  ].join('\n'),
  repair: REPAIR_INSTRUCTIONS,
} as const satisfies Readonly<Record<AgentRegistryRole, string>>

const MEMORY = {
  planner: memory('READ', ['requirement', 'design-decision']),
  'ui-designer': memory('READ', ['requirement', 'design-decision']),
  tester: memory('READ', ['requirement', 'design-decision']),
  frontend: memory('READ', ['design-decision', 'accepted-artifact-summary']),
  integration: memory('READ', ['design-decision', 'accepted-artifact-summary']),
  verifier: memory('READ', ['requirement', 'failure-signature']),
  repair: memory('WRITE', ['failure-signature', 'accepted-artifact-summary']),
} as const satisfies Readonly<Record<AgentRegistryRole, AgentMemoryPolicy>>

const DEFINITIONS = {
  planner: metadata('planner', 'Planner', 'Analyze requirements and produce the executable task DAG.'),
  'ui-designer': metadata('ui-designer', 'UI Designer', 'Define the shared visual and responsive design system.'),
  tester: metadata('tester', 'Tester', 'Produce deterministic browser acceptance assertions.'),
  frontend: metadata('frontend', 'Frontend Agent', 'Implement bounded React pages within declared write scopes.'),
  integration: metadata('integration', 'Integration Agent', 'Integrate routes, shared components, and page contracts.'),
  verifier: metadata('verifier', 'Verifier', 'Evaluate independent build and browser evidence without weakening thresholds.'),
  repair: metadata('repair', 'Repair Agent', 'Diagnose structured failures and produce bounded source repairs.'),
} as const satisfies Readonly<Record<AgentRegistryRole, {
  readonly id: string
  readonly name: string
  readonly purpose: string
  readonly discoveryTags: readonly string[]
}>>

/** Built-in system Agent definition identities protected from deletion. */
export const BUILTIN_AGENT_DEFINITION_IDS: ReadonlySet<string> = new Set(
  Object.values(DEFINITIONS).map(definition => definition.id),
)

/** Role-aligned template used when creating or customizing an Agent version. */
export interface AgentRoleTemplate {
  /** Controlled Agent role. */
  readonly role: AgentRegistryRole
  /** Default human-readable role title. */
  readonly defaultName: string
  /** Default plain-language responsibility. */
  readonly defaultPurpose: string
  /** Default discovery tags. */
  readonly defaultTags: readonly string[]
  /** Default model route. */
  readonly defaultModel: string
  /** Default system prompt instructions. */
  readonly defaultPrompt: string
  /** Default prompt version identifier. */
  readonly defaultPromptVersion: string
  /** Default capability weights. */
  readonly defaultCapabilities: Readonly<Record<string, number>>
  /** Default tool allowlist. */
  readonly defaultToolAllowlist: readonly string[]
  /** Default project-memory permissions. */
  readonly defaultMemoryPolicy: AgentMemoryPolicy
  /** Default max concurrent runs per instance. */
  readonly defaultMaxConcurrency: number
  /** Canonical input JSON Schema descriptor for this role. */
  readonly inputSchema: JsonSchemaDescriptor
  /** Canonical output JSON Schema descriptor for this role. */
  readonly outputSchema: JsonSchemaDescriptor
}

/**
 * Return the canonical role template for a controlled Agent role.
 * @param role - controlled Agent role.
 * @returns role defaults and canonical input/output schemas.
 */
export function getAgentRoleTemplate(role: AgentRegistryRole): AgentRoleTemplate {
  const definition = DEFINITIONS[role]
  return {
    role,
    defaultName: definition.name,
    defaultPurpose: definition.purpose,
    defaultTags: definition.discoveryTags,
    defaultModel: MODEL,
    defaultPrompt: PROMPTS[role],
    defaultPromptVersion: 'm5.1-v1',
    defaultCapabilities: { [capability(role)]: 1 },
    defaultToolAllowlist: ['fs-read'],
    defaultMemoryPolicy: MEMORY[role],
    defaultMaxConcurrency: 1,
    inputSchema: commonInputSchema,
    outputSchema: OUTPUT_SCHEMAS[role],
  }
}

/**
 * List canonical role templates for all controlled Future Cup Agent roles.
 * @returns frozen role templates in controlled role order.
 */
export function listAgentRoleTemplates(): readonly AgentRoleTemplate[] {
  return Object.freeze(AGENT_REGISTRY_ROLES.map(role => getAgentRoleTemplate(role)))
}

/**
 * Create or repair the fixed seven-definition team in a registry.
 * @param registry - empty or partially seeded registry.
 * @returns the published default team version.
 */
export function createDefaultAgentTeam(registry: AgentRegistry): AgentTeamVersion {
  const existing = registry.listTeamVersions().find(team => team.id === DEFAULT_AGENT_TEAM_ID)
  if (existing !== undefined) return existing
  const versions = ensureAgentVersions(registry)
  return registry.createTeamVersion(teamInput(versions, {
    id: DEFAULT_AGENT_TEAM_ID,
    name: 'future-cup-default-team',
    version: TEAM_VERSION,
    testerInstances: 1,
    frontendInstances: 2,
    includeVerifier: false,
  }))
}

/**
 * Create or repair the 2.0.1 revision used by new projects.
 *
 * The revision keeps the 2.0 verifier-out design but adds a second tester so
 * the team has eight runtime members, matching the legacy 1.0.0 headcount.
 * @param registry - empty or partially seeded registry.
 * @returns the published 2.0.1 team version.
 */
export function createDefaultTeamRevision(registry: AgentRegistry): AgentTeamVersion {
  const existing = registry.listTeamVersions().find(team => team.id === DEFAULT_AGENT_TEAM_REVISION_ID)
  if (existing !== undefined) return existing
  const versions = ensureAgentVersions(registry)
  return registry.createTeamVersion(teamInput(versions, {
    id: DEFAULT_AGENT_TEAM_REVISION_ID,
    teamId: DEFAULT_AGENT_TEAM_TEAM_ID,
    name: 'future-cup-default-team',
    version: TEAM_REVISION_VERSION,
    testerInstances: 2,
    frontendInstances: 2,
    includeVerifier: false,
  }))
}

/**
 * Create or repair the legacy eight-member default team.
 *
 * Version 1.0.0 kept the verifier in the team membership, capability set, and
 * required outputs. Version 2.0.0 removed the verifier from the team while
 * keeping the Agent definition available for standalone verification.
 * @param registry - empty or partially seeded registry.
 * @returns the published legacy team version.
 */
export function createLegacyAgentTeam(registry: AgentRegistry): AgentTeamVersion {
  const existing = registry.listTeamVersions().find(team => team.id === LEGACY_AGENT_TEAM_ID)
  if (existing !== undefined) return existing
  const versions = ensureAgentVersions(registry)
  return registry.createTeamVersion(teamInput(versions, {
    id: LEGACY_AGENT_TEAM_ID,
    name: LEGACY_AGENT_TEAM_NAME,
    version: LEGACY_TEAM_VERSION,
    testerInstances: 1,
    frontendInstances: 2,
    includeVerifier: true,
  }))
}

function ensureAgentVersions(registry: AgentRegistry): Map<AgentRegistryRole, string> {
  const versions = new Map<AgentRegistryRole, string>()
  for (const role of Object.keys(DEFINITIONS) as AgentRegistryRole[]) {
    const metadata = DEFINITIONS[role]
    const definition = registry.listDefinitions().find(value => value.id === metadata.id)
      ?? registry.registerDefinition(metadata)
    const expectedVersionId = `${role}-${VERSION}`
    const version = registry.listVersions(definition.id)
      .find(value => value.id === expectedVersionId)
      ?? registry.registerVersion(definition.id, versionInput(role))
    const status = registry.getVersionStatus(version.id)
    if (status === 'DRAFT') registry.validate(definition.id, version.id)
    if (status === 'DRAFT' || status === 'VALIDATED') {
      registry.publish(definition.id, version.id)
    }
    if (registry.getVersionStatus(version.id) === 'DEPRECATED') {
      throw new Error(`default Agent version "${version.id}" is deprecated`)
    }
    versions.set(role, version.id)
  }
  return versions
}

function versionInput(role: AgentRegistryRole): RegisterAgentVersionInput {
  return {
    id: `${role}-${VERSION}`,
    version: VERSION,
    role,
    model: MODEL,
    prompt: PROMPTS[role],
    promptVersion: 'm5.1-v1',
    capabilities: { [capability(role)]: 1 },
    toolAllowlist: ['fs-read'],
    memoryPolicy: MEMORY[role],
    maxConcurrency: 1,
    inputSchema: commonInputSchema,
    outputSchema: OUTPUT_SCHEMAS[role],
  }
}

interface TeamVariant {
  /** Team version identity. */
  readonly id: string
  /** Optional logical Team parent; omitted when derived from the name. */
  readonly teamId?: string
  /** Human-readable team template name, unique per owner. */
  readonly name: string
  /** Caller-owned semantic team version. */
  readonly version: string
  /** Tester runtime instances; the second tester raises 2.0.1 to eight members. */
  readonly testerInstances: 1 | 2
  /** Frontend runtime instances; the registry caps a team at eight members. */
  readonly frontendInstances: 1 | 2
  /** Whether the verifier participates as a runtime team member. */
  readonly includeVerifier: boolean
}

function teamInput(
  versions: ReadonlyMap<AgentRegistryRole, string>,
  variant: TeamVariant,
): CreateAgentTeamVersionInput {
  return {
    id: variant.id,
    ...(variant.teamId === undefined ? {} : { teamId: variant.teamId }),
    name: variant.name,
    version: variant.version,
    purpose: 'Deliver a verified React frontend project with controlled specialist Agents.',
    members: [...versions.entries()]
      .filter(([role]) => variant.includeVerifier || role !== 'verifier')
      .map(([role, agentVersionId]) => ({
        agentVersionId,
        instanceCount: role === 'frontend'
          ? variant.frontendInstances
          : role === 'tester' ? variant.testerInstances : 1,
      })),
    requiredCapabilities: {
      planning: 1,
      design: 1,
      testing: variant.testerInstances,
      frontend: 1,
      integration: 1,
      ...(variant.includeVerifier ? { verification: 1 } : {}),
      repair: 1,
    },
    requiredConcurrency: 5,
    toolPolicy: {
      allowedTools: ['fs-read'],
      requiredTools: ['fs-read'],
    },
    memoryPolicy: {
      allowedAccess: 'WRITE',
      requiredAccess: 'READ',
      allowedKinds: [
        'requirement',
        'design-decision',
        'failure-signature',
        'accepted-artifact-summary',
      ],
      requiredKinds: ['requirement', 'design-decision', 'failure-signature'],
    },
    inputSchema: commonInputSchema,
    requiredOutputSchemas: variant.includeVerifier
      ? Object.values(OUTPUT_SCHEMAS)
      : Object.entries(OUTPUT_SCHEMAS)
        .filter(([role]) => role !== 'verifier')
        .map(([, schema]) => schema),
  }
}

function capability(role: AgentRegistryRole): string {
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

function descriptor<T>(id: string, schema: z.ZodType<T>): JsonSchemaDescriptor {
  return {
    id,
    version: VERSION,
    dialect: JSON_SCHEMA_DIALECT,
    schema: jsonValueSchema.parse(z.toJSONSchema(schema, { io: 'output' })),
  }
}

function memory(
  access: AgentMemoryPolicy['access'],
  kinds: AgentMemoryPolicy['kinds'],
): AgentMemoryPolicy {
  return { access, kinds }
}

function metadata(
  id: string,
  name: string,
  purpose: string,
) {
  return {
    id,
    name,
    purpose,
    discoveryTags: [id === 'ui-designer' ? 'design' : id],
  }
}
