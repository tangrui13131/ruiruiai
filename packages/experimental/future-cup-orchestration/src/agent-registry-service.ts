/** Durable orchestration facade over the pure Agent Registry domain model. */

import { AgentId } from './brand.ts'
import {
  AgentRegistry,
  type AgentDefinition,
  type AgentDiscoveryQuery,
  type AgentLifecycleStatus,
  type AgentTeamVersion,
  type AgentVersion,
  type CreateAgentTeamVersionInput,
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
    await this.persistTeam(team)
    return team
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
    const [definitions, versions, teams, bindings] = await Promise.all([
      this.store.listAgentDefinitions(),
      this.store.listAgentVersions(),
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
    for (const record of [...teams].sort((left, right) => left.ordinal - right.ordinal)) {
      this.registry.createTeamVersion(teamInput(record.teamVersion))
    }
    for (const binding of bindings) {
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
    const timestamp = this.timestamp()
    await this.store.saveAgentTeamVersion({
      teamVersion: team,
      ordinal: existing?.ordinal ?? teams.length + 1,
      checksum: checksumJson(jsonValueSchema.parse(team)),
      status: 'PUBLISHED',
      createdAt: existing?.createdAt ?? timestamp,
      publishedAt: existing?.publishedAt ?? timestamp,
    })
  }

  private timestamp(): string {
    return this.now().toISOString()
  }
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
    for (let instance = 1; instance <= member.instanceCount; instance += 1) {
      const suffix = member.instanceCount === 1 ? '' : `-${String(instance)}`
      profiles.push(Object.freeze({
        id: AgentId(`${member.definition.id}${suffix}`),
        name: member.instanceCount === 1
          ? member.definition.name
          : `${member.definition.name} ${String(instance)}`,
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
      }))
    }
  }
  return Object.freeze(profiles)
}

function teamInput(team: AgentTeamVersion): CreateAgentTeamVersionInput {
  return {
    id: team.id,
    name: team.name,
    version: team.version,
    purpose: team.purpose,
    members: team.members.map(member => ({
      agentVersionId: member.version.id,
      instanceCount: member.instanceCount,
    })),
    requiredCapabilities: team.requiredCapabilities,
    requiredConcurrency: team.requiredConcurrency,
    toolPolicy: team.toolPolicy,
    memoryPolicy: team.memoryPolicy,
    inputSchema: team.inputSchema,
    requiredOutputSchemas: team.outputSchemas,
  }
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
