---
description: "Future Cup management application, real Harness team launcher, realtime events, and Prisma PostgreSQL persistence."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-future-cup-platform

English | [中文](README.zh.md)

## Summary

Run the Future Cup management platform as a `dsh` plugin: a shared orchestration repository for SQLite and PostgreSQL, a versioned Agent Registry, frozen project teams, recoverable workflow control, explainable adaptive repair strategies, novice team recommendation, a real Harness team launcher, transactional project events with an Outbox, Fastify REST snapshots, Socket.IO replay, a same-origin React management application, and a read-only HQ 3D display.

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
| `GET` | `/api/v1/agent-definitions` | Agent definitions, versions, and version states |
| `POST` | `/api/v1/agent-definitions` | register a DRAFT Agent definition |
| `POST` | `/api/v1/agent-definitions/:definitionId/versions` | register an immutable Agent version |
| `POST` | `/api/v1/agent-definitions/:definitionId/versions/:versionId/validate` | validate an Agent version |
| `POST` | `/api/v1/agent-definitions/:definitionId/versions/:versionId/publish` | publish an Agent version |
| `POST` | `/api/v1/agent-definitions/:definitionId/deprecate` | deprecate an Agent definition |
| `POST` | `/api/v1/agent-definitions/discover` | discover published versions by capability, role, and tag |
| `GET` | `/api/v1/agent-teams` | list team versions |
| `POST` | `/api/v1/agent-teams` | validate and create an immutable team version |
| `GET` | `/api/v1/teams` | paginate the current user's logical Teams |
| `POST` | `/api/v1/teams` | create a user-owned logical Team |
| `GET` | `/api/v1/teams/:teamId` | read one Team summary |
| `GET` | `/api/v1/teams/:teamId/versions` | list immutable Team versions |
| `POST` | `/api/v1/teams/:teamId/versions` | create an editable Team draft |
| `POST` | `/api/v1/teams/:teamId/versions/:versionId/publish` | validate and publish a Team draft |
| `POST` | `/api/v1/teams/:teamId/clone` | clone a published Team into a new draft |
| `POST` | `/api/v1/teams/:teamId/archive` | archive a logical Team |
| `GET` | `/api/v1/teams/:teamId/usage` | list projects frozen to a Team |
| `GET` | `/api/v1/projects/:projectId/agents` | project-scoped Agent capacity, live load, terminal execution counts, and observed success rates |
| `GET` | `/api/v1/projects/:projectId/team` | complete frozen team snapshot for one project |
| `POST` | `/api/v1/projects/:projectId/team-binding` | freeze a team version for an unbound project |
| `GET` | `/api/v1/projects/:projectId/snapshot` | current project state plus events after `afterSeq` |
| `GET` | `/api/v1/projects/:projectId/events` | ordered project events after `afterSeq` |
| `GET` | `/api/v1/projects/:projectId/tasks` | ordered task snapshots |
| `GET` | `/api/v1/projects/:projectId/tasks/:taskId` | one task snapshot |
| `GET` | `/api/v1/projects/:projectId/scheduler-decisions` | explainable scheduling decisions |
| `GET` | `/api/v1/projects/:projectId/executions` | Agent execution records |
| `GET` | `/api/v1/projects/:projectId/executions/:executionId/events` | ordered execution events |
| `GET` | `/api/v1/projects/:projectId/verification-reports` | independent verification reports |
| `GET` | `/api/v1/projects/:projectId/repairs` | repair rounds and unified diffs |
| `GET` | `/api/v1/projects/:projectId/repair-strategies` | adaptive repair candidates, reasons, and outcomes |
| `GET` | `/api/v1/projects/:projectId/workflow` | current workflow disposition |
| `GET` | `/api/v1/projects/:projectId/workflow-control` | conditional, loop, and subworkflow control snapshot |
| `GET` | `/api/v1/projects/:projectId/workflow-control/events` | workflow-control Journal |
| `GET` | `/api/v1/projects/:projectId/runs` | project run history |
| `GET` | `/api/v1/runs/:runId` | one public project run |
| `POST` | `/api/v1/projects/:projectId/runs` | start a real Harness team run |
| `POST` | `/api/v1/projects/:projectId/cancel` | close the active Harness team and cancel its run |
| `GET` | `/api/v1/projects/:projectId/delivery` | public delivery summary and screenshot addresses |
| `GET` | `/api/v1/projects/:projectId/screenshots/:fileName` | one recorded verification screenshot |
| `GET` | `/preview/:projectId/*` | generated production build preview |
| `GET` | `/hq/index.html?projectId=:projectId` | read-only HQ display projected from REST and Socket.IO |
| `POST` | `/api/v1/team-recommendations/profile` | structure a novice requirement into a profile and up to three questions |
| `POST` | `/api/v1/team-recommendations` | recommend a complete team from published Agents and templates |
| `POST` | `/api/v1/team-recommendations/adjust` | replay controlled natural-language team adjustments |
| `POST` | `/api/v1/team-recommendations/save` | save an immutable recommended team version |
| `POST` | `/api/v1/team-recommendations/adopt` | save a team and create a frozen project |

The mounted profile starts the management SPA at `/`. REST and Socket.IO remain under their dedicated paths on the same origin.

### Realtime replay

Connect Socket.IO with path `/future-cup/socket.io` and authentication `{ projectId, afterSeq }`. The server joins the project room, loads `sync.snapshot`, and then emits committed `project.event` values only from unpublished Outbox rows.

Every event carries `projectId`, positive project-scoped `seq`, `occurredAt`, `type`, and a JSON payload. Clients deduplicate by `projectId + seq` and reconnect with their last applied sequence.

The HQ display validates events against the shared discriminated union. It applies only committed events, detects sequence gaps, and reloads the authoritative REST snapshot before resuming. A separate action map drives department flights, Agent work pulses, verification alerts, repair round trips, and delivery animation; snapshot reloads and duplicate events do not replay animation. The page has no local project presets or task/personnel creation controls.

## Understand the implementation

| File | Role |
|---|---|
| `src/index.ts` | Cordis plugin, explicit configuration, store selection, and lifecycle |
| `src/server.ts` | Fastify routes, Socket.IO replay, Outbox polling, and shutdown |
| `src/run-launcher.ts` | Real Harness team launch, lease heartbeat, cancellation, and run settlement |
| `src/adaptive-repair.ts` | select controlled repair strategies with scored verification findings |
| `src/team-recommender.ts` | project profiles, clarification, complete-team recommendation, and controlled adjustments |
| `src/artifact-server.ts` | Management assets, screenshots, delivery, and generated-project preview |
| `src/postgres-store.ts` | Prisma PostgreSQL adapter for the shared orchestration store |
| `ui/src/hq/` | HQ state projection and REST/Socket.IO bridge |
| `ui/src/hq/animation.ts` | pure product-event to scene-action mapping |
| `ui/src/pages/TeamBuilderPage.tsx` | novice requirement, clarification, recommendation, adjustment, and adoption flow |
| `ui/src/pages/MyTeamsPage.tsx` | user-owned Team library and 1–7 runtime-member editor |
| `ui/public/hq/` | PolyForm-licensed 3D scene, license, and upstream notice |
| `prisma/schema.prisma` | PostgreSQL tables, indexes, foreign keys, and JSONB fields |
| `prisma/migrations/` | Checked-in PostgreSQL migration |

SQLite and PostgreSQL implement the same `OrchestrationStore` operations. Task updates require the previous revision, so a stale writer cannot overwrite newer DAG state. Project events and their Outbox obligations commit in one serializable transaction. Dispatchers claim Outbox rows with an expiring owner token; PostgreSQL uses `FOR UPDATE SKIP LOCKED`.

At startup, the platform replays persisted definitions, versions, teams, and project bindings into the fixed default Registry team. New projects commit a complete team snapshot and initial requirement memory in the same transaction, so later Registry publications cannot alter started projects. Project runs derive scheduler profiles from the frozen team, including model, prompt, capabilities, tool allowlist, memory policy, and output contracts.

`workflow_control_runs` stores the complete control snapshot, while `workflow_control_events` appends node, edge-selection, loop, and subworkflow events. Each snapshot carries a revision, and persistence rejects stale overwrites. PASS, Repair returning to verification, repeated failure, and infrastructure escalation all update this control state.

`repair_strategy_decisions` stores candidate strategies, score terms, selection reasons, context scope, and reverification scope before the Repair Agent edits source. Strategies may change prompts and read context only; verification remains the complete structure, build, and browser pipeline. A repeated failure signature first selects an unused strategy, then escalates when no alternative remains or the three-round bound is exhausted.

The novice team-builder entry recommends complete teams only from published Agent versions and published team templates, with deterministic checks for capability coverage, concurrency, tools, memory, and output contracts. Users answer at most three clarification questions, apply controlled natural-language adjustments, and save an immutable team version frozen to a new project.

The My Teams entry manages logical Teams independently of the recommendation flow. A Team version contains 1–7 runtime instances; duplicate published Agent versions count as separate members, and each instance owns a stable display name, department, and workstation position. Drafts can be empty, but publishing validates the same capability and policy rules used by recommendation. Project creation freezes the selected version, and the project Agent endpoint projects that frozen roster so the HQ scene displays the same member count and department assignments.

Workflow leases store an owner, heartbeat, expiry, and monotonic fencing token. A lease takeover increments the token, and heartbeat or release succeeds only for the current owner and token. Domain writes carry that fence into their transaction. A new launch reconciles a stale `RUNNING` row after taking over an expired lease.

Project-scoped Agent state derives live load from `RUNNING` executions. Historical success uses `COMPLETED` as success and includes `FAILED` and `CANCELLED` in the execution total. The API returns both counts, so the management UI distinguishes an observed rate from a profile default when an Agent has no historical executions.

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
- **Advanced Registry editor deferred:** the novice flow now covers recommendation, adjustment, saving, and adoption; arbitrary roles, arbitrary tools, and free-form team authoring remain post-M5.5 work.
- **Loopback transport:** the server rejects non-loopback hosts. Authenticated public deployment and TLS termination remain deployment work.
- **Single store lifecycle:** closing the server closes its owned store. Consumers must not share that instance after shutdown.
- **Outbox at-least-once delivery:** a crashed dispatcher can cause replay after its claim expires. Client deduplication by `projectId + seq` is required.
- **Settlement recovery:** transient database failures keep the workflow lease alive while terminal settlement retries. A permanent failure or bounded shutdown timeout leaves the durable run `RUNNING` for stale-run reconciliation on the next launch; cancel and close report `PROJECT_RUN_SETTLEMENT_PENDING` or `PROJECT_RUN_SETTLEMENT_TIMEOUT` instead of claiming success.
- **Large Ant Design bundle:** the management application currently emits a roughly 1 MB Ant Design chunk. Route-level pages are lazy, but component-level Ant Design splitting remains performance work.
- **Noncommercial HQ asset:** the HQ scene remains under PolyForm Noncommercial License 1.0.0. Every distribution must retain its license and Required Notice; commercial use requires separate authorization.

<a id="dev-note"></a>
### Dev Note

The PostgreSQL client is generated into ignored `src/generated/` during package installation. Run `prisma generate` after schema edits and `prisma migrate deploy` against a reachable PostgreSQL database before starting the bundle. The M5 `20261101160000`, `20261101173000`, `20261101200000`, and `20261102130000` migrations jointly create Registry, logical Team ownership, one-row-per-instance runtime members, project-memory, workflow-control, and adaptive-repair-strategy tables.

Run the key-gated M5.5 real Team acceptance with `pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/future-cup-platform/tests/real-team-library.e2e.ts`. It self-skips without `DEEPSEEK_API_KEY` and writes the run summary and screenshots under `.artifacts/future-cup-m55-live/real-team-*`.
