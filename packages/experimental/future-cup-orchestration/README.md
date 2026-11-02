---
description: "Durable DAG, explainable scheduling, independent browser verification, and bounded repair for the Future Cup frontend platform."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-future-cup-orchestration

English | [中文](README.zh.md)

## Summary

Run a durable frontend-engineering DAG through explainable scheduling and a real DeepSeek Harness Agent team. The package owns task revisions, Journal replay, a versioned Agent Registry, frozen project teams, structured project memory, explicit workflow control, adaptive repair strategies, intelligent team composition, scheduling decisions, execution evidence, structured Agent outputs, scoped file application, independent static/build/browser verification, and bounded Repair Agent retries. Its `OrchestrationStore` contract accepts the SQLite adapter in this package or the PostgreSQL adapter in `future-cup-platform`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Choose this package for the Future Cup M3 prototype or for tests that need a durable task DAG, browser verification, and a bounded self-loop with real Harness Sessions.

### Create a real team

Create one SQLite repository, the default seven Agent profiles, and one real Harness invoker per profile. The profiles contain `Planner`, `UI Designer`, `Tester`, `Frontend Agent A`, `Frontend Agent B`, `Integration`, and `Repair Agent`. The two frontend instances have equal capability and capacity so parallel tasks can be load-balanced.

```ts
import {
  createHarnessAgentTeam,
  defaultAgentProfiles,
  OrchestrationRepository,
  TeamOrchestrator,
} from '@deepseek-ai/dsh-experimental-future-cup-orchestration'

const repository = new OrchestrationRepository('./orchestration.sqlite')
const profiles = defaultAgentProfiles()
const invokers = createHarnessAgentTeam(profiles, {
  workspace: './generated-app',
  homeRoot: './agent-homes',
})
const team = new TeamOrchestrator({
  repository,
  invokers,
  profiles,
  workspace: './generated-app',
  verification: {
    buildTimeoutMs: 600_000,
    browserTimeoutMs: 60_000,
    screenshotDir: './verification-screenshots',
  },
  selfLoop: {
    maxRepairRounds: 3,
    repairTimeoutMs: 600_000,
  },
})
const result = await team.run('Build a dashboard with a users page')
await team.close()
repository.close()
```

### Agent Registry and workflow control

`PersistentAgentRegistry` persists Agent definitions, immutable versions, publication state, logical Team ownership, Team versions, project memory, and frozen project bindings through the shared store. `createDefaultAgentTeam()` seeds seven controlled Agent definitions; the deterministic Verifier remains system-owned and is not a runtime Team member. The default Team has seven runtime instances: the Frontend definition is instantiated twice and the remaining executable roles once. Project creation stores a complete one-row-per-instance member snapshot, so later Registry changes cannot modify a started project.

### My Team library

`AgentTeam` is the user-owned logical parent. Every `AgentTeamVersion` belongs to one Team, is immutable after creation, and contains one `runtimeMember` row per schedulable Agent instance. A Team version accepts 1–7 runtime instances, allows the same published Agent version to appear more than once, and requires stable `instanceId`, `displayName`, `departmentKey`, and `position` values. Draft versions may be empty; publishing and project freezing require a complete capability, concurrency, tool, memory, output-contract, department, and publication-state validation.

`WorkflowControlCoordinator` persists a versioned control graph and execution snapshot. The fixed graph starts with independent verification, routes `PASS` to delivery and `FAIL` or `INCOMPLETE` into the Repair subworkflow, then returns Repair to verification. The loop permits three rounds and a repeated failure signature first switches to an unused strategy before escalation. Node entry, edge selection, loop rounds, and subworkflow entry and exit all have durable Journal entries and can resume deterministically from one snapshot.

### Adaptive repair and team recommendation

`selectRepairStrategy()` scores findings by category, target path, round, and prior strategy use. Each strategy declares only a prompt fragment, bounded context, existing tool requirements, and a `src/` write scope; reverification remains the complete pipeline. The self-loop persists the strategy before source mutation and links its outcome to the real Repair record and next-round action.

`recommendAgentTeam()` uses only published Agent versions and published team templates. It derives a project profile from natural-language requirements, emits at most three structured questions, and validates capability coverage, concurrency, tools, memory, and input/output contracts. `applyTeamAdjustment()` accepts controlled natural-language changes; `createAgentTeamVersionInputFromRecommendation()` creates an immutable team version ready for saving.

### DAG state

Tasks use `PENDING`, `READY`, `RUNNING`, `COMPLETED`, `FAILED`, `BLOCKED`, and `CANCELLED`. Creation and resume reject cycles and missing dependencies. A completed dependency unlocks dependent tasks; a failed or cancelled dependency blocks every unfinished descendant.

### Durable records

The SQLite schema contains the project, task dependency, Journal, scheduling, execution, verification, repair, strategy-decision, workflow, product-event, Outbox, workflow-lease, Agent Registry, logical Team, runtime-member, team-binding, project-memory, and workflow-control records. Every task mutation matches the previous revision and appends a Journal record in one transaction. `DagEngine.resume()` replays the Journal and rejects state that disagrees with the current task rows. Schema v1-v7 databases migrate in place to v8 without deleting existing verification evidence or expanding legacy member counts into empty runtime identities.

### Scheduling

Candidates are scored with this explicit formula:

```text
capabilityMatch * capabilityWeight
+ historicalSuccessRate * successWeight
+ availability * availabilityWeight
+ priorityRatio * priorityWeight
- loadRatio * loadPenalty
```

Weights are validated configuration. A decision records every candidate, eligibility, rejection reason, score terms, selected Agent, and any retry reassignment reason. Ties prefer lower load and then stable Agent id.

### Agent permissions and output

Every role runs in a separate Harness runtime and Session with the `artifact-only` profile patch. Bash and PowerShell are disabled. The filesystem tool can read files but cannot write or edit. Agents return JSON validated by Zod; the orchestrator applies only paths inside the task's declared write scope.

The UI Designer returns design tokens rather than a large stylesheet. The package renders a deterministic shared CSS file from those tokens.

### Verification and bounded repair

The Verifier checks required project files, requires `HashRouter` instead of `BrowserRouter`, installs dependencies, runs `tsc --noEmit`, creates a Vite production bundle, starts a loopback preview server, and drives Chromium through Playwright at desktop and mobile widths. A PASS requires every expected route to render non-empty content, required text and navigation interactions to succeed, and the browser to report no `pageerror`, `console.error`, Ant Design deprecation warning, failed request, or HTTP 4xx/5xx response.

Findings are normalized into a deterministic SHA-256 `failureSignature`. The self-loop permits the configured number of Repair Agent rounds, runs the complete verification pipeline after every repair, stores the real source diff and before/after statuses, and stops with `ESCALATED` on repeated signatures, timeout, verifier incompleteness, or exhausted rounds. Every Repair call uses its own Harness Session.

### Realtime product events

`product-events.ts` defines the Zod contract shared by durable events, REST snapshots, and Socket.IO delivery. Every event carries `projectId`, a project-scoped positive `seq`, `occurredAt`, `type`, and a JSON payload. Task and Agent identities are required only for event types that own them. Clients resume with `projectId` plus `afterSeq`; `projectId + seq` is the deduplication identity.

The M4.0 gate verified this envelope against real PostgreSQL sequencing and the TypeScript SDK notification stream. `future-cup-platform` now owns the PostgreSQL store, transactional Outbox dispatcher, Fastify snapshots, and Socket.IO replay.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| `src/sqlite.ts` | Versioned SQLite schema and connection setup |
| `src/repository.ts` | Durable task, scheduling, execution, verification, repair, and workflow records |
| `src/dag-engine.ts` | Cycle validation, readiness, transitions, blocking, requeue, Journal replay, and resume |
| `src/scheduler.ts` | Capability matching, weighted scoring, load balancing, and reassignment |
| `src/agent-contracts.ts` | Structured invocation and JSON output validation |
| `src/harness-agents.ts` | Real TypeScript SDK Agent adapters and read-only profile |
| `src/team-orchestrator.ts` | Planner, role execution, parallel frontend calls, Integration, and self-loop composition |
| `src/build-verifier.ts` | Independent dependency, TypeScript, and Vite build checks |
| `src/browser-verifier.ts` | Playwright route, interaction, console, page error, and network verification |
| `src/preview-server.ts` | Owned loopback preview server with atomic port allocation and quiescent close |
| `src/failure-signature.ts` | Diagnostic normalization and stable repeated-failure hashing |
| `src/adaptive-repair.ts` | Failure classification, strategy catalog, candidate scoring, repeated-signature switching, and bounded-context selection |
| `src/self-healer.ts` | Bounded repair loop, strategy persistence, timeout handling, and escalation |
| `src/workspace-diff.ts` | Source snapshot and real unified repair diff generation |
| `src/product-events.ts` | Zod product event contract and reconnect cursor |
| `src/agent-registry.ts` | Agent definitions, immutable versions, team validation, and project freezing |
| `src/agent-registry-service.ts` | Durable Registry replay, logical Team persistence, and project-profile projection |
| `src/default-agent-team.ts` | Seven controlled default Agent definitions and team seed |
| `src/team-recommender.ts` | Project profiles, clarification, complete-team recommendation, controlled adjustment, and Registry conversion |
| `src/workflow-control.ts` | Versioned control graph, conditions, loops, subworkflows, and recovery |
| `src/workflow-control-coordinator.ts` | Durable snapshot and Journal coordination |

## Model Experience

### Role prompts

#### What the model sees

Each Agent receives the role instructions from `src/prompts.ts`, the JSON Schema generated from the task-owned Zod validator, and the complete structured task input. The Planner sees the user requirement; the UI Designer sees pages; the Tester sees the page and design outputs; each Frontend Agent sees one page, its Tester assertions, and the design output; Integration sees all page outputs, verification assertions, and design evidence; Repair sees the structured failure report, affected source, and prior repair summaries.

#### Token effect

Planner and role prompts include the task input and generated JSON Schema. The default Agent output cap is 32,000 tokens. UI Designer returns compact tokens, each frontend task is limited to three files, each Integration output to eight files, and each Repair output to eight source files.

#### KV Cache effect

Role prompts are stable for a given role, generated schema, and task input. Different tasks and retry Sessions naturally start independent request histories.

## Known Limitations and Deferred Work

- **Experimental package:** the public API can change while M3 incubates.
- **Two storage adapters:** SQLite remains the deterministic test adapter; `future-cup-platform` provides PostgreSQL through Prisma.
- **Controlled Registry team:** the default team reloads from durable Registry state and the novice recommender composes complete teams, but the initial round still does not allow arbitrary Agents, arbitrary tools, or a free-form team editor.
- **Lease acquisition is launcher-owned:** the store exposes workflow leases and revision guards; `future-cup-platform` acquires, renews, and fences them for each project run.
- **Playwright runtime:** browser verification requires a matching installed Chromium build; an unavailable browser produces `INCOMPLETE`, never `PASS`.
- **No requirement-generation repair:** Repair can change only generated `src/` files; failures in platform-owned scaffold files escalate instead of silently rewriting the generator.
- **Agent output budgets:** large generated pages require explicit model-output configuration or additional decomposition.

<a id="dev-note"></a>
### Dev Note

M3 uses a 32,000-token structured-output budget with reasoning disabled by default for task Agents. M4 completes PostgreSQL, realtime events, and management/HQ integration. M5.1 and M5.2 add a durable Agent Registry, project-team freezing, project memory, and recoverable workflow control; M5.3 adds adaptive repair strategies and M5.4 adds intelligent team composition. Repair execution remains owned by the same `SelfLoopController`.
