import {
  agentTeamPageSchema,
  agentTeamSchema,
  agentDefinitionViewSchema,
  agentRoleTemplateSchema,
  agentVersionViewSchema,
  createAgentTeamRequestSchema,
  createTeamDraftRequestSchema,
  deleteResponseSchema,
  agentSchema,
  apiErrorSchema,
  deliverySchema,
  projectRunSchema,
  projectSchema,
  projectSnapshotSchema,
  structuredProjectProfileSchema,
  teamRecommendationAdoptionResponseSchema,
  teamRecommendationPlanSchema,
  teamRecommendationSaveResponseSchema,
  publicAgentTeamVersionSchema,
  publicTeamVersionResponseSchema,
  workflowControlEventSchema,
  workflowControlStateSchema,
  cancelRunResponseSchema,
  runStartResponseSchema,
} from './contracts.ts'
import type {
  AgentTeamPageView,
  AgentTeamView,
  AgentTeamVersionView,
  AgentDefinitionView,
  AgentRoleTemplateView,
  AgentVersionView,
  AgentView,
  DeliveryView,
  ProjectRunView,
  ProjectSnapshotView,
  ProjectView,
  StructuredProjectProfileView,
  TeamRecommendationAdoptionResponseView,
  TeamRecommendationAdoptRequestView,
  TeamRecommendationPlanView,
  TeamRecommendationRequestView,
  TeamRecommendationSaveRequestView,
  TeamRecommendationSaveResponseView,
  WorkflowControlEventView,
  WorkflowControlStateView,
} from './contracts.ts'

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiRequestError'
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    ...init,
    headers: {
      accept: 'application/json',
      ...init?.body === undefined ? {} : { 'content-type': 'application/json' },
      ...init?.headers,
    },
  })
  const value: unknown = await response.json()
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(value)
    if (parsed.success) {
      throw new ApiRequestError(response.status, parsed.data.code, parsed.data.message)
    }
    throw new ApiRequestError(response.status, 'REQUEST_FAILED', `HTTP ${String(response.status)}`)
  }
  return value
}

export const api = {
  async listProjects(): Promise<ProjectView[]> {
    return projectSchema.array().parse(await request('/api/v1/projects'))
  },

  async createProject(input: {
    name: string
    requirement: string
    teamVersionId?: string
  }): Promise<ProjectView> {
    return projectSchema.parse(await request('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }))
  },

  async deleteProject(projectId: string): Promise<boolean> {
    const value = deleteResponseSchema.parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}`,
      { method: 'DELETE' },
    ))
    return value.deleted
  },

  async listTeams(): Promise<AgentTeamPageView> {
    return agentTeamPageSchema.parse(await request('/api/v1/teams'))
  },

  async createTeam(input: {
    readonly name: string
    readonly purpose: string
  }): Promise<AgentTeamView> {
    return agentTeamSchema.parse(await request('/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify(createAgentTeamRequestSchema.parse(input)),
    }))
  },

  async listTeamVersions(teamId: string): Promise<AgentTeamVersionView[]> {
    return publicAgentTeamVersionSchema.array().parse(await request(
      `/api/v1/teams/${encodeURIComponent(teamId)}/versions`,
    ))
  },

  async createTeamDraft(teamId: string, input: unknown): Promise<AgentTeamVersionView> {
    return publicAgentTeamVersionSchema.parse(await request(
      `/api/v1/teams/${encodeURIComponent(teamId)}/versions`,
      {
        method: 'POST',
        body: JSON.stringify(createTeamDraftRequestSchema.parse(input)),
      },
    ))
  },

  async publishTeamVersion(teamId: string, versionId: string): Promise<AgentTeamVersionView> {
    const value = publicTeamVersionResponseSchema.parse(await request(
      `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(versionId)}/publish`,
      { method: 'POST', body: '{}' },
    ))
    return value.teamVersion
  },

  async deleteTeamVersion(teamId: string, versionId: string): Promise<boolean> {
    const value = deleteResponseSchema.parse(await request(
      `/api/v1/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(versionId)}`,
      { method: 'DELETE' },
    ))
    return value.deleted
  },

  async deleteTeam(teamId: string): Promise<boolean> {
    const value = deleteResponseSchema.parse(await request(
      `/api/v1/teams/${encodeURIComponent(teamId)}`,
      { method: 'DELETE' },
    ))
    return value.deleted
  },

  async listAgents(): Promise<AgentView[]> {
    return agentSchema.array().parse(await request('/api/v1/agents'))
  },

  async listAgentDefinitions(): Promise<AgentDefinitionView[]> {
    return agentDefinitionViewSchema.array().parse(await request('/api/v1/agent-definitions'))
  },

  async listAgentRoleTemplates(): Promise<AgentRoleTemplateView[]> {
    return agentRoleTemplateSchema.array().parse(await request('/api/v1/agent-role-templates'))
  },

  async createAgentDefinition(input: {
    readonly id?: string
    readonly name: string
    readonly purpose: string
    readonly discoveryTags?: readonly string[]
  }): Promise<AgentDefinitionView> {
    return agentDefinitionViewSchema.parse(await request('/api/v1/agent-definitions', {
      method: 'POST',
      body: JSON.stringify(input),
    }))
  },

  async updateAgentDefinition(
    definitionId: string,
    input: {
      readonly name?: string
      readonly purpose?: string
      readonly discoveryTags?: readonly string[]
    },
  ): Promise<AgentDefinitionView> {
    return agentDefinitionViewSchema.parse(await request(
      `/api/v1/agent-definitions/${encodeURIComponent(definitionId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      },
    ))
  },

  async deleteAgentDefinition(definitionId: string): Promise<boolean> {
    const value = deleteResponseSchema.parse(await request(
      `/api/v1/agent-definitions/${encodeURIComponent(definitionId)}`,
      { method: 'DELETE' },
    ))
    return value.deleted
  },

  async createAgentVersion(
    definitionId: string,
    input: {
      readonly version: string
      readonly role: string
      readonly model: string
      readonly prompt: string
      readonly promptVersion?: string
      readonly capabilities: Readonly<Record<string, number>>
      readonly toolAllowlist?: readonly string[]
      readonly memoryPolicy?: {
        readonly access: 'NONE' | 'READ' | 'WRITE'
        readonly kinds: readonly (
          | 'requirement'
          | 'design-decision'
          | 'failure-signature'
          | 'accepted-artifact-summary'
        )[]
      }
      readonly maxConcurrency?: number
      readonly autoPublish?: boolean
    },
  ): Promise<AgentVersionView> {
    return agentVersionViewSchema.parse(await request(
      `/api/v1/agent-definitions/${encodeURIComponent(definitionId)}/versions`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ))
  },

  async validateAgentVersion(
    definitionId: string,
    versionId: string,
  ): Promise<AgentDefinitionView> {
    return agentDefinitionViewSchema.parse(await request(
      `/api/v1/agent-definitions/${encodeURIComponent(definitionId)}/versions/${encodeURIComponent(versionId)}/validate`,
      { method: 'POST', body: '{}' },
    ))
  },

  async publishAgentVersion(
    definitionId: string,
    versionId: string,
  ): Promise<AgentDefinitionView> {
    return agentDefinitionViewSchema.parse(await request(
      `/api/v1/agent-definitions/${encodeURIComponent(definitionId)}/versions/${encodeURIComponent(versionId)}/publish`,
      { method: 'POST', body: '{}' },
    ))
  },

  async deprecateAgentDefinition(definitionId: string): Promise<AgentDefinitionView> {
    return agentDefinitionViewSchema.parse(await request(
      `/api/v1/agent-definitions/${encodeURIComponent(definitionId)}/deprecate`,
      { method: 'POST', body: '{}' },
    ))
  },

  async listProjectAgents(projectId: string): Promise<AgentView[]> {
    return agentSchema.array().parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/agents`,
    ))
  },

  async getSnapshot(projectId: string, afterSeq = 0, limit = 500): Promise<ProjectSnapshotView> {
    const query = new URLSearchParams({
      afterSeq: String(afterSeq),
      limit: String(limit),
    })
    return projectSnapshotSchema.parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/snapshot?${query.toString()}`,
    ))
  },

  async startRun(projectId: string): Promise<{ runId: string }> {
    return runStartResponseSchema.parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/runs`,
      { method: 'POST', body: '{}' },
    ))
  },

  async cancelRun(projectId: string): Promise<boolean> {
    const value = cancelRunResponseSchema.parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/cancel`,
      { method: 'POST', body: '{}' },
    ))
    return value.cancelled
  },

  async getDelivery(projectId: string): Promise<DeliveryView> {
    return deliverySchema.parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/delivery`,
    ))
  },

  async listRuns(projectId: string): Promise<ProjectRunView[]> {
    return projectRunSchema.array().parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/runs`,
    ))
  },

  async getRun(runId: string): Promise<ProjectRunView> {
    return projectRunSchema.parse(await request(`/api/v1/runs/${encodeURIComponent(runId)}`))
  },

  async getWorkflowControl(projectId: string): Promise<WorkflowControlStateView | undefined> {
    try {
      return workflowControlStateSchema.parse(await request(
        `/api/v1/projects/${encodeURIComponent(projectId)}/workflow-control`,
      ))
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'WORKFLOW_CONTROL_NOT_FOUND') {
        return undefined
      }
      throw error
    }
  },

  async listWorkflowControlEvents(projectId: string): Promise<WorkflowControlEventView[]> {
    return workflowControlEventSchema.array().parse(await request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/workflow-control/events`,
    ))
  },

  async structureTeamRequirement(input: {
    readonly requirement: string
    readonly candidate?: unknown
  }): Promise<StructuredProjectProfileView> {
    return structuredProjectProfileSchema.parse(await request(
      '/api/v1/team-recommendations/profile',
      { method: 'POST', body: JSON.stringify(input) },
    ))
  },

  async recommendTeam(input: TeamRecommendationRequestView): Promise<TeamRecommendationPlanView> {
    return teamRecommendationPlanSchema.parse(await request(
      '/api/v1/team-recommendations',
      { method: 'POST', body: JSON.stringify(input) },
    ))
  },

  async adjustTeamRecommendation(
    input: TeamRecommendationRequestView,
  ): Promise<TeamRecommendationPlanView> {
    return teamRecommendationPlanSchema.parse(await request(
      '/api/v1/team-recommendations/adjust',
      { method: 'POST', body: JSON.stringify(input) },
    ))
  },

  async saveTeam(
    input: TeamRecommendationSaveRequestView,
  ): Promise<TeamRecommendationSaveResponseView> {
    return teamRecommendationSaveResponseSchema.parse(await request(
      '/api/v1/team-recommendations/save',
      { method: 'POST', body: JSON.stringify(input) },
    ))
  },

  async adoptTeam(
    input: TeamRecommendationAdoptRequestView,
  ): Promise<TeamRecommendationAdoptionResponseView> {
    return teamRecommendationAdoptionResponseSchema.parse(await request(
      '/api/v1/team-recommendations/adopt',
      { method: 'POST', body: JSON.stringify(input) },
    ))
  },
}

export function screenshotUrl(projectId: string, path: string): string {
  if (path.startsWith('/api/') || path.startsWith('/preview/')) return path
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? path
  return `/api/v1/projects/${encodeURIComponent(projectId)}/screenshots/${encodeURIComponent(name)}`
}

export function previewUrl(projectId: string, delivery?: DeliveryView): string {
  return delivery?.previewUrl ?? `/preview/${encodeURIComponent(projectId)}/`
}
