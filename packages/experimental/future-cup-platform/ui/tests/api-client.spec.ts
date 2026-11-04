import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { agent } from './fixtures.ts'
import { teamProfile, teamRecommendationPlan } from './team-fixtures.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('project Agent API', () => {
  it('creates a project successor through the encoded derivation route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      project: {
        id: 'project-target',
        name: 'Project v2',
        requirement: 'Build the page',
        createdAt: '2026-11-04T10:00:00.000Z',
        lastEventSeq: 0,
        sourceProjectId: 'project-source',
        sourceProjectName: 'Project',
        derivationMode: 'UPGRADE',
        changeRequest: 'Add search',
      },
      runId: 'run-target',
    }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.deriveProject('project / source', {
      name: 'Project v2',
      mode: 'UPGRADE',
      changeRequest: 'Add search',
    })).resolves.toMatchObject({
      project: {
        id: 'project-target',
        sourceProjectId: 'project-source',
        derivationMode: 'UPGRADE',
      },
      runId: 'run-target',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project%20%2F%20source/derivations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('loads project-scoped Agent metrics from the encoded project route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      agent('frontend-a', 1, 0.5, 1, 2),
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.listProjectAgents('project / one')).resolves.toEqual([
      expect.objectContaining({
        id: 'frontend-a',
        currentLoad: 1,
        historicalSuccessCount: 1,
        historicalExecutionCount: 2,
        available: false,
      }),
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/projects/project%20%2F%20one/agents',
      expect.objectContaining({ headers: expect.objectContaining({ accept: 'application/json' }) }),
    )
  })

  it('treats a missing workflow-control run as an empty state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: 'WORKFLOW_CONTROL_NOT_FOUND',
      message: 'not found',
    }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })))

    await expect(api.getWorkflowControl('project-1')).resolves.toBeUndefined()
  })

  it('calls every team recommendation route with validated payloads', async () => {
    const plan = teamRecommendationPlan()
    const teamVersion = {
      id: 'team-recommended',
      name: 'recommended-team',
      version: '1.0.0',
      purpose: teamProfile.goal,
      concurrencyCapacity: 2,
      memberCount: 1,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        profile: teamProfile,
        questions: [],
        readyForRecommendation: true,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(plan), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(plan), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ teamVersion }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        projectId: 'project-recommended',
        teamVersion,
      }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const request = {
      requirement: 'Build two pages',
      profile: teamProfile,
      answers: [],
      adjustments: [] as string[],
    }

    await expect(api.structureTeamRequirement({
      requirement: request.requirement,
    })).resolves.toMatchObject({ readyForRecommendation: true })
    await expect(api.recommendTeam(request)).resolves.toEqual(plan)
    await expect(api.adjustTeamRecommendation({
      ...request,
      adjustments: ['reduce concurrency'],
    })).resolves.toEqual(plan)
    await expect(api.saveTeam({
      ...request,
      teamName: 'recommended-team',
    })).resolves.toEqual({ teamVersion })
    await expect(api.adoptTeam({
      ...request,
      projectName: 'recommended-project',
    })).resolves.toEqual({
      projectId: 'project-recommended',
      teamVersion,
    })
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/v1/team-recommendations/profile',
      '/api/v1/team-recommendations',
      '/api/v1/team-recommendations/adjust',
      '/api/v1/team-recommendations/save',
      '/api/v1/team-recommendations/adopt',
    ])
  })
})
