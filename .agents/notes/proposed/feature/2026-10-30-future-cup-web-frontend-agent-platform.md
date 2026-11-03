# Agent Note: Future Cup web frontend engineering agent platform

Status: proposed

English | [中文](2026-10-30-future-cup-web-frontend-agent-platform.zh.md)

## Problem

The Future Cup competition requires a runnable multi-Agent orchestration platform that demonstrates knowledge integration, Agent team definition, workflow orchestration, dynamic scheduling, a real self-loop, and result verification. A single coding Agent, a model API wrapper, a slide-only concept, or an unmodified framework example does not meet the submission requirements.

The earlier project record selected a micro-frontend and operations H5 authoring platform with a React Flow editor as the preferred product. Plan V1.0 changes that product decision: the platform must accept a frontend engineering requirement, coordinate specialized Agents, generate a runnable frontend project, verify it in a browser, repair failures, and deliver the project. Keeping the earlier scenario as current project context would make later architecture and acceptance work follow the wrong product boundary.

M1, M2, M3, M4.0, M4.1, M4.2, M4.3, M4.4, M5.1, M5.2, M5.3, M5.4, and M5.5 are complete and M5.6 is the next gated stage. The project needs one current record of the competition constraints, product boundary, architecture, Agent responsibilities, five delivery milestones, and the verified M1/M2/M3/M4/M5.1/M5.2/M5.3/M5.4/M5.5 decisions. The [earlier orchestration proposal](../../rejected/feature/2026-10-29-future-cup-multi-agent-orchestration-platform.md) remains as rejected rationale.

## Proposal

Build a multi-Agent orchestration and self-healing platform for web frontend engineering, prioritizing reuse of DeepSeek Harness and reserving owned innovation for dynamic scheduling, real execution verification, and bounded autonomous repair. The MVP accepts a natural-language frontend requirement, produces a task DAG, assigns specialized Agents, writes a real React project, validates the result, and delivers a runnable project with evidence.

### Product boundary

- The product is not a generic website generator, a general Agent marketplace, a general-purpose workflow platform, or a full-stack application generator.
- The only generated application stack supported by the MVP is React, TypeScript, Vite, and Ant Design. Vue, Next.js, and additional stacks remain outside the MVP.
- The platform management application and the generated frontend project are separate products with separate workspaces.
- The HQ 3D display presents real execution events. It is not a source of task state and must not use simulated activity as formal execution data.
- Backend business logic generation is outside the MVP; the delivered artifact is a runnable frontend project.
- The product unit for Agent creation is a complete team composition, not an isolated Agent. M5 recommendations and editing remain bounded by approved role prototypes, tool permission ceilings, and output contracts; this does not expand into a general Agent marketplace or arbitrary tools platform.

### System architecture

- The management interface uses React, TypeScript, Vite, Ant Design, and React Flow for workflow and DAG display.
- The platform backend uses Node.js, Fastify, Zod, PostgreSQL, Prisma, and Socket.IO. M4.1 implemented the persistence, API, Outbox, replay, and profile composition.
- M4.0 validated PostgreSQL 17.11, Prisma 7.10.1, real Docker migrations, transactional Outbox rows, project event sequences, cross-process leases, and fencing tokens.
- The backend controls DeepSeek Harness through its official TypeScript SDK and uses native Sessions, Agent execution, tools, events, and cancellation before adding duplicate runtime behavior.
- Workflow selection starts with native Harness workflow capabilities. A lightweight owned DAG is considered only for a demonstrated persistence, recovery, or conditional-branch gap. LangGraph.js is a later comparison, not an initial dependency, and only one workflow owner may be active.
- Generated project code is untrusted input. Execution requires an isolated workspace, restricted files, command controls, CPU and memory limits, network limits, timeouts, concurrency limits, lifecycle cleanup, and resource recovery.
- Docker or SWE-ReX is evaluated for process isolation. Harness file permissions are not treated as a complete container boundary, and Node.js `vm` is never used as a security sandbox.
- All product-visible execution state derives from persisted task, Session, verification, and repair records. Credentials come only from environment variables or secure deployment configuration.

### Platform data

The logical MVP data model contains the following records; indexes, foreign keys, uniqueness constraints, audit fields, and deletion behavior are defined during implementation.

| Record | Purpose |
|---|---|
| `users` | Platform user identity and ownership |
| `agents` | Agent instances created from a team version, with Session, model, tools, load, and status |
| `agent_definitions` | Agent identity, purpose, discovery tags, and lifecycle |
| `agent_definition_versions` | Immutable prompt, model, capabilities, tool policy, memory policy, inputs and outputs, and resource constraints |
| `agent_team_versions` | Immutable team composition, validation results, and published version |
| `agent_team_members` | Agent definition versions, instance counts, and scheduling policy within a team version |
| `project_team_bindings` | Frozen team version bound to a project at start |
| `project_memory_entries` | Structured project requirements, design decisions, failure patterns, and accepted delivery summaries |
| `projects` | Requirement, stack, workspace, and delivery status |
| `tasks` | DAG node state, priority, assignment, and retry count |
| `task_dependencies` | Directed task prerequisites |
| `executions` | Agent execution, Session reference, timing, and failure |
| `execution_events` | Ordered product and runtime events |
| `verification_reports` | Structured static, build, and browser evidence |
| `repair_records` | Repair round, error, change summary, diff, and result |
| `repair_strategy_decisions` | Failure classification, candidate repair strategies, selection rationale, and outcome |
| `workflow_control_events` | Conditional branch, loop round, and subworkflow state transitions |
| `project_events` | Product events with a project-scoped monotonic sequence and reconnect source |
| `outbox_events` | Realtime delivery obligations committed with state changes |
| `workflow_leases` | Owner, heartbeat, expiry, and fencing token |

### Agent team

M2 through M4 use a fixed team validated with real execution. Agents have independent Sessions, explicit inputs and outputs, bounded tool permissions, and persisted execution records.

M5 makes a team a first-class user-configurable object. The default composition entry does not require users to understand Agent roles: the user describes a goal, the system derives a project profile, asks at most three essential questions when needed, and recommends a complete composition from a controlled role library and validated team templates. The model only interprets the requirement and makes recommendations; deterministic rules validate and produce the final team.

The recommendation explains responsibilities, parallel benefit, load, permissions, missing capabilities, and risks in plain language. The user can adopt it with one action, adjust it in natural language, or save a version. Advanced users can edit team templates but cannot bypass role prototypes, permission ceilings, or output contracts.

A project binds an immutable team version at start. Editing a template creates a new version without changing a started project, and every run still creates independent Sessions.

| Agent | Responsibility |
|---|---|
| Planner | Analyze the requirement and produce pages, constraints, Agent requirements, and a task DAG |
| UI Designer | Produce a shared layout, visual, component, and responsive design specification |
| Frontend Agent | Implement pages, components, routes, interactions, and styles for bounded tasks |
| Integration Agent | Integrate pages and routes, resolve conflicts, and check shared interfaces |
| Tester | Derive expected behavior and write component and Playwright tests |
| Verifier | Run independent static, build, browser, and console checks against real evidence |
| Repair Agent | Diagnose structured failures, modify code, and return the result to verification |

### Task DAG and scheduling

Tasks use the states `PENDING`, `READY`, `RUNNING`, `COMPLETED`, `FAILED`, `BLOCKED`, and `CANCELLED`. Dependency-free tasks may execute in parallel; dependent tasks wait for accepted prerequisites; failed prerequisites cannot advance downstream work.

The scheduler matches task requirements to Agent capabilities, respects dependency readiness and availability, accounts for load and prior success, and records candidates, the selected Agent, and the selection reason. MVP weights are explicit, configurable, measured through repeatable evaluation, and not replaced with an opaque learned model.

Every assignment, requeue, cancellation, failure, and DAG change becomes a persisted event or task revision that can reconstruct the execution after a client refresh.

### Verification and self-loop

Verification combines project structure checks, TypeScript and ESLint checks, dependency and build results, server startup, Playwright browser tests, page visibility, key interactions, failed requests, and browser console errors. Reports use `PASS`, `FAIL`, `WARNING`, or `INCOMPLETE`; Agent prose cannot declare a task successful without execution evidence.

The Verifier is independent from the Agent that produced the revision. When deterministic checks disagree with an Agent verdict, the deterministic evidence is authoritative.

The self-loop runs from a structured report through diagnostics, Repair Agent changes, and complete re-verification. It permits at most three automatic repair rounds by default, preserves each report and code diff, records before-and-after results, and stops on repeated equivalent failure. Exhaustion, timeout, or lack of progress produces a visible manual-intervention state instead of an unbounded retry.

### HQ and real events

The competition uses the existing HQ tactical display theme rather than building another 3D display. Socket.IO publishes real events such as task creation and planning, dispatch, Agent start and completion, tool calls, verification, repair, and task completion.

HQ maps those events to Agent, department, workflow, progress, log, verification, and repair state. Every event retains its timestamp, task ID, and Agent ID, and refresh reconstructs the current status from the backend.

The existing HQ source carries PolyForm Noncommercial 1.0.0 information. Its exact license, attribution, competition-submission, public-distribution, and commercial-use obligations require review before integration or distribution. It is not treated as MIT-licensed code by default.

### Delivery order

The project uses five gated milestones instead of building the document chapters sequentially.

| Milestone | Outcome |
|---|---|
| M1 | Validate Harness SDK and workflow, execution isolation, and Playwright-based React validation |
| M2 | Prove multiple specialized Agents can collaborate through tasks, DAG execution, and scheduling |
| M3 | Complete generation, browser verification, bounded repair, and re-verification |
| M4 | Integrate the management interface, PostgreSQL, realtime events, and HQ; M4.4 accepts the display through recorded real-run replay |
| M5 | Complete Agent registration and versions, workflow control structures, adaptive self-loop, intelligent team composition, failure testing, deployment, performance work, and competition materials |

Each milestone delivers its design, implementation, tests, acceptance report, and remaining issues. Work does not advance until the milestone's observable acceptance criteria pass.

### M5 initial-round plan

M5 targets initial-round acceptance and completes the following phases in dependency order. Conflicting redesigns do not start in parallel.

**M5.0 Baseline and evidence matrix.** Map the competition requirements in the screenshot to existing implementation, missing modules, real tests, and report sections, while freezing the M4-validated scheduling, verification, persistence, and HQ behavior. The gate requires an owner, acceptance command, and existing or planned evidence for every requirement; "similar capability exists" is not evidence.

**M5.1 Agent Registry and versions.** Replace the fixed `defaultAgentProfiles()` with published definitions as seed data. An Agent definition stores role, prompt version, model, capabilities, tool allowlist, memory policy, concurrency capacity, and input/output schemas. Its lifecycle is `DRAFT → VALIDATED → PUBLISHED → DEPRECATED`. The scheduler discovers published versions by capability, and a team binds immutable definition versions. Project memory stores structured requirements, design decisions, failure signatures, and accepted artifact summaries without a vector database. Gates cover registration, discovery, immutable versions, deprecation, capability lookup, and project freezing.

**M5.2 Workflow control structures.** Keep the task DAG and add an explicit control graph with sequential, parallel, conditional, bounded-loop, and subworkflow behavior. The first real control graph is fixed: verification `PASS` advances to delivery; `FAIL` or `INCOMPLETE` enters the Repair subworkflow; Repair returns to verification; three rounds or a repeated failure signature escalate. Conditions, loop rounds, and subworkflow entry and exit are persisted and mapped into React Flow. The initial round provides versioned workflow definitions and visualization only, not an arbitrary drag-and-drop authoring canvas.

**M5.3 Adaptive Self-loop.** Classify verification findings and select a predefined repair strategy from failure category, round, prior failure signatures, and completed edits. Each strategy declares its prompt fragment, context scope, existing tool permissions, and re-verification scope. The system persists candidate strategies, selection reason, input summary, repair outcome, and the next-round change. A repeated signature switches strategy first; another repetition or exhaustion produces `ESCALATED`. Strategies may change repair context and existing tool use but cannot weaken Verifier thresholds.

**M5.4 Intelligent team composition.** Implement the newcomer flow after Registry and workflow templates are complete. The user describes a goal, the system derives a project profile, asks at most three essential questions, and recommends a complete composition from published Agent definitions and team templates. Capability coverage, concurrency capacity, tool permissions, memory policy, and output contracts validate the recommendation. The user can adopt it, adjust it in natural language, and save a new team version.

**M5.5 Platform integration and real E2E.** Add REST, Socket.IO events, and management UI for Agent registration, team publication, workflow control, strategy selection, and project memory. A real DeepSeek E2E must start from published Agents and a team, follow an actual conditional branch, bounded loop, and Repair subworkflow, repair a verification failure through an adaptive strategy, and finish with PASS. Browsers cover desktop and mobile viewports, and simulated Agent responses cannot serve as gate evidence.

**M5.6 Initial-round delivery.** Complete failure testing, deployment, performance measurement, the competition evidence matrix, technical proposal, slides, demonstration video, and reproduction steps. Every material references real run records, test output, and screenshots; planned capabilities are not described as implemented results.

MCP, A2A, external API plugins, RAG, vector databases, arbitrary tool installation, a complete drag-and-drop workflow editor, an Agent marketplace, multi-tenancy, and billing are explicitly deferred beyond the initial round. Existing read-only file tools, the TypeScript/Vite/Playwright toolchain, database events, and tool permission records remain tool-use evidence. Documentation must state these limits and must not claim MCP integration.

### M5.1 and M5.2 results

- Agent Registry now persists definitions, independent version states, publication and deprecation, capability discovery, team compositions, project memory, and complete frozen project bindings. Published definitions can receive new versions while old versions remain immutable; deprecated definitions leave discovery, while already frozen projects retain their member snapshots.
- SQLite schema v6 and PostgreSQL migrations store Registry, team, project-memory, and workflow-control records. Project creation writes the frozen team and initial requirement memory in one transaction; both stores pass recovery, version, foreign-key, and uniqueness tests.
- The default team contains seven controlled definitions: Planner, UI Designer, Tester, Frontend, Integration, Verifier, and Repair, with two Frontend instances. The deterministic Verifier is system-owned and is not a runtime member or HQ person. Startup restores the registry or repairs an interrupted default seed into the complete team.
- The project launcher derives scheduler profiles from the project's frozen snapshot. Model, prompt, capabilities, tool allowlist, memory policy, and output contracts come from immutable Agent versions; Bash and PowerShell remain disabled.
- The versioned workflow-control graph supports sequencing, parallelism, conditions, bounded loops, Repair subworkflows, and terminal states. Node entry and completion, edge selection, loop evaluation, and subworkflow entry and exit are journaled; snapshot revisions reject stale overwrites.
- The self-loop now drives the control graph: PASS advances to delivery, FAIL or INCOMPLETE enters the Repair subworkflow, and Repair returns to verification. Repeated failure, three-round exhaustion, Repair failure, or incomplete verification produces a visible escalation. The management UI renders the control graph and recent control events below the task DAG.
- Focused results pass 88/88 orchestration tests, 25/25 platform tests, and 50/50 UI tests. The real PostgreSQL E2E passes 2/2 and covers Registry recovery, team freezing, project memory, workflow control, and the existing transaction and lease paths.

### M5.3 and M5.4 results

- SQLite schema v7 and PostgreSQL migration `20261101200000` persist each repair strategy decision, candidate scores, selection reason, input summary, outcome, and linked Repair record.
- The adaptive strategy catalog classifies TypeScript, dependency and build, browser, accessibility and responsive, console and network, server, project-structure, and bounded-regression failures. Strategies change prompts and bounded source context only; reverification remains the complete pipeline.
- Workflow-control snapshots add `strategySwitchAvailable`. A repeated signature first selects an unused strategy and continues Repair; escalation occurs only when no alternative remains or the three-round bound is exhausted. Repair timeout, failure, and reverification exceptions retain strategy and Repair evidence.
- Intelligent team composition derives a project profile from a natural-language requirement, asks at most three structured questions, and recommends a complete team only from published Agent versions and team templates. Deterministic checks cover capability, concurrency, tools, memory, and output contracts, with missing capabilities and risks shown to the user.
- Users can apply controlled natural-language adjustments, save an immutable team version, or adopt a team and create a frozen project. The management frontend adds a `Build a team` entry, project profile, members and capability coverage, risks, adjustment history, and adoption flow.
- New modules reach per-file 100% coverage: `adaptive-repair.ts`, `self-healer.ts`, `team-recommender.ts`, `TeamBuilderPage.tsx`, `TeamRecommendationDetails.tsx`, `recommendation-labels.ts`, and `RepairsPage.tsx`.
- Current aggregate results pass 169/169 orchestration tests, 26/26 platform tests, and 73/73 UI tests. Package TypeScript, Prisma schema validation, targeted Oxlint, and `git diff --check` pass.

### M5.5 team library results

- SQLite schema v8 and PostgreSQL migration `20261102130000` add logical Team ownership, one-row-per-instance runtime members, immutable version status, and stable HQ placement fields.
- Users can create multiple Teams, save empty drafts, publish 1–7 runtime instances, clone published Teams, archive Teams, and inspect project usage. The same published Agent version may appear more than once and each instance counts toward the Team limit.
- Team publication and recommendation share capability, concurrency, tool, memory, output-contract, department, and publication-state validation. The deterministic Verifier remains system-owned and is not a Team member.
- Project creation freezes the selected Team version. The project Agent API derives the roster from that snapshot, and HQ reads the frozen department and position values instead of guessing from role names.
- The `My Teams` management page provides the Team list, version history, capacity and usage summary, and a 1–7 instance editor. The existing `Build a team` flow remains the intelligent-recommendation entry.
- Current focused results pass 198/198 orchestration tests, 32/32 platform tests, and 87/87 UI tests. The real Team E2E self-skips without a key; SQLite v1–v7 migration tests, Prisma schema validation, TypeScript checks, and artifact builds pass.
- The 2026-11-03 real DeepSeek E2E created a project from a user-cloned and published seven-member Team. It verified the immutable frozen snapshot, seven project Agent projections, seven independent Harness homes, real generation Sessions, and desktop/mobile browser checks. The project passed full verification first; the platform then injected `TS2322`, the adaptive repair path completed a new Repair Session, reverification changed from `FAIL` to `PASS`, and the control graph retained the conditional edge, bounded loop, Repair subworkflow, and `PASSED` terminal state. Evidence is written to `.artifacts/future-cup-m55-live/real-team-*/run-result.json`; the entry point is `packages/experimental/future-cup-platform/tests/real-team-library.e2e.ts`.
- Browser Verifier now reopens each interaction's declared `fromRoute` before acting, so a prior navigation cannot leak into the next interaction's starting page. Tester output also rejects a `clickText` that is neither a source-page `requiredText` value nor the destination `navigationLabel`. The SDK surfaces a failed `turn/end` as a `SessionTurnError` with a stable code and retry classification, and the Self-loop uses `maxAgentRetries` for bounded retries of recoverable transport failures. Regression tests cover repeated source-route interactions, contradictory labels, and transport recovery.

### M1, M2, M3, M4.0, M4.1, M4.2, M4.3, M4.4, M5.1, M5.2, M5.3, and M5.4 results

M1 completed on 2026-10-30. The official TypeScript SDK started a real Harness runtime, a real DeepSeek model completed a turn, and a real model generated a React, TypeScript, Vite, and Ant Design project. A later real-model turn installed dependencies and ran the production build; independent Playwright verification passed on desktop and mobile with working counter behavior.

- Native Workflow works but lacks durable DAG state, journaling, resume, and scheduling. M2 uses Harness execution primitives with an owned lightweight DAG.
- Windows ACL passed write-confinement tests but remains partial same-world isolation. It is not the final boundary for untrusted or multi-tenant code.
- Docker 29.7.2 and SWE-ReX 1.4.0 passed container Runtime, persistent shell, file access, memory, CPU, PID, network, and cleanup checks on the validation host.
- SWE-ReX 1.4.0 requires an explicit `aiohttp` dependency, and its management bridge must be combined with a strict execution-network policy.
- M2 implemented the experimental Future Cup orchestration package: SQLite task revisions and Journal, cycle detection, readiness propagation, failure blocking, resume, explainable weighted scheduling, load balancing, reassignment, execution records, and structured Agent contracts.
- A real DeepSeek E2E ran Planner, UI Designer, two parallel Frontend Agents, and Integration in independent Sessions. The generated React/TypeScript/Vite/Ant Design project passed TypeScript and Vite production builds.
- M3 upgrades SQLite to schema v2 with structured verification reports, deterministic failure signatures, `repair_records`, `workflow_runs`, and in-place M2 migration.
- A Tester Session generates route, required-text, and navigation assertions. The independent Verifier runs project structure, dependency installation, `tsc --noEmit`, Vite build, and desktop/mobile Playwright checks; `pageerror`, `console.error`, Ant Design deprecation warnings, failed requests, and HTTP 4xx/5xx responses prevent PASS.
- The bounded self-loop reruns complete verification after every repair, persists the real source diff and before/after statuses, reads its maximum rounds and timeout from explicit configuration, and publishes `ESCALATED` on repeated signatures, timeout, verifier incompleteness, or exhaustion.
- A real DeepSeek M3 E2E completed six independent generation Sessions, then injected a deterministic TypeScript error. Playwright subsequently found another real browser failure. Two independent Repair Sessions removed the build error and repaired a user-management visibility assertion before the final project passed TypeScript, Vite, desktop, and mobile browser verification.
- M4.0 validated migration, Serializable transactions, project event sequencing, transactional Outbox, cross-process leases, fencing tokens, foreign keys, and rollback on real PostgreSQL 17.11 with Prisma 7.10.1. The real Harness SDK delivered Agent status, `tool/call`, and `tool/result` notifications before run completion. `dsh` created a custom profile from the Web template.
- The actual HQ source is `agent-display-main/theme-10-hq`, licensed under PolyForm Noncommercial License 1.0.0. Every distributed copy must retain `Required Notice: Copyright (c) 2026 赛博老爸`. The current display explicitly identifies local simulation and has no realtime event connection.
- M4.1 implemented one `OrchestrationStore` contract for SQLite and PostgreSQL. PostgreSQL now persists DAG revisions, scheduling decisions, executions, execution events, verification reports, repairs, and workflow state, not only snapshots.
- Task writes require the previous revision; project events and Outbox obligations commit in one Serializable transaction. Outbox dispatchers use expiring owner claims, and PostgreSQL claims with `FOR UPDATE SKIP LOCKED`.
- Fastify now exposes project, task, execution-event, scheduling, verification, repair, workflow, run, and cancel routes with Zod validation and explicit 400, 404, 409, and 503 failures. Socket.IO replays snapshots and committed increments after `projectId + afterSeq`, while invalid cursors disconnect with `INVALID_CURSOR`.
- The real PostgreSQL migration and E2E test passed DAG writes, revision Journaling, execution evidence, verification, repair, workflow completion, concurrent event sequencing, Outbox claims, reconnect queries, and cross-process fencing.
- The Future Cup bundle composes through `dsh`, and the real platform API served health, Agent, project creation, and snapshot routes against PostgreSQL. M4.2 subsequently added the management interface and concrete launcher that consume the finished store contract.
- M4.2 added `project_runs`, SQLite schema v5, a PostgreSQL migration, and one active run per project. Run state is separate from the M3 verification workflow.
- The real `FutureCupRunLauncher` creates an isolated workspace and Agent home root, acquires and heartbeats a workflow lease, runs the real Harness team, reconciles interrupted runs after restart, and records PASSED, FAILED, CANCELLED, or ESCALATED without simulated state.
- SQLite and PostgreSQL now emit task, execution, verification, repair, workflow, and run product events inside their owning state transactions. Task completion and execution settlement also share one transaction.
- Every domain write from the real launcher carries its workflow owner and fencing token. Terminal settlement keeps the heartbeat alive while transient database errors retry, recognizes a committed terminal row after an ambiguous response, and reports `PROJECT_RUN_SETTLEMENT_PENDING` or `PROJECT_RUN_SETTLEMENT_TIMEOUT` instead of claiming a false success.
- The same-origin management SPA uses React, TypeScript, Vite, Ant Design, React Flow, HashRouter, and Socket.IO. It provides project creation and control, Agent status, DAG, scheduler evidence, verification screenshots, repair diffs, event logs, and delivery preview.
- Project-scoped Agent cards derive current load from `RUNNING` executions and historical success rates from persisted execution outcomes; the UI refreshes that projection whenever the authoritative event cursor advances.
- Fastify serves the built management SPA, screenshot artifacts, and generated production previews. Public responses replace private workspace paths with relative identifiers and expose screenshot file names only through controlled routes.
- The final real M4.2 run completed five DAG tasks through eight independent Sessions, passed after two real Repair Sessions, and served the generated production build below the platform preview path. Browser verification passed at desktop, 900 px tablet, and 390 px mobile widths with eleven screenshots and no failed requests or image decode errors.
- M4.3 integrated the real REST/Socket.IO data plane into the HQ 3D display under PolyForm Noncommercial License 1.0.0. The page validates project events with the shared discriminated union, deduplicates by `projectId + seq`, reloads the authoritative snapshot after a sequence gap, and resumes from the project cursor.
- A separate realtime action map drives scene animation: dispatch packets move between departments, Agents stand and walk into work and tool-call states, and verification failures, repair round trips, and final delivery use distinct tones and pulses. Initial REST loads, reconnect snapshots, and gap resynchronization rebuild state without replaying historical animation.
- The HQ build now emits `/hq/index.html`, `/hq/hq-bridge.js`, the license, and the Required Notice; the management application exposes a project-level Live HQ entry. Local project presets, remote fonts, and task/personnel creation controls were removed, leaving a read-only execution view.
- HQ maps the seven real Agent roles to planning, design, frontend A, frontend B, integration, verification, and repair departments. Project, task, load, verification, and repair state comes from persisted snapshots and committed events.
- Focused UI tests, type checking, the HQ build, and artifact serving tests passed. Browser checks at 1920 x 1080 and 390 x 844 covered the missing-project error state, real snapshot projection, Socket.IO sequence-gap resynchronization, live action invocation, and responsive layout.
- M4.4 freezes the 53 committed events from the real M4.2 DeepSeek multi-Agent run into a deterministic replay fixture and verifies shared-union validation, 5/5 completed tasks, two repair rounds, and `PASSED` verification and run status.
- Real-run replay produces 57 HQ actions: Agent 21, department 17, flow 17, and terminal 2. Duplicate terminal events produce no extra state or animation. Desktop and mobile browsers show `PASSED · 53` with no console errors.
- M4.4 then completed a fresh E2E with a real DeepSeek key and remote PostgreSQL 17.11: the `deepseek-flash` team used nine independent Sessions to complete 5/5 tasks, produced `FAIL → FAIL → FAIL → PASS` verification, and reached `PASSED` run and workflow state after three repairs at event cursor `59`.
- HQ observed 53 realtime actions during the fresh run and finished at `PASSED · 59`, 100% progress, and three repairs. Desktop and mobile used WebGL2 with zero console errors; the first-frame camera hover race was fixed. Fresh-run evidence lives under `.artifacts/future-cup-m44-live/`.
- The generated production preview returned HTTP 200 and rendered the `Overview` and `Users` navigation plus KPI/activity content at desktop and mobile widths with zero console errors.

The technical gate is recorded in [Future Cup M4 realtime persistence gate](../architecture/2026-10-31-future-cup-m4-realtime-persistence-gate.md).

## Alternatives considered

**Keep the earlier micro-frontend and H5 authoring scenario.** Rejected because Plan V1.0 moves the product to frontend engineering delivery. The earlier scenario optimizes a different artifact, workflow, and demo, so retaining it as current memory would direct implementation toward the wrong product.

**Build a generic AI website generator.** Rejected because the competition evaluates orchestration, scheduling, validation, and self-loop behavior, not one-shot code generation. A generator without an observable multi-Agent control plane would be a thin model application.

**Build a general Agent marketplace first.** Rejected because arbitrary Agent creation, billing, multi-tenancy, and broad integrations do not prove the required frontend failure-to-recovery path and exceed the MVP.

**Make newcomers create an isolated Agent or a completely free-form team from a blank page.** Rejected because users lack the knowledge to choose roles, tool permissions, and recovery behavior. M5 makes the complete team the product unit, recommends compositions from validated templates and a controlled role library by default, and prevents advanced editing from bypassing validation.

**Let a model freely invent an arbitrary Agent team.** Rejected because a non-repeatable team cannot be audited, authorized, or reproduced reliably. The model only derives project profiles and recommendations; deterministic rules perform final validation of capability coverage, capacity, permissions, and output contracts.

**Add MCP, A2A, external API plugins, RAG, or vector memory during the initial round.** Rejected because the competition lists them as encouraged options rather than initial-round hard gates. Time must first close Agent registration, workflow control, and adaptive feedback; the existing controlled toolchain and tool events provide real tool-use evidence.

**Replace Harness with a separate orchestrator or start with LangGraph.js.** Rejected because Harness already supplies runtime, Session, subagent, and Agent Teams primitives. A separate workflow engine is considered only after a demonstrated native gap, and competing workflow owners are prohibited.

**Use simulated execution, browser results, or HQ animation while building the shell.** Rejected because the competition requires objective technical evidence. Simulated activity would invalidate the principal innovation claims and hide integration failures.

**Support many frontend stacks or complete the visual platform before the loop works.** Rejected because each stack adds Agent, tool, and verification complexity. The MVP first proves one complete React path from requirement to verified delivery.

**Retry repairs until the model eventually succeeds.** Rejected because equivalent failures can consume unlimited time and tokens without progress. The loop requires a visible bound, repeated-failure detection, and an explicit escalation state.

## Acceptance criteria

- M1 produces a reproducible Harness invocation record, a justified workflow decision, a demonstrated isolation option, generated React files, and Playwright output.
- A user requirement produces a valid task DAG and a runnable React, TypeScript, Vite, and Ant Design project.
- Independent parallel tasks execute concurrently while dependent tasks wait and failed prerequisites block downstream work.
- At least a Planner, two role-distinct implementation or integration Agents, a Tester or Verifier, and a Repair Agent operate with distinct responsibilities and persisted execution evidence.
- Scheduling exposes eligible candidates, capability evidence, load and readiness state, the selected Agent, and the reason for assignment or reassignment.
- Verification catches a deterministic build or browser failure and produces a structured report accepted by the Repair Agent.
- The self-loop preserves up to three repair attempts and their diffs, re-runs verification after each repair, and terminates on success, repeated failure, timeout, or exhaustion.
- HQ reconstructs real task, Agent, verification, and repair state from persisted events without mock execution or unnecessary animation.
- A newcomer can obtain a complete team recommendation from a natural-language requirement, answer at most three essential questions, and never start from a blank Agent configuration.
- Team recommendations use only controlled role prototypes and pass deterministic validation of capability coverage, concurrency capacity, tool permissions, and output contracts; missing or unsupported capabilities remain explicit.
- A user can adopt, adjust in natural language, and save a team version; a project freezes its version at start, the same version is reproducible, and later edits do not pollute active or completed runs.
- A recommended team completes at least one real multi-Agent E2E proving that recommendation, instantiation, independent Sessions, parallel execution, and final verification use the same frozen composition.
- Agent definitions can be registered, validated, published, discovered by capability, and deprecated; versions are immutable, teams reference published versions, and a project freezes its team and every member definition at start.
- The workflow control graph executes a real conditional branch, bounded loop, and Repair subworkflow, preserves control state after recovery, and exposes inspectable evidence in the management interface.
- A verification failure triggers explicit repair strategy selection; a repeated failure signature switches strategy, another repetition or exhaustion escalates, and strategy records are auditable without weakening verification thresholds.
- The M5 real E2E proves that registration, team publication, project binding, conditional looping, adaptive repair, final PASS, refresh recovery, and HQ events all come from one real run.
- The repository identifies upstream and changed code, contains no credentials, documents setup and tests, and includes the required technical proposal, slides, demonstration video, and reproducible demo.
- The final demonstration completes the path from one declared requirement to a runnable verified frontend project, including a visible intended failure and verified recovery.

## Risks

- The competition schedule is short. M1 can reveal that native workflow or isolation support requires more adaptation than expected, so M2 and later scope must stay gated.
- Harness Agent Teams and related Session APIs may remain experimental. The competition branch must pin a revision and retain adaptation tests.
- Docker and SWE-ReX differ materially in host support and operational cost. Choosing one without a real isolated execution trial can invalidate later security claims.
- Generated code is untrusted. A same-world process or incomplete cleanup would expose the host and make the platform unsuitable for the competition demo.
- Browser tests and preview startup can be timing-sensitive. The demonstrated defect and collection of console, server, network, and test evidence must be deterministic.
- A coding Agent can produce code that builds but does not satisfy the requirement. The Verifier needs both deterministic checks and evidence-grounded requirement review.
- Dynamic scheduling can become decorative scoring. The MVP must show measured, repeatable selection behavior rather than unexplained weights.
- The HQ asset has license obligations and cannot be redistributed or presented commercially before those terms are reviewed.
- Team recommendations can become an unexplained black box or work only for a few demonstration requirements. The role library, matching rules, missing capabilities, and selection rationale must remain inspectable and be evaluated across multiple project profiles.
- Custom teams can bypass execution safety or produce invalid compositions. Role prototypes, permission ceilings, concurrency capacity, and output contracts must be enforced by deterministic rules that block startup on failure.
- Agent Registry and workflow control can expand into a general platform. The initial round supports only approved definitions, fixed control structures, and versioned definitions, not arbitrary roles, arbitrary tools, or a complete drag-and-drop authoring system.
- Adaptive strategies can fake success by weakening verification. Strategies select only repair context and existing tools; Verifier thresholds and complete re-verification scope remain fixed in independent code.
- Reviewers may mistake the absence of MCP for an absence of tool use. The report must show existing read-only tools, TypeScript/Vite/Playwright, database events, and `tool/call` evidence, and identify MCP as post-initial-round work.
- M5 carries team composition, deployment, performance, and competition materials at once, so its scope can become excessive. Each phase needs an independent gate and competition materials cannot mask missing real-run evidence.
- Expanding beyond the React MVP or adding multiple workflow engines would dilute implementation effort and create conflicting sources of execution truth.
