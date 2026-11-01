/** Future Cup platform service plugin: storage, REST API, and realtime events. */

import type { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import {
  defaultAgentProfiles,
  OrchestrationRepository,
  PersistentAgentRegistry,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import z from '@deepseek-ai/schemastery'
import { closeFutureCupResources } from './lifecycle.ts'
import { PostgresPlatformStore } from './postgres-store.ts'
import { FutureCupRunLauncher } from './run-launcher.ts'
import { createFutureCupServer } from './server.ts'
import type { ProjectRunLauncher } from './server-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    futureCupRunLauncher?: ProjectRunLauncher
  }
}

/** Plugin name loaded by Cordis. */
export const name = 'future-cup-platform'

/** The server has no required services; its runner is an optional service. */
export const inject = []

/** Explicit platform server and database configuration. */
export interface Config {
  /** Loopback address bound by the platform API. */
  readonly host: '127.0.0.1' | '::1'
  /** Platform API port; zero asks the operating system to allocate one. */
  readonly port: number
  /** Durable storage adapter selected for this profile. */
  readonly databaseDriver: 'sqlite' | 'postgres'
  /** PostgreSQL connection URL, required by the PostgreSQL adapter. */
  readonly databaseUrl?: string | undefined
  /** SQLite database path, required by the SQLite adapter. */
  readonly sqlitePath?: string | undefined
  /** Delay between committed Outbox polls. */
  readonly outboxPollMs: number
  /** Maximum Outbox rows claimed by one poll. */
  readonly outboxBatchSize: number
  /** Expiry of one dispatcher's Outbox claim before redelivery is allowed. */
  readonly outboxClaimMs: number
  /** Private root containing generated workspaces, Agent homes, screenshots, and previews. */
  readonly workspaceRoot: string
  /** Root containing one isolated Harness home per Agent invocation. */
  readonly agentHomeRoot: string
  /** Optional built management UI directory. */
  readonly uiRoot?: string | undefined
  /** Optional DeepSeek provider route used by project Agents. */
  readonly runProvider?: string | undefined
  /** Optional model used by project Agents. */
  readonly runModel?: string | undefined
  /** Maximum output tokens for one project-Agent request. */
  readonly runMaxTokens: number
  /** Timeout for one project-Agent request. */
  readonly runRequestTimeoutMs: number
  /** Timeout for generated-project dependency installation and build. */
  readonly verificationBuildTimeoutMs: number
  /** Timeout for generated-project browser verification. */
  readonly verificationBrowserTimeoutMs: number
  /** Maximum automatic repair rounds. */
  readonly maxRepairRounds: number
  /** Timeout for one Repair Agent turn. */
  readonly repairTimeoutMs: number
  /** Maximum retries for one failed task assignment. */
  readonly maxAgentRetries: number
  /** Duration of one workflow lease. */
  readonly leaseDurationMs: number
  /** Lease heartbeat interval, which must be smaller than the lease duration. */
  readonly heartbeatIntervalMs: number
  /** Delay between terminal project-run settlement retries after transient database failures. */
  readonly settlementRetryMs: number
  /** Maximum bounded wait for cancel or close to observe settlement. */
  readonly settlementWaitMs: number
}

/** Schemastery schema for the platform plugin. */
export const Config = z.object({
  host: z.union(['127.0.0.1', '::1'] as const),
  port: z.number().min(0).max(65_535),
  databaseDriver: z.union(['sqlite', 'postgres'] as const),
  databaseUrl: z.union([z.string().min(1), z.const(undefined)]).default(undefined),
  sqlitePath: z.union([z.string().min(1), z.const(undefined)]).default(undefined),
  outboxPollMs: z.number().min(1),
  outboxBatchSize: z.number().min(1),
  outboxClaimMs: z.number().min(1),
  workspaceRoot: z.string().min(1),
  agentHomeRoot: z.string().min(1),
  uiRoot: z.union([z.string().min(1), z.const(undefined)]).default(undefined),
  runProvider: z.union([z.string().min(1), z.const(undefined)]).default(undefined),
  runModel: z.union([z.string().min(1), z.const(undefined)]).default(undefined),
  runMaxTokens: z.number().min(1),
  runRequestTimeoutMs: z.number().min(1),
  verificationBuildTimeoutMs: z.number().min(1),
  verificationBrowserTimeoutMs: z.number().min(1),
  maxRepairRounds: z.number().min(0),
  repairTimeoutMs: z.number().min(1),
  maxAgentRetries: z.number().min(0),
  leaseDurationMs: z.number().min(1),
  heartbeatIntervalMs: z.number().min(1),
  settlementRetryMs: z.number().min(1),
  settlementWaitMs: z.number().min(1),
})

/**
 * Start the Future Cup platform server for one profile lifetime.
 * @param ctx - plugin context that may provide a run launcher service.
 * @param config - explicit database and transport configuration.
 */
export function apply(ctx: Context, config: Config): void {
  void ctx.effect(async () => {
    const store = config.databaseDriver === 'postgres'
      ? createPostgresStore(config.databaseUrl)
      : new OrchestrationRepository(config.sqlitePath ?? ':memory:', { journalMode: 'wal' })
    const profiles = defaultAgentProfiles()
    const agentRegistry = new PersistentAgentRegistry(store)
    const defaultTeamVersionId = await agentRegistry.ensureDefaultTeam()
    let launcher: FutureCupRunLauncher | undefined
    let server: ReturnType<typeof createFutureCupServer> | undefined
    try {
      launcher = new FutureCupRunLauncher({
        store,
        workspaceRoot: config.workspaceRoot,
        agentHomeRoot: config.agentHomeRoot,
        profiles,
        harness: {
          ...config.runProvider === undefined ? {} : { provider: config.runProvider },
          ...config.runModel === undefined ? {} : { model: config.runModel },
          maxTokens: config.runMaxTokens,
          requestTimeoutMs: config.runRequestTimeoutMs,
        },
        verification: {
          buildTimeoutMs: config.verificationBuildTimeoutMs,
          browserTimeoutMs: config.verificationBrowserTimeoutMs,
        },
        selfLoop: {
          maxRepairRounds: config.maxRepairRounds,
          repairTimeoutMs: config.repairTimeoutMs,
        },
        maxAgentRetries: config.maxAgentRetries,
        leaseDurationMs: config.leaseDurationMs,
        heartbeatIntervalMs: config.heartbeatIntervalMs,
        settlementRetryMs: config.settlementRetryMs,
        settlementWaitMs: config.settlementWaitMs,
        onError: (error) => { ctx.logger.error(error) },
      })
      ctx.provide('futureCupRunLauncher', launcher)
      server = createFutureCupServer({
        store,
        profiles,
        agentRegistry,
        defaultTeamVersionId,
        host: config.host,
        port: config.port,
        outboxPollMs: config.outboxPollMs,
        outboxBatchSize: config.outboxBatchSize,
        outboxClaimMs: config.outboxClaimMs,
        runRoot: config.workspaceRoot,
        uiRoot: config.uiRoot ?? fileURLToPath(new URL('../lib/web', import.meta.url)),
        getLauncher: () => launcher,
        onError: (error) => { ctx.logger.error(error) },
      })
      const address = await server.start()
      ctx.logger.info(
        `future-cup-platform listening on http://${address.host}:${address.port}`,
      )
    } catch (error: unknown) {
      await closeFutureCupResources({ launcher, server, store }, error)
      throw error
    }
    return async () => {
      await closeFutureCupResources({ launcher, server })
    }
  }, 'future-cup-platform.listen')
}

function createPostgresStore(databaseUrl: string | undefined): PostgresPlatformStore {
  if (databaseUrl === undefined) {
    throw new Error('Future Cup postgres driver requires databaseUrl')
  }
  return new PostgresPlatformStore(databaseUrl)
}
