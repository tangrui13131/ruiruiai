import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AgentView } from '../src/api/contracts.ts'
import { useProjectAgents } from '../src/hooks/useProjectAgents.ts'
import { agent } from './fixtures.ts'

interface PendingLoad {
  readonly projectId: string
  resolve(agents: AgentView[]): void
  reject(error: unknown): void
}

function deferredLoader() {
  const pending: PendingLoad[] = []
  const load = vi.fn((projectId: string) => new Promise<AgentView[]>((resolve, reject) => {
    pending.push({ projectId, resolve, reject })
  }))
  return { load, pending }
}

describe('useProjectAgents', () => {
  it('reloads for a new event cursor and ignores stale project or cursor responses', async () => {
    const { load, pending } = deferredLoader()
    const { result, rerender } = renderHook(
      ({ projectId, lastEventSeq }) => useProjectAgents(projectId, lastEventSeq, load),
      { initialProps: { projectId: 'project-a', lastEventSeq: 1 } },
    )
    expect(result.current.loading).toBe(true)
    expect(pending.map(value => value.projectId)).toEqual(['project-a'])

    rerender({ projectId: 'project-a', lastEventSeq: 2 })
    expect(pending.map(value => value.projectId)).toEqual(['project-a', 'project-a'])
    await act(async () => {
      pending[1]?.resolve([agent('cursor-two', 1)])
    })
    expect(result.current.agents.map(value => value.id)).toEqual(['cursor-two'])

    await act(async () => {
      pending[0]?.resolve([agent('cursor-one')])
    })
    expect(result.current.agents.map(value => value.id)).toEqual(['cursor-two'])

    rerender({ projectId: 'project-b', lastEventSeq: 2 })
    expect(result.current.agents).toEqual([])
    expect(result.current.loading).toBe(true)
    await act(async () => {
      pending[2]?.resolve([agent('project-b-agent')])
    })
    expect(result.current.agents.map(value => value.id)).toEqual(['project-b-agent'])
  })

  it('keeps the error and retry behavior', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('backend detail'))
      .mockResolvedValueOnce([agent('frontend-a')])
    const { result } = renderHook(() => useProjectAgents('project-a', 1, load))

    await waitFor(() => { expect(result.current.loading).toBe(false) })
    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.agents).toEqual([])

    act(() => { result.current.retry() })
    await waitFor(() => {
      expect(result.current.agents.map(value => value.id)).toEqual(['frontend-a'])
    })
    expect(result.current.error).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
