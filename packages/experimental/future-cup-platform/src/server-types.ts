/** Public types for the Future Cup Fastify and Socket.IO server. */

import type {
  AgentProfile,
  PlatformProjectSummary,
  PlatformStore,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'

/** Starts or cancels one project run, owned by a later orchestration plugin. */
export interface ProjectRunLauncher {
  /**
   * Start one project run.
   * @param project - durable project summary.
   * @returns a stable run identity.
   */
  start(project: PlatformProjectSummary): Promise<{ runId: string }>
  /**
   * Request cancellation of one project run.
   * @param projectId - project identity.
   * @returns whether a run was cancelled.
   */
  cancel(projectId: string): Promise<boolean>
}

/** Explicit Fastify and realtime server configuration. */
export interface FutureCupServerOptions {
  readonly store: PlatformStore
  readonly profiles: readonly AgentProfile[]
  readonly host: string
  readonly port: number
  readonly outboxPollMs: number
  readonly outboxBatchSize: number
  readonly outboxClaimMs: number
  readonly getLauncher?: (() => ProjectRunLauncher | undefined) | undefined
  readonly onError?: ((error: unknown) => void) | undefined
}

/** One running Future Cup API server. */
export interface FutureCupServer {
  /** Bind the configured address and start Outbox delivery. */
  start(): Promise<{ readonly host: string; readonly port: number }>
  /** Stop timers, Socket.IO connections, Fastify, and the owned store. */
  close(): Promise<void>
}
