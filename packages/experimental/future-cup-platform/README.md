---
description: "Future Cup management application, real Harness team launcher, realtime events, and Prisma PostgreSQL persistence."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-future-cup-platform

English | [中文](README.zh.md)

## Summary

Run the Future Cup management platform as a `dsh` plugin: a shared orchestration repository for SQLite and PostgreSQL, a real Harness team launcher, transactional project events with an Outbox, Fastify REST snapshots, Socket.IO replay, and a same-origin React management application.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the bundle in a named `dsh` profile. The profile owns the Fastify and Socket.IO lifecycle; the package does not add a standalone executable.

The bundle reads `FUTURE_CUP_PORT`, `FUTURE_CUP_DATABASE_URL`, `FUTURE_CUP_SQLITE_PATH`, `FUTURE_CUP_RUN_ROOT`, `FUTURE_CUP_AGENT_HOME_ROOT`, `FUTURE_CUP_PROVIDER`, and `FUTURE_CUP_MODEL`. PostgreSQL is the configured production adapter. SQLite remains available for deterministic local runs and tests.

```yaml
- id: future-cup-platform
  name: '@deepseek-ai/dsh-experimental-future-cup-platform'
  config:
    host: 127.0.0.1
    port: 3090
    databaseDriver: postgres
    databaseUrl: !!js process.env.FUTURE_CUP_DATABASE_URL
    outboxPollMs: 100
    outboxBatchSize: 100
    outboxClaimMs: 30000
    workspaceRoot: .artifacts/future-cup-runs
    agentHomeRoot: .artifacts/future-cup-agent-homes
    runMaxTokens: 32000
    runRequestTimeoutMs: 600000
    verificationBuildTimeoutMs: 600000
    verificationBrowserTimeoutMs: 60000
    maxRepairRounds: 3
    repairTimeoutMs: 600000
    maxAgentRetries: 1
    leaseDurationMs: 60000
    heartbeatIntervalMs: 15000
    settlementRetryMs: 1000
    settlementWaitMs: 30000
```

Apply the checked-in PostgreSQL migration before starting the profile:

```sh
pnpm --filter @deepseek-ai/dsh-experimental-future-cup-platform exec prisma migrate deploy
```

### REST API

The server binds only to a loopback host. Its current routes are:

| Method | Route | Result |
|---|---|---|
| `GET` | `/api/v1/health` | server status and project count |
| `GET` | `/api/v1/projects` | project summaries and event cursors |
| `POST` | `/api/v1/projects` | create a project from a name and requirement |
| `GET` | `/api/v1/projects/:projectId/agents` | project-scoped Agent capacity, live load, and observed success rates |
| `GET` | `/api/v1/projects/:projectId/snapshot` | current project state plus events after `afterSeq` |
| `GET` | `/api/v1/projects/:projectId/events` | ordered project events after `afterSeq` |
| `GET` | `/api/v1/projects/:projectId/tasks` | ordered task snapshots |
| `GET` | `/api/v1/projects/:projectId/tasks/:taskId` | one task snapshot |
| `GET` | `/api/v1/projects/:projectId/scheduler-decisions` | explainable scheduling decisions |
| `GET` | `/api/v1/projects/:projectId/executions` | Agent execution records |
| `GET` | `/api/v1/projects/:projectId/executions/:executionId/events` | ordered execution events |
| `GET` | `/api/v1/projects/:projectId/verification-reports` | independent verification reports |
| `GET` | `/api/v1/projects/:projectId/repairs` | repair rounds and unified diffs |
| `GET` | `/api/v1/projects/:projectId/workflow` | current workflow disposition |
| `GET` | `/api/v1/projects/:projectId/runs` | project run history |
| `GET` | `/api/v1/runs/:runId` | one public project run |
| `POST` | `/api/v1/projects/:projectId/runs` | start a real Harness team run |
| `POST` | `/api/v1/projects/:projectId/cancel` | close the active Harness team and cancel its run |
| `GET` | `/api/v1/projects/:projectId/delivery` | public delivery summary and screenshot addresses |
| `GET` | `/api/v1/projects/:projectId/screenshots/:fileName` | one recorded verification screenshot |
| `GET` | `/preview/:projectId/*` | generated production build preview |

The mounted profile starts the management SPA at `/`. REST and Socket.IO remain under their dedicated paths on the same origin.

### Realtime replay

Connect Socket.IO with path `/future-cup/socket.io` and authentication `{ projectId, afterSeq }`. The server joins the project room, loads `sync.snapshot`, and then emits committed `project.event` values only from unpublished Outbox rows.

Every event carries `projectId`, positive project-scoped `seq`, `occurredAt`, `type`, and a JSON payload. Clients deduplicate by `projectId + seq` and reconnect with their last applied sequence.

## Understand the implementation

| File | Role |
|---|---|
| `src/index.ts` | Cordis plugin, explicit configuration, store selection, and lifecycle |
| `src/server.ts` | Fastify routes, Socket.IO replay, Outbox polling, and shutdown |
| `src/run-launcher.ts` | Real Harness team launch, lease heartbeat, cancellation, and run settlement |
| `src/artifact-server.ts` | Management assets, screenshots, delivery, and generated-project preview |
| `src/postgres-store.ts` | Prisma PostgreSQL adapter for the shared orchestration store |
| `prisma/schema.prisma` | PostgreSQL tables, indexes, foreign keys, and JSONB fields |
| `prisma/migrations/` | Checked-in PostgreSQL migration |

SQLite and PostgreSQL implement the same `OrchestrationStore` operations. Task updates require the previous revision, so a stale writer cannot overwrite newer DAG state. Project events and their Outbox obligations commit in one serializable transaction. Dispatchers claim Outbox rows with an expiring owner token; PostgreSQL uses `FOR UPDATE SKIP LOCKED`.

Workflow leases store an owner, heartbeat, expiry, and monotonic fencing token. A lease takeover increments the token, and heartbeat or release succeeds only for the current owner and token. Domain writes carry that fence into their transaction. A new launch reconciles a stale `RUNNING` row after taking over an expired lease.

Project-scoped Agent state derives live load from `RUNNING` executions and overlays persisted success rates from completed executions. The management UI refreshes this projection whenever the authoritative snapshot cursor advances.

## Model Experience

### Platform data plane

#### What the model sees

None. The public `OrchestrationStore` contract registers no prompt section, tool schema, Session record, or model request field. Agent packages own their model-facing inputs.

#### Token effect

Zero direct token effect.

#### KV Cache effect

The package does not invalidate a reusable request prefix. Model adapters and prompt-owning packages determine cache reuse.

## Known Limitations and Deferred Work

- **No mid-turn cancellation:** the Harness TypeScript SDK has no prompt-cancel request. Cancel closes the run-owned runtime, waits for settlement, and records `CANCELLED`.
- **One generation per project:** the current MVP keeps one task set per project. Create a new project to generate again after a terminal run.
- **Loopback transport:** the server rejects non-loopback hosts. Authenticated public deployment and TLS termination remain deployment work.
- **Single store lifecycle:** closing the server closes its owned store. Consumers must not share that instance after shutdown.
- **Outbox at-least-once delivery:** a crashed dispatcher can cause replay after its claim expires. Client deduplication by `projectId + seq` is required.
- **Settlement recovery:** transient database failures keep the workflow lease alive while terminal settlement retries. A permanent failure or bounded shutdown timeout leaves the durable run `RUNNING` for stale-run reconciliation on the next launch; cancel and close report `PROJECT_RUN_SETTLEMENT_PENDING` or `PROJECT_RUN_SETTLEMENT_TIMEOUT` instead of claiming success.
- **Large Ant Design bundle:** the management application currently emits a roughly 1 MB Ant Design chunk. Route-level pages are lazy, but component-level Ant Design splitting remains performance work.

<a id="dev-note"></a>
### Dev Note

The PostgreSQL client is generated into ignored `src/generated/` during package installation. Run `prisma generate` after schema edits and `prisma migrate deploy` against a reachable PostgreSQL database before starting the bundle.
