/** Public types for the Future Cup Fastify and Socket.IO server. */

import type {
  AgentProfile,
  FaultDrillMode,
  FaultInjectionResult,
  PlatformProjectSummary,
  PlatformStore,
  PersistentAgentRegistry,
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
  /**
   * Start one self-healing drill execution over an existing project run workspace.
   * @param project - durable project summary.
   * @param mode - selected fault drill mode.
   * @returns a stable run identity and fault injection details.
   */
  startDrill?(
    project: PlatformProjectSummary,
    mode: FaultDrillMode,
  ): Promise<{ runId: string; injectedFault?: FaultInjectionResult | undefined }>
}

/** Explicit Fastify and realtime server configuration. */
export interface FutureCupServerOptions {
  readonly store: PlatformStore
  readonly profiles: readonly AgentProfile[]
  readonly agentRegistry?: PersistentAgentRegistry | undefined
  /** Stable user identity used to scope Team ownership in this profile. */
  readonly currentUserId?: string | undefined
  readonly defaultTeamVersionId?: string | undefined
  readonly host: string
  readonly port: number
  readonly outboxPollMs: number
  readonly outboxBatchSize: number
  readonly outboxClaimMs: number
  readonly runRoot: string
  readonly uiRoot?: string | undefined
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
