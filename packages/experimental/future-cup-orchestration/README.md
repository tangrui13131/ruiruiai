---
description: "Durable DAG, explainable scheduling, and real Harness Agent-team orchestration for the Future Cup frontend platform."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-future-cup-orchestration

English | [中文](README.zh.md)

## Summary

Run a durable frontend-engineering DAG through explainable scheduling and a real DeepSeek Harness Agent team. The package owns task revisions, Journal replay, scheduling decisions, execution evidence, structured Agent outputs, scoped file application, and independent TypeScript/Vite verification.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Choose this package for the Future Cup M2 prototype or for tests that need a durable task DAG with real Harness Sessions.

### Create a real team

Create one SQLite repository, the default five Agent profiles, and one real Harness invoker per profile. The profiles contain `Planner`, `UI Designer`, `Frontend Agent A`, `Frontend Agent B`, and `Integration`. The two frontend instances have equal capability and capacity so parallel tasks can be load-balanced.

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
const team = new TeamOrchestrator({ repository, invokers, profiles, workspace: './generated-app' })
const result = await team.run('Build a dashboard with a users page')
await team.close()
repository.close()
```

### DAG state

Tasks use `PENDING`, `READY`, `RUNNING`, `COMPLETED`, `FAILED`, `BLOCKED`, and `CANCELLED`. Creation and resume reject cycles and missing dependencies. A completed dependency unlocks dependent tasks; a failed or cancelled dependency blocks every unfinished descendant.

### Durable records

The SQLite schema contains `projects`, `tasks`, `task_dependencies`, `task_journal`, `scheduler_decisions`, `executions`, `execution_events`, and `verification_reports`. Every task mutation updates its revision and appends a Journal record in one transaction. `DagEngine.resume()` replays the Journal and rejects state that disagrees with the current task rows.

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

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

| File | Role |
|---|---|
| `src/sqlite.ts` | Versioned SQLite schema and connection setup |
| `src/repository.ts` | Durable task, scheduling, execution, event, and verification records |
| `src/dag-engine.ts` | Cycle validation, readiness, transitions, blocking, requeue, Journal replay, and resume |
| `src/scheduler.ts` | Capability matching, weighted scoring, load balancing, and reassignment |
| `src/agent-contracts.ts` | Structured invocation and JSON output validation |
| `src/harness-agents.ts` | Real TypeScript SDK Agent adapters and read-only profile |
| `src/team-orchestrator.ts` | Planner, role execution, parallel frontend calls, Integration, and build verification |
| `src/build-verifier.ts` | Independent npm install and TypeScript/Vite build checks |

## Model Experience

### Role prompts

#### What the model sees

Each Agent receives the role instructions from `src/prompts.ts`, the JSON Schema generated from the task-owned Zod validator, and the complete structured task input. The Planner sees the user requirement; the UI Designer sees pages; each Frontend Agent sees one page and the design output; Integration sees all page outputs and design evidence.

#### Token effect

Planner and role prompts include the task input and generated JSON Schema. The default Agent output cap is 32,000 tokens. UI Designer returns compact tokens, while each frontend task is limited to three files and each Integration output to eight files.

#### KV Cache effect

Role prompts are stable for a given role, generated schema, and task input. Different tasks and retry Sessions naturally start independent request histories.

## Known Limitations and Deferred Work

- **Experimental package:** the public API can change while M2 incubates.
- **SQLite prototype:** PostgreSQL and Prisma integration remain M4 work.
- **Fixed in-process team:** the M2 team is configuration-driven but not a general Agent marketplace.
- **No cross-process scheduler lease:** one process is expected to own one project DAG at a time.
- **Single action verifier:** this milestone verifies installation, TypeScript, and Vite build; browser verification and bounded repair remain M3.
- **Agent output budgets:** large generated pages require explicit model-output configuration or additional decomposition.

<a id="dev-note"></a>
### Dev Note

M2 uses a 32,000-token structured-output budget with reasoning disabled by default for task Agents. M3 should replace fixed output ceilings with evidence-driven decomposition and verify browser behavior in addition to the build.
