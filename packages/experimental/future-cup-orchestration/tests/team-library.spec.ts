import { describe, expect, it } from 'vitest'
import {
  AgentRegistry,
  AgentRegistryError,
  JSON_SCHEMA_DIALECT,
  type AgentMemoryPolicy,
  type AgentRegistryRole,
  type CreateTeamLibraryDraftInput,
  type JsonSchemaDescriptor,
  type RegisterAgentVersionInput,
} from '../src/agent-registry.ts'

const NO_MEMORY = {
  access: 'NONE',
  kinds: [],
} as const satisfies AgentMemoryPolicy

const INPUT_SCHEMA = {
  id: 'future-cup.team-library.task-input',
  version: '1.0.0',
  dialect: JSON_SCHEMA_DIALECT,
  schema: {
    type: 'object',
    additionalProperties: true,
  },
} as const satisfies JsonSchemaDescriptor

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

function versionInput(role: AgentRegistryRole): RegisterAgentVersionInput {
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
    outputSchema: {
      id: `future-cup.team-library.${role}-output`,
      version: '1.0.0',
      dialect: JSON_SCHEMA_DIALECT,
      schema: {
        type: 'object',
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
    },
  }
}

function registerPublished(
  registry: AgentRegistry,
  id: string,
  role: AgentRegistryRole,
): string {
  const definition = registry.registerDefinition({
    id,
    name: `${role} agent`,
    purpose: `Own ${role} work.`,
    discoveryTags: [capabilityForRole(role)],
  })
  const version = registry.registerVersion(definition.id, versionInput(role))
  registry.validate(definition.id, version.id)
  registry.publish(definition.id, version.id)
  return version.id
}

function registerPublishedWithCapabilities(
  registry: AgentRegistry,
  id: string,
  role: AgentRegistryRole,
  capabilities: Readonly<Record<string, number>>,
): string {
  const definition = registry.registerDefinition({
    id,
    name: `${role} agent`,
    purpose: `Own ${role} work.`,
    discoveryTags: [capabilityForRole(role)],
  })
  const version = registry.registerVersion(definition.id, {
    ...versionInput(role),
    capabilities,
  })
  registry.validate(definition.id, version.id)
  registry.publish(definition.id, version.id)
  return version.id
}

function member(
  agentVersionId: string,
  displayName: string,
  departmentKey: CreateTeamLibraryDraftInput['members'][number]['departmentKey'],
  position: number,
) {
  return {
    agentVersionId,
    displayName,
    departmentKey,
    position,
  }
}

function expectRegistryError(action: () => void, code: AgentRegistryError['code']): void {
  expect(action).toThrowError(AgentRegistryError)
  try {
    action()
  } catch (error) {
    if (!(error instanceof AgentRegistryError)) throw error
    expect(error.code).toBe(code)
    return
  }
  throw new Error(`Expected AgentRegistryError with code ${code}`)
}

describe('Agent team library', () => {
  it('creates a logical team with multiple immutable versions', () => {
    const registry = new AgentRegistry()
    const planner = registerPublished(registry, 'planner', 'planner')
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const tester = registerPublished(registry, 'tester', 'tester')
    const repair = registerPublished(registry, 'repair', 'repair')
    const team = registry.createTeam({
      id: 'team-alpha',
      ownerId: 'user-1',
      name: 'Alpha delivery team',
      purpose: 'Ship a verified frontend project.',
    })
    const first = registry.createTeamVersionDraft(team.id, {
      version: '1.0.0',
      members: [
        member(planner, 'Planner', 'planning', 1),
        member(frontend, 'Frontend 1', 'frontend-a', 1),
        member(tester, 'Tester', 'verification', 1),
        member(repair, 'Repair', 'repair', 1),
      ],
    })
    const published = registry.publishTeamVersion(team.id, first.id)
    const second = registry.createTeamVersionDraft(team.id, {
      version: '1.1.0',
      members: [
        member(planner, 'Planner', 'planning', 1),
        member(frontend, 'Frontend 1', 'frontend-a', 1),
        member(frontend, 'Frontend 2', 'frontend-b', 2),
        member(tester, 'Tester', 'verification', 1),
        member(repair, 'Repair', 'repair', 1),
      ],
    })

    expect(registry.listTeams('user-1')).toHaveLength(1)
    expect(registry.listTeamVersions(team.id).map(version => version.status)).toEqual([
      'PUBLISHED',
      'DRAFT',
    ])
    expect(published.status).toBe('PUBLISHED')
    expect(second.status).toBe('DRAFT')
    expect(published.members).toHaveLength(4)
    expect(second.members).toHaveLength(5)
  })

  it('allows an empty draft but requires 1-7 runtime instances to publish', () => {
    const registry = new AgentRegistry()
    const team = registry.createTeam({
      id: 'team-empty',
      ownerId: 'user-1',
      name: 'Empty team',
      purpose: 'Start with an empty draft.',
    })
    const empty = registry.createTeamVersionDraft(team.id, {
      version: '1.0.0',
      members: [],
    })

    expect(empty.members).toEqual([])
    expectRegistryError(
      () => registry.publishTeamVersion(team.id, empty.id),
      'TEAM_MEMBER_COUNT_INVALID',
    )

    const planner = registerPublished(registry, 'planner', 'planner')
    const tooMany = Array.from({ length: 8 }, (_, index) => (
      member(planner, `Planner ${String(index + 1)}`, 'planning', index + 1)
    ))
    expectRegistryError(
      () => registry.createTeamVersionDraft(team.id, {
        version: '1.1.0',
        members: tooMany,
      }),
      'TEAM_MEMBER_COUNT_INVALID',
    )
  })

  it('counts duplicate Agent versions as separate runtime instances', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const team = registry.createTeam({
      id: 'team-duplicates',
      ownerId: 'user-1',
      name: 'Duplicate frontend team',
      purpose: 'Run two instances of the same published Agent.',
    })
    const draft = registry.createTeamVersionDraft(team.id, {
      version: '1.0.0',
      members: [
        member(frontend, 'Frontend 1', 'frontend-a', 1),
        member(frontend, 'Frontend 2', 'frontend-b', 2),
      ],
      requiredCapabilities: { frontend: 2 },
    })

    expect(draft.members.map(item => item.instanceId)).toEqual([
      `${frontend}:instance-1`,
      `${frontend}:instance-2`,
    ])
    expect(draft.members.map(item => item.instanceCount)).toEqual([1, 1])
  })

  it('publishes a one-member Team when one Agent covers every required capability', () => {
    const registry = new AgentRegistry()
    const allRounder = registerPublishedWithCapabilities(
      registry,
      'all-rounder',
      'frontend',
      {
        planning: 1,
        frontend: 1,
        testing: 1,
        repair: 1,
      },
    )
    const team = registry.createTeam({
      id: 'team-one-member',
      ownerId: 'user-1',
      name: 'One member team',
      purpose: 'One Agent covers the required capabilities.',
    })
    const draft = registry.createTeamVersionDraft(team.id, {
      version: '1.0.0',
      members: [member(allRounder, 'All-rounder', 'planning', 1)],
    })

    const published = registry.publishTeamVersion(team.id, draft.id)

    expect(published.members).toHaveLength(1)
    expect(published.status).toBe('PUBLISHED')
  })

  it('publishes a five-member Team without requiring every canonical role', () => {
    const registry = new AgentRegistry()
    const planner = registerPublished(registry, 'planner', 'planner')
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const tester = registerPublished(registry, 'tester', 'tester')
    const integration = registerPublished(registry, 'integration', 'integration')
    const repair = registerPublished(registry, 'repair', 'repair')
    const team = registry.createTeam({
      id: 'team-five-members',
      ownerId: 'user-1',
      name: 'Five member team',
      purpose: 'A custom five member composition.',
    })
    const draft = registry.createTeamVersionDraft(team.id, {
      version: '1.0.0',
      members: [
        member(planner, 'Planner', 'planning', 1),
        member(frontend, 'Frontend', 'frontend-a', 1),
        member(tester, 'Tester', 'verification', 1),
        member(integration, 'Integration', 'integration', 1),
        member(repair, 'Repair', 'repair', 1),
      ],
    })

    const published = registry.publishTeamVersion(team.id, draft.id)

    expect(published.members).toHaveLength(5)
    expect(published.requiredCapabilities).toMatchObject({
      planning: 1,
      frontend: 1,
      testing: 1,
      repair: 1,
    })
  })

  it('validates required frontend delivery capabilities on publish', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const team = registry.createTeam({
      id: 'team-capabilities',
      ownerId: 'user-1',
      name: 'Capability team',
      purpose: 'Verify capability coverage.',
    })
    const draft = registry.createTeamVersionDraft(team.id, {
      version: '1.0.0',
      members: [member(frontend, 'Frontend', 'frontend-a', 1)],
    })

    expectRegistryError(
      () => registry.publishTeamVersion(team.id, draft.id),
      'CAPABILITY_NOT_COVERED',
    )
  })

  it('rejects duplicate stable positions inside one draft department', () => {
    const registry = new AgentRegistry()
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const team = registry.createTeam({
      id: 'team-positions',
      ownerId: 'user-1',
      name: 'Position team',
      purpose: 'Verify stable HQ placement.',
    })

    expectRegistryError(
      () => registry.createTeamVersionDraft(team.id, {
        version: '1.0.0',
        members: [
          member(frontend, 'Frontend 1', 'frontend-a', 1),
          member(frontend, 'Frontend 2', 'frontend-a', 1),
        ],
      }),
      'TEAM_POSITION_DUPLICATE',
    )
  })

  it('freezes the exact runtime roster for a project', () => {
    const registry = new AgentRegistry()
    const planner = registerPublished(registry, 'planner', 'planner')
    const frontend = registerPublished(registry, 'frontend', 'frontend')
    const tester = registerPublished(registry, 'tester', 'tester')
    const repair = registerPublished(registry, 'repair', 'repair')
    const team = registry.createTeam({
      id: 'team-freeze',
      ownerId: 'user-1',
      name: 'Freeze team',
      purpose: 'Verify project freezing.',
    })
    const draft = registry.createTeamVersionDraft(team.id, {
      version: '1.0.0',
      members: [
        member(planner, 'Planner', 'planning', 1),
        member(frontend, 'Frontend 1', 'frontend-a', 1),
        member(frontend, 'Frontend 2', 'frontend-b', 2),
        member(tester, 'Tester', 'verification', 1),
        member(repair, 'Repair', 'repair', 1),
      ],
    })
    const published = registry.publishTeamVersion(team.id, draft.id)
    const binding = registry.freezeTeamForProject('project-1', published.id)

    expect(binding.schemaVersion).toBe(2)
    expect(binding.members.map(item => item.displayName)).toEqual([
      'Planner',
      'Frontend 1',
      'Frontend 2',
      'Tester',
      'Repair',
    ])
    expect(binding.members.map(item => item.instanceId)).toEqual(
      published.members.map(item => item.instanceId),
    )
  })
})
