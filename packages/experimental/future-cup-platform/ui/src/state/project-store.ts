import { api } from '../api/client.ts'
import { apiErrorCode } from '../api/errors.ts'
import { connectProjectSocket } from '../realtime/project-socket.ts'
import type { RealtimeStatus } from '../realtime/project-socket.ts'
import type { ProductEventView, ProjectSnapshotView } from '../api/contracts.ts'

export type ProjectLoadPhase = 'idle' | 'loading' | 'ready' | 'error'

export interface ProjectStoreState {
  readonly projectId: string
  readonly phase: ProjectLoadPhase
  readonly connection: RealtimeStatus
  readonly snapshot?: ProjectSnapshotView
  readonly events: readonly ProductEventView[]
  readonly errorCode?: string
}

export interface ProjectStoreDependencies {
  loadSnapshot(projectId: string, afterSeq: number): Promise<ProjectSnapshotView>
  connectRealtime(
    projectId: string,
    afterSeq: number,
    callbacks: Parameters<typeof connectProjectSocket>[2],
  ): () => void
  readonly refreshDelayMs?: number
}

const defaultDependencies: ProjectStoreDependencies = {
  loadSnapshot: async (projectId, afterSeq) => await api.getSnapshot(projectId, afterSeq),
  connectRealtime: connectProjectSocket,
  refreshDelayMs: 120,
}

/** Own one project's authoritative snapshot, ordered event stream, and realtime status. */
export class ProjectStore {
  private readonly listeners = new Set<() => void>()
  private readonly dependencies: ProjectStoreDependencies
  private state: ProjectStoreState
  private disposeRealtime?: () => void
  private refreshTimer?: ReturnType<typeof setTimeout>
  private destroyed = false
  private generation = 0

  constructor(
    readonly projectId: string,
    dependencies: Partial<ProjectStoreDependencies> = {},
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies }
    this.state = {
      projectId,
      phase: 'idle',
      connection: 'disconnected',
      events: [],
    }
  }

  /** Subscribe to immutable store snapshots. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Read the current immutable store snapshot. */
  getSnapshot = (): ProjectStoreState => this.state

  /** Load the REST snapshot, then connect Socket.IO from its last event cursor. */
  async start(): Promise<void> {
    if (this.destroyed) return
    const generation = ++this.generation
    this.update({ phase: 'loading', errorCode: undefined })
    try {
      const snapshot = await this.dependencies.loadSnapshot(this.projectId, 0)
      if (this.destroyed || generation !== this.generation) return
      this.applySnapshot(snapshot)
      this.update({ phase: 'ready' })
      this.disposeRealtime = this.dependencies.connectRealtime(
        this.projectId,
        this.currentSequence(),
        {
          onSnapshot: (next) => {
            if (generation === this.generation) this.applySnapshot(next)
          },
          onEvent: (event) => {
            if (generation === this.generation) this.applyEvent(event)
          },
          onStatus: (connection) => {
            if (generation === this.generation) this.update({ connection })
          },
          onError: (errorCode) => {
            if (generation === this.generation) this.update({ errorCode })
          },
        },
      )
    } catch (error: unknown) {
      if (this.destroyed || generation !== this.generation) return
      this.update({
        phase: 'error',
        connection: 'disconnected',
        errorCode: apiErrorCode(error),
      })
    }
  }

  /** Fetch a fresh authoritative snapshot without dropping the visible project state. */
  async refresh(): Promise<void> {
    if (this.destroyed) return
    const generation = this.generation
    try {
      const snapshot = await this.dependencies.loadSnapshot(this.projectId, 0)
      if (!this.destroyed && generation === this.generation) this.applySnapshot(snapshot)
    } catch (error: unknown) {
      if (this.destroyed || generation !== this.generation) return
      this.update({ errorCode: apiErrorCode(error) })
    }
  }

  /** Disconnect realtime work while keeping the store restartable. */
  stop(): void {
    this.generation += 1
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = undefined
    }
    this.disposeRealtime?.()
    this.disposeRealtime = undefined
  }

  /** Dispose the socket and any scheduled snapshot correction. */
  destroy(): void {
    if (this.destroyed) return
    this.stop()
    this.destroyed = true
    this.listeners.clear()
  }

  private applySnapshot(snapshot: ProjectSnapshotView): void {
    const merged = mergeEvents(this.state.events, snapshot.events)
    this.update({
      snapshot: { ...snapshot, events: merged },
      events: merged,
      phase: 'ready',
      errorCode: undefined,
    })
  }

  private applyEvent(event: ProductEventView): void {
    if (event.projectId !== this.projectId || event.seq <= this.currentSequence()) return
    const events = mergeEvents(this.state.events, [event])
    const snapshot = this.state.snapshot
    this.update({
      events,
      snapshot: snapshot === undefined
        ? undefined
        : { ...snapshot, events, lastEventSeq: Math.max(snapshot.lastEventSeq, event.seq) },
    })
    this.scheduleRefresh()
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refresh()
    }, this.dependencies.refreshDelayMs ?? 120)
  }

  private currentSequence(): number {
    return this.state.events.at(-1)?.seq ?? this.state.snapshot?.lastEventSeq ?? 0
  }

  private update(changes: Partial<ProjectStoreState>): void {
    this.state = { ...this.state, ...changes }
    for (const listener of this.listeners) listener()
  }
}

/** Merge project events by sequence and keep deterministic order. */
export function mergeEvents(
  current: readonly ProductEventView[],
  incoming: readonly ProductEventView[],
): ProductEventView[] {
  const bySequence = new Map<number, ProductEventView>()
  for (const event of [...current, ...incoming]) bySequence.set(event.seq, event)
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq)
}
