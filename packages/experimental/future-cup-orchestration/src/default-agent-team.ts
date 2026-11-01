/** Controlled seed registry for the real Future Cup delivery team. */

import { z } from 'zod'
import {
  AgentRegistry,
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
export const DEFAULT_AGENT_TEAM_ID = 'future-cup-default-team-1.0.0'

const VERSION = '1.0.0'
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

/**
 * Create or repair the fixed seven-definition team in a registry.
 * @param registry - empty or partially seeded registry.
 * @returns the published default team version.
 */
export function createDefaultAgentTeam(registry: AgentRegistry): AgentTeamVersion {
  const existing = registry.listTeamVersions().find(team => team.id === DEFAULT_AGENT_TEAM_ID)
  if (existing !== undefined) return existing

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

  return registry.createTeamVersion(teamInput(versions))
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

function teamInput(versions: ReadonlyMap<AgentRegistryRole, string>): CreateAgentTeamVersionInput {
  return {
    id: DEFAULT_AGENT_TEAM_ID,
    name: 'future-cup-default-team',
    version: VERSION,
    purpose: 'Deliver a verified React frontend project with controlled specialist Agents.',
    members: [...versions.entries()].map(([role, agentVersionId]) => ({
      agentVersionId,
      instanceCount: role === 'frontend' ? 2 : 1,
    })),
    requiredCapabilities: {
      planning: 1,
      design: 1,
      testing: 1,
      frontend: 1,
      integration: 1,
      verification: 1,
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
    requiredOutputSchemas: Object.values(OUTPUT_SCHEMAS),
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
