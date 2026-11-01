import { describe, expect, it } from 'vitest'
import {
  AgentRegistry,
  AgentRegistryError,
  JSON_SCHEMA_DIALECT,
  type AgentMemoryPolicy,
  type AgentRegistryRole,
  type CreateAgentTeamVersionInput,
  type JsonSchemaDescriptor,
  type RegisterAgentVersionInput,
  type TeamMemoryPolicy,
  type TeamToolPolicy,
} from '../src/agent-registry.ts'

const NO_MEMORY = {
  access: 'NONE',
  kinds: [],
} as const satisfies AgentMemoryPolicy

const TEAM_MEMORY_NONE = {
  allowedAccess: 'NONE',
  requiredAccess: 'NONE',
  allowedKinds: [],
  requiredKinds: [],
} as const satisfies TeamMemoryPolicy

const TEAM_TOOLS = {
  allowedTools: ['fs-read'],
  requiredTools: [],
} as const satisfies TeamToolPolicy

const INPUT_SCHEMA = {
  id: 'future-cup.task-input',
  version: '1.0.0',
  dialect: JSON_SCHEMA_DIALECT,
  schema: {
    type: 'object',
    additionalProperties: true,
  },
} as const satisfies JsonSchemaDescriptor

function outputSchema(role: AgentRegistryRole): JsonSchemaDescriptor {
  return {
    id: `future-cup.${role}-output`,
    version: '1.0.0',
    dialect: JSON_SCHEMA_DIALECT,
    schema: {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: { type: 'string' },
      },
    },
  }
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

function versionInput(
  role: AgentRegistryRole,
  overrides: Partial<RegisterAgentVersionInput> = {},
): RegisterAgentVersionInput {
  return {
    version: '1.0.0',
    role,
    model: 'deepseek-flash',
    prompt: `Handle ${role} work.`,
    promptVersion: 'prompt-v1',
    capabilities: { [capabilityForRole(role)]: 1 },
    toolAllowlist: ['fs-read'],
    memoryPolicy: NO_MEMORY,
    maxConcurrency: 1,
    inputSchema: INPUT_SCHEMA,
    outputSchema: outputSchema(role),
    ...overrides,
  }
}

function registerPublished(
  registry: AgentRegistry,
  id: string,
  role: AgentRegistryRole,
  overrides: Partial<RegisterAgentVersionInput> = {},
) {
  const definition = registry.registerDefinition({
    id,
    name: `${role} agent`,
    purpose: `Own ${role} work.`,
    discoveryTags: [capabilityForRole(role)],
  })
  const version = registry.registerVersion(definition.id, versionInput(role, overrides))
  registry.validate(definition.id, version.id)
  const published = registry.publish(definition.id, version.id)
  return { definition: published, version }
}

function teamInput(
  members: readonly string[],
  overrides: Partial<CreateAgentTeamVersionInput> = {},
): CreateAgentTeamVersionInput {
  return {
    name: 'future-cup-delivery-team',
    version: '1.0.0',
    purpose: 'Deliver a verified frontend project.',
    members: members.map(agentVersionId => ({ agentVersionId, instanceCount: 1 })),
    requiredCapabilities: {},
    requiredConcurrency: 1,
    toolPolicy: TEAM_TOOLS,
    memoryPolicy: TEAM_MEMORY_NONE,
    inputSchema: INPUT_SCHEMA,
    requiredOutputSchemas: [],
    ...overrides,
  }
}

function expectRegistryError(action: () => void, code: AgentRegistryError['code']): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(AgentRegistryError)
    if (!(error instanceof AgentRegistryError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected AgentRegistryError with code ${code}`)
}

describe('AgentRegistry', () => {
  it('registers immutable versions and freezes a published definition', () => {
    const registry = new AgentRegistry()
    const definition = registry.registerDefinition({
      id: 'planner',
      name: 'Planner',
      purpose: 'Plan frontend delivery.',
      discoveryTags: ['planning'],
    })
    const version = registry.registerVersion(
      definition.id,
      versionInput('planner', {
        capabilities: { planning: 0.8 },
      }),
    )
    registry.validate(definition.id, version.id)
    const published = registry.publish(definition.id, version.id)

    expect(published.status).toBe('PUBLISHED')
    expect(Object.isFrozen(published)).toBe(true)
    expect(Object.isFrozen(version)).toBe(true)
    expect(Object.isFrozen(version.capabilities)).toBe(true)
    expect(Object.isFrozen(version.toolAllowlist)).toBe(true)
    expect(Object.isFrozen(version.inputSchema.schema)).toBe(true)
    expect(Reflect.set(version, 'prompt', 'mutated')).toBe(false)
    expect(Reflect.set(version.capabilities, 'planning', 0)).toBe(false)
    expectRegistryError(
      () => registry.updateDefinition(definition.id, { name: 'Mutated planner' }),
      'DEFINITION_IMMUTABLE',
    )
  })

  it('registers and publishes later immutable versions after the first publication', () => {
    const registry = new AgentRegistry()
    const first = registerPublished(registry, 'planner', 'planner', {
      prompt: 'Plan with the first prompt.',
    })
    const second = registry.registerVersion(
      first.definition.id,
      versionInput('planner', {
        version: '1.1.0',
        promptVersion: 'prompt-v2',
        prompt: 'Plan with the second prompt.',
      }),
    )

    expect(first.definition.status).toBe('PUBLISHED')
    expect(registry.getDefinition(first.definition.id).status).toBe('PUBLISHED')
    expect(registry.getVersionStatus(second.id)).toBe('DRAFT')
    expectRegistryError(
      () => registry.publish(first.definition.id, second.id),
      'VERSION_NOT_VALIDATED',
    )

    const validated = registry.validate(first.definition.id, second.id)
    expect(validated.status).toBe('PUBLISHED')
    expect(registry.getVersionStatus(second.id)).toBe('VALIDATED')

    const published = registry.publish(first.definition.id, second.id)
    expect(published.status).toBe('PUBLISHED')
    expect(registry.getVersionStatus(first.version.id)).toBe('PUBLISHED')
    expect(registry.getVersionStatus(second.id)).toBe('PUBLISHED')
    expect(registry.listVersions(first.definition.id).map(version => version.id)).toEqual([
      first.version.id,
      second.id,
    ])
    expect(first.version.prompt).toBe('Plan with the first prompt.')
    expect(Object.isFrozen(first.version)).toBe(true)
    expect(registry.findPublishedVersionsByCapability('planning').map(version => version.id))
      .toEqual([first.version.id, second.id])
    const team = registry.createTeamVersion(teamInput([first.version.id], {
      requiredCapabilities: { planning: 1 },
      requiredOutputSchemas: [outputSchema('planner')],
    }))
    expect(team.members[0]?.version.id).toBe(first.version.id)
  })

  it('rejects illegal lifecycle transitions', () => {
    const registry = new AgentRegistry()
    const definition = registry.registerDefinition({
      id: 'frontend',
      name: 'Frontend',
      purpose: 'Build frontend features.',
      discoveryTags: ['frontend'],
    })
    const version = registry.registerVersion(definition.id, versionInput('frontend'))

    expectRegistryError(
      () => registry.publish(definition.id, version.id),
      'INVALID_TRANSITION',
    )
    registry.validate(definition.id, version.id)
    registry.publish(definition.id, version.id)
    expectRegistryError(
      () => registry.validate(definition.id, version.id),
      'INVALID_TRANSITION',
    )
    registry.deprecate(definition.id)
    expectRegistryError(
      () => registry.deprecate(definition.id),
      'INVALID_TRANSITION',
    )
  })

  it('discovers only published versions and removes deprecated versions', () => {
    const registry = new AgentRegistry()
    const planner = registerPublished(registry, 'planner', 'planner')
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const draft = registry.registerDefinition({
      id: 'tester',
      name: 'Tester',
      purpose: 'Test frontend behavior.',
      discoveryTags: ['testing'],
    })
    registry.registerVersion(draft.id, versionInput('tester'))

    expect(registry.findPublishedVersionsByCapability('frontend')).toEqual([frontend.version])
    expect(registry.discoverPublished({
      capabilities: { planning: 0.5 },
      tags: ['planning'],
    })).toMatchObject([{
      definition: { id: planner.definition.id },
      version: { id: planner.version.id },
    }])

    registry.deprecate(frontend.definition.id)
    expect(registry.findPublishedVersionsByCapability('frontend')).toEqual([])
    expect(registry.discoverPublished({ tags: ['frontend'] })).toEqual([])
  })

  it('creates a frozen team snapshot after validating all composition policies', () => {
    const registry = new AgentRegistry()
    const planner = registerPublished(registry, 'planner', 'planner')
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const team = registry.createTeamVersion(teamInput(
      [planner.version.id, frontend.version.id],
      {
        requiredCapabilities: { planning: 1, frontend: 1 },
        requiredConcurrency: 2,
        requiredOutputSchemas: [
          outputSchema('planner'),
          outputSchema('frontend'),
        ],
      },
    ))

    expect(team.concurrencyCapacity).toBe(2)
    expect(team.members.map(member => member.definition.name)).toEqual([
      'frontend agent',
      'planner agent',
    ])
    expect(Object.isFrozen(team)).toBe(true)
    expect(Object.isFrozen(team.members)).toBe(true)
    expect(Object.isFrozen(team.members[0]?.definition)).toBe(true)
  })

  it('fails a team whose member capabilities do not cover requirements', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend', {
      capabilities: { frontend: 0.5 },
    })

    expectRegistryError(
      () => registry.createTeamVersion(teamInput([frontend.version.id], {
        requiredCapabilities: { frontend: 1 },
        requiredOutputSchemas: [outputSchema('frontend')],
      })),
      'CAPABILITY_NOT_COVERED',
    )
  })

  it('fails teams that exceed aggregate concurrency capacity', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend')

    expectRegistryError(
      () => registry.createTeamVersion(teamInput([frontend.version.id], {
        requiredCapabilities: { frontend: 1 },
        requiredConcurrency: 2,
        requiredOutputSchemas: [outputSchema('frontend')],
      })),
      'CONCURRENCY_INSUFFICIENT',
    )
  })

  it('rejects tools outside the team policy and uncovered required tools', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend', {
      toolAllowlist: ['fs-read', 'shell'],
    })

    expectRegistryError(
      () => registry.createTeamVersion(teamInput([frontend.version.id], {
        requiredCapabilities: { frontend: 1 },
        requiredOutputSchemas: [outputSchema('frontend')],
      })),
      'TOOL_POLICY_INVALID',
    )
  })

  it('rejects member memory access outside the team policy', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend', {
      memoryPolicy: {
        access: 'WRITE',
        kinds: ['failure-signature'],
      },
    })
    const readOnlyTeamMemory = {
      allowedAccess: 'READ',
      requiredAccess: 'NONE',
      allowedKinds: ['failure-signature'],
      requiredKinds: [],
    } as const satisfies TeamMemoryPolicy

    expectRegistryError(
      () => registry.createTeamVersion(teamInput([frontend.version.id], {
        requiredCapabilities: { frontend: 1 },
        memoryPolicy: readOnlyTeamMemory,
        requiredOutputSchemas: [outputSchema('frontend')],
      })),
      'MEMORY_POLICY_INVALID',
    )
  })

  it('rejects teams whose required output schema is not produced by a member', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const wrongOutput = {
      ...outputSchema('frontend'),
      id: 'future-cup.unexpected-output',
    } satisfies JsonSchemaDescriptor

    expectRegistryError(
      () => registry.createTeamVersion(teamInput([frontend.version.id], {
        requiredCapabilities: { frontend: 1 },
        requiredOutputSchemas: [wrongOutput],
      })),
      'OUTPUT_CONTRACT_INVALID',
    )
  })

  it('freezes project member definitions without tracking later team versions or deprecation', () => {
    const registry = new AgentRegistry()
    const firstPlanner = registerPublished(registry, 'planner-v1', 'planner', {
      prompt: 'Plan using the first template.',
      outputSchema: outputSchema('planner'),
    })
    const firstTeam = registry.createTeamVersion(teamInput([firstPlanner.version.id], {
      name: 'delivery-template',
      version: '1.0.0',
      requiredCapabilities: { planning: 1 },
      requiredOutputSchemas: [outputSchema('planner')],
    }))
    const binding = registry.freezeTeamForProject('project-1', firstTeam.id)

    const secondPlanner = registerPublished(registry, 'planner-v2', 'planner', {
      version: '2.0.0',
      prompt: 'Plan using the second template.',
      outputSchema: outputSchema('planner'),
    })
    const secondTeam = registry.createTeamVersion(teamInput([secondPlanner.version.id], {
      name: 'delivery-template',
      version: '2.0.0',
      requiredCapabilities: { planning: 1 },
      requiredOutputSchemas: [outputSchema('planner')],
    }))
    registry.deprecate(firstPlanner.definition.id)

    expect(secondTeam.id).not.toBe(firstTeam.id)
    expect(binding.teamVersion.id).toBe(firstTeam.id)
    expect(binding.members).toHaveLength(1)
    expect(binding.members[0]?.version.prompt).toBe('Plan using the first template.')
    expect(binding.members[0]?.definition.status).toBe('PUBLISHED')
    expect(registry.getVersionStatus(firstPlanner.version.id)).toBe('DEPRECATED')
    expect(registry.getProjectBinding('project-1')).toBe(binding)
    expectRegistryError(
      () => registry.createTeamVersion(teamInput([firstPlanner.version.id], {
        version: '3.0.0',
        requiredCapabilities: { planning: 1 },
        requiredOutputSchemas: [outputSchema('planner')],
      })),
      'VERSION_NOT_PUBLISHED',
    )
  })
})
