import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../src/api/client.ts'
import type { ProductEventView } from '../src/api/contracts.ts'
import type { RealtimeCallbacks } from '../src/realtime/project-socket.ts'
import { ProjectStore, mergeEvents } from '../src/state/project-store.ts'
import { snapshot } from './fixtures.ts'

function event(seq: number): ProductEventView {
  return {
    type: 'task.created',
    projectId: 'project-test',
    seq,
    taskId: 'dashboard',
    payload: { seq },
    occurredAt: '2026-10-31T10:00:01.000Z',
  }
}

async function waitForRefresh(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 10))
}

describe('ProjectStore', () => {
  it('loads the authoritative snapshot and deduplicates replayed events', async () => {
    let callbacks: RealtimeCallbacks | undefined
    let disposed = false
    const store = new ProjectStore('project-test', {
      loadSnapshot: async () => snapshot(),
      connectRealtime: (_projectId, _afterSeq, value) => {
        callbacks = value
        return () => { disposed = true }
      },
      refreshDelayMs: 1,
    })

    await store.start()
    expect(store.getSnapshot()).toMatchObject({ phase: 'ready', connection: 'disconnected' })
    callbacks?.onStatus('connected')
    callbacks?.onEvent(event(1))
    callbacks?.onEvent(event(1))
    callbacks?.onEvent(event(2))
    await waitForRefresh()

    expect(store.getSnapshot().connection).toBe('connected')
    expect(store.getSnapshot().events.map(value => value.seq)).toEqual([1, 2])
    store.destroy()
    expect(disposed).toBe(true)
  })

  it('merges snapshots and events by sequence rather than arrival order', () => {
    expect(mergeEvents([event(2), event(1)], [event(2), event(3)]).map(value => value.seq))
      .toEqual([1, 2, 3])
  })

  it('retains a stable error code instead of a backend message', async () => {
    const store = new ProjectStore('project-test', {
      loadSnapshot: async () => {
        throw new ApiRequestError(404, 'PROJECT_NOT_FOUND', 'backend English message')
      },
      connectRealtime: () => () => {},
    })
    await store.start()
    expect(store.getSnapshot()).toMatchObject({
      phase: 'error',
      errorCode: 'PROJECT_NOT_FOUND',
    })
    expect(JSON.stringify(store.getSnapshot())).not.toContain('backend English message')
  })
})
