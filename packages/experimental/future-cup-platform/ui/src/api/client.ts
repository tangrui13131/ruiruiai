import {
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
  workflowControlEventSchema,
  workflowControlStateSchema,
  cancelRunResponseSchema,
  runStartResponseSchema,
} from './contracts.ts'
import type {
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

  async createProject(input: { name: string; requirement: string }): Promise<ProjectView> {
    return projectSchema.parse(await request('/api/v1/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }))
  },

  async listAgents(): Promise<AgentView[]> {
    return agentSchema.array().parse(await request('/api/v1/agents'))
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
