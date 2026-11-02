/** Durable orchestration facade over the pure Agent Registry domain model. */

import { AgentId } from './brand.ts'
import {
  AgentRegistry,
  type AgentTeam,
  AgentRegistryError,
  type AgentDefinition,
  type AgentDiscoveryQuery,
  type AgentLifecycleStatus,
  type AgentTeamVersion,
  type AgentVersion,
  type CreateAgentTeamInput,
  type CreateAgentTeamVersionInput,
  type CreateTeamLibraryDraftInput,
  type ProjectTeamBinding,
  type PublishedAgent,
  type RegisterAgentDefinitionInput,
  type RegisterAgentVersionInput,
  type UpdateAgentDefinitionInput,
} from './agent-registry.ts'
import { DEFAULT_AGENT_TEAM_ID, createDefaultAgentTeam } from './default-agent-team.ts'
import { checksumJson } from './content-checksum.ts'
import type {
  PlatformStore,
  StoredAgentTeam,
  StoredAgentVersion,
} from './platform-store.ts'
import { jsonValueSchema } from './schemas.ts'
import type { AgentProfile } from './types.ts'

/** Raised when persisted Agent Registry rows cannot be replayed consistently. */
export class AgentRegistryPersistenceError extends Error {
  /** @param message - actionable persistence integrity failure. */
  constructor(message: string) {
    super(message)
    this.name = 'AgentRegistryPersistenceError'
  }
}

/** Persisted registry facade shared by the platform API and project launcher. */
export class PersistentAgentRegistry {
  private readonly registry = new AgentRegistry()
  private initialized = false
  private initializePromise: Promise<void> | undefined

  /**
   * @param store - shared SQLite or PostgreSQL platform persistence.
   * @param now - deterministic clock override.
   */
  constructor(
    private readonly store: PlatformStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Replay every durable definition, version, team, and project binding. */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initializePromise !== undefined) {
      await this.initializePromise
      return
    }
    this.initializePromise = this.load()
    try {
      await this.initializePromise
      this.initialized = true
    } finally {
      this.initializePromise = undefined
    }
  }

  /**
   * Seed the fixed default team when the registry is empty.
   * @returns the published default team version id.
   */
  async ensureDefaultTeam(): Promise<string> {
    await this.initialize()
    const existing = this.registry.listTeamVersions().find(team => team.id === DEFAULT_AGENT_TEAM_ID)
    if (existing !== undefined) return existing.id
    const team = createDefaultAgentTeam(this.registry)
    await this.persistRegistry()
    return team.id
  }

  /**
   * Register one draft Agent definition.
   * @param input - stable metadata.
   * @returns the frozen definition.
   */
  async registerDefinition(input: RegisterAgentDefinitionInput): Promise<AgentDefinition> {
    await this.initialize()
    const definition = this.registry.registerDefinition(input)
    await this.persistDefinition(definition)
    return definition
  }

  /**
   * Update metadata while the definition is still mutable.
   * @param definitionId - logical Agent.
   * @param input - replacement metadata.
   * @returns the frozen definition.
   */
  async updateDefinition(
    definitionId: string,
    input: UpdateAgentDefinitionInput,
  ): Promise<AgentDefinition> {
    await this.initialize()
    const definition = this.registry.updateDefinition(definitionId, input)
    await this.persistDefinition(definition)
    return definition
  }

  /**
   * Register one immutable Agent version.
   * @param definitionId - owning definition.
   * @param input - complete executable configuration.
   * @returns the frozen version.
   */
  async registerVersion(
    definitionId: string,
    input: RegisterAgentVersionInput,
  ): Promise<AgentVersion> {
    await this.initialize()
    const version = this.registry.registerVersion(definitionId, input)
    await this.persistVersion(version)
    await this.persistDefinition(this.registry.getDefinition(definitionId))
    return version
  }

  /**
   * Validate one draft version.
   * @param definitionId - owning definition.
   * @param versionId - exact version.
   * @returns the frozen definition.
   */
  async validateVersion(definitionId: string, versionId: string): Promise<AgentDefinition> {
    await this.initialize()
    const definition = this.registry.validate(definitionId, versionId)
    const version = this.registry.getVersion(versionId)
    await Promise.all([
      this.persistDefinition(definition),
      this.persistVersion(version),
    ])
    return definition
  }

  /**
   * Publish one validated version.
   * @param definitionId - owning definition.
   * @param versionId - exact version.
   * @returns the frozen definition.
   */
  async publishVersion(definitionId: string, versionId: string): Promise<AgentDefinition> {
    await this.initialize()
    const definition = this.registry.publish(definitionId, versionId)
    const version = this.registry.getVersion(versionId)
    await Promise.all([
      this.persistDefinition(definition),
      this.persistVersion(version),
    ])
    return definition
  }

  /**
   * Deprecate one published definition and all currently published versions.
   * @param definitionId - logical Agent.
   * @returns the frozen deprecated definition.
   */
  async deprecateDefinition(definitionId: string): Promise<AgentDefinition> {
    await this.initialize()
    const definition = this.registry.deprecate(definitionId)
    const versions = this.registry.listVersions(definitionId)
    await this.persistDefinition(definition)
    await Promise.all(versions.map(version => this.persistVersion(version)))
    return definition
  }

  /**
   * Discover published Agent versions.
   * @param query - capabilities, role, and tags.
   * @returns published definition/version pairs.
   */
  async discoverPublished(query: AgentDiscoveryQuery = {}): Promise<readonly PublishedAgent[]> {
    await this.initialize()
    return this.registry.discoverPublished(query)
  }

  /**
   * List every logical definition.
   * @returns frozen definitions.
   */
  async listDefinitions(): Promise<readonly AgentDefinition[]> {
    await this.initialize()
    return this.registry.listDefinitions()
  }

  /**
   * List every immutable version of one definition.
   * @param definitionId - logical Agent.
   * @returns frozen versions.
   */
  async listVersions(definitionId: string): Promise<readonly AgentVersion[]> {
    await this.initialize()
    return this.registry.listVersions(definitionId)
  }

  /**
   * Read one version lifecycle stage.
   * @param versionId - immutable version identity.
   * @returns current lifecycle state.
   */
  async getVersionStatus(versionId: string): Promise<AgentLifecycleStatus> {
    await this.initialize()
    return this.registry.getVersionStatus(versionId)
  }

  /**
   * Validate and persist one immutable team composition.
   * @param input - member versions and policy requirements.
   * @returns the frozen team version.
   */
  async createTeamVersion(input: CreateAgentTeamVersionInput): Promise<AgentTeamVersion> {
    await this.initialize()
    const team = this.registry.createTeamVersion(input)
    await this.store.saveAgentTeam({
      team: this.registry.getTeam(team.teamId),
      createdAt: this.timestamp(),
      updatedAt: this.timestamp(),
    })
    await this.persistTeam(team)
    return team
  }

  /**
   * Create one active logical Team owned by a user.
   * @param input - Team identity, owner, and metadata.
   * @returns the persisted logical Team.
   */
  async createTeam(input: CreateAgentTeamInput): Promise<AgentTeam> {
    await this.initialize()
    const team = this.registry.createTeam(input)
    await this.persistTeamMetadata(team)
    return team
  }

  /**
   * List logical Teams owned by one user.
   * @param ownerId - optional owner filter.
   * @returns persisted logical Teams.
   */
  async listTeams(ownerId?: string): Promise<readonly AgentTeam[]> {
    await this.initialize()
    return this.registry.listTeams(ownerId)
  }

  /**
   * Read one logical Team.
   * @param teamId - logical Team identity.
   * @returns the persisted logical Team.
   */
  async getTeam(teamId: string): Promise<AgentTeam> {
    await this.initialize()
    return this.registry.getTeam(teamId)
  }

  /**
   * Create a draft version under one logical Team.
   * @param teamId - owning logical Team.
   * @param input - runtime instances and optional policy requirements.
   * @returns the persisted draft.
   */
  async createTeamVersionDraft(
    teamId: string,
    input: CreateTeamLibraryDraftInput,
  ): Promise<AgentTeamVersion> {
    await this.initialize()
    const version = this.registry.createTeamVersionDraft(teamId, input)
    await this.persistTeam(version)
    return version
  }

  /**
   * Publish one validated draft under its logical Team.
   * @param teamId - owning logical Team.
   * @param teamVersionId - draft version.
   * @returns the persisted published version.
   */
  async publishTeamVersion(teamId: string, teamVersionId: string): Promise<AgentTeamVersion> {
    await this.initialize()
    const version = this.registry.publishTeamVersion(teamId, teamVersionId)
    await this.persistPublishedTeam(version)
    return version
  }

  /**
   * Archive one logical Team.
   * @param teamId - logical Team identity.
   * @returns the persisted archived Team.
   */
  async archiveTeam(teamId: string): Promise<AgentTeam> {
    await this.initialize()
    const team = this.registry.archiveTeam(teamId)
    await this.persistTeamMetadata(team)
    return team
  }

  /**
   * Delete one DRAFT version under a logical Team.
   * @param teamId - owning logical Team.
   * @param teamVersionId - draft version identity.
   */
  async deleteTeamVersionDraft(teamId: string, teamVersionId: string): Promise<void> {
    await this.initialize()
    this.registry.deleteTeamVersionDraft(teamId, teamVersionId)
    await this.store.deleteAgentTeamVersion(teamVersionId)
  }

  /**
   * Delete one logical Team and its versions when no project binding references them.
   * @param teamId - logical Team identity.
   */
  async deleteTeam(teamId: string): Promise<void> {
    await this.initialize()
    this.registry.deleteTeam(teamId)
    await this.store.deleteAgentTeam(teamId)
  }

  /**
   * Remove a project's in-memory frozen team binding when the project is deleted.
   * @param projectId - Future Cup project identity.
   */
  async unbindProject(projectId: string): Promise<void> {
    await this.initialize()
    this.registry.unfreezeProject(projectId)
  }

  /**
   * Clone one published Team into a new active Team draft.
   * @param sourceTeamVersionId - published source version.
   * @param options - new owner, identity, and optional display metadata.
   * @returns the cloned logical Team and draft version.
   */
  async cloneTeam(
    sourceTeamVersionId: string,
    options: {
      readonly id: string
      readonly ownerId: string
      readonly name?: string | undefined
      readonly purpose?: string | undefined
      readonly version?: string | undefined
    },
  ): Promise<{ readonly team: AgentTeam; readonly version: AgentTeamVersion }> {
    await this.initialize()
    const cloned = this.registry.cloneTeam(sourceTeamVersionId, options)
    await this.persistTeamMetadata(cloned.team)
    await this.persistTeam(cloned.version)
    return cloned
  }

  /**
   * List immutable versions of one logical Team.
   * @param teamId - optional logical Team filter.
   * @returns persisted versions.
   */
  async listTeamVersions(teamId?: string): Promise<readonly AgentTeamVersion[]> {
    await this.initialize()
    return this.registry.listTeamVersions(teamId)
  }

  /**
   * Freeze one team version to a project.
   * @param projectId - Future Cup project.
   * @param teamVersionId - immutable team version.
   * @returns complete frozen project binding.
   */
  async bindProject(projectId: string, teamVersionId: string): Promise<ProjectTeamBinding> {
    const binding = await this.freezeProject(projectId, teamVersionId)
    await this.store.bindProjectTeam(binding)
    return binding
  }

  /**
   * Freeze one published team version without writing a second transaction.
   * @param projectId - Future Cup project.
   * @param teamVersionId - immutable team version.
   * @returns complete frozen project binding.
   */
  async freezeProject(projectId: string, teamVersionId: string): Promise<ProjectTeamBinding> {
    await this.initialize()
    return this.registry.freezeTeamForProject(projectId, teamVersionId)
  }

  /**
   * Read one frozen project binding.
   * @param projectId - owning project.
   * @returns binding when present.
   */
  async getProjectBinding(projectId: string): Promise<ProjectTeamBinding | undefined> {
    await this.initialize()
    return this.registry.listProjectBindings().find(binding => binding.projectId === projectId)
  }

  /**
   * Derive scheduler profiles from a project's frozen team.
   * @param projectId - owning project.
   * @returns executable profiles, or undefined for a legacy unbound project.
   */
  async projectProfiles(projectId: string): Promise<readonly AgentProfile[] | undefined> {
    const binding = await this.getProjectBinding(projectId)
    if (binding === undefined) return undefined
    return agentProfilesFromTeamBinding(binding)
  }

  private async load(): Promise<void> {
    const [definitions, versions, logicalTeams, teamVersions, bindings] = await Promise.all([
      this.store.listAgentDefinitions(),
      this.store.listAgentVersions(),
      this.store.listAgentTeams(),
      this.store.listAgentTeamVersions(),
      this.store.listProjectTeamBindings(),
    ])
    for (const record of definitions) {
      this.registry.registerDefinition({
        id: record.definition.id,
        name: record.definition.name,
        purpose: record.definition.purpose,
        discoveryTags: record.definition.discoveryTags,
      })
    }
    const versionsByDefinition = new Map<string, StoredAgentVersion[]>()
    for (const record of versions) {
      const values = versionsByDefinition.get(record.version.definitionId) ?? []
      values.push(record)
      versionsByDefinition.set(record.version.definitionId, values)
    }
    for (const definition of definitions) {
      const records = versionsByDefinition.get(definition.definition.id) ?? []
      records.sort((left, right) => left.ordinal - right.ordinal)
      for (const record of records) {
        this.registry.registerVersion(
          definition.definition.id,
          versionRegistrationInput(record.version),
        )
        if (record.status !== 'DRAFT') {
          this.registry.validate(definition.definition.id, record.version.id)
        }
        if (record.status === 'PUBLISHED' || record.status === 'DEPRECATED') {
          this.registry.publish(definition.definition.id, record.version.id)
        }
      }
    }
    for (const record of logicalTeams) {
      this.registry.restoreTeam(record.team)
    }
    for (const record of [...teamVersions].sort((left, right) => left.ordinal - right.ordinal)) {
      this.registry.restoreTeamVersion(record.teamVersion)
    }
    for (const binding of bindings) {
      // A frozen binding is the authoritative published snapshot for historical projects.
      this.registry.restoreTeamVersion(binding.teamVersion)
      await this.persistTeam(binding.teamVersion)
      this.registry.freezeTeamForProject(binding.projectId, binding.teamVersion.id)
    }
    for (const record of definitions) {
      if (record.definition.status === 'DEPRECATED') {
        this.registry.deprecate(record.definition.id)
      }
    }
  }

  private async persistRegistry(): Promise<void> {
    for (const definition of this.registry.listDefinitions()) {
      await this.persistDefinition(definition)
      for (const version of this.registry.listVersions(definition.id)) {
        await this.persistVersion(version)
      }
    }
    for (const team of this.registry.listTeams()) {
      await this.persistTeamMetadata(team)
    }
    for (const team of this.registry.listTeamVersions()) {
      await this.persistTeam(team)
    }
    for (const binding of this.registry.listProjectBindings()) {
      await this.store.bindProjectTeam(binding)
    }
  }

  private async persistDefinition(definition: AgentDefinition): Promise<void> {
    const timestamp = this.timestamp()
    const existing = (await this.store.listAgentDefinitions())
      .find(record => record.definition.id === definition.id)
    await this.store.saveAgentDefinition({
      definition,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
  }

  private async persistVersion(version: AgentVersion): Promise<void> {
    const definitionVersions = await this.store.listAgentVersions(version.definitionId)
    const existing = definitionVersions.find(record => record.version.id === version.id)
    const status = this.registry.getVersionStatus(version.id)
    const timestamp = this.timestamp()
    const record: StoredAgentVersion = {
      version,
      ordinal: existing?.ordinal ?? definitionVersions.length + 1,
      checksum: checksumJson(jsonValueSchema.parse(version)),
      status,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
      publishedAt: status === 'PUBLISHED' || status === 'DEPRECATED'
        ? existing?.publishedAt ?? timestamp
        : undefined,
      deprecatedAt: status === 'DEPRECATED' ? existing?.deprecatedAt ?? timestamp : undefined,
    }
    await this.store.saveAgentVersion(record)
  }

  private async persistTeam(team: AgentTeamVersion): Promise<void> {
    const teams = await this.store.listAgentTeamVersions()
    const existing = teams.find(record => record.teamVersion.id === team.id)
    if (existing !== undefined && JSON.stringify(existing.teamVersion) === JSON.stringify(team)) {
      return
    }
    const timestamp = this.timestamp()
    await this.store.saveAgentTeamVersion({
      teamVersion: team,
      ordinal: existing?.ordinal ?? teams.length + 1,
      checksum: agentTeamVersionChecksum(team),
      status: team.status,
      createdAt: existing?.createdAt ?? timestamp,
      publishedAt: team.status === 'PUBLISHED'
        ? existing?.publishedAt ?? timestamp
        : undefined,
    })
  }

  private async persistPublishedTeam(team: AgentTeamVersion): Promise<void> {
    const teams = await this.store.listAgentTeamVersions()
    const existing = teams.find(record => record.teamVersion.id === team.id)
    if (existing === undefined) {
      throw new AgentRegistryError(
        `Agent team version "${team.id}" is not persisted`,
        'TEAM_VERSION_NOT_FOUND',
      )
    }
    const published = await this.store.publishAgentTeamVersion({
      teamVersion: team,
      ordinal: existing.ordinal,
      checksum: agentTeamVersionChecksum(team),
      status: 'PUBLISHED',
      createdAt: existing.createdAt,
      publishedAt: this.timestamp(),
    })
    if (!published) {
      throw new AgentRegistryError(
        `Agent team version "${team.id}" is not a draft`,
        'TEAM_VERSION_NOT_DRAFT',
      )
    }
  }

  private async persistTeamMetadata(team: AgentTeam): Promise<void> {
    const existing = (await this.store.listAgentTeams())
      .find(record => record.team.id === team.id)
    const timestamp = this.timestamp()
    const record: StoredAgentTeam = {
      team,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await this.store.saveAgentTeam(record)
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
}

function agentTeamVersionChecksum(team: AgentTeamVersion): string {
  return checksumJson(jsonValueSchema.parse({
    ...team,
    status: 'PUBLISHED',
  }))
}

/**
 * Expand one frozen team binding into independently schedulable Agent profiles.
 * @param binding - project team snapshot.
 * @returns immutable profiles; the deterministic verifier remains system-owned.
 */
export function agentProfilesFromTeamBinding(
  binding: ProjectTeamBinding,
): readonly AgentProfile[] {
  const profiles: AgentProfile[] = []
  for (const member of binding.members) {
    if (member.version.role === 'verifier') continue
    profiles.push(Object.freeze({
      id: AgentId(member.instanceId),
      name: member.displayName,
      role: member.version.role,
      capabilities: member.version.capabilities,
      maxConcurrency: member.version.maxConcurrency,
      currentLoad: 0,
      historicalSuccessRate: 0.75,
      available: true,
      definitionVersionId: member.version.id,
      model: member.version.model,
      instructions: member.version.prompt,
      toolAllowlist: member.version.toolAllowlist,
      memoryPolicy: member.version.memoryPolicy,
      departmentKey: member.departmentKey,
      position: member.position,
    }))
  }
  return Object.freeze(profiles)
}

function versionRegistrationInput(version: AgentVersion): RegisterAgentVersionInput {
  return {
    id: version.id,
    version: version.version,
    role: version.role,
    model: version.model,
    prompt: version.prompt,
    promptVersion: version.promptVersion,
    capabilities: version.capabilities,
    toolAllowlist: version.toolAllowlist,
    memoryPolicy: version.memoryPolicy,
    maxConcurrency: version.maxConcurrency,
    inputSchema: version.inputSchema,
    outputSchema: version.outputSchema,
  }
}
