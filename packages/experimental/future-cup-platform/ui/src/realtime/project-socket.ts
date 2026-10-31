import { io } from 'socket.io-client'
import { productEventSchema, projectSnapshotSchema } from '../api/contracts.ts'
import type { ProductEventView, ProjectSnapshotView } from '../api/contracts.ts'

export type RealtimeStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface RealtimeCallbacks {
  onSnapshot(snapshot: ProjectSnapshotView): void
  onEvent(event: ProductEventView): void
  onStatus(status: RealtimeStatus): void
  onError(code: string): void
}

/**
 * Connect one project room and validate every payload before it enters UI state.
 * @param projectId - durable project identity.
 * @param afterSeq - last applied project event sequence.
 * @param callbacks - validated snapshot, event, status, and error receivers.
 * @returns an idempotent connection disposer.
 */
export function connectProjectSocket(
  projectId: string,
  afterSeq: number,
  callbacks: RealtimeCallbacks,
): () => void {
  const socket = io(window.location.origin, {
    path: '/future-cup/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
    auth: { projectId, afterSeq },
  })
  let disposed = false
  let terminalError = false
  let currentSeq = afterSeq
  callbacks.onStatus('connecting')

  socket.on('connect', () => {
    if (!disposed) callbacks.onStatus('connected')
  })
  socket.on('disconnect', () => {
    if (!disposed && !terminalError) callbacks.onStatus('reconnecting')
  })
  socket.on('connect_error', () => {
    if (!disposed) callbacks.onError('REALTIME_CONNECTION_FAILED')
  })
  socket.on('sync.snapshot', (value: unknown) => {
    const parsed = projectSnapshotSchema.safeParse(value)
    if (parsed.success) {
      currentSeq = Math.max(currentSeq, parsed.data.lastEventSeq)
      socket.auth = { projectId, afterSeq: currentSeq }
      callbacks.onSnapshot(parsed.data)
    }
    else callbacks.onError('INVALID_REALTIME_DATA')
  })
  socket.on('project.event', (value: unknown) => {
    const parsed = productEventSchema.safeParse(value)
    if (parsed.success) {
      currentSeq = Math.max(currentSeq, parsed.data.seq)
      socket.auth = { projectId, afterSeq: currentSeq }
      callbacks.onEvent(parsed.data)
    }
    else callbacks.onError('INVALID_REALTIME_DATA')
  })
  socket.on('sync.error', (value: unknown) => {
    terminalError = true
    socket.io.reconnection(false)
    socket.disconnect()
    callbacks.onStatus('disconnected')
    if (
      typeof value === 'object'
      && value !== null
      && 'code' in value
      && typeof value.code === 'string'
    ) callbacks.onError(value.code)
    else callbacks.onError('SNAPSHOT_FAILED')
  })

  return () => {
    disposed = true
    socket.disconnect()
  }
}
