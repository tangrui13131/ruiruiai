/** Future Cup platform service plugin: storage, REST API, and realtime events. */

import type { Context } from '@deepseek-ai/cordis'
import {
  defaultAgentProfiles,
  OrchestrationRepository,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'
import z from '@deepseek-ai/schemastery'
import { PostgresPlatformStore } from './postgres-store.ts'
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
    let server: ReturnType<typeof createFutureCupServer> | undefined
    try {
      server = createFutureCupServer({
        store,
        profiles: defaultAgentProfiles(),
        host: config.host,
        port: config.port,
        outboxPollMs: config.outboxPollMs,
        outboxBatchSize: config.outboxBatchSize,
        outboxClaimMs: config.outboxClaimMs,
        getLauncher: () => ctx.get('futureCupRunLauncher'),
        onError: (error) => { ctx.logger.error(error) },
      })
      const address = await server.start()
      ctx.logger.info(
        `future-cup-platform listening on http://${address.host}:${address.port}`,
      )
    } catch (error: unknown) {
      await server?.close()
      if (server === undefined) await store.close()
      throw error
    }
    return async () => {
      await server.close()
    }
  }, 'future-cup-platform.listen')
}

function createPostgresStore(databaseUrl: string | undefined): PostgresPlatformStore {
  if (databaseUrl === undefined) {
    throw new Error('Future Cup postgres driver requires databaseUrl')
  }
  return new PostgresPlatformStore(databaseUrl)
}
