# Agent Note: Future Cup M4 realtime persistence gate

Status: proposed

English | [中文](2026-10-31-future-cup-m4-realtime-persistence-gate.zh.md)

## Problem

Future Cup M4 integrates PostgreSQL, Prisma, realtime events, a management application, and the HQ display around the verified M3 orchestration loop. These additions can create competing state owners: an API process can broadcast before a transaction commits, a stale worker can write after losing a lease, a client can render local guesses after reconnect, or HQ can continue presenting simulated activity as formal execution.

M4.0 must settle these risks before the product packages and UI are built.

## Proposal

Keep SQLite as the deterministic local adapter while introducing a domain-level persistence interface with a PostgreSQL/Prisma adapter. Persist canonical project events and their transactional outbox rows in the same transaction that advances project state. Assign `seq` from a locked project row so every project has a gap-free monotonic event stream.

Use `projectId + seq` as the client deduplication identity. REST snapshots return current state, current `lastEventSeq`, and the recent event window. Socket.IO reconnects request events after the client's last received sequence; UI state is projected from the snapshot plus ordered events rather than maintained as a second source of truth.

Use a workflow lease with owner, heartbeat, expiry, and monotonic fencing token. Every lease acquisition, renewal, release, and fenced write runs in a database transaction. A stale owner must be unable to mutate workflow or task state even if it resumes after expiry.

Launch the platform only through a named `dsh` profile. M4.1 adds a Future Cup bundle to the profile created from the Web template; Fastify, Socket.IO, PostgreSQL, and platform UI code remain plugin contributions rather than a separate Node entrypoint.

Keep the HQ source under PolyForm Noncommercial License 1.0.0, preserve its license and `Required Notice`, and treat its current local simulation as non-authoritative data. HQ becomes realtime only after the M4.3 license review and Socket.IO projection are complete.

### M4.0 verified decisions

- PostgreSQL 17.11 and Prisma 7.10.1 with `@prisma/adapter-pg` applied a real migration through the Prisma CLI.
- Two concurrent serializable writers produced project event sequences `1, 2` with matching Outbox rows and no duplicates.
- A second lease contender failed while the lease was active; after expiry, two separate Node processes raced and exactly one acquired the lease.
- The stale fencing token wrote `0` rows; the current token wrote `1`.
- Foreign-key rejection and transaction rollback both behaved as required by the spike.
- A real Harness Session delivered 22 `onNotification` events before run completion, including `tool/call` and `tool/result`.
- `dsh --profile future-cup-platform --from-default-profile web --dump-config` created and composed a custom profile through the supported launcher.
- HQ rendered its native WebGL scene at 1920×1080. Its source explicitly identifies local simulation and contains no fetch or Socket.IO integration.

### M4.1 implementation results

- SQLite schema v4 and the checked-in Prisma migration implement the same `OrchestrationStore` contract for DAG revisions, Journaling, scheduling, executions, execution events, verification, repair, workflow state, project events, Outbox, and leases.
- Task updates match the previous revision. Project events and Outbox rows commit in one Serializable transaction with a project-scoped sequence.
- Outbox claims carry an owner, token, and expiry. SQLite excludes active claims, PostgreSQL uses `FOR UPDATE SKIP LOCKED`, and expired claims can be redelivered for client-side deduplication.
- Fastify serves project snapshots and focused task, scheduling, execution-event, verification, repair, workflow, run, and cancel routes. Socket.IO emits `sync.snapshot` and committed `project.event` frames and rejects invalid cursors.
- PostgreSQL E2E passed store writes and reads, concurrent event ordering, Outbox claims, reconnect cursors, and cross-process lease fencing. The real `dsh` Future Cup profile composed and served the API.
- A concrete run launcher remains a service boundary for M4.2. Without `ctx.futureCupRunLauncher`, the run routes return 503 rather than simulating execution.

### M4.2 implementation results

- SQLite schema v5 and a second PostgreSQL migration add `project_runs`, private workspace and preview paths, terminal failure details, and one active run per project.
- `FutureCupRunLauncher` owns workflow lease acquisition, heartbeat, real Harness team startup, cancellation by runtime closure, stale-run reconciliation, and terminal settlement. Service shutdown waits for in-flight startup before closing active teams.
- Task completion and execution settlement commit together. Task, execution, verification, repair, workflow, and run product events are appended in the same store transaction as their domain mutation.
- Launcher writes carry `ownerId + fencingToken`, and each store transaction rejects stale or expired lease owners. Settlement keeps its heartbeat during transient retries, reconciles an already-terminal row after ambiguous responses, and bounds cancel/close with explicit pending and timeout failures.
- Fastify serves the same-origin management SPA, controlled verification screenshots, delivery summaries, and generated-project production previews. Public projections remove absolute paths and serialize fencing tokens as strings.
- Project-scoped Agent metrics derive load from `RUNNING` executions and observed success rates from persisted outcomes; the React application reloads them when the authoritative event cursor advances.
- The React management application provides project control, Agent status, React Flow DAG, scheduler evidence, verification screenshots, Self-Loop diffs, live events, and delivery preview across desktop, tablet, and mobile layouts.
- Generated Vite builds use a relative asset base so the same production output works both in the independent verifier and below `/preview/:projectId/`.

### M4.3 implementation results

- HQ static assets, PolyForm Noncommercial License 1.0.0, and the Required Notice build into `lib/web/hq/`; the management application opens the read-only display at `/hq/index.html?projectId=...`.
- `ui/src/hq/projection.ts` builds project, task, seven-Agent, department, verification, and repair projections from the REST snapshot. `ui/src/hq/bridge.ts` consumes Socket.IO snapshots and events and deduplicates by `projectId + seq`.
- `ui/src/hq/animation.ts` maps committed events to `flow`, `agent`, `department`, and `terminal` actions. `bridge.ts` invokes the animation adapter only when the projection changes, so duplicate events and historical replay produce no animation.
- Project events are validated again against the shared discriminated union at the browser boundary. A sequence gap or synchronization error disconnects, reloads the REST snapshot, and resumes from its latest cursor.
- HQ no longer includes local project presets, task or personnel management controls, or remote fonts. Without `projectId`, it shows only the read-only error state.
- Focused UI tests, type checking, the HQ build, artifact serving tests, and desktop/mobile browser checks passed. The browser check forced a sequence gap and confirmed automatic resynchronization; it also confirmed that live events invoke the 3D action adapter and create visual flight objects.

### M4.4 replay acceptance results

- The 53 committed project events from the real M4.2 DeepSeek multi-Agent run are frozen into a deterministic fixture with a source hash; event types, project sequence values, and payloads all pass the shared discriminated union.
- Replaying the events produces five completed tasks, two repair rounds, `PASS` verification, and `PASSED` workflow and run state, plus 57 HQ scene actions.
- Reapplying the terminal event changes neither the projection object nor the animation action list. Replay at 1920 x 1080 and 390 x 844 shows `PASSED · 53`, 100% progress, and no console errors.
- A fresh E2E then completed with a real DeepSeek key and remote PostgreSQL 17.11: nine independent Sessions, 5/5 tasks, `FAIL → FAIL → FAIL → PASS`, three repairs, and final `PASSED` run and workflow state at event cursor `59`.
- HQ observed 53 realtime actions during the fresh run and passed desktop/mobile WebGL2 checks with zero console errors. Deterministic replay evidence lives under `.artifacts/future-cup-m44/`; fresh-run evidence lives under `.artifacts/future-cup-m44-live/`.

## Alternatives considered

**Replace SQLite immediately with PostgreSQL.** Rejected because M2/M3 deterministic tests depend on the current fast in-memory SQLite adapter, and a migration should preserve those semantics rather than rewrite them.

**Broadcast directly after each database write.** Rejected because process failure between commit and broadcast loses the realtime event. A transactional outbox keeps the durable fact and delivery obligation in the same commit.

**Use global database sequence values as client cursors.** Rejected because unrelated projects would create gaps in a project stream and make snapshot-resume reasoning harder. Each project owns its monotonic sequence.

**Lease with owner and expiry only.** Rejected because an expired worker can resume and overwrite a newer worker's state. Every write needs a fencing token checked against the current lease.

**Run Fastify as a standalone Node application.** Rejected by the repository's application-launch rule and by the need for one composition, compatibility, lifecycle, and shutdown model.

**Embed HQ directly under the root MIT license.** Rejected because PolyForm Noncommercial terms and the required copyright notice must remain attached to every distributed copy.

**Keep HQ simulation until after visual integration.** Rejected because simulated activity presented as product execution would invalidate the platform's evidence. The simulation remains acceptable only as a clearly labeled standalone design reference.

## Acceptance criteria

- M4.0 evidence proves PostgreSQL migrations, transactional event sequencing, Outbox persistence, reconnect queries, lease exclusion, fencing, and rollback.
- M4.1 implements the shared persistence contract and passes the same behavior tests against SQLite and PostgreSQL.
- M4.1 exposes a snapshot plus `afterSeq` replay contract and broadcasts only committed Outbox rows.
- Every product event validates through the shared Zod discriminated union.
- A Future Cup bundle launches through `dsh` and owns Fastify, Socket.IO, PostgreSQL, and platform UI lifecycle.
- HQ integration preserves the PolyForm license, required notice, and noncommercial boundary; no mock activity is accepted as execution evidence.

## Risks

- The competition's use must remain noncommercial or obtain separate permission. This engineering record is not legal advice.
- The remote validation host has about 2 GiB RAM; PostgreSQL tests must use a bounded container and teardown.
- Prisma 7 uses driver adapters and generated clients; M4.1 must pin compatible versions and avoid mixing generated clients across packages.
- SDK notification methods are wire names, not yet the product event names. M4.1 needs an explicit projector with stable mapping and ignored-event policy.
- Long-lived Socket.IO delivery needs Outbox polling, acknowledgements, retention, and lag monitoring rather than assuming one in-process broadcast always succeeds.
- HQ now uses an offline font stack, real events, and a read-only surface. Every distribution must still retain the PolyForm license and Required Notice.
