import { describe, expect, it } from 'vitest'
import { PersistentAgentRegistry } from '../src/agent-registry-service.ts'
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
        'frontend-1',
        'frontend-2',
        'integration',
        'planner',
        'repair',
        'tester',
        'ui-designer',
      ])
      expect(profiles?.find(profile => profile.id === 'frontend-1')?.definitionVersionId)
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
})
