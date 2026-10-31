import { beforeEach, describe, expect, it, vi } from 'vitest'

interface MockSocket {
  auth?: { readonly projectId: string; readonly afterSeq: number }
  readonly on: ReturnType<typeof vi.fn>
  readonly disconnect: ReturnType<typeof vi.fn>
  readonly io: {
    readonly reconnection: ReturnType<typeof vi.fn>
  }
}

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (value?: unknown) => void>()
  const socket: MockSocket = {
    auth: undefined,
    on: vi.fn((event: string, handler: (value?: unknown) => void) => {
      handlers.set(event, handler)
    }),
    disconnect: vi.fn(),
    io: {
      reconnection: vi.fn(),
    },
  }
  return {
    handlers,
    socket,
    io: vi.fn(() => socket),
  }
})

vi.mock('socket.io-client', () => ({ io: mocks.io }))

import { connectProjectSocket } from '../src/realtime/project-socket.ts'

describe('project Socket.IO connection', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.io.mockClear()
    mocks.socket.on.mockClear()
    mocks.socket.disconnect.mockClear()
    mocks.socket.io.reconnection.mockClear()
  })

  it('stops automatic reconnect after a terminal sync error', () => {
    const statuses: string[] = []
    const errors: string[] = []
    connectProjectSocket('project-1', 0, {
      onSnapshot: () => {},
      onEvent: () => {},
      onStatus: status => statuses.push(status),
      onError: code => errors.push(code),
    })

    mocks.handlers.get('sync.error')?.({ code: 'PROJECT_NOT_FOUND', message: 'missing' })
    mocks.handlers.get('disconnect')?.('transport close')

    expect(mocks.socket.io.reconnection).toHaveBeenCalledWith(false)
    expect(mocks.socket.disconnect).toHaveBeenCalledOnce()
    expect(statuses).toEqual(['connecting', 'disconnected'])
    expect(errors).toEqual(['PROJECT_NOT_FOUND'])
  })
})
