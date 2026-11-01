import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/api/client.ts'
import { agent } from './fixtures.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('project Agent API', () => {
  it('loads project-scoped Agent metrics from the encoded project route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      agent('frontend-a', 1, 0.5),
    ]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.listProjectAgents('project / one')).resolves.toEqual([
      expect.objectContaining({ id: 'frontend-a', currentLoad: 1, available: false }),
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
})
