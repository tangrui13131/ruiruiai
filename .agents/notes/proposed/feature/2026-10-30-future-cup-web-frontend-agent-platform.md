# Agent Note: Future Cup web frontend engineering agent platform

Status: proposed

English | [中文](2026-10-30-future-cup-web-frontend-agent-platform.zh.md)

## Problem

The Future Cup competition requires a runnable multi-Agent orchestration platform that demonstrates knowledge integration, Agent team definition, workflow orchestration, dynamic scheduling, a real self-loop, and result verification. A single coding Agent, a model API wrapper, a slide-only concept, or an unmodified framework example does not meet the submission requirements.

The earlier project record selected a micro-frontend and operations H5 authoring platform with a React Flow editor as the preferred product. Plan V1.0 changes that product decision: the platform must accept a frontend engineering requirement, coordinate specialized Agents, generate a runnable frontend project, verify it in a browser, repair failures, and deliver the project. Keeping the earlier scenario as current project context would make later architecture and acceptance work follow the wrong product boundary.

M1 and M2 are complete and M3 is the next gated milestone. The project needs one current record of the competition constraints, product boundary, architecture, Agent responsibilities, five delivery milestones, and the verified M1/M2 decisions. The [earlier orchestration proposal](../../rejected/feature/2026-10-29-future-cup-multi-agent-orchestration-platform.md) remains as rejected rationale.

## Proposal

Build a multi-Agent orchestration and self-healing platform for web frontend engineering, prioritizing reuse of DeepSeek Harness and reserving owned innovation for dynamic scheduling, real execution verification, and bounded autonomous repair. The MVP accepts a natural-language frontend requirement, produces a task DAG, assigns specialized Agents, writes a real React project, validates the result, and delivers a runnable project with evidence.

### Product boundary

- The product is not a generic website generator, a general Agent marketplace, a general-purpose workflow platform, or a full-stack application generator.
- The only generated application stack supported by the MVP is React, TypeScript, Vite, and Ant Design. Vue, Next.js, and additional stacks remain outside the MVP.
- The platform management application and the generated frontend project are separate products with separate workspaces.
- The HQ 3D display presents real execution events. It is not a source of task state and must not use simulated activity as formal execution data.
- Backend business logic generation is outside the MVP; the delivered artifact is a runnable frontend project.

### System architecture

- The management interface uses React, TypeScript, Vite, Ant Design, and React Flow for workflow and DAG display.
- The platform backend uses Node.js, Fastify, Zod, PostgreSQL, Prisma, and Socket.IO. These choices remain a validated baseline, not an assertion that every integration already works.
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
| `agents` | Agent role, model, prompt, tools, and status |
| `projects` | Requirement, stack, workspace, and delivery status |
| `tasks` | DAG node state, priority, assignment, and retry count |
| `task_dependencies` | Directed task prerequisites |
| `executions` | Agent execution, Session reference, timing, and failure |
| `execution_events` | Ordered product and runtime events |
| `verification_reports` | Structured static, build, and browser evidence |
| `repair_records` | Repair round, error, change summary, diff, and result |

### Agent team

The MVP uses a fixed team. Agents have independent Sessions, explicit inputs and outputs, bounded tool permissions, and persisted execution records.

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
| M4 | Integrate the management interface, PostgreSQL, realtime events, and HQ |
| M5 | Complete failure testing, deployment, performance work, and competition materials |

Each milestone delivers its design, implementation, tests, acceptance report, and remaining issues. Work does not advance until the milestone's observable acceptance criteria pass.

### M1 and M2 results and next work

M1 completed on 2026-10-30. The official TypeScript SDK started a real Harness runtime, a real DeepSeek model completed a turn, and a real model generated a React, TypeScript, Vite, and Ant Design project. A later real-model turn installed dependencies and ran the production build; independent Playwright verification passed on desktop and mobile with working counter behavior.

- Native Workflow works but lacks durable DAG state, journaling, resume, and scheduling. M2 uses Harness execution primitives with an owned lightweight DAG.
- Windows ACL passed write-confinement tests but remains partial same-world isolation. It is not the final boundary for untrusted or multi-tenant code.
- Docker 29.7.2 and SWE-ReX 1.4.0 passed container Runtime, persistent shell, file access, memory, CPU, PID, network, and cleanup checks on the validation host.
- SWE-ReX 1.4.0 requires an explicit `aiohttp` dependency, and its management bridge must be combined with a strict execution-network policy.
- M2 implemented the experimental Future Cup orchestration package: SQLite task revisions and Journal, cycle detection, readiness propagation, failure blocking, resume, explainable weighted scheduling, load balancing, reassignment, execution records, and structured Agent contracts.
- A real DeepSeek E2E ran Planner, UI Designer, two parallel Frontend Agents, and Integration in independent Sessions. The generated React/TypeScript/Vite/Ant Design project passed TypeScript and Vite production builds.
- M3 starts with independent browser verification, structured failure reports, bounded Repair Agent retries, repeated-failure circuit breaking, and visible manual escalation.

## Alternatives considered

**Keep the earlier micro-frontend and H5 authoring scenario.** Rejected because Plan V1.0 moves the product to frontend engineering delivery. The earlier scenario optimizes a different artifact, workflow, and demo, so retaining it as current memory would direct implementation toward the wrong product.

**Build a generic AI website generator.** Rejected because the competition evaluates orchestration, scheduling, validation, and self-loop behavior, not one-shot code generation. A generator without an observable multi-Agent control plane would be a thin model application.

**Build a general Agent marketplace first.** Rejected because arbitrary Agent creation, billing, multi-tenancy, and broad integrations do not prove the required frontend failure-to-recovery path and exceed the MVP.

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
- Expanding beyond the React MVP or adding multiple workflow engines would dilute implementation effort and create conflicting sources of execution truth.
