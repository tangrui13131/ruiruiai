---
description: "Future Cup platform API, realtime event delivery, and Prisma PostgreSQL persistence."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-future-cup-platform

English | [中文](README.zh.md)

## Summary

Run the Future Cup platform data plane as a `dsh` plugin: a shared orchestration repository for SQLite and PostgreSQL, transactional project events with an Outbox, workflow leases, Fastify REST snapshots, and Socket.IO replay.

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

The bundle reads `FUTURE_CUP_PORT`, `FUTURE_CUP_DATABASE_URL`, and `FUTURE_CUP_SQLITE_PATH`. PostgreSQL is the configured production adapter. SQLite remains available for deterministic local runs and tests.

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
| `POST` | `/api/v1/projects/:projectId/runs` | start through a mounted project run launcher |
| `POST` | `/api/v1/projects/:projectId/cancel` | cancel through a mounted project run launcher |

The run routes return `503 RUN_LAUNCHER_UNAVAILABLE` when the profile does not mount `ctx.futureCupRunLauncher`.

### Realtime replay

Connect Socket.IO with path `/future-cup/socket.io` and authentication `{ projectId, afterSeq }`. The server joins the project room, loads `sync.snapshot`, and then emits committed `project.event` values only from unpublished Outbox rows.

Every event carries `projectId`, positive project-scoped `seq`, `occurredAt`, `type`, and a JSON payload. Clients deduplicate by `projectId + seq` and reconnect with their last applied sequence.

## Understand the implementation

| File | Role |
|---|---|
| `src/index.ts` | Cordis plugin, explicit configuration, store selection, and lifecycle |
| `src/server.ts` | Fastify routes, Socket.IO replay, Outbox polling, and shutdown |
| `src/postgres-store.ts` | Prisma PostgreSQL adapter for the shared orchestration store |
| `prisma/schema.prisma` | PostgreSQL tables, indexes, foreign keys, and JSONB fields |
| `prisma/migrations/` | Checked-in PostgreSQL migration |

SQLite and PostgreSQL implement the same `OrchestrationStore` operations. Task updates require the previous revision, so a stale writer cannot overwrite newer DAG state. Project events and their Outbox obligations commit in one serializable transaction. Dispatchers claim Outbox rows with an expiring owner token; PostgreSQL uses `FOR UPDATE SKIP LOCKED`.

Workflow leases store an owner, heartbeat, expiry, and monotonic fencing token. A lease takeover increments the token, and heartbeat or release succeeds only for the current owner and token.

## Model Experience

### Platform data plane

#### What the model sees

None. The public `OrchestrationStore` contract registers no prompt section, tool schema, Session record, or model request field. Agent packages own their model-facing inputs.

#### Token effect

Zero direct token effect.

#### KV Cache effect

The package does not invalidate a reusable request prefix. Model adapters and prompt-owning packages determine cache reuse.

## Known Limitations and Deferred Work

- **Run launcher is a service boundary:** the REST server starts or cancels only when `ctx.futureCupRunLauncher` is mounted. The management profile will provide the real team runtime in M4.2.
- **Loopback transport:** the server rejects non-loopback hosts. Authenticated public deployment and TLS termination remain deployment work.
- **Single store lifecycle:** closing the server closes its owned store. Consumers must not share that instance after shutdown.
- **Outbox at-least-once delivery:** a crashed dispatcher can cause replay after its claim expires. Client deduplication by `projectId + seq` is required.
- **No artifact hosting route:** screenshot and generated-project static serving belongs to the management application and delivery integration.

<a id="dev-note"></a>
### Dev Note

The PostgreSQL client is generated into ignored `src/generated/` during package installation. Run `prisma generate` after schema edits and `prisma migrate deploy` against a reachable PostgreSQL database before starting the bundle.
