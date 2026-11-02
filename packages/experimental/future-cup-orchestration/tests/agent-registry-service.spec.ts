import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PersistentAgentRegistry } from '../src/agent-registry-service.ts'
import { parseProjectTeamBinding } from '../src/agent-registry.ts'
import { ProjectId } from '../src/brand.ts'
import { DEFAULT_AGENT_TEAM_ID } from '../src/default-agent-team.ts'
import { OrchestrationRepository } from '../src/repository.ts'

describe('PersistentAgentRegistry', () => {
  it('seeds, reloads, discovers, and freezes the default team', async () => {
    const repository = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
    try {
      const registry = new PersistentAgentRegistry(repository)
      expect(await registry.ensureDefaultTeam()).toBe(DEFAULT_AGENT_TEAM_ID)
      expect(repository.listAgentDefinitions()).toHaveLength(7)
      expect(await registry.discoverPublished({ capability: 'frontend' })).toHaveLength(1)

      const reloaded = new PersistentAgentRegistry(repository)
      await reloaded.initialize()
      expect((await reloaded.listDefinitions()).map(definition => definition.id)).toContain('planner')
      expect(await reloaded.discoverPublished({ capability: 'frontend' })).toHaveLength(1)

      const projectId = ProjectId('project-registry-service')
      const createdAt = '2026-11-01T08:00:00.000Z'
      const binding = await reloaded.freezeProject(projectId, DEFAULT_AGENT_TEAM_ID)
      repository.createProject({
        id: projectId,
        name: 'Registry project',
        requirement: 'Build a verified frontend',
        createdAt,
      }, [], undefined, binding, [{
        id: 'memory-registry-project',
        projectId,
        kind: 'requirement',
        key: 'initial-requirement',
        value: { requirement: 'Build a verified frontend' },
        source: 'test',
        createdAt,
      }])

      expect(repository.getProjectTeamBinding(projectId)).toEqual(binding)
      expect(repository.listProjectMemoryEntries(projectId)).toMatchObject([{
        kind: 'requirement',
        key: 'initial-requirement',
      }])
      const profiles = await reloaded.projectProfiles(projectId)
      expect(profiles?.map(profile => profile.id)).toEqual([
        'planner-1.0.0:instance-1',
        'ui-designer-1.0.0:instance-1',
        'frontend-1.0.0:instance-1',
        'frontend-1.0.0:instance-2',
        'integration-1.0.0:instance-1',
        'tester-1.0.0:instance-1',
        'repair-1.0.0:instance-1',
      ])
      expect(profiles?.find(profile => profile.id === 'frontend-1.0.0:instance-1')?.definitionVersionId)
        .toBe('frontend-1.0.0')
    } finally {
      repository.close()
    }
  })

  it('keeps published definitions versionable and leaves frozen bindings unchanged', async () => {
    const repository = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
    try {
      const registry = new PersistentAgentRegistry(repository)
      const teamVersionId = await registry.ensureDefaultTeam()
      const projectId = ProjectId('project-version-freeze')
      const binding = await registry.freezeProject(projectId, teamVersionId)
      repository.createProject({
        id: projectId,
        name: 'Version freeze',
        requirement: 'Requirement',
        createdAt: '2026-11-01T08:00:00.000Z',
      }, [], undefined, binding)

      const plannerVersions = await registry.listVersions('planner')
      const current = plannerVersions[0]
      if (current === undefined) throw new Error('expected seeded planner version')
      const next = await registry.registerVersion('planner', {
        id: 'planner-1.1.0',
        version: '1.1.0',
        role: current.role,
        model: current.model,
        prompt: current.prompt,
        promptVersion: 'm5.1-v2',
        capabilities: current.capabilities,
        toolAllowlist: current.toolAllowlist,
        memoryPolicy: current.memoryPolicy,
        maxConcurrency: 1,
        inputSchema: current.inputSchema,
        outputSchema: current.outputSchema,
      })
      await registry.validateVersion('planner', next.id)
      await registry.publishVersion('planner', next.id)

      expect(await registry.listVersions('planner')).toHaveLength(2)
      expect(await registry.getVersionStatus(next.id)).toBe('PUBLISHED')
      expect(repository.getProjectTeamBinding(projectId)?.members
        .find(member => member.version.role === 'planner')?.version.id)
        .toBe('planner-1.0.0')

      await registry.deprecateDefinition('planner')
      expect(await registry.discoverPublished({ capability: 'planning' })).toEqual([])
      expect(repository.getProjectTeamBinding(projectId)?.members
        .find(member => member.version.role === 'planner')?.version.id)
        .toBe('planner-1.0.0')
    } finally {
      repository.close()
    }
  })

  it('persists multiple owned Teams and their draft versions', async () => {
    const repository = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
    try {
      const registry = new PersistentAgentRegistry(repository)
      await registry.ensureDefaultTeam()
      const first = await registry.createTeam({
        id: 'team-owned-a',
        ownerId: 'user-owned',
        name: 'Owned A',
        purpose: 'First owned team.',
      })
      await registry.createTeam({
        id: 'team-owned-b',
        ownerId: 'user-owned',
        name: 'Owned B',
        purpose: 'Second owned team.',
      })
      const draft = await registry.createTeamVersionDraft(first.id, {
        version: '1.0.0',
        members: [],
      })

      const reloaded = new PersistentAgentRegistry(repository)
      expect(await reloaded.listTeams('user-owned')).toHaveLength(2)
      expect(await reloaded.listTeamVersions(first.id)).toEqual([
        expect.objectContaining({
          id: draft.id,
          status: 'DRAFT',
          members: [],
        }),
      ])
      expect((await reloaded.archiveTeam(first.id)).status).toBe('ARCHIVED')
    } finally {
      repository.close()
    }
  })

  it('allows exactly one concurrent publisher to transition a draft', async () => {
    const repository = new OrchestrationRepository(':memory:', { journalMode: 'delete' })
    try {
      const seed = new PersistentAgentRegistry(repository)
      await seed.registerDefinition({
        id: 'frontend',
        name: 'Frontend Agent',
        purpose: 'Build React pages.',
        discoveryTags: ['frontend'],
      })
      await seed.registerVersion('frontend', {
        id: 'frontend-1.0.0',
        version: '1.0.0',
        role: 'frontend',
        model: 'deepseek-flash',
        prompt: 'Build.',
        promptVersion: 'v1',
        capabilities: { frontend: 1 },
        toolAllowlist: ['fs-read'],
        memoryPolicy: { access: 'READ', kinds: ['requirement'] },
        maxConcurrency: 1,
        inputSchema: {
          id: 'future-cup.task-input',
          version: '1.0.0',
          dialect: 'https://json-schema.org/draft/2020-12/schema',
          schema: { type: 'object', additionalProperties: true },
        },
        outputSchema: {
          id: 'future-cup.frontend-output',
          version: '1.0.0',
          dialect: 'https://json-schema.org/draft/2020-12/schema',
          schema: { type: 'object' },
        },
      })
      await seed.validateVersion('frontend', 'frontend-1.0.0')
      await seed.publishVersion('frontend', 'frontend-1.0.0')
      const team = await seed.createTeam({
        id: 'team-concurrent',
        ownerId: 'user-concurrent',
        name: 'Concurrent team',
        purpose: 'Publish once.',
      })
      await seed.createTeamVersionDraft(team.id, {
        version: '1.0.0',
        members: [{
          agentVersionId: 'frontend-1.0.0',
          displayName: 'Frontend',
          departmentKey: 'frontend-a',
          position: 1,
        }],
        requiredCapabilities: { frontend: 1 },
      })

      const first = new PersistentAgentRegistry(repository)
      await first.initialize()
      const second = new PersistentAgentRegistry(repository)
      await second.initialize()

      const results = await Promise.allSettled([
        first.publishTeamVersion(team.id, `${team.id}:1.0.0`),
        second.publishTeamVersion(team.id, `${team.id}:1.0.0`),
      ])
      const fulfilled = results.filter(result => result.status === 'fulfilled')
      const rejected = results.filter(result => result.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(fulfilled[0]).toMatchObject({
        status: 'fulfilled',
        value: { status: 'PUBLISHED' },
      })
      expect(rejected).toHaveLength(1)
      expect(rejected[0]).toMatchObject({
        status: 'rejected',
        reason: { code: 'TEAM_VERSION_NOT_DRAFT' },
      })
    } finally {
      repository.close()
    }
  })

  it('reads a legacy frozen binding with instance_count members', () => {
    const binding = parseProjectTeamBinding({
      id: 'project-legacy:frozen',
      projectId: 'project-legacy',
      schemaVersion: 1,
      teamVersion: {
        id: 'team-version-legacy',
        name: 'Legacy team',
        version: '1.0.0',
        purpose: 'Ship.',
        members: [{
          instanceCount: 2,
          definition: {
            id: 'frontend',
            name: 'Frontend Agent',
            purpose: 'Build React pages.',
            discoveryTags: ['frontend'],
            status: 'PUBLISHED',
          },
          version: {
            id: 'frontend-1.0.0',
            definitionId: 'frontend',
            version: '1.0.0',
            role: 'frontend',
            model: 'deepseek-flash',
            prompt: 'Build.',
            promptVersion: 'v1',
            capabilities: { frontend: 1 },
            toolAllowlist: ['fs-read'],
            memoryPolicy: { access: 'READ', kinds: ['requirement'] },
            maxConcurrency: 1,
            inputSchema: {
              id: 'in',
              version: '1.0.0',
              dialect: 'https://json-schema.org/draft/2020-12/schema',
              schema: { type: 'object' },
            },
            outputSchema: {
              id: 'out',
              version: '1.0.0',
              dialect: 'https://json-schema.org/draft/2020-12/schema',
              schema: { type: 'object' },
            },
          },
        }],
        requiredCapabilities: { frontend: 1 },
        requiredConcurrency: 2,
        concurrencyCapacity: 2,
        toolPolicy: { allowedTools: ['fs-read'], requiredTools: ['fs-read'] },
        memoryPolicy: {
          allowedAccess: 'READ',
          requiredAccess: 'NONE',
          allowedKinds: ['requirement'],
          requiredKinds: [],
        },
        inputSchema: {
          id: 'in',
          version: '1.0.0',
          dialect: 'https://json-schema.org/draft/2020-12/schema',
          schema: { type: 'object' },
        },
        outputSchemas: [{
          id: 'out',
          version: '1.0.0',
          dialect: 'https://json-schema.org/draft/2020-12/schema',
          schema: { type: 'object' },
        }],
      },
      members: [{
        instanceCount: 2,
        definition: {
          id: 'frontend',
          name: 'Frontend Agent',
          purpose: 'Build React pages.',
          discoveryTags: ['frontend'],
          status: 'PUBLISHED',
        },
        version: {
          id: 'frontend-1.0.0',
          definitionId: 'frontend',
          version: '1.0.0',
          role: 'frontend',
          model: 'deepseek-flash',
          prompt: 'Build.',
          promptVersion: 'v1',
          capabilities: { frontend: 1 },
          toolAllowlist: ['fs-read'],
          memoryPolicy: { access: 'READ', kinds: ['requirement'] },
          maxConcurrency: 1,
          inputSchema: {
            id: 'in',
            version: '1.0.0',
            dialect: 'https://json-schema.org/draft/2020-12/schema',
            schema: { type: 'object' },
          },
          outputSchema: {
            id: 'out',
            version: '1.0.0',
            dialect: 'https://json-schema.org/draft/2020-12/schema',
            schema: { type: 'object' },
          },
        },
      }],
    })

    expect(binding.members.map(member => member.instanceId)).toEqual([
      'frontend-1.0.0:instance-1',
      'frontend-1.0.0:instance-2',
    ])
  })

  it('stores one member row per instance with the member position and HQ key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'future-cup-member-persist-'))
    const path = join(directory, 'orchestration.sqlite')
    const repository = new OrchestrationRepository(path, { journalMode: 'delete' })
    try {
      const registry = new PersistentAgentRegistry(repository)
      await registry.ensureDefaultTeam()
      const team = await registry.createTeam({
        id: 'team-member-persist',
        ownerId: 'user-member-persist',
        name: 'Member persist team',
        purpose: 'Verify durable member columns.',
      })
      await registry.createTeamVersionDraft(team.id, {
        version: '1.0.0',
        members: [
          {
            agentVersionId: 'planner-1.0.0',
            displayName: 'Lead Planner',
            departmentKey: 'planning',
            position: 3,
          },
          {
            agentVersionId: 'frontend-1.0.0',
            displayName: 'Feature Frontend',
            departmentKey: 'frontend-a',
            position: 2,
          },
        ],
        requiredCapabilities: { planning: 1, frontend: 1 },
      })

      const raw = new DatabaseSync(path)
      try {
        expect(raw.prepare(`
          SELECT member_id, display_name, department_key, position
          FROM agent_team_members
          WHERE team_version_id = ?
          ORDER BY position
        `).all(`${team.id}:1.0.0`)).toEqual([
          {
            member_id: 'frontend-1.0.0:instance-1',
            display_name: 'Feature Frontend',
            department_key: 'frontend-a',
            position: 2,
          },
          {
            member_id: 'planner-1.0.0:instance-1',
            display_name: 'Lead Planner',
            department_key: 'planning',
            position: 3,
          },
        ])
      } finally {
        raw.close()
      }
    } finally {
      repository.close()
      try {
        rmSync(directory, { recursive: true, force: true })
      } catch {
        // Windows may retain the SQLite file briefly after close.
      }
    }
  })
})
